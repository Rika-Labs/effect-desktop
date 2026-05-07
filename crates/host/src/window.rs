#![allow(clippy::result_large_err)]
// Host method boundaries return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use crate::{macos, webview, windows};
use anyhow::Result;
use host_protocol::{HostProtocolError, WindowCreatePayload, WindowCreateResponse};
use std::{
    collections::{HashMap, VecDeque},
    sync::{
        mpsc::{self, Receiver, RecvTimeoutError, Sender},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tao::{
    dpi::LogicalSize,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder, EventLoopWindowTarget},
    window::{Window, WindowBuilder},
};
use tracing::{info, warn};
use uuid::Uuid;
use wry::WebView;

const WINDOW_TITLE: &str = "Effect Desktop";
const WINDOW_WIDTH: f64 = 960.0;
const WINDOW_HEIGHT: f64 = 640.0;
const WINDOW_OPENED_EVENT: &str = "host.window.opened";
const WINDOW_DESTROYED_EVENT: &str = "host.window.destroyed";
const WINDOW_EXIT_REQUESTED_EVENT: &str = "host.window.exit_requested";
const WINDOW_METHOD_REPLY_TIMEOUT: Duration = Duration::from_secs(120);
const WINDOW_COMMAND_IDLE_POLL_INTERVAL: Duration = Duration::from_millis(50);
const WINDOW_SMOKE_TEST_TIMEOUT: Duration = Duration::from_secs(150);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum RunMode {
    Interactive,
    WindowSmokeTest,
}

#[derive(Clone)]
pub(crate) struct WindowMethodPort {
    state: Arc<WindowMethodPortState>,
    reply_timeout: Duration,
}

struct WindowMethodPortState {
    commands: Mutex<VecDeque<WindowCommand>>,
}

pub(crate) trait WindowMethodHandler: Send + Sync {
    fn create(
        &self,
        request: WindowCreateRequest,
    ) -> std::result::Result<WindowCreateResponse, HostProtocolError>;

    fn destroy(&self, window_id: &str) -> std::result::Result<(), HostProtocolError>;

    fn set_dock_badge_label(
        &self,
        label: Option<String>,
    ) -> std::result::Result<(), HostProtocolError>;

    fn request_dock_attention(&self, critical: bool) -> std::result::Result<(), HostProtocolError>;
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct WindowCreateRequest {
    title: String,
    width: f64,
    height: f64,
    macos_polish: Option<macos::MacosWindowPolish>,
}

enum HostEvent {}

enum WindowCommand {
    Create {
        request: WindowCreateRequest,
        reply: Sender<WindowCommandReply>,
    },
    Destroy {
        window_id: String,
        reply: Sender<WindowCommandReply>,
    },
    SetDockBadgeLabel {
        label: Option<String>,
        reply: Sender<WindowCommandReply>,
    },
    RequestDockAttention {
        critical: bool,
        reply: Sender<WindowCommandReply>,
    },
}

type WindowCommandReply = std::result::Result<WindowCommandResponse, HostProtocolError>;

enum WindowCommandResponse {
    Created(WindowCreateResponse),
    Destroyed,
    DockBadgeLabelSet,
    DockAttentionRequested,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum WindowLifecycleEvent {
    CloseRequested,
    WindowCreateFailed,
    SmokeTimedOut,
    SmokeExitRequested,
    Other,
}

struct NativeWindowResources {
    _window: Window,
    _webview: WebView,
}

struct WindowRegistry {
    windows: HashMap<String, NativeWindowResources>,
}

impl WindowMethodPort {
    pub(crate) fn new() -> Self {
        Self::with_reply_timeout(WINDOW_METHOD_REPLY_TIMEOUT)
    }

    fn with_reply_timeout(reply_timeout: Duration) -> Self {
        Self {
            state: Arc::new(WindowMethodPortState {
                commands: Mutex::new(VecDeque::new()),
            }),
            reply_timeout,
        }
    }

    fn recv_reply(
        &self,
        reply: Receiver<WindowCommandReply>,
    ) -> std::result::Result<WindowCommandResponse, HostProtocolError> {
        match reply.recv_timeout(self.reply_timeout) {
            Ok(result) => result,
            Err(RecvTimeoutError::Timeout) => Err(HostProtocolError::host_unavailable(
                "WindowMethodPort.recvReply",
            )),
            Err(RecvTimeoutError::Disconnected) => Err(HostProtocolError::internal(
                "window command reply channel closed",
                "WindowMethodPort.recvReply",
            )),
        }
    }

    fn enqueue_command(
        &self,
        command: WindowCommand,
    ) -> std::result::Result<(), HostProtocolError> {
        {
            let mut commands = self.state.commands.lock().map_err(|_| {
                HostProtocolError::internal(
                    "window command queue mutex poisoned",
                    "WindowMethodPort.enqueueCommand",
                )
            })?;
            commands.push_back(command);
        }

        Ok(())
    }

    fn take_pending_commands(&self) -> Vec<WindowCommand> {
        match self.state.commands.lock() {
            Ok(mut commands) => commands.drain(..).collect(),
            Err(_) => {
                warn!(
                    event = "host.window.command_queue_poisoned",
                    "window command queue mutex poisoned"
                );
                Vec::new()
            }
        }
    }
}

impl WindowMethodHandler for WindowMethodPort {
    fn create(
        &self,
        request: WindowCreateRequest,
    ) -> std::result::Result<WindowCreateResponse, HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::Create {
            request,
            reply: reply_tx,
        })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::Created(response) => Ok(response),
            WindowCommandResponse::DockBadgeLabelSet => Err(HostProtocolError::internal(
                "window create received dock badge response",
                host_protocol::WINDOW_CREATE_METHOD,
            )),
            WindowCommandResponse::DockAttentionRequested => Err(HostProtocolError::internal(
                "window create received dock attention response",
                host_protocol::WINDOW_CREATE_METHOD,
            )),
            WindowCommandResponse::Destroyed => Err(HostProtocolError::internal(
                "window create received destroy response",
                host_protocol::WINDOW_CREATE_METHOD,
            )),
        }
    }

    fn destroy(&self, window_id: &str) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::Destroy {
            window_id: window_id.to_string(),
            reply: reply_tx,
        })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::Destroyed => Ok(()),
            WindowCommandResponse::DockBadgeLabelSet => Err(HostProtocolError::internal(
                "window destroy received dock badge response",
                host_protocol::WINDOW_DESTROY_METHOD,
            )),
            WindowCommandResponse::DockAttentionRequested => Err(HostProtocolError::internal(
                "window destroy received dock attention response",
                host_protocol::WINDOW_DESTROY_METHOD,
            )),
            WindowCommandResponse::Created(_) => Err(HostProtocolError::internal(
                "window destroy received create response",
                host_protocol::WINDOW_DESTROY_METHOD,
            )),
        }
    }

    fn set_dock_badge_label(
        &self,
        label: Option<String>,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::SetDockBadgeLabel {
            label,
            reply: reply_tx,
        })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::DockBadgeLabelSet => Ok(()),
            WindowCommandResponse::Created(_)
            | WindowCommandResponse::Destroyed
            | WindowCommandResponse::DockAttentionRequested => Err(HostProtocolError::internal(
                "dock badge command received window response",
                host_protocol::DOCK_SET_BADGE_TEXT_METHOD,
            )),
        }
    }

    fn request_dock_attention(&self, critical: bool) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::RequestDockAttention {
            critical,
            reply: reply_tx,
        })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::DockAttentionRequested => Ok(()),
            WindowCommandResponse::Created(_)
            | WindowCommandResponse::Destroyed
            | WindowCommandResponse::DockBadgeLabelSet => Err(HostProtocolError::internal(
                "dock attention command received window response",
                host_protocol::DOCK_REQUEST_ATTENTION_METHOD,
            )),
        }
    }
}

impl WindowCreateRequest {
    pub(crate) fn new(
        title: String,
        width: f64,
        height: f64,
    ) -> std::result::Result<Self, HostProtocolError> {
        validate_positive_finite("width", width)?;
        validate_positive_finite("height", height)?;

        Ok(Self {
            title,
            width,
            height,
            macos_polish: None,
        })
    }

    fn with_macos_polish(mut self, polish: Option<macos::MacosWindowPolish>) -> Self {
        self.macos_polish = polish;
        self
    }

    fn title(&self) -> &str {
        &self.title
    }

    fn width(&self) -> f64 {
        self.width
    }

    fn height(&self) -> f64 {
        self.height
    }

    fn macos_polish(&self) -> Option<&macos::MacosWindowPolish> {
        self.macos_polish.as_ref()
    }
}

impl TryFrom<WindowCreatePayload> for WindowCreateRequest {
    type Error = HostProtocolError;

    fn try_from(payload: WindowCreatePayload) -> std::result::Result<Self, Self::Error> {
        let request = Self::new(
            payload.title().unwrap_or(WINDOW_TITLE).to_string(),
            payload.width().unwrap_or(WINDOW_WIDTH),
            payload.height().unwrap_or(WINDOW_HEIGHT),
        )?;
        let macos_polish = macos::MacosWindowPolish::new(
            payload.title_bar_style(),
            payload.vibrancy(),
            payload.traffic_lights(),
        )?;

        Ok(request.with_macos_polish(macos_polish))
    }
}

impl WindowRegistry {
    fn new() -> Self {
        Self {
            windows: HashMap::new(),
        }
    }

    fn create(
        &mut self,
        target: &EventLoopWindowTarget<HostEvent>,
        request: WindowCreateRequest,
        mode: RunMode,
    ) -> std::result::Result<WindowCreateResponse, HostProtocolError> {
        let window_id = Uuid::now_v7().to_string();
        let builder = WindowBuilder::new()
            .with_title(request.title())
            .with_inner_size(LogicalSize::new(request.width(), request.height()));
        let window = macos::apply_window_builder_polish(builder, request.macos_polish())
            .build(target)
            .map_err(|error| {
                HostProtocolError::internal(
                    format!("failed to build host window: {error}"),
                    host_protocol::WINDOW_CREATE_METHOD,
                )
            })?;
        windows::apply_window_polish(&window)?;
        macos::apply_window_polish(&window, request.macos_polish())?;

        info!(
            event = WINDOW_OPENED_EVENT,
            window_id,
            title = request.title(),
            width = request.width(),
            height = request.height(),
            smoke = matches!(mode, RunMode::WindowSmokeTest),
            "host window opened"
        );

        let webview = webview::attach_app_webview(&window).map_err(|error| {
            HostProtocolError::internal(
                format!("failed to attach host webview: {error}"),
                host_protocol::WINDOW_CREATE_METHOD,
            )
        })?;
        self.windows.insert(
            window_id.clone(),
            NativeWindowResources {
                _window: window,
                _webview: webview,
            },
        );

        Ok(WindowCreateResponse::new(window_id))
    }

    fn destroy(&mut self, window_id: &str) -> std::result::Result<(), HostProtocolError> {
        if self.windows.remove(window_id).is_none() {
            return Err(HostProtocolError::not_found(
                format!("Window:{window_id}"),
                host_protocol::WINDOW_DESTROY_METHOD,
            ));
        }

        info!(
            event = WINDOW_DESTROYED_EVENT,
            window_id, "host window destroyed"
        );
        Ok(())
    }

    fn set_dock_badge_label(
        &self,
        label: Option<String>,
    ) -> std::result::Result<(), HostProtocolError> {
        let Some(resources) = self.windows.values().next() else {
            return Err(HostProtocolError::not_found(
                "Window:firstResponder",
                host_protocol::DOCK_SET_BADGE_TEXT_METHOD,
            ));
        };

        macos::set_dock_badge_label(&resources._window, label)
    }

    fn request_dock_attention(&self, critical: bool) -> std::result::Result<(), HostProtocolError> {
        let Some(resources) = self.windows.values().next() else {
            return Err(HostProtocolError::not_found(
                "Window:firstResponder",
                host_protocol::DOCK_REQUEST_ATTENTION_METHOD,
            ));
        };

        let attention = if critical {
            tao::window::UserAttentionType::Critical
        } else {
            tao::window::UserAttentionType::Informational
        };
        resources._window.request_user_attention(Some(attention));
        Ok(())
    }

    fn handle_pending_window_commands(
        &mut self,
        target: &EventLoopWindowTarget<HostEvent>,
        mode: RunMode,
        window_methods: &WindowMethodPort,
    ) -> WindowLifecycleEvent {
        self.handle_window_commands(target, mode, window_methods.take_pending_commands())
    }

    fn handle_window_commands(
        &mut self,
        target: &EventLoopWindowTarget<HostEvent>,
        mode: RunMode,
        commands: impl IntoIterator<Item = WindowCommand>,
    ) -> WindowLifecycleEvent {
        let mut lifecycle = WindowLifecycleEvent::Other;

        for command in commands {
            match self.handle_window_command(target, mode, command) {
                WindowLifecycleEvent::WindowCreateFailed => {
                    lifecycle = WindowLifecycleEvent::WindowCreateFailed;
                }
                WindowLifecycleEvent::SmokeTimedOut => {
                    lifecycle = WindowLifecycleEvent::SmokeTimedOut
                }
                WindowLifecycleEvent::SmokeExitRequested
                    if !matches!(
                        lifecycle,
                        WindowLifecycleEvent::WindowCreateFailed
                            | WindowLifecycleEvent::SmokeTimedOut
                    ) =>
                {
                    lifecycle = WindowLifecycleEvent::SmokeExitRequested;
                }
                WindowLifecycleEvent::CloseRequested | WindowLifecycleEvent::Other => {}
                WindowLifecycleEvent::SmokeExitRequested => {}
            }
        }

        lifecycle
    }

    fn handle_window_command(
        &mut self,
        target: &EventLoopWindowTarget<HostEvent>,
        mode: RunMode,
        command: WindowCommand,
    ) -> WindowLifecycleEvent {
        match command {
            WindowCommand::Create { request, reply } => {
                let result = self
                    .create(target, request, mode)
                    .map(WindowCommandResponse::Created);
                let lifecycle = lifecycle_for_create_result(&result);
                send_window_command_reply(reply, result);
                lifecycle
            }
            WindowCommand::Destroy { window_id, reply } => {
                let result = self.destroy(&window_id);
                let exit_after_destroy = result.is_ok()
                    && matches!(mode, RunMode::WindowSmokeTest)
                    && self.windows.is_empty();
                send_window_command_reply(reply, result.map(|()| WindowCommandResponse::Destroyed));

                if exit_after_destroy {
                    WindowLifecycleEvent::SmokeExitRequested
                } else {
                    WindowLifecycleEvent::Other
                }
            }
            WindowCommand::SetDockBadgeLabel { label, reply } => {
                let result = self
                    .set_dock_badge_label(label)
                    .map(|()| WindowCommandResponse::DockBadgeLabelSet);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::RequestDockAttention { critical, reply } => {
                let result = self
                    .request_dock_attention(critical)
                    .map(|()| WindowCommandResponse::DockAttentionRequested);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
        }
    }
}

fn lifecycle_for_create_result(result: &WindowCommandReply) -> WindowLifecycleEvent {
    if result.is_err() {
        WindowLifecycleEvent::WindowCreateFailed
    } else {
        WindowLifecycleEvent::Other
    }
}

pub(crate) fn run_main_window(mode: RunMode, window_methods: WindowMethodPort) -> Result<()> {
    let windows_polish =
        windows::WindowsProcessPolish::from_env().map_err(|error| anyhow::anyhow!("{error:?}"))?;
    windows::apply_process_polish(windows_polish.as_ref())
        .map_err(|error| anyhow::anyhow!("{error:?}"))?;
    let mut event_loop_builder = EventLoopBuilder::<HostEvent>::with_user_event();
    let event_loop = event_loop_builder.build();
    let command_source = window_methods.clone();
    let mut registry = WindowRegistry::new();
    let smoke_deadline = smoke_deadline_for_mode(mode, Instant::now());

    event_loop.run(move |event, target, control_flow| {
        let lifecycle_event = match event {
            Event::NewEvents(_) => {
                registry.handle_pending_window_commands(target, mode, &command_source)
            }
            event => classify_event(&event),
        };
        let now = Instant::now();
        *control_flow = control_flow_for_window_state(
            lifecycle_event_with_smoke_timeout(lifecycle_event, mode, smoke_deadline, now),
            now,
        );
    });
}

fn classify_event(event: &Event<'_, HostEvent>) -> WindowLifecycleEvent {
    match event {
        Event::WindowEvent {
            event: WindowEvent::CloseRequested,
            ..
        } => WindowLifecycleEvent::CloseRequested,
        _ => WindowLifecycleEvent::Other,
    }
}

fn control_flow_for_lifecycle_event(event: WindowLifecycleEvent) -> ControlFlow {
    match event {
        WindowLifecycleEvent::CloseRequested => {
            info!(
                event = WINDOW_EXIT_REQUESTED_EVENT,
                source = "close-requested",
                "host window exit requested"
            );
            ControlFlow::Exit
        }
        WindowLifecycleEvent::WindowCreateFailed => {
            warn!(
                event = WINDOW_EXIT_REQUESTED_EVENT,
                source = "window-create-failed",
                "host window exit requested"
            );
            ControlFlow::ExitWithCode(1)
        }
        WindowLifecycleEvent::SmokeTimedOut => {
            warn!(
                event = WINDOW_EXIT_REQUESTED_EVENT,
                source = "window-smoke-timeout",
                "host window exit requested"
            );
            ControlFlow::ExitWithCode(1)
        }
        WindowLifecycleEvent::SmokeExitRequested => {
            info!(
                event = WINDOW_EXIT_REQUESTED_EVENT,
                source = "window-smoke-test",
                "host window exit requested"
            );
            ControlFlow::Exit
        }
        WindowLifecycleEvent::Other => ControlFlow::Wait,
    }
}

fn smoke_deadline_for_mode(mode: RunMode, now: Instant) -> Option<Instant> {
    if matches!(mode, RunMode::WindowSmokeTest) {
        Some(now + WINDOW_SMOKE_TEST_TIMEOUT)
    } else {
        None
    }
}

fn lifecycle_event_with_smoke_timeout(
    event: WindowLifecycleEvent,
    mode: RunMode,
    deadline: Option<Instant>,
    now: Instant,
) -> WindowLifecycleEvent {
    if !matches!(event, WindowLifecycleEvent::Other) || !matches!(mode, RunMode::WindowSmokeTest) {
        return event;
    }

    match deadline {
        Some(deadline) if now >= deadline => WindowLifecycleEvent::SmokeTimedOut,
        Some(_) | None => event,
    }
}

fn control_flow_for_window_state(event: WindowLifecycleEvent, now: Instant) -> ControlFlow {
    match control_flow_for_lifecycle_event(event) {
        ControlFlow::Wait => ControlFlow::WaitUntil(now + WINDOW_COMMAND_IDLE_POLL_INTERVAL),
        control_flow => control_flow,
    }
}

fn send_window_command_reply(reply: Sender<WindowCommandReply>, result: WindowCommandReply) {
    if reply.send(result).is_err() {
        warn!(
            event = "host.window.command_reply_dropped",
            "window command reply receiver dropped"
        );
    }
}

fn validate_positive_finite(field: &str, value: f64) -> std::result::Result<(), HostProtocolError> {
    if value.is_finite() && value > 0.0 {
        return Ok(());
    }

    Err(HostProtocolError::invalid_argument(
        field,
        "must be a finite positive number",
        host_protocol::WINDOW_CREATE_METHOD,
    ))
}

#[cfg(test)]
mod tests {
    use super::{
        control_flow_for_lifecycle_event, control_flow_for_window_state,
        lifecycle_event_with_smoke_timeout, lifecycle_for_create_result, smoke_deadline_for_mode,
        validate_positive_finite, RunMode, WindowCommand, WindowCommandResponse,
        WindowCreateRequest, WindowLifecycleEvent, WindowMethodPort, WindowRegistry,
        WINDOW_COMMAND_IDLE_POLL_INTERVAL, WINDOW_SMOKE_TEST_TIMEOUT,
    };
    use host_protocol::{HostProtocolError, WindowCreatePayload, WindowCreateResponse};
    use std::sync::mpsc;
    use std::time::Instant;
    use tao::event_loop::ControlFlow;

    #[test]
    fn close_requested_exits_with_zero_status() {
        assert_eq!(
            control_flow_for_lifecycle_event(WindowLifecycleEvent::CloseRequested),
            ControlFlow::Exit
        );
    }

    #[test]
    fn smoke_exit_requested_exits_with_zero_status() {
        assert_eq!(
            control_flow_for_lifecycle_event(WindowLifecycleEvent::SmokeExitRequested),
            ControlFlow::Exit
        );
    }

    #[test]
    fn smoke_timeout_exits_with_error_status() {
        assert_eq!(
            control_flow_for_lifecycle_event(WindowLifecycleEvent::SmokeTimedOut),
            ControlFlow::ExitWithCode(1)
        );
    }

    #[test]
    fn window_create_failure_exits_with_error_status() {
        assert_eq!(
            lifecycle_for_create_result(&Err(HostProtocolError::internal(
                "failed to build host window",
                host_protocol::WINDOW_CREATE_METHOD,
            ))),
            WindowLifecycleEvent::WindowCreateFailed
        );
        assert_eq!(
            control_flow_for_lifecycle_event(WindowLifecycleEvent::WindowCreateFailed),
            ControlFlow::ExitWithCode(1)
        );
    }

    #[test]
    fn window_create_success_keeps_event_loop_waiting() {
        assert_eq!(
            lifecycle_for_create_result(&Ok(WindowCommandResponse::Created(
                WindowCreateResponse::new("018f48cc-7d5a-7d52-9a70-86d8d41c5bd5".to_string())
            ))),
            WindowLifecycleEvent::Other
        );
    }

    #[test]
    fn unrelated_events_wait_without_spinning() {
        assert_eq!(
            control_flow_for_lifecycle_event(WindowLifecycleEvent::Other),
            ControlFlow::Wait
        );
    }

    #[test]
    fn empty_registry_uses_bounded_poll_for_pending_commands() {
        let now = Instant::now();

        assert_eq!(
            control_flow_for_window_state(WindowLifecycleEvent::Other, now),
            ControlFlow::WaitUntil(now + WINDOW_COMMAND_IDLE_POLL_INTERVAL)
        );
    }

    #[test]
    fn window_commands_queue_before_event_loop_starts() {
        let port = WindowMethodPort::new();
        let (reply, _rx) = mpsc::channel();

        port.enqueue_command(WindowCommand::Destroy {
            window_id: "pending".to_string(),
            reply,
        })
        .expect("window command should queue before the native event loop starts");

        assert_eq!(port.take_pending_commands().len(), 1);
    }

    #[test]
    fn open_window_uses_bounded_poll_for_runtime_commands() {
        let now = Instant::now();

        assert_eq!(
            control_flow_for_window_state(WindowLifecycleEvent::Other, now),
            ControlFlow::WaitUntil(now + WINDOW_COMMAND_IDLE_POLL_INTERVAL)
        );
    }

    #[test]
    fn smoke_mode_times_out_when_destroy_never_arrives() {
        let now = Instant::now();
        let deadline = smoke_deadline_for_mode(RunMode::WindowSmokeTest, now)
            .expect("smoke mode should have a deadline");

        assert_eq!(deadline, now + WINDOW_SMOKE_TEST_TIMEOUT);
        assert_eq!(
            lifecycle_event_with_smoke_timeout(
                WindowLifecycleEvent::Other,
                RunMode::WindowSmokeTest,
                Some(deadline),
                deadline,
            ),
            WindowLifecycleEvent::SmokeTimedOut
        );
    }

    #[test]
    fn interactive_mode_does_not_use_smoke_timeout() {
        let now = Instant::now();

        assert_eq!(smoke_deadline_for_mode(RunMode::Interactive, now), None);
        assert_eq!(
            lifecycle_event_with_smoke_timeout(
                WindowLifecycleEvent::Other,
                RunMode::Interactive,
                Some(now),
                now,
            ),
            WindowLifecycleEvent::Other
        );
    }

    #[test]
    fn run_modes_are_distinct() {
        assert_ne!(RunMode::Interactive, RunMode::WindowSmokeTest);
    }

    #[test]
    fn create_request_defaults_missing_fields() {
        let request = WindowCreateRequest::try_from(WindowCreatePayload::default())
            .expect("default window create payload should validate");

        assert_eq!(
            request,
            WindowCreateRequest::new("Effect Desktop".to_string(), 960.0, 640.0)
                .expect("default request should validate")
        );
    }

    #[test]
    fn non_positive_window_size_is_invalid() {
        assert_eq!(
            validate_positive_finite("width", 0.0),
            Err(HostProtocolError::invalid_argument(
                "width",
                "must be a finite positive number",
                host_protocol::WINDOW_CREATE_METHOD,
            ))
        );
        assert_eq!(
            validate_positive_finite("height", f64::INFINITY),
            Err(HostProtocolError::invalid_argument(
                "height",
                "must be a finite positive number",
                host_protocol::WINDOW_CREATE_METHOD,
            ))
        );
    }

    #[test]
    fn destroying_unknown_window_id_returns_not_found() {
        let mut registry = WindowRegistry::new();

        assert_eq!(
            registry.destroy("missing"),
            Err(HostProtocolError::not_found(
                "Window:missing",
                host_protocol::WINDOW_DESTROY_METHOD,
            ))
        );
    }
}
