#![allow(clippy::result_large_err)]
// Host method boundaries return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

#[cfg(not(test))]
use crate::methods::resident_lifecycle::{self, ResidentWindowCloseAction};
use crate::{macos, webview, windows};
use anyhow::Result;
use host_protocol::{
    DockProgressState, DockSetProgressPayload, HostProtocolEnvelope, HostProtocolError,
    ScreenBoundsPayload, ScreenDisplayPayload, ScreenDisplaysChangedEventPayload,
    ScreenDisplaysResultPayload, ScreenMethodPayload, ScreenPointPayload, ScreenSupportedPayload,
    TrayActivatedEventPayload, TrayResourcePayload, WindowAttentionType, WindowBoundsPayload,
    WindowCreatePayload, WindowCreateResponse, WindowListResponse, WindowLookupResponse,
    WindowParentResponse, WindowProgressState, WindowRegistryEventPayload,
    WindowRegistryEventPhase, WindowSetProgressPayload, WindowStateEventPayload,
    WindowStatePayload, WindowTrafficLights,
};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{
        mpsc::{self, Receiver, RecvTimeoutError, Sender},
        Arc, LazyLock, Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tao::{
    dpi::{LogicalPosition, LogicalSize, PhysicalPosition},
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder, EventLoopWindowTarget},
    monitor::MonitorHandle,
    window::{
        Fullscreen, ProgressBarState, ProgressState, UserAttentionType, Window, WindowBuilder,
        WindowId,
    },
};
use tracing::{info, warn};
use uuid::Uuid;

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
    HostProtocolStdio,
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
    fn quit(&self, exit_code: u8) -> std::result::Result<(), HostProtocolError>;

    fn create(
        &self,
        request: WindowCreateRequest,
    ) -> std::result::Result<WindowCreateResponse, HostProtocolError>;

    fn destroy(&self, window_id: &str) -> std::result::Result<(), HostProtocolError>;

    fn show(&self, window_id: &str) -> std::result::Result<(), HostProtocolError>;

    fn hide(&self, window_id: &str) -> std::result::Result<(), HostProtocolError>;

    fn focus(&self, window_id: &str) -> std::result::Result<(), HostProtocolError>;

    fn get_current(&self) -> std::result::Result<WindowLookupResponse, HostProtocolError>;

    fn get_by_id(
        &self,
        window_id: &str,
    ) -> std::result::Result<WindowLookupResponse, HostProtocolError>;

    fn list(&self) -> std::result::Result<WindowListResponse, HostProtocolError>;

    fn get_parent(
        &self,
        window_id: &str,
    ) -> std::result::Result<WindowParentResponse, HostProtocolError>;

    fn get_children(
        &self,
        window_id: &str,
    ) -> std::result::Result<WindowListResponse, HostProtocolError>;

    fn get_bounds(
        &self,
        window_id: &str,
    ) -> std::result::Result<WindowBoundsPayload, HostProtocolError>;

    fn set_bounds(
        &self,
        window_id: &str,
        bounds: &WindowBoundsPayload,
    ) -> std::result::Result<(), HostProtocolError>;

    fn center(&self, window_id: &str) -> std::result::Result<(), HostProtocolError>;

    fn center_on_display(
        &self,
        window_id: &str,
        display_id: &str,
    ) -> std::result::Result<(), HostProtocolError>;

    fn set_title(&self, window_id: &str, title: &str)
        -> std::result::Result<(), HostProtocolError>;

    fn set_resizable(
        &self,
        window_id: &str,
        resizable: bool,
    ) -> std::result::Result<(), HostProtocolError>;

    fn set_decorations(
        &self,
        window_id: &str,
        decorations: bool,
    ) -> std::result::Result<(), HostProtocolError>;

    fn set_traffic_lights(
        &self,
        window_id: &str,
        traffic_lights: &WindowTrafficLights,
    ) -> std::result::Result<(), HostProtocolError>;

    fn set_vibrancy(
        &self,
        window_id: &str,
        material: &str,
    ) -> std::result::Result<(), HostProtocolError>;

    fn set_shadow(
        &self,
        window_id: &str,
        has_shadow: bool,
    ) -> std::result::Result<(), HostProtocolError>;

    fn set_always_on_top(
        &self,
        window_id: &str,
        always_on_top: bool,
    ) -> std::result::Result<(), HostProtocolError>;

    fn set_skip_taskbar(
        &self,
        window_id: &str,
        skip_taskbar: bool,
    ) -> std::result::Result<(), HostProtocolError>;

    fn set_progress(
        &self,
        window_id: &str,
        progress: &WindowSetProgressPayload,
    ) -> std::result::Result<(), HostProtocolError>;

    fn request_attention(
        &self,
        window_id: &str,
        request_type: WindowAttentionType,
    ) -> std::result::Result<(), HostProtocolError>;

    fn cancel_attention(&self, window_id: &str) -> std::result::Result<(), HostProtocolError>;

    fn minimize(&self, window_id: &str) -> std::result::Result<(), HostProtocolError>;

    fn maximize(&self, window_id: &str) -> std::result::Result<(), HostProtocolError>;

    fn restore(&self, window_id: &str) -> std::result::Result<(), HostProtocolError>;

    fn set_fullscreen(
        &self,
        window_id: &str,
        fullscreen: bool,
    ) -> std::result::Result<(), HostProtocolError>;

    fn set_simple_fullscreen(
        &self,
        window_id: &str,
        simple_fullscreen: bool,
    ) -> std::result::Result<(), HostProtocolError>;

    fn get_state(
        &self,
        window_id: &str,
    ) -> std::result::Result<WindowStatePayload, HostProtocolError>;

    fn set_dock_badge_label(
        &self,
        label: Option<String>,
        operation: &'static str,
    ) -> std::result::Result<(), HostProtocolError>;

    fn set_dock_progress(
        &self,
        progress: &DockSetProgressPayload,
    ) -> std::result::Result<(), HostProtocolError>;

    fn request_dock_attention(&self, critical: bool) -> std::result::Result<(), HostProtocolError>;

    fn set_dock_menu(
        &self,
        template: Option<serde_json::Value>,
    ) -> std::result::Result<(), HostProtocolError>;

    fn set_application_menu(
        &self,
        template: serde_json::Value,
    ) -> std::result::Result<(), HostProtocolError>;

    fn set_window_menu(
        &self,
        window_id: &str,
        template: serde_json::Value,
    ) -> std::result::Result<(), HostProtocolError>;

    fn create_tray(
        &self,
        request: TrayCreateRequest,
    ) -> std::result::Result<TrayResourcePayload, HostProtocolError>;

    fn set_tray_icon(
        &self,
        tray: &TrayResourcePayload,
        icon: String,
    ) -> std::result::Result<(), HostProtocolError>;

    fn set_tray_tooltip(
        &self,
        tray: &TrayResourcePayload,
        tooltip: String,
    ) -> std::result::Result<(), HostProtocolError>;

    fn set_tray_title(
        &self,
        tray: &TrayResourcePayload,
        title: String,
    ) -> std::result::Result<(), HostProtocolError>;

    fn set_tray_menu(
        &self,
        tray: &TrayResourcePayload,
        menu: serde_json::Value,
    ) -> std::result::Result<(), HostProtocolError>;

    fn destroy_tray(
        &self,
        tray: &TrayResourcePayload,
    ) -> std::result::Result<(), HostProtocolError>;

    fn clear_runtime_trays(&self) -> std::result::Result<(), HostProtocolError>;

    fn get_screen_displays(
        &self,
    ) -> std::result::Result<ScreenDisplaysResultPayload, HostProtocolError>;

    fn get_primary_screen_display(
        &self,
    ) -> std::result::Result<ScreenDisplayPayload, HostProtocolError>;

    fn get_screen_pointer_point(
        &self,
    ) -> std::result::Result<ScreenPointPayload, HostProtocolError>;

    fn screen_is_supported(
        &self,
        method: ScreenMethodPayload,
    ) -> std::result::Result<ScreenSupportedPayload, HostProtocolError>;
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct WindowCreateRequest {
    title: String,
    width: f64,
    height: f64,
    parent_window_id: Option<String>,
    macos_polish: Option<macos::MacosWindowPolish>,
}

#[derive(Clone, Debug)]
pub(crate) struct TrayCreateRequest {
    icon: String,
    tooltip: Option<String>,
    title: Option<String>,
    menu: Option<serde_json::Value>,
    event_sender: Option<Sender<HostProtocolEnvelope>>,
}

enum HostEvent {}

enum WindowCommand {
    Quit {
        exit_code: u8,
        reply: Sender<WindowCommandReply>,
    },
    Create {
        request: WindowCreateRequest,
        reply: Sender<WindowCommandReply>,
    },
    Destroy {
        window_id: String,
        reply: Sender<WindowCommandReply>,
    },
    Show {
        window_id: String,
        reply: Sender<WindowCommandReply>,
    },
    Hide {
        window_id: String,
        reply: Sender<WindowCommandReply>,
    },
    Focus {
        window_id: String,
        reply: Sender<WindowCommandReply>,
    },
    GetCurrent {
        reply: Sender<WindowCommandReply>,
    },
    GetById {
        window_id: String,
        reply: Sender<WindowCommandReply>,
    },
    List {
        reply: Sender<WindowCommandReply>,
    },
    GetParent {
        window_id: String,
        reply: Sender<WindowCommandReply>,
    },
    GetChildren {
        window_id: String,
        reply: Sender<WindowCommandReply>,
    },
    GetBounds {
        window_id: String,
        reply: Sender<WindowCommandReply>,
    },
    SetBounds {
        window_id: String,
        bounds: WindowBoundsPayload,
        reply: Sender<WindowCommandReply>,
    },
    Center {
        window_id: String,
        reply: Sender<WindowCommandReply>,
    },
    CenterOnDisplay {
        window_id: String,
        display_id: String,
        reply: Sender<WindowCommandReply>,
    },
    SetTitle {
        window_id: String,
        title: String,
        reply: Sender<WindowCommandReply>,
    },
    SetResizable {
        window_id: String,
        resizable: bool,
        reply: Sender<WindowCommandReply>,
    },
    SetDecorations {
        window_id: String,
        decorations: bool,
        reply: Sender<WindowCommandReply>,
    },
    SetTrafficLights {
        window_id: String,
        traffic_lights: WindowTrafficLights,
        reply: Sender<WindowCommandReply>,
    },
    SetVibrancy {
        window_id: String,
        material: String,
        reply: Sender<WindowCommandReply>,
    },
    SetShadow {
        window_id: String,
        has_shadow: bool,
        reply: Sender<WindowCommandReply>,
    },
    SetAlwaysOnTop {
        window_id: String,
        always_on_top: bool,
        reply: Sender<WindowCommandReply>,
    },
    SetSkipTaskbar {
        window_id: String,
        skip_taskbar: bool,
        reply: Sender<WindowCommandReply>,
    },
    SetProgress {
        window_id: String,
        progress: WindowSetProgressPayload,
        reply: Sender<WindowCommandReply>,
    },
    RequestAttention {
        window_id: String,
        request_type: WindowAttentionType,
        reply: Sender<WindowCommandReply>,
    },
    CancelAttention {
        window_id: String,
        reply: Sender<WindowCommandReply>,
    },
    Minimize {
        window_id: String,
        reply: Sender<WindowCommandReply>,
    },
    Maximize {
        window_id: String,
        reply: Sender<WindowCommandReply>,
    },
    Restore {
        window_id: String,
        reply: Sender<WindowCommandReply>,
    },
    SetFullscreen {
        window_id: String,
        fullscreen: bool,
        reply: Sender<WindowCommandReply>,
    },
    SetSimpleFullscreen {
        window_id: String,
        simple_fullscreen: bool,
        reply: Sender<WindowCommandReply>,
    },
    GetState {
        window_id: String,
        reply: Sender<WindowCommandReply>,
    },
    SetDockBadgeLabel {
        label: Option<String>,
        operation: &'static str,
        reply: Sender<WindowCommandReply>,
    },
    SetDockProgress {
        progress: DockSetProgressPayload,
        reply: Sender<WindowCommandReply>,
    },
    RequestDockAttention {
        critical: bool,
        reply: Sender<WindowCommandReply>,
    },
    SetDockMenu {
        template: Option<serde_json::Value>,
        reply: Sender<WindowCommandReply>,
    },
    SetApplicationMenu {
        template: serde_json::Value,
        reply: Sender<WindowCommandReply>,
    },
    SetWindowMenu {
        window_id: String,
        template: serde_json::Value,
        reply: Sender<WindowCommandReply>,
    },
    CreateTray {
        request: TrayCreateRequest,
        reply: Sender<WindowCommandReply>,
    },
    SetTrayIcon {
        tray: TrayResourcePayload,
        icon: String,
        reply: Sender<WindowCommandReply>,
    },
    SetTrayTooltip {
        tray: TrayResourcePayload,
        tooltip: String,
        reply: Sender<WindowCommandReply>,
    },
    SetTrayTitle {
        tray: TrayResourcePayload,
        title: String,
        reply: Sender<WindowCommandReply>,
    },
    SetTrayMenu {
        tray: TrayResourcePayload,
        menu: serde_json::Value,
        reply: Sender<WindowCommandReply>,
    },
    DestroyTray {
        tray: TrayResourcePayload,
        reply: Sender<WindowCommandReply>,
    },
    ClearRuntimeTrays {
        reply: Sender<WindowCommandReply>,
    },
    GetScreenDisplays {
        reply: Sender<WindowCommandReply>,
    },
    GetPrimaryScreenDisplay {
        reply: Sender<WindowCommandReply>,
    },
    GetScreenPointerPoint {
        reply: Sender<WindowCommandReply>,
    },
    ScreenIsSupported {
        method: ScreenMethodPayload,
        reply: Sender<WindowCommandReply>,
    },
}

type WindowCommandReply = std::result::Result<WindowCommandResponse, HostProtocolError>;

enum WindowCommandResponse {
    Created(WindowCreateResponse),
    Destroyed,
    WindowUpdated,
    WindowLookup(WindowLookupResponse),
    WindowList(WindowListResponse),
    WindowParent(WindowParentResponse),
    WindowBounds(WindowBoundsPayload),
    WindowState(WindowStatePayload),
    DockBadgeLabelSet,
    DockProgressSet,
    DockAttentionRequested,
    DockMenuSet,
    MenuSet,
    TrayCreated(TrayResourcePayload),
    TrayUpdated,
    TrayDestroyed,
    ScreenDisplays(ScreenDisplaysResultPayload),
    ScreenDisplay(ScreenDisplayPayload),
    ScreenPoint(ScreenPointPayload),
    ScreenSupported(ScreenSupportedPayload),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum WindowLifecycleEvent {
    CloseRequested,
    AppQuitRequested(u8),
    WindowCreateFailed,
    SmokeTimedOut,
    SmokeExitRequested,
    Other,
}

struct NativeWindowResources {
    _window: Window,
    _webview: webview::HostWebView,
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
struct NativeTrayResources {
    _tray: tray_icon::TrayIcon,
    generation: u64,
    owner_scope: String,
}

struct WindowRegistry {
    windows: HashMap<String, NativeWindowResources>,
    window_states: HashMap<String, WindowStatePayload>,
    window_id_by_native_id: HashMap<WindowId, String>,
    window_order: Vec<String>,
    focused_window_id: Option<String>,
    child_window_ids_by_parent_id: HashMap<String, HashSet<String>>,
    parent_window_id_by_child_id: HashMap<String, String>,
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    trays: HashMap<String, NativeTrayResources>,
}

static TRAY_EVENT_SENDER: LazyLock<Mutex<Option<Sender<HostProtocolEnvelope>>>> =
    LazyLock::new(|| Mutex::new(None));
static TRAY_EVENT_HANDLES: LazyLock<Mutex<HashMap<String, TrayResourcePayload>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static SCREEN_EVENT_SENDER: LazyLock<Mutex<Option<Sender<HostProtocolEnvelope>>>> =
    LazyLock::new(|| Mutex::new(None));
static WINDOW_EVENT_SENDER: LazyLock<Mutex<Option<Sender<HostProtocolEnvelope>>>> =
    LazyLock::new(|| Mutex::new(None));

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
            Err(error) => {
                let mut commands = error.into_inner();
                let pending = commands.drain(..).collect();
                warn!(
                    event = "host.window.command_queue_poisoned",
                    "window command queue mutex poisoned"
                );
                pending
            }
        }
    }

    fn expect_window_void_response(
        &self,
        reply: Receiver<WindowCommandReply>,
        operation: &'static str,
    ) -> std::result::Result<(), HostProtocolError> {
        match self.recv_reply(reply)? {
            WindowCommandResponse::WindowUpdated => Ok(()),
            WindowCommandResponse::Created(_)
            | WindowCommandResponse::Destroyed
            | WindowCommandResponse::WindowLookup(_)
            | WindowCommandResponse::WindowList(_)
            | WindowCommandResponse::WindowParent(_)
            | WindowCommandResponse::WindowBounds(_)
            | WindowCommandResponse::WindowState(_)
            | WindowCommandResponse::DockBadgeLabelSet
            | WindowCommandResponse::DockProgressSet
            | WindowCommandResponse::DockAttentionRequested
            | WindowCommandResponse::DockMenuSet
            | WindowCommandResponse::MenuSet
            | WindowCommandResponse::TrayCreated(_)
            | WindowCommandResponse::TrayUpdated
            | WindowCommandResponse::TrayDestroyed
            | WindowCommandResponse::ScreenDisplays(_)
            | WindowCommandResponse::ScreenDisplay(_)
            | WindowCommandResponse::ScreenPoint(_)
            | WindowCommandResponse::ScreenSupported(_) => Err(HostProtocolError::internal(
                "window lifecycle command received unrelated response",
                operation,
            )),
        }
    }
}

impl WindowMethodHandler for WindowMethodPort {
    fn quit(&self, exit_code: u8) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::Quit {
            exit_code,
            reply: reply_tx,
        })?;

        self.expect_window_void_response(reply_rx, host_protocol::APP_QUIT_METHOD)
    }

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
            WindowCommandResponse::DockProgressSet => Err(HostProtocolError::internal(
                "window create received dock progress response",
                host_protocol::WINDOW_CREATE_METHOD,
            )),
            WindowCommandResponse::DockAttentionRequested => Err(HostProtocolError::internal(
                "window create received dock attention response",
                host_protocol::WINDOW_CREATE_METHOD,
            )),
            WindowCommandResponse::DockMenuSet => Err(HostProtocolError::internal(
                "window create received dock menu response",
                host_protocol::WINDOW_CREATE_METHOD,
            )),
            WindowCommandResponse::MenuSet => Err(HostProtocolError::internal(
                "window create received menu response",
                host_protocol::WINDOW_CREATE_METHOD,
            )),
            WindowCommandResponse::Destroyed => Err(HostProtocolError::internal(
                "window create received destroy response",
                host_protocol::WINDOW_CREATE_METHOD,
            )),
            WindowCommandResponse::WindowLookup(_) => Err(HostProtocolError::internal(
                "window create received lookup response",
                host_protocol::WINDOW_CREATE_METHOD,
            )),
            WindowCommandResponse::WindowList(_) => Err(HostProtocolError::internal(
                "window create received list response",
                host_protocol::WINDOW_CREATE_METHOD,
            )),
            WindowCommandResponse::WindowParent(_) => Err(HostProtocolError::internal(
                "window create received parent response",
                host_protocol::WINDOW_CREATE_METHOD,
            )),
            WindowCommandResponse::WindowUpdated => Err(HostProtocolError::internal(
                "window create received lifecycle response",
                host_protocol::WINDOW_CREATE_METHOD,
            )),
            WindowCommandResponse::WindowBounds(_) => Err(HostProtocolError::internal(
                "window create received bounds response",
                host_protocol::WINDOW_CREATE_METHOD,
            )),
            WindowCommandResponse::WindowState(_) => Err(HostProtocolError::internal(
                "window create received state response",
                host_protocol::WINDOW_CREATE_METHOD,
            )),
            WindowCommandResponse::TrayCreated(_)
            | WindowCommandResponse::TrayUpdated
            | WindowCommandResponse::TrayDestroyed
            | WindowCommandResponse::ScreenDisplays(_)
            | WindowCommandResponse::ScreenDisplay(_)
            | WindowCommandResponse::ScreenPoint(_)
            | WindowCommandResponse::ScreenSupported(_) => Err(HostProtocolError::internal(
                "window create received tray response",
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
            WindowCommandResponse::DockProgressSet => Err(HostProtocolError::internal(
                "window destroy received dock progress response",
                host_protocol::WINDOW_DESTROY_METHOD,
            )),
            WindowCommandResponse::DockAttentionRequested => Err(HostProtocolError::internal(
                "window destroy received dock attention response",
                host_protocol::WINDOW_DESTROY_METHOD,
            )),
            WindowCommandResponse::DockMenuSet => Err(HostProtocolError::internal(
                "window destroy received dock menu response",
                host_protocol::WINDOW_DESTROY_METHOD,
            )),
            WindowCommandResponse::MenuSet => Err(HostProtocolError::internal(
                "window destroy received menu response",
                host_protocol::WINDOW_DESTROY_METHOD,
            )),
            WindowCommandResponse::Created(_) => Err(HostProtocolError::internal(
                "window destroy received create response",
                host_protocol::WINDOW_DESTROY_METHOD,
            )),
            WindowCommandResponse::WindowLookup(_) => Err(HostProtocolError::internal(
                "window destroy received lookup response",
                host_protocol::WINDOW_DESTROY_METHOD,
            )),
            WindowCommandResponse::WindowList(_) => Err(HostProtocolError::internal(
                "window destroy received list response",
                host_protocol::WINDOW_DESTROY_METHOD,
            )),
            WindowCommandResponse::WindowParent(_) => Err(HostProtocolError::internal(
                "window destroy received parent response",
                host_protocol::WINDOW_DESTROY_METHOD,
            )),
            WindowCommandResponse::WindowUpdated => Err(HostProtocolError::internal(
                "window destroy received lifecycle response",
                host_protocol::WINDOW_DESTROY_METHOD,
            )),
            WindowCommandResponse::WindowBounds(_) => Err(HostProtocolError::internal(
                "window destroy received bounds response",
                host_protocol::WINDOW_DESTROY_METHOD,
            )),
            WindowCommandResponse::WindowState(_) => Err(HostProtocolError::internal(
                "window destroy received state response",
                host_protocol::WINDOW_DESTROY_METHOD,
            )),
            WindowCommandResponse::TrayCreated(_)
            | WindowCommandResponse::TrayUpdated
            | WindowCommandResponse::TrayDestroyed
            | WindowCommandResponse::ScreenDisplays(_)
            | WindowCommandResponse::ScreenDisplay(_)
            | WindowCommandResponse::ScreenPoint(_)
            | WindowCommandResponse::ScreenSupported(_) => Err(HostProtocolError::internal(
                "window destroy received tray response",
                host_protocol::WINDOW_DESTROY_METHOD,
            )),
        }
    }

    fn get_current(&self) -> std::result::Result<WindowLookupResponse, HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::GetCurrent { reply: reply_tx })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::WindowLookup(response) => Ok(response),
            _ => Err(HostProtocolError::internal(
                "window get current received unrelated response",
                host_protocol::WINDOW_GET_CURRENT_METHOD,
            )),
        }
    }

    fn get_by_id(
        &self,
        window_id: &str,
    ) -> std::result::Result<WindowLookupResponse, HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::GetById {
            window_id: window_id.to_string(),
            reply: reply_tx,
        })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::WindowLookup(response) => Ok(response),
            _ => Err(HostProtocolError::internal(
                "window get by id received unrelated response",
                host_protocol::WINDOW_GET_BY_ID_METHOD,
            )),
        }
    }

    fn list(&self) -> std::result::Result<WindowListResponse, HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::List { reply: reply_tx })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::WindowList(response) => Ok(response),
            _ => Err(HostProtocolError::internal(
                "window list received unrelated response",
                host_protocol::WINDOW_LIST_METHOD,
            )),
        }
    }

    fn get_parent(
        &self,
        window_id: &str,
    ) -> std::result::Result<WindowParentResponse, HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::GetParent {
            window_id: window_id.to_string(),
            reply: reply_tx,
        })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::WindowParent(response) => Ok(response),
            _ => Err(HostProtocolError::internal(
                "window get parent received unrelated response",
                host_protocol::WINDOW_GET_PARENT_METHOD,
            )),
        }
    }

    fn get_children(
        &self,
        window_id: &str,
    ) -> std::result::Result<WindowListResponse, HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::GetChildren {
            window_id: window_id.to_string(),
            reply: reply_tx,
        })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::WindowList(response) => Ok(response),
            _ => Err(HostProtocolError::internal(
                "window get children received unrelated response",
                host_protocol::WINDOW_GET_CHILDREN_METHOD,
            )),
        }
    }

    fn show(&self, window_id: &str) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::Show {
            window_id: window_id.to_string(),
            reply: reply_tx,
        })?;

        self.expect_window_void_response(reply_rx, host_protocol::WINDOW_SHOW_METHOD)
    }

    fn hide(&self, window_id: &str) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::Hide {
            window_id: window_id.to_string(),
            reply: reply_tx,
        })?;

        self.expect_window_void_response(reply_rx, host_protocol::WINDOW_HIDE_METHOD)
    }

    fn focus(&self, window_id: &str) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::Focus {
            window_id: window_id.to_string(),
            reply: reply_tx,
        })?;

        self.expect_window_void_response(reply_rx, host_protocol::WINDOW_FOCUS_METHOD)
    }

    fn get_bounds(
        &self,
        window_id: &str,
    ) -> std::result::Result<WindowBoundsPayload, HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::GetBounds {
            window_id: window_id.to_string(),
            reply: reply_tx,
        })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::WindowBounds(bounds) => Ok(bounds),
            WindowCommandResponse::Created(_)
            | WindowCommandResponse::Destroyed
            | WindowCommandResponse::WindowUpdated
            | WindowCommandResponse::WindowLookup(_)
            | WindowCommandResponse::WindowList(_)
            | WindowCommandResponse::WindowParent(_)
            | WindowCommandResponse::WindowState(_)
            | WindowCommandResponse::DockBadgeLabelSet
            | WindowCommandResponse::DockProgressSet
            | WindowCommandResponse::DockAttentionRequested
            | WindowCommandResponse::DockMenuSet
            | WindowCommandResponse::MenuSet
            | WindowCommandResponse::TrayCreated(_)
            | WindowCommandResponse::TrayUpdated
            | WindowCommandResponse::TrayDestroyed
            | WindowCommandResponse::ScreenDisplays(_)
            | WindowCommandResponse::ScreenDisplay(_)
            | WindowCommandResponse::ScreenPoint(_)
            | WindowCommandResponse::ScreenSupported(_) => Err(HostProtocolError::internal(
                "window get bounds received unrelated response",
                host_protocol::WINDOW_GET_BOUNDS_METHOD,
            )),
        }
    }

    fn set_bounds(
        &self,
        window_id: &str,
        bounds: &WindowBoundsPayload,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::SetBounds {
            window_id: window_id.to_string(),
            bounds: bounds.clone(),
            reply: reply_tx,
        })?;

        self.expect_window_void_response(reply_rx, host_protocol::WINDOW_SET_BOUNDS_METHOD)
    }

    fn center(&self, window_id: &str) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::Center {
            window_id: window_id.to_string(),
            reply: reply_tx,
        })?;

        self.expect_window_void_response(reply_rx, host_protocol::WINDOW_CENTER_METHOD)
    }

    fn center_on_display(
        &self,
        window_id: &str,
        display_id: &str,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::CenterOnDisplay {
            window_id: window_id.to_string(),
            display_id: display_id.to_string(),
            reply: reply_tx,
        })?;

        self.expect_window_void_response(reply_rx, host_protocol::WINDOW_CENTER_ON_DISPLAY_METHOD)
    }

    fn set_title(
        &self,
        window_id: &str,
        title: &str,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::SetTitle {
            window_id: window_id.to_string(),
            title: title.to_string(),
            reply: reply_tx,
        })?;

        self.expect_window_void_response(reply_rx, host_protocol::WINDOW_SET_TITLE_METHOD)
    }

    fn set_resizable(
        &self,
        window_id: &str,
        resizable: bool,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::SetResizable {
            window_id: window_id.to_string(),
            resizable,
            reply: reply_tx,
        })?;

        self.expect_window_void_response(reply_rx, host_protocol::WINDOW_SET_RESIZABLE_METHOD)
    }

    fn set_decorations(
        &self,
        window_id: &str,
        decorations: bool,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::SetDecorations {
            window_id: window_id.to_string(),
            decorations,
            reply: reply_tx,
        })?;

        self.expect_window_void_response(reply_rx, host_protocol::WINDOW_SET_DECORATIONS_METHOD)
    }

    fn set_traffic_lights(
        &self,
        window_id: &str,
        traffic_lights: &WindowTrafficLights,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::SetTrafficLights {
            window_id: window_id.to_string(),
            traffic_lights: traffic_lights.clone(),
            reply: reply_tx,
        })?;

        self.expect_window_void_response(reply_rx, host_protocol::WINDOW_SET_TRAFFIC_LIGHTS_METHOD)
    }

    fn set_vibrancy(
        &self,
        window_id: &str,
        material: &str,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::SetVibrancy {
            window_id: window_id.to_string(),
            material: material.to_string(),
            reply: reply_tx,
        })?;

        self.expect_window_void_response(reply_rx, host_protocol::WINDOW_SET_VIBRANCY_METHOD)
    }

    fn set_shadow(
        &self,
        window_id: &str,
        has_shadow: bool,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::SetShadow {
            window_id: window_id.to_string(),
            has_shadow,
            reply: reply_tx,
        })?;

        self.expect_window_void_response(reply_rx, host_protocol::WINDOW_SET_SHADOW_METHOD)
    }

    fn set_always_on_top(
        &self,
        window_id: &str,
        always_on_top: bool,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::SetAlwaysOnTop {
            window_id: window_id.to_string(),
            always_on_top,
            reply: reply_tx,
        })?;

        self.expect_window_void_response(reply_rx, host_protocol::WINDOW_SET_ALWAYS_ON_TOP_METHOD)
    }

    fn set_skip_taskbar(
        &self,
        window_id: &str,
        skip_taskbar: bool,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::SetSkipTaskbar {
            window_id: window_id.to_string(),
            skip_taskbar,
            reply: reply_tx,
        })?;

        self.expect_window_void_response(reply_rx, host_protocol::WINDOW_SET_SKIP_TASKBAR_METHOD)
    }

    fn set_progress(
        &self,
        window_id: &str,
        progress: &WindowSetProgressPayload,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::SetProgress {
            window_id: window_id.to_string(),
            progress: progress.clone(),
            reply: reply_tx,
        })?;

        self.expect_window_void_response(reply_rx, host_protocol::WINDOW_SET_PROGRESS_METHOD)
    }

    fn request_attention(
        &self,
        window_id: &str,
        request_type: WindowAttentionType,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::RequestAttention {
            window_id: window_id.to_string(),
            request_type,
            reply: reply_tx,
        })?;

        self.expect_window_void_response(reply_rx, host_protocol::WINDOW_REQUEST_ATTENTION_METHOD)
    }

    fn cancel_attention(&self, window_id: &str) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::CancelAttention {
            window_id: window_id.to_string(),
            reply: reply_tx,
        })?;

        self.expect_window_void_response(reply_rx, host_protocol::WINDOW_CANCEL_ATTENTION_METHOD)
    }

    fn minimize(&self, window_id: &str) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::Minimize {
            window_id: window_id.to_string(),
            reply: reply_tx,
        })?;

        self.expect_window_void_response(reply_rx, host_protocol::WINDOW_MINIMIZE_METHOD)
    }

    fn maximize(&self, window_id: &str) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::Maximize {
            window_id: window_id.to_string(),
            reply: reply_tx,
        })?;

        self.expect_window_void_response(reply_rx, host_protocol::WINDOW_MAXIMIZE_METHOD)
    }

    fn restore(&self, window_id: &str) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::Restore {
            window_id: window_id.to_string(),
            reply: reply_tx,
        })?;

        self.expect_window_void_response(reply_rx, host_protocol::WINDOW_RESTORE_METHOD)
    }

    fn set_fullscreen(
        &self,
        window_id: &str,
        fullscreen: bool,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::SetFullscreen {
            window_id: window_id.to_string(),
            fullscreen,
            reply: reply_tx,
        })?;

        self.expect_window_void_response(reply_rx, host_protocol::WINDOW_SET_FULLSCREEN_METHOD)
    }

    fn set_simple_fullscreen(
        &self,
        window_id: &str,
        simple_fullscreen: bool,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::SetSimpleFullscreen {
            window_id: window_id.to_string(),
            simple_fullscreen,
            reply: reply_tx,
        })?;

        self.expect_window_void_response(
            reply_rx,
            host_protocol::WINDOW_SET_SIMPLE_FULLSCREEN_METHOD,
        )
    }

    fn get_state(
        &self,
        window_id: &str,
    ) -> std::result::Result<WindowStatePayload, HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::GetState {
            window_id: window_id.to_string(),
            reply: reply_tx,
        })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::WindowState(state) => Ok(state),
            WindowCommandResponse::Created(_)
            | WindowCommandResponse::Destroyed
            | WindowCommandResponse::WindowUpdated
            | WindowCommandResponse::WindowLookup(_)
            | WindowCommandResponse::WindowList(_)
            | WindowCommandResponse::WindowParent(_)
            | WindowCommandResponse::WindowBounds(_)
            | WindowCommandResponse::DockBadgeLabelSet
            | WindowCommandResponse::DockProgressSet
            | WindowCommandResponse::DockAttentionRequested
            | WindowCommandResponse::DockMenuSet
            | WindowCommandResponse::MenuSet
            | WindowCommandResponse::TrayCreated(_)
            | WindowCommandResponse::TrayUpdated
            | WindowCommandResponse::TrayDestroyed
            | WindowCommandResponse::ScreenDisplays(_)
            | WindowCommandResponse::ScreenDisplay(_)
            | WindowCommandResponse::ScreenPoint(_)
            | WindowCommandResponse::ScreenSupported(_) => Err(HostProtocolError::internal(
                "window get state received unrelated response",
                host_protocol::WINDOW_GET_STATE_METHOD,
            )),
        }
    }

    fn set_dock_badge_label(
        &self,
        label: Option<String>,
        operation: &'static str,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::SetDockBadgeLabel {
            label,
            operation,
            reply: reply_tx,
        })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::DockBadgeLabelSet => Ok(()),
            WindowCommandResponse::Created(_)
            | WindowCommandResponse::Destroyed
            | WindowCommandResponse::WindowUpdated
            | WindowCommandResponse::WindowLookup(_)
            | WindowCommandResponse::WindowList(_)
            | WindowCommandResponse::WindowParent(_)
            | WindowCommandResponse::WindowBounds(_)
            | WindowCommandResponse::WindowState(_)
            | WindowCommandResponse::DockAttentionRequested
            | WindowCommandResponse::DockProgressSet
            | WindowCommandResponse::DockMenuSet
            | WindowCommandResponse::MenuSet
            | WindowCommandResponse::TrayCreated(_)
            | WindowCommandResponse::TrayUpdated
            | WindowCommandResponse::TrayDestroyed
            | WindowCommandResponse::ScreenDisplays(_)
            | WindowCommandResponse::ScreenDisplay(_)
            | WindowCommandResponse::ScreenPoint(_)
            | WindowCommandResponse::ScreenSupported(_) => Err(HostProtocolError::internal(
                "dock badge command received window response",
                operation,
            )),
        }
    }

    fn set_dock_progress(
        &self,
        progress: &DockSetProgressPayload,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::SetDockProgress {
            progress: progress.clone(),
            reply: reply_tx,
        })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::DockProgressSet => Ok(()),
            WindowCommandResponse::Created(_)
            | WindowCommandResponse::Destroyed
            | WindowCommandResponse::WindowUpdated
            | WindowCommandResponse::WindowLookup(_)
            | WindowCommandResponse::WindowList(_)
            | WindowCommandResponse::WindowParent(_)
            | WindowCommandResponse::WindowBounds(_)
            | WindowCommandResponse::WindowState(_)
            | WindowCommandResponse::DockBadgeLabelSet
            | WindowCommandResponse::DockAttentionRequested
            | WindowCommandResponse::DockMenuSet
            | WindowCommandResponse::MenuSet
            | WindowCommandResponse::TrayCreated(_)
            | WindowCommandResponse::TrayUpdated
            | WindowCommandResponse::TrayDestroyed
            | WindowCommandResponse::ScreenDisplays(_)
            | WindowCommandResponse::ScreenDisplay(_)
            | WindowCommandResponse::ScreenPoint(_)
            | WindowCommandResponse::ScreenSupported(_) => Err(HostProtocolError::internal(
                "dock set progress received unrelated response",
                host_protocol::DOCK_SET_PROGRESS_METHOD,
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
            | WindowCommandResponse::WindowUpdated
            | WindowCommandResponse::WindowLookup(_)
            | WindowCommandResponse::WindowList(_)
            | WindowCommandResponse::WindowParent(_)
            | WindowCommandResponse::WindowBounds(_)
            | WindowCommandResponse::WindowState(_)
            | WindowCommandResponse::DockBadgeLabelSet
            | WindowCommandResponse::DockProgressSet
            | WindowCommandResponse::DockMenuSet
            | WindowCommandResponse::MenuSet
            | WindowCommandResponse::TrayCreated(_)
            | WindowCommandResponse::TrayUpdated
            | WindowCommandResponse::TrayDestroyed
            | WindowCommandResponse::ScreenDisplays(_)
            | WindowCommandResponse::ScreenDisplay(_)
            | WindowCommandResponse::ScreenPoint(_)
            | WindowCommandResponse::ScreenSupported(_) => Err(HostProtocolError::internal(
                "dock attention command received window response",
                host_protocol::DOCK_REQUEST_ATTENTION_METHOD,
            )),
        }
    }

    fn set_dock_menu(
        &self,
        template: Option<serde_json::Value>,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::SetDockMenu {
            template,
            reply: reply_tx,
        })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::DockMenuSet => Ok(()),
            WindowCommandResponse::Created(_)
            | WindowCommandResponse::Destroyed
            | WindowCommandResponse::WindowUpdated
            | WindowCommandResponse::WindowLookup(_)
            | WindowCommandResponse::WindowList(_)
            | WindowCommandResponse::WindowParent(_)
            | WindowCommandResponse::WindowBounds(_)
            | WindowCommandResponse::WindowState(_)
            | WindowCommandResponse::DockBadgeLabelSet
            | WindowCommandResponse::DockProgressSet
            | WindowCommandResponse::DockAttentionRequested
            | WindowCommandResponse::MenuSet
            | WindowCommandResponse::TrayCreated(_)
            | WindowCommandResponse::TrayUpdated
            | WindowCommandResponse::TrayDestroyed
            | WindowCommandResponse::ScreenDisplays(_)
            | WindowCommandResponse::ScreenDisplay(_)
            | WindowCommandResponse::ScreenPoint(_)
            | WindowCommandResponse::ScreenSupported(_) => Err(HostProtocolError::internal(
                "dock menu command received window response",
                host_protocol::DOCK_SET_MENU_METHOD,
            )),
        }
    }

    fn set_application_menu(
        &self,
        template: serde_json::Value,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::SetApplicationMenu {
            template,
            reply: reply_tx,
        })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::MenuSet => Ok(()),
            WindowCommandResponse::Created(_)
            | WindowCommandResponse::Destroyed
            | WindowCommandResponse::WindowUpdated
            | WindowCommandResponse::WindowLookup(_)
            | WindowCommandResponse::WindowList(_)
            | WindowCommandResponse::WindowParent(_)
            | WindowCommandResponse::WindowBounds(_)
            | WindowCommandResponse::WindowState(_)
            | WindowCommandResponse::DockBadgeLabelSet
            | WindowCommandResponse::DockProgressSet
            | WindowCommandResponse::DockMenuSet
            | WindowCommandResponse::DockAttentionRequested
            | WindowCommandResponse::TrayCreated(_)
            | WindowCommandResponse::TrayUpdated
            | WindowCommandResponse::TrayDestroyed
            | WindowCommandResponse::ScreenDisplays(_)
            | WindowCommandResponse::ScreenDisplay(_)
            | WindowCommandResponse::ScreenPoint(_)
            | WindowCommandResponse::ScreenSupported(_) => Err(HostProtocolError::internal(
                "application menu command received window response",
                host_protocol::MENU_SET_APPLICATION_MENU_METHOD,
            )),
        }
    }

    fn set_window_menu(
        &self,
        window_id: &str,
        template: serde_json::Value,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::SetWindowMenu {
            window_id: window_id.to_string(),
            template,
            reply: reply_tx,
        })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::MenuSet => Ok(()),
            WindowCommandResponse::Created(_)
            | WindowCommandResponse::Destroyed
            | WindowCommandResponse::WindowUpdated
            | WindowCommandResponse::WindowLookup(_)
            | WindowCommandResponse::WindowList(_)
            | WindowCommandResponse::WindowParent(_)
            | WindowCommandResponse::WindowBounds(_)
            | WindowCommandResponse::WindowState(_)
            | WindowCommandResponse::DockBadgeLabelSet
            | WindowCommandResponse::DockProgressSet
            | WindowCommandResponse::DockMenuSet
            | WindowCommandResponse::DockAttentionRequested
            | WindowCommandResponse::TrayCreated(_)
            | WindowCommandResponse::TrayUpdated
            | WindowCommandResponse::TrayDestroyed
            | WindowCommandResponse::ScreenDisplays(_)
            | WindowCommandResponse::ScreenDisplay(_)
            | WindowCommandResponse::ScreenPoint(_)
            | WindowCommandResponse::ScreenSupported(_) => Err(HostProtocolError::internal(
                "window menu command received window response",
                host_protocol::MENU_SET_WINDOW_MENU_METHOD,
            )),
        }
    }

    fn create_tray(
        &self,
        request: TrayCreateRequest,
    ) -> std::result::Result<TrayResourcePayload, HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::CreateTray {
            request,
            reply: reply_tx,
        })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::TrayCreated(tray) => Ok(tray),
            response => Err(unexpected_tray_response(
                response,
                host_protocol::TRAY_CREATE_METHOD,
            )),
        }
    }

    fn set_tray_icon(
        &self,
        tray: &TrayResourcePayload,
        icon: String,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::SetTrayIcon {
            tray: tray.clone(),
            icon,
            reply: reply_tx,
        })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::TrayUpdated => Ok(()),
            response => Err(unexpected_tray_response(
                response,
                host_protocol::TRAY_SET_ICON_METHOD,
            )),
        }
    }

    fn set_tray_tooltip(
        &self,
        tray: &TrayResourcePayload,
        tooltip: String,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::SetTrayTooltip {
            tray: tray.clone(),
            tooltip,
            reply: reply_tx,
        })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::TrayUpdated => Ok(()),
            response => Err(unexpected_tray_response(
                response,
                host_protocol::TRAY_SET_TOOLTIP_METHOD,
            )),
        }
    }

    fn set_tray_title(
        &self,
        tray: &TrayResourcePayload,
        title: String,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::SetTrayTitle {
            tray: tray.clone(),
            title,
            reply: reply_tx,
        })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::TrayUpdated => Ok(()),
            response => Err(unexpected_tray_response(
                response,
                host_protocol::TRAY_SET_TITLE_METHOD,
            )),
        }
    }

    fn set_tray_menu(
        &self,
        tray: &TrayResourcePayload,
        menu: serde_json::Value,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::SetTrayMenu {
            tray: tray.clone(),
            menu,
            reply: reply_tx,
        })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::TrayUpdated => Ok(()),
            response => Err(unexpected_tray_response(
                response,
                host_protocol::TRAY_SET_MENU_METHOD,
            )),
        }
    }

    fn destroy_tray(
        &self,
        tray: &TrayResourcePayload,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::DestroyTray {
            tray: tray.clone(),
            reply: reply_tx,
        })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::TrayDestroyed => Ok(()),
            response => Err(unexpected_tray_response(
                response,
                host_protocol::TRAY_DESTROY_METHOD,
            )),
        }
    }

    fn clear_runtime_trays(&self) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::ClearRuntimeTrays { reply: reply_tx })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::TrayDestroyed => Ok(()),
            response => Err(unexpected_tray_response(
                response,
                "host.runtime.tray.disconnect",
            )),
        }
    }

    fn get_screen_displays(
        &self,
    ) -> std::result::Result<ScreenDisplaysResultPayload, HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::GetScreenDisplays { reply: reply_tx })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::ScreenDisplays(displays) => Ok(displays),
            response => Err(unexpected_screen_response(
                response,
                host_protocol::SCREEN_GET_DISPLAYS_METHOD,
            )),
        }
    }

    fn get_primary_screen_display(
        &self,
    ) -> std::result::Result<ScreenDisplayPayload, HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::GetPrimaryScreenDisplay { reply: reply_tx })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::ScreenDisplay(display) => Ok(display),
            response => Err(unexpected_screen_response(
                response,
                host_protocol::SCREEN_GET_PRIMARY_DISPLAY_METHOD,
            )),
        }
    }

    fn get_screen_pointer_point(
        &self,
    ) -> std::result::Result<ScreenPointPayload, HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::GetScreenPointerPoint { reply: reply_tx })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::ScreenPoint(point) => Ok(point),
            response => Err(unexpected_screen_response(
                response,
                host_protocol::SCREEN_GET_POINTER_POINT_METHOD,
            )),
        }
    }

    fn screen_is_supported(
        &self,
        method: ScreenMethodPayload,
    ) -> std::result::Result<ScreenSupportedPayload, HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::ScreenIsSupported {
            method,
            reply: reply_tx,
        })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::ScreenSupported(supported) => Ok(supported),
            response => Err(unexpected_screen_response(
                response,
                host_protocol::SCREEN_IS_SUPPORTED_METHOD,
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
            parent_window_id: None,
            macos_polish: None,
        })
    }

    fn with_parent_window_id(mut self, parent_window_id: Option<String>) -> Self {
        self.parent_window_id = parent_window_id;
        self
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

    pub(crate) fn parent_window_id(&self) -> Option<&str> {
        self.parent_window_id.as_deref()
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
        if payload.parent_window_id().is_some_and(str::is_empty) {
            return Err(HostProtocolError::invalid_argument(
                "parentWindowId",
                "must be non-empty",
                host_protocol::WINDOW_CREATE_METHOD,
            ));
        }
        let macos_polish = macos::MacosWindowPolish::new(
            payload.title_bar_style(),
            payload.vibrancy(),
            payload.traffic_lights(),
        )?;

        Ok(request
            .with_parent_window_id(payload.parent_window_id().map(str::to_string))
            .with_macos_polish(macos_polish))
    }
}

impl TrayCreateRequest {
    pub(crate) fn new(
        icon: String,
        tooltip: Option<String>,
        title: Option<String>,
        menu: Option<serde_json::Value>,
        event_sender: Option<Sender<HostProtocolEnvelope>>,
    ) -> Self {
        Self {
            icon,
            tooltip,
            title,
            menu,
            event_sender,
        }
    }

    fn icon(&self) -> &str {
        &self.icon
    }

    fn tooltip(&self) -> Option<&str> {
        self.tooltip.as_deref()
    }

    fn title(&self) -> Option<&str> {
        self.title.as_deref()
    }

    fn menu(&self) -> Option<&serde_json::Value> {
        self.menu.as_ref()
    }

    fn event_sender(&self) -> Option<Sender<HostProtocolEnvelope>> {
        self.event_sender.clone()
    }
}

impl WindowRegistry {
    fn new() -> Self {
        Self {
            windows: HashMap::new(),
            window_states: HashMap::new(),
            window_id_by_native_id: HashMap::new(),
            window_order: Vec::new(),
            focused_window_id: None,
            child_window_ids_by_parent_id: HashMap::new(),
            parent_window_id_by_child_id: HashMap::new(),
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            trays: HashMap::new(),
        }
    }

    fn create(
        &mut self,
        target: &EventLoopWindowTarget<HostEvent>,
        request: WindowCreateRequest,
        mode: RunMode,
    ) -> std::result::Result<WindowCreateResponse, HostProtocolError> {
        let window_id = Uuid::now_v7().to_string();
        let mut builder = WindowBuilder::new()
            .with_title(request.title())
            .with_inner_size(LogicalSize::new(request.width(), request.height()));
        let parent_window_id = request.parent_window_id().map(str::to_string);
        if let Some(parent_window_id) = parent_window_id.as_deref() {
            let Some(parent) = self.windows.get(parent_window_id) else {
                return Err(HostProtocolError::not_found(
                    format!("Window:{parent_window_id}"),
                    host_protocol::WINDOW_CREATE_METHOD,
                ));
            };
            builder = apply_window_parent(builder, &parent._window)?;
        }
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

        let initial_state = tao_window_state(&window);
        let webview = webview::attach_app_webview(&window).map_err(|error| *error)?;
        let native_window_id = window.id();
        self.windows.insert(
            window_id.clone(),
            NativeWindowResources {
                _window: window,
                _webview: webview,
            },
        );
        self.window_states.insert(window_id.clone(), initial_state);
        self.track_window_opened(&window_id, native_window_id);
        if let Some(parent_window_id) = parent_window_id {
            self.child_window_ids_by_parent_id
                .entry(parent_window_id.clone())
                .or_default()
                .insert(window_id.clone());
            self.parent_window_id_by_child_id
                .insert(window_id.clone(), parent_window_id);
        }
        if let Err(error) = emit_window_registry_event(&window_id, WindowRegistryEventPhase::Opened)
        {
            warn!(
                event = "host.window.event_emit_failed",
                error = ?error,
                window_id,
                "failed to emit window opened event"
            );
        }

        Ok(WindowCreateResponse::new(window_id))
    }

    fn destroy(&mut self, window_id: &str) -> std::result::Result<(), HostProtocolError> {
        if !self.windows.contains_key(window_id) {
            return Err(HostProtocolError::not_found(
                format!("Window:{window_id}"),
                host_protocol::WINDOW_DESTROY_METHOD,
            ));
        }

        for destroyed_window_id in self.remove_window_tree(window_id) {
            info!(
                event = WINDOW_DESTROYED_EVENT,
                window_id = destroyed_window_id,
                "host window destroyed"
            );
            if let Err(error) =
                emit_window_registry_event(&destroyed_window_id, WindowRegistryEventPhase::Closed)
            {
                warn!(
                    event = "host.window.event_emit_failed",
                    error = ?error,
                    window_id = destroyed_window_id,
                    "failed to emit window closed event"
                );
            }
        }
        if let Some(focused_window_id) = self.select_fallback_focus() {
            self.emit_focused_window_event(&focused_window_id);
        }
        Ok(())
    }

    fn track_window_opened(&mut self, window_id: &str, native_window_id: WindowId) {
        self.window_id_by_native_id
            .insert(native_window_id, window_id.to_string());
        self.window_order.push(window_id.to_string());
        if self.focused_window_id.is_none() {
            self.focused_window_id = Some(window_id.to_string());
        }
    }

    fn track_window_focused(&mut self, window_id: &str) {
        self.focused_window_id = Some(window_id.to_string());
    }

    fn forget_window_id(&mut self, window_id: &str) {
        self.window_order
            .retain(|open_window_id| open_window_id != window_id);
        if self.focused_window_id.as_deref() == Some(window_id) {
            self.focused_window_id = None;
        }
    }

    fn select_fallback_focus(&mut self) -> Option<String> {
        if self
            .focused_window_id
            .as_ref()
            .is_some_and(|window_id| self.windows.contains_key(window_id))
        {
            return None;
        }
        self.focused_window_id = self
            .window_order
            .iter()
            .find(|window_id| self.windows.contains_key(window_id.as_str()))
            .cloned();
        self.focused_window_id.clone()
    }

    fn remove_window_tree(&mut self, window_id: &str) -> Vec<String> {
        let mut child_window_ids = self
            .child_window_ids_by_parent_id
            .remove(window_id)
            .map(|children| children.into_iter().collect::<Vec<_>>())
            .unwrap_or_default();
        child_window_ids.sort();

        let mut destroyed_window_ids = Vec::new();
        for child_window_id in child_window_ids {
            destroyed_window_ids.extend(self.remove_window_tree(&child_window_id));
        }

        if let Some(resources) = self.windows.remove(window_id) {
            self.window_id_by_native_id.remove(&resources._window.id());
        }
        self.window_states.remove(window_id);
        self.forget_window_id(window_id);
        if let Some(parent_window_id) = self.parent_window_id_by_child_id.remove(window_id) {
            if let Some(siblings) = self
                .child_window_ids_by_parent_id
                .get_mut(&parent_window_id)
            {
                siblings.remove(window_id);
                if siblings.is_empty() {
                    self.child_window_ids_by_parent_id.remove(&parent_window_id);
                }
            }
        }
        destroyed_window_ids.push(window_id.to_string());
        destroyed_window_ids
    }

    fn show(&self, window_id: &str) -> std::result::Result<(), HostProtocolError> {
        self.set_visible(
            window_id,
            true,
            WindowRegistryEventPhase::Shown,
            host_protocol::WINDOW_SHOW_METHOD,
        )
    }

    fn hide(&self, window_id: &str) -> std::result::Result<(), HostProtocolError> {
        self.set_visible(
            window_id,
            false,
            WindowRegistryEventPhase::Hidden,
            host_protocol::WINDOW_HIDE_METHOD,
        )
    }

    fn focus(&mut self, window_id: &str) -> std::result::Result<(), HostProtocolError> {
        let Some(resources) = self.windows.get(window_id) else {
            return Err(HostProtocolError::not_found(
                format!("Window:{window_id}"),
                host_protocol::WINDOW_FOCUS_METHOD,
            ));
        };

        resources._window.set_focus();
        self.track_window_focused(window_id);
        Ok(())
    }

    fn track_native_window_focused(&mut self, native_window_id: WindowId) {
        let Some(window_id) = self.window_id_by_native_id.get(&native_window_id).cloned() else {
            return;
        };
        if self.windows.contains_key(&window_id) {
            self.track_window_focused(&window_id);
            if let Err(error) =
                emit_window_registry_event(&window_id, WindowRegistryEventPhase::Focused)
            {
                warn!(
                    event = "host.window.event_emit_failed",
                    error = ?error,
                    window_id,
                    "failed to emit native window focused event"
                );
            }
        }
    }

    fn native_window_close_requested(&mut self, native_window_id: WindowId) {
        let Some(window_id) = self.window_id_by_native_id.get(&native_window_id).cloned() else {
            return;
        };
        self.window_id_by_native_id.remove(&native_window_id);
        for destroyed_window_id in self.remove_window_tree(&window_id) {
            info!(
                event = WINDOW_DESTROYED_EVENT,
                window_id = destroyed_window_id,
                source = "close-requested",
                "host window destroyed"
            );
            if let Err(error) =
                emit_window_registry_event(&destroyed_window_id, WindowRegistryEventPhase::Closed)
            {
                warn!(
                    event = "host.window.event_emit_failed",
                    error = ?error,
                    window_id = destroyed_window_id,
                    "failed to emit native window closed event"
                );
            }
        }
        if let Some(focused_window_id) = self.select_fallback_focus() {
            self.emit_focused_window_event(&focused_window_id);
        }
    }

    #[cfg_attr(test, allow(dead_code))]
    fn native_window_close_requested_to_background(&mut self, native_window_id: WindowId) {
        let Some(window_id) = self.window_id_by_native_id.get(&native_window_id).cloned() else {
            return;
        };
        if let Err(error) = self.hide(&window_id) {
            warn!(
                event = "host.window.background_hide_failed",
                error = ?error,
                window_id,
                "failed to hide window for resident lifecycle close request"
            );
        }
    }

    fn emit_focused_window_event(&self, window_id: &str) {
        if let Err(error) = emit_window_registry_event(window_id, WindowRegistryEventPhase::Focused)
        {
            warn!(
                event = "host.window.event_emit_failed",
                error = ?error,
                window_id,
                "failed to emit fallback window focused event"
            );
        }
    }

    fn get_current(&self) -> std::result::Result<WindowLookupResponse, HostProtocolError> {
        let Some(window_id) = self.focused_window_id.as_deref() else {
            return Err(HostProtocolError::not_found(
                "Window:current",
                host_protocol::WINDOW_GET_CURRENT_METHOD,
            ));
        };
        self.get_by_id_with_operation(window_id, host_protocol::WINDOW_GET_CURRENT_METHOD)
    }

    fn get_by_id(
        &self,
        window_id: &str,
    ) -> std::result::Result<WindowLookupResponse, HostProtocolError> {
        self.get_by_id_with_operation(window_id, host_protocol::WINDOW_GET_BY_ID_METHOD)
    }

    fn list(&self) -> std::result::Result<WindowListResponse, HostProtocolError> {
        Ok(WindowListResponse::new(
            self.window_order
                .iter()
                .filter(|window_id| self.windows.contains_key(window_id.as_str()))
                .map(WindowLookupResponse::new)
                .collect(),
        ))
    }

    fn get_parent(
        &self,
        window_id: &str,
    ) -> std::result::Result<WindowParentResponse, HostProtocolError> {
        if !self.windows.contains_key(window_id) {
            return Err(HostProtocolError::not_found(
                format!("Window:{window_id}"),
                host_protocol::WINDOW_GET_PARENT_METHOD,
            ));
        }
        Ok(WindowParentResponse::new(
            self.parent_window_id_by_child_id.get(window_id).cloned(),
        ))
    }

    fn get_children(
        &self,
        window_id: &str,
    ) -> std::result::Result<WindowListResponse, HostProtocolError> {
        if !self.windows.contains_key(window_id) {
            return Err(HostProtocolError::not_found(
                format!("Window:{window_id}"),
                host_protocol::WINDOW_GET_CHILDREN_METHOD,
            ));
        }
        let mut child_window_ids = self
            .child_window_ids_by_parent_id
            .get(window_id)
            .map(|children| children.iter().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        child_window_ids.sort();
        Ok(WindowListResponse::new(
            child_window_ids
                .into_iter()
                .filter(|child_window_id| self.windows.contains_key(child_window_id.as_str()))
                .map(WindowLookupResponse::new)
                .collect(),
        ))
    }

    fn get_by_id_with_operation(
        &self,
        window_id: &str,
        operation: &'static str,
    ) -> std::result::Result<WindowLookupResponse, HostProtocolError> {
        if !self.windows.contains_key(window_id) {
            return Err(HostProtocolError::not_found(
                format!("Window:{window_id}"),
                operation,
            ));
        }
        Ok(WindowLookupResponse::new(window_id))
    }

    fn get_bounds(
        &self,
        window_id: &str,
    ) -> std::result::Result<WindowBoundsPayload, HostProtocolError> {
        let Some(resources) = self.windows.get(window_id) else {
            return Err(HostProtocolError::not_found(
                format!("Window:{window_id}"),
                host_protocol::WINDOW_GET_BOUNDS_METHOD,
            ));
        };
        window_bounds(&resources._window, host_protocol::WINDOW_GET_BOUNDS_METHOD)
    }

    fn set_bounds(
        &self,
        window_id: &str,
        bounds: &WindowBoundsPayload,
    ) -> std::result::Result<(), HostProtocolError> {
        let Some(resources) = self.windows.get(window_id) else {
            return Err(HostProtocolError::not_found(
                format!("Window:{window_id}"),
                host_protocol::WINDOW_SET_BOUNDS_METHOD,
            ));
        };

        resources
            ._window
            .set_outer_position(LogicalPosition::new(bounds.x(), bounds.y()));
        resources
            ._window
            .set_inner_size(LogicalSize::new(bounds.width(), bounds.height()));
        Ok(())
    }

    fn center(&self, window_id: &str) -> std::result::Result<(), HostProtocolError> {
        let Some(resources) = self.windows.get(window_id) else {
            return Err(HostProtocolError::not_found(
                format!("Window:{window_id}"),
                host_protocol::WINDOW_CENTER_METHOD,
            ));
        };
        let Some(monitor) = resources._window.current_monitor() else {
            return Err(HostProtocolError::unsupported(
                "window monitor unavailable",
                host_protocol::WINDOW_CENTER_METHOD,
            ));
        };
        let bounds = centered_window_bounds(&resources._window, &monitor)?;
        resources
            ._window
            .set_outer_position(LogicalPosition::new(bounds.x(), bounds.y()));
        Ok(())
    }

    fn center_on_display(
        &self,
        window_id: &str,
        display_id: &str,
    ) -> std::result::Result<(), HostProtocolError> {
        let Some(resources) = self.windows.get(window_id) else {
            return Err(HostProtocolError::not_found(
                format!("Window:{window_id}"),
                host_protocol::WINDOW_CENTER_ON_DISPLAY_METHOD,
            ));
        };
        let Some(monitor) = resources
            ._window
            .available_monitors()
            .find(|monitor| screen_display_id(monitor) == display_id)
        else {
            return Err(HostProtocolError::not_found(
                format!("ScreenDisplay:{display_id}"),
                host_protocol::WINDOW_CENTER_ON_DISPLAY_METHOD,
            ));
        };
        let position = centered_window_physical_position_for_operation(
            &resources._window,
            &monitor,
            host_protocol::WINDOW_CENTER_ON_DISPLAY_METHOD,
        )?;
        resources._window.set_outer_position(position);
        Ok(())
    }

    fn set_title(
        &self,
        window_id: &str,
        title: &str,
    ) -> std::result::Result<(), HostProtocolError> {
        let Some(resources) = self.windows.get(window_id) else {
            return Err(HostProtocolError::not_found(
                format!("Window:{window_id}"),
                host_protocol::WINDOW_SET_TITLE_METHOD,
            ));
        };

        resources._window.set_title(title);
        Ok(())
    }

    fn set_resizable(
        &self,
        window_id: &str,
        resizable: bool,
    ) -> std::result::Result<(), HostProtocolError> {
        let Some(resources) = self.windows.get(window_id) else {
            return Err(HostProtocolError::not_found(
                format!("Window:{window_id}"),
                host_protocol::WINDOW_SET_RESIZABLE_METHOD,
            ));
        };

        resources._window.set_resizable(resizable);
        Ok(())
    }

    fn set_decorations(
        &self,
        window_id: &str,
        decorations: bool,
    ) -> std::result::Result<(), HostProtocolError> {
        let Some(resources) = self.windows.get(window_id) else {
            return Err(HostProtocolError::not_found(
                format!("Window:{window_id}"),
                host_protocol::WINDOW_SET_DECORATIONS_METHOD,
            ));
        };

        resources._window.set_decorations(decorations);
        Ok(())
    }

    fn set_traffic_lights(
        &self,
        window_id: &str,
        traffic_lights: &WindowTrafficLights,
    ) -> std::result::Result<(), HostProtocolError> {
        let Some(resources) = self.windows.get(window_id) else {
            return Err(HostProtocolError::not_found(
                format!("Window:{window_id}"),
                host_protocol::WINDOW_SET_TRAFFIC_LIGHTS_METHOD,
            ));
        };

        macos::set_traffic_lights(&resources._window, traffic_lights)
    }

    fn set_vibrancy(
        &self,
        window_id: &str,
        material: &str,
    ) -> std::result::Result<(), HostProtocolError> {
        let Some(resources) = self.windows.get(window_id) else {
            return Err(HostProtocolError::not_found(
                format!("Window:{window_id}"),
                host_protocol::WINDOW_SET_VIBRANCY_METHOD,
            ));
        };

        macos::set_vibrancy(&resources._window, material)
    }

    fn set_shadow(
        &self,
        window_id: &str,
        has_shadow: bool,
    ) -> std::result::Result<(), HostProtocolError> {
        let Some(resources) = self.windows.get(window_id) else {
            return Err(HostProtocolError::not_found(
                format!("Window:{window_id}"),
                host_protocol::WINDOW_SET_SHADOW_METHOD,
            ));
        };

        macos::set_shadow(&resources._window, has_shadow)
    }

    fn set_always_on_top(
        &self,
        window_id: &str,
        always_on_top: bool,
    ) -> std::result::Result<(), HostProtocolError> {
        let Some(resources) = self.windows.get(window_id) else {
            return Err(HostProtocolError::not_found(
                format!("Window:{window_id}"),
                host_protocol::WINDOW_SET_ALWAYS_ON_TOP_METHOD,
            ));
        };

        resources._window.set_always_on_top(always_on_top);
        Ok(())
    }

    fn set_skip_taskbar(
        &self,
        window_id: &str,
        skip_taskbar: bool,
    ) -> std::result::Result<(), HostProtocolError> {
        let Some(resources) = self.windows.get(window_id) else {
            return Err(HostProtocolError::not_found(
                format!("Window:{window_id}"),
                host_protocol::WINDOW_SET_SKIP_TASKBAR_METHOD,
            ));
        };

        set_skip_taskbar(&resources._window, skip_taskbar)
    }

    fn set_progress(
        &self,
        window_id: &str,
        progress: &WindowSetProgressPayload,
    ) -> std::result::Result<(), HostProtocolError> {
        let Some(resources) = self.windows.get(window_id) else {
            return Err(HostProtocolError::not_found(
                format!("Window:{window_id}"),
                host_protocol::WINDOW_SET_PROGRESS_METHOD,
            ));
        };

        resources._window.set_progress_bar(ProgressBarState {
            state: progress.state().map(to_tao_progress_state),
            progress: progress.progress(),
            desktop_filename: progress.desktop_filename().map(str::to_string),
        });
        Ok(())
    }

    fn request_attention(
        &self,
        window_id: &str,
        request_type: WindowAttentionType,
    ) -> std::result::Result<(), HostProtocolError> {
        let Some(resources) = self.windows.get(window_id) else {
            return Err(HostProtocolError::not_found(
                format!("Window:{window_id}"),
                host_protocol::WINDOW_REQUEST_ATTENTION_METHOD,
            ));
        };

        resources
            ._window
            .request_user_attention(Some(to_tao_attention_type(request_type)));
        Ok(())
    }

    fn cancel_attention(&self, window_id: &str) -> std::result::Result<(), HostProtocolError> {
        let Some(resources) = self.windows.get(window_id) else {
            return Err(HostProtocolError::not_found(
                format!("Window:{window_id}"),
                host_protocol::WINDOW_CANCEL_ATTENTION_METHOD,
            ));
        };

        resources._window.request_user_attention(None);
        Ok(())
    }

    fn minimize(&mut self, window_id: &str) -> std::result::Result<(), HostProtocolError> {
        let Some(resources) = self.windows.get(window_id) else {
            return Err(HostProtocolError::not_found(
                format!("Window:{window_id}"),
                host_protocol::WINDOW_MINIMIZE_METHOD,
            ));
        };

        resources._window.set_minimized(true);
        self.update_window_state(window_id, |state| {
            WindowStatePayload::new(
                true,
                state.maximized(),
                state.fullscreen(),
                state.simple_fullscreen(),
            )
        });
        Ok(())
    }

    fn maximize(&mut self, window_id: &str) -> std::result::Result<(), HostProtocolError> {
        let Some(resources) = self.windows.get(window_id) else {
            return Err(HostProtocolError::not_found(
                format!("Window:{window_id}"),
                host_protocol::WINDOW_MAXIMIZE_METHOD,
            ));
        };

        resources._window.set_maximized(true);
        self.update_window_state(window_id, |state| {
            WindowStatePayload::new(
                state.minimized(),
                true,
                state.fullscreen(),
                state.simple_fullscreen(),
            )
        });
        Ok(())
    }

    fn restore(&mut self, window_id: &str) -> std::result::Result<(), HostProtocolError> {
        let Some(resources) = self.windows.get(window_id) else {
            return Err(HostProtocolError::not_found(
                format!("Window:{window_id}"),
                host_protocol::WINDOW_RESTORE_METHOD,
            ));
        };

        resources._window.set_minimized(false);
        resources._window.set_maximized(false);
        resources._window.set_fullscreen(None);
        clear_simple_fullscreen(&resources._window)?;
        self.window_states.insert(
            window_id.to_string(),
            WindowStatePayload::new(false, false, false, false),
        );
        Ok(())
    }

    fn set_fullscreen(
        &mut self,
        window_id: &str,
        fullscreen: bool,
    ) -> std::result::Result<(), HostProtocolError> {
        let Some(resources) = self.windows.get(window_id) else {
            return Err(HostProtocolError::not_found(
                format!("Window:{window_id}"),
                host_protocol::WINDOW_SET_FULLSCREEN_METHOD,
            ));
        };

        resources._window.set_fullscreen(if fullscreen {
            Some(Fullscreen::Borderless(None))
        } else {
            None
        });
        self.update_window_state(window_id, |state| {
            WindowStatePayload::new(
                state.minimized(),
                state.maximized(),
                fullscreen,
                state.simple_fullscreen(),
            )
        });
        Ok(())
    }

    fn set_simple_fullscreen(
        &mut self,
        window_id: &str,
        simple_fullscreen: bool,
    ) -> std::result::Result<(), HostProtocolError> {
        let Some(resources) = self.windows.get(window_id) else {
            return Err(HostProtocolError::not_found(
                format!("Window:{window_id}"),
                host_protocol::WINDOW_SET_SIMPLE_FULLSCREEN_METHOD,
            ));
        };

        set_simple_fullscreen(
            &resources._window,
            simple_fullscreen,
            host_protocol::WINDOW_SET_SIMPLE_FULLSCREEN_METHOD,
        )?;
        self.update_window_state(window_id, |state| {
            WindowStatePayload::new(
                state.minimized(),
                state.maximized(),
                state.fullscreen(),
                simple_fullscreen,
            )
        });
        Ok(())
    }

    fn get_state(
        &self,
        window_id: &str,
    ) -> std::result::Result<WindowStatePayload, HostProtocolError> {
        self.window_state(window_id, host_protocol::WINDOW_GET_STATE_METHOD)
    }

    fn window_state(
        &self,
        window_id: &str,
        operation: &'static str,
    ) -> std::result::Result<WindowStatePayload, HostProtocolError> {
        if let Some(state) = self.window_states.get(window_id) {
            return Ok(state.clone());
        }

        let Some(resources) = self.windows.get(window_id) else {
            return Err(HostProtocolError::not_found(
                format!("Window:{window_id}"),
                operation,
            ));
        };

        Ok(tao_window_state(&resources._window))
    }

    fn update_window_state(
        &mut self,
        window_id: &str,
        update: impl FnOnce(&WindowStatePayload) -> WindowStatePayload,
    ) {
        let current = self
            .window_states
            .get(window_id)
            .cloned()
            .or_else(|| {
                self.windows
                    .get(window_id)
                    .map(|resources| tao_window_state(&resources._window))
            })
            .unwrap_or_else(|| WindowStatePayload::new(false, false, false, false));
        self.window_states
            .insert(window_id.to_string(), update(&current));
    }

    fn emit_window_state_snapshot(&self, window_id: &str, operation: &'static str) {
        match self.window_state(window_id, operation) {
            Ok(state) => {
                if let Err(error) = emit_window_state_event(window_id, state) {
                    warn!(
                        event = "host.window.event_emit_failed",
                        error = ?error,
                        window_id,
                        "failed to emit window state event"
                    );
                }
            }
            Err(error) => {
                warn!(
                    event = "host.window.state_event_failed",
                    error = ?error,
                    window_id,
                    "failed to read window state for event"
                );
            }
        }
    }

    fn set_visible(
        &self,
        window_id: &str,
        visible: bool,
        phase: WindowRegistryEventPhase,
        operation: &'static str,
    ) -> std::result::Result<(), HostProtocolError> {
        let Some(resources) = self.windows.get(window_id) else {
            return Err(HostProtocolError::not_found(
                format!("Window:{window_id}"),
                operation,
            ));
        };

        resources._window.set_visible(visible);
        if let Err(error) = emit_window_registry_event(window_id, phase) {
            warn!(
                event = "host.window.event_emit_failed",
                error = ?error,
                window_id,
                "failed to emit native window visibility event"
            );
        }
        Ok(())
    }

    fn set_dock_badge_label(
        &self,
        label: Option<String>,
        operation: &'static str,
    ) -> std::result::Result<(), HostProtocolError> {
        let Some(resources) = self.windows.values().next() else {
            return Err(HostProtocolError::not_found(
                "Window:firstResponder",
                operation,
            ));
        };

        macos::set_dock_badge_label(&resources._window, label)
    }

    fn set_dock_progress(
        &self,
        progress: &DockSetProgressPayload,
    ) -> std::result::Result<(), HostProtocolError> {
        let Some(resources) = self.windows.values().next() else {
            return Err(HostProtocolError::not_found(
                "Window:firstResponder",
                host_protocol::DOCK_SET_PROGRESS_METHOD,
            ));
        };

        resources
            ._window
            .set_progress_bar(to_tao_dock_progress(progress)?);
        Ok(())
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

    fn set_application_menu(
        &self,
        template: serde_json::Value,
    ) -> std::result::Result<(), HostProtocolError> {
        macos::set_application_menu(template)
    }

    fn set_dock_menu(
        &self,
        template: Option<serde_json::Value>,
    ) -> std::result::Result<(), HostProtocolError> {
        macos::set_dock_menu(template)
    }

    fn set_window_menu(
        &self,
        window_id: &str,
        template: serde_json::Value,
    ) -> std::result::Result<(), HostProtocolError> {
        if !self.windows.contains_key(window_id) {
            return Err(HostProtocolError::not_found(
                format!("Window:{window_id}"),
                host_protocol::MENU_SET_WINDOW_MENU_METHOD,
            ));
        }

        macos::set_application_menu(template)
    }

    fn create_tray(
        &mut self,
        request: TrayCreateRequest,
    ) -> std::result::Result<TrayResourcePayload, HostProtocolError> {
        #[cfg(target_os = "linux")]
        {
            let _ = request;
            return Err(unsupported_tray(host_protocol::TRAY_CREATE_METHOD));
        }

        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            let tray_id = Uuid::now_v7().to_string();
            let icon = build_tray_icon(request.icon(), host_protocol::TRAY_CREATE_METHOD)?;
            let mut builder = tray_icon::TrayIconBuilder::new()
                .with_id(tray_icon::TrayIconId::new(tray_id.clone()))
                .with_icon(icon);

            if let Some(tooltip) = request.tooltip() {
                builder = builder.with_tooltip(tooltip);
            }

            #[cfg(target_os = "macos")]
            if let Some(title) = request.title() {
                builder = builder.with_title(title);
            }

            #[cfg(target_os = "windows")]
            if request.title().is_some() {
                return Err(HostProtocolError::unsupported(
                    "tray title is unsupported on Windows",
                    host_protocol::TRAY_CREATE_METHOD,
                ));
            }

            if let Some(menu) = request.menu() {
                builder = builder.with_menu(Box::new(build_tray_menu(
                    menu,
                    host_protocol::TRAY_CREATE_METHOD,
                )?));
            }

            if let Some(sender) = request.event_sender() {
                install_tray_event_sender(sender)?;
            }

            let tray = builder.build().map_err(|error| {
                HostProtocolError::internal(
                    format!("failed to create tray icon: {error}"),
                    host_protocol::TRAY_CREATE_METHOD,
                )
            })?;
            let generation = 0;
            let owner_scope = format!("tray:{tray_id}");
            self.trays.insert(
                tray_id.clone(),
                NativeTrayResources {
                    _tray: tray,
                    generation,
                    owner_scope: owner_scope.clone(),
                },
            );

            let handle = TrayResourcePayload::new(tray_id.clone(), generation, owner_scope);
            track_tray_event_handle(&tray_id, handle.clone())?;
            Ok(handle)
        }
    }

    fn set_tray_icon(
        &mut self,
        tray: &TrayResourcePayload,
        icon: String,
    ) -> std::result::Result<(), HostProtocolError> {
        let operation = host_protocol::TRAY_SET_ICON_METHOD;
        #[cfg(target_os = "linux")]
        {
            let _ = (tray, icon);
            return Err(unsupported_tray(operation));
        }

        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            validate_tray_handle(self, tray, operation)?;
            let icon = build_tray_icon(&icon, operation)?;
            self.trays
                .get_mut(tray.id())
                .expect("validated tray exists")
                ._tray
                .set_icon(Some(icon))
                .map_err(|error| HostProtocolError::internal(error.to_string(), operation))
        }
    }

    fn set_tray_tooltip(
        &mut self,
        tray: &TrayResourcePayload,
        tooltip: String,
    ) -> std::result::Result<(), HostProtocolError> {
        let operation = host_protocol::TRAY_SET_TOOLTIP_METHOD;
        #[cfg(target_os = "linux")]
        {
            let _ = (tray, tooltip);
            return Err(unsupported_tray(operation));
        }

        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            validate_tray_handle(self, tray, operation)?;
            self.trays
                .get_mut(tray.id())
                .expect("validated tray exists")
                ._tray
                .set_tooltip(Some(tooltip))
                .map_err(|error| HostProtocolError::internal(error.to_string(), operation))
        }
    }

    fn set_tray_title(
        &mut self,
        tray: &TrayResourcePayload,
        title: String,
    ) -> std::result::Result<(), HostProtocolError> {
        let operation = host_protocol::TRAY_SET_TITLE_METHOD;
        #[cfg(target_os = "linux")]
        {
            let _ = (tray, title);
            return Err(unsupported_tray(operation));
        }

        #[cfg(target_os = "windows")]
        {
            let _ = (tray, title);
            return Err(HostProtocolError::unsupported(
                "tray title is unsupported on Windows",
                operation,
            ));
        }

        #[cfg(target_os = "macos")]
        {
            validate_tray_handle(self, tray, operation)?;
            self.trays
                .get_mut(tray.id())
                .expect("validated tray exists")
                ._tray
                .set_title(Some(title));
            Ok(())
        }
    }

    fn set_tray_menu(
        &mut self,
        tray: &TrayResourcePayload,
        menu: serde_json::Value,
    ) -> std::result::Result<(), HostProtocolError> {
        let operation = host_protocol::TRAY_SET_MENU_METHOD;
        #[cfg(target_os = "linux")]
        {
            let _ = (tray, menu);
            return Err(unsupported_tray(operation));
        }

        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            validate_tray_handle(self, tray, operation)?;
            let menu = build_tray_menu(&menu, operation)?;
            self.trays
                .get_mut(tray.id())
                .expect("validated tray exists")
                ._tray
                .set_menu(Some(Box::new(menu)));
            Ok(())
        }
    }

    fn destroy_tray(
        &mut self,
        tray: &TrayResourcePayload,
    ) -> std::result::Result<(), HostProtocolError> {
        let operation = host_protocol::TRAY_DESTROY_METHOD;
        #[cfg(target_os = "linux")]
        {
            let _ = tray;
            return Err(unsupported_tray(operation));
        }

        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            validate_tray_handle(self, tray, operation)?;
            self.trays.remove(tray.id());
            forget_tray_event_handle(tray.id())?;
            Ok(())
        }
    }

    fn clear_runtime_trays(&mut self) -> std::result::Result<(), HostProtocolError> {
        clear_tray_runtime_event_state()?;
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            self.trays.clear();
        }
        Ok(())
    }

    fn screen_displays(
        &self,
        target: &EventLoopWindowTarget<HostEvent>,
        operation: &'static str,
    ) -> std::result::Result<ScreenDisplaysResultPayload, HostProtocolError> {
        let monitors = target.available_monitors().collect::<Vec<_>>();
        if monitors.is_empty() {
            return Err(HostProtocolError::host_unavailable(operation));
        }
        let primary_id = target
            .primary_monitor()
            .as_ref()
            .map(screen_display_id)
            .unwrap_or_else(|| screen_display_id(&monitors[0]));
        let mut primary_assigned = false;
        let displays = monitors
            .iter()
            .map(|monitor| {
                let id = screen_display_id(monitor);
                let primary = id == primary_id && !primary_assigned;
                if primary {
                    primary_assigned = true;
                }
                screen_display_payload(id, monitor, primary)
            })
            .collect::<Vec<_>>();
        Ok(ScreenDisplaysResultPayload::new(displays))
    }

    fn primary_screen_display(
        &self,
        target: &EventLoopWindowTarget<HostEvent>,
    ) -> std::result::Result<ScreenDisplayPayload, HostProtocolError> {
        if let Some(primary) = target.primary_monitor() {
            return Ok(screen_display_payload(
                screen_display_id(&primary),
                &primary,
                true,
            ));
        }

        let Some(first) = target.available_monitors().next() else {
            return Err(HostProtocolError::host_unavailable(
                host_protocol::SCREEN_GET_PRIMARY_DISPLAY_METHOD,
            ));
        };
        Ok(screen_display_payload(
            screen_display_id(&first),
            &first,
            true,
        ))
    }

    fn emit_screen_displays_changed(
        &self,
        target: &EventLoopWindowTarget<HostEvent>,
    ) -> std::result::Result<(), HostProtocolError> {
        let Some(sender) = screen_event_sender()? else {
            return Ok(());
        };
        let payload = self.screen_displays(target, host_protocol::SCREEN_DISPLAYS_CHANGED_EVENT)?;
        let payload = serde_json::to_value(ScreenDisplaysChangedEventPayload::new(
            payload.displays().to_vec(),
        ))
        .map_err(|error| {
            HostProtocolError::invalid_output(
                host_protocol::SCREEN_DISPLAYS_CHANGED_EVENT,
                error.to_string(),
            )
        })?;
        sender
            .send(HostProtocolEnvelope::Event {
                method: host_protocol::SCREEN_DISPLAYS_CHANGED_EVENT.to_string(),
                timestamp: timestamp_millis(),
                trace_id: format!("screen-displays-changed-{}", Uuid::now_v7()),
                window_id: None,
                payload: Some(payload),
            })
            .map_err(|_error| {
                HostProtocolError::host_unavailable(host_protocol::SCREEN_DISPLAYS_CHANGED_EVENT)
            })
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
                WindowLifecycleEvent::AppQuitRequested(exit_code)
                    if !matches!(
                        lifecycle,
                        WindowLifecycleEvent::WindowCreateFailed
                            | WindowLifecycleEvent::SmokeTimedOut
                    ) =>
                {
                    lifecycle = WindowLifecycleEvent::AppQuitRequested(exit_code);
                }
                WindowLifecycleEvent::SmokeExitRequested
                    if !matches!(
                        lifecycle,
                        WindowLifecycleEvent::WindowCreateFailed
                            | WindowLifecycleEvent::SmokeTimedOut
                            | WindowLifecycleEvent::AppQuitRequested(_)
                    ) =>
                {
                    lifecycle = WindowLifecycleEvent::SmokeExitRequested;
                }
                WindowLifecycleEvent::CloseRequested
                | WindowLifecycleEvent::AppQuitRequested(_)
                | WindowLifecycleEvent::Other => {}
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
            WindowCommand::Quit { exit_code, reply } => {
                send_window_command_reply(reply, Ok(WindowCommandResponse::WindowUpdated));
                WindowLifecycleEvent::AppQuitRequested(exit_code)
            }
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
            WindowCommand::Show { window_id, reply } => {
                let result = self.show(&window_id);
                send_window_command_reply(
                    reply,
                    result.map(|()| WindowCommandResponse::WindowUpdated),
                );
                WindowLifecycleEvent::Other
            }
            WindowCommand::Hide { window_id, reply } => {
                let result = self.hide(&window_id);
                send_window_command_reply(
                    reply,
                    result.map(|()| WindowCommandResponse::WindowUpdated),
                );
                WindowLifecycleEvent::Other
            }
            WindowCommand::Focus { window_id, reply } => {
                let result = self.focus(&window_id);
                send_window_command_reply(
                    reply,
                    result.map(|()| WindowCommandResponse::WindowUpdated),
                );
                WindowLifecycleEvent::Other
            }
            WindowCommand::GetCurrent { reply } => {
                let result = self.get_current().map(WindowCommandResponse::WindowLookup);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::GetById { window_id, reply } => {
                let result = self
                    .get_by_id(&window_id)
                    .map(WindowCommandResponse::WindowLookup);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::List { reply } => {
                let result = self.list().map(WindowCommandResponse::WindowList);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::GetParent { window_id, reply } => {
                let result = self
                    .get_parent(&window_id)
                    .map(WindowCommandResponse::WindowParent);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::GetChildren { window_id, reply } => {
                let result = self
                    .get_children(&window_id)
                    .map(WindowCommandResponse::WindowList);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::GetBounds { window_id, reply } => {
                let result = self
                    .get_bounds(&window_id)
                    .map(WindowCommandResponse::WindowBounds);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::SetBounds {
                window_id,
                bounds,
                reply,
            } => {
                let result = self
                    .set_bounds(&window_id, &bounds)
                    .map(|()| WindowCommandResponse::WindowUpdated);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::Center { window_id, reply } => {
                let result = self
                    .center(&window_id)
                    .map(|()| WindowCommandResponse::WindowUpdated);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::CenterOnDisplay {
                window_id,
                display_id,
                reply,
            } => {
                let result = self
                    .center_on_display(&window_id, &display_id)
                    .map(|()| WindowCommandResponse::WindowUpdated);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::SetTitle {
                window_id,
                title,
                reply,
            } => {
                let result = self
                    .set_title(&window_id, &title)
                    .map(|()| WindowCommandResponse::WindowUpdated);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::SetResizable {
                window_id,
                resizable,
                reply,
            } => {
                let result = self
                    .set_resizable(&window_id, resizable)
                    .map(|()| WindowCommandResponse::WindowUpdated);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::SetDecorations {
                window_id,
                decorations,
                reply,
            } => {
                let result = self
                    .set_decorations(&window_id, decorations)
                    .map(|()| WindowCommandResponse::WindowUpdated);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::SetTrafficLights {
                window_id,
                traffic_lights,
                reply,
            } => {
                let result = self
                    .set_traffic_lights(&window_id, &traffic_lights)
                    .map(|()| WindowCommandResponse::WindowUpdated);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::SetVibrancy {
                window_id,
                material,
                reply,
            } => {
                let result = self
                    .set_vibrancy(&window_id, &material)
                    .map(|()| WindowCommandResponse::WindowUpdated);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::SetShadow {
                window_id,
                has_shadow,
                reply,
            } => {
                let result = self
                    .set_shadow(&window_id, has_shadow)
                    .map(|()| WindowCommandResponse::WindowUpdated);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::SetAlwaysOnTop {
                window_id,
                always_on_top,
                reply,
            } => {
                let result = self
                    .set_always_on_top(&window_id, always_on_top)
                    .map(|()| WindowCommandResponse::WindowUpdated);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::SetSkipTaskbar {
                window_id,
                skip_taskbar,
                reply,
            } => {
                let result = self
                    .set_skip_taskbar(&window_id, skip_taskbar)
                    .map(|()| WindowCommandResponse::WindowUpdated);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::SetProgress {
                window_id,
                progress,
                reply,
            } => {
                let result = self
                    .set_progress(&window_id, &progress)
                    .map(|()| WindowCommandResponse::WindowUpdated);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::RequestAttention {
                window_id,
                request_type,
                reply,
            } => {
                let result = self
                    .request_attention(&window_id, request_type)
                    .map(|()| WindowCommandResponse::WindowUpdated);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::CancelAttention { window_id, reply } => {
                let result = self
                    .cancel_attention(&window_id)
                    .map(|()| WindowCommandResponse::WindowUpdated);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::Minimize { window_id, reply } => {
                let result = self
                    .minimize(&window_id)
                    .map(|()| WindowCommandResponse::WindowUpdated);
                if result.is_ok() {
                    self.emit_window_state_snapshot(
                        &window_id,
                        host_protocol::WINDOW_MINIMIZE_METHOD,
                    );
                }
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::Maximize { window_id, reply } => {
                let result = self
                    .maximize(&window_id)
                    .map(|()| WindowCommandResponse::WindowUpdated);
                if result.is_ok() {
                    self.emit_window_state_snapshot(
                        &window_id,
                        host_protocol::WINDOW_MAXIMIZE_METHOD,
                    );
                }
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::Restore { window_id, reply } => {
                let result = self
                    .restore(&window_id)
                    .map(|()| WindowCommandResponse::WindowUpdated);
                if result.is_ok() {
                    self.emit_window_state_snapshot(
                        &window_id,
                        host_protocol::WINDOW_RESTORE_METHOD,
                    );
                }
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::SetFullscreen {
                window_id,
                fullscreen,
                reply,
            } => {
                let result = self
                    .set_fullscreen(&window_id, fullscreen)
                    .map(|()| WindowCommandResponse::WindowUpdated);
                if result.is_ok() {
                    self.emit_window_state_snapshot(
                        &window_id,
                        host_protocol::WINDOW_SET_FULLSCREEN_METHOD,
                    );
                }
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::SetSimpleFullscreen {
                window_id,
                simple_fullscreen,
                reply,
            } => {
                let result = self
                    .set_simple_fullscreen(&window_id, simple_fullscreen)
                    .map(|()| WindowCommandResponse::WindowUpdated);
                if result.is_ok() {
                    self.emit_window_state_snapshot(
                        &window_id,
                        host_protocol::WINDOW_SET_SIMPLE_FULLSCREEN_METHOD,
                    );
                }
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::GetState { window_id, reply } => {
                let result = self
                    .get_state(&window_id)
                    .map(WindowCommandResponse::WindowState);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::SetDockBadgeLabel {
                label,
                operation,
                reply,
            } => {
                let result = self
                    .set_dock_badge_label(label, operation)
                    .map(|()| WindowCommandResponse::DockBadgeLabelSet);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::SetDockProgress { progress, reply } => {
                let result = self
                    .set_dock_progress(&progress)
                    .map(|()| WindowCommandResponse::DockProgressSet);
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
            WindowCommand::SetDockMenu { template, reply } => {
                let result = self
                    .set_dock_menu(template)
                    .map(|()| WindowCommandResponse::DockMenuSet);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::SetApplicationMenu { template, reply } => {
                let result = self
                    .set_application_menu(template)
                    .map(|()| WindowCommandResponse::MenuSet);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::SetWindowMenu {
                window_id,
                template,
                reply,
            } => {
                let result = self
                    .set_window_menu(&window_id, template)
                    .map(|()| WindowCommandResponse::MenuSet);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::CreateTray { request, reply } => {
                let result = self
                    .create_tray(request)
                    .map(WindowCommandResponse::TrayCreated);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::SetTrayIcon { tray, icon, reply } => {
                let result = self
                    .set_tray_icon(&tray, icon)
                    .map(|()| WindowCommandResponse::TrayUpdated);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::SetTrayTooltip {
                tray,
                tooltip,
                reply,
            } => {
                let result = self
                    .set_tray_tooltip(&tray, tooltip)
                    .map(|()| WindowCommandResponse::TrayUpdated);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::SetTrayTitle { tray, title, reply } => {
                let result = self
                    .set_tray_title(&tray, title)
                    .map(|()| WindowCommandResponse::TrayUpdated);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::SetTrayMenu { tray, menu, reply } => {
                let result = self
                    .set_tray_menu(&tray, menu)
                    .map(|()| WindowCommandResponse::TrayUpdated);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::DestroyTray { tray, reply } => {
                let result = self
                    .destroy_tray(&tray)
                    .map(|()| WindowCommandResponse::TrayDestroyed);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::ClearRuntimeTrays { reply } => {
                let result = self
                    .clear_runtime_trays()
                    .map(|()| WindowCommandResponse::TrayDestroyed);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::GetScreenDisplays { reply } => {
                let result = self
                    .screen_displays(target, host_protocol::SCREEN_GET_DISPLAYS_METHOD)
                    .map(WindowCommandResponse::ScreenDisplays);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::GetPrimaryScreenDisplay { reply } => {
                let result = self
                    .primary_screen_display(target)
                    .map(WindowCommandResponse::ScreenDisplay);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::GetScreenPointerPoint { reply } => {
                let result = screen_pointer_point(target).map(WindowCommandResponse::ScreenPoint);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::ScreenIsSupported { method, reply } => {
                let result =
                    screen_is_supported(target, method).map(WindowCommandResponse::ScreenSupported);
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

fn unexpected_tray_response(
    response: WindowCommandResponse,
    operation: &'static str,
) -> HostProtocolError {
    let message = match response {
        WindowCommandResponse::Created(_) => "tray command received window create response",
        WindowCommandResponse::Destroyed => "tray command received window destroy response",
        WindowCommandResponse::WindowUpdated => "tray command received window lifecycle response",
        WindowCommandResponse::WindowLookup(_) => "tray command received window lookup response",
        WindowCommandResponse::WindowList(_) => "tray command received window list response",
        WindowCommandResponse::WindowParent(_) => "tray command received window parent response",
        WindowCommandResponse::WindowBounds(_) => "tray command received window bounds response",
        WindowCommandResponse::WindowState(_) => "tray command received window state response",
        WindowCommandResponse::DockBadgeLabelSet => "tray command received dock badge response",
        WindowCommandResponse::DockProgressSet => "tray command received dock progress response",
        WindowCommandResponse::DockAttentionRequested => {
            "tray command received dock attention response"
        }
        WindowCommandResponse::DockMenuSet => "tray command received dock menu response",
        WindowCommandResponse::MenuSet => "tray command received menu response",
        WindowCommandResponse::TrayCreated(_) => "tray command received create response",
        WindowCommandResponse::TrayUpdated => "tray command received update response",
        WindowCommandResponse::TrayDestroyed => "tray command received destroy response",
        WindowCommandResponse::ScreenDisplays(_)
        | WindowCommandResponse::ScreenDisplay(_)
        | WindowCommandResponse::ScreenPoint(_)
        | WindowCommandResponse::ScreenSupported(_) => "tray command received screen response",
    };
    HostProtocolError::internal(message, operation)
}

fn unexpected_screen_response(
    response: WindowCommandResponse,
    operation: &'static str,
) -> HostProtocolError {
    let message = match response {
        WindowCommandResponse::Created(_) => "screen command received window create response",
        WindowCommandResponse::Destroyed => "screen command received window destroy response",
        WindowCommandResponse::WindowUpdated => "screen command received window lifecycle response",
        WindowCommandResponse::WindowLookup(_) => "screen command received window lookup response",
        WindowCommandResponse::WindowList(_) => "screen command received window list response",
        WindowCommandResponse::WindowParent(_) => "screen command received window parent response",
        WindowCommandResponse::WindowBounds(_) => "screen command received window bounds response",
        WindowCommandResponse::WindowState(_) => "screen command received window state response",
        WindowCommandResponse::DockBadgeLabelSet => "screen command received dock badge response",
        WindowCommandResponse::DockProgressSet => "screen command received dock progress response",
        WindowCommandResponse::DockAttentionRequested => {
            "screen command received dock attention response"
        }
        WindowCommandResponse::DockMenuSet => "screen command received dock menu response",
        WindowCommandResponse::MenuSet => "screen command received menu response",
        WindowCommandResponse::TrayCreated(_)
        | WindowCommandResponse::TrayUpdated
        | WindowCommandResponse::TrayDestroyed => "screen command received tray response",
        WindowCommandResponse::ScreenDisplays(_) => "screen command received displays response",
        WindowCommandResponse::ScreenDisplay(_) => "screen command received display response",
        WindowCommandResponse::ScreenPoint(_) => "screen command received point response",
        WindowCommandResponse::ScreenSupported(_) => "screen command received support response",
    };
    HostProtocolError::internal(message, operation)
}

fn window_bounds(
    window: &Window,
    operation: &'static str,
) -> std::result::Result<WindowBoundsPayload, HostProtocolError> {
    let scale = window.scale_factor();
    let position = window.outer_position().map_err(|error| {
        HostProtocolError::internal(
            format!("failed to read window position: {error}"),
            operation,
        )
    })?;
    let size = window.inner_size();

    Ok(WindowBoundsPayload::new(
        f64::from(position.x) / scale,
        f64::from(position.y) / scale,
        f64::from(size.width) / scale,
        f64::from(size.height) / scale,
    ))
}

fn tao_window_state(window: &Window) -> WindowStatePayload {
    WindowStatePayload::new(
        window.is_minimized(),
        window.is_maximized(),
        window.fullscreen().is_some(),
        simple_fullscreen(window),
    )
}

#[cfg(target_os = "macos")]
fn simple_fullscreen(window: &Window) -> bool {
    use tao::platform::macos::WindowExtMacOS;

    WindowExtMacOS::simple_fullscreen(window)
}

#[cfg(not(target_os = "macos"))]
fn simple_fullscreen(_window: &Window) -> bool {
    false
}

#[cfg(target_os = "macos")]
fn set_simple_fullscreen(
    window: &Window,
    simple_fullscreen: bool,
    operation: &'static str,
) -> std::result::Result<(), HostProtocolError> {
    use tao::platform::macos::WindowExtMacOS;

    if WindowExtMacOS::set_simple_fullscreen(window, simple_fullscreen) {
        Ok(())
    } else {
        Err(HostProtocolError::InvalidState {
            current: "native-fullscreen-or-unchanged".to_string(),
            attempted: if simple_fullscreen {
                "simple-fullscreen"
            } else {
                "not-simple-fullscreen"
            }
            .to_string(),
            message: "window simple fullscreen transition was rejected".to_string(),
            operation: operation.to_string(),
            platform: None,
            code: None,
            cause: None,
            recoverable: false,
            remediation: None,
            docs_url: None,
        })
    }
}

#[cfg(not(target_os = "macos"))]
fn set_simple_fullscreen(
    _window: &Window,
    _simple_fullscreen: bool,
    operation: &'static str,
) -> std::result::Result<(), HostProtocolError> {
    Err(HostProtocolError::unsupported(
        "simple-fullscreen-macos-only",
        operation,
    ))
}

#[cfg(target_os = "macos")]
fn clear_simple_fullscreen(window: &Window) -> std::result::Result<(), HostProtocolError> {
    set_simple_fullscreen(window, false, host_protocol::WINDOW_RESTORE_METHOD)
}

#[cfg(not(target_os = "macos"))]
fn clear_simple_fullscreen(_window: &Window) -> std::result::Result<(), HostProtocolError> {
    Ok(())
}

#[cfg(windows)]
fn set_skip_taskbar(
    window: &Window,
    skip_taskbar: bool,
) -> std::result::Result<(), HostProtocolError> {
    use tao::platform::windows::WindowExtWindows;

    WindowExtWindows::set_skip_taskbar(window, skip_taskbar).map_err(|error| {
        HostProtocolError::internal(
            format!("failed to set skip taskbar: {error}"),
            host_protocol::WINDOW_SET_SKIP_TASKBAR_METHOD,
        )
    })
}

#[cfg(target_os = "linux")]
fn set_skip_taskbar(
    window: &Window,
    skip_taskbar: bool,
) -> std::result::Result<(), HostProtocolError> {
    use tao::platform::unix::WindowExtUnix;

    WindowExtUnix::set_skip_taskbar(window, skip_taskbar).map_err(|error| {
        HostProtocolError::internal(
            format!("failed to set skip taskbar: {error}"),
            host_protocol::WINDOW_SET_SKIP_TASKBAR_METHOD,
        )
    })
}

#[cfg(not(any(windows, target_os = "linux")))]
fn set_skip_taskbar(
    _window: &Window,
    _skip_taskbar: bool,
) -> std::result::Result<(), HostProtocolError> {
    Err(HostProtocolError::unsupported(
        "skip-taskbar is only supported on Windows and Linux",
        host_protocol::WINDOW_SET_SKIP_TASKBAR_METHOD,
    ))
}

fn to_tao_progress_state(state: WindowProgressState) -> ProgressState {
    match state {
        WindowProgressState::None => ProgressState::None,
        WindowProgressState::Normal => ProgressState::Normal,
        WindowProgressState::Indeterminate => ProgressState::Indeterminate,
        WindowProgressState::Paused => ProgressState::Paused,
        WindowProgressState::Error => ProgressState::Error,
    }
}

fn to_tao_dock_progress(
    progress: &DockSetProgressPayload,
) -> std::result::Result<ProgressBarState, HostProtocolError> {
    let progress_value = match progress.value() {
        serde_json::Value::Null => None,
        serde_json::Value::Number(number) => {
            let Some(value) = number.as_f64() else {
                return Err(HostProtocolError::invalid_argument(
                    "value",
                    "must be null or a finite number between 0 and 1",
                    host_protocol::DOCK_SET_PROGRESS_METHOD,
                ));
            };
            if !value.is_finite() || !(0.0..=1.0).contains(&value) {
                return Err(HostProtocolError::invalid_argument(
                    "value",
                    "must be null or a finite number between 0 and 1",
                    host_protocol::DOCK_SET_PROGRESS_METHOD,
                ));
            }
            Some((value * 100.0).round() as u64)
        }
        _ => {
            return Err(HostProtocolError::invalid_argument(
                "value",
                "must be null or a finite number between 0 and 1",
                host_protocol::DOCK_SET_PROGRESS_METHOD,
            ));
        }
    };
    let state = match progress.options().and_then(|options| options.state()) {
        Some(state) => Some(to_tao_dock_progress_state(state)),
        None if progress_value.is_some() => Some(ProgressState::Normal),
        None => Some(ProgressState::None),
    };

    Ok(ProgressBarState {
        state,
        progress: progress_value,
        desktop_filename: None,
    })
}

fn to_tao_dock_progress_state(state: DockProgressState) -> ProgressState {
    match state {
        DockProgressState::Normal => ProgressState::Normal,
        DockProgressState::Indeterminate => ProgressState::Indeterminate,
        DockProgressState::Paused => ProgressState::Paused,
        DockProgressState::Error => ProgressState::Error,
    }
}

fn to_tao_attention_type(request_type: WindowAttentionType) -> UserAttentionType {
    match request_type {
        WindowAttentionType::Critical => UserAttentionType::Critical,
        WindowAttentionType::Informational => UserAttentionType::Informational,
    }
}

fn apply_window_parent(
    builder: WindowBuilder,
    parent: &Window,
) -> std::result::Result<WindowBuilder, HostProtocolError> {
    #[cfg(target_os = "macos")]
    {
        macos::apply_window_parent(builder, parent)
    }

    #[cfg(windows)]
    {
        return windows::apply_window_parent(builder, parent);
    }

    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = (builder, parent);
        Err(HostProtocolError::unsupported(
            "window parent ownership is not implemented for this host platform",
            host_protocol::WINDOW_CREATE_METHOD,
        ))
    }
}

fn centered_window_bounds(
    window: &Window,
    monitor: &MonitorHandle,
) -> std::result::Result<WindowBoundsPayload, HostProtocolError> {
    centered_window_bounds_for_operation(window, monitor, host_protocol::WINDOW_CENTER_METHOD)
}

fn centered_window_bounds_for_operation(
    window: &Window,
    monitor: &MonitorHandle,
    operation: &'static str,
) -> std::result::Result<WindowBoundsPayload, HostProtocolError> {
    let current = window_bounds(window, operation)?;
    let scale = monitor.scale_factor();
    let work_area = monitor_work_area(monitor);
    let monitor_x = f64::from(work_area.x) / scale;
    let monitor_y = f64::from(work_area.y) / scale;
    let monitor_width = f64::from(work_area.width) / scale;
    let monitor_height = f64::from(work_area.height) / scale;

    Ok(WindowBoundsPayload::new(
        monitor_x + ((monitor_width - current.width()) / 2.0),
        monitor_y + ((monitor_height - current.height()) / 2.0),
        current.width(),
        current.height(),
    ))
}

fn centered_window_physical_position_for_operation(
    window: &Window,
    monitor: &MonitorHandle,
    operation: &'static str,
) -> std::result::Result<PhysicalPosition<i32>, HostProtocolError> {
    let work_area = monitor_work_area(monitor);
    let window_size = window.inner_size();
    let x = centered_physical_axis(
        work_area.x,
        work_area.width,
        window_size.width,
        "x",
        operation,
    )?;
    let y = centered_physical_axis(
        work_area.y,
        work_area.height,
        window_size.height,
        "y",
        operation,
    )?;

    Ok(PhysicalPosition::new(x, y))
}

fn centered_physical_axis(
    origin: i32,
    container_size: u32,
    item_size: u32,
    axis: &str,
    operation: &'static str,
) -> std::result::Result<i32, HostProtocolError> {
    let offset = (i64::from(container_size) - i64::from(item_size)) / 2;
    let centered = i64::from(origin) + offset;
    i32::try_from(centered).map_err(|_| {
        HostProtocolError::internal(
            format!("computed {axis} position is outside host coordinate range"),
            operation,
        )
    })
}

fn screen_display_payload(
    id: String,
    monitor: &MonitorHandle,
    primary: bool,
) -> ScreenDisplayPayload {
    let bounds = screen_bounds_payload(monitor_bounds(monitor));
    let work_area = screen_bounds_payload(monitor_work_area(monitor));
    ScreenDisplayPayload::new(id, bounds, work_area, monitor.scale_factor(), primary)
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct PhysicalScreenArea {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

fn monitor_bounds(monitor: &MonitorHandle) -> PhysicalScreenArea {
    let position = monitor.position();
    let size = monitor.size();
    PhysicalScreenArea {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    }
}

fn monitor_work_area(monitor: &MonitorHandle) -> PhysicalScreenArea {
    macos::screen_work_area(monitor)
        .and_then(|work_area| {
            PhysicalScreenArea::new(
                work_area.x(),
                work_area.y(),
                work_area.width(),
                work_area.height(),
            )
        })
        .unwrap_or_else(|| monitor_bounds(monitor))
}

impl PhysicalScreenArea {
    fn new(x: f64, y: f64, width: f64, height: f64) -> Option<Self> {
        Some(Self {
            x: rounded_i32(x)?,
            y: rounded_i32(y)?,
            width: rounded_u32(width)?,
            height: rounded_u32(height)?,
        })
    }
}

fn rounded_i32(value: f64) -> Option<i32> {
    let rounded = value.round();
    if !rounded.is_finite() || rounded < f64::from(i32::MIN) || rounded > f64::from(i32::MAX) {
        return None;
    }
    Some(rounded as i32)
}

fn rounded_u32(value: f64) -> Option<u32> {
    let rounded = value.round();
    if !rounded.is_finite() || rounded < 0.0 || rounded > f64::from(u32::MAX) {
        return None;
    }
    Some(rounded as u32)
}

fn screen_bounds_payload(area: PhysicalScreenArea) -> ScreenBoundsPayload {
    ScreenBoundsPayload::new(
        f64::from(area.x),
        f64::from(area.y),
        f64::from(area.width),
        f64::from(area.height),
    )
}

fn screen_display_id(monitor: &MonitorHandle) -> String {
    let position = monitor.position();
    let size = monitor.size();
    let name = monitor
        .name()
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| {
            format!(
                "display@{},{}:{}x{}",
                position.x, position.y, size.width, size.height
            )
        });
    format!(
        "{}@{},{}:{}x{}@{}",
        name,
        position.x,
        position.y,
        size.width,
        size.height,
        monitor.scale_factor()
    )
}

fn screen_pointer_point(
    target: &EventLoopWindowTarget<HostEvent>,
) -> std::result::Result<ScreenPointPayload, HostProtocolError> {
    if linux_wayland_pointer_unsupported() {
        return Err(unsupported_screen(
            host_protocol::SCREEN_GET_POINTER_POINT_METHOD,
        ));
    }

    target
        .cursor_position()
        .map(|position| ScreenPointPayload::new(position.x, position.y))
        .map_err(|_error| {
            HostProtocolError::host_unavailable(host_protocol::SCREEN_GET_POINTER_POINT_METHOD)
        })
}

fn screen_is_supported(
    target: &EventLoopWindowTarget<HostEvent>,
    method: ScreenMethodPayload,
) -> std::result::Result<ScreenSupportedPayload, HostProtocolError> {
    let supported = match method {
        ScreenMethodPayload::GetDisplays | ScreenMethodPayload::GetPrimaryDisplay => {
            target.available_monitors().next().is_some()
        }
        ScreenMethodPayload::GetPointerPoint => {
            !linux_wayland_pointer_unsupported() && target.cursor_position().is_ok()
        }
    };
    if supported {
        Ok(ScreenSupportedPayload::supported())
    } else {
        Ok(ScreenSupportedPayload::unsupported())
    }
}

fn unsupported_screen(operation: &'static str) -> HostProtocolError {
    HostProtocolError::unsupported(host_protocol::SCREEN_UNSUPPORTED_REASON, operation)
}

#[cfg(target_os = "linux")]
fn linux_wayland_pointer_unsupported() -> bool {
    linux_wayland_pointer_unsupported_from_env(
        std::env::var("WINIT_UNIX_BACKEND").ok().as_deref(),
        std::env::var("XDG_SESSION_TYPE").ok().as_deref(),
        std::env::var("WAYLAND_DISPLAY").ok().as_deref(),
    )
}

#[cfg(not(target_os = "linux"))]
fn linux_wayland_pointer_unsupported() -> bool {
    false
}

#[cfg(target_os = "linux")]
fn linux_wayland_pointer_unsupported_from_env(
    backend: Option<&str>,
    session_type: Option<&str>,
    wayland_display: Option<&str>,
) -> bool {
    if matches!(backend, Some("x11")) {
        return false;
    }
    matches!(backend, Some("wayland"))
        || matches!(session_type, Some("wayland"))
        || wayland_display.is_some_and(|value| !value.is_empty())
}

#[cfg(target_os = "linux")]
fn unsupported_tray(operation: &'static str) -> HostProtocolError {
    HostProtocolError::unsupported(host_protocol::TRAY_UNSUPPORTED_REASON, operation)
}

pub(crate) fn install_screen_event_sender(
    sender: Sender<HostProtocolEnvelope>,
) -> std::result::Result<(), HostProtocolError> {
    let mut current = SCREEN_EVENT_SENDER.lock().map_err(|_| {
        HostProtocolError::internal(
            "screen event sender mutex poisoned",
            "host.runtime.screen.connect",
        )
    })?;
    *current = Some(sender);
    Ok(())
}

pub(crate) fn install_window_event_sender(
    sender: Sender<HostProtocolEnvelope>,
) -> std::result::Result<(), HostProtocolError> {
    let mut current = WINDOW_EVENT_SENDER.lock().map_err(|_| {
        HostProtocolError::internal(
            "window event sender mutex poisoned",
            "host.runtime.window.connect",
        )
    })?;
    *current = Some(sender);
    Ok(())
}

pub(crate) fn clear_screen_runtime_event_state() -> std::result::Result<(), HostProtocolError> {
    let mut sender = SCREEN_EVENT_SENDER.lock().map_err(|_| {
        HostProtocolError::internal(
            "screen event sender mutex poisoned",
            "host.runtime.screen.disconnect",
        )
    })?;
    *sender = None;
    Ok(())
}

pub(crate) fn clear_window_runtime_event_state() -> std::result::Result<(), HostProtocolError> {
    let mut sender = WINDOW_EVENT_SENDER.lock().map_err(|_| {
        HostProtocolError::internal(
            "window event sender mutex poisoned",
            "host.runtime.window.disconnect",
        )
    })?;
    *sender = None;
    Ok(())
}

fn screen_event_sender(
) -> std::result::Result<Option<Sender<HostProtocolEnvelope>>, HostProtocolError> {
    SCREEN_EVENT_SENDER
        .lock()
        .map(|sender| sender.clone())
        .map_err(|_| {
            HostProtocolError::internal(
                "screen event sender mutex poisoned",
                "host.runtime.screen.event",
            )
        })
}

fn window_event_sender(
) -> std::result::Result<Option<Sender<HostProtocolEnvelope>>, HostProtocolError> {
    WINDOW_EVENT_SENDER
        .lock()
        .map(|sender| sender.clone())
        .map_err(|_| {
            HostProtocolError::internal(
                "window event sender mutex poisoned",
                "host.runtime.window.event",
            )
        })
}

fn emit_window_registry_event(
    window_id: &str,
    phase: WindowRegistryEventPhase,
) -> std::result::Result<(), HostProtocolError> {
    let Some(sender) = window_event_sender()? else {
        return Ok(());
    };
    let payload = serde_json::to_value(WindowRegistryEventPayload::new(window_id, phase)).map_err(
        |error| HostProtocolError::invalid_output(host_protocol::WINDOW_EVENT, error.to_string()),
    )?;
    sender
        .send(HostProtocolEnvelope::Event {
            method: host_protocol::WINDOW_EVENT.to_string(),
            timestamp: timestamp_millis(),
            trace_id: format!("window-event-{}", Uuid::now_v7()),
            window_id: Some(window_id.to_string()),
            payload: Some(payload),
        })
        .map_err(|_error| HostProtocolError::host_unavailable(host_protocol::WINDOW_EVENT))
}

fn emit_window_state_event(
    window_id: &str,
    state: WindowStatePayload,
) -> std::result::Result<(), HostProtocolError> {
    let Some(sender) = window_event_sender()? else {
        return Ok(());
    };
    let payload =
        serde_json::to_value(WindowStateEventPayload::new(window_id, state)).map_err(|error| {
            HostProtocolError::invalid_output(host_protocol::WINDOW_EVENT, error.to_string())
        })?;
    sender
        .send(HostProtocolEnvelope::Event {
            method: host_protocol::WINDOW_EVENT.to_string(),
            timestamp: timestamp_millis(),
            trace_id: format!("window-state-event-{}", Uuid::now_v7()),
            window_id: Some(window_id.to_string()),
            payload: Some(payload),
        })
        .map_err(|_error| HostProtocolError::host_unavailable(host_protocol::WINDOW_EVENT))
}

fn timestamp_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after Unix epoch")
        .as_millis()
        .try_into()
        .expect("timestamp milliseconds should fit in u64")
}

pub(crate) fn clear_tray_runtime_event_state() -> std::result::Result<(), HostProtocolError> {
    let mut sender = TRAY_EVENT_SENDER.lock().map_err(|_| {
        HostProtocolError::internal(
            "tray event sender mutex poisoned",
            "host.runtime.tray.disconnect",
        )
    })?;
    *sender = None;
    let mut handles = TRAY_EVENT_HANDLES.lock().map_err(|_| {
        HostProtocolError::internal(
            "tray event handle mutex poisoned",
            "host.runtime.tray.disconnect",
        )
    })?;
    handles.clear();
    Ok(())
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn install_tray_event_sender(
    sender: Sender<HostProtocolEnvelope>,
) -> std::result::Result<(), HostProtocolError> {
    {
        let mut current = TRAY_EVENT_SENDER.lock().map_err(|_| {
            HostProtocolError::internal(
                "tray event sender mutex poisoned",
                host_protocol::TRAY_CREATE_METHOD,
            )
        })?;
        *current = Some(sender);
    }

    tray_icon::TrayIconEvent::set_event_handler(Some(forward_tray_icon_event));
    Ok(())
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn track_tray_event_handle(
    id: &str,
    handle: TrayResourcePayload,
) -> std::result::Result<(), HostProtocolError> {
    let mut handles = TRAY_EVENT_HANDLES.lock().map_err(|_| {
        HostProtocolError::internal(
            "tray event handle mutex poisoned",
            host_protocol::TRAY_CREATE_METHOD,
        )
    })?;
    handles.insert(id.to_string(), handle);
    Ok(())
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn forget_tray_event_handle(id: &str) -> std::result::Result<(), HostProtocolError> {
    let mut handles = TRAY_EVENT_HANDLES.lock().map_err(|_| {
        HostProtocolError::internal(
            "tray event handle mutex poisoned",
            host_protocol::TRAY_DESTROY_METHOD,
        )
    })?;
    handles.remove(id);
    Ok(())
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn forward_tray_icon_event(event: tray_icon::TrayIconEvent) {
    if !matches!(
        event,
        tray_icon::TrayIconEvent::Click { .. } | tray_icon::TrayIconEvent::DoubleClick { .. }
    ) {
        return;
    }

    let id = event.id().as_ref().to_string();
    let tray = match TRAY_EVENT_HANDLES
        .lock()
        .ok()
        .and_then(|handles| handles.get(&id).cloned())
    {
        Some(tray) => tray,
        None => return,
    };
    let sender = match TRAY_EVENT_SENDER
        .lock()
        .ok()
        .and_then(|sender| sender.clone())
    {
        Some(sender) => sender,
        None => return,
    };
    let payload = match serde_json::to_value(TrayActivatedEventPayload::new(tray)) {
        Ok(payload) => payload,
        Err(error) => {
            warn!(
                event = "host.tray.event_encode_failed",
                error = %error,
                "failed to encode tray event"
            );
            return;
        }
    };
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default();
    let _ = sender.send(HostProtocolEnvelope::Event {
        method: host_protocol::TRAY_ACTIVATED_EVENT.to_string(),
        timestamp,
        trace_id: format!("tray-activated-{id}-{timestamp}"),
        window_id: None,
        payload: Some(payload),
    });
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn validate_tray_handle(
    registry: &WindowRegistry,
    tray: &TrayResourcePayload,
    operation: &'static str,
) -> std::result::Result<(), HostProtocolError> {
    if tray.kind() != "tray" {
        return Err(HostProtocolError::invalid_argument(
            "tray.kind",
            "must be tray",
            operation,
        ));
    }
    if tray.state() != "open" {
        return Err(HostProtocolError::invalid_argument(
            "tray.state",
            "must be open",
            operation,
        ));
    }

    let Some(resources) = registry.trays.get(tray.id()) else {
        return Err(HostProtocolError::not_found(
            format!("Tray:{}", tray.id()),
            operation,
        ));
    };
    if resources.generation != tray.generation() {
        return Err(HostProtocolError::invalid_argument(
            "tray.generation",
            "does not match the active tray generation",
            operation,
        ));
    }
    if resources.owner_scope != tray.owner_scope() {
        return Err(HostProtocolError::invalid_argument(
            "tray.ownerScope",
            "does not match the active tray owner scope",
            operation,
        ));
    }

    Ok(())
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn build_tray_icon(
    value: &str,
    operation: &'static str,
) -> std::result::Result<tray_icon::Icon, HostProtocolError> {
    let Some(hex) = value.strip_prefix("solid:#") else {
        return Err(HostProtocolError::invalid_argument(
            "icon",
            "must be a solid:#RRGGBBAA tray icon",
            operation,
        ));
    };
    if hex.len() != 8 {
        return Err(HostProtocolError::invalid_argument(
            "icon",
            "must include RGBA hex channels",
            operation,
        ));
    }

    let red = parse_hex_byte(&hex[0..2], operation)?;
    let green = parse_hex_byte(&hex[2..4], operation)?;
    let blue = parse_hex_byte(&hex[4..6], operation)?;
    let alpha = parse_hex_byte(&hex[6..8], operation)?;
    let pixel_count = 16 * 16;
    let mut rgba = Vec::with_capacity(pixel_count * 4);
    for _ in 0..pixel_count {
        rgba.extend_from_slice(&[red, green, blue, alpha]);
    }

    tray_icon::Icon::from_rgba(rgba, 16, 16)
        .map_err(|error| HostProtocolError::invalid_argument("icon", error.to_string(), operation))
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn parse_hex_byte(value: &str, operation: &'static str) -> Result<u8, HostProtocolError> {
    u8::from_str_radix(value, 16).map_err(|_| {
        HostProtocolError::invalid_argument("icon", "must include valid hex channels", operation)
    })
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn build_tray_menu(
    value: &serde_json::Value,
    operation: &'static str,
) -> std::result::Result<tray_icon::menu::Menu, HostProtocolError> {
    let menu = tray_icon::menu::Menu::new();
    let items = menu_items(value, "menu.items", operation)?;
    for item in items {
        append_menu_item(&menu, item, operation)?;
    }
    Ok(menu)
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn append_menu_item(
    menu: &tray_icon::menu::Menu,
    value: &serde_json::Value,
    operation: &'static str,
) -> std::result::Result<(), HostProtocolError> {
    match menu_item_type(value, operation)? {
        "item" => {
            if value.get("checked").and_then(serde_json::Value::as_bool) == Some(true) {
                let item = tray_icon::menu::CheckMenuItem::with_id(
                    required_string(value, "id", operation)?,
                    required_string(value, "label", operation)?,
                    value
                        .get("enabled")
                        .and_then(serde_json::Value::as_bool)
                        .unwrap_or(true),
                    true,
                    None,
                );
                menu.append(&item)
            } else {
                let item = tray_icon::menu::MenuItem::with_id(
                    required_string(value, "id", operation)?,
                    required_string(value, "label", operation)?,
                    value
                        .get("enabled")
                        .and_then(serde_json::Value::as_bool)
                        .unwrap_or(true),
                    None,
                );
                menu.append(&item)
            }
        }
        "separator" => {
            let item = tray_icon::menu::PredefinedMenuItem::separator();
            menu.append(&item)
        }
        "submenu" => {
            let submenu = build_submenu(value, operation)?;
            menu.append(&submenu)
        }
        _ => {
            return Err(HostProtocolError::invalid_argument(
                "menu.item.type",
                "must be item, separator, or submenu",
                operation,
            ));
        }
    }
    .map_err(|error| HostProtocolError::invalid_argument("menu", error.to_string(), operation))
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn append_submenu_item(
    submenu: &tray_icon::menu::Submenu,
    value: &serde_json::Value,
    operation: &'static str,
) -> std::result::Result<(), HostProtocolError> {
    match menu_item_type(value, operation)? {
        "item" => {
            if value.get("checked").and_then(serde_json::Value::as_bool) == Some(true) {
                let item = tray_icon::menu::CheckMenuItem::with_id(
                    required_string(value, "id", operation)?,
                    required_string(value, "label", operation)?,
                    value
                        .get("enabled")
                        .and_then(serde_json::Value::as_bool)
                        .unwrap_or(true),
                    true,
                    None,
                );
                submenu.append(&item)
            } else {
                let item = tray_icon::menu::MenuItem::with_id(
                    required_string(value, "id", operation)?,
                    required_string(value, "label", operation)?,
                    value
                        .get("enabled")
                        .and_then(serde_json::Value::as_bool)
                        .unwrap_or(true),
                    None,
                );
                submenu.append(&item)
            }
        }
        "separator" => {
            let item = tray_icon::menu::PredefinedMenuItem::separator();
            submenu.append(&item)
        }
        "submenu" => {
            let child = build_submenu(value, operation)?;
            submenu.append(&child)
        }
        _ => {
            return Err(HostProtocolError::invalid_argument(
                "menu.item.type",
                "must be item, separator, or submenu",
                operation,
            ));
        }
    }
    .map_err(|error| HostProtocolError::invalid_argument("menu", error.to_string(), operation))
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn build_submenu(
    value: &serde_json::Value,
    operation: &'static str,
) -> std::result::Result<tray_icon::menu::Submenu, HostProtocolError> {
    let submenu = tray_icon::menu::Submenu::with_id(
        required_string(value, "id", operation)?,
        required_string(value, "label", operation)?,
        value
            .get("enabled")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(true),
    );
    for item in menu_items(value, "items", operation)? {
        append_submenu_item(&submenu, item, operation)?;
    }
    Ok(submenu)
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn menu_items<'a>(
    value: &'a serde_json::Value,
    field: &str,
    operation: &'static str,
) -> std::result::Result<&'a Vec<serde_json::Value>, HostProtocolError> {
    value
        .get("items")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| HostProtocolError::invalid_argument(field, "must be an array", operation))
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn menu_item_type<'a>(
    value: &'a serde_json::Value,
    operation: &'static str,
) -> std::result::Result<&'a str, HostProtocolError> {
    value
        .get("type")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| {
            HostProtocolError::invalid_argument("menu.item.type", "must be a string", operation)
        })
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn required_string(
    value: &serde_json::Value,
    field: &'static str,
    operation: &'static str,
) -> std::result::Result<String, HostProtocolError> {
    let text = value
        .get(field)
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| {
            HostProtocolError::invalid_argument(
                format!("menu.item.{field}"),
                "must be a string",
                operation,
            )
        })?;
    if text.is_empty() {
        return Err(HostProtocolError::invalid_argument(
            format!("menu.item.{field}"),
            "must not be empty",
            operation,
        ));
    }
    Ok(text.to_string())
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
            Event::WindowEvent {
                window_id,
                event: WindowEvent::Focused(true),
                ..
            } => {
                registry.track_native_window_focused(window_id);
                WindowLifecycleEvent::Other
            }
            Event::WindowEvent {
                window_id,
                event: WindowEvent::CloseRequested,
                ..
            } => handle_native_window_close_requested(&mut registry, window_id),
            event if is_screen_displays_changed_event(&event) => {
                if let Err(error) = registry.emit_screen_displays_changed(target) {
                    warn!(
                        event = "host.screen.displays_changed_failed",
                        error = ?error,
                        "failed to emit screen display change event"
                    );
                }
                WindowLifecycleEvent::Other
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

fn handle_native_window_close_requested(
    registry: &mut WindowRegistry,
    native_window_id: WindowId,
) -> WindowLifecycleEvent {
    #[cfg(test)]
    {
        registry.native_window_close_requested(native_window_id);
        WindowLifecycleEvent::CloseRequested
    }

    #[cfg(not(test))]
    match resident_lifecycle::window_close_action() {
        ResidentWindowCloseAction::DestroyAndExit => {
            registry.native_window_close_requested(native_window_id);
            WindowLifecycleEvent::CloseRequested
        }
        ResidentWindowCloseAction::DestroyAndKeepRunning => {
            registry.native_window_close_requested(native_window_id);
            WindowLifecycleEvent::Other
        }
        ResidentWindowCloseAction::HideAndKeepRunning => {
            registry.native_window_close_requested_to_background(native_window_id);
            WindowLifecycleEvent::Other
        }
    }
}

fn is_screen_displays_changed_event(event: &Event<'_, HostEvent>) -> bool {
    match event {
        Event::WindowEvent { event, .. } => is_screen_displays_changed_window_event(event),
        _ => false,
    }
}

fn is_screen_displays_changed_window_event(event: &WindowEvent<'_>) -> bool {
    matches!(event, WindowEvent::ScaleFactorChanged { .. })
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
        WindowLifecycleEvent::AppQuitRequested(0) => {
            info!(
                event = WINDOW_EXIT_REQUESTED_EVENT,
                source = "app-quit",
                exit_code = 0,
                "host app quit requested"
            );
            ControlFlow::Exit
        }
        WindowLifecycleEvent::AppQuitRequested(exit_code) => {
            info!(
                event = WINDOW_EXIT_REQUESTED_EVENT,
                source = "app-quit",
                exit_code,
                "host app quit requested"
            );
            ControlFlow::ExitWithCode(i32::from(exit_code))
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
    #[cfg(target_os = "linux")]
    use super::linux_wayland_pointer_unsupported_from_env;
    use super::{
        centered_physical_axis, clear_window_runtime_event_state, control_flow_for_lifecycle_event,
        control_flow_for_window_state, emit_window_registry_event,
        handle_native_window_close_requested, install_window_event_sender,
        is_screen_displays_changed_window_event, lifecycle_event_with_smoke_timeout,
        lifecycle_for_create_result, rounded_i32, rounded_u32, screen_bounds_payload,
        smoke_deadline_for_mode, to_tao_dock_progress, unsupported_screen,
        validate_positive_finite, PhysicalScreenArea, RunMode, WindowCommand,
        WindowCommandResponse, WindowCreateRequest, WindowId, WindowLifecycleEvent,
        WindowMethodPort, WindowRegistry, WINDOW_COMMAND_IDLE_POLL_INTERVAL,
        WINDOW_SMOKE_TEST_TIMEOUT,
    };
    use host_protocol::{
        DockProgressState, DockSetProgressOptionsPayload, DockSetProgressPayload,
        HostProtocolEnvelope, HostProtocolError, WindowCreatePayload, WindowCreateResponse,
        WindowRegistryEventPhase,
    };
    use std::collections::HashSet;
    use std::sync::{mpsc, Mutex};
    use std::thread;
    use std::time::Instant;

    static WINDOW_EVENT_TEST_LOCK: Mutex<()> = Mutex::new(());
    use tao::dpi::PhysicalSize;
    use tao::event::WindowEvent;
    use tao::event_loop::ControlFlow;
    use tao::window::ProgressState;

    struct WindowEventSenderGuard;

    impl Drop for WindowEventSenderGuard {
        fn drop(&mut self) {
            let _ = clear_window_runtime_event_state();
        }
    }

    fn install_test_window_event_sender(
    ) -> (mpsc::Receiver<HostProtocolEnvelope>, WindowEventSenderGuard) {
        let (sender, receiver) = mpsc::channel();
        install_window_event_sender(sender).expect("window event sender should install");
        (receiver, WindowEventSenderGuard)
    }

    #[test]
    fn close_requested_exits_with_zero_status() {
        assert_eq!(
            control_flow_for_lifecycle_event(WindowLifecycleEvent::CloseRequested),
            ControlFlow::Exit
        );
    }

    #[test]
    fn app_quit_requested_exits_with_requested_status() {
        assert_eq!(
            control_flow_for_lifecycle_event(WindowLifecycleEvent::AppQuitRequested(0)),
            ControlFlow::Exit
        );
        assert_eq!(
            control_flow_for_lifecycle_event(WindowLifecycleEvent::AppQuitRequested(7)),
            ControlFlow::ExitWithCode(7)
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
    fn window_commands_queue_is_preserved_when_mutex_is_poisoned() {
        let port = WindowMethodPort::new();
        let (reply, _rx) = mpsc::channel();
        port.enqueue_command(WindowCommand::Destroy {
            window_id: "pending".to_string(),
            reply,
        })
        .expect("window command should queue before the native event loop starts");

        let state = port.state.clone();
        let poison_result = thread::spawn(move || {
            let _lock = state.commands.lock().unwrap();
            panic!("intentional panic to poison command mutex");
        })
        .join();

        assert!(poison_result.is_err());
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
    fn scale_factor_changed_is_screen_display_change_signal() {
        let mut new_inner_size = PhysicalSize::new(1024, 768);
        let event = WindowEvent::ScaleFactorChanged {
            scale_factor: 2.0,
            new_inner_size: &mut new_inner_size,
        };

        assert!(is_screen_displays_changed_window_event(&event));
    }

    #[test]
    fn center_on_display_uses_physical_monitor_coordinates() {
        assert_eq!(
            centered_physical_axis(
                3840,
                2560,
                960,
                "x",
                host_protocol::WINDOW_CENTER_ON_DISPLAY_METHOD
            ),
            Ok(4640)
        );
        assert_eq!(
            centered_physical_axis(
                -1920,
                1920,
                2560,
                "x",
                host_protocol::WINDOW_CENTER_ON_DISPLAY_METHOD
            ),
            Ok(-2240)
        );
    }

    #[test]
    fn screen_work_area_payload_can_differ_from_monitor_bounds() {
        let area = PhysicalScreenArea::new(0.0, 25.0, 3024.0, 1719.0)
            .expect("macOS visibleFrame should convert to physical screen area");

        assert_eq!(
            screen_bounds_payload(area),
            host_protocol::ScreenBoundsPayload::new(0.0, 25.0, 3024.0, 1719.0)
        );
    }

    #[test]
    fn screen_work_area_conversion_rejects_invalid_coordinates() {
        assert!(PhysicalScreenArea::new(f64::NAN, 0.0, 100.0, 100.0).is_none());
        assert!(PhysicalScreenArea::new(0.0, 0.0, -1.0, 100.0).is_none());
        assert!(rounded_i32(f64::from(i32::MAX) + 1.0).is_none());
        assert!(rounded_u32(f64::from(u32::MAX) + 1.0).is_none());
    }

    #[test]
    fn center_on_display_uses_work_area_origin_when_available() {
        let work_area =
            PhysicalScreenArea::new(0.0, 25.0, 3024.0, 1719.0).expect("work area should convert");

        assert_eq!(
            centered_physical_axis(
                work_area.y,
                work_area.height,
                900,
                "y",
                host_protocol::WINDOW_CENTER_ON_DISPLAY_METHOD
            ),
            Ok(434)
        );
    }

    #[test]
    fn window_registry_events_encode_to_runtime_sender() {
        let _guard = WINDOW_EVENT_TEST_LOCK
            .lock()
            .expect("window event test lock should not be poisoned");
        let (receiver, _event_sender_guard) = install_test_window_event_sender();

        emit_window_registry_event("window-1", WindowRegistryEventPhase::Shown)
            .expect("window event should emit");

        let event = receiver
            .recv()
            .expect("window event receiver should receive event");

        let HostProtocolEnvelope::Event {
            method,
            window_id,
            payload,
            ..
        } = event
        else {
            panic!("expected window registry event envelope");
        };
        assert_eq!(method, host_protocol::WINDOW_EVENT);
        assert_eq!(window_id.as_deref(), Some("window-1"));
        assert_eq!(
            payload.expect("window event should include payload"),
            serde_json::json!({
                "type": "window-registry-event",
                "phase": "shown",
                "windowId": "window-1",
                "terminal": false
            })
        );
    }

    #[test]
    fn window_state_events_encode_to_runtime_sender() {
        let _guard = WINDOW_EVENT_TEST_LOCK
            .lock()
            .expect("window event test lock should not be poisoned");
        let (receiver, _event_sender_guard) = install_test_window_event_sender();

        super::emit_window_state_event(
            "window-1",
            host_protocol::WindowStatePayload::new(true, false, false, false),
        )
        .expect("window state event should emit");

        let event = receiver
            .recv()
            .expect("window event receiver should receive state event");

        let HostProtocolEnvelope::Event {
            method,
            window_id,
            payload,
            ..
        } = event
        else {
            panic!("expected window state event envelope");
        };
        assert_eq!(method, host_protocol::WINDOW_EVENT);
        assert_eq!(window_id.as_deref(), Some("window-1"));
        assert_eq!(
            payload.expect("window state event should include payload"),
            serde_json::json!({
                "type": "window-state-event",
                "windowId": "window-1",
                "state": {
                    "minimized": true,
                    "maximized": false,
                    "fullscreen": false,
                    "simpleFullscreen": false
                }
            })
        );
    }

    #[test]
    fn window_state_reads_from_host_tracked_command_state() {
        let mut registry = WindowRegistry::new();
        registry.window_states.insert(
            "window-1".to_string(),
            host_protocol::WindowStatePayload::new(false, false, false, false),
        );

        registry.update_window_state("window-1", |state| {
            host_protocol::WindowStatePayload::new(
                true,
                state.maximized(),
                state.fullscreen(),
                state.simple_fullscreen(),
            )
        });

        let state = registry
            .window_state("window-1", host_protocol::WINDOW_GET_STATE_METHOD)
            .expect("tracked window state should read");
        assert!(state.minimized());
        assert!(!state.maximized());
        assert!(!state.fullscreen());
        assert!(!state.simple_fullscreen());
    }

    #[test]
    fn dock_progress_payload_maps_to_tao_progress_bar_state() {
        let progress = DockSetProgressPayload::new(
            serde_json::json!(0.5),
            Some(DockSetProgressOptionsPayload::new(Some(
                DockProgressState::Normal,
            ))),
        );
        let progress_bar =
            to_tao_dock_progress(&progress).expect("dock progress should map to tao state");

        assert_eq!(progress_bar.progress, Some(50));
        assert!(matches!(progress_bar.state, Some(ProgressState::Normal)));
        assert_eq!(progress_bar.desktop_filename, None);

        let clear = DockSetProgressPayload::new(serde_json::Value::Null, None);
        let clear_bar = to_tao_dock_progress(&clear).expect("dock clear should map to tao state");
        assert_eq!(clear_bar.progress, None);
        assert!(matches!(clear_bar.state, Some(ProgressState::None)));
    }

    #[test]
    fn native_close_requested_emits_terminal_event_before_exit_policy() {
        let _guard = WINDOW_EVENT_TEST_LOCK
            .lock()
            .expect("window event test lock should not be poisoned");
        let (receiver, _event_sender_guard) = install_test_window_event_sender();
        // SAFETY: The dummy id stays inside registry bookkeeping and is never passed to Tao.
        let native_window_id = unsafe { WindowId::dummy() };
        let mut registry = WindowRegistry::new();
        registry
            .window_id_by_native_id
            .insert(native_window_id, "window-1".to_string());
        registry.window_order.push("window-1".to_string());
        registry.focused_window_id = Some("window-1".to_string());

        let lifecycle_event = handle_native_window_close_requested(&mut registry, native_window_id);

        assert!(!registry
            .window_id_by_native_id
            .contains_key(&native_window_id));
        assert!(registry.window_order.is_empty());
        assert_eq!(registry.focused_window_id, None);
        let event = receiver
            .recv()
            .expect("window event receiver should receive close event");
        assert!(receiver.try_recv().is_err());

        let HostProtocolEnvelope::Event {
            method,
            window_id,
            payload,
            ..
        } = event
        else {
            panic!("expected window registry event envelope");
        };
        assert_eq!(method, host_protocol::WINDOW_EVENT);
        assert_eq!(window_id.as_deref(), Some("window-1"));
        assert_eq!(
            payload.expect("window event should include payload"),
            serde_json::json!({
                "type": "window-registry-event",
                "phase": "closed",
                "windowId": "window-1",
                "terminal": true
            })
        );

        let now = Instant::now();
        assert_eq!(
            control_flow_for_window_state(
                lifecycle_event_with_smoke_timeout(
                    lifecycle_event,
                    RunMode::Interactive,
                    None,
                    now
                ),
                now
            ),
            ControlFlow::Exit
        );
        assert_eq!(lifecycle_event, WindowLifecycleEvent::CloseRequested);
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
    fn screen_unsupported_error_uses_screen_operation() {
        assert_eq!(
            unsupported_screen(host_protocol::SCREEN_GET_POINTER_POINT_METHOD),
            HostProtocolError::unsupported(
                host_protocol::SCREEN_UNSUPPORTED_REASON,
                host_protocol::SCREEN_GET_POINTER_POINT_METHOD,
            )
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_wayland_pointer_support_is_disabled_without_x11_override() {
        assert!(linux_wayland_pointer_unsupported_from_env(
            Some("wayland"),
            None,
            None
        ));
        assert!(linux_wayland_pointer_unsupported_from_env(
            None,
            Some("wayland"),
            None
        ));
        assert!(linux_wayland_pointer_unsupported_from_env(
            None,
            None,
            Some("wayland-0")
        ));
        assert!(!linux_wayland_pointer_unsupported_from_env(
            Some("x11"),
            Some("wayland"),
            Some("wayland-0")
        ));
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

    #[test]
    fn removing_parent_window_tree_clears_tracked_children() {
        let mut registry = WindowRegistry::new();
        registry
            .child_window_ids_by_parent_id
            .insert("parent".to_string(), HashSet::from(["child".to_string()]));
        registry.child_window_ids_by_parent_id.insert(
            "child".to_string(),
            HashSet::from(["grandchild".to_string()]),
        );
        registry
            .parent_window_id_by_child_id
            .insert("child".to_string(), "parent".to_string());
        registry
            .parent_window_id_by_child_id
            .insert("grandchild".to_string(), "child".to_string());

        assert_eq!(
            registry.remove_window_tree("parent"),
            vec![
                "grandchild".to_string(),
                "child".to_string(),
                "parent".to_string()
            ]
        );
        assert!(registry.child_window_ids_by_parent_id.is_empty());
        assert!(registry.parent_window_id_by_child_id.is_empty());
    }
}
