use crate::webview;
use anyhow::{anyhow, Context, Result};
use host_protocol::{HostProtocolError, WindowCreatePayload, WindowCreateResponse};
use std::{
    collections::{HashMap, VecDeque},
    sync::{
        mpsc::{self, Receiver, RecvTimeoutError, Sender},
        Arc, Condvar, Mutex, MutexGuard,
    },
    time::{Duration, Instant},
};
use tao::{
    dpi::LogicalSize,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy, EventLoopWindowTarget},
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
const WINDOW_METHOD_READY_TIMEOUT: Duration = Duration::from_secs(5);
const WINDOW_METHOD_REPLY_TIMEOUT: Duration = Duration::from_secs(5);
const WINDOW_COMMAND_IDLE_POLL_INTERVAL: Duration = Duration::from_millis(50);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum RunMode {
    Interactive,
    WindowSmokeTest,
}

#[derive(Clone)]
pub(crate) struct WindowMethodPort {
    state: Arc<WindowMethodPortState>,
    ready_timeout: Duration,
    reply_timeout: Duration,
}

struct WindowMethodPortState {
    proxy: Mutex<Option<EventLoopProxy<HostEvent>>>,
    commands: Mutex<VecDeque<WindowCommand>>,
    ready: Condvar,
}

pub(crate) trait WindowMethodHandler: Send + Sync {
    fn create(
        &self,
        request: WindowCreateRequest,
    ) -> std::result::Result<WindowCreateResponse, HostProtocolError>;

    fn destroy(&self, window_id: &str) -> std::result::Result<(), HostProtocolError>;
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct WindowCreateRequest {
    title: String,
    width: f64,
    height: f64,
}

enum HostEvent {
    Wake,
}

enum WindowCommand {
    Create {
        request: WindowCreateRequest,
        reply: Sender<WindowCommandReply>,
    },
    Destroy {
        window_id: String,
        reply: Sender<WindowCommandReply>,
    },
}

type WindowCommandReply = std::result::Result<WindowCommandResponse, HostProtocolError>;

enum WindowCommandResponse {
    Created(WindowCreateResponse),
    Destroyed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum WindowLifecycleEvent {
    CloseRequested,
    WindowCreateFailed,
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
        Self::with_timeouts(WINDOW_METHOD_READY_TIMEOUT, WINDOW_METHOD_REPLY_TIMEOUT)
    }

    fn with_timeouts(ready_timeout: Duration, reply_timeout: Duration) -> Self {
        Self {
            state: Arc::new(WindowMethodPortState {
                proxy: Mutex::new(None),
                commands: Mutex::new(VecDeque::new()),
                ready: Condvar::new(),
            }),
            ready_timeout,
            reply_timeout,
        }
    }

    fn install_proxy(&self, proxy: EventLoopProxy<HostEvent>) -> Result<()> {
        let mut current = self
            .state
            .proxy
            .lock()
            .map_err(|_| anyhow!("window method port mutex poisoned during proxy install"))?;
        *current = Some(proxy);
        self.state.ready.notify_all();
        Ok(())
    }

    fn installed_proxy(&self) -> std::result::Result<EventLoopProxy<HostEvent>, HostProtocolError> {
        let deadline = Instant::now() + self.ready_timeout;
        let mut current = self.lock_proxy()?;

        loop {
            if let Some(proxy) = current.as_ref() {
                return Ok(proxy.clone());
            }

            let now = Instant::now();
            if now >= deadline {
                return Err(HostProtocolError::HostUnavailable);
            }

            let remaining = deadline.saturating_duration_since(now);
            let wait_result = self
                .state
                .ready
                .wait_timeout(current, remaining)
                .map_err(|_| HostProtocolError::Internal {
                    message: "window method port mutex poisoned while waiting for event loop"
                        .to_string(),
                })?;
            current = wait_result.0;

            if wait_result.1.timed_out() && current.is_none() {
                return Err(HostProtocolError::HostUnavailable);
            }
        }
    }

    fn lock_proxy(
        &self,
    ) -> std::result::Result<MutexGuard<'_, Option<EventLoopProxy<HostEvent>>>, HostProtocolError>
    {
        self.state
            .proxy
            .lock()
            .map_err(|_| HostProtocolError::Internal {
                message: "window method port mutex poisoned".to_string(),
            })
    }

    fn recv_reply(
        &self,
        reply: Receiver<WindowCommandReply>,
    ) -> std::result::Result<WindowCommandResponse, HostProtocolError> {
        match reply.recv_timeout(self.reply_timeout) {
            Ok(result) => result,
            Err(RecvTimeoutError::Timeout) => Err(HostProtocolError::HostUnavailable),
            Err(RecvTimeoutError::Disconnected) => Err(HostProtocolError::Internal {
                message: "window command reply channel closed".to_string(),
            }),
        }
    }

    fn enqueue_command(
        &self,
        command: WindowCommand,
    ) -> std::result::Result<(), HostProtocolError> {
        let proxy = self.installed_proxy()?;
        self.state
            .commands
            .lock()
            .map_err(|_| HostProtocolError::Internal {
                message: "window command queue mutex poisoned".to_string(),
            })?
            .push_back(command);
        proxy
            .send_event(HostEvent::Wake)
            .map_err(|_| HostProtocolError::HostUnavailable)
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
            WindowCommandResponse::Destroyed => Err(HostProtocolError::Internal {
                message: "window create received destroy response".to_string(),
            }),
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
            WindowCommandResponse::Created(_) => Err(HostProtocolError::Internal {
                message: "window destroy received create response".to_string(),
            }),
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
        })
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
}

impl TryFrom<WindowCreatePayload> for WindowCreateRequest {
    type Error = HostProtocolError;

    fn try_from(payload: WindowCreatePayload) -> std::result::Result<Self, Self::Error> {
        Self::new(
            payload.title().unwrap_or(WINDOW_TITLE).to_string(),
            payload.width().unwrap_or(WINDOW_WIDTH),
            payload.height().unwrap_or(WINDOW_HEIGHT),
        )
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
        let window = WindowBuilder::new()
            .with_title(request.title())
            .with_inner_size(LogicalSize::new(request.width(), request.height()))
            .build(target)
            .map_err(|error| HostProtocolError::Internal {
                message: format!("failed to build host window: {error}"),
            })?;

        info!(
            event = WINDOW_OPENED_EVENT,
            window_id,
            title = request.title(),
            width = request.width(),
            height = request.height(),
            smoke = matches!(mode, RunMode::WindowSmokeTest),
            "host window opened"
        );

        let webview =
            webview::attach_app_webview(&window).map_err(|error| HostProtocolError::Internal {
                message: format!("failed to attach host webview: {error}"),
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
            return Err(HostProtocolError::NotFound {
                resource: format!("Window:{window_id}"),
            });
        }

        info!(
            event = WINDOW_DESTROYED_EVENT,
            window_id, "host window destroyed"
        );
        Ok(())
    }

    fn handle_pending_window_commands(
        &mut self,
        target: &EventLoopWindowTarget<HostEvent>,
        mode: RunMode,
        window_methods: &WindowMethodPort,
    ) -> WindowLifecycleEvent {
        let mut lifecycle = WindowLifecycleEvent::Other;

        for command in window_methods.take_pending_commands() {
            match self.handle_window_command(target, mode, command) {
                WindowLifecycleEvent::WindowCreateFailed => {
                    lifecycle = WindowLifecycleEvent::WindowCreateFailed;
                }
                WindowLifecycleEvent::SmokeExitRequested
                    if lifecycle != WindowLifecycleEvent::WindowCreateFailed =>
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
    let mut event_loop_builder = EventLoopBuilder::<HostEvent>::with_user_event();
    let event_loop = event_loop_builder.build();
    window_methods
        .install_proxy(event_loop.create_proxy())
        .context("failed to install window method event-loop proxy")?;
    let command_source = window_methods.clone();
    let mut registry = WindowRegistry::new();

    event_loop.run(move |event, target, control_flow| {
        let lifecycle_event = match event {
            Event::NewEvents(_) | Event::UserEvent(HostEvent::Wake) => {
                registry.handle_pending_window_commands(target, mode, &command_source)
            }
            event => classify_event(&event),
        };
        *control_flow = control_flow_for_window_state(lifecycle_event, Instant::now());
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

    Err(HostProtocolError::InvalidArgument {
        field: field.to_string(),
        reason: "must be a finite positive number".to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::{
        control_flow_for_lifecycle_event, control_flow_for_window_state,
        lifecycle_for_create_result, validate_positive_finite, RunMode, WindowCommandResponse,
        WindowCreateRequest, WindowLifecycleEvent, WindowRegistry,
        WINDOW_COMMAND_IDLE_POLL_INTERVAL,
    };
    use host_protocol::{HostProtocolError, WindowCreatePayload, WindowCreateResponse};
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
    fn window_create_failure_exits_with_error_status() {
        assert_eq!(
            lifecycle_for_create_result(&Err(HostProtocolError::Internal {
                message: "failed to build host window".to_string(),
            })),
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
    fn empty_registry_uses_bounded_poll_for_startup_commands() {
        let now = Instant::now();

        assert_eq!(
            control_flow_for_window_state(WindowLifecycleEvent::Other, now),
            ControlFlow::WaitUntil(now + WINDOW_COMMAND_IDLE_POLL_INTERVAL)
        );
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
            Err(HostProtocolError::InvalidArgument {
                field: "width".to_string(),
                reason: "must be a finite positive number".to_string(),
            })
        );
        assert_eq!(
            validate_positive_finite("height", f64::INFINITY),
            Err(HostProtocolError::InvalidArgument {
                field: "height".to_string(),
                reason: "must be a finite positive number".to_string(),
            })
        );
    }

    #[test]
    fn destroying_unknown_window_id_returns_not_found() {
        let mut registry = WindowRegistry::new();

        assert_eq!(
            registry.destroy("missing"),
            Err(HostProtocolError::NotFound {
                resource: "Window:missing".to_string(),
            })
        );
    }
}
