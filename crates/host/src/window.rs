#![allow(clippy::result_large_err)]
// Host method boundaries return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use crate::methods::resident_lifecycle::{self, ResidentWindowCloseAction};
use crate::{linux, macos, webview, windows};
use anyhow::Result;
use host_protocol::{
    AppBeforeQuitEventPayload, DockProgressState, DockSetProgressPayload, HostProtocolEnvelope,
    HostProtocolError, ScreenBoundsPayload, ScreenDisplayPayload,
    ScreenDisplaysChangedEventPayload, ScreenDisplaysResultPayload, ScreenMethodPayload,
    ScreenPointPayload, ScreenSupportedPayload, TrayActivatedEventPayload, TrayResourcePayload,
    WindowAttentionType, WindowBoundsEventPayload, WindowBoundsPayload, WindowCreatePayload,
    WindowCreateResponse, WindowListResponse, WindowLookupResponse, WindowParentResponse,
    WindowProgressState, WindowRegistryEventPayload, WindowRegistryEventPhase,
    WindowSetProgressPayload, WindowStateEventPayload, WindowStatePayload, WindowTitleBarStyle,
    WindowTrafficLights,
};
use std::{
    cell::RefCell,
    collections::{HashMap, HashSet, VecDeque},
    fs,
    process::{Command, Stdio},
    rc::Rc,
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
pub(crate) const APP_RESTART_CHILD_SMOKE_TEST_ARG: &str = "--app-restart-child-smoke-test";
pub(crate) const APP_RESTART_SMOKE_MARKER_ENV: &str = "EFFECT_DESKTOP_APP_RESTART_SMOKE_MARKER";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum RunMode {
    Interactive,
    HostProtocolStdio,
    WindowSmokeTest,
    ResidentLifecycleSmokeTest,
    SystemAppearanceSmokeTest,
    AppQuitSmokeTest,
    AppFocusSmokeTest,
    AppRestartSmokeTest,
    AppRestartChildSmokeTest,
    SingleInstanceLockSmokeTest,
}

impl RunMode {
    pub(crate) fn is_smoke_test(self) -> bool {
        matches!(
            self,
            RunMode::WindowSmokeTest
                | RunMode::ResidentLifecycleSmokeTest
                | RunMode::AppQuitSmokeTest
                | RunMode::AppFocusSmokeTest
                | RunMode::AppRestartSmokeTest
        )
    }
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

    fn restart(&self, args: &[String]) -> std::result::Result<(), HostProtocolError>;

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
    ) -> std::result::Result<WindowBoundsPayload, HostProtocolError>;

    fn set_bounds_on_display(
        &self,
        window_id: &str,
        display_id: &str,
        bounds: &WindowBoundsPayload,
    ) -> std::result::Result<WindowBoundsPayload, HostProtocolError>;

    fn center(
        &self,
        window_id: &str,
    ) -> std::result::Result<WindowBoundsPayload, HostProtocolError>;

    fn center_on_display(
        &self,
        window_id: &str,
        display_id: &str,
    ) -> std::result::Result<WindowBoundsPayload, HostProtocolError>;

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

    fn clear_vibrancy(&self, window_id: &str) -> std::result::Result<(), HostProtocolError>;

    fn set_shadow(
        &self,
        window_id: &str,
        has_shadow: bool,
    ) -> std::result::Result<(), HostProtocolError>;

    fn set_title_bar_style(
        &self,
        window_id: &str,
        title_bar_style: WindowTitleBarStyle,
    ) -> std::result::Result<(), HostProtocolError>;

    fn set_title_bar_transparent(
        &self,
        window_id: &str,
        title_bar_transparent: bool,
    ) -> std::result::Result<(), HostProtocolError>;

    fn set_transparent(
        &self,
        window_id: &str,
        transparent: bool,
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

    fn minimize(
        &self,
        window_id: &str,
    ) -> std::result::Result<WindowStatePayload, HostProtocolError>;

    fn maximize(
        &self,
        window_id: &str,
    ) -> std::result::Result<WindowStatePayload, HostProtocolError>;

    fn restore(
        &self,
        window_id: &str,
    ) -> std::result::Result<WindowStatePayload, HostProtocolError>;

    fn set_fullscreen(
        &self,
        window_id: &str,
        fullscreen: bool,
    ) -> std::result::Result<WindowStatePayload, HostProtocolError>;

    fn set_simple_fullscreen(
        &self,
        window_id: &str,
        simple_fullscreen: bool,
    ) -> std::result::Result<WindowStatePayload, HostProtocolError>;

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

    fn create_webview(
        &self,
        _request: WebViewCreateRequest,
    ) -> std::result::Result<WebViewResourcePayload, HostProtocolError> {
        Err(HostProtocolError::unsupported(
            host_protocol::WEBVIEW_UNSUPPORTED_REASON,
            host_protocol::WEBVIEW_CREATE_METHOD,
        ))
    }

    fn load_webview_route(
        &self,
        _request: WebViewLoadRouteRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        Err(HostProtocolError::unsupported(
            host_protocol::WEBVIEW_UNSUPPORTED_REASON,
            host_protocol::WEBVIEW_LOAD_ROUTE_METHOD,
        ))
    }

    fn load_webview_url(
        &self,
        _request: WebViewLoadUrlRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        Err(HostProtocolError::unsupported(
            host_protocol::WEBVIEW_UNSUPPORTED_REASON,
            host_protocol::WEBVIEW_LOAD_URL_METHOD,
        ))
    }

    fn reload_webview(
        &self,
        _handle: WebViewHandleRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        Err(HostProtocolError::unsupported(
            host_protocol::WEBVIEW_UNSUPPORTED_REASON,
            host_protocol::WEBVIEW_RELOAD_METHOD,
        ))
    }

    fn stop_webview(
        &self,
        _handle: WebViewHandleRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        Err(HostProtocolError::unsupported(
            host_protocol::WEBVIEW_UNSUPPORTED_REASON,
            host_protocol::WEBVIEW_STOP_METHOD,
        ))
    }

    fn go_back_webview(
        &self,
        _handle: WebViewHandleRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        Err(HostProtocolError::unsupported(
            host_protocol::WEBVIEW_UNSUPPORTED_REASON,
            host_protocol::WEBVIEW_GO_BACK_METHOD,
        ))
    }

    fn go_forward_webview(
        &self,
        _handle: WebViewHandleRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        Err(HostProtocolError::unsupported(
            host_protocol::WEBVIEW_UNSUPPORTED_REASON,
            host_protocol::WEBVIEW_GO_FORWARD_METHOD,
        ))
    }

    fn get_webview_navigation_state(
        &self,
        _handle: WebViewHandleRequest,
    ) -> std::result::Result<WebViewNavigationStatePayload, HostProtocolError> {
        Err(HostProtocolError::unsupported(
            host_protocol::WEBVIEW_UNSUPPORTED_REASON,
            host_protocol::WEBVIEW_GET_NAVIGATION_STATE_METHOD,
        ))
    }

    fn capture_webview_screenshot(
        &self,
        _handle: WebViewHandleRequest,
    ) -> std::result::Result<serde_json::Value, HostProtocolError> {
        Err(HostProtocolError::unsupported(
            "host-document-output-unavailable",
            host_protocol::WEBVIEW_CAPTURE_SCREENSHOT_METHOD,
        ))
    }

    fn print_webview(
        &self,
        _handle: WebViewHandleRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        Err(HostProtocolError::unsupported(
            host_protocol::WEBVIEW_UNSUPPORTED_REASON,
            host_protocol::WEBVIEW_PRINT_METHOD,
        ))
    }

    fn print_webview_to_pdf(
        &self,
        _handle: WebViewHandleRequest,
    ) -> std::result::Result<serde_json::Value, HostProtocolError> {
        Err(HostProtocolError::unsupported(
            "host-document-output-unavailable",
            host_protocol::WEBVIEW_PRINT_TO_PDF_METHOD,
        ))
    }

    fn find_in_webview_page(
        &self,
        _request: WebViewFindInPageRequest,
    ) -> std::result::Result<serde_json::Value, HostProtocolError> {
        Err(HostProtocolError::unsupported(
            "host-document-output-unavailable",
            host_protocol::WEBVIEW_FIND_IN_PAGE_METHOD,
        ))
    }

    fn set_webview_zoom(
        &self,
        _request: WebViewSetZoomRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        Err(HostProtocolError::unsupported(
            host_protocol::WEBVIEW_UNSUPPORTED_REASON,
            host_protocol::WEBVIEW_SET_ZOOM_METHOD,
        ))
    }

    fn set_webview_user_agent(
        &self,
        _request: WebViewSetUserAgentRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        Err(HostProtocolError::unsupported(
            "host-user-agent-runtime-unavailable",
            host_protocol::WEBVIEW_SET_USER_AGENT_METHOD,
        ))
    }

    fn open_webview_devtools(
        &self,
        _handle: WebViewHandleRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        Err(HostProtocolError::unsupported(
            host_protocol::WEBVIEW_UNSUPPORTED_REASON,
            host_protocol::WEBVIEW_OPEN_DEVTOOLS_METHOD,
        ))
    }

    fn close_webview_devtools(
        &self,
        _handle: WebViewHandleRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        Err(HostProtocolError::unsupported(
            host_protocol::WEBVIEW_UNSUPPORTED_REASON,
            host_protocol::WEBVIEW_CLOSE_DEVTOOLS_METHOD,
        ))
    }

    fn attach_webview_debugger(
        &self,
        _handle: WebViewHandleRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        Err(HostProtocolError::unsupported(
            "host-debugger-protocol-unavailable",
            host_protocol::WEBVIEW_ATTACH_DEBUGGER_METHOD,
        ))
    }

    fn set_webview_navigation_policy(
        &self,
        _request: WebViewSetNavigationPolicyRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        Err(HostProtocolError::unsupported(
            host_protocol::WEBVIEW_UNSUPPORTED_REASON,
            host_protocol::WEBVIEW_SET_NAVIGATION_POLICY_METHOD,
        ))
    }

    fn destroy_webview(
        &self,
        _handle: WebViewHandleRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        Err(HostProtocolError::unsupported(
            host_protocol::WEBVIEW_UNSUPPORTED_REASON,
            host_protocol::WEBVIEW_DESTROY_METHOD,
        ))
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct WindowCreateRequest {
    title: String,
    width: f64,
    height: f64,
    parent_window_id: Option<String>,
    macos_polish: Option<macos::MacosWindowPolish>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum WebViewNavigationDecision {
    Block,
    OpenExternal,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct WebViewNavigationPolicy {
    allowed_origins: Vec<String>,
    on_disallowed: WebViewNavigationDecision,
}

impl WebViewNavigationPolicy {
    pub(crate) fn new(
        allowed_origins: Vec<String>,
        on_disallowed: WebViewNavigationDecision,
    ) -> Self {
        Self {
            allowed_origins,
            on_disallowed,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct WebViewCreateRequest {
    window_id: String,
    url: String,
    policy: WebViewNavigationPolicy,
    isolation: Option<WebViewIsolationPolicy>,
}

impl WebViewCreateRequest {
    pub(crate) fn new(
        window_id: String,
        url: String,
        policy: WebViewNavigationPolicy,
        isolation: Option<WebViewIsolationPolicy>,
    ) -> Self {
        Self {
            window_id,
            url,
            policy,
            isolation,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct WebViewIsolationPolicy {
    exposed_apis: Vec<WebViewExposedApi>,
}

impl WebViewIsolationPolicy {
    pub(crate) fn new(exposed_apis: Vec<WebViewExposedApi>) -> Self {
        Self { exposed_apis }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct WebViewExposedApi {
    name: String,
    methods: Vec<String>,
}

impl WebViewExposedApi {
    pub(crate) fn new(name: String, methods: Vec<String>) -> Self {
        Self { name, methods }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct WebViewHandleRequest {
    id: String,
    generation: u64,
    owner_scope: String,
}

impl WebViewHandleRequest {
    pub(crate) fn new(id: String, generation: u64, owner_scope: String) -> Self {
        Self {
            id,
            generation,
            owner_scope,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct WebViewLoadRouteRequest {
    handle: WebViewHandleRequest,
    route: String,
}

impl WebViewLoadRouteRequest {
    pub(crate) fn new(handle: WebViewHandleRequest, route: String) -> Self {
        Self { handle, route }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct WebViewLoadUrlRequest {
    handle: WebViewHandleRequest,
    url: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct WebViewSetNavigationPolicyRequest {
    handle: WebViewHandleRequest,
    policy: WebViewNavigationPolicy,
}

impl WebViewSetNavigationPolicyRequest {
    pub(crate) fn new(handle: WebViewHandleRequest, policy: WebViewNavigationPolicy) -> Self {
        Self { handle, policy }
    }
}

impl WebViewLoadUrlRequest {
    pub(crate) fn new(handle: WebViewHandleRequest, url: String) -> Self {
        Self { handle, url }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct WebViewFindInPageRequest {
    handle: WebViewHandleRequest,
    query: String,
}

impl WebViewFindInPageRequest {
    pub(crate) fn new(handle: WebViewHandleRequest, query: String) -> Self {
        Self { handle, query }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct WebViewSetZoomRequest {
    handle: WebViewHandleRequest,
    zoom: f64,
}

impl WebViewSetZoomRequest {
    pub(crate) fn new(handle: WebViewHandleRequest, zoom: f64) -> Self {
        Self { handle, zoom }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct WebViewSetUserAgentRequest {
    handle: WebViewHandleRequest,
    user_agent: String,
}

impl WebViewSetUserAgentRequest {
    pub(crate) fn new(handle: WebViewHandleRequest, user_agent: String) -> Self {
        Self { handle, user_agent }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct WebViewResourcePayload {
    id: String,
    generation: u64,
    owner_scope: String,
}

impl WebViewResourcePayload {
    fn new(id: String, generation: u64, owner_scope: String) -> Self {
        Self {
            id,
            generation,
            owner_scope,
        }
    }

    pub(crate) fn into_json(self) -> serde_json::Value {
        serde_json::json!({
            "kind": "webview",
            "id": self.id,
            "generation": self.generation,
            "ownerScope": self.owner_scope,
            "state": "open"
        })
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct WebViewNavigationStatePayload {
    can_go_back: bool,
    can_go_forward: bool,
    loading: bool,
}

impl WebViewNavigationStatePayload {
    fn new(can_go_back: bool, can_go_forward: bool, loading: bool) -> Self {
        Self {
            can_go_back,
            can_go_forward,
            loading,
        }
    }

    pub(crate) fn into_json(self) -> serde_json::Value {
        serde_json::json!({
            "canGoBack": self.can_go_back,
            "canGoForward": self.can_go_forward,
            "loading": self.loading
        })
    }
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
    Restart {
        args: Vec<String>,
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
    SetBoundsOnDisplay {
        window_id: String,
        display_id: String,
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
    ClearVibrancy {
        window_id: String,
        reply: Sender<WindowCommandReply>,
    },
    SetShadow {
        window_id: String,
        has_shadow: bool,
        reply: Sender<WindowCommandReply>,
    },
    SetTitleBarStyle {
        window_id: String,
        title_bar_style: WindowTitleBarStyle,
        reply: Sender<WindowCommandReply>,
    },
    SetTitleBarTransparent {
        window_id: String,
        title_bar_transparent: bool,
        reply: Sender<WindowCommandReply>,
    },
    SetTransparent {
        window_id: String,
        transparent: bool,
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
    CreateWebView {
        request: WebViewCreateRequest,
        reply: Sender<WindowCommandReply>,
    },
    LoadWebViewRoute {
        request: WebViewLoadRouteRequest,
        reply: Sender<WindowCommandReply>,
    },
    LoadWebViewUrl {
        request: WebViewLoadUrlRequest,
        reply: Sender<WindowCommandReply>,
    },
    ReloadWebView {
        handle: WebViewHandleRequest,
        reply: Sender<WindowCommandReply>,
    },
    StopWebView {
        handle: WebViewHandleRequest,
        reply: Sender<WindowCommandReply>,
    },
    GoBackWebView {
        handle: WebViewHandleRequest,
        reply: Sender<WindowCommandReply>,
    },
    GoForwardWebView {
        handle: WebViewHandleRequest,
        reply: Sender<WindowCommandReply>,
    },
    GetWebViewNavigationState {
        handle: WebViewHandleRequest,
        reply: Sender<WindowCommandReply>,
    },
    CaptureWebViewScreenshot {
        handle: WebViewHandleRequest,
        reply: Sender<WindowCommandReply>,
    },
    PrintWebView {
        handle: WebViewHandleRequest,
        reply: Sender<WindowCommandReply>,
    },
    PrintWebViewToPdf {
        handle: WebViewHandleRequest,
        reply: Sender<WindowCommandReply>,
    },
    FindInWebViewPage {
        request: WebViewFindInPageRequest,
        reply: Sender<WindowCommandReply>,
    },
    SetWebViewZoom {
        request: WebViewSetZoomRequest,
        reply: Sender<WindowCommandReply>,
    },
    SetWebViewUserAgent {
        request: WebViewSetUserAgentRequest,
        reply: Sender<WindowCommandReply>,
    },
    OpenWebViewDevTools {
        handle: WebViewHandleRequest,
        reply: Sender<WindowCommandReply>,
    },
    CloseWebViewDevTools {
        handle: WebViewHandleRequest,
        reply: Sender<WindowCommandReply>,
    },
    AttachWebViewDebugger {
        handle: WebViewHandleRequest,
        reply: Sender<WindowCommandReply>,
    },
    SetWebViewNavigationPolicy {
        request: WebViewSetNavigationPolicyRequest,
        reply: Sender<WindowCommandReply>,
    },
    DestroyWebView {
        handle: WebViewHandleRequest,
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
    WebViewCreated(WebViewResourcePayload),
    WebViewNavigationState(WebViewNavigationStatePayload),
    WebViewDocument(serde_json::Value),
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

struct NativeWebViewResources {
    _webview: webview::HostWebView,
    generation: u64,
    owner_scope: String,
    policy: SharedWebViewNavigationPolicy,
    navigation: SharedWebViewNavigationState,
}

type SharedWebViewNavigationPolicy = Rc<RefCell<WebViewNavigationPolicy>>;
type SharedWebViewNavigationState = Rc<RefCell<WebViewNavigationState>>;

#[derive(Clone, Debug, Eq, PartialEq)]
struct WebViewNavigationState {
    history: Vec<String>,
    index: usize,
    loading: bool,
}

impl WebViewNavigationState {
    fn new(url: String) -> Self {
        Self {
            history: vec![url],
            index: 0,
            loading: false,
        }
    }

    fn can_go_back(&self) -> bool {
        self.index > 0
    }

    fn can_go_forward(&self) -> bool {
        self.index + 1 < self.history.len()
    }

    fn mark_loading(&mut self, url: &str) {
        self.loading = true;
        self.record_navigation(url);
    }

    fn mark_finished(&mut self, url: &str) {
        self.loading = false;
        self.record_navigation(url);
    }

    fn mark_stopped(&mut self) {
        self.loading = false;
    }

    fn move_back(&mut self) -> bool {
        if !self.can_go_back() {
            return false;
        }
        self.index -= 1;
        self.loading = true;
        true
    }

    fn move_forward(&mut self) -> bool {
        if !self.can_go_forward() {
            return false;
        }
        self.index += 1;
        self.loading = true;
        true
    }

    fn to_payload(&self) -> WebViewNavigationStatePayload {
        WebViewNavigationStatePayload::new(self.can_go_back(), self.can_go_forward(), self.loading)
    }

    fn record_navigation(&mut self, url: &str) {
        if self
            .history
            .get(self.index)
            .is_some_and(|current| current == url)
        {
            return;
        }
        if self.index > 0
            && self
                .history
                .get(self.index - 1)
                .is_some_and(|prev| prev == url)
        {
            self.index -= 1;
            return;
        }
        if self
            .history
            .get(self.index + 1)
            .is_some_and(|next| next == url)
        {
            self.index += 1;
            return;
        }
        self.history.truncate(self.index + 1);
        self.history.push(url.to_string());
        self.index = self.history.len() - 1;
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
struct NativeTrayResources {
    _tray: tray_icon::TrayIcon,
    generation: u64,
    owner_scope: String,
}

struct WindowRegistry {
    windows: HashMap<String, NativeWindowResources>,
    webviews: HashMap<String, NativeWebViewResources>,
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
static WEBVIEW_EVENT_SENDER: LazyLock<Mutex<Option<Sender<HostProtocolEnvelope>>>> =
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
            | WindowCommandResponse::ScreenSupported(_)
            | WindowCommandResponse::WebViewCreated(_)
            | WindowCommandResponse::WebViewNavigationState(_)
            | WindowCommandResponse::WebViewDocument(_) => Err(HostProtocolError::internal(
                "window lifecycle command received unrelated response",
                operation,
            )),
        }
    }

    fn expect_window_state_response(
        &self,
        reply: Receiver<WindowCommandReply>,
        operation: &'static str,
    ) -> std::result::Result<WindowStatePayload, HostProtocolError> {
        match self.recv_reply(reply)? {
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
            | WindowCommandResponse::ScreenSupported(_)
            | WindowCommandResponse::WebViewCreated(_)
            | WindowCommandResponse::WebViewNavigationState(_)
            | WindowCommandResponse::WebViewDocument(_) => Err(HostProtocolError::internal(
                "window state command received unrelated response",
                operation,
            )),
        }
    }

    fn expect_window_bounds_response(
        &self,
        reply: Receiver<WindowCommandReply>,
        operation: &'static str,
    ) -> std::result::Result<WindowBoundsPayload, HostProtocolError> {
        match self.recv_reply(reply)? {
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
            | WindowCommandResponse::ScreenSupported(_)
            | WindowCommandResponse::WebViewCreated(_)
            | WindowCommandResponse::WebViewNavigationState(_)
            | WindowCommandResponse::WebViewDocument(_) => Err(HostProtocolError::internal(
                "window placement command received unrelated response",
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

    fn restart(&self, args: &[String]) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::Restart {
            args: args.to_vec(),
            reply: reply_tx,
        })?;

        self.expect_window_void_response(reply_rx, host_protocol::APP_RESTART_METHOD)
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
            | WindowCommandResponse::ScreenSupported(_)
            | WindowCommandResponse::WebViewCreated(_)
            | WindowCommandResponse::WebViewNavigationState(_)
            | WindowCommandResponse::WebViewDocument(_) => Err(HostProtocolError::internal(
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
            | WindowCommandResponse::ScreenSupported(_)
            | WindowCommandResponse::WebViewCreated(_)
            | WindowCommandResponse::WebViewNavigationState(_)
            | WindowCommandResponse::WebViewDocument(_) => Err(HostProtocolError::internal(
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
            | WindowCommandResponse::ScreenSupported(_)
            | WindowCommandResponse::WebViewCreated(_)
            | WindowCommandResponse::WebViewNavigationState(_)
            | WindowCommandResponse::WebViewDocument(_) => Err(HostProtocolError::internal(
                "window get bounds received unrelated response",
                host_protocol::WINDOW_GET_BOUNDS_METHOD,
            )),
        }
    }

    fn set_bounds(
        &self,
        window_id: &str,
        bounds: &WindowBoundsPayload,
    ) -> std::result::Result<WindowBoundsPayload, HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::SetBounds {
            window_id: window_id.to_string(),
            bounds: bounds.clone(),
            reply: reply_tx,
        })?;

        self.expect_window_bounds_response(reply_rx, host_protocol::WINDOW_SET_BOUNDS_METHOD)
    }

    fn set_bounds_on_display(
        &self,
        window_id: &str,
        display_id: &str,
        bounds: &WindowBoundsPayload,
    ) -> std::result::Result<WindowBoundsPayload, HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::SetBoundsOnDisplay {
            window_id: window_id.to_string(),
            display_id: display_id.to_string(),
            bounds: bounds.clone(),
            reply: reply_tx,
        })?;

        self.expect_window_bounds_response(
            reply_rx,
            host_protocol::WINDOW_SET_BOUNDS_ON_DISPLAY_METHOD,
        )
    }

    fn center(
        &self,
        window_id: &str,
    ) -> std::result::Result<WindowBoundsPayload, HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::Center {
            window_id: window_id.to_string(),
            reply: reply_tx,
        })?;

        self.expect_window_bounds_response(reply_rx, host_protocol::WINDOW_CENTER_METHOD)
    }

    fn center_on_display(
        &self,
        window_id: &str,
        display_id: &str,
    ) -> std::result::Result<WindowBoundsPayload, HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::CenterOnDisplay {
            window_id: window_id.to_string(),
            display_id: display_id.to_string(),
            reply: reply_tx,
        })?;

        self.expect_window_bounds_response(reply_rx, host_protocol::WINDOW_CENTER_ON_DISPLAY_METHOD)
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

    fn clear_vibrancy(&self, window_id: &str) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::ClearVibrancy {
            window_id: window_id.to_string(),
            reply: reply_tx,
        })?;

        self.expect_window_void_response(reply_rx, host_protocol::WINDOW_CLEAR_VIBRANCY_METHOD)
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

    fn set_title_bar_style(
        &self,
        window_id: &str,
        title_bar_style: WindowTitleBarStyle,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::SetTitleBarStyle {
            window_id: window_id.to_string(),
            title_bar_style,
            reply: reply_tx,
        })?;

        self.expect_window_void_response(reply_rx, host_protocol::WINDOW_SET_TITLE_BAR_STYLE_METHOD)
    }

    fn set_title_bar_transparent(
        &self,
        window_id: &str,
        title_bar_transparent: bool,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::SetTitleBarTransparent {
            window_id: window_id.to_string(),
            title_bar_transparent,
            reply: reply_tx,
        })?;

        self.expect_window_void_response(
            reply_rx,
            host_protocol::WINDOW_SET_TITLE_BAR_TRANSPARENT_METHOD,
        )
    }

    fn set_transparent(
        &self,
        window_id: &str,
        transparent: bool,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::SetTransparent {
            window_id: window_id.to_string(),
            transparent,
            reply: reply_tx,
        })?;

        self.expect_window_void_response(reply_rx, host_protocol::WINDOW_SET_TRANSPARENT_METHOD)
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

    fn minimize(
        &self,
        window_id: &str,
    ) -> std::result::Result<WindowStatePayload, HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::Minimize {
            window_id: window_id.to_string(),
            reply: reply_tx,
        })?;

        self.expect_window_state_response(reply_rx, host_protocol::WINDOW_MINIMIZE_METHOD)
    }

    fn maximize(
        &self,
        window_id: &str,
    ) -> std::result::Result<WindowStatePayload, HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::Maximize {
            window_id: window_id.to_string(),
            reply: reply_tx,
        })?;

        self.expect_window_state_response(reply_rx, host_protocol::WINDOW_MAXIMIZE_METHOD)
    }

    fn restore(
        &self,
        window_id: &str,
    ) -> std::result::Result<WindowStatePayload, HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::Restore {
            window_id: window_id.to_string(),
            reply: reply_tx,
        })?;

        self.expect_window_state_response(reply_rx, host_protocol::WINDOW_RESTORE_METHOD)
    }

    fn set_fullscreen(
        &self,
        window_id: &str,
        fullscreen: bool,
    ) -> std::result::Result<WindowStatePayload, HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::SetFullscreen {
            window_id: window_id.to_string(),
            fullscreen,
            reply: reply_tx,
        })?;

        self.expect_window_state_response(reply_rx, host_protocol::WINDOW_SET_FULLSCREEN_METHOD)
    }

    fn set_simple_fullscreen(
        &self,
        window_id: &str,
        simple_fullscreen: bool,
    ) -> std::result::Result<WindowStatePayload, HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::SetSimpleFullscreen {
            window_id: window_id.to_string(),
            simple_fullscreen,
            reply: reply_tx,
        })?;

        self.expect_window_state_response(
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
            | WindowCommandResponse::ScreenSupported(_)
            | WindowCommandResponse::WebViewCreated(_)
            | WindowCommandResponse::WebViewNavigationState(_)
            | WindowCommandResponse::WebViewDocument(_) => Err(HostProtocolError::internal(
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
            | WindowCommandResponse::ScreenSupported(_)
            | WindowCommandResponse::WebViewCreated(_)
            | WindowCommandResponse::WebViewNavigationState(_)
            | WindowCommandResponse::WebViewDocument(_) => Err(HostProtocolError::internal(
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
            | WindowCommandResponse::ScreenSupported(_)
            | WindowCommandResponse::WebViewCreated(_)
            | WindowCommandResponse::WebViewNavigationState(_)
            | WindowCommandResponse::WebViewDocument(_) => Err(HostProtocolError::internal(
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
            | WindowCommandResponse::ScreenSupported(_)
            | WindowCommandResponse::WebViewCreated(_)
            | WindowCommandResponse::WebViewNavigationState(_)
            | WindowCommandResponse::WebViewDocument(_) => Err(HostProtocolError::internal(
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
            | WindowCommandResponse::ScreenSupported(_)
            | WindowCommandResponse::WebViewCreated(_)
            | WindowCommandResponse::WebViewNavigationState(_)
            | WindowCommandResponse::WebViewDocument(_) => Err(HostProtocolError::internal(
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
            | WindowCommandResponse::ScreenSupported(_)
            | WindowCommandResponse::WebViewCreated(_)
            | WindowCommandResponse::WebViewNavigationState(_)
            | WindowCommandResponse::WebViewDocument(_) => Err(HostProtocolError::internal(
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
            | WindowCommandResponse::ScreenSupported(_)
            | WindowCommandResponse::WebViewCreated(_)
            | WindowCommandResponse::WebViewNavigationState(_)
            | WindowCommandResponse::WebViewDocument(_) => Err(HostProtocolError::internal(
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

    fn create_webview(
        &self,
        request: WebViewCreateRequest,
    ) -> std::result::Result<WebViewResourcePayload, HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::CreateWebView {
            request,
            reply: reply_tx,
        })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::WebViewCreated(webview) => Ok(webview),
            response => Err(unexpected_webview_response(
                response,
                host_protocol::WEBVIEW_CREATE_METHOD,
            )),
        }
    }

    fn load_webview_route(
        &self,
        request: WebViewLoadRouteRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::LoadWebViewRoute {
            request,
            reply: reply_tx,
        })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::WindowUpdated => Ok(()),
            response => Err(unexpected_webview_response(
                response,
                host_protocol::WEBVIEW_LOAD_ROUTE_METHOD,
            )),
        }
    }

    fn load_webview_url(
        &self,
        request: WebViewLoadUrlRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::LoadWebViewUrl {
            request,
            reply: reply_tx,
        })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::WindowUpdated => Ok(()),
            response => Err(unexpected_webview_response(
                response,
                host_protocol::WEBVIEW_LOAD_URL_METHOD,
            )),
        }
    }

    fn reload_webview(
        &self,
        handle: WebViewHandleRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::ReloadWebView {
            handle,
            reply: reply_tx,
        })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::WindowUpdated => Ok(()),
            response => Err(unexpected_webview_response(
                response,
                host_protocol::WEBVIEW_RELOAD_METHOD,
            )),
        }
    }

    fn stop_webview(
        &self,
        handle: WebViewHandleRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::StopWebView {
            handle,
            reply: reply_tx,
        })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::WindowUpdated => Ok(()),
            response => Err(unexpected_webview_response(
                response,
                host_protocol::WEBVIEW_STOP_METHOD,
            )),
        }
    }

    fn go_back_webview(
        &self,
        handle: WebViewHandleRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::GoBackWebView {
            handle,
            reply: reply_tx,
        })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::WindowUpdated => Ok(()),
            response => Err(unexpected_webview_response(
                response,
                host_protocol::WEBVIEW_GO_BACK_METHOD,
            )),
        }
    }

    fn go_forward_webview(
        &self,
        handle: WebViewHandleRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::GoForwardWebView {
            handle,
            reply: reply_tx,
        })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::WindowUpdated => Ok(()),
            response => Err(unexpected_webview_response(
                response,
                host_protocol::WEBVIEW_GO_FORWARD_METHOD,
            )),
        }
    }

    fn get_webview_navigation_state(
        &self,
        handle: WebViewHandleRequest,
    ) -> std::result::Result<WebViewNavigationStatePayload, HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::GetWebViewNavigationState {
            handle,
            reply: reply_tx,
        })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::WebViewNavigationState(state) => Ok(state),
            response => Err(unexpected_webview_response(
                response,
                host_protocol::WEBVIEW_GET_NAVIGATION_STATE_METHOD,
            )),
        }
    }

    fn capture_webview_screenshot(
        &self,
        handle: WebViewHandleRequest,
    ) -> std::result::Result<serde_json::Value, HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::CaptureWebViewScreenshot {
            handle,
            reply: reply_tx,
        })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::WebViewDocument(response) => Ok(response),
            response => Err(unexpected_webview_response(
                response,
                host_protocol::WEBVIEW_CAPTURE_SCREENSHOT_METHOD,
            )),
        }
    }

    fn print_webview(
        &self,
        handle: WebViewHandleRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::PrintWebView {
            handle,
            reply: reply_tx,
        })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::WindowUpdated => Ok(()),
            response => Err(unexpected_webview_response(
                response,
                host_protocol::WEBVIEW_PRINT_METHOD,
            )),
        }
    }

    fn print_webview_to_pdf(
        &self,
        handle: WebViewHandleRequest,
    ) -> std::result::Result<serde_json::Value, HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::PrintWebViewToPdf {
            handle,
            reply: reply_tx,
        })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::WebViewDocument(response) => Ok(response),
            response => Err(unexpected_webview_response(
                response,
                host_protocol::WEBVIEW_PRINT_TO_PDF_METHOD,
            )),
        }
    }

    fn find_in_webview_page(
        &self,
        request: WebViewFindInPageRequest,
    ) -> std::result::Result<serde_json::Value, HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::FindInWebViewPage {
            request,
            reply: reply_tx,
        })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::WebViewDocument(response) => Ok(response),
            response => Err(unexpected_webview_response(
                response,
                host_protocol::WEBVIEW_FIND_IN_PAGE_METHOD,
            )),
        }
    }

    fn set_webview_zoom(
        &self,
        request: WebViewSetZoomRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::SetWebViewZoom {
            request,
            reply: reply_tx,
        })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::WindowUpdated => Ok(()),
            response => Err(unexpected_webview_response(
                response,
                host_protocol::WEBVIEW_SET_ZOOM_METHOD,
            )),
        }
    }

    fn set_webview_user_agent(
        &self,
        request: WebViewSetUserAgentRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::SetWebViewUserAgent {
            request,
            reply: reply_tx,
        })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::WindowUpdated => Ok(()),
            response => Err(unexpected_webview_response(
                response,
                host_protocol::WEBVIEW_SET_USER_AGENT_METHOD,
            )),
        }
    }

    fn open_webview_devtools(
        &self,
        handle: WebViewHandleRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::OpenWebViewDevTools {
            handle,
            reply: reply_tx,
        })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::WindowUpdated => Ok(()),
            response => Err(unexpected_webview_response(
                response,
                host_protocol::WEBVIEW_OPEN_DEVTOOLS_METHOD,
            )),
        }
    }

    fn close_webview_devtools(
        &self,
        handle: WebViewHandleRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::CloseWebViewDevTools {
            handle,
            reply: reply_tx,
        })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::WindowUpdated => Ok(()),
            response => Err(unexpected_webview_response(
                response,
                host_protocol::WEBVIEW_CLOSE_DEVTOOLS_METHOD,
            )),
        }
    }

    fn attach_webview_debugger(
        &self,
        handle: WebViewHandleRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::AttachWebViewDebugger {
            handle,
            reply: reply_tx,
        })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::WindowUpdated => Ok(()),
            response => Err(unexpected_webview_response(
                response,
                host_protocol::WEBVIEW_ATTACH_DEBUGGER_METHOD,
            )),
        }
    }

    fn set_webview_navigation_policy(
        &self,
        request: WebViewSetNavigationPolicyRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::SetWebViewNavigationPolicy {
            request,
            reply: reply_tx,
        })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::WindowUpdated => Ok(()),
            response => Err(unexpected_webview_response(
                response,
                host_protocol::WEBVIEW_SET_NAVIGATION_POLICY_METHOD,
            )),
        }
    }

    fn destroy_webview(
        &self,
        handle: WebViewHandleRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.enqueue_command(WindowCommand::DestroyWebView {
            handle,
            reply: reply_tx,
        })?;

        match self.recv_reply(reply_rx)? {
            WindowCommandResponse::Destroyed => Ok(()),
            response => Err(unexpected_webview_response(
                response,
                host_protocol::WEBVIEW_DESTROY_METHOD,
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
            webviews: HashMap::new(),
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
            smoke = mode.is_smoke_test(),
            "host window opened"
        );

        let webview = webview::attach_app_webview(&window).map_err(|error| *error)?;
        let native_window_id = window.id();
        self.windows.insert(
            window_id.clone(),
            NativeWindowResources {
                _window: window,
                _webview: webview,
            },
        );
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

    fn emit_native_window_close_requested(&self, native_window_id: WindowId) {
        let Some(window_id) = self.window_id_by_native_id.get(&native_window_id).cloned() else {
            return;
        };
        if let Err(error) =
            emit_window_registry_event(&window_id, WindowRegistryEventPhase::CloseRequested)
        {
            warn!(
                event = "host.window.event_emit_failed",
                error = ?error,
                window_id,
                "failed to emit native window close-requested event"
            );
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
    ) -> std::result::Result<WindowBoundsPayload, HostProtocolError> {
        let Some(resources) = self.windows.get(window_id) else {
            return Err(HostProtocolError::not_found(
                format!("Window:{window_id}"),
                host_protocol::WINDOW_SET_BOUNDS_METHOD,
            ));
        };

        let clipped_bounds = resources
            ._window
            .current_monitor()
            .map(|monitor| clip_window_bounds_to_monitor_work_area(bounds, &monitor))
            .unwrap_or_else(|| bounds.clone());

        resources
            ._window
            .set_outer_position(LogicalPosition::new(clipped_bounds.x(), clipped_bounds.y()));
        resources._window.set_inner_size(LogicalSize::new(
            clipped_bounds.width(),
            clipped_bounds.height(),
        ));
        window_bounds(&resources._window, host_protocol::WINDOW_SET_BOUNDS_METHOD)
    }

    fn set_bounds_on_display(
        &self,
        window_id: &str,
        display_id: &str,
        bounds: &WindowBoundsPayload,
    ) -> std::result::Result<WindowBoundsPayload, HostProtocolError> {
        let Some(resources) = self.windows.get(window_id) else {
            return Err(HostProtocolError::not_found(
                format!("Window:{window_id}"),
                host_protocol::WINDOW_SET_BOUNDS_ON_DISPLAY_METHOD,
            ));
        };
        let Some(monitor) = resources
            ._window
            .available_monitors()
            .find(|monitor| screen_display_id(monitor) == display_id)
        else {
            return Err(HostProtocolError::not_found(
                format!("ScreenDisplay:{display_id}"),
                host_protocol::WINDOW_SET_BOUNDS_ON_DISPLAY_METHOD,
            ));
        };
        let bounds = display_relative_bounds_to_physical_position(
            bounds,
            &monitor,
            host_protocol::WINDOW_SET_BOUNDS_ON_DISPLAY_METHOD,
        )?;
        resources._window.set_outer_position(bounds.position);
        resources
            ._window
            .set_inner_size(LogicalSize::new(bounds.size.width, bounds.size.height));
        window_bounds(
            &resources._window,
            host_protocol::WINDOW_SET_BOUNDS_ON_DISPLAY_METHOD,
        )
    }

    fn center(
        &self,
        window_id: &str,
    ) -> std::result::Result<WindowBoundsPayload, HostProtocolError> {
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
        window_bounds(&resources._window, host_protocol::WINDOW_CENTER_METHOD)
    }

    fn center_on_display(
        &self,
        window_id: &str,
        display_id: &str,
    ) -> std::result::Result<WindowBoundsPayload, HostProtocolError> {
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
        window_bounds(
            &resources._window,
            host_protocol::WINDOW_CENTER_ON_DISPLAY_METHOD,
        )
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

    fn clear_vibrancy(&self, window_id: &str) -> std::result::Result<(), HostProtocolError> {
        let Some(resources) = self.windows.get(window_id) else {
            return Err(HostProtocolError::not_found(
                format!("Window:{window_id}"),
                host_protocol::WINDOW_CLEAR_VIBRANCY_METHOD,
            ));
        };

        macos::clear_vibrancy(&resources._window)
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

    fn set_title_bar_transparent(
        &self,
        window_id: &str,
        title_bar_transparent: bool,
    ) -> std::result::Result<(), HostProtocolError> {
        let Some(resources) = self.windows.get(window_id) else {
            return Err(HostProtocolError::not_found(
                format!("Window:{window_id}"),
                host_protocol::WINDOW_SET_TITLE_BAR_TRANSPARENT_METHOD,
            ));
        };

        macos::set_title_bar_transparent(&resources._window, title_bar_transparent)
    }

    fn set_title_bar_style(
        &self,
        window_id: &str,
        title_bar_style: WindowTitleBarStyle,
    ) -> std::result::Result<(), HostProtocolError> {
        let Some(resources) = self.windows.get(window_id) else {
            return Err(HostProtocolError::not_found(
                format!("Window:{window_id}"),
                host_protocol::WINDOW_SET_TITLE_BAR_STYLE_METHOD,
            ));
        };

        macos::set_title_bar_style(&resources._window, title_bar_style)
    }

    fn set_transparent(
        &self,
        window_id: &str,
        transparent: bool,
    ) -> std::result::Result<(), HostProtocolError> {
        let Some(resources) = self.windows.get(window_id) else {
            return Err(HostProtocolError::not_found(
                format!("Window:{window_id}"),
                host_protocol::WINDOW_SET_TRANSPARENT_METHOD,
            ));
        };

        macos::set_transparent(&resources._window, transparent)
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

    fn minimize(
        &mut self,
        window_id: &str,
    ) -> std::result::Result<WindowStatePayload, HostProtocolError> {
        let Some(resources) = self.windows.get(window_id) else {
            return Err(HostProtocolError::not_found(
                format!("Window:{window_id}"),
                host_protocol::WINDOW_MINIMIZE_METHOD,
            ));
        };

        resources._window.set_minimized(true);
        let observed = tao_window_state(&resources._window);
        ensure_window_state(
            &observed,
            observed.minimized(),
            "minimized=true",
            host_protocol::WINDOW_MINIMIZE_METHOD,
        )?;
        Ok(observed)
    }

    fn maximize(
        &mut self,
        window_id: &str,
    ) -> std::result::Result<WindowStatePayload, HostProtocolError> {
        let Some(resources) = self.windows.get(window_id) else {
            return Err(HostProtocolError::not_found(
                format!("Window:{window_id}"),
                host_protocol::WINDOW_MAXIMIZE_METHOD,
            ));
        };

        resources._window.set_maximized(true);
        let observed = tao_window_state(&resources._window);
        ensure_window_state(
            &observed,
            observed.maximized(),
            "maximized=true",
            host_protocol::WINDOW_MAXIMIZE_METHOD,
        )?;
        Ok(observed)
    }

    fn restore(
        &mut self,
        window_id: &str,
    ) -> std::result::Result<WindowStatePayload, HostProtocolError> {
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
        let observed = tao_window_state(&resources._window);
        ensure_window_state(
            &observed,
            !observed.minimized()
                && !observed.maximized()
                && !observed.fullscreen()
                && !observed.simple_fullscreen(),
            "restored",
            host_protocol::WINDOW_RESTORE_METHOD,
        )?;
        Ok(observed)
    }

    fn set_fullscreen(
        &mut self,
        window_id: &str,
        fullscreen: bool,
    ) -> std::result::Result<WindowStatePayload, HostProtocolError> {
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
        let observed = tao_window_state(&resources._window);
        ensure_window_state(
            &observed,
            observed.fullscreen() == fullscreen,
            if fullscreen {
                "fullscreen=true"
            } else {
                "fullscreen=false"
            },
            host_protocol::WINDOW_SET_FULLSCREEN_METHOD,
        )?;
        Ok(observed)
    }

    fn set_simple_fullscreen(
        &mut self,
        window_id: &str,
        simple_fullscreen: bool,
    ) -> std::result::Result<WindowStatePayload, HostProtocolError> {
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
        let observed = tao_window_state(&resources._window);
        ensure_window_state(
            &observed,
            observed.simple_fullscreen() == simple_fullscreen,
            if simple_fullscreen {
                "simpleFullscreen=true"
            } else {
                "simpleFullscreen=false"
            },
            host_protocol::WINDOW_SET_SIMPLE_FULLSCREEN_METHOD,
        )?;
        Ok(observed)
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
        let Some(resources) = self.windows.get(window_id) else {
            return Err(HostProtocolError::not_found(
                format!("Window:{window_id}"),
                operation,
            ));
        };

        Ok(tao_window_state(&resources._window))
    }

    fn emit_observed_window_state(&self, window_id: &str, state: &WindowStatePayload) {
        if let Err(error) = emit_window_state_event(window_id, state.clone()) {
            warn!(
                event = "host.window.event_emit_failed",
                error = ?error,
                window_id,
                "failed to emit window state event"
            );
        }
    }

    fn emit_native_window_bounds_event(&self, native_window_id: WindowId) {
        let Some(window_id) = self.window_id_by_native_id.get(&native_window_id).cloned() else {
            return;
        };
        let Some(resources) = self.windows.get(&window_id) else {
            return;
        };
        match window_bounds(&resources._window, host_protocol::WINDOW_EVENT) {
            Ok(bounds) => {
                if let Err(error) = emit_window_bounds_event(&window_id, bounds) {
                    warn!(
                        event = "host.window.event_emit_failed",
                        error = ?error,
                        window_id,
                        "failed to emit window bounds event"
                    );
                }
            }
            Err(error) => {
                warn!(
                    event = "host.window.bounds_event_failed",
                    error = ?error,
                    window_id,
                    "failed to read window bounds for event"
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

    fn create_webview(
        &mut self,
        request: WebViewCreateRequest,
    ) -> std::result::Result<WebViewResourcePayload, HostProtocolError> {
        let Some(window) = self.windows.get(&request.window_id) else {
            return Err(HostProtocolError::not_found(
                format!("Window:{}", request.window_id),
                host_protocol::WEBVIEW_CREATE_METHOD,
            ));
        };

        if !origin_allowed(&request.url, &request.policy) {
            return Err(webview_permission_denied(
                "WebView.create denied by origin policy",
                host_protocol::WEBVIEW_CREATE_METHOD,
            ));
        }

        let webview_id = Uuid::now_v7().to_string();
        let owner_scope = format!("window:{}", request.window_id);
        let navigation = Rc::new(RefCell::new(WebViewNavigationState::new(
            request.url.clone(),
        )));
        let policy = Rc::new(RefCell::new(request.policy));
        let navigation_for_policy = Rc::clone(&navigation);
        let navigation_for_load = Rc::clone(&navigation);
        let policy_for_handler = Rc::clone(&policy);
        let policy_for_new_window = Rc::clone(&policy);
        let webview_id_for_navigation = webview_id.clone();
        let webview_id_for_new_window = webview_id.clone();
        let owner_scope_for_event = owner_scope.clone();
        let owner_scope_for_new_window = owner_scope.clone();
        let isolation = request
            .isolation
            .map(|policy| webview_isolation(&webview_id, &owner_scope, policy));
        let webview = webview::attach_child_webview(
            &window._window,
            webview::ChildWebViewRequest {
                url: request.url,
                navigation_handler: Box::new(move |url| {
                    if !origin_allowed(&url, &policy_for_handler.borrow()) {
                        emit_webview_navigation_blocked_event(
                            &webview_id_for_navigation,
                            &owner_scope_for_event,
                            &url,
                            "origin-policy",
                        );
                        return false;
                    }
                    navigation_for_policy.borrow_mut().mark_loading(&url);
                    true
                }),
                new_window_handler: Box::new(move |url, _features| {
                    if !origin_allowed(&url, &policy_for_new_window.borrow()) {
                        emit_webview_navigation_blocked_event(
                            &webview_id_for_new_window,
                            &owner_scope_for_new_window,
                            &url,
                            "popup-policy",
                        );
                    }
                    wry::NewWindowResponse::Deny
                }),
                isolation,
                page_load_handler: Box::new(move |event, url| match event {
                    wry::PageLoadEvent::Started => {
                        navigation_for_load.borrow_mut().mark_loading(&url);
                    }
                    wry::PageLoadEvent::Finished => {
                        navigation_for_load.borrow_mut().mark_finished(&url);
                    }
                }),
            },
        )
        .map_err(|error| *error)?;

        self.webviews.insert(
            webview_id.clone(),
            NativeWebViewResources {
                _webview: webview,
                generation: 0,
                owner_scope: owner_scope.clone(),
                policy,
                navigation,
            },
        );

        Ok(WebViewResourcePayload::new(webview_id, 0, owner_scope))
    }

    fn load_webview_route(
        &mut self,
        request: WebViewLoadRouteRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        let url = format!("app://localhost{}", request.route);
        self.load_webview_url(WebViewLoadUrlRequest::new(request.handle, url))
    }

    fn load_webview_url(
        &mut self,
        request: WebViewLoadUrlRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        let resources =
            self.webview_resources(&request.handle, host_protocol::WEBVIEW_LOAD_URL_METHOD)?;
        if !origin_allowed(&request.url, &resources.policy.borrow()) {
            return Err(webview_permission_denied(
                "WebView.loadUrl denied by origin policy",
                host_protocol::WEBVIEW_LOAD_URL_METHOD,
            ));
        }
        resources
            ._webview
            .load_url(&request.url)
            .map_err(|error| webview_host_error(error, host_protocol::WEBVIEW_LOAD_URL_METHOD))?;
        resources.navigation.borrow_mut().mark_loading(&request.url);
        Ok(())
    }

    fn reload_webview(
        &mut self,
        handle: &WebViewHandleRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        let resources = self.webview_resources(handle, host_protocol::WEBVIEW_RELOAD_METHOD)?;
        resources
            ._webview
            .reload()
            .map_err(|error| webview_host_error(error, host_protocol::WEBVIEW_RELOAD_METHOD))?;
        resources.navigation.borrow_mut().loading = true;
        Ok(())
    }

    fn stop_webview(
        &mut self,
        handle: &WebViewHandleRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        let resources = self.webview_resources(handle, host_protocol::WEBVIEW_STOP_METHOD)?;
        resources
            ._webview
            .evaluate_script("window.stop()")
            .map_err(|error| webview_host_error(error, host_protocol::WEBVIEW_STOP_METHOD))?;
        resources.navigation.borrow_mut().mark_stopped();
        Ok(())
    }

    fn go_back_webview(
        &mut self,
        handle: &WebViewHandleRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        let resources = self.webview_resources(handle, host_protocol::WEBVIEW_GO_BACK_METHOD)?;
        resources
            ._webview
            .evaluate_script("history.back()")
            .map_err(|error| webview_host_error(error, host_protocol::WEBVIEW_GO_BACK_METHOD))?;
        resources.navigation.borrow_mut().move_back();
        Ok(())
    }

    fn go_forward_webview(
        &mut self,
        handle: &WebViewHandleRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        let resources = self.webview_resources(handle, host_protocol::WEBVIEW_GO_FORWARD_METHOD)?;
        resources
            ._webview
            .evaluate_script("history.forward()")
            .map_err(|error| webview_host_error(error, host_protocol::WEBVIEW_GO_FORWARD_METHOD))?;
        resources.navigation.borrow_mut().move_forward();
        Ok(())
    }

    fn get_webview_navigation_state(
        &self,
        handle: &WebViewHandleRequest,
    ) -> std::result::Result<WebViewNavigationStatePayload, HostProtocolError> {
        let resources =
            self.webview_resources(handle, host_protocol::WEBVIEW_GET_NAVIGATION_STATE_METHOD)?;
        Ok(resources.navigation.borrow().to_payload())
    }

    fn capture_webview_screenshot(
        &self,
        handle: &WebViewHandleRequest,
    ) -> std::result::Result<serde_json::Value, HostProtocolError> {
        let _resources =
            self.webview_resources(handle, host_protocol::WEBVIEW_CAPTURE_SCREENSHOT_METHOD)?;
        Err(HostProtocolError::unsupported(
            "host-document-output-unavailable",
            host_protocol::WEBVIEW_CAPTURE_SCREENSHOT_METHOD,
        ))
    }

    fn print_webview(
        &self,
        handle: &WebViewHandleRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        let resources = self.webview_resources(handle, host_protocol::WEBVIEW_PRINT_METHOD)?;
        webview::print(&resources._webview)
    }

    fn print_webview_to_pdf(
        &self,
        handle: &WebViewHandleRequest,
    ) -> std::result::Result<serde_json::Value, HostProtocolError> {
        let _resources =
            self.webview_resources(handle, host_protocol::WEBVIEW_PRINT_TO_PDF_METHOD)?;
        Err(HostProtocolError::unsupported(
            "host-document-output-unavailable",
            host_protocol::WEBVIEW_PRINT_TO_PDF_METHOD,
        ))
    }

    fn find_in_webview_page(
        &self,
        request: &WebViewFindInPageRequest,
    ) -> std::result::Result<serde_json::Value, HostProtocolError> {
        let _resources =
            self.webview_resources(&request.handle, host_protocol::WEBVIEW_FIND_IN_PAGE_METHOD)?;
        let _query = &request.query;
        Err(HostProtocolError::unsupported(
            "host-document-output-unavailable",
            host_protocol::WEBVIEW_FIND_IN_PAGE_METHOD,
        ))
    }

    fn set_webview_zoom(
        &self,
        request: &WebViewSetZoomRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        let resources =
            self.webview_resources(&request.handle, host_protocol::WEBVIEW_SET_ZOOM_METHOD)?;
        webview::zoom(&resources._webview, request.zoom)
    }

    fn set_webview_user_agent(
        &self,
        request: &WebViewSetUserAgentRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        let _resources = self.webview_resources(
            &request.handle,
            host_protocol::WEBVIEW_SET_USER_AGENT_METHOD,
        )?;
        let _user_agent = &request.user_agent;
        Err(HostProtocolError::unsupported(
            "host-user-agent-runtime-unavailable",
            host_protocol::WEBVIEW_SET_USER_AGENT_METHOD,
        ))
    }

    fn open_webview_devtools(
        &self,
        handle: &WebViewHandleRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        let resources =
            self.webview_resources(handle, host_protocol::WEBVIEW_OPEN_DEVTOOLS_METHOD)?;
        webview::open_devtools(&resources._webview)
    }

    fn close_webview_devtools(
        &self,
        handle: &WebViewHandleRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        let resources =
            self.webview_resources(handle, host_protocol::WEBVIEW_CLOSE_DEVTOOLS_METHOD)?;
        webview::close_devtools(&resources._webview)
    }

    fn attach_webview_debugger(
        &self,
        handle: &WebViewHandleRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        let _resources =
            self.webview_resources(handle, host_protocol::WEBVIEW_ATTACH_DEBUGGER_METHOD)?;
        Err(HostProtocolError::unsupported(
            "host-debugger-protocol-unavailable",
            host_protocol::WEBVIEW_ATTACH_DEBUGGER_METHOD,
        ))
    }

    fn set_webview_navigation_policy(
        &mut self,
        request: WebViewSetNavigationPolicyRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        let resources = self.webview_resources(
            &request.handle,
            host_protocol::WEBVIEW_SET_NAVIGATION_POLICY_METHOD,
        )?;
        *resources.policy.borrow_mut() = request.policy;
        Ok(())
    }

    fn destroy_webview(
        &mut self,
        handle: &WebViewHandleRequest,
    ) -> std::result::Result<(), HostProtocolError> {
        let resources = self.webviews.get(&handle.id).ok_or_else(|| {
            HostProtocolError::not_found(
                format!("WebView:{}", handle.id),
                host_protocol::WEBVIEW_DESTROY_METHOD,
            )
        })?;
        validate_webview_handle(handle, resources, host_protocol::WEBVIEW_DESTROY_METHOD)?;
        self.webviews.remove(&handle.id);
        Ok(())
    }

    fn webview_resources(
        &self,
        handle: &WebViewHandleRequest,
        operation: &'static str,
    ) -> std::result::Result<&NativeWebViewResources, HostProtocolError> {
        let resources = self.webviews.get(&handle.id).ok_or_else(|| {
            HostProtocolError::not_found(format!("WebView:{}", handle.id), operation)
        })?;
        validate_webview_handle(handle, resources, operation)?;
        Ok(resources)
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
            WindowCommand::Restart { args, reply } => match restart_current_process(&args) {
                Ok(()) => {
                    send_window_command_reply(reply, Ok(WindowCommandResponse::WindowUpdated));
                    WindowLifecycleEvent::AppQuitRequested(0)
                }
                Err(error) => {
                    send_window_command_reply(reply, Err(error));
                    WindowLifecycleEvent::Other
                }
            },
            WindowCommand::Create { request, reply } => {
                let result = self.create(target, request, mode);
                let lifecycle = match &result {
                    Ok(created) if matches!(mode, RunMode::ResidentLifecycleSmokeTest) => {
                        self.run_resident_lifecycle_smoke(created.window_id())
                    }
                    Ok(created) if matches!(mode, RunMode::AppQuitSmokeTest) => {
                        self.run_app_quit_smoke(created.window_id())
                    }
                    Ok(created) if matches!(mode, RunMode::AppFocusSmokeTest) => {
                        self.run_app_focus_smoke(created.window_id())
                    }
                    Ok(created) if matches!(mode, RunMode::AppRestartSmokeTest) => {
                        self.run_app_restart_smoke(created.window_id())
                    }
                    _ => lifecycle_for_create_result(
                        &result.clone().map(WindowCommandResponse::Created),
                    ),
                };
                let result = result.map(WindowCommandResponse::Created);
                send_window_command_reply(reply, result);
                lifecycle
            }
            WindowCommand::Destroy { window_id, reply } => {
                let result = self.destroy(&window_id);
                let exit_after_destroy =
                    result.is_ok() && mode.is_smoke_test() && self.windows.is_empty();
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
                    .map(WindowCommandResponse::WindowBounds);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::SetBoundsOnDisplay {
                window_id,
                display_id,
                bounds,
                reply,
            } => {
                let result = self
                    .set_bounds_on_display(&window_id, &display_id, &bounds)
                    .map(WindowCommandResponse::WindowBounds);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::Center { window_id, reply } => {
                let result = self
                    .center(&window_id)
                    .map(WindowCommandResponse::WindowBounds);
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
                    .map(WindowCommandResponse::WindowBounds);
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
            WindowCommand::ClearVibrancy { window_id, reply } => {
                let result = self
                    .clear_vibrancy(&window_id)
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
            WindowCommand::SetTitleBarStyle {
                window_id,
                title_bar_style,
                reply,
            } => {
                let result = self
                    .set_title_bar_style(&window_id, title_bar_style)
                    .map(|()| WindowCommandResponse::WindowUpdated);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::SetTitleBarTransparent {
                window_id,
                title_bar_transparent,
                reply,
            } => {
                let result = self
                    .set_title_bar_transparent(&window_id, title_bar_transparent)
                    .map(|()| WindowCommandResponse::WindowUpdated);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::SetTransparent {
                window_id,
                transparent,
                reply,
            } => {
                let result = self
                    .set_transparent(&window_id, transparent)
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
                let result = self.minimize(&window_id);
                if let Ok(state) = &result {
                    self.emit_observed_window_state(&window_id, state);
                }
                send_window_command_reply(reply, result.map(WindowCommandResponse::WindowState));
                WindowLifecycleEvent::Other
            }
            WindowCommand::Maximize { window_id, reply } => {
                let result = self.maximize(&window_id);
                if let Ok(state) = &result {
                    self.emit_observed_window_state(&window_id, state);
                }
                send_window_command_reply(reply, result.map(WindowCommandResponse::WindowState));
                WindowLifecycleEvent::Other
            }
            WindowCommand::Restore { window_id, reply } => {
                let result = self.restore(&window_id);
                if let Ok(state) = &result {
                    self.emit_observed_window_state(&window_id, state);
                }
                send_window_command_reply(reply, result.map(WindowCommandResponse::WindowState));
                WindowLifecycleEvent::Other
            }
            WindowCommand::SetFullscreen {
                window_id,
                fullscreen,
                reply,
            } => {
                let result = self.set_fullscreen(&window_id, fullscreen);
                if let Ok(state) = &result {
                    self.emit_observed_window_state(&window_id, state);
                }
                send_window_command_reply(reply, result.map(WindowCommandResponse::WindowState));
                WindowLifecycleEvent::Other
            }
            WindowCommand::SetSimpleFullscreen {
                window_id,
                simple_fullscreen,
                reply,
            } => {
                let result = self.set_simple_fullscreen(&window_id, simple_fullscreen);
                if let Ok(state) = &result {
                    self.emit_observed_window_state(&window_id, state);
                }
                send_window_command_reply(reply, result.map(WindowCommandResponse::WindowState));
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
            WindowCommand::CreateWebView { request, reply } => {
                let result = self
                    .create_webview(request)
                    .map(WindowCommandResponse::WebViewCreated);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::LoadWebViewRoute { request, reply } => {
                let result = self
                    .load_webview_route(request)
                    .map(|()| WindowCommandResponse::WindowUpdated);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::LoadWebViewUrl { request, reply } => {
                let result = self
                    .load_webview_url(request)
                    .map(|()| WindowCommandResponse::WindowUpdated);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::ReloadWebView { handle, reply } => {
                let result = self
                    .reload_webview(&handle)
                    .map(|()| WindowCommandResponse::WindowUpdated);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::StopWebView { handle, reply } => {
                let result = self
                    .stop_webview(&handle)
                    .map(|()| WindowCommandResponse::WindowUpdated);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::GoBackWebView { handle, reply } => {
                let result = self
                    .go_back_webview(&handle)
                    .map(|()| WindowCommandResponse::WindowUpdated);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::GoForwardWebView { handle, reply } => {
                let result = self
                    .go_forward_webview(&handle)
                    .map(|()| WindowCommandResponse::WindowUpdated);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::GetWebViewNavigationState { handle, reply } => {
                let result = self
                    .get_webview_navigation_state(&handle)
                    .map(WindowCommandResponse::WebViewNavigationState);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::CaptureWebViewScreenshot { handle, reply } => {
                let result = self
                    .capture_webview_screenshot(&handle)
                    .map(WindowCommandResponse::WebViewDocument);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::PrintWebView { handle, reply } => {
                let result = self
                    .print_webview(&handle)
                    .map(|()| WindowCommandResponse::WindowUpdated);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::PrintWebViewToPdf { handle, reply } => {
                let result = self
                    .print_webview_to_pdf(&handle)
                    .map(WindowCommandResponse::WebViewDocument);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::FindInWebViewPage { request, reply } => {
                let result = self
                    .find_in_webview_page(&request)
                    .map(WindowCommandResponse::WebViewDocument);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::SetWebViewZoom { request, reply } => {
                let result = self
                    .set_webview_zoom(&request)
                    .map(|()| WindowCommandResponse::WindowUpdated);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::SetWebViewUserAgent { request, reply } => {
                let result = self
                    .set_webview_user_agent(&request)
                    .map(|()| WindowCommandResponse::WindowUpdated);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::OpenWebViewDevTools { handle, reply } => {
                let result = self
                    .open_webview_devtools(&handle)
                    .map(|()| WindowCommandResponse::WindowUpdated);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::CloseWebViewDevTools { handle, reply } => {
                let result = self
                    .close_webview_devtools(&handle)
                    .map(|()| WindowCommandResponse::WindowUpdated);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::AttachWebViewDebugger { handle, reply } => {
                let result = self
                    .attach_webview_debugger(&handle)
                    .map(|()| WindowCommandResponse::WindowUpdated);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::SetWebViewNavigationPolicy { request, reply } => {
                let result = self
                    .set_webview_navigation_policy(request)
                    .map(|()| WindowCommandResponse::WindowUpdated);
                send_window_command_reply(reply, result);
                WindowLifecycleEvent::Other
            }
            WindowCommand::DestroyWebView { handle, reply } => {
                let result = self
                    .destroy_webview(&handle)
                    .map(|()| WindowCommandResponse::Destroyed);
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

    fn run_resident_lifecycle_smoke(&mut self, window_id: &str) -> WindowLifecycleEvent {
        let Some(resources) = self.windows.get(window_id) else {
            warn!(
                event = "host.resident_lifecycle.smoke_failed",
                window_id,
                reason = "missing-window",
                "resident lifecycle smoke could not find created window"
            );
            return WindowLifecycleEvent::WindowCreateFailed;
        };
        let native_window_id = resources._window.id();

        let lifecycle_event = handle_native_window_close_requested(self, native_window_id);
        let Some(resources) = self.windows.get(window_id) else {
            warn!(
                event = "host.resident_lifecycle.smoke_failed",
                window_id,
                reason = "window-destroyed",
                "resident lifecycle smoke close request destroyed the window"
            );
            return WindowLifecycleEvent::WindowCreateFailed;
        };
        let visible = resources._window.is_visible();
        if !matches!(lifecycle_event, WindowLifecycleEvent::Other) || visible {
            warn!(
                event = "host.resident_lifecycle.smoke_failed",
                window_id,
                visible,
                lifecycle = ?lifecycle_event,
                "resident lifecycle smoke close request did not hide and retain the window"
            );
            return WindowLifecycleEvent::WindowCreateFailed;
        }

        info!(
            event = "host.resident_lifecycle.smoke_verified",
            window_id,
            visible,
            retained = true,
            "resident lifecycle close-to-background smoke verified"
        );
        WindowLifecycleEvent::SmokeExitRequested
    }

    fn run_app_quit_smoke(&self, window_id: &str) -> WindowLifecycleEvent {
        if !self.windows.contains_key(window_id) {
            warn!(
                event = "host.app_lifecycle.quit_smoke_failed",
                window_id,
                reason = "missing-window",
                "app quit smoke could not find created window"
            );
            return WindowLifecycleEvent::WindowCreateFailed;
        }

        info!(
            event = "host.app_lifecycle.quit_smoke_verified",
            window_id,
            exit_code = 0,
            "app quit smoke verified"
        );
        WindowLifecycleEvent::AppQuitRequested(0)
    }

    fn run_app_focus_smoke(&mut self, window_id: &str) -> WindowLifecycleEvent {
        match self.focus(window_id) {
            Ok(()) => {
                info!(
                    event = "host.app_lifecycle.focus_smoke_verified",
                    window_id, "app focus smoke verified"
                );
                WindowLifecycleEvent::SmokeExitRequested
            }
            Err(error) => {
                warn!(
                    event = "host.app_lifecycle.focus_smoke_failed",
                    window_id,
                    error = ?error,
                    "app focus smoke could not focus the created window"
                );
                WindowLifecycleEvent::WindowCreateFailed
            }
        }
    }

    fn run_app_restart_smoke(&self, window_id: &str) -> WindowLifecycleEvent {
        if !self.windows.contains_key(window_id) {
            warn!(
                event = "host.app_lifecycle.restart_smoke_failed",
                window_id,
                reason = "missing-window",
                "app restart smoke could not find created window"
            );
            return WindowLifecycleEvent::WindowCreateFailed;
        }

        let args = vec![APP_RESTART_CHILD_SMOKE_TEST_ARG.to_string()];
        match restart_current_process(&args) {
            Ok(()) => {
                info!(
                    event = "host.app_lifecycle.restart_smoke_verified",
                    window_id,
                    args = ?args,
                    "app restart smoke verified"
                );
                WindowLifecycleEvent::AppQuitRequested(0)
            }
            Err(error) => {
                warn!(
                    event = "host.app_lifecycle.restart_smoke_failed",
                    window_id,
                    error = ?error,
                    "app restart smoke could not launch replacement process"
                );
                WindowLifecycleEvent::WindowCreateFailed
            }
        }
    }
}

pub(crate) fn run_app_restart_child_smoke() -> Result<()> {
    let marker = std::env::var_os(APP_RESTART_SMOKE_MARKER_ENV).ok_or_else(|| {
        anyhow::anyhow!("{APP_RESTART_SMOKE_MARKER_ENV} is required for restart child smoke")
    })?;
    let marker = std::path::PathBuf::from(marker);
    fs::write(&marker, "restarted\n").map_err(|error| {
        anyhow::anyhow!(
            "failed to write app restart child smoke marker {}: {error}",
            marker.display()
        )
    })?;
    info!(
        event = "host.app_lifecycle.restart_child_smoke_verified",
        marker = %marker.display(),
        "app restart child smoke verified"
    );
    Ok(())
}

fn restart_current_process(args: &[String]) -> std::result::Result<(), HostProtocolError> {
    let executable = std::env::current_exe().map_err(|error| {
        HostProtocolError::internal(
            format!("failed to resolve current executable for restart: {error}"),
            host_protocol::APP_RESTART_METHOD,
        )
    })?;

    Command::new(&executable)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|error| {
            HostProtocolError::internal(
                format!(
                    "failed to launch restart process {}: {error}",
                    executable.display()
                ),
                host_protocol::APP_RESTART_METHOD,
            )
        })
}

fn lifecycle_for_create_result(result: &WindowCommandReply) -> WindowLifecycleEvent {
    if result.is_err() {
        WindowLifecycleEvent::WindowCreateFailed
    } else {
        WindowLifecycleEvent::Other
    }
}

fn validate_webview_handle(
    handle: &WebViewHandleRequest,
    resources: &NativeWebViewResources,
    operation: &'static str,
) -> std::result::Result<(), HostProtocolError> {
    if handle.generation != resources.generation {
        return Err(HostProtocolError::invalid_argument(
            "webview.generation",
            "must match the live WebView generation",
            operation,
        ));
    }
    if handle.owner_scope != resources.owner_scope {
        return Err(HostProtocolError::invalid_argument(
            "webview.ownerScope",
            "must match the live WebView owner scope",
            operation,
        ));
    }
    Ok(())
}

fn origin_allowed(url: &str, policy: &WebViewNavigationPolicy) -> bool {
    match policy.on_disallowed {
        WebViewNavigationDecision::Block | WebViewNavigationDecision::OpenExternal => {}
    }
    origin_for_url(url).as_deref().is_some_and(|origin| {
        policy
            .allowed_origins
            .iter()
            .any(|allowed| allowed == origin)
    })
}

fn webview_isolation(
    webview_id: &str,
    owner_scope: &str,
    policy: WebViewIsolationPolicy,
) -> webview::ChildWebViewIsolation {
    let manifest = serde_json::json!(policy
        .exposed_apis
        .iter()
        .map(|api| serde_json::json!({ "name": api.name.clone(), "methods": api.methods.clone() }))
        .collect::<Vec<_>>());
    let initialization_script = webview_isolation_script(&manifest.to_string());
    let webview_id = webview_id.to_string();
    let owner_scope = owner_scope.to_string();
    webview::ChildWebViewIsolation {
        initialization_script,
        ipc_handler: Box::new(move |request| {
            handle_webview_isolation_ipc(&webview_id, &owner_scope, &policy, request.body());
        }),
    }
}

fn webview_isolation_script(manifest_json: &str) -> String {
    format!(
        r#"(() => {{
  const rawIpc = window.ipc;
  const manifest = {manifest_json};
  const exposed = Object.create(null);
  for (const entry of manifest) {{
    const api = Object.create(null);
    for (const method of entry.methods) {{
      Object.defineProperty(api, method, {{
        enumerable: true,
        value: (payload = null) => {{
          rawIpc.postMessage(JSON.stringify({{
            kind: "effect-desktop.webview-api",
            api: entry.name,
            method,
            payload: JSON.stringify(payload)
          }}));
        }}
      }});
    }}
    Object.defineProperty(exposed, entry.name, {{
      enumerable: true,
      value: Object.freeze(api)
    }});
  }}
  Object.defineProperty(window, "EffectDesktop", {{
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze(exposed)
  }});
  try {{
    Object.defineProperty(window, "ipc", {{
      configurable: false,
      enumerable: false,
      writable: false,
      value: undefined
    }});
  }} catch (_error) {{}}
}})();"#
    )
}

fn handle_webview_isolation_ipc(
    webview_id: &str,
    owner_scope: &str,
    policy: &WebViewIsolationPolicy,
    body: &str,
) {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(body) else {
        return;
    };
    let Some(object) = value.as_object() else {
        return;
    };
    if object.get("kind").and_then(serde_json::Value::as_str) != Some("effect-desktop.webview-api")
    {
        return;
    }
    let Some(api) = object.get("api").and_then(serde_json::Value::as_str) else {
        return;
    };
    let Some(method) = object.get("method").and_then(serde_json::Value::as_str) else {
        return;
    };
    if !policy
        .exposed_apis
        .iter()
        .any(|entry| entry.name == api && entry.methods.iter().any(|name| name == method))
    {
        return;
    }
    let payload = object
        .get("payload")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("null");
    if payload.contains('\0') {
        return;
    }
    emit_webview_api_call_event(webview_id, owner_scope, api, method, payload);
}

fn origin_for_url(url: &str) -> Option<String> {
    let (scheme, rest) = url.split_once("://")?;
    let authority = rest
        .split(['/', '?', '#'])
        .next()
        .filter(|value| !value.is_empty())?;
    Some(format!("{scheme}://{authority}"))
}

fn webview_host_error(error: wry::Error, operation: &'static str) -> HostProtocolError {
    HostProtocolError::internal(format!("WebView host operation failed: {error}"), operation)
}

fn webview_permission_denied(message: &'static str, operation: &'static str) -> HostProtocolError {
    HostProtocolError::PermissionDenied {
        capability: "WebView.navigation".to_string(),
        resource: None,
        message: message.to_string(),
        operation: operation.to_string(),
        platform: None,
        code: None,
        cause: None,
        recoverable: HostProtocolError::recoverable_default("PermissionDenied").expect("known tag"),
        remediation: None,
        docs_url: None,
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
        WindowCommandResponse::WebViewCreated(_)
        | WindowCommandResponse::WebViewNavigationState(_)
        | WindowCommandResponse::WebViewDocument(_) => "tray command received webview response",
    };
    HostProtocolError::internal(message, operation)
}

fn unexpected_webview_response(
    response: WindowCommandResponse,
    operation: &'static str,
) -> HostProtocolError {
    let message = match response {
        WindowCommandResponse::Created(_) => "webview command received window create response",
        WindowCommandResponse::Destroyed => "webview command received window destroy response",
        WindowCommandResponse::WindowUpdated => "webview command received window update response",
        WindowCommandResponse::WindowLookup(_) => "webview command received window lookup response",
        WindowCommandResponse::WindowList(_) => "webview command received window list response",
        WindowCommandResponse::WindowParent(_) => "webview command received window parent response",
        WindowCommandResponse::WindowBounds(_) => "webview command received window bounds response",
        WindowCommandResponse::WindowState(_) => "webview command received window state response",
        WindowCommandResponse::DockBadgeLabelSet
        | WindowCommandResponse::DockProgressSet
        | WindowCommandResponse::DockAttentionRequested
        | WindowCommandResponse::DockMenuSet => "webview command received dock response",
        WindowCommandResponse::MenuSet => "webview command received menu response",
        WindowCommandResponse::TrayCreated(_)
        | WindowCommandResponse::TrayUpdated
        | WindowCommandResponse::TrayDestroyed => "webview command received tray response",
        WindowCommandResponse::ScreenDisplays(_)
        | WindowCommandResponse::ScreenDisplay(_)
        | WindowCommandResponse::ScreenPoint(_)
        | WindowCommandResponse::ScreenSupported(_) => "webview command received screen response",
        WindowCommandResponse::WebViewCreated(_) => "webview command received create response",
        WindowCommandResponse::WebViewNavigationState(_) => {
            "webview command received navigation state response"
        }
        WindowCommandResponse::WebViewDocument(_) => "webview command received document response",
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
        WindowCommandResponse::WebViewCreated(_)
        | WindowCommandResponse::WebViewNavigationState(_)
        | WindowCommandResponse::WebViewDocument(_) => "screen command received webview response",
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

fn ensure_window_state(
    observed: &WindowStatePayload,
    accepted: bool,
    attempted: &'static str,
    operation: &'static str,
) -> std::result::Result<(), HostProtocolError> {
    if accepted {
        return Ok(());
    }

    Err(HostProtocolError::InvalidState {
        current: format_window_state(observed),
        attempted: attempted.to_string(),
        message: "window state transition was not confirmed by host-observed state".to_string(),
        operation: operation.to_string(),
        platform: None,
        code: None,
        cause: None,
        recoverable: HostProtocolError::recoverable_default("InvalidState").expect("known tag"),
        remediation: Some("retry after reading Window.getState, or treat the transition as unsupported on this compositor".to_string()),
        docs_url: None,
    })
}

fn format_window_state(state: &WindowStatePayload) -> String {
    format!(
        "minimized={},maximized={},fullscreen={},simpleFullscreen={}",
        state.minimized(),
        state.maximized(),
        state.fullscreen(),
        state.simple_fullscreen()
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

fn clip_window_bounds_to_monitor_work_area(
    bounds: &WindowBoundsPayload,
    monitor: &MonitorHandle,
) -> WindowBoundsPayload {
    let scale = monitor.scale_factor();
    if !scale.is_finite() || scale <= 0.0 {
        return bounds.clone();
    }

    let work_area = LogicalScreenArea::from_physical(monitor_work_area(monitor), scale);
    clip_window_bounds_to_logical_area(bounds, work_area)
}

fn clip_window_bounds_to_logical_area(
    bounds: &WindowBoundsPayload,
    area: LogicalScreenArea,
) -> WindowBoundsPayload {
    if area.width <= 0.0 || area.height <= 0.0 {
        return bounds.clone();
    }

    let width = bounds.width().min(area.width);
    let height = bounds.height().min(area.height);
    let max_x = area.x + area.width - width;
    let max_y = area.y + area.height - height;

    WindowBoundsPayload::new(
        bounds.x().clamp(area.x, max_x),
        bounds.y().clamp(area.y, max_y),
        width,
        height,
    )
}

fn display_relative_bounds_to_physical_position(
    bounds: &WindowBoundsPayload,
    monitor: &MonitorHandle,
    operation: &'static str,
) -> std::result::Result<DisplayRelativeWindowBounds, HostProtocolError> {
    let scale = monitor.scale_factor();
    if !scale.is_finite() || scale <= 0.0 {
        return Err(HostProtocolError::internal(
            "target display scale factor is invalid",
            operation,
        ));
    }

    let work_area = monitor_work_area(monitor);
    let logical_work_area = LogicalScreenArea {
        x: 0.0,
        y: 0.0,
        width: f64::from(work_area.width) / scale,
        height: f64::from(work_area.height) / scale,
    };
    let clipped = clip_window_bounds_to_logical_area(bounds, logical_work_area);
    let position = PhysicalPosition::new(
        display_relative_physical_axis(work_area.x, clipped.x(), scale, "x", operation)?,
        display_relative_physical_axis(work_area.y, clipped.y(), scale, "y", operation)?,
    );

    Ok(DisplayRelativeWindowBounds {
        position,
        size: LogicalSize::new(clipped.width(), clipped.height()),
    })
}

fn display_relative_physical_axis(
    origin: i32,
    relative: f64,
    scale: f64,
    axis: &str,
    operation: &'static str,
) -> std::result::Result<i32, HostProtocolError> {
    rounded_i32(f64::from(origin) + (relative * scale)).ok_or_else(|| {
        HostProtocolError::internal(
            format!("computed display-relative {axis} position is outside host coordinate range"),
            operation,
        )
    })
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct DisplayRelativeWindowBounds {
    position: PhysicalPosition<i32>,
    size: LogicalSize<f64>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct LogicalScreenArea {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl LogicalScreenArea {
    fn from_physical(area: PhysicalScreenArea, scale: f64) -> Self {
        Self {
            x: f64::from(area.x) / scale,
            y: f64::from(area.y) / scale,
            width: f64::from(area.width) / scale,
            height: f64::from(area.height) / scale,
        }
    }
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
        .or_else(|| {
            windows::screen_work_area(monitor).and_then(|work_area| {
                PhysicalScreenArea::new(
                    work_area.x(),
                    work_area.y(),
                    work_area.width(),
                    work_area.height(),
                )
            })
        })
        .or_else(|| {
            linux::screen_work_area(monitor).and_then(|work_area| {
                PhysicalScreenArea::new(
                    work_area.x(),
                    work_area.y(),
                    work_area.width(),
                    work_area.height(),
                )
            })
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

pub(crate) fn install_webview_event_sender(
    sender: Sender<HostProtocolEnvelope>,
) -> std::result::Result<(), HostProtocolError> {
    let mut current = WEBVIEW_EVENT_SENDER.lock().map_err(|_| {
        HostProtocolError::internal(
            "webview event sender mutex poisoned",
            "host.runtime.webview.connect",
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

pub(crate) fn clear_webview_runtime_event_state() -> std::result::Result<(), HostProtocolError> {
    let mut sender = WEBVIEW_EVENT_SENDER.lock().map_err(|_| {
        HostProtocolError::internal(
            "webview event sender mutex poisoned",
            "host.runtime.webview.disconnect",
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

fn webview_event_sender(
) -> std::result::Result<Option<Sender<HostProtocolEnvelope>>, HostProtocolError> {
    WEBVIEW_EVENT_SENDER
        .lock()
        .map(|sender| sender.clone())
        .map_err(|_| {
            HostProtocolError::internal(
                "webview event sender mutex poisoned",
                "host.runtime.webview.event",
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

fn emit_webview_navigation_blocked_event(
    webview_id: &str,
    owner_scope: &str,
    url: &str,
    reason: &str,
) {
    let sender = match webview_event_sender() {
        Ok(Some(sender)) => sender,
        Ok(None) => return,
        Err(error) => {
            warn!(
                event = "host.webview.navigation_blocked_event_sender_failed",
                error = ?error,
                "failed to read webview event sender"
            );
            return;
        }
    };
    let payload = serde_json::json!({
        "webview": {
            "kind": "webview",
            "id": webview_id,
            "generation": 0,
            "ownerScope": owner_scope,
            "state": "open"
        },
        "url": url,
        "reason": reason
    });
    let timestamp = timestamp_millis();
    let _ = sender.send(HostProtocolEnvelope::Event {
        method: host_protocol::WEBVIEW_NAVIGATION_BLOCKED_EVENT.to_string(),
        timestamp,
        trace_id: format!("webview-navigation-blocked-{webview_id}-{timestamp}"),
        window_id: None,
        payload: Some(payload),
    });
}

fn emit_webview_api_call_event(
    webview_id: &str,
    owner_scope: &str,
    api: &str,
    method: &str,
    payload: &str,
) {
    let sender = match webview_event_sender() {
        Ok(Some(sender)) => sender,
        Ok(None) => return,
        Err(error) => {
            warn!(
                event = "host.webview.api_call_event_sender_failed",
                error = ?error,
                "failed to read webview event sender"
            );
            return;
        }
    };
    let event_payload = serde_json::json!({
        "webview": {
            "kind": "webview",
            "id": webview_id,
            "generation": 0,
            "ownerScope": owner_scope,
            "state": "open"
        },
        "api": api,
        "method": method,
        "payload": payload
    });
    let timestamp = timestamp_millis();
    let _ = sender.send(HostProtocolEnvelope::Event {
        method: host_protocol::WEBVIEW_API_CALL_EVENT.to_string(),
        timestamp,
        trace_id: format!("webview-api-call-{webview_id}-{timestamp}"),
        window_id: None,
        payload: Some(event_payload),
    });
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

fn emit_window_bounds_event(
    window_id: &str,
    bounds: WindowBoundsPayload,
) -> std::result::Result<(), HostProtocolError> {
    let Some(sender) = window_event_sender()? else {
        return Ok(());
    };
    let payload = serde_json::to_value(WindowBoundsEventPayload::new(window_id, bounds)).map_err(
        |error| HostProtocolError::invalid_output(host_protocol::WINDOW_EVENT, error.to_string()),
    )?;
    sender
        .send(HostProtocolEnvelope::Event {
            method: host_protocol::WINDOW_EVENT.to_string(),
            timestamp: timestamp_millis(),
            trace_id: format!("window-bounds-event-{}", Uuid::now_v7()),
            window_id: Some(window_id.to_string()),
            payload: Some(payload),
        })
        .map_err(|_error| HostProtocolError::host_unavailable(host_protocol::WINDOW_EVENT))
}

fn warn_if_before_quit_event_failed(source: &'static str) {
    if let Err(error) = emit_app_before_quit_event(source) {
        warn!(
            event = "host.app.before_quit_event_failed",
            error = ?error,
            source,
            "failed to emit app before-quit event"
        );
    }
}

fn emit_app_before_quit_event(source: &'static str) -> std::result::Result<(), HostProtocolError> {
    let Some(sender) = window_event_sender()? else {
        return Ok(());
    };
    let trace_id = format!("app-before-quit-{source}-{}", Uuid::now_v7());
    let payload = serde_json::to_value(AppBeforeQuitEventPayload::new(trace_id.clone())).map_err(
        |error| {
            HostProtocolError::invalid_output(
                host_protocol::APP_BEFORE_QUIT_EVENT,
                error.to_string(),
            )
        },
    )?;
    sender
        .send(HostProtocolEnvelope::Event {
            method: host_protocol::APP_BEFORE_QUIT_EVENT.to_string(),
            timestamp: timestamp_millis(),
            trace_id,
            window_id: None,
            payload: Some(payload),
        })
        .map_err(|_error| HostProtocolError::host_unavailable(host_protocol::APP_BEFORE_QUIT_EVENT))
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
    if matches!(mode, RunMode::ResidentLifecycleSmokeTest) {
        enable_resident_lifecycle_smoke_policy().map_err(|error| anyhow::anyhow!("{error:?}"))?;
    }

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
                event: WindowEvent::Moved(_) | WindowEvent::Resized(_),
                ..
            } => {
                registry.emit_native_window_bounds_event(window_id);
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
    registry.emit_native_window_close_requested(native_window_id);
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

fn enable_resident_lifecycle_smoke_policy() -> std::result::Result<(), HostProtocolError> {
    resident_lifecycle::enable(
        Some(serde_json::json!({
            "policy": {
                "process": "keep-running",
                "windows": "close-to-background",
                "background": "tray",
                "launchAtLogin": false
            },
            "traceId": "resident-lifecycle-smoke"
        })),
        None,
    )
    .map(|_| ())
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
            warn_if_before_quit_event_failed("close-requested");
            info!(
                event = WINDOW_EXIT_REQUESTED_EVENT,
                source = "close-requested",
                "host window exit requested"
            );
            ControlFlow::Exit
        }
        WindowLifecycleEvent::AppQuitRequested(0) => {
            warn_if_before_quit_event_failed("app-quit");
            info!(
                event = WINDOW_EXIT_REQUESTED_EVENT,
                source = "app-quit",
                exit_code = 0,
                "host app quit requested"
            );
            ControlFlow::Exit
        }
        WindowLifecycleEvent::AppQuitRequested(exit_code) => {
            warn_if_before_quit_event_failed("app-quit");
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
    if mode.is_smoke_test() {
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
    if !matches!(event, WindowLifecycleEvent::Other) || !mode.is_smoke_test() {
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
        centered_physical_axis, clear_webview_runtime_event_state,
        clear_window_runtime_event_state, clip_window_bounds_to_logical_area,
        control_flow_for_lifecycle_event, control_flow_for_window_state,
        display_relative_physical_axis, emit_webview_api_call_event,
        emit_webview_navigation_blocked_event, emit_window_registry_event,
        handle_native_window_close_requested, handle_webview_isolation_ipc,
        install_webview_event_sender, install_window_event_sender,
        is_screen_displays_changed_window_event, lifecycle_event_with_smoke_timeout,
        lifecycle_for_create_result, resident_lifecycle, rounded_i32, rounded_u32,
        screen_bounds_payload, smoke_deadline_for_mode, to_tao_dock_progress, unsupported_screen,
        validate_positive_finite, LogicalScreenArea, PhysicalScreenArea, RunMode,
        WebViewExposedApi, WebViewIsolationPolicy, WebViewNavigationDecision,
        WebViewNavigationPolicy, WebViewNavigationState, WindowCommand, WindowCommandResponse,
        WindowCreateRequest, WindowId, WindowLifecycleEvent, WindowMethodPort, WindowRegistry,
        WINDOW_COMMAND_IDLE_POLL_INTERVAL, WINDOW_SMOKE_TEST_TIMEOUT,
    };
    use host_protocol::{
        DockProgressState, DockSetProgressOptionsPayload, DockSetProgressPayload,
        HostProtocolEnvelope, HostProtocolError, WindowBoundsPayload, WindowCreatePayload,
        WindowCreateResponse, WindowRegistryEventPhase,
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

    #[test]
    fn webview_navigation_state_tracks_host_history() {
        let mut state = WebViewNavigationState::new("app://localhost/".to_string());
        assert!(!state.can_go_back());
        assert!(!state.can_go_forward());

        state.mark_loading("app://localhost/settings");
        assert!(state.can_go_back());
        assert!(!state.can_go_forward());
        assert!(state.to_payload().loading);

        assert!(state.move_back());
        assert!(!state.can_go_back());
        assert!(state.can_go_forward());

        assert!(state.move_forward());
        state.mark_finished("app://localhost/settings");
        let payload = state.to_payload();
        assert!(payload.can_go_back);
        assert!(!payload.can_go_forward);
        assert!(!payload.loading);
    }

    #[test]
    fn webview_origin_policy_matches_exact_origins() {
        let policy = WebViewNavigationPolicy::new(
            vec![
                "app://localhost".to_string(),
                "https://example.com".to_string(),
            ],
            WebViewNavigationDecision::Block,
        );

        assert!(super::origin_allowed("app://localhost/settings", &policy));
        assert!(super::origin_allowed("https://example.com/path", &policy));
        assert!(!super::origin_allowed(
            "https://evil.example.com/path",
            &policy
        ));
    }

    #[test]
    fn webview_navigation_blocked_event_uses_typed_payload() {
        let _guard = WINDOW_EVENT_TEST_LOCK.lock().expect("window event lock");
        let (sender, receiver) = mpsc::channel();
        install_webview_event_sender(sender).expect("webview event sender should install");

        emit_webview_navigation_blocked_event(
            "webview-1",
            "window:window-1",
            "https://evil.example.com/path",
            "origin-policy",
        );

        let event = receiver
            .recv()
            .expect("navigation blocked event should be emitted");
        clear_webview_runtime_event_state().expect("webview event sender should clear");
        let HostProtocolEnvelope::Event {
            method, payload, ..
        } = event
        else {
            panic!("expected event envelope");
        };
        assert_eq!(method, host_protocol::WEBVIEW_NAVIGATION_BLOCKED_EVENT);
        assert_eq!(
            payload.expect("event should include payload"),
            serde_json::json!({
                "webview": {
                    "kind": "webview",
                    "id": "webview-1",
                    "generation": 0,
                    "ownerScope": "window:window-1",
                    "state": "open"
                },
                "url": "https://evil.example.com/path",
                "reason": "origin-policy"
            })
        );
    }

    #[test]
    fn webview_api_call_event_uses_typed_payload() {
        let _guard = WINDOW_EVENT_TEST_LOCK.lock().expect("window event lock");
        let (sender, receiver) = mpsc::channel();
        install_webview_event_sender(sender).expect("webview event sender should install");

        emit_webview_api_call_event(
            "webview-1",
            "window:window-1",
            "desktop",
            "ping",
            "{\"ok\":true}",
        );

        let event = receiver.recv().expect("api call event should be emitted");
        clear_webview_runtime_event_state().expect("webview event sender should clear");
        let HostProtocolEnvelope::Event {
            method, payload, ..
        } = event
        else {
            panic!("expected event envelope");
        };
        assert_eq!(method, host_protocol::WEBVIEW_API_CALL_EVENT);
        assert_eq!(
            payload.expect("event should include payload"),
            serde_json::json!({
                "webview": {
                    "kind": "webview",
                    "id": "webview-1",
                    "generation": 0,
                    "ownerScope": "window:window-1",
                    "state": "open"
                },
                "api": "desktop",
                "method": "ping",
                "payload": "{\"ok\":true}"
            })
        );
    }

    #[test]
    fn webview_isolation_ipc_emits_only_declared_api_calls() {
        let _guard = WINDOW_EVENT_TEST_LOCK.lock().expect("window event lock");
        let (sender, receiver) = mpsc::channel();
        install_webview_event_sender(sender).expect("webview event sender should install");
        let policy = WebViewIsolationPolicy::new(vec![WebViewExposedApi::new(
            "desktop".to_string(),
            vec!["ping".to_string()],
        )]);

        handle_webview_isolation_ipc(
            "webview-1",
            "window:window-1",
            &policy,
            r#"{"kind":"effect-desktop.webview-api","api":"desktop","method":"ping","payload":"{\"ok\":true}"}"#,
        );
        handle_webview_isolation_ipc(
            "webview-1",
            "window:window-1",
            &policy,
            r#"{"kind":"effect-desktop.webview-api","api":"desktop","method":"deleteEverything","payload":"{}"}"#,
        );

        let event = receiver.recv().expect("declared api call should emit");
        assert!(receiver.try_recv().is_err());
        clear_webview_runtime_event_state().expect("webview event sender should clear");
        let HostProtocolEnvelope::Event {
            method, payload, ..
        } = event
        else {
            panic!("expected event envelope");
        };
        assert_eq!(method, host_protocol::WEBVIEW_API_CALL_EVENT);
        assert_eq!(
            payload.expect("event should include payload"),
            serde_json::json!({
                "webview": {
                    "kind": "webview",
                    "id": "webview-1",
                    "generation": 0,
                    "ownerScope": "window:window-1",
                    "state": "open"
                },
                "api": "desktop",
                "method": "ping",
                "payload": "{\"ok\":true}"
            })
        );
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
    fn app_quit_requested_emits_before_quit_event() {
        let _guard = WINDOW_EVENT_TEST_LOCK
            .lock()
            .expect("window event test lock should not be poisoned");
        let (receiver, _event_sender_guard) = install_test_window_event_sender();

        assert_eq!(
            control_flow_for_lifecycle_event(WindowLifecycleEvent::AppQuitRequested(0)),
            ControlFlow::Exit
        );

        let event = receiver
            .recv()
            .expect("before quit receiver should receive event");

        let HostProtocolEnvelope::Event {
            method,
            window_id,
            trace_id,
            payload,
            ..
        } = event
        else {
            panic!("before quit event should be host event envelope");
        };
        assert_eq!(method, host_protocol::APP_BEFORE_QUIT_EVENT);
        assert_eq!(window_id, None);
        assert!(trace_id.starts_with("app-before-quit-app-quit-"));
        assert_eq!(
            payload.and_then(|value| {
                value
                    .get("traceId")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string)
            }),
            Some(trace_id)
        );
    }

    #[test]
    fn close_requested_emits_before_quit_event() {
        let _guard = WINDOW_EVENT_TEST_LOCK
            .lock()
            .expect("window event test lock should not be poisoned");
        let (receiver, _event_sender_guard) = install_test_window_event_sender();

        assert_eq!(
            control_flow_for_lifecycle_event(WindowLifecycleEvent::CloseRequested),
            ControlFlow::Exit
        );

        let event = receiver
            .recv()
            .expect("before quit receiver should receive event");
        let HostProtocolEnvelope::Event {
            method, trace_id, ..
        } = event
        else {
            panic!("before quit event should be host event envelope");
        };
        assert_eq!(method, host_protocol::APP_BEFORE_QUIT_EVENT);
        assert!(trace_id.starts_with("app-before-quit-close-requested-"));
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
    fn set_bounds_clips_to_logical_work_area() {
        let work_area = LogicalScreenArea {
            x: 100.0,
            y: 50.0,
            width: 1200.0,
            height: 800.0,
        };

        assert_eq!(
            clip_window_bounds_to_logical_area(
                &WindowBoundsPayload::new(0.0, 0.0, 1400.0, 900.0),
                work_area
            ),
            WindowBoundsPayload::new(100.0, 50.0, 1200.0, 800.0)
        );
        assert_eq!(
            clip_window_bounds_to_logical_area(
                &WindowBoundsPayload::new(1000.0, 700.0, 400.0, 300.0),
                work_area
            ),
            WindowBoundsPayload::new(900.0, 550.0, 400.0, 300.0)
        );
        assert_eq!(
            clip_window_bounds_to_logical_area(
                &WindowBoundsPayload::new(300.0, 200.0, 400.0, 300.0),
                work_area
            ),
            WindowBoundsPayload::new(300.0, 200.0, 400.0, 300.0)
        );
    }

    #[test]
    fn display_relative_bounds_use_physical_work_area_origin() {
        assert_eq!(
            display_relative_physical_axis(
                3840,
                25.0,
                2.0,
                "x",
                host_protocol::WINDOW_SET_BOUNDS_ON_DISPLAY_METHOD
            ),
            Ok(3890)
        );
        assert_eq!(
            display_relative_physical_axis(
                -1920,
                100.0,
                1.5,
                "x",
                host_protocol::WINDOW_SET_BOUNDS_ON_DISPLAY_METHOD
            ),
            Ok(-1770)
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
    fn window_bounds_events_encode_to_runtime_sender() {
        let _guard = WINDOW_EVENT_TEST_LOCK
            .lock()
            .expect("window event test lock should not be poisoned");
        let (receiver, _event_sender_guard) = install_test_window_event_sender();

        super::emit_window_bounds_event(
            "window-1",
            host_protocol::WindowBoundsPayload::new(10.0, 20.0, 640.0, 480.0),
        )
        .expect("window bounds event should emit");

        let event = receiver
            .recv()
            .expect("window event receiver should receive bounds event");

        let HostProtocolEnvelope::Event {
            method,
            window_id,
            payload,
            ..
        } = event
        else {
            panic!("expected window bounds event envelope");
        };
        assert_eq!(method, host_protocol::WINDOW_EVENT);
        assert_eq!(window_id.as_deref(), Some("window-1"));
        assert_eq!(
            payload.expect("window bounds event should include payload"),
            serde_json::json!({
                "type": "window-bounds-event",
                "windowId": "window-1",
                "bounds": {
                    "x": 10.0,
                    "y": 20.0,
                    "width": 640.0,
                    "height": 480.0
                }
            })
        );
    }

    #[test]
    fn unconfirmed_window_state_transition_is_invalid_state() {
        let observed = host_protocol::WindowStatePayload::new(false, false, false, false);
        let error = super::ensure_window_state(
            &observed,
            observed.fullscreen(),
            "fullscreen=true",
            host_protocol::WINDOW_SET_FULLSCREEN_METHOD,
        )
        .expect_err("unconfirmed transition should fail");

        assert_eq!(error.tag(), "InvalidState");
        if let HostProtocolError::InvalidState {
            current,
            attempted,
            operation,
            ..
        } = error
        {
            assert_eq!(
                current,
                "minimized=false,maximized=false,fullscreen=false,simpleFullscreen=false"
            );
            assert_eq!(attempted, "fullscreen=true");
            assert_eq!(operation, host_protocol::WINDOW_SET_FULLSCREEN_METHOD);
        } else {
            panic!("expected InvalidState");
        }
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
        let _resident_guard = resident_lifecycle::state_test_guard();
        resident_lifecycle::reset_state_for_test();
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
        let close_requested_event = receiver
            .recv()
            .expect("window event receiver should receive close-requested event");
        let closed_event = receiver
            .recv()
            .expect("window event receiver should receive close event");
        assert!(receiver.try_recv().is_err());

        let HostProtocolEnvelope::Event {
            method,
            window_id,
            payload,
            ..
        } = close_requested_event
        else {
            panic!("expected window registry event envelope");
        };
        assert_eq!(method, host_protocol::WINDOW_EVENT);
        assert_eq!(window_id.as_deref(), Some("window-1"));
        assert_eq!(
            payload.expect("window event should include payload"),
            serde_json::json!({
                "type": "window-registry-event",
                "phase": "closeRequested",
                "windowId": "window-1",
                "terminal": false
            })
        );

        let HostProtocolEnvelope::Event {
            method,
            window_id,
            payload,
            ..
        } = closed_event
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
        resident_lifecycle::reset_state_for_test();
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
