mod activation_registry;
pub(crate) mod app;
mod app_metadata;
mod association;
mod attachment_intake;
mod autostart;
mod browsing_data;
mod clipboard;
mod cookie_store;
mod crash_reporter;
mod diagnostics_bundle;
mod dialog;
mod display_capture;
mod distribution_parity;
mod dock;
mod download;
mod egress_policy;
mod execution_sandbox;
mod extension_config;
mod extension_package;
mod focused_application_context;
pub(crate) mod handshake;
mod job;
mod local_tool_runtime;
mod menu;
mod native_file_system;
mod network_auth;
mod notification;
mod open_intent;
mod path;
mod power_monitor;
pub(crate) mod protocol;
mod realtime_media_session;
mod recent_documents;
pub(crate) mod resident_lifecycle;
mod safe_storage;
mod scoped_access_grant;
mod screen;
mod selection_context;
mod session_permission;
mod session_profile;
mod shell;
pub(crate) mod system_appearance;
mod transactional_file_mutation;
mod transient_window_role;
mod tray;
mod updater;
mod webview;
mod window;
mod workspace_index;

#[cfg(test)]
pub(crate) use extension_config::EXTENSION_CONFIG_ENV_LOCK;
#[cfg(test)]
pub(crate) use extension_package::EXTENSION_PACKAGE_ENV_LOCK;
#[cfg(test)]
pub(crate) use job::JOB_ENV_LOCK;

use crate::{
    linux,
    window::{
        clear_screen_runtime_event_state, clear_tray_runtime_event_state,
        clear_webview_runtime_event_state, clear_window_runtime_event_state,
        install_screen_event_sender, install_webview_event_sender, install_window_event_sender,
        WindowMethodHandler,
    },
};
use host_protocol::{HostProtocolEnvelope, HostProtocolError};
use std::time::{SystemTime, UNIX_EPOCH};
use std::{
    collections::HashSet,
    sync::{mpsc::Sender, Arc, Mutex},
};

type RealtimeMediaHandler = fn(
    &str,
    Option<serde_json::Value>,
    u64,
    Option<&str>,
    Option<Sender<HostProtocolEnvelope>>,
    Option<Sender<realtime_media_session::SessionKey>>,
) -> realtime_media_session::EventfulResponse;

type ExtensionConfigHandler =
    fn(Option<serde_json::Value>, u64) -> extension_config::EventfulResponse;
type ExtensionPackageHandler =
    fn(Option<serde_json::Value>, u64) -> extension_package::EventfulResponse;
type DistributionParityHandler =
    fn(Option<serde_json::Value>, u64) -> distribution_parity::EventfulResponse;
type JobHandler = fn(Option<serde_json::Value>, u64) -> job::EventfulResponse;
type LocalToolRuntimeHandler =
    fn(Option<serde_json::Value>, u64) -> local_tool_runtime::EventfulResponse;
type WorkspaceIndexHandler =
    fn(Option<serde_json::Value>, u64) -> workspace_index::EventfulResponse;
type PayloadHandler =
    fn(Option<serde_json::Value>) -> Result<Option<serde_json::Value>, HostProtocolError>;
type EmptyHandler = fn() -> Result<Option<serde_json::Value>, HostProtocolError>;
type WindowHandler = fn(
    &dyn WindowMethodHandler,
    Option<serde_json::Value>,
) -> Result<Option<serde_json::Value>, HostProtocolError>;
type TrayCreateHandler = fn(
    &dyn WindowMethodHandler,
    Option<serde_json::Value>,
    Option<Sender<HostProtocolEnvelope>>,
) -> Result<Option<serde_json::Value>, HostProtocolError>;
type EventfulPayloadHandler = fn(
    Option<serde_json::Value>,
    Option<Sender<HostProtocolEnvelope>>,
) -> Result<Option<serde_json::Value>, HostProtocolError>;

struct RealtimeMediaDispatch {
    id: String,
    trace_id: String,
    window_id: Option<String>,
    payload: Option<serde_json::Value>,
    timestamp: u64,
}

struct ExtensionConfigDispatch {
    id: String,
    trace_id: String,
    window_id: Option<String>,
    payload: Option<serde_json::Value>,
    timestamp: u64,
}

struct ExtensionPackageDispatch {
    id: String,
    trace_id: String,
    window_id: Option<String>,
    payload: Option<serde_json::Value>,
    timestamp: u64,
}

struct DistributionParityDispatch {
    id: String,
    trace_id: String,
    window_id: Option<String>,
    payload: Option<serde_json::Value>,
    timestamp: u64,
}

struct JobDispatch {
    id: String,
    trace_id: String,
    window_id: Option<String>,
    payload: Option<serde_json::Value>,
    timestamp: u64,
}

struct LocalToolRuntimeDispatch {
    id: String,
    method: String,
    trace_id: String,
    window_id: Option<String>,
    payload: Option<serde_json::Value>,
    timestamp: u64,
}

struct WorkspaceIndexDispatch {
    id: String,
    trace_id: String,
    window_id: Option<String>,
    payload: Option<serde_json::Value>,
    timestamp: u64,
}

struct HostDispatchRequest {
    id: String,
    method: String,
    trace_id: String,
    window_id: Option<String>,
    payload: Option<serde_json::Value>,
    timestamp: u64,
}

struct HostMethodRegistry {
    routes: &'static [HostMethodRoute],
}

struct HostMethodRoute {
    method: &'static str,
    dispatcher: HostMethodDispatcher,
}

enum HostMethodDispatcher {
    Ping,
    Version,
    Payload(PayloadHandler),
    Empty(EmptyHandler),
    Window(WindowHandler),
    TrayCreate(TrayCreateHandler),
    EventfulPayload(EventfulPayloadHandler),
    WindowDestroy,
    UnsupportedGlobalShortcut,
    EgressRecord,
    RealtimeMedia(RealtimeMediaHandler),
    ExtensionConfig(ExtensionConfigHandler),
    ExtensionPackage(ExtensionPackageHandler),
    DistributionParity(DistributionParityHandler),
    Job(JobHandler),
    LocalToolRuntime(LocalToolRuntimeHandler),
    LocalToolRuntimeRun,
    WorkspaceIndex(WorkspaceIndexHandler),
}

const HOST_DISPATCH_REGISTRY: HostMethodRegistry = HostMethodRegistry {
    routes: HOST_DISPATCH_ROUTES,
};

const HOST_DISPATCH_ROUTES: &[HostMethodRoute] = &[
    route(host_protocol::HOST_PING_METHOD, HostMethodDispatcher::Ping),
    route(
        host_protocol::HOST_VERSION_METHOD,
        HostMethodDispatcher::Version,
    ),
    route(
        host_protocol::APP_QUIT_METHOD,
        HostMethodDispatcher::Window(app::quit),
    ),
    route(
        host_protocol::APP_EXIT_METHOD,
        HostMethodDispatcher::Window(app::exit),
    ),
    route(
        host_protocol::APP_RESTART_METHOD,
        HostMethodDispatcher::Window(app::restart),
    ),
    route(
        host_protocol::APP_RELAUNCH_METHOD,
        HostMethodDispatcher::Window(app::relaunch),
    ),
    route(
        host_protocol::APP_FOCUS_METHOD,
        HostMethodDispatcher::Window(app::focus),
    ),
    route(
        host_protocol::APP_ACTIVATE_METHOD,
        HostMethodDispatcher::Window(app::activate),
    ),
    route(
        host_protocol::APP_REQUEST_SINGLE_INSTANCE_LOCK_METHOD,
        HostMethodDispatcher::EventfulPayload(app::request_single_instance_lock_with_event_sender),
    ),
    route(
        host_protocol::APP_RELEASE_SINGLE_INSTANCE_LOCK_METHOD,
        HostMethodDispatcher::Payload(app::release_single_instance_lock),
    ),
    route(
        host_protocol::APP_METADATA_GET_INFO_METHOD,
        HostMethodDispatcher::Payload(app_metadata::get_info),
    ),
    route(
        host_protocol::APP_METADATA_GET_PATHS_METHOD,
        HostMethodDispatcher::Payload(app_metadata::get_paths),
    ),
    route(
        host_protocol::APP_METADATA_GET_LAUNCH_CONTEXT_METHOD,
        HostMethodDispatcher::Payload(app_metadata::get_launch_context),
    ),
    route(
        host_protocol::ASSOCIATION_IS_DEFAULT_PROTOCOL_CLIENT_METHOD,
        HostMethodDispatcher::EventfulPayload(
            association::is_default_protocol_client_with_event_sender,
        ),
    ),
    route(
        host_protocol::ASSOCIATION_SET_DEFAULT_PROTOCOL_CLIENT_METHOD,
        HostMethodDispatcher::EventfulPayload(
            association::set_default_protocol_client_with_event_sender,
        ),
    ),
    route(
        host_protocol::ASSOCIATION_GET_FILE_ASSOCIATIONS_METHOD,
        HostMethodDispatcher::EventfulPayload(association::get_file_associations_with_event_sender),
    ),
    route(
        host_protocol::RECENT_DOCUMENTS_ADD_METHOD,
        HostMethodDispatcher::EventfulPayload(recent_documents::add_with_event_sender),
    ),
    route(
        host_protocol::RECENT_DOCUMENTS_CLEAR_METHOD,
        HostMethodDispatcher::EventfulPayload(recent_documents::clear_with_event_sender),
    ),
    route(
        host_protocol::RECENT_DOCUMENTS_LIST_METHOD,
        HostMethodDispatcher::Payload(recent_documents::list),
    ),
    route(
        host_protocol::AUTOSTART_IS_ENABLED_METHOD,
        HostMethodDispatcher::EventfulPayload(autostart::is_enabled_with_event_sender),
    ),
    route(
        host_protocol::AUTOSTART_ENABLE_METHOD,
        HostMethodDispatcher::EventfulPayload(autostart::enable_with_event_sender),
    ),
    route(
        host_protocol::AUTOSTART_DISABLE_METHOD,
        HostMethodDispatcher::EventfulPayload(autostart::disable_with_event_sender),
    ),
    route(
        host_protocol::WINDOW_CREATE_METHOD,
        HostMethodDispatcher::Window(window::create),
    ),
    route(
        host_protocol::WINDOW_SHOW_METHOD,
        HostMethodDispatcher::Window(window::show),
    ),
    route(
        host_protocol::WINDOW_HIDE_METHOD,
        HostMethodDispatcher::Window(window::hide),
    ),
    route(
        host_protocol::WINDOW_FOCUS_METHOD,
        HostMethodDispatcher::Window(window::focus),
    ),
    route(
        host_protocol::WINDOW_GET_CURRENT_METHOD,
        HostMethodDispatcher::Window(window::get_current),
    ),
    route(
        host_protocol::WINDOW_GET_BY_ID_METHOD,
        HostMethodDispatcher::Window(window::get_by_id),
    ),
    route(
        host_protocol::WINDOW_LIST_METHOD,
        HostMethodDispatcher::Window(window::list),
    ),
    route(
        host_protocol::WINDOW_GET_PARENT_METHOD,
        HostMethodDispatcher::Window(window::get_parent),
    ),
    route(
        host_protocol::WINDOW_GET_CHILDREN_METHOD,
        HostMethodDispatcher::Window(window::get_children),
    ),
    route(
        host_protocol::WINDOW_GET_BOUNDS_METHOD,
        HostMethodDispatcher::Window(window::get_bounds),
    ),
    route(
        host_protocol::WINDOW_SET_BOUNDS_METHOD,
        HostMethodDispatcher::Window(window::set_bounds),
    ),
    route(
        host_protocol::WINDOW_SET_BOUNDS_ON_DISPLAY_METHOD,
        HostMethodDispatcher::Window(window::set_bounds_on_display),
    ),
    route(
        host_protocol::WINDOW_CENTER_METHOD,
        HostMethodDispatcher::Window(window::center),
    ),
    route(
        host_protocol::WINDOW_CENTER_ON_DISPLAY_METHOD,
        HostMethodDispatcher::Window(window::center_on_display),
    ),
    route(
        host_protocol::WINDOW_SET_TITLE_METHOD,
        HostMethodDispatcher::Window(window::set_title),
    ),
    route(
        host_protocol::WINDOW_SET_RESIZABLE_METHOD,
        HostMethodDispatcher::Window(window::set_resizable),
    ),
    route(
        host_protocol::WINDOW_SET_DECORATIONS_METHOD,
        HostMethodDispatcher::Window(window::set_decorations),
    ),
    route(
        host_protocol::WINDOW_SET_TRAFFIC_LIGHTS_METHOD,
        HostMethodDispatcher::Window(window::set_traffic_lights),
    ),
    route(
        host_protocol::WINDOW_SET_VIBRANCY_METHOD,
        HostMethodDispatcher::Window(window::set_vibrancy),
    ),
    route(
        host_protocol::WINDOW_CLEAR_VIBRANCY_METHOD,
        HostMethodDispatcher::Window(window::clear_vibrancy),
    ),
    route(
        host_protocol::WINDOW_SET_SHADOW_METHOD,
        HostMethodDispatcher::Window(window::set_shadow),
    ),
    route(
        host_protocol::WINDOW_SET_TITLE_BAR_STYLE_METHOD,
        HostMethodDispatcher::Window(window::set_title_bar_style),
    ),
    route(
        host_protocol::WINDOW_SET_TITLE_BAR_TRANSPARENT_METHOD,
        HostMethodDispatcher::Window(window::set_title_bar_transparent),
    ),
    route(
        host_protocol::WINDOW_SET_TRANSPARENT_METHOD,
        HostMethodDispatcher::Window(window::set_transparent),
    ),
    route(
        host_protocol::WINDOW_SET_ALWAYS_ON_TOP_METHOD,
        HostMethodDispatcher::Window(window::set_always_on_top),
    ),
    route(
        host_protocol::WINDOW_SET_SKIP_TASKBAR_METHOD,
        HostMethodDispatcher::Window(window::set_skip_taskbar),
    ),
    route(
        host_protocol::WINDOW_SET_PROGRESS_METHOD,
        HostMethodDispatcher::Window(window::set_progress),
    ),
    route(
        host_protocol::WINDOW_REQUEST_ATTENTION_METHOD,
        HostMethodDispatcher::Window(window::request_attention),
    ),
    route(
        host_protocol::WINDOW_CANCEL_ATTENTION_METHOD,
        HostMethodDispatcher::Window(window::cancel_attention),
    ),
    route(
        host_protocol::WINDOW_MINIMIZE_METHOD,
        HostMethodDispatcher::Window(window::minimize),
    ),
    route(
        host_protocol::WINDOW_MAXIMIZE_METHOD,
        HostMethodDispatcher::Window(window::maximize),
    ),
    route(
        host_protocol::WINDOW_RESTORE_METHOD,
        HostMethodDispatcher::Window(window::restore),
    ),
    route(
        host_protocol::WINDOW_SET_FULLSCREEN_METHOD,
        HostMethodDispatcher::Window(window::set_fullscreen),
    ),
    route(
        host_protocol::WINDOW_SET_SIMPLE_FULLSCREEN_METHOD,
        HostMethodDispatcher::Window(window::set_simple_fullscreen),
    ),
    route(
        host_protocol::WINDOW_GET_STATE_METHOD,
        HostMethodDispatcher::Window(window::get_state),
    ),
    route(
        host_protocol::WINDOW_DESTROY_METHOD,
        HostMethodDispatcher::WindowDestroy,
    ),
    route(
        host_protocol::DOCK_SET_BADGE_COUNT_METHOD,
        HostMethodDispatcher::Window(dock::set_badge_count),
    ),
    route(
        host_protocol::DOCK_SET_BADGE_TEXT_METHOD,
        HostMethodDispatcher::Window(dock::set_badge_text),
    ),
    route(
        host_protocol::DOCK_SET_PROGRESS_METHOD,
        HostMethodDispatcher::Window(dock::set_progress),
    ),
    route(
        host_protocol::DOCK_SET_MENU_METHOD,
        HostMethodDispatcher::Window(dock::set_menu),
    ),
    route(
        host_protocol::DOCK_SET_JUMP_LIST_METHOD,
        HostMethodDispatcher::Payload(dock::set_jump_list),
    ),
    route(
        host_protocol::DOCK_REQUEST_ATTENTION_METHOD,
        HostMethodDispatcher::Window(dock::request_attention),
    ),
    route(
        host_protocol::DOCK_IS_SUPPORTED_METHOD,
        HostMethodDispatcher::Payload(linux::dock_is_supported),
    ),
    route(
        host_protocol::GLOBAL_SHORTCUT_REGISTER_METHOD,
        HostMethodDispatcher::UnsupportedGlobalShortcut,
    ),
    route(
        host_protocol::GLOBAL_SHORTCUT_UNREGISTER_METHOD,
        HostMethodDispatcher::UnsupportedGlobalShortcut,
    ),
    route(
        host_protocol::GLOBAL_SHORTCUT_UNREGISTER_ALL_METHOD,
        HostMethodDispatcher::UnsupportedGlobalShortcut,
    ),
    route(
        host_protocol::GLOBAL_SHORTCUT_IS_REGISTERED_METHOD,
        HostMethodDispatcher::Empty(linux::global_shortcut_is_registered),
    ),
    route(
        host_protocol::GLOBAL_SHORTCUT_IS_SUPPORTED_METHOD,
        HostMethodDispatcher::Empty(linux::global_shortcut_is_supported),
    ),
    route(
        host_protocol::SAFE_STORAGE_SET_METHOD,
        HostMethodDispatcher::Payload(safe_storage::set),
    ),
    route(
        host_protocol::SAFE_STORAGE_GET_METHOD,
        HostMethodDispatcher::Payload(safe_storage::get),
    ),
    route(
        host_protocol::SAFE_STORAGE_DELETE_METHOD,
        HostMethodDispatcher::Payload(safe_storage::delete),
    ),
    route(
        host_protocol::SAFE_STORAGE_LIST_METHOD,
        HostMethodDispatcher::Payload(safe_storage::list),
    ),
    route(
        host_protocol::SAFE_STORAGE_IS_AVAILABLE_METHOD,
        HostMethodDispatcher::Empty(linux::safe_storage_is_available),
    ),
    route(
        host_protocol::DIALOG_OPEN_FILE_METHOD,
        HostMethodDispatcher::Payload(dialog::open_file),
    ),
    route(
        host_protocol::DIALOG_OPEN_DIRECTORY_METHOD,
        HostMethodDispatcher::Payload(dialog::open_directory),
    ),
    route(
        host_protocol::DIALOG_SAVE_FILE_METHOD,
        HostMethodDispatcher::Payload(dialog::save_file),
    ),
    route(
        host_protocol::DIALOG_MESSAGE_METHOD,
        HostMethodDispatcher::Payload(dialog::message),
    ),
    route(
        host_protocol::DIALOG_CONFIRM_METHOD,
        HostMethodDispatcher::Payload(dialog::confirm),
    ),
    route(
        host_protocol::TRAY_CREATE_METHOD,
        HostMethodDispatcher::TrayCreate(tray::create_with_event_sender),
    ),
    route(
        host_protocol::TRAY_SET_ICON_METHOD,
        HostMethodDispatcher::Window(tray::set_icon),
    ),
    route(
        host_protocol::TRAY_SET_TOOLTIP_METHOD,
        HostMethodDispatcher::Window(tray::set_tooltip),
    ),
    route(
        host_protocol::TRAY_SET_TITLE_METHOD,
        HostMethodDispatcher::Window(tray::set_title),
    ),
    route(
        host_protocol::TRAY_SET_MENU_METHOD,
        HostMethodDispatcher::Window(tray::set_menu),
    ),
    route(
        host_protocol::TRAY_DESTROY_METHOD,
        HostMethodDispatcher::Window(tray::destroy),
    ),
    route(
        host_protocol::TRAY_IS_SUPPORTED_METHOD,
        HostMethodDispatcher::Empty(tray::is_supported),
    ),
    route(
        host_protocol::NOTIFICATION_SHOW_METHOD,
        HostMethodDispatcher::EventfulPayload(notification::show_with_event_sender),
    ),
    route(
        host_protocol::NOTIFICATION_CLOSE_METHOD,
        HostMethodDispatcher::Payload(notification::close),
    ),
    route(
        host_protocol::NOTIFICATION_IS_SUPPORTED_METHOD,
        HostMethodDispatcher::Empty(notification::is_supported),
    ),
    route(
        host_protocol::NOTIFICATION_REQUEST_PERMISSION_METHOD,
        HostMethodDispatcher::Empty(notification::request_permission),
    ),
    route(
        host_protocol::NOTIFICATION_GET_PERMISSION_STATUS_METHOD,
        HostMethodDispatcher::Empty(notification::get_permission_status),
    ),
    route(
        host_protocol::SCREEN_GET_DISPLAYS_METHOD,
        HostMethodDispatcher::Window(screen::get_displays),
    ),
    route(
        host_protocol::SCREEN_GET_PRIMARY_DISPLAY_METHOD,
        HostMethodDispatcher::Window(screen::get_primary_display),
    ),
    route(
        host_protocol::SCREEN_GET_POINTER_POINT_METHOD,
        HostMethodDispatcher::Window(screen::get_pointer_point),
    ),
    route(
        host_protocol::SCREEN_IS_SUPPORTED_METHOD,
        HostMethodDispatcher::Window(screen::is_supported),
    ),
    route(
        host_protocol::SHELL_OPEN_EXTERNAL_METHOD,
        HostMethodDispatcher::Payload(shell::open_external),
    ),
    route(
        host_protocol::SHELL_SHOW_ITEM_IN_FOLDER_METHOD,
        HostMethodDispatcher::Payload(shell::show_item_in_folder),
    ),
    route(
        host_protocol::SHELL_OPEN_PATH_METHOD,
        HostMethodDispatcher::Payload(shell::open_path),
    ),
    route(
        host_protocol::SHELL_TRASH_ITEM_METHOD,
        HostMethodDispatcher::Payload(shell::trash_item),
    ),
    route(
        host_protocol::PATH_APP_DATA_METHOD,
        HostMethodDispatcher::Payload(path::app_data),
    ),
    route(
        host_protocol::PATH_CACHE_METHOD,
        HostMethodDispatcher::Payload(path::cache),
    ),
    route(
        host_protocol::PATH_LOGS_METHOD,
        HostMethodDispatcher::Payload(path::logs),
    ),
    route(
        host_protocol::PATH_TEMP_METHOD,
        HostMethodDispatcher::Payload(path::temp),
    ),
    route(
        host_protocol::PATH_HOME_METHOD,
        HostMethodDispatcher::Payload(path::home),
    ),
    route(
        host_protocol::PATH_DOWNLOADS_METHOD,
        HostMethodDispatcher::Payload(path::downloads),
    ),
    route(
        host_protocol::PROTOCOL_REGISTER_APP_PROTOCOL_METHOD,
        HostMethodDispatcher::Payload(protocol::register_app_protocol),
    ),
    route(
        host_protocol::PROTOCOL_SERVE_ASSET_METHOD,
        HostMethodDispatcher::Payload(protocol::serve_asset),
    ),
    route(
        host_protocol::PROTOCOL_SERVE_ROUTE_METHOD,
        HostMethodDispatcher::Payload(protocol::serve_route),
    ),
    route(
        host_protocol::PROTOCOL_DENY_METHOD,
        HostMethodDispatcher::Payload(protocol::deny),
    ),
    route(
        host_protocol::CLIPBOARD_READ_TEXT_METHOD,
        HostMethodDispatcher::Payload(clipboard::read_text),
    ),
    route(
        host_protocol::CLIPBOARD_WRITE_TEXT_METHOD,
        HostMethodDispatcher::Payload(clipboard::write_text),
    ),
    route(
        host_protocol::CLIPBOARD_READ_HTML_METHOD,
        HostMethodDispatcher::Payload(clipboard::read_html),
    ),
    route(
        host_protocol::CLIPBOARD_WRITE_HTML_METHOD,
        HostMethodDispatcher::Payload(clipboard::write_html),
    ),
    route(
        host_protocol::CLIPBOARD_READ_IMAGE_METHOD,
        HostMethodDispatcher::Payload(clipboard::read_image),
    ),
    route(
        host_protocol::CLIPBOARD_WRITE_IMAGE_METHOD,
        HostMethodDispatcher::Payload(clipboard::write_image),
    ),
    route(
        host_protocol::CLIPBOARD_CLEAR_METHOD,
        HostMethodDispatcher::Payload(clipboard::clear),
    ),
    route(
        host_protocol::CLIPBOARD_IS_SUPPORTED_METHOD,
        HostMethodDispatcher::Payload(clipboard::is_supported),
    ),
    route(
        host_protocol::UPDATER_CHECK_METHOD,
        HostMethodDispatcher::Payload(updater::check),
    ),
    route(
        host_protocol::UPDATER_DOWNLOAD_METHOD,
        HostMethodDispatcher::Payload(updater::download),
    ),
    route(
        host_protocol::UPDATER_INSTALL_METHOD,
        HostMethodDispatcher::Payload(updater::install),
    ),
    route(
        host_protocol::UPDATER_INSTALL_AND_RESTART_METHOD,
        HostMethodDispatcher::EventfulPayload(updater::install_and_restart_with_event_sender),
    ),
    route(
        host_protocol::UPDATER_GET_STATUS_METHOD,
        HostMethodDispatcher::Payload(updater::get_status),
    ),
    route(
        host_protocol::UPDATER_READY_FOR_RESTART_METHOD,
        HostMethodDispatcher::Payload(updater::ready_for_restart),
    ),
    route(
        host_protocol::CRASH_REPORTER_START_METHOD,
        HostMethodDispatcher::Payload(crash_reporter::start),
    ),
    route(
        host_protocol::CRASH_REPORTER_RECORD_BREADCRUMB_METHOD,
        HostMethodDispatcher::Payload(crash_reporter::record_breadcrumb),
    ),
    route(
        host_protocol::CRASH_REPORTER_FLUSH_METHOD,
        HostMethodDispatcher::Payload(crash_reporter::flush),
    ),
    route(
        host_protocol::CRASH_REPORTER_GET_REPORTS_METHOD,
        HostMethodDispatcher::Payload(crash_reporter::get_reports),
    ),
    route(
        host_protocol::POWER_MONITOR_IS_SUPPORTED_METHOD,
        HostMethodDispatcher::Payload(power_monitor::is_supported),
    ),
    route(
        host_protocol::SYSTEM_APPEARANCE_GET_APPEARANCE_METHOD,
        HostMethodDispatcher::Payload(system_appearance::get_appearance),
    ),
    route(
        host_protocol::SYSTEM_APPEARANCE_GET_ACCENT_COLOR_METHOD,
        HostMethodDispatcher::Payload(system_appearance::get_accent_color),
    ),
    route(
        host_protocol::SYSTEM_APPEARANCE_GET_REDUCED_MOTION_METHOD,
        HostMethodDispatcher::Payload(system_appearance::get_reduced_motion),
    ),
    route(
        host_protocol::SYSTEM_APPEARANCE_GET_REDUCED_TRANSPARENCY_METHOD,
        HostMethodDispatcher::Payload(system_appearance::get_reduced_transparency),
    ),
    route(
        host_protocol::SYSTEM_APPEARANCE_IS_SUPPORTED_METHOD,
        HostMethodDispatcher::Payload(system_appearance::is_supported),
    ),
    route(
        host_protocol::REALTIME_MEDIA_SESSION_OPEN_METHOD,
        HostMethodDispatcher::RealtimeMedia(realtime_media_session::open_with_events),
    ),
    route(
        host_protocol::REALTIME_MEDIA_SESSION_CLOSE_METHOD,
        HostMethodDispatcher::RealtimeMedia(realtime_media_session::close_with_events),
    ),
    route(
        host_protocol::REALTIME_MEDIA_SESSION_SELECT_DEVICE_METHOD,
        HostMethodDispatcher::RealtimeMedia(realtime_media_session::select_device_with_events),
    ),
    route(
        host_protocol::REALTIME_MEDIA_SESSION_INTERRUPT_METHOD,
        HostMethodDispatcher::RealtimeMedia(realtime_media_session::interrupt_with_events),
    ),
    route(
        host_protocol::REALTIME_MEDIA_SESSION_IS_SUPPORTED_METHOD,
        HostMethodDispatcher::Empty(realtime_media_session::is_supported),
    ),
    route(
        host_protocol::DIAGNOSTICS_BUNDLE_COLLECT_METHOD,
        HostMethodDispatcher::Payload(diagnostics_bundle::collect),
    ),
    route(
        host_protocol::DIAGNOSTICS_BUNDLE_REDACT_METHOD,
        HostMethodDispatcher::Payload(diagnostics_bundle::redact),
    ),
    route(
        host_protocol::DIAGNOSTICS_BUNDLE_WRITE_METHOD,
        HostMethodDispatcher::Payload(diagnostics_bundle::write),
    ),
    route(
        host_protocol::DIAGNOSTICS_BUNDLE_IS_SUPPORTED_METHOD,
        HostMethodDispatcher::Empty(diagnostics_bundle::is_supported),
    ),
    route(
        host_protocol::ATTACHMENT_INTAKE_INGEST_METHOD,
        HostMethodDispatcher::EventfulPayload(attachment_intake::ingest_with_event_sender),
    ),
    route(
        host_protocol::ATTACHMENT_INTAKE_INSPECT_METHOD,
        HostMethodDispatcher::EventfulPayload(attachment_intake::inspect_with_event_sender),
    ),
    route(
        host_protocol::ATTACHMENT_INTAKE_DISPOSE_METHOD,
        HostMethodDispatcher::EventfulPayload(attachment_intake::dispose_with_event_sender),
    ),
    route(
        host_protocol::ATTACHMENT_INTAKE_IS_SUPPORTED_METHOD,
        HostMethodDispatcher::Empty(attachment_intake::is_supported),
    ),
    route(
        host_protocol::SELECTION_CONTEXT_READ_SELECTION_METHOD,
        HostMethodDispatcher::Payload(selection_context::read_selection),
    ),
    route(
        host_protocol::SELECTION_CONTEXT_READ_DOCUMENT_METHOD,
        HostMethodDispatcher::Payload(selection_context::read_document),
    ),
    route(
        host_protocol::SELECTION_CONTEXT_WATCH_FOCUS_METHOD,
        HostMethodDispatcher::Payload(selection_context::watch_focus),
    ),
    route(
        host_protocol::SELECTION_CONTEXT_STOP_WATCHING_METHOD,
        HostMethodDispatcher::Payload(selection_context::stop_watching),
    ),
    route(
        host_protocol::SELECTION_CONTEXT_IS_SUPPORTED_METHOD,
        HostMethodDispatcher::Empty(selection_context::is_supported),
    ),
    route(
        host_protocol::FOCUSED_APPLICATION_CONTEXT_SNAPSHOT_METHOD,
        HostMethodDispatcher::Payload(focused_application_context::snapshot),
    ),
    route(
        host_protocol::FOCUSED_APPLICATION_CONTEXT_WATCH_METHOD,
        HostMethodDispatcher::Payload(focused_application_context::watch),
    ),
    route(
        host_protocol::FOCUSED_APPLICATION_CONTEXT_STOP_WATCHING_METHOD,
        HostMethodDispatcher::Payload(focused_application_context::stop_watching),
    ),
    route(
        host_protocol::FOCUSED_APPLICATION_CONTEXT_IS_SUPPORTED_METHOD,
        HostMethodDispatcher::Empty(focused_application_context::is_supported),
    ),
    route(
        host_protocol::DISPLAY_CAPTURE_CAPTURE_DISPLAY_METHOD,
        HostMethodDispatcher::Payload(display_capture::capture_display),
    ),
    route(
        host_protocol::DISPLAY_CAPTURE_CAPTURE_WINDOW_METHOD,
        HostMethodDispatcher::Payload(display_capture::capture_window),
    ),
    route(
        host_protocol::DISPLAY_CAPTURE_CAPTURE_REGION_METHOD,
        HostMethodDispatcher::Payload(display_capture::capture_region),
    ),
    route(
        host_protocol::DISPLAY_CAPTURE_IS_SUPPORTED_METHOD,
        HostMethodDispatcher::Empty(display_capture::is_supported),
    ),
    route(
        host_protocol::TRANSIENT_WINDOW_ROLE_OPEN_METHOD,
        HostMethodDispatcher::Payload(transient_window_role::open),
    ),
    route(
        host_protocol::TRANSIENT_WINDOW_ROLE_REPOSITION_METHOD,
        HostMethodDispatcher::Payload(transient_window_role::reposition),
    ),
    route(
        host_protocol::TRANSIENT_WINDOW_ROLE_DISMISS_METHOD,
        HostMethodDispatcher::Payload(transient_window_role::dismiss),
    ),
    route(
        host_protocol::TRANSIENT_WINDOW_ROLE_IS_SUPPORTED_METHOD,
        HostMethodDispatcher::Empty(transient_window_role::is_supported),
    ),
    route(
        host_protocol::ACTIVATION_REGISTRY_REGISTER_SURFACE_METHOD,
        HostMethodDispatcher::Payload(activation_registry::register_surface),
    ),
    route(
        host_protocol::ACTIVATION_REGISTRY_UNREGISTER_SURFACE_METHOD,
        HostMethodDispatcher::Payload(activation_registry::unregister_surface),
    ),
    route(
        host_protocol::ACTIVATION_REGISTRY_LIST_SURFACES_METHOD,
        HostMethodDispatcher::Empty(activation_registry::list_surfaces),
    ),
    route(
        host_protocol::ACTIVATION_REGISTRY_IS_SUPPORTED_METHOD,
        HostMethodDispatcher::Empty(activation_registry::is_supported),
    ),
    route(
        host_protocol::RESIDENT_LIFECYCLE_ENABLE_METHOD,
        HostMethodDispatcher::EventfulPayload(resident_lifecycle::enable),
    ),
    route(
        host_protocol::RESIDENT_LIFECYCLE_DISABLE_METHOD,
        HostMethodDispatcher::EventfulPayload(resident_lifecycle::disable),
    ),
    route(
        host_protocol::RESIDENT_LIFECYCLE_GET_STATE_METHOD,
        HostMethodDispatcher::Empty(resident_lifecycle::get_state),
    ),
    route(
        host_protocol::RESIDENT_LIFECYCLE_IS_SUPPORTED_METHOD,
        HostMethodDispatcher::Empty(resident_lifecycle::is_supported),
    ),
    route(
        host_protocol::DISTRIBUTION_PARITY_VERIFY_METHOD,
        HostMethodDispatcher::DistributionParity(distribution_parity::verify_with_event),
    ),
    route(
        host_protocol::DISTRIBUTION_PARITY_IS_SUPPORTED_METHOD,
        HostMethodDispatcher::Empty(distribution_parity::is_supported),
    ),
    route(
        host_protocol::JOB_START_METHOD,
        HostMethodDispatcher::Job(job::start_with_event),
    ),
    route(
        host_protocol::JOB_PAUSE_METHOD,
        HostMethodDispatcher::Job(job::pause_with_event),
    ),
    route(
        host_protocol::JOB_RESUME_METHOD,
        HostMethodDispatcher::Job(job::resume_with_event),
    ),
    route(
        host_protocol::JOB_RETRY_METHOD,
        HostMethodDispatcher::Job(job::retry_with_event),
    ),
    route(
        host_protocol::JOB_INTERRUPT_METHOD,
        HostMethodDispatcher::Job(job::interrupt_with_event),
    ),
    route(
        host_protocol::JOB_SUCCEED_METHOD,
        HostMethodDispatcher::Job(job::succeed_with_event),
    ),
    route(
        host_protocol::JOB_FAIL_METHOD,
        HostMethodDispatcher::Job(job::fail_with_event),
    ),
    route(
        host_protocol::JOB_REPORT_PROGRESS_METHOD,
        HostMethodDispatcher::Job(job::report_progress_with_event),
    ),
    route(
        host_protocol::JOB_GET_METHOD,
        HostMethodDispatcher::Payload(job::get),
    ),
    route(
        host_protocol::JOB_IS_SUPPORTED_METHOD,
        HostMethodDispatcher::Empty(job::is_supported),
    ),
    route(
        host_protocol::EGRESS_POLICY_DECIDE_METHOD,
        HostMethodDispatcher::Payload(egress_policy::decide),
    ),
    route(
        host_protocol::EGRESS_POLICY_RECORD_METHOD,
        HostMethodDispatcher::EgressRecord,
    ),
    route(
        host_protocol::EGRESS_POLICY_IS_SUPPORTED_METHOD,
        HostMethodDispatcher::Empty(egress_policy::is_supported),
    ),
    route(
        host_protocol::EXECUTION_SANDBOX_CREATE_METHOD,
        HostMethodDispatcher::Payload(execution_sandbox::create),
    ),
    route(
        host_protocol::EXECUTION_SANDBOX_RUN_METHOD,
        HostMethodDispatcher::Payload(execution_sandbox::run),
    ),
    route(
        host_protocol::EXECUTION_SANDBOX_DESTROY_METHOD,
        HostMethodDispatcher::Payload(execution_sandbox::destroy),
    ),
    route(
        host_protocol::EXECUTION_SANDBOX_IS_SUPPORTED_METHOD,
        HostMethodDispatcher::Empty(execution_sandbox::is_supported),
    ),
    route(
        host_protocol::EXTENSION_CONFIG_READ_METHOD,
        HostMethodDispatcher::ExtensionConfig(extension_config::read_with_event),
    ),
    route(
        host_protocol::EXTENSION_CONFIG_WRITE_METHOD,
        HostMethodDispatcher::ExtensionConfig(extension_config::write_with_event),
    ),
    route(
        host_protocol::EXTENSION_CONFIG_RESET_METHOD,
        HostMethodDispatcher::ExtensionConfig(extension_config::reset_with_event),
    ),
    route(
        host_protocol::EXTENSION_CONFIG_REDACT_METHOD,
        HostMethodDispatcher::ExtensionConfig(extension_config::redact_with_event),
    ),
    route(
        host_protocol::EXTENSION_CONFIG_IS_SUPPORTED_METHOD,
        HostMethodDispatcher::Empty(extension_config::is_supported),
    ),
    route(
        host_protocol::EXTENSION_PACKAGE_INSTALL_METHOD,
        HostMethodDispatcher::ExtensionPackage(extension_package::install_with_event),
    ),
    route(
        host_protocol::EXTENSION_PACKAGE_UPDATE_METHOD,
        HostMethodDispatcher::ExtensionPackage(extension_package::update_with_event),
    ),
    route(
        host_protocol::EXTENSION_PACKAGE_REMOVE_METHOD,
        HostMethodDispatcher::ExtensionPackage(extension_package::remove_with_event),
    ),
    route(
        host_protocol::EXTENSION_PACKAGE_LIST_METHOD,
        HostMethodDispatcher::Empty(extension_package::list),
    ),
    route(
        host_protocol::EXTENSION_PACKAGE_IS_SUPPORTED_METHOD,
        HostMethodDispatcher::Empty(extension_package::is_supported),
    ),
    route(
        host_protocol::LOCAL_TOOL_RUNTIME_REGISTER_METHOD,
        HostMethodDispatcher::LocalToolRuntime(local_tool_runtime::register_with_event),
    ),
    route(
        host_protocol::LOCAL_TOOL_RUNTIME_RUN_METHOD,
        HostMethodDispatcher::LocalToolRuntimeRun,
    ),
    route(
        host_protocol::LOCAL_TOOL_RUNTIME_STOP_METHOD,
        HostMethodDispatcher::LocalToolRuntime(local_tool_runtime::stop_with_event),
    ),
    route(
        host_protocol::LOCAL_TOOL_RUNTIME_HEALTH_METHOD,
        HostMethodDispatcher::LocalToolRuntime(local_tool_runtime::health_with_event),
    ),
    route(
        host_protocol::LOCAL_TOOL_RUNTIME_IS_SUPPORTED_METHOD,
        HostMethodDispatcher::Empty(local_tool_runtime::is_supported),
    ),
    route(
        host_protocol::WORKSPACE_INDEX_OPEN_METHOD,
        HostMethodDispatcher::WorkspaceIndex(workspace_index::open_with_event),
    ),
    route(
        host_protocol::WORKSPACE_INDEX_REFRESH_METHOD,
        HostMethodDispatcher::WorkspaceIndex(workspace_index::refresh_with_event),
    ),
    route(
        host_protocol::WORKSPACE_INDEX_CLOSE_METHOD,
        HostMethodDispatcher::WorkspaceIndex(workspace_index::close_with_event),
    ),
    route(
        host_protocol::WORKSPACE_INDEX_IS_SUPPORTED_METHOD,
        HostMethodDispatcher::Empty(workspace_index::is_supported),
    ),
    route(
        host_protocol::NATIVE_FILE_SYSTEM_OPEN_METHOD,
        HostMethodDispatcher::Payload(native_file_system::open),
    ),
    route(
        host_protocol::NATIVE_FILE_SYSTEM_STAT_METHOD,
        HostMethodDispatcher::Payload(native_file_system::stat),
    ),
    route(
        host_protocol::NATIVE_FILE_SYSTEM_WATCH_METHOD,
        HostMethodDispatcher::Payload(native_file_system::watch),
    ),
    route(
        host_protocol::NATIVE_FILE_SYSTEM_STOP_WATCHING_METHOD,
        HostMethodDispatcher::Payload(native_file_system::stop_watching),
    ),
    route(
        host_protocol::NATIVE_FILE_SYSTEM_IS_SUPPORTED_METHOD,
        HostMethodDispatcher::Empty(native_file_system::is_supported),
    ),
    route(
        host_protocol::SCOPED_ACCESS_GRANT_GRANT_METHOD,
        HostMethodDispatcher::Payload(scoped_access_grant::grant),
    ),
    route(
        host_protocol::SCOPED_ACCESS_GRANT_RESOLVE_METHOD,
        HostMethodDispatcher::Payload(scoped_access_grant::resolve),
    ),
    route(
        host_protocol::SCOPED_ACCESS_GRANT_REVOKE_METHOD,
        HostMethodDispatcher::Payload(scoped_access_grant::revoke),
    ),
    route(
        host_protocol::SCOPED_ACCESS_GRANT_IS_SUPPORTED_METHOD,
        HostMethodDispatcher::Empty(scoped_access_grant::is_supported),
    ),
    route(
        host_protocol::TRANSACTIONAL_FILE_MUTATION_PREPARE_METHOD,
        HostMethodDispatcher::Payload(transactional_file_mutation::prepare),
    ),
    route(
        host_protocol::TRANSACTIONAL_FILE_MUTATION_COMMIT_METHOD,
        HostMethodDispatcher::Payload(transactional_file_mutation::commit),
    ),
    route(
        host_protocol::TRANSACTIONAL_FILE_MUTATION_ROLLBACK_METHOD,
        HostMethodDispatcher::Payload(transactional_file_mutation::rollback),
    ),
    route(
        host_protocol::TRANSACTIONAL_FILE_MUTATION_IS_SUPPORTED_METHOD,
        HostMethodDispatcher::Empty(transactional_file_mutation::is_supported),
    ),
    route(
        host_protocol::MENU_SET_APPLICATION_MENU_METHOD,
        HostMethodDispatcher::Window(menu::set_application_menu),
    ),
    route(
        host_protocol::MENU_SET_WINDOW_MENU_METHOD,
        HostMethodDispatcher::Window(menu::set_window_menu),
    ),
    route(
        host_protocol::MENU_CLEAR_METHOD,
        HostMethodDispatcher::Payload(menu::clear),
    ),
    route(
        host_protocol::MENU_BIND_COMMAND_METHOD,
        HostMethodDispatcher::Payload(menu::bind_command),
    ),
    route(
        host_protocol::MENU_CAPABILITY_METHOD,
        HostMethodDispatcher::Payload(menu::capability),
    ),
    route(
        host_protocol::CONTEXT_MENU_SHOW_METHOD,
        HostMethodDispatcher::Payload(menu::show_context_menu),
    ),
    route(
        host_protocol::CONTEXT_MENU_BUILD_FROM_TEMPLATE_METHOD,
        HostMethodDispatcher::Payload(menu::build_context_menu_from_template),
    ),
    route(
        host_protocol::CONTEXT_MENU_BIND_COMMAND_METHOD,
        HostMethodDispatcher::Payload(menu::bind_context_menu_command),
    ),
    route(
        host_protocol::WEBVIEW_CREATE_METHOD,
        HostMethodDispatcher::Window(webview::create),
    ),
    route(
        host_protocol::WEBVIEW_LOAD_ROUTE_METHOD,
        HostMethodDispatcher::Window(webview::load_route),
    ),
    route(
        host_protocol::WEBVIEW_LOAD_URL_METHOD,
        HostMethodDispatcher::Window(webview::load_url),
    ),
    route(
        host_protocol::WEBVIEW_RELOAD_METHOD,
        HostMethodDispatcher::Window(webview::reload),
    ),
    route(
        host_protocol::WEBVIEW_STOP_METHOD,
        HostMethodDispatcher::Window(webview::stop),
    ),
    route(
        host_protocol::WEBVIEW_GO_BACK_METHOD,
        HostMethodDispatcher::Window(webview::go_back),
    ),
    route(
        host_protocol::WEBVIEW_GO_FORWARD_METHOD,
        HostMethodDispatcher::Window(webview::go_forward),
    ),
    route(
        host_protocol::WEBVIEW_GET_NAVIGATION_STATE_METHOD,
        HostMethodDispatcher::Window(webview::get_navigation_state),
    ),
    route(
        host_protocol::WEBVIEW_CAPTURE_SCREENSHOT_METHOD,
        HostMethodDispatcher::Window(webview::capture_screenshot),
    ),
    route(
        host_protocol::WEBVIEW_PRINT_METHOD,
        HostMethodDispatcher::Window(webview::print),
    ),
    route(
        host_protocol::WEBVIEW_PRINT_TO_PDF_METHOD,
        HostMethodDispatcher::Window(webview::print_to_pdf),
    ),
    route(
        host_protocol::WEBVIEW_FIND_IN_PAGE_METHOD,
        HostMethodDispatcher::Window(webview::find_in_page),
    ),
    route(
        host_protocol::WEBVIEW_SET_ZOOM_METHOD,
        HostMethodDispatcher::Window(webview::set_zoom),
    ),
    route(
        host_protocol::WEBVIEW_SET_USER_AGENT_METHOD,
        HostMethodDispatcher::Window(webview::set_user_agent),
    ),
    route(
        host_protocol::WEBVIEW_SET_AUDIO_MUTED_METHOD,
        HostMethodDispatcher::Window(webview::set_audio_muted),
    ),
    route(
        host_protocol::WEBVIEW_RESPOND_TO_PERMISSION_METHOD,
        HostMethodDispatcher::Window(webview::respond_to_permission),
    ),
    route(
        host_protocol::WEBVIEW_LIST_FRAMES_METHOD,
        HostMethodDispatcher::Window(webview::list_frames),
    ),
    route(
        host_protocol::WEBVIEW_POST_TO_FRAME_METHOD,
        HostMethodDispatcher::Window(webview::post_to_frame),
    ),
    route(
        host_protocol::WEBVIEW_OPEN_DEVTOOLS_METHOD,
        HostMethodDispatcher::Window(webview::open_devtools),
    ),
    route(
        host_protocol::WEBVIEW_CLOSE_DEVTOOLS_METHOD,
        HostMethodDispatcher::Window(webview::close_devtools),
    ),
    route(
        host_protocol::WEBVIEW_ATTACH_DEBUGGER_METHOD,
        HostMethodDispatcher::Window(webview::attach_debugger),
    ),
    route(
        host_protocol::WEBVIEW_SET_NAVIGATION_POLICY_METHOD,
        HostMethodDispatcher::Window(webview::set_navigation_policy),
    ),
    route(
        host_protocol::WEBVIEW_CAPABILITY_METHOD,
        HostMethodDispatcher::Payload(webview::capability),
    ),
    route(
        host_protocol::WEBVIEW_DESTROY_METHOD,
        HostMethodDispatcher::Window(webview::destroy),
    ),
    route(
        host_protocol::SESSION_PROFILE_FROM_PARTITION_METHOD,
        HostMethodDispatcher::Payload(session_profile::from_partition),
    ),
    route(
        host_protocol::SESSION_PROFILE_DESTROY_METHOD,
        HostMethodDispatcher::Payload(session_profile::destroy),
    ),
    route(
        host_protocol::SESSION_PROFILE_LIST_METHOD,
        HostMethodDispatcher::Payload(session_profile::list),
    ),
    route(
        host_protocol::SESSION_PROFILE_IS_SUPPORTED_METHOD,
        HostMethodDispatcher::Payload(session_profile::is_supported),
    ),
    route(
        host_protocol::COOKIE_STORE_GET_METHOD,
        HostMethodDispatcher::Payload(cookie_store::get),
    ),
    route(
        host_protocol::COOKIE_STORE_SET_METHOD,
        HostMethodDispatcher::Payload(cookie_store::set),
    ),
    route(
        host_protocol::COOKIE_STORE_REMOVE_METHOD,
        HostMethodDispatcher::Payload(cookie_store::remove),
    ),
    route(
        host_protocol::COOKIE_STORE_IS_SUPPORTED_METHOD,
        HostMethodDispatcher::Payload(cookie_store::is_supported),
    ),
    route(
        host_protocol::BROWSING_DATA_CLEAR_METHOD,
        HostMethodDispatcher::Payload(browsing_data::clear),
    ),
    route(
        host_protocol::BROWSING_DATA_ESTIMATE_METHOD,
        HostMethodDispatcher::Payload(browsing_data::estimate),
    ),
    route(
        host_protocol::BROWSING_DATA_LIST_TYPES_METHOD,
        HostMethodDispatcher::Payload(browsing_data::list_types),
    ),
    route(
        host_protocol::BROWSING_DATA_IS_SUPPORTED_METHOD,
        HostMethodDispatcher::Payload(browsing_data::is_supported),
    ),
    route(
        host_protocol::SESSION_PERMISSION_REQUEST_METHOD,
        HostMethodDispatcher::Payload(session_permission::request),
    ),
    route(
        host_protocol::SESSION_PERMISSION_DECIDE_METHOD,
        HostMethodDispatcher::Payload(session_permission::decide),
    ),
    route(
        host_protocol::SESSION_PERMISSION_LIST_DECISIONS_METHOD,
        HostMethodDispatcher::Payload(session_permission::list_decisions),
    ),
    route(
        host_protocol::SESSION_PERMISSION_IS_SUPPORTED_METHOD,
        HostMethodDispatcher::Payload(session_permission::is_supported),
    ),
    route(
        host_protocol::DOWNLOAD_START_METHOD,
        HostMethodDispatcher::Payload(download::start),
    ),
    route(
        host_protocol::DOWNLOAD_PAUSE_METHOD,
        HostMethodDispatcher::Payload(download::pause),
    ),
    route(
        host_protocol::DOWNLOAD_RESUME_METHOD,
        HostMethodDispatcher::Payload(download::resume),
    ),
    route(
        host_protocol::DOWNLOAD_CANCEL_METHOD,
        HostMethodDispatcher::Payload(download::cancel),
    ),
    route(
        host_protocol::DOWNLOAD_LIST_METHOD,
        HostMethodDispatcher::Payload(download::list),
    ),
    route(
        host_protocol::DOWNLOAD_IS_SUPPORTED_METHOD,
        HostMethodDispatcher::Payload(download::is_supported),
    ),
    route(
        host_protocol::NETWORK_AUTH_SET_PROXY_METHOD,
        HostMethodDispatcher::Payload(network_auth::set_proxy),
    ),
    route(
        host_protocol::NETWORK_AUTH_HANDLE_AUTH_METHOD,
        HostMethodDispatcher::Payload(network_auth::handle_auth),
    ),
    route(
        host_protocol::NETWORK_AUTH_HANDLE_CERTIFICATE_METHOD,
        HostMethodDispatcher::Payload(network_auth::handle_certificate),
    ),
    route(
        host_protocol::NETWORK_AUTH_IS_SUPPORTED_METHOD,
        HostMethodDispatcher::Payload(network_auth::is_supported),
    ),
];

const fn route(method: &'static str, dispatcher: HostMethodDispatcher) -> HostMethodRoute {
    HostMethodRoute { method, dispatcher }
}

impl HostMethodRegistry {
    fn dispatch(
        &self,
        router: &HostMethodRouter,
        request: HostDispatchRequest,
    ) -> Vec<HostProtocolEnvelope> {
        let Some(route) = self
            .routes
            .iter()
            .find(|route| route.method == request.method)
        else {
            return response_frame(
                request.id,
                request.timestamp,
                request.trace_id,
                None,
                Some(HostProtocolError::method_not_found(request.method)),
            );
        };
        route.dispatcher.dispatch(router, route.method, request)
    }

    #[cfg(test)]
    fn methods(&self) -> impl Iterator<Item = &'static str> + '_ {
        self.routes.iter().map(|route| route.method)
    }
}

impl HostMethodDispatcher {
    fn dispatch(
        &self,
        router: &HostMethodRouter,
        method: &'static str,
        request: HostDispatchRequest,
    ) -> Vec<HostProtocolEnvelope> {
        match self {
            Self::Ping => {
                response_frame(request.id, request.timestamp, request.trace_id, None, None)
            }
            Self::Version => response_frame(
                request.id,
                request.timestamp,
                request.trace_id,
                Some(handshake::version_payload()),
                None,
            ),
            Self::Payload(handler) => dispatch_result_frame(
                request.id,
                request.timestamp,
                request.trace_id,
                handler(request.payload),
            ),
            Self::Empty(handler) => {
                dispatch_result_frame(request.id, request.timestamp, request.trace_id, handler())
            }
            Self::Window(handler) => dispatch_result_frame(
                request.id,
                request.timestamp,
                request.trace_id,
                handler(&*router.window, request.payload),
            ),
            Self::TrayCreate(handler) => {
                let event_sender = router
                    .runtime_event_sender
                    .lock()
                    .ok()
                    .and_then(|sender| sender.clone());
                dispatch_result_frame(
                    request.id,
                    request.timestamp,
                    request.trace_id,
                    handler(&*router.window, request.payload, event_sender),
                )
            }
            Self::EventfulPayload(handler) => {
                let event_sender = router
                    .runtime_event_sender
                    .lock()
                    .ok()
                    .and_then(|sender| sender.clone());
                dispatch_result_frame(
                    request.id,
                    request.timestamp,
                    request.trace_id,
                    handler(request.payload, event_sender),
                )
            }
            Self::WindowDestroy => {
                let destroy_payload = request.payload.clone();
                let result = window::destroy(&*router.window, request.payload);
                if result.is_ok() {
                    if let Some(window_id) = decode_window_destroy_id(destroy_payload) {
                        if let Err(error) = realtime_media_session::close_sessions_for_window(
                            &window_id,
                            host_protocol::WINDOW_DESTROY_METHOD,
                        ) {
                            return response_frame(
                                request.id,
                                request.timestamp,
                                request.trace_id,
                                None,
                                Some(error),
                            );
                        }
                    }
                }
                dispatch_result_frame(request.id, request.timestamp, request.trace_id, result)
            }
            Self::UnsupportedGlobalShortcut => dispatch_result_frame(
                request.id,
                request.timestamp,
                request.trace_id,
                Err(linux::unsupported_global_shortcut(method)),
            ),
            Self::EgressRecord => dispatch_egress_record(request),
            Self::RealtimeMedia(handler) => router.dispatch_realtime_media_session(
                RealtimeMediaDispatch {
                    id: request.id,
                    trace_id: request.trace_id,
                    window_id: request.window_id,
                    payload: request.payload,
                    timestamp: request.timestamp,
                },
                *handler,
            ),
            Self::ExtensionConfig(handler) => router.dispatch_extension_config(
                ExtensionConfigDispatch {
                    id: request.id,
                    trace_id: request.trace_id,
                    window_id: request.window_id,
                    payload: request.payload,
                    timestamp: request.timestamp,
                },
                *handler,
            ),
            Self::ExtensionPackage(handler) => router.dispatch_extension_package(
                ExtensionPackageDispatch {
                    id: request.id,
                    trace_id: request.trace_id,
                    window_id: request.window_id,
                    payload: request.payload,
                    timestamp: request.timestamp,
                },
                *handler,
            ),
            Self::DistributionParity(handler) => router.dispatch_distribution_parity(
                DistributionParityDispatch {
                    id: request.id,
                    trace_id: request.trace_id,
                    window_id: request.window_id,
                    payload: request.payload,
                    timestamp: request.timestamp,
                },
                *handler,
            ),
            Self::Job(handler) => router.dispatch_job(
                JobDispatch {
                    id: request.id,
                    trace_id: request.trace_id,
                    window_id: request.window_id,
                    payload: request.payload,
                    timestamp: request.timestamp,
                },
                *handler,
            ),
            Self::LocalToolRuntime(handler) => router.dispatch_local_tool_runtime(
                LocalToolRuntimeDispatch {
                    id: request.id,
                    method: request.method,
                    trace_id: request.trace_id,
                    window_id: request.window_id,
                    payload: request.payload,
                    timestamp: request.timestamp,
                },
                *handler,
            ),
            Self::LocalToolRuntimeRun => {
                router.dispatch_local_tool_runtime_run(LocalToolRuntimeDispatch {
                    id: request.id,
                    method: request.method,
                    trace_id: request.trace_id,
                    window_id: request.window_id,
                    payload: request.payload,
                    timestamp: request.timestamp,
                })
            }
            Self::WorkspaceIndex(handler) => router.dispatch_workspace_index(
                WorkspaceIndexDispatch {
                    id: request.id,
                    trace_id: request.trace_id,
                    window_id: request.window_id,
                    payload: request.payload,
                    timestamp: request.timestamp,
                },
                *handler,
            ),
        }
    }
}

fn dispatch_egress_record(request: HostDispatchRequest) -> Vec<HostProtocolEnvelope> {
    let (payload, event_payload, error) =
        match egress_policy::record_with_event(request.payload, request.timestamp) {
            Ok((payload, event_payload)) => (payload, event_payload, None),
            Err(error) => (None, None, Some(error)),
        };

    let response = HostProtocolEnvelope::Response {
        id: request.id,
        timestamp: request.timestamp,
        trace_id: request.trace_id.clone(),
        payload,
        error,
    };

    match event_payload {
        Some(payload) => vec![
            HostProtocolEnvelope::Event {
                method: host_protocol::EGRESS_POLICY_DECISION_RECORDED_EVENT.to_string(),
                timestamp: request.timestamp,
                trace_id: request.trace_id,
                window_id: request.window_id,
                payload: Some(payload),
            },
            response,
        ],
        None => vec![response],
    }
}

fn dispatch_result_frame(
    id: String,
    timestamp: u64,
    trace_id: String,
    result: Result<Option<serde_json::Value>, HostProtocolError>,
) -> Vec<HostProtocolEnvelope> {
    let (payload, error) = match result {
        Ok(payload) => (payload, None),
        Err(error) => (None, Some(error)),
    };
    response_frame(id, timestamp, trace_id, payload, error)
}

fn response_frame(
    id: String,
    timestamp: u64,
    trace_id: String,
    payload: Option<serde_json::Value>,
    error: Option<HostProtocolError>,
) -> Vec<HostProtocolEnvelope> {
    vec![HostProtocolEnvelope::Response {
        id,
        timestamp,
        trace_id,
        payload,
        error,
    }]
}

#[derive(Clone)]
pub(crate) struct HostMethodRouter {
    window: Arc<dyn WindowMethodHandler>,
    runtime_event_sender: Arc<Mutex<Option<Sender<HostProtocolEnvelope>>>>,
    runtime_session_failure_sender: Arc<Mutex<Option<Sender<realtime_media_session::SessionKey>>>>,
    local_tool_runtime_ids: Arc<Mutex<HashSet<String>>>,
}

impl HostMethodRouter {
    pub(crate) fn new(window: Arc<dyn WindowMethodHandler>) -> Self {
        Self {
            window,
            runtime_event_sender: Arc::new(Mutex::new(None)),
            runtime_session_failure_sender: Arc::new(Mutex::new(None)),
            local_tool_runtime_ids: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    pub(crate) fn dispatch_frames(
        &self,
        envelope: HostProtocolEnvelope,
    ) -> Vec<HostProtocolEnvelope> {
        self.dispatch_frames_at(envelope, timestamp_millis())
    }

    fn dispatch_cancel(&self, envelope: &HostProtocolEnvelope) -> Result<(), String> {
        let HostProtocolEnvelope::Cancel {
            id, resource_id, ..
        } = envelope
        else {
            return Ok(());
        };
        if let Some(request_id) = id.as_deref() {
            local_tool_runtime::cancel_run_for_request_id(request_id, "host.runtime.cancel")
                .map_err(|error| format!("{error:?}"))?;
        }
        realtime_media_session::close_session_for_cancel(
            id.as_deref(),
            resource_id.as_deref(),
            "host.runtime.cancel",
        )
        .map_err(|error| format!("{error:?}"))
    }

    pub(crate) fn track_pending_local_tool_runtime_run_request(
        &self,
        envelope: &HostProtocolEnvelope,
    ) -> Result<(), String> {
        let HostProtocolEnvelope::Request { id, method, .. } = envelope else {
            return Ok(());
        };
        if method != host_protocol::LOCAL_TOOL_RUNTIME_RUN_METHOD {
            return Ok(());
        }
        local_tool_runtime::track_pending_run_request(id, "host.runtime.request")
            .map_err(|error| format!("{error:?}"))
    }

    pub(crate) fn clear_runtime_resources(&self) -> Result<(), String> {
        power_monitor::clear_runtime_event_sender().map_err(|error| format!("{error:?}"))?;
        system_appearance::clear_runtime_event_sender().map_err(|error| format!("{error:?}"))?;
        clear_screen_runtime_event_state().map_err(|error| format!("{error:?}"))?;
        clear_window_runtime_event_state().map_err(|error| format!("{error:?}"))?;
        clear_webview_runtime_event_state().map_err(|error| format!("{error:?}"))?;
        clear_tray_runtime_event_state().map_err(|error| format!("{error:?}"))?;
        self.window
            .clear_runtime_trays()
            .map_err(|error| format!("{error:?}"))?;
        notification::clear_runtime_notifications().map_err(|error| format!("{error:?}"))?;
        realtime_media_session::close_all_sessions("host.runtime.disconnect")
            .map_err(|error| format!("{error:?}"))?;
        let runtime_ids = self.drain_local_tool_runtime_ids()?;
        local_tool_runtime::clear_runtime_resources_for_runtime_ids(
            &runtime_ids,
            "host.runtime.disconnect",
        )
        .map_err(|error| format!("{error:?}"))
    }

    pub(crate) fn install_runtime_event_sender(
        &self,
        sender: Sender<HostProtocolEnvelope>,
    ) -> Result<(), String> {
        power_monitor::install_runtime_event_sender(sender.clone())
            .map_err(|error| format!("{error:?}"))?;
        system_appearance::install_runtime_event_sender(sender.clone())
            .map_err(|error| format!("{error:?}"))?;
        install_screen_event_sender(sender.clone()).map_err(|error| format!("{error:?}"))?;
        install_window_event_sender(sender.clone()).map_err(|error| format!("{error:?}"))?;
        install_webview_event_sender(sender.clone()).map_err(|error| format!("{error:?}"))?;
        *self
            .runtime_event_sender
            .lock()
            .map_err(|_| "runtime event sender lock poisoned".to_string())? = Some(sender);
        Ok(())
    }

    pub(crate) fn clear_runtime_event_sender(&self) -> Result<(), String> {
        power_monitor::clear_runtime_event_sender().map_err(|error| format!("{error:?}"))?;
        system_appearance::clear_runtime_event_sender().map_err(|error| format!("{error:?}"))?;
        clear_screen_runtime_event_state().map_err(|error| format!("{error:?}"))?;
        clear_window_runtime_event_state().map_err(|error| format!("{error:?}"))?;
        clear_webview_runtime_event_state().map_err(|error| format!("{error:?}"))?;
        *self
            .runtime_event_sender
            .lock()
            .map_err(|_| "runtime event sender lock poisoned".to_string())? = None;
        Ok(())
    }

    pub(crate) fn install_runtime_session_failure_sender(
        &self,
        sender: Sender<realtime_media_session::SessionKey>,
    ) -> Result<(), String> {
        *self
            .runtime_session_failure_sender
            .lock()
            .map_err(|_| "runtime session failure sender lock poisoned".to_string())? =
            Some(sender);
        Ok(())
    }

    pub(crate) fn clear_runtime_session_failure_sender(&self) -> Result<(), String> {
        *self
            .runtime_session_failure_sender
            .lock()
            .map_err(|_| "runtime session failure sender lock poisoned".to_string())? = None;
        Ok(())
    }

    fn track_local_tool_runtime(&self, runtime_id: String) -> Option<HostProtocolError> {
        let Ok(mut runtime_ids) = self.local_tool_runtime_ids.lock() else {
            return Some(HostProtocolError::internal(
                "local tool runtime owner lock poisoned",
                "host.runtime.localToolRuntime.track",
            ));
        };
        runtime_ids.insert(runtime_id);
        None
    }

    fn forget_local_tool_runtime(&self, runtime_id: &str) -> Option<HostProtocolError> {
        let Ok(mut runtime_ids) = self.local_tool_runtime_ids.lock() else {
            return Some(HostProtocolError::internal(
                "local tool runtime owner lock poisoned",
                "host.runtime.localToolRuntime.forget",
            ));
        };
        runtime_ids.remove(runtime_id);
        None
    }

    fn drain_local_tool_runtime_ids(&self) -> Result<Vec<String>, String> {
        let mut runtime_ids = self
            .local_tool_runtime_ids
            .lock()
            .map_err(|_| "local tool runtime owner lock poisoned".to_string())?;
        Ok(runtime_ids.drain().collect())
    }

    pub(crate) fn handle_realtime_media_session_failure(
        &self,
        key: realtime_media_session::SessionKey,
    ) {
        realtime_media_session::handle_session_failure(key);
    }

    #[cfg(test)]
    fn dispatch_at(
        &self,
        envelope: HostProtocolEnvelope,
        timestamp: u64,
    ) -> Option<HostProtocolEnvelope> {
        self.dispatch_frames_at(envelope, timestamp)
            .into_iter()
            .next()
    }

    #[cfg(test)]
    fn registered_methods(&self) -> Vec<&'static str> {
        HOST_DISPATCH_REGISTRY.methods().collect()
    }

    fn dispatch_frames_at(
        &self,
        envelope: HostProtocolEnvelope,
        timestamp: u64,
    ) -> Vec<HostProtocolEnvelope> {
        if matches!(envelope, HostProtocolEnvelope::Cancel { .. }) {
            let _ = self.dispatch_cancel(&envelope);
            return Vec::new();
        }

        let HostProtocolEnvelope::Request {
            id,
            method,
            trace_id,
            window_id,
            payload,
            ..
        } = envelope
        else {
            return Vec::new();
        };

        HOST_DISPATCH_REGISTRY.dispatch(
            self,
            HostDispatchRequest {
                id,
                method,
                trace_id,
                payload,
                window_id,
                timestamp,
            },
        )
    }

    fn dispatch_realtime_media_session(
        &self,
        request: RealtimeMediaDispatch,
        handler: RealtimeMediaHandler,
    ) -> Vec<HostProtocolEnvelope> {
        let (payload, events, error) = match handler(
            &request.id,
            request.payload,
            request.timestamp,
            request.window_id.as_deref(),
            self.runtime_event_sender
                .lock()
                .ok()
                .and_then(|sender| sender.clone()),
            self.runtime_session_failure_sender
                .lock()
                .ok()
                .and_then(|sender| sender.clone()),
        ) {
            Ok((payload, events)) => (payload, events, None),
            Err(error) => (None, Vec::new(), Some(error)),
        };

        let mut frames = events
            .into_iter()
            .map(|(event_method, payload)| HostProtocolEnvelope::Event {
                method: event_method.to_string(),
                timestamp: request.timestamp,
                trace_id: request.trace_id.clone(),
                window_id: request.window_id.clone(),
                payload: Some(payload),
            })
            .collect::<Vec<_>>();
        frames.push(HostProtocolEnvelope::Response {
            id: request.id,
            timestamp: request.timestamp,
            trace_id: request.trace_id.clone(),
            payload,
            error,
        });
        frames
    }

    fn dispatch_extension_config(
        &self,
        request: ExtensionConfigDispatch,
        handler: ExtensionConfigHandler,
    ) -> Vec<HostProtocolEnvelope> {
        let (payload, event_payload, error) = match handler(request.payload, request.timestamp) {
            Ok((payload, event_payload)) => (payload, event_payload, None),
            Err(error) => (None, None, Some(error)),
        };

        let response = HostProtocolEnvelope::Response {
            id: request.id,
            timestamp: request.timestamp,
            trace_id: request.trace_id.clone(),
            payload,
            error,
        };

        match event_payload {
            Some(payload) => vec![
                HostProtocolEnvelope::Event {
                    method: host_protocol::EXTENSION_CONFIG_EVENT.to_string(),
                    timestamp: request.timestamp,
                    trace_id: request.trace_id,
                    window_id: request.window_id,
                    payload: Some(payload),
                },
                response,
            ],
            None => vec![response],
        }
    }

    fn dispatch_extension_package(
        &self,
        request: ExtensionPackageDispatch,
        handler: ExtensionPackageHandler,
    ) -> Vec<HostProtocolEnvelope> {
        let (payload, event_payload, error) = match handler(request.payload, request.timestamp) {
            Ok((payload, event_payload)) => (payload, event_payload, None),
            Err(error) => (None, None, Some(error)),
        };

        let response = HostProtocolEnvelope::Response {
            id: request.id,
            timestamp: request.timestamp,
            trace_id: request.trace_id.clone(),
            payload,
            error,
        };

        match event_payload {
            Some(payload) => vec![
                HostProtocolEnvelope::Event {
                    method: host_protocol::EXTENSION_PACKAGE_EVENT.to_string(),
                    timestamp: request.timestamp,
                    trace_id: request.trace_id,
                    window_id: request.window_id,
                    payload: Some(payload),
                },
                response,
            ],
            None => vec![response],
        }
    }

    fn dispatch_distribution_parity(
        &self,
        request: DistributionParityDispatch,
        handler: DistributionParityHandler,
    ) -> Vec<HostProtocolEnvelope> {
        let (payload, event_payload, error) = handler(request.payload, request.timestamp);

        let response = HostProtocolEnvelope::Response {
            id: request.id,
            timestamp: request.timestamp,
            trace_id: request.trace_id.clone(),
            payload,
            error,
        };

        match event_payload {
            Some(payload) => vec![
                HostProtocolEnvelope::Event {
                    method: host_protocol::DISTRIBUTION_PARITY_EVENT.to_string(),
                    timestamp: request.timestamp,
                    trace_id: request.trace_id,
                    window_id: request.window_id,
                    payload: Some(payload),
                },
                response,
            ],
            None => vec![response],
        }
    }

    fn dispatch_job(&self, request: JobDispatch, handler: JobHandler) -> Vec<HostProtocolEnvelope> {
        let (payload, event_payload, error) = match handler(request.payload, request.timestamp) {
            Ok((payload, event_payload)) => (payload, event_payload, None),
            Err(error) => (None, None, Some(error)),
        };

        let response = HostProtocolEnvelope::Response {
            id: request.id,
            timestamp: request.timestamp,
            trace_id: request.trace_id.clone(),
            payload,
            error,
        };

        match event_payload {
            Some(payload) => vec![
                HostProtocolEnvelope::Event {
                    method: host_protocol::JOB_EVENT.to_string(),
                    timestamp: request.timestamp,
                    trace_id: request.trace_id,
                    window_id: request.window_id,
                    payload: Some(payload),
                },
                response,
            ],
            None => vec![response],
        }
    }

    fn dispatch_local_tool_runtime(
        &self,
        request: LocalToolRuntimeDispatch,
        handler: LocalToolRuntimeHandler,
    ) -> Vec<HostProtocolEnvelope> {
        let (payload, events, error) = match handler(request.payload, request.timestamp) {
            Ok((payload, events)) => (payload, events, None),
            Err(error) => (None, Vec::new(), Some(error)),
        };
        if error.is_none() {
            if let Some(tracking_error) =
                self.update_local_tool_runtime_tracking(&request.method, payload.as_ref())
            {
                return vec![HostProtocolEnvelope::Response {
                    id: request.id,
                    timestamp: request.timestamp,
                    trace_id: request.trace_id,
                    payload: None,
                    error: Some(tracking_error),
                }];
            }
        }

        let mut frames = events
            .into_iter()
            .map(|(event_method, payload)| HostProtocolEnvelope::Event {
                method: event_method.to_string(),
                timestamp: request.timestamp,
                trace_id: request.trace_id.clone(),
                window_id: request.window_id.clone(),
                payload: Some(payload),
            })
            .collect::<Vec<_>>();
        frames.push(HostProtocolEnvelope::Response {
            id: request.id,
            timestamp: request.timestamp,
            trace_id: request.trace_id,
            payload,
            error,
        });
        frames
    }

    fn update_local_tool_runtime_tracking(
        &self,
        method: &str,
        payload: Option<&serde_json::Value>,
    ) -> Option<HostProtocolError> {
        match method {
            host_protocol::LOCAL_TOOL_RUNTIME_REGISTER_METHOD => {
                let Some(runtime_id) = local_tool_runtime_payload_id(payload) else {
                    return Some(HostProtocolError::internal(
                        "local tool runtime response omitted runtimeId",
                        host_protocol::LOCAL_TOOL_RUNTIME_REGISTER_METHOD,
                    ));
                };
                self.track_local_tool_runtime(runtime_id)
            }
            host_protocol::LOCAL_TOOL_RUNTIME_STOP_METHOD => {
                let Some(runtime_id) = local_tool_runtime_payload_id(payload) else {
                    return Some(HostProtocolError::internal(
                        "local tool runtime response omitted runtimeId",
                        host_protocol::LOCAL_TOOL_RUNTIME_STOP_METHOD,
                    ));
                };
                self.forget_local_tool_runtime(&runtime_id)
            }
            _ => None,
        }
    }

    fn dispatch_local_tool_runtime_run(
        &self,
        request: LocalToolRuntimeDispatch,
    ) -> Vec<HostProtocolEnvelope> {
        let event_sink = match self.runtime_event_sender.lock() {
            Ok(sender) => sender.clone().map(|sender| {
                local_tool_runtime::RuntimeEventSink::new(
                    sender,
                    request.trace_id.clone(),
                    request.window_id.clone(),
                )
            }),
            Err(_) => {
                return vec![HostProtocolEnvelope::Response {
                    id: request.id,
                    timestamp: request.timestamp,
                    trace_id: request.trace_id,
                    payload: None,
                    error: Some(HostProtocolError::internal(
                        "runtime event sender lock poisoned",
                        host_protocol::LOCAL_TOOL_RUNTIME_RUN_METHOD,
                    )),
                }];
            }
        };
        let (payload, events, error) = match local_tool_runtime::run_with_event_sink_for_request(
            request.payload,
            request.timestamp,
            Some(&request.id),
            event_sink,
        ) {
            Ok((payload, events)) => (payload, events, None),
            Err(error) => (None, Vec::new(), Some(error)),
        };
        local_tool_runtime::clear_run_request_tracking(&request.id);

        let mut frames = events
            .into_iter()
            .map(|(event_method, payload)| HostProtocolEnvelope::Event {
                method: event_method.to_string(),
                timestamp: request.timestamp,
                trace_id: request.trace_id.clone(),
                window_id: request.window_id.clone(),
                payload: Some(payload),
            })
            .collect::<Vec<_>>();
        frames.push(HostProtocolEnvelope::Response {
            id: request.id,
            timestamp: request.timestamp,
            trace_id: request.trace_id,
            payload,
            error,
        });
        frames
    }

    fn dispatch_workspace_index(
        &self,
        request: WorkspaceIndexDispatch,
        handler: WorkspaceIndexHandler,
    ) -> Vec<HostProtocolEnvelope> {
        let (payload, events, error) = match handler(request.payload, request.timestamp) {
            Ok((payload, events)) => (payload, events, None),
            Err(error) => (None, Vec::new(), Some(error)),
        };

        let mut frames = events
            .into_iter()
            .map(|(event_method, payload)| HostProtocolEnvelope::Event {
                method: event_method.to_string(),
                timestamp: request.timestamp,
                trace_id: request.trace_id.clone(),
                window_id: request.window_id.clone(),
                payload: Some(payload),
            })
            .collect::<Vec<_>>();
        frames.push(HostProtocolEnvelope::Response {
            id: request.id,
            timestamp: request.timestamp,
            trace_id: request.trace_id,
            payload,
            error,
        });
        frames
    }
}

fn timestamp_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after Unix epoch")
        .as_millis()
        .try_into()
        .expect("timestamp milliseconds should fit in u64")
}

fn decode_window_destroy_id(payload: Option<serde_json::Value>) -> Option<String> {
    payload
        .and_then(|payload| {
            serde_json::from_value::<host_protocol::WindowDestroyPayload>(payload).ok()
        })
        .map(|payload| payload.window_id().to_string())
}

fn local_tool_runtime_payload_id(payload: Option<&serde_json::Value>) -> Option<String> {
    payload
        .and_then(|payload| payload.get("runtimeId"))
        .and_then(serde_json::Value::as_str)
        .map(ToString::to_string)
}

#[cfg(test)]
mod tests {
    use super::{autostart, resident_lifecycle, HostMethodRouter};
    use crate::window::{TrayCreateRequest, WindowCreateRequest, WindowMethodHandler};
    use host_protocol::{
        ClipboardSupportedPayload, HostProtocolEnvelope, HostProtocolError, WindowBoundsPayload,
        WindowCreateResponse, PROTOCOL_VERSION,
    };
    use std::path::{Path, PathBuf};
    use std::sync::{Arc, Mutex};
    use std::time::{SystemTime, UNIX_EPOCH};
    use std::{env, fs};

    #[test]
    fn ping_returns_response_with_matching_id_and_trace() {
        let response = test_router()
            .dispatch_at(request("request-ping", "host.ping"), 1710000000100)
            .expect("ping should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-ping".to_string(),
                timestamp: 1710000000100,
                trace_id: "trace-request-ping".to_string(),
                payload: None,
                error: None,
            }
        );
    }

    #[test]
    fn version_returns_protocol_version_payload() {
        let response = test_router()
            .dispatch_at(request("request-version", "host.version"), 1710000000101)
            .expect("version should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-version".to_string(),
                timestamp: 1710000000101,
                trace_id: "trace-request-version".to_string(),
                payload: Some(serde_json::json!({
                    "protocolVersion": PROTOCOL_VERSION
                })),
                error: None,
            }
        );
    }

    #[test]
    fn host_dispatch_registry_exposes_unique_registered_methods() {
        let methods = test_router().registered_methods();
        let unique = methods
            .iter()
            .copied()
            .collect::<std::collections::HashSet<_>>();

        assert_eq!(unique.len(), methods.len());
        assert!(unique.contains(host_protocol::HOST_PING_METHOD));
        assert!(unique.contains(host_protocol::WINDOW_CREATE_METHOD));
        assert!(unique.contains(host_protocol::WINDOW_GET_CURRENT_METHOD));
        assert!(unique.contains(host_protocol::WINDOW_GET_BY_ID_METHOD));
        assert!(unique.contains(host_protocol::WINDOW_LIST_METHOD));
        assert!(unique.contains(host_protocol::EGRESS_POLICY_RECORD_METHOD));
        assert!(unique.contains(host_protocol::EXECUTION_SANDBOX_CREATE_METHOD));
        assert!(!unique.contains("host.missing"));
    }

    #[test]
    fn host_dispatch_registry_covers_host_protocol_methods() {
        let registered = test_router()
            .registered_methods()
            .into_iter()
            .map(str::to_string)
            .collect::<std::collections::HashSet<_>>();
        let declared = declared_host_protocol_methods()
            .into_iter()
            .filter(|method| method != host_protocol::RENDERER_RESUME_METHOD)
            .collect::<std::collections::HashSet<_>>();

        let missing = declared
            .difference(&registered)
            .cloned()
            .collect::<Vec<_>>();
        let extra = registered
            .difference(&declared)
            .cloned()
            .collect::<Vec<_>>();

        assert_eq!(missing, Vec::<String>::new());
        assert_eq!(extra, Vec::<String>::new());
    }

    #[test]
    fn unknown_method_returns_method_not_found() {
        let response = test_router()
            .dispatch_at(request("request-missing", "host.missing"), 1710000000102)
            .expect("unknown request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-missing".to_string(),
                timestamp: 1710000000102,
                trace_id: "trace-request-missing".to_string(),
                payload: None,
                error: Some(HostProtocolError::method_not_found("host.missing")),
            }
        );
    }

    #[test]
    fn legacy_app_methods_owned_by_narrow_surfaces_are_not_host_routes() {
        for method in ["App.getInfo", "App.getCommandLine", "App.setOpenAtLogin"] {
            let response = test_router()
                .dispatch_at(
                    request("request-legacy-app-metadata", method),
                    1710000000102,
                )
                .expect("legacy app metadata request should return response");

            let HostProtocolEnvelope::Response {
                error: Some(error), ..
            } = response
            else {
                panic!("legacy app metadata method should not be routed");
            };
            assert_eq!(error, HostProtocolError::method_not_found(method));
        }
    }

    #[test]
    fn focused_application_context_support_dispatches_through_router() {
        let response = test_router()
            .dispatch_at(
                request(
                    "request-focused-application-context-supported",
                    host_protocol::FOCUSED_APPLICATION_CONTEXT_IS_SUPPORTED_METHOD,
                ),
                1710000000103,
            )
            .expect("focused application context support request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-focused-application-context-supported".to_string(),
                timestamp: 1710000000103,
                trace_id: "trace-request-focused-application-context-supported".to_string(),
                payload: Some(serde_json::json!({
                    "supported": false,
                    "reason": host_protocol::FOCUSED_APPLICATION_CONTEXT_UNSUPPORTED_REASON
                })),
                error: None,
            }
        );
    }

    #[test]
    fn display_capture_support_dispatches_through_router() {
        let response = test_router()
            .dispatch_at(
                request(
                    "request-display-capture-supported",
                    host_protocol::DISPLAY_CAPTURE_IS_SUPPORTED_METHOD,
                ),
                1710000000104,
            )
            .expect("display capture support request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-display-capture-supported".to_string(),
                timestamp: 1710000000104,
                trace_id: "trace-request-display-capture-supported".to_string(),
                payload: Some(display_capture_support_payload()),
                error: None,
            }
        );
    }

    fn display_capture_support_payload() -> serde_json::Value {
        #[cfg(target_os = "macos")]
        {
            serde_json::json!({ "supported": true })
        }

        #[cfg(not(target_os = "macos"))]
        {
            serde_json::json!({
                "supported": false,
                "reason": host_protocol::DISPLAY_CAPTURE_UNSUPPORTED_REASON
            })
        }
    }

    #[test]
    fn transient_window_role_support_dispatches_through_router() {
        let response = test_router()
            .dispatch_at(
                request(
                    "request-transient-window-role-supported",
                    host_protocol::TRANSIENT_WINDOW_ROLE_IS_SUPPORTED_METHOD,
                ),
                1710000000105,
            )
            .expect("transient window role support request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-transient-window-role-supported".to_string(),
                timestamp: 1710000000105,
                trace_id: "trace-request-transient-window-role-supported".to_string(),
                payload: Some(serde_json::json!({
                    "supported": false,
                    "reason": host_protocol::TRANSIENT_WINDOW_ROLE_UNSUPPORTED_REASON
                })),
                error: None,
            }
        );
    }

    #[test]
    fn transient_window_role_mutations_dispatch_through_router() {
        let cases = [
            (
                "request-transient-window-role-open",
                host_protocol::TRANSIENT_WINDOW_ROLE_OPEN_METHOD,
                serde_json::json!({
                    "actor": { "kind": "workspace", "id": "workspace-1" },
                    "roleId": "palette-1",
                    "policy": {
                        "role": "palette",
                        "focus": "take-focus",
                        "dismissal": "escape",
                        "zOrder": "floating",
                        "placement": {
                            "kind": "point",
                            "point": { "x": 20.0, "y": 40.0 }
                        },
                        "restoration": "restore-focus"
                    }
                }),
            ),
            (
                "request-transient-window-role-reposition",
                host_protocol::TRANSIENT_WINDOW_ROLE_REPOSITION_METHOD,
                serde_json::json!({
                    "actor": { "kind": "workspace", "id": "workspace-1" },
                    "handle": transient_window_role_handle(),
                    "placement": { "kind": "centered" }
                }),
            ),
            (
                "request-transient-window-role-dismiss",
                host_protocol::TRANSIENT_WINDOW_ROLE_DISMISS_METHOD,
                serde_json::json!({
                    "actor": { "kind": "workspace", "id": "workspace-1" },
                    "handle": transient_window_role_handle()
                }),
            ),
        ];

        for (id, method, payload) in cases {
            let response = test_router()
                .dispatch_at(request_with_payload(id, method, payload), 1710000000106)
                .expect("transient window role mutation request should return response");

            let HostProtocolEnvelope::Response { error, .. } = response else {
                panic!("transient window role mutation should return response");
            };
            assert!(matches!(error, Some(HostProtocolError::Unsupported { .. })));
        }
    }

    #[test]
    fn activation_registry_support_dispatches_through_router() {
        let response = test_router()
            .dispatch_at(
                request(
                    "request-activation-registry-supported",
                    host_protocol::ACTIVATION_REGISTRY_IS_SUPPORTED_METHOD,
                ),
                1710000000107,
            )
            .expect("activation registry support request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-activation-registry-supported".to_string(),
                timestamp: 1710000000107,
                trace_id: "trace-request-activation-registry-supported".to_string(),
                payload: Some(serde_json::json!({
                    "supported": true
                })),
                error: None,
            }
        );
    }

    #[test]
    fn activation_registry_methods_dispatch_through_router() {
        let surface_id = "palette-router";
        let register = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-activation-registry-register",
                    host_protocol::ACTIVATION_REGISTRY_REGISTER_SURFACE_METHOD,
                    serde_json::json!({
                        "surfaceId": surface_id,
                        "source": "global-shortcut",
                        "commandId": "activation.open",
                        "actor": { "kind": "workspace", "id": "workspace-1" },
                        "ownerScope": "workspace:workspace-1",
                        "traceId": "trace-1"
                    }),
                ),
                1710000000108,
            )
            .expect("activation registry register request should return response");

        assert_eq!(
            register,
            HostProtocolEnvelope::Response {
                id: "request-activation-registry-register".to_string(),
                timestamp: 1710000000108,
                trace_id: "trace-request-activation-registry-register".to_string(),
                payload: Some(serde_json::json!({
                    "kind": "activation-surface",
                    "id": surface_id,
                    "generation": 0,
                    "ownerScope": "workspace:workspace-1",
                    "state": "registered"
                })),
                error: None,
            }
        );

        let list = test_router()
            .dispatch_at(
                request(
                    "request-activation-registry-list",
                    host_protocol::ACTIVATION_REGISTRY_LIST_SURFACES_METHOD,
                ),
                1710000000109,
            )
            .expect("activation registry list request should return response");

        let HostProtocolEnvelope::Response { payload, error, .. } = list else {
            panic!("activation registry list request should return response");
        };
        assert!(error.is_none());
        let surfaces = payload
            .and_then(|payload| payload.get("surfaces").cloned())
            .and_then(|surfaces| surfaces.as_array().cloned())
            .expect("activation registry list should include surfaces");
        assert!(surfaces
            .iter()
            .any(|surface| surface.get("surfaceId") == Some(&serde_json::json!(surface_id))));

        let unregister = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-activation-registry-unregister",
                    host_protocol::ACTIVATION_REGISTRY_UNREGISTER_SURFACE_METHOD,
                    serde_json::json!({ "surfaceId": surface_id }),
                ),
                1710000000110,
            )
            .expect("activation registry unregister request should return response");

        assert_eq!(
            unregister,
            HostProtocolEnvelope::Response {
                id: "request-activation-registry-unregister".to_string(),
                timestamp: 1710000000110,
                trace_id: "trace-request-activation-registry-unregister".to_string(),
                payload: None,
                error: None,
            }
        );
    }

    #[test]
    fn activation_registry_rejects_malformed_before_unsupported() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-activation-registry-invalid",
                    host_protocol::ACTIVATION_REGISTRY_REGISTER_SURFACE_METHOD,
                    serde_json::json!({
                        "surfaceId": "palette\u{0}",
                        "source": "global-shortcut",
                        "commandId": "activation.open",
                        "actor": { "kind": "workspace", "id": "workspace-1" }
                    }),
                ),
                1710000000109,
            )
            .expect("activation registry invalid request should return response");

        let HostProtocolEnvelope::Response { error, .. } = response else {
            panic!("activation registry invalid request should return response");
        };
        assert!(matches!(
            error,
            Some(HostProtocolError::InvalidArgument { .. })
        ));
    }

    #[test]
    fn resident_lifecycle_dispatches_through_router() {
        let _guard = resident_lifecycle::state_test_guard();
        resident_lifecycle::reset_state_for_test();
        let router = test_router();
        let supported = router
            .dispatch_at(
                request(
                    "request-resident-supported",
                    host_protocol::RESIDENT_LIFECYCLE_IS_SUPPORTED_METHOD,
                ),
                1710000000110,
            )
            .expect("resident lifecycle support should return response");
        assert_eq!(
            supported,
            HostProtocolEnvelope::Response {
                id: "request-resident-supported".to_string(),
                timestamp: 1710000000110,
                trace_id: "trace-request-resident-supported".to_string(),
                payload: Some(serde_json::json!({
                    "supported": true
                })),
                error: None,
            }
        );

        let cases = [
            (
                "request-resident-enable",
                host_protocol::RESIDENT_LIFECYCLE_ENABLE_METHOD,
                Some(serde_json::json!({
                    "policy": {
                        "process": "keep-running",
                        "windows": "close-to-background",
                        "background": "tray",
                        "launchAtLogin": false
                    },
                    "traceId": "trace-1"
                })),
            ),
            (
                "request-resident-disable",
                host_protocol::RESIDENT_LIFECYCLE_DISABLE_METHOD,
                Some(serde_json::json!({ "traceId": "trace-2" })),
            ),
            (
                "request-resident-state",
                host_protocol::RESIDENT_LIFECYCLE_GET_STATE_METHOD,
                None,
            ),
        ];

        for (id, method, payload) in cases {
            let request = match payload {
                Some(payload) => request_with_payload(id, method, payload),
                None => request(id, method),
            };
            let response = router
                .dispatch_at(request, 1710000000111)
                .expect("resident lifecycle request should return response");

            assert!(matches!(
                response,
                HostProtocolEnvelope::Response {
                    error: None,
                    payload: Some(_),
                    ..
                } | HostProtocolEnvelope::Response {
                    error: None,
                    payload: None,
                    ..
                }
            ));
        }
    }

    #[test]
    fn resident_lifecycle_rejects_malformed_before_unsupported() {
        let _guard = resident_lifecycle::state_test_guard();
        resident_lifecycle::reset_state_for_test();
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-resident-invalid",
                    host_protocol::RESIDENT_LIFECYCLE_ENABLE_METHOD,
                    serde_json::json!({
                        "policy": {
                            "process": "keep-running",
                            "windows": "close-to-background",
                            "background": "tray"
                        },
                        "traceId": "trace\u{0}"
                    }),
                ),
                1710000000112,
            )
            .expect("resident lifecycle invalid request should return response");

        let HostProtocolEnvelope::Response { error, .. } = response else {
            panic!("resident lifecycle invalid request should return response");
        };
        assert!(matches!(
            error,
            Some(HostProtocolError::InvalidArgument { .. })
        ));
    }

    #[test]
    fn distribution_parity_dispatches_through_router() {
        let capability = serde_json::json!({
            "kind": "filesystem.read",
            "roots": ["/tmp/extensions"]
        });
        let evidence_root = temp_dir("distribution-parity");
        let evidence = |kind: &str| {
            let path = write_evidence_file(&evidence_root, kind, &capability);
            serde_json::json!({
                "kind": kind,
                "id": kind,
                "path": path,
                "capabilities": [capability.clone()]
            })
        };
        let frames = test_router().dispatch_frames_at(
            request_with_payload(
                "request-distribution-verify",
                host_protocol::DISTRIBUTION_PARITY_VERIFY_METHOD,
                serde_json::json!({
                    "packageId": "extension-1",
                    "version": "1.0.0",
                    "capabilities": [capability],
                    "evidence": [
                        evidence("package-artifact"),
                        evidence("plugin-registration"),
                        evidence("template"),
                        evidence("docs")
                    ],
                    "traceId": "trace-distribution"
                }),
            ),
            1710000000113,
        );

        assert_eq!(
            frames,
            vec![
                HostProtocolEnvelope::Event {
                    method: host_protocol::DISTRIBUTION_PARITY_EVENT.to_string(),
                    timestamp: 1710000000113,
                    trace_id: "trace-request-distribution-verify".to_string(),
                    window_id: None,
                    payload: Some(serde_json::json!({
                        "type": "distribution-parity-event",
                        "timestamp": 1710000000113_u64,
                        "phase": "verified",
                        "packageId": "extension-1",
                        "version": "1.0.0"
                    }))
                },
                HostProtocolEnvelope::Response {
                    id: "request-distribution-verify".to_string(),
                    timestamp: 1710000000113,
                    trace_id: "trace-request-distribution-verify".to_string(),
                    payload: Some(serde_json::json!({
                        "packageId": "extension-1",
                        "version": "1.0.0",
                        "capabilityCount": 1,
                        "evidenceCount": 4
                    })),
                    error: None,
                }
            ]
        );
    }

    #[test]
    fn distribution_parity_rejects_bad_evidence_digest() {
        let capability = serde_json::json!({
            "kind": "filesystem.read",
            "roots": ["/tmp/extensions"]
        });
        let evidence_root = temp_dir("distribution-parity-digest");
        let evidence_path = write_evidence_file(&evidence_root, "docs", &capability);
        let frames = test_router().dispatch_frames_at(
            request_with_payload(
                "request-distribution-digest-invalid",
                host_protocol::DISTRIBUTION_PARITY_VERIFY_METHOD,
                serde_json::json!({
                    "packageId": "extension-1",
                    "version": "1.0.0",
                    "capabilities": [capability],
                    "evidence": [
                        {
                            "kind": "package-artifact",
                            "id": "artifact",
                            "path": evidence_path,
                            "sha256": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                            "capabilities": [{ "kind": "filesystem.read", "roots": ["/tmp/extensions"] }]
                        },
                        {
                            "kind": "plugin-registration",
                            "id": "plugin-registration",
                            "path": evidence_path,
                            "capabilities": [{ "kind": "filesystem.read", "roots": ["/tmp/extensions"] }]
                        },
                        {
                            "kind": "template",
                            "id": "template",
                            "path": evidence_path,
                            "capabilities": [{ "kind": "filesystem.read", "roots": ["/tmp/extensions"] }]
                        },
                        {
                            "kind": "docs",
                            "id": "docs",
                            "path": evidence_path,
                            "capabilities": [{ "kind": "filesystem.read", "roots": ["/tmp/extensions"] }]
                        }
                    ]
                }),
            ),
            1710000000115,
        );

        assert_eq!(frames.len(), 2);
        assert!(matches!(
            frames.first(),
            Some(HostProtocolEnvelope::Event { method, .. })
                if method == host_protocol::DISTRIBUTION_PARITY_EVENT
        ));
        let Some(HostProtocolEnvelope::Response { error, .. }) = frames.get(1) else {
            panic!("distribution parity invalid digest should return response");
        };
        assert!(matches!(
            error,
            Some(HostProtocolError::InvalidArgument { .. })
        ));
    }

    #[test]
    fn distribution_parity_rejects_mismatched_evidence() {
        let capability =
            serde_json::json!({ "kind": "filesystem.read", "roots": ["/tmp/extensions"] });
        let evidence_root = temp_dir("distribution-parity-invalid");
        let evidence_path = write_evidence_file(&evidence_root, "artifact", &capability);
        let frames = test_router().dispatch_frames_at(
            request_with_payload(
                "request-distribution-invalid",
                host_protocol::DISTRIBUTION_PARITY_VERIFY_METHOD,
                serde_json::json!({
                    "packageId": "extension-1",
                    "version": "1.0.0",
                    "capabilities": [capability],
                    "evidence": [
                        {
                            "kind": "package-artifact",
                            "id": "artifact",
                            "path": evidence_path,
                            "capabilities": [{ "kind": "filesystem.write", "roots": ["/tmp/extensions"] }]
                        }
                    ]
                }),
            ),
            1710000000114,
        );

        let Some(HostProtocolEnvelope::Response { error, .. }) = frames.get(1) else {
            panic!("distribution parity invalid request should return response");
        };
        assert!(matches!(
            error,
            Some(HostProtocolError::InvalidArgument { .. })
        ));
    }

    #[test]
    fn distribution_parity_rejects_mismatched_evidence_file_capabilities() {
        let capability =
            serde_json::json!({ "kind": "filesystem.read", "roots": ["/tmp/extensions"] });
        let file_capability =
            serde_json::json!({ "kind": "filesystem.write", "roots": ["/tmp/extensions"] });
        let evidence_root = temp_dir("distribution-parity-file-invalid");
        let evidence_path = write_evidence_file(&evidence_root, "artifact", &file_capability);
        let evidence = |kind: &str| {
            let path = if kind == "package-artifact" {
                evidence_path.clone()
            } else {
                write_evidence_file(&evidence_root, kind, &capability)
            };
            serde_json::json!({
                "kind": kind,
                "id": kind,
                "path": path,
                "capabilities": [capability.clone()]
            })
        };
        let frames = test_router().dispatch_frames_at(
            request_with_payload(
                "request-distribution-file-invalid",
                host_protocol::DISTRIBUTION_PARITY_VERIFY_METHOD,
                serde_json::json!({
                    "packageId": "extension-1",
                    "version": "1.0.0",
                    "capabilities": [capability],
                    "evidence": [
                        evidence("package-artifact"),
                        evidence("plugin-registration"),
                        evidence("template"),
                        evidence("docs")
                    ]
                }),
            ),
            1710000000116,
        );

        let Some(HostProtocolEnvelope::Response { error, .. }) = frames.get(1) else {
            panic!("distribution parity file mismatch should return response");
        };
        assert!(matches!(
            error,
            Some(HostProtocolError::InvalidArgument { .. })
        ));
    }

    #[test]
    fn job_routes_lifecycle_and_persists_state() {
        let _guard = super::JOB_ENV_LOCK
            .lock()
            .expect("job env lock should not be poisoned");
        let dir = temp_dir("job-route");
        let store_path = dir.join("jobs.json");
        let previous_store = std::env::var_os("EFFECT_DESKTOP_JOB_STORE");
        std::env::set_var("EFFECT_DESKTOP_JOB_STORE", &store_path);

        let router = test_router();
        let start_frames = router.dispatch_frames_at(
            request_with_payload(
                "request-job-start",
                host_protocol::JOB_START_METHOD,
                serde_json::json!({
                    "jobId": "job-1",
                    "name": "Index workspace",
                    "traceId": "trace-job-start"
                }),
            ),
            1710000000117,
        );
        let progress_frames = router.dispatch_frames_at(
            request_with_payload(
                "request-job-progress",
                host_protocol::JOB_REPORT_PROGRESS_METHOD,
                serde_json::json!({
                    "jobId": "job-1",
                    "completed": 3,
                    "total": 10,
                    "message": "indexed 3 files"
                }),
            ),
            1710000000118,
        );
        let retry_frames = router.dispatch_frames_at(
            request_with_payload(
                "request-job-retry",
                host_protocol::JOB_RETRY_METHOD,
                serde_json::json!({
                    "jobId": "job-1",
                    "reason": "retry requested"
                }),
            ),
            1710000000119,
        );
        let fail_frames = router.dispatch_frames_at(
            request_with_payload(
                "request-job-fail",
                host_protocol::JOB_FAIL_METHOD,
                serde_json::json!({
                    "jobId": "job-1",
                    "reason": "terminal failure"
                }),
            ),
            1710000000120,
        );
        let get_response = router
            .dispatch_at(
                request_with_payload(
                    "request-job-get",
                    host_protocol::JOB_GET_METHOD,
                    serde_json::json!({ "jobId": "job-1" }),
                ),
                1710000000121,
            )
            .expect("job get should return response");

        match previous_store {
            Some(path) => std::env::set_var("EFFECT_DESKTOP_JOB_STORE", path),
            None => std::env::remove_var("EFFECT_DESKTOP_JOB_STORE"),
        }

        assert!(matches!(
            start_frames.first(),
            Some(HostProtocolEnvelope::Event { method, .. }) if method == host_protocol::JOB_EVENT
        ));
        assert!(matches!(
            progress_frames.first(),
            Some(HostProtocolEnvelope::Event { method, .. }) if method == host_protocol::JOB_EVENT
        ));
        assert!(matches!(
            retry_frames.first(),
            Some(HostProtocolEnvelope::Event { method, payload, .. })
                if method == host_protocol::JOB_EVENT
                    && payload.as_ref().is_some_and(|value| value["phase"] == "retried")
        ));
        assert!(matches!(
            fail_frames.first(),
            Some(HostProtocolEnvelope::Event { method, payload, .. })
                if method == host_protocol::JOB_EVENT
                    && payload.as_ref().is_some_and(|value| value["phase"] == "failed")
        ));
        let HostProtocolEnvelope::Response { payload, error, .. } = get_response else {
            panic!("job get should return response");
        };
        assert_eq!(error, None);
        let payload = payload.expect("job get should include payload");
        assert_eq!(payload["handle"]["id"], "job-1");
        assert_eq!(payload["handle"]["generation"], 3);
        assert_eq!(payload["state"], "failed");
        assert_eq!(payload["progress"]["completed"], 3.0);
        assert_eq!(payload["reason"], "terminal failure");
    }

    #[test]
    fn job_rejects_invalid_progress() {
        let _guard = super::JOB_ENV_LOCK
            .lock()
            .expect("job env lock should not be poisoned");
        let dir = temp_dir("job-invalid");
        let store_path = dir.join("jobs.json");
        let previous_store = std::env::var_os("EFFECT_DESKTOP_JOB_STORE");
        std::env::set_var("EFFECT_DESKTOP_JOB_STORE", &store_path);

        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-job-progress-invalid",
                    host_protocol::JOB_REPORT_PROGRESS_METHOD,
                    serde_json::json!({
                        "jobId": "job-1",
                        "completed": 11,
                        "total": 10
                    }),
                ),
                1710000000120,
            )
            .expect("job invalid progress should return response");

        match previous_store {
            Some(path) => std::env::set_var("EFFECT_DESKTOP_JOB_STORE", path),
            None => std::env::remove_var("EFFECT_DESKTOP_JOB_STORE"),
        }

        let HostProtocolEnvelope::Response { error, .. } = response else {
            panic!("job invalid progress should return response");
        };
        assert!(matches!(
            error,
            Some(HostProtocolError::InvalidArgument { .. })
        ));
    }

    #[test]
    fn job_rejects_duplicate_ids_and_terminal_mutation() {
        let _guard = super::JOB_ENV_LOCK
            .lock()
            .expect("job env lock should not be poisoned");
        let dir = temp_dir("job-terminal");
        let store_path = dir.join("jobs.json");
        let previous_store = std::env::var_os("EFFECT_DESKTOP_JOB_STORE");
        std::env::set_var("EFFECT_DESKTOP_JOB_STORE", &store_path);

        let router = test_router();
        let _ = router.dispatch_frames_at(
            request_with_payload(
                "request-job-start-terminal",
                host_protocol::JOB_START_METHOD,
                serde_json::json!({
                    "jobId": "job-terminal",
                    "name": "Terminal job"
                }),
            ),
            1710000000120,
        );
        let duplicate = router
            .dispatch_at(
                request_with_payload(
                    "request-job-start-duplicate",
                    host_protocol::JOB_START_METHOD,
                    serde_json::json!({
                        "jobId": "job-terminal",
                        "name": "Duplicate job"
                    }),
                ),
                1710000000121,
            )
            .expect("duplicate start should return response");
        let _ = router.dispatch_frames_at(
            request_with_payload(
                "request-job-succeed-terminal",
                host_protocol::JOB_SUCCEED_METHOD,
                serde_json::json!({ "jobId": "job-terminal" }),
            ),
            1710000000122,
        );
        let mutate_terminal = router
            .dispatch_at(
                request_with_payload(
                    "request-job-interrupt-terminal",
                    host_protocol::JOB_INTERRUPT_METHOD,
                    serde_json::json!({ "jobId": "job-terminal" }),
                ),
                1710000000123,
            )
            .expect("terminal mutation should return response");
        let progress_terminal = router
            .dispatch_at(
                request_with_payload(
                    "request-job-progress-terminal",
                    host_protocol::JOB_REPORT_PROGRESS_METHOD,
                    serde_json::json!({
                        "jobId": "job-terminal",
                        "completed": 1
                    }),
                ),
                1710000000124,
            )
            .expect("terminal progress should return response");

        match previous_store {
            Some(path) => std::env::set_var("EFFECT_DESKTOP_JOB_STORE", path),
            None => std::env::remove_var("EFFECT_DESKTOP_JOB_STORE"),
        }

        let HostProtocolEnvelope::Response {
            error: duplicate_error,
            ..
        } = duplicate
        else {
            panic!("duplicate start should return response");
        };
        let HostProtocolEnvelope::Response {
            error: mutate_error,
            ..
        } = mutate_terminal
        else {
            panic!("terminal mutation should return response");
        };
        let HostProtocolEnvelope::Response {
            error: progress_error,
            ..
        } = progress_terminal
        else {
            panic!("terminal progress should return response");
        };
        assert!(matches!(
            duplicate_error,
            Some(HostProtocolError::AlreadyExists { .. })
        ));
        assert!(matches!(
            mutate_error,
            Some(HostProtocolError::InvalidState { .. })
        ));
        assert!(matches!(
            progress_error,
            Some(HostProtocolError::InvalidState { .. })
        ));
    }

    #[test]
    fn app_quit_routes_to_window_handler() {
        let window = Arc::new(FakeWindowHandler::new(
            Ok(WindowCreateResponse::new("window-test")),
            Ok(()),
        ));
        let response = HostMethodRouter::new(window.clone())
            .dispatch_at(
                request_with_payload(
                    "request-app-quit",
                    host_protocol::APP_QUIT_METHOD,
                    serde_json::json!({ "exitCode": 0 }),
                ),
                1710000000125,
            )
            .expect("app quit should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-app-quit".to_string(),
                timestamp: 1710000000125,
                trace_id: "trace-request-app-quit".to_string(),
                payload: None,
                error: None,
            }
        );
        assert_eq!(window.quit(), vec![0]);
    }

    #[test]
    fn app_exit_routes_to_window_handler() {
        let window = Arc::new(FakeWindowHandler::new(
            Ok(WindowCreateResponse::new("window-test")),
            Ok(()),
        ));
        let response = HostMethodRouter::new(window.clone())
            .dispatch_at(
                request_with_payload(
                    "request-app-exit",
                    host_protocol::APP_EXIT_METHOD,
                    serde_json::json!({ "exitCode": 7 }),
                ),
                1710000000125,
            )
            .expect("app exit should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-app-exit".to_string(),
                timestamp: 1710000000125,
                trace_id: "trace-request-app-exit".to_string(),
                payload: None,
                error: None,
            }
        );
        assert_eq!(window.quit(), vec![7]);
    }

    #[test]
    fn app_restart_routes_to_window_handler() {
        let window = Arc::new(FakeWindowHandler::new(
            Ok(WindowCreateResponse::new("window-test")),
            Ok(()),
        ));
        let response = HostMethodRouter::new(window.clone())
            .dispatch_at(
                request_with_payload(
                    "request-app-restart",
                    host_protocol::APP_RESTART_METHOD,
                    serde_json::json!({ "args": ["--restarted", "safe"] }),
                ),
                1710000000125,
            )
            .expect("app restart should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-app-restart".to_string(),
                timestamp: 1710000000125,
                trace_id: "trace-request-app-restart".to_string(),
                payload: None,
                error: None,
            }
        );
        assert_eq!(
            window.restarts(),
            vec![vec!["--restarted".to_string(), "safe".to_string()]]
        );
    }

    #[test]
    fn app_relaunch_routes_to_window_handler() {
        let window = Arc::new(FakeWindowHandler::new(
            Ok(WindowCreateResponse::new("window-test")),
            Ok(()),
        ));
        let response = HostMethodRouter::new(window.clone())
            .dispatch_at(
                request_with_payload(
                    "request-app-relaunch",
                    host_protocol::APP_RELAUNCH_METHOD,
                    serde_json::json!({ "args": ["--relaunched", "safe"] }),
                ),
                1710000000125,
            )
            .expect("app relaunch should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-app-relaunch".to_string(),
                timestamp: 1710000000125,
                trace_id: "trace-request-app-relaunch".to_string(),
                payload: None,
                error: None,
            }
        );
        assert_eq!(
            window.restarts(),
            vec![vec!["--relaunched".to_string(), "safe".to_string()]]
        );
    }

    #[test]
    fn app_focus_routes_to_current_window() {
        let window = Arc::new(FakeWindowHandler::new(
            Ok(WindowCreateResponse::new("window-test")),
            Ok(()),
        ));
        let response = HostMethodRouter::new(window.clone())
            .dispatch_at(
                request("request-app-focus", host_protocol::APP_FOCUS_METHOD),
                1710000000125,
            )
            .expect("app focus should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-app-focus".to_string(),
                timestamp: 1710000000125,
                trace_id: "trace-request-app-focus".to_string(),
                payload: None,
                error: None,
            }
        );
        assert_eq!(window.focused(), vec!["window-current".to_string()]);
    }

    #[test]
    fn app_activate_routes_to_current_window() {
        let window = Arc::new(FakeWindowHandler::new(
            Ok(WindowCreateResponse::new("window-test")),
            Ok(()),
        ));
        let response = HostMethodRouter::new(window.clone())
            .dispatch_at(
                request("request-app-activate", host_protocol::APP_ACTIVATE_METHOD),
                1710000000125,
            )
            .expect("app activate should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-app-activate".to_string(),
                timestamp: 1710000000125,
                trace_id: "trace-request-app-activate".to_string(),
                payload: None,
                error: None,
            }
        );
        assert_eq!(window.focused(), vec!["window-current".to_string()]);
    }

    #[test]
    fn app_release_single_instance_lock_routes_to_host_adapter() {
        let response = test_router()
            .dispatch_at(
                request(
                    "request-app-release-single-instance",
                    host_protocol::APP_RELEASE_SINGLE_INSTANCE_LOCK_METHOD,
                ),
                1710000000125,
            )
            .expect("app release single-instance lock should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-app-release-single-instance".to_string(),
                timestamp: 1710000000125,
                trace_id: "trace-request-app-release-single-instance".to_string(),
                payload: None,
                error: None,
            }
        );
    }

    #[test]
    fn app_void_routes_reject_present_payloads() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-app-focus-object",
                    host_protocol::APP_FOCUS_METHOD,
                    serde_json::json!({}),
                ),
                1710000000125,
            )
            .expect("app focus should return response");

        let HostProtocolEnvelope::Response {
            error: Some(error), ..
        } = response
        else {
            panic!("app focus should reject present payload");
        };
        assert_eq!(error.tag(), "InvalidArgument");

        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-app-release-single-instance-object",
                    host_protocol::APP_RELEASE_SINGLE_INSTANCE_LOCK_METHOD,
                    serde_json::json!({}),
                ),
                1710000000125,
            )
            .expect("app release single-instance lock should return response");

        let HostProtocolEnvelope::Response {
            error: Some(error), ..
        } = response
        else {
            panic!("app release single-instance lock should reject present payload");
        };
        assert_eq!(error.tag(), "InvalidArgument");
    }

    #[test]
    fn app_lifecycle_routes_reject_malformed_payloads() {
        let quit_response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-app-quit-invalid",
                    host_protocol::APP_QUIT_METHOD,
                    serde_json::json!({ "exitCode": 256 }),
                ),
                1710000000125,
            )
            .expect("app quit should return response");

        let HostProtocolEnvelope::Response {
            error: Some(error), ..
        } = quit_response
        else {
            panic!("app quit should reject malformed exit code");
        };
        assert_eq!(error.tag(), "InvalidArgument");

        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-app-restart-invalid",
                    host_protocol::APP_RESTART_METHOD,
                    serde_json::json!({ "args": ["bad\0arg"] }),
                ),
                1710000000125,
            )
            .expect("app restart should return response");

        let HostProtocolEnvelope::Response {
            error: Some(error), ..
        } = response
        else {
            panic!("app restart should reject malformed args");
        };
        assert_eq!(error.tag(), "InvalidArgument");
    }

    #[test]
    fn app_metadata_routes_to_host_owned_payloads() {
        let response = test_router()
            .dispatch_at(
                request(
                    "request-app-metadata-info",
                    host_protocol::APP_METADATA_GET_INFO_METHOD,
                ),
                1710000000126,
            )
            .expect("app metadata get info should return response");

        let HostProtocolEnvelope::Response {
            payload: Some(payload),
            error: None,
            ..
        } = response
        else {
            panic!("app metadata get info should return payload");
        };
        assert!(payload["id"]
            .as_str()
            .is_some_and(|value| !value.is_empty()));
        assert!(payload["name"]
            .as_str()
            .is_some_and(|value| !value.is_empty()));
        assert!(payload["version"]
            .as_str()
            .is_some_and(|value| !value.is_empty()));
    }

    #[test]
    fn app_metadata_routes_reject_present_payloads() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-app-metadata-paths-invalid",
                    host_protocol::APP_METADATA_GET_PATHS_METHOD,
                    serde_json::json!({}),
                ),
                1710000000126,
            )
            .expect("app metadata get paths should return response");

        let HostProtocolEnvelope::Response {
            error: Some(error), ..
        } = response
        else {
            panic!("app metadata get paths should reject present payload");
        };
        assert_eq!(error.tag(), "InvalidArgument");
    }

    #[test]
    fn association_routes_to_typed_unsupported() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-association-protocol-status",
                    host_protocol::ASSOCIATION_IS_DEFAULT_PROTOCOL_CLIENT_METHOD,
                    serde_json::json!({ "scheme": "example" }),
                ),
                1710000000126,
            )
            .expect("association status should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-association-protocol-status".to_string(),
                timestamp: 1710000000126,
                trace_id: "trace-request-association-protocol-status".to_string(),
                payload: None,
                error: Some(HostProtocolError::unsupported(
                    host_protocol::ASSOCIATION_UNSUPPORTED_REASON,
                    host_protocol::ASSOCIATION_IS_DEFAULT_PROTOCOL_CLIENT_METHOD,
                )),
            }
        );
    }

    #[test]
    fn association_routes_reject_malformed_payloads() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-association-invalid",
                    host_protocol::ASSOCIATION_GET_FILE_ASSOCIATIONS_METHOD,
                    serde_json::json!({ "extensions": ["../txt"] }),
                ),
                1710000000126,
            )
            .expect("association invalid request should return response");

        let HostProtocolEnvelope::Response {
            error: Some(error), ..
        } = response
        else {
            panic!("association route should reject malformed extensions");
        };
        assert_eq!(error.tag(), "InvalidArgument");
    }

    #[test]
    fn recent_documents_routes_to_typed_unsupported() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-recent-document-add",
                    host_protocol::RECENT_DOCUMENTS_ADD_METHOD,
                    serde_json::json!({ "path": { "path": "/tmp/report.txt" } }),
                ),
                1710000000127,
            )
            .expect("recent document add should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-recent-document-add".to_string(),
                timestamp: 1710000000127,
                trace_id: "trace-request-recent-document-add".to_string(),
                payload: None,
                error: Some(HostProtocolError::unsupported(
                    host_protocol::RECENT_DOCUMENTS_UNSUPPORTED_REASON,
                    host_protocol::RECENT_DOCUMENTS_ADD_METHOD,
                )),
            }
        );
    }

    #[test]
    fn recent_documents_routes_reject_malformed_payloads() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-recent-document-invalid",
                    host_protocol::RECENT_DOCUMENTS_ADD_METHOD,
                    serde_json::json!({ "path": { "path": "relative.txt" } }),
                ),
                1710000000127,
            )
            .expect("recent document invalid request should return response");

        let HostProtocolEnvelope::Response {
            error: Some(error), ..
        } = response
        else {
            panic!("recent document route should reject malformed paths");
        };
        assert_eq!(error.tag(), "InvalidArgument");
    }

    #[test]
    fn autostart_routes_return_mechanism_status() {
        let _guard = autostart::AUTOSTART_TEST_ENV_LOCK
            .lock()
            .expect("autostart env lock");
        let root = std::env::temp_dir().join(format!(
            "effect-desktop-autostart-route-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time")
                .as_nanos()
        ));
        let previous_root = std::env::var_os("EFFECT_DESKTOP_AUTOSTART_ROOT");
        let previous_id = std::env::var_os("EFFECT_DESKTOP_AUTOSTART_APP_ID");
        let previous_name = std::env::var_os("EFFECT_DESKTOP_AUTOSTART_APP_NAME");
        let previous_exe = std::env::var_os("EFFECT_DESKTOP_AUTOSTART_EXE");
        std::env::set_var("EFFECT_DESKTOP_AUTOSTART_ROOT", &root);
        std::env::set_var(
            "EFFECT_DESKTOP_AUTOSTART_APP_ID",
            "dev.effect-desktop.route-test",
        );
        std::env::set_var(
            "EFFECT_DESKTOP_AUTOSTART_APP_NAME",
            "Effect Desktop Route Test",
        );
        let test_exe = if cfg!(windows) {
            r"C:\Program Files\Effect Desktop\host.exe"
        } else {
            "/Applications/Effect Desktop.app/Contents/MacOS/host"
        };
        std::env::set_var("EFFECT_DESKTOP_AUTOSTART_EXE", test_exe);

        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-autostart-enable",
                    host_protocol::AUTOSTART_ENABLE_METHOD,
                    serde_json::json!({ "args": ["--hidden"] }),
                ),
                1710000000128,
            )
            .expect("autostart enable should return response");

        restore_env("EFFECT_DESKTOP_AUTOSTART_ROOT", previous_root);
        restore_env("EFFECT_DESKTOP_AUTOSTART_APP_ID", previous_id);
        restore_env("EFFECT_DESKTOP_AUTOSTART_APP_NAME", previous_name);
        restore_env("EFFECT_DESKTOP_AUTOSTART_EXE", previous_exe);
        let _ = std::fs::remove_dir_all(root);

        let HostProtocolEnvelope::Response {
            payload: Some(payload),
            error: None,
            ..
        } = response
        else {
            panic!("autostart route should return status: {response:?}");
        };
        assert_eq!(payload["enabled"], true);
        assert!(payload.get("mechanism").is_some());
    }

    #[test]
    fn autostart_routes_reject_malformed_payloads() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-autostart-invalid",
                    host_protocol::AUTOSTART_ENABLE_METHOD,
                    serde_json::json!({ "args": ["bad\0arg"] }),
                ),
                1710000000128,
            )
            .expect("autostart invalid request should return response");

        let HostProtocolEnvelope::Response {
            error: Some(error), ..
        } = response
        else {
            panic!("autostart route should reject malformed args");
        };
        assert_eq!(error.tag(), "InvalidArgument");
    }

    fn restore_env(key: &str, value: Option<std::ffi::OsString>) {
        match value {
            Some(value) => std::env::set_var(key, value),
            None => std::env::remove_var(key),
        }
    }

    #[test]
    fn non_request_envelopes_do_not_dispatch() {
        let response = test_router().dispatch_at(
            HostProtocolEnvelope::Event {
                method: "runtime.ready".to_string(),
                timestamp: 1710000000103,
                trace_id: "trace-event".to_string(),
                window_id: None,
                payload: None,
            },
            1710000000104,
        );

        assert_eq!(response, None);
    }

    #[test]
    fn window_create_validates_payload_and_returns_window_id() {
        let fake = Arc::new(FakeWindowHandler::new(
            Ok(WindowCreateResponse::new("window-1")),
            Ok(()),
        ));
        let router = HostMethodRouter::new(fake.clone());
        let response = router
            .dispatch_at(
                request_with_payload(
                    "request-window-create",
                    host_protocol::WINDOW_CREATE_METHOD,
                    serde_json::json!({
                        "title": "Test",
                        "width": 320.0,
                        "height": 240.0
                    }),
                ),
                1710000000105,
            )
            .expect("window create should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-window-create".to_string(),
                timestamp: 1710000000105,
                trace_id: "trace-request-window-create".to_string(),
                payload: Some(serde_json::json!({
                    "windowId": "window-1"
                })),
                error: None,
            }
        );
        assert_eq!(
            fake.created(),
            vec![WindowCreateRequest::new("Test".to_string(), 320.0, 240.0)
                .expect("test request should validate")]
        );
    }

    #[test]
    fn window_create_routes_parent_window_id_to_window_handler() {
        let fake = Arc::new(FakeWindowHandler::new(
            Ok(WindowCreateResponse::new("window-child")),
            Ok(()),
        ));
        let router = HostMethodRouter::new(fake.clone());
        let response = router
            .dispatch_at(
                request_with_payload(
                    "request-window-create-child",
                    host_protocol::WINDOW_CREATE_METHOD,
                    serde_json::json!({
                        "title": "Child",
                        "parentWindowId": "window-parent"
                    }),
                ),
                1710000000106,
            )
            .expect("child window create should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-window-create-child".to_string(),
                timestamp: 1710000000106,
                trace_id: "trace-request-window-create-child".to_string(),
                payload: Some(serde_json::json!({
                    "windowId": "window-child"
                })),
                error: None,
            }
        );
        let created = fake.created();
        assert_eq!(created.len(), 1);
        assert_eq!(created[0].parent_window_id(), Some("window-parent"));
    }

    #[test]
    fn window_create_invalid_bounds_returns_invalid_argument() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-window-create-invalid",
                    host_protocol::WINDOW_CREATE_METHOD,
                    serde_json::json!({
                        "width": 0.0,
                        "height": 240.0
                    }),
                ),
                1710000000106,
            )
            .expect("window create should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-window-create-invalid".to_string(),
                timestamp: 1710000000106,
                trace_id: "trace-request-window-create-invalid".to_string(),
                payload: None,
                error: Some(HostProtocolError::invalid_argument(
                    "width",
                    "must be a finite positive number",
                    host_protocol::WINDOW_CREATE_METHOD,
                )),
            }
        );
    }

    #[test]
    fn window_destroy_unknown_id_returns_not_found() {
        let fake = Arc::new(FakeWindowHandler::new(
            Ok(WindowCreateResponse::new("window-unused")),
            Err(HostProtocolError::not_found(
                "Window:missing",
                host_protocol::WINDOW_DESTROY_METHOD,
            )),
        ));
        let router = HostMethodRouter::new(fake);
        let response = router
            .dispatch_at(
                request_with_payload(
                    "request-window-destroy",
                    host_protocol::WINDOW_DESTROY_METHOD,
                    serde_json::json!({
                        "windowId": "missing"
                    }),
                ),
                1710000000107,
            )
            .expect("window destroy should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-window-destroy".to_string(),
                timestamp: 1710000000107,
                trace_id: "trace-request-window-destroy".to_string(),
                payload: None,
                error: Some(HostProtocolError::not_found(
                    "Window:missing",
                    host_protocol::WINDOW_DESTROY_METHOD,
                )),
            }
        );
    }

    #[test]
    fn window_lifecycle_methods_route_to_window_handler() {
        let fake = Arc::new(FakeWindowHandler::new(
            Ok(WindowCreateResponse::new("window-unused")),
            Ok(()),
        ));
        let router = HostMethodRouter::new(fake.clone());

        for (id, method) in [
            ("request-window-show", host_protocol::WINDOW_SHOW_METHOD),
            ("request-window-hide", host_protocol::WINDOW_HIDE_METHOD),
            ("request-window-focus", host_protocol::WINDOW_FOCUS_METHOD),
        ] {
            let response = router
                .dispatch_at(
                    request_with_payload(
                        id,
                        method,
                        serde_json::json!({
                            "windowId": "window-1"
                        }),
                    ),
                    1710000000108,
                )
                .expect("window lifecycle request should return response");

            assert_eq!(
                response,
                HostProtocolEnvelope::Response {
                    id: id.to_string(),
                    timestamp: 1710000000108,
                    trace_id: format!("trace-{id}"),
                    payload: None,
                    error: None,
                }
            );
        }

        assert_eq!(fake.shown(), vec!["window-1".to_string()]);
        assert_eq!(fake.hidden(), vec!["window-1".to_string()]);
        assert_eq!(fake.focused(), vec!["window-1".to_string()]);
    }

    #[test]
    fn window_lifecycle_invalid_payload_returns_invalid_argument() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-window-show-invalid",
                    host_protocol::WINDOW_SHOW_METHOD,
                    serde_json::json!({
                        "windowId": ""
                    }),
                ),
                1710000000109,
            )
            .expect("window show should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-window-show-invalid".to_string(),
                timestamp: 1710000000109,
                trace_id: "trace-request-window-show-invalid".to_string(),
                payload: None,
                error: Some(HostProtocolError::invalid_argument(
                    "payload",
                    "windowId must be non-empty",
                    host_protocol::WINDOW_SHOW_METHOD,
                )),
            }
        );
    }

    #[test]
    fn window_lookup_methods_route_to_window_handler() {
        let fake = Arc::new(FakeWindowHandler::new(
            Ok(WindowCreateResponse::new("window-unused")),
            Ok(()),
        ));
        let router = HostMethodRouter::new(fake.clone());

        let current_response = router
            .dispatch_at(
                request(
                    "request-window-get-current",
                    host_protocol::WINDOW_GET_CURRENT_METHOD,
                ),
                1710000000110,
            )
            .expect("window get current should return response");
        assert_eq!(
            current_response,
            HostProtocolEnvelope::Response {
                id: "request-window-get-current".to_string(),
                timestamp: 1710000000110,
                trace_id: "trace-request-window-get-current".to_string(),
                payload: Some(serde_json::json!({ "windowId": "window-current" })),
                error: None,
            }
        );

        let by_id_response = router
            .dispatch_at(
                request_with_payload(
                    "request-window-get-by-id",
                    host_protocol::WINDOW_GET_BY_ID_METHOD,
                    serde_json::json!({ "windowId": "window-1" }),
                ),
                1710000000111,
            )
            .expect("window get by id should return response");
        assert_eq!(
            by_id_response,
            HostProtocolEnvelope::Response {
                id: "request-window-get-by-id".to_string(),
                timestamp: 1710000000111,
                trace_id: "trace-request-window-get-by-id".to_string(),
                payload: Some(serde_json::json!({ "windowId": "window-1" })),
                error: None,
            }
        );

        let list_response = router
            .dispatch_at(
                request("request-window-list", host_protocol::WINDOW_LIST_METHOD),
                1710000000112,
            )
            .expect("window list should return response");
        assert_eq!(
            list_response,
            HostProtocolEnvelope::Response {
                id: "request-window-list".to_string(),
                timestamp: 1710000000112,
                trace_id: "trace-request-window-list".to_string(),
                payload: Some(serde_json::json!({
                    "windows": [{ "windowId": "window-1" }, { "windowId": "window-2" }]
                })),
                error: None,
            }
        );

        let parent_response = router
            .dispatch_at(
                request_with_payload(
                    "request-window-get-parent",
                    host_protocol::WINDOW_GET_PARENT_METHOD,
                    serde_json::json!({ "windowId": "window-1" }),
                ),
                1710000000113,
            )
            .expect("window get parent should return response");
        assert_eq!(
            parent_response,
            HostProtocolEnvelope::Response {
                id: "request-window-get-parent".to_string(),
                timestamp: 1710000000113,
                trace_id: "trace-request-window-get-parent".to_string(),
                payload: Some(serde_json::json!({ "parentWindowId": "window-parent" })),
                error: None,
            }
        );

        let children_response = router
            .dispatch_at(
                request_with_payload(
                    "request-window-get-children",
                    host_protocol::WINDOW_GET_CHILDREN_METHOD,
                    serde_json::json!({ "windowId": "window-parent" }),
                ),
                1710000000114,
            )
            .expect("window get children should return response");
        assert_eq!(
            children_response,
            HostProtocolEnvelope::Response {
                id: "request-window-get-children".to_string(),
                timestamp: 1710000000114,
                trace_id: "trace-request-window-get-children".to_string(),
                payload: Some(serde_json::json!({
                    "windows": [
                        { "windowId": "window-child-1" },
                        { "windowId": "window-child-2" }
                    ]
                })),
                error: None,
            }
        );

        assert_eq!(fake.lookup_ids(), vec!["window-1".to_string()]);
    }

    #[test]
    fn window_lookup_methods_validate_payloads() {
        let invalid_get_current = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-window-get-current-invalid",
                    host_protocol::WINDOW_GET_CURRENT_METHOD,
                    serde_json::json!({ "windowId": "window-1" }),
                ),
                1710000000113,
            )
            .expect("invalid window get current should return response");
        assert_eq!(
            invalid_get_current,
            HostProtocolEnvelope::Response {
                id: "request-window-get-current-invalid".to_string(),
                timestamp: 1710000000113,
                trace_id: "trace-request-window-get-current-invalid".to_string(),
                payload: None,
                error: Some(HostProtocolError::invalid_argument(
                    "payload",
                    "Window.getCurrent does not accept payload",
                    host_protocol::WINDOW_GET_CURRENT_METHOD,
                )),
            }
        );

        let invalid_get_by_id = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-window-get-by-id-invalid",
                    host_protocol::WINDOW_GET_BY_ID_METHOD,
                    serde_json::json!({ "windowId": "" }),
                ),
                1710000000114,
            )
            .expect("invalid window get by id should return response");
        assert_eq!(
            invalid_get_by_id,
            HostProtocolEnvelope::Response {
                id: "request-window-get-by-id-invalid".to_string(),
                timestamp: 1710000000114,
                trace_id: "trace-request-window-get-by-id-invalid".to_string(),
                payload: None,
                error: Some(HostProtocolError::invalid_argument(
                    "payload",
                    "windowId must be non-empty",
                    host_protocol::WINDOW_GET_BY_ID_METHOD,
                )),
            }
        );

        let invalid_get_parent = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-window-get-parent-invalid",
                    host_protocol::WINDOW_GET_PARENT_METHOD,
                    serde_json::json!({ "windowId": "" }),
                ),
                1710000000115,
            )
            .expect("invalid window get parent should return response");
        assert_eq!(
            invalid_get_parent,
            HostProtocolEnvelope::Response {
                id: "request-window-get-parent-invalid".to_string(),
                timestamp: 1710000000115,
                trace_id: "trace-request-window-get-parent-invalid".to_string(),
                payload: None,
                error: Some(HostProtocolError::invalid_argument(
                    "payload",
                    "windowId must be non-empty",
                    host_protocol::WINDOW_GET_PARENT_METHOD,
                )),
            }
        );

        let invalid_get_children = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-window-get-children-invalid",
                    host_protocol::WINDOW_GET_CHILDREN_METHOD,
                    serde_json::json!({ "windowId": "" }),
                ),
                1710000000116,
            )
            .expect("invalid window get children should return response");
        assert_eq!(
            invalid_get_children,
            HostProtocolEnvelope::Response {
                id: "request-window-get-children-invalid".to_string(),
                timestamp: 1710000000116,
                trace_id: "trace-request-window-get-children-invalid".to_string(),
                payload: None,
                error: Some(HostProtocolError::invalid_argument(
                    "payload",
                    "windowId must be non-empty",
                    host_protocol::WINDOW_GET_CHILDREN_METHOD,
                )),
            }
        );
    }

    #[test]
    fn window_bounds_methods_route_to_window_handler() {
        let fake = Arc::new(FakeWindowHandler::new(
            Ok(WindowCreateResponse::new("window-unused")),
            Ok(()),
        ));
        let router = HostMethodRouter::new(fake.clone());

        let get_response = router
            .dispatch_at(
                request_with_payload(
                    "request-window-get-bounds",
                    host_protocol::WINDOW_GET_BOUNDS_METHOD,
                    serde_json::json!({
                        "windowId": "window-1"
                    }),
                ),
                1710000000110,
            )
            .expect("window get bounds should return response");
        assert_eq!(
            get_response,
            HostProtocolEnvelope::Response {
                id: "request-window-get-bounds".to_string(),
                timestamp: 1710000000110,
                trace_id: "trace-request-window-get-bounds".to_string(),
                payload: Some(serde_json::json!({
                    "x": 10.0,
                    "y": 20.0,
                    "width": 640.0,
                    "height": 480.0
                })),
                error: None,
            }
        );

        for (id, method, payload) in [
            (
                "request-window-set-bounds",
                host_protocol::WINDOW_SET_BOUNDS_METHOD,
                serde_json::json!({
                    "windowId": "window-1",
                    "bounds": {
                        "x": 30.0,
                        "y": 40.0,
                        "width": 800.0,
                        "height": 600.0
                    }
                }),
            ),
            (
                "request-window-set-bounds-on-display",
                host_protocol::WINDOW_SET_BOUNDS_ON_DISPLAY_METHOD,
                serde_json::json!({
                    "windowId": "window-1",
                    "displayId": "display-1",
                    "bounds": {
                        "x": 15.0,
                        "y": 25.0,
                        "width": 700.0,
                        "height": 500.0
                    }
                }),
            ),
            (
                "request-window-center",
                host_protocol::WINDOW_CENTER_METHOD,
                serde_json::json!({
                    "windowId": "window-1"
                }),
            ),
            (
                "request-window-center-on-display",
                host_protocol::WINDOW_CENTER_ON_DISPLAY_METHOD,
                serde_json::json!({
                    "windowId": "window-1",
                    "displayId": "display-1"
                }),
            ),
        ] {
            let response = router
                .dispatch_at(request_with_payload(id, method, payload), 1710000000111)
                .expect("window bounds request should return response");

            assert_eq!(
                response,
                HostProtocolEnvelope::Response {
                    id: id.to_string(),
                    timestamp: 1710000000111,
                    trace_id: format!("trace-{id}"),
                    payload: Some(match method {
                        host_protocol::WINDOW_CENTER_METHOD => serde_json::json!({
                            "x": 30.0,
                            "y": 40.0,
                            "width": 640.0,
                            "height": 480.0
                        }),
                        host_protocol::WINDOW_CENTER_ON_DISPLAY_METHOD => serde_json::json!({
                            "x": 35.0,
                            "y": 45.0,
                            "width": 640.0,
                            "height": 480.0
                        }),
                        _ => serde_json::json!({
                            "x": 15.0,
                            "y": 25.0,
                            "width": 700.0,
                            "height": 500.0
                        }),
                    }),
                    error: None,
                }
            );
        }
    }

    #[test]
    fn window_chrome_methods_route_to_window_handler() {
        let fake = Arc::new(FakeWindowHandler::new(
            Ok(WindowCreateResponse::new("window-unused")),
            Ok(()),
        ));
        let router = HostMethodRouter::new(fake.clone());

        for (id, method, payload) in [
            (
                "request-window-set-title",
                host_protocol::WINDOW_SET_TITLE_METHOD,
                serde_json::json!({ "windowId": "window-1", "title": "Main" }),
            ),
            (
                "request-window-set-resizable",
                host_protocol::WINDOW_SET_RESIZABLE_METHOD,
                serde_json::json!({ "windowId": "window-1", "resizable": false }),
            ),
            (
                "request-window-set-decorations",
                host_protocol::WINDOW_SET_DECORATIONS_METHOD,
                serde_json::json!({ "windowId": "window-1", "decorations": true }),
            ),
            (
                "request-window-set-traffic-lights",
                host_protocol::WINDOW_SET_TRAFFIC_LIGHTS_METHOD,
                serde_json::json!({ "windowId": "window-1", "trafficLights": { "x": 12, "y": 13 } }),
            ),
            (
                "request-window-set-vibrancy",
                host_protocol::WINDOW_SET_VIBRANCY_METHOD,
                serde_json::json!({ "windowId": "window-1", "material": "windowBackground" }),
            ),
            (
                "request-window-clear-vibrancy",
                host_protocol::WINDOW_CLEAR_VIBRANCY_METHOD,
                serde_json::json!({ "windowId": "window-1" }),
            ),
            (
                "request-window-set-shadow",
                host_protocol::WINDOW_SET_SHADOW_METHOD,
                serde_json::json!({ "windowId": "window-1", "hasShadow": false }),
            ),
            (
                "request-window-set-title-bar-style",
                host_protocol::WINDOW_SET_TITLE_BAR_STYLE_METHOD,
                serde_json::json!({ "windowId": "window-1", "titleBarStyle": "hiddenInset" }),
            ),
            (
                "request-window-set-title-bar-transparent",
                host_protocol::WINDOW_SET_TITLE_BAR_TRANSPARENT_METHOD,
                serde_json::json!({ "windowId": "window-1", "titleBarTransparent": true }),
            ),
            (
                "request-window-set-transparent",
                host_protocol::WINDOW_SET_TRANSPARENT_METHOD,
                serde_json::json!({ "windowId": "window-1", "transparent": true }),
            ),
        ] {
            let response = router
                .dispatch_at(request_with_payload(id, method, payload), 1710000000112)
                .expect("window chrome request should return response");

            assert_eq!(
                response,
                HostProtocolEnvelope::Response {
                    id: id.to_string(),
                    timestamp: 1710000000112,
                    trace_id: format!("trace-{id}"),
                    payload: None,
                    error: None,
                }
            );
        }

        assert_eq!(
            fake.titles(),
            vec![("window-1".to_string(), "Main".to_string())]
        );
        assert_eq!(fake.resizable(), vec![("window-1".to_string(), false)]);
        assert_eq!(fake.decorations(), vec![("window-1".to_string(), true)]);
        assert_eq!(fake.shadows(), vec![("window-1".to_string(), false)]);
    }

    #[test]
    fn window_attention_methods_route_to_window_handler() {
        let fake = Arc::new(FakeWindowHandler::new(
            Ok(WindowCreateResponse::new("window-unused")),
            Ok(()),
        ));
        let router = HostMethodRouter::new(fake.clone());

        for (id, method, payload) in [
            (
                "request-window-set-always-on-top",
                host_protocol::WINDOW_SET_ALWAYS_ON_TOP_METHOD,
                serde_json::json!({ "windowId": "window-1", "alwaysOnTop": true }),
            ),
            (
                "request-window-set-skip-taskbar",
                host_protocol::WINDOW_SET_SKIP_TASKBAR_METHOD,
                serde_json::json!({ "windowId": "window-1", "skipTaskbar": true }),
            ),
            (
                "request-window-set-progress",
                host_protocol::WINDOW_SET_PROGRESS_METHOD,
                serde_json::json!({
                    "windowId": "window-1",
                    "state": "normal",
                    "progress": 42,
                    "desktopFilename": "app.desktop"
                }),
            ),
            (
                "request-window-request-attention",
                host_protocol::WINDOW_REQUEST_ATTENTION_METHOD,
                serde_json::json!({ "windowId": "window-1", "requestType": "critical" }),
            ),
            (
                "request-window-cancel-attention",
                host_protocol::WINDOW_CANCEL_ATTENTION_METHOD,
                serde_json::json!({ "windowId": "window-1" }),
            ),
        ] {
            let response = router
                .dispatch_at(request_with_payload(id, method, payload), 1710000000112)
                .expect("window attention request should return response");

            assert_eq!(
                response,
                HostProtocolEnvelope::Response {
                    id: id.to_string(),
                    timestamp: 1710000000112,
                    trace_id: format!("trace-{id}"),
                    payload: None,
                    error: None,
                }
            );
        }

        assert_eq!(fake.always_on_top(), vec![("window-1".to_string(), true)]);
        assert_eq!(fake.skip_taskbar(), vec![("window-1".to_string(), true)]);
        assert_eq!(
            fake.progress(),
            vec![host_protocol::WindowSetProgressPayload::new(
                "window-1",
                Some(host_protocol::WindowProgressState::Normal),
                Some(42),
                Some("app.desktop".to_string())
            )]
        );
        assert_eq!(
            fake.attention(),
            vec![(
                "window-1".to_string(),
                host_protocol::WindowAttentionType::Critical
            )]
        );
        assert_eq!(fake.attention_cancellations(), vec!["window-1".to_string()]);

        let invalid_response = router
            .dispatch_at(
                request_with_payload(
                    "request-window-set-progress-empty-desktop-filename",
                    host_protocol::WINDOW_SET_PROGRESS_METHOD,
                    serde_json::json!({
                        "windowId": "window-1",
                        "desktopFilename": ""
                    }),
                ),
                1710000000113,
            )
            .expect("invalid window progress request should return response");

        assert_eq!(
            invalid_response,
            HostProtocolEnvelope::Response {
                id: "request-window-set-progress-empty-desktop-filename".to_string(),
                timestamp: 1710000000113,
                trace_id: "trace-request-window-set-progress-empty-desktop-filename".to_string(),
                payload: None,
                error: Some(HostProtocolError::invalid_argument(
                    "payload",
                    "desktopFilename must be non-empty",
                    host_protocol::WINDOW_SET_PROGRESS_METHOD,
                )),
            }
        );
    }

    #[test]
    fn window_state_methods_route_to_window_handler() {
        let fake = Arc::new(FakeWindowHandler::new(
            Ok(WindowCreateResponse::new("window-unused")),
            Ok(()),
        ));
        let router = HostMethodRouter::new(fake.clone());

        let get_response = router
            .dispatch_at(
                request_with_payload(
                    "request-window-get-state",
                    host_protocol::WINDOW_GET_STATE_METHOD,
                    serde_json::json!({
                        "windowId": "window-1"
                    }),
                ),
                1710000000112,
            )
            .expect("window get state should return response");
        assert_eq!(
            get_response,
            HostProtocolEnvelope::Response {
                id: "request-window-get-state".to_string(),
                timestamp: 1710000000112,
                trace_id: "trace-request-window-get-state".to_string(),
                payload: Some(serde_json::json!({
                    "minimized": false,
                    "maximized": false,
                    "fullscreen": false,
                    "simpleFullscreen": false
                })),
                error: None,
            }
        );

        for (id, method, payload) in [
            (
                "request-window-minimize",
                host_protocol::WINDOW_MINIMIZE_METHOD,
                serde_json::json!({ "windowId": "window-1" }),
            ),
            (
                "request-window-maximize",
                host_protocol::WINDOW_MAXIMIZE_METHOD,
                serde_json::json!({ "windowId": "window-1" }),
            ),
            (
                "request-window-set-fullscreen",
                host_protocol::WINDOW_SET_FULLSCREEN_METHOD,
                serde_json::json!({ "windowId": "window-1", "fullscreen": true }),
            ),
            (
                "request-window-set-simple-fullscreen",
                host_protocol::WINDOW_SET_SIMPLE_FULLSCREEN_METHOD,
                serde_json::json!({ "windowId": "window-1", "simpleFullscreen": true }),
            ),
            (
                "request-window-restore",
                host_protocol::WINDOW_RESTORE_METHOD,
                serde_json::json!({ "windowId": "window-1" }),
            ),
        ] {
            let response = router
                .dispatch_at(request_with_payload(id, method, payload), 1710000000113)
                .expect("window state request should return response");

            assert_eq!(
                response,
                HostProtocolEnvelope::Response {
                    id: id.to_string(),
                    timestamp: 1710000000113,
                    trace_id: format!("trace-{id}"),
                    payload: Some(serde_json::json!({
                        "minimized": false,
                        "maximized": false,
                        "fullscreen": false,
                        "simpleFullscreen": false
                    })),
                    error: None,
                }
            );
        }

        assert_eq!(fake.minimized(), vec!["window-1".to_string()]);
        assert_eq!(fake.maximized(), vec!["window-1".to_string()]);
        assert_eq!(fake.fullscreen(), vec![("window-1".to_string(), true)]);
        assert_eq!(
            fake.simple_fullscreen(),
            vec![("window-1".to_string(), true)]
        );
        assert_eq!(fake.restored(), vec!["window-1".to_string()]);
    }

    #[test]
    fn dock_set_badge_text_routes_to_window_handler() {
        let fake = Arc::new(FakeWindowHandler::new(
            Ok(WindowCreateResponse::new("window-unused")),
            Ok(()),
        ));
        let router = HostMethodRouter::new(fake.clone());
        let response = router
            .dispatch_at(
                request_with_payload(
                    "request-dock-badge",
                    host_protocol::DOCK_SET_BADGE_TEXT_METHOD,
                    serde_json::json!({
                        "text": "7"
                    }),
                ),
                1710000000108,
            )
            .expect("dock badge request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-dock-badge".to_string(),
                timestamp: 1710000000108,
                trace_id: "trace-request-dock-badge".to_string(),
                payload: None,
                error: None,
            }
        );
        assert_eq!(fake.dock_badge_labels(), vec![Some("7".to_string())]);
    }

    #[test]
    fn dock_set_progress_routes_to_window_handler() {
        let fake = Arc::new(FakeWindowHandler::new(
            Ok(WindowCreateResponse::new("window-unused")),
            Ok(()),
        ));
        let router = HostMethodRouter::new(fake.clone());
        let response = router
            .dispatch_at(
                request_with_payload(
                    "request-dock-progress",
                    host_protocol::DOCK_SET_PROGRESS_METHOD,
                    serde_json::json!({
                        "value": 0.5,
                        "options": { "state": "normal" }
                    }),
                ),
                1710000000109,
            )
            .expect("dock progress request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-dock-progress".to_string(),
                timestamp: 1710000000109,
                trace_id: "trace-request-dock-progress".to_string(),
                payload: None,
                error: None,
            }
        );

        let progress = fake.dock_progress();
        assert_eq!(progress.len(), 1);
        assert_eq!(progress[0].value(), &serde_json::json!(0.5));
        assert_eq!(
            progress[0]
                .options()
                .and_then(host_protocol::DockSetProgressOptionsPayload::state),
            Some(host_protocol::DockProgressState::Normal)
        );
    }

    #[test]
    fn dock_set_badge_text_rejects_ascii_control_characters() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-dock-badge",
                    host_protocol::DOCK_SET_BADGE_TEXT_METHOD,
                    serde_json::json!({
                        "text": "line\nbreak"
                    }),
                ),
                1710000000112,
            )
            .expect("dock badge request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-dock-badge".to_string(),
                timestamp: 1710000000112,
                trace_id: "trace-request-dock-badge".to_string(),
                payload: None,
                error: Some(HostProtocolError::invalid_argument(
                    "text",
                    "must not include control characters",
                    host_protocol::DOCK_SET_BADGE_TEXT_METHOD,
                )),
            }
        );
    }

    #[test]
    fn dock_jump_list_route_fails_closed_after_validation() {
        let router = test_router();
        let jump_list_response = router
            .dispatch_at(
                request_with_payload(
                    "request-dock-jump-list",
                    host_protocol::DOCK_SET_JUMP_LIST_METHOD,
                    serde_json::json!({
                        "items": [{ "id": "open", "title": "Open", "commandId": "app.open" }]
                    }),
                ),
                1710000000115,
            )
            .expect("dock jump list request should return response");
        assert_eq!(
            jump_list_response,
            HostProtocolEnvelope::Response {
                id: "request-dock-jump-list".to_string(),
                timestamp: 1710000000115,
                trace_id: "trace-request-dock-jump-list".to_string(),
                payload: None,
                error: Some(HostProtocolError::unsupported(
                    "host-adapter-unimplemented",
                    host_protocol::DOCK_SET_JUMP_LIST_METHOD,
                )),
            }
        );
    }

    #[test]
    fn dock_progress_and_jump_list_reject_invalid_payloads_before_side_effects() {
        let progress_response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-dock-progress-invalid",
                    host_protocol::DOCK_SET_PROGRESS_METHOD,
                    serde_json::json!({ "value": 1.5 }),
                ),
                1710000000116,
            )
            .expect("dock progress invalid request should return response");
        assert!(matches!(
            progress_response,
            HostProtocolEnvelope::Response {
                error: Some(HostProtocolError::InvalidArgument { .. }),
                ..
            }
        ));

        let jump_list_response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-dock-jump-list-invalid",
                    host_protocol::DOCK_SET_JUMP_LIST_METHOD,
                    serde_json::json!({
                        "items": [{ "id": "", "title": "Open", "commandId": "app.open" }]
                    }),
                ),
                1710000000117,
            )
            .expect("dock jump list invalid request should return response");
        assert!(matches!(
            jump_list_response,
            HostProtocolEnvelope::Response {
                error: Some(HostProtocolError::InvalidArgument { .. }),
                ..
            }
        ));
    }

    #[test]
    fn dock_is_supported_returns_platform_capability_payload() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-dock-supported",
                    host_protocol::DOCK_IS_SUPPORTED_METHOD,
                    serde_json::json!({
                        "method": "setBadgeText"
                    }),
                ),
                1710000000109,
            )
            .expect("dock support request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-dock-supported".to_string(),
                timestamp: 1710000000109,
                trace_id: "trace-request-dock-supported".to_string(),
                payload: Some(serde_json::json!({
                    "supported": cfg!(target_os = "macos")
                })),
                error: None,
            }
        );
    }

    #[test]
    fn screen_methods_dispatch_through_window_handler() {
        let router = test_router();
        let displays = router
            .dispatch_at(
                request(
                    "request-screen-displays",
                    host_protocol::SCREEN_GET_DISPLAYS_METHOD,
                ),
                1710000000113,
            )
            .expect("screen displays request should return response");
        let primary = router
            .dispatch_at(
                request(
                    "request-screen-primary",
                    host_protocol::SCREEN_GET_PRIMARY_DISPLAY_METHOD,
                ),
                1710000000114,
            )
            .expect("screen primary request should return response");
        let pointer = router
            .dispatch_at(
                request(
                    "request-screen-pointer",
                    host_protocol::SCREEN_GET_POINTER_POINT_METHOD,
                ),
                1710000000115,
            )
            .expect("screen pointer request should return response");

        assert_eq!(
            displays,
            HostProtocolEnvelope::Response {
                id: "request-screen-displays".to_string(),
                timestamp: 1710000000113,
                trace_id: "trace-request-screen-displays".to_string(),
                payload: Some(serde_json::json!({
                    "displays": [{
                        "id": "display-1",
                        "bounds": { "x": 0.0, "y": 0.0, "width": 1920.0, "height": 1080.0 },
                        "workArea": { "x": 0.0, "y": 0.0, "width": 1920.0, "height": 1080.0 },
                        "scaleFactor": 2.0,
                        "primary": true
                    }]
                })),
                error: None,
            }
        );
        assert_eq!(
            primary,
            HostProtocolEnvelope::Response {
                id: "request-screen-primary".to_string(),
                timestamp: 1710000000114,
                trace_id: "trace-request-screen-primary".to_string(),
                payload: Some(serde_json::json!({
                    "id": "display-1",
                    "bounds": { "x": 0.0, "y": 0.0, "width": 1920.0, "height": 1080.0 },
                    "workArea": { "x": 0.0, "y": 0.0, "width": 1920.0, "height": 1080.0 },
                    "scaleFactor": 2.0,
                    "primary": true
                })),
                error: None,
            }
        );
        assert_eq!(
            pointer,
            HostProtocolEnvelope::Response {
                id: "request-screen-pointer".to_string(),
                timestamp: 1710000000115,
                trace_id: "trace-request-screen-pointer".to_string(),
                payload: Some(serde_json::json!({ "x": 12.0, "y": 34.0 })),
                error: None,
            }
        );
    }

    #[test]
    fn screen_support_rejects_unknown_methods() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-screen-supported",
                    host_protocol::SCREEN_IS_SUPPORTED_METHOD,
                    serde_json::json!({
                        "method": "watchDisplays"
                    }),
                ),
                1710000000116,
            )
            .expect("screen support request should return response");

        let HostProtocolEnvelope::Response { error, .. } = response else {
            panic!("screen support should return response");
        };
        assert!(matches!(
            error,
            Some(HostProtocolError::InvalidArgument { .. })
        ));
    }

    #[test]
    fn screen_void_methods_reject_payloads() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-screen-displays-with-payload",
                    host_protocol::SCREEN_GET_DISPLAYS_METHOD,
                    serde_json::json!({}),
                ),
                1710000000117,
            )
            .expect("screen displays request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-screen-displays-with-payload".to_string(),
                timestamp: 1710000000117,
                trace_id: "trace-request-screen-displays-with-payload".to_string(),
                payload: None,
                error: Some(HostProtocolError::invalid_argument(
                    "payload",
                    "must be omitted",
                    host_protocol::SCREEN_GET_DISPLAYS_METHOD,
                )),
            }
        );
    }

    #[test]
    fn shell_open_external_rejects_reserved_scheme_through_router() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-shell-open-external-reserved",
                    host_protocol::SHELL_OPEN_EXTERNAL_METHOD,
                    serde_json::json!({ "url": "file:///etc/passwd" }),
                ),
                1710000000118,
            )
            .expect("shell open external request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-shell-open-external-reserved".to_string(),
                timestamp: 1710000000118,
                trace_id: "trace-request-shell-open-external-reserved".to_string(),
                payload: None,
                error: Some(HostProtocolError::unsupported(
                    "reserved-url-scheme",
                    host_protocol::SHELL_OPEN_EXTERNAL_METHOD,
                )),
            }
        );
    }

    #[test]
    fn shell_path_methods_reject_traversal_through_router() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-shell-open-path-traversal",
                    host_protocol::SHELL_OPEN_PATH_METHOD,
                    serde_json::json!({ "path": "C:\\Temp\\..\\secret.txt" }),
                ),
                1710000000119,
            )
            .expect("shell open path request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-shell-open-path-traversal".to_string(),
                timestamp: 1710000000119,
                trace_id: "trace-request-shell-open-path-traversal".to_string(),
                payload: None,
                error: Some(HostProtocolError::invalid_argument(
                    "path",
                    "must not contain parent traversal",
                    host_protocol::SHELL_OPEN_PATH_METHOD,
                )),
            }
        );
    }

    #[test]
    fn path_methods_dispatch_canonical_paths_through_router() {
        let cases = [
            ("app-data", host_protocol::PATH_APP_DATA_METHOD),
            ("cache", host_protocol::PATH_CACHE_METHOD),
            ("logs", host_protocol::PATH_LOGS_METHOD),
            ("temp", host_protocol::PATH_TEMP_METHOD),
            ("home", host_protocol::PATH_HOME_METHOD),
            ("downloads", host_protocol::PATH_DOWNLOADS_METHOD),
        ];

        for (name, method) in cases {
            let request_id = format!("request-path-{name}");
            let response = test_router()
                .dispatch_at(request(&request_id, method), 1710000000120)
                .expect("path request should return response");

            match response {
                HostProtocolEnvelope::Response {
                    id,
                    timestamp,
                    trace_id,
                    payload: Some(payload),
                    error: None,
                } => {
                    assert_eq!(id, request_id);
                    assert_eq!(timestamp, 1710000000120);
                    assert_eq!(trace_id, format!("trace-request-path-{name}"));
                    let path = payload
                        .get("path")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or_else(|| panic!("{method} should return a string path"));
                    assert!(!path.is_empty(), "{method} returned an empty path");
                    assert!(Path::new(path).is_absolute(), "{method} returned {path}");
                }
                other => panic!("unexpected {method} response: {other:?}"),
            }
        }
    }

    #[test]
    fn path_methods_reject_payloads_through_router() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-path-home-payload",
                    host_protocol::PATH_HOME_METHOD,
                    serde_json::json!({}),
                ),
                1710000000121,
            )
            .expect("path home request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-path-home-payload".to_string(),
                timestamp: 1710000000121,
                trace_id: "trace-request-path-home-payload".to_string(),
                payload: None,
                error: Some(HostProtocolError::invalid_argument(
                    "payload",
                    "must be omitted",
                    host_protocol::PATH_HOME_METHOD,
                )),
            }
        );
    }

    #[test]
    fn protocol_methods_dispatch_policy_updates_through_router() {
        let asset_root = std::env::temp_dir().join("effect-desktop-protocol-test");
        std::fs::create_dir_all(&asset_root).expect("asset root should exist");
        let asset_root = asset_root
            .to_str()
            .expect("temp path should be valid UTF-8")
            .to_string();
        let cases = [
            (
                "register-app-protocol",
                host_protocol::PROTOCOL_REGISTER_APP_PROTOCOL_METHOD,
                serde_json::json!({ "scheme": "myapp" }),
            ),
            (
                "serve-asset",
                host_protocol::PROTOCOL_SERVE_ASSET_METHOD,
                serde_json::json!({ "scheme": "assets", "root": asset_root }),
            ),
            (
                "serve-route",
                host_protocol::PROTOCOL_SERVE_ROUTE_METHOD,
                serde_json::json!({ "scheme": "myapp", "route": "/settings" }),
            ),
            (
                "deny",
                host_protocol::PROTOCOL_DENY_METHOD,
                serde_json::json!({ "scheme": "assets", "path": "/private" }),
            ),
        ];

        for (name, method, payload) in cases {
            let request_id = format!("request-protocol-{name}");
            let response = test_router()
                .dispatch_at(
                    request_with_payload(&request_id, method, payload),
                    1710000000122,
                )
                .expect("protocol request should return response");

            assert_eq!(
                response,
                HostProtocolEnvelope::Response {
                    id: request_id,
                    timestamp: 1710000000122,
                    trace_id: format!("trace-request-protocol-{name}"),
                    payload: None,
                    error: None,
                }
            );
        }
    }

    #[test]
    fn protocol_methods_reject_unsafe_payloads_through_router() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-protocol-traversal",
                    host_protocol::PROTOCOL_SERVE_ROUTE_METHOD,
                    serde_json::json!({ "scheme": "myapp", "route": "/../secret" }),
                ),
                1710000000123,
            )
            .expect("protocol traversal request should return response");

        match response {
            HostProtocolEnvelope::Response {
                id,
                timestamp,
                trace_id,
                payload: None,
                error: Some(HostProtocolError::InvalidArgument { field, .. }),
            } => {
                assert_eq!(id, "request-protocol-traversal");
                assert_eq!(timestamp, 1710000000123);
                assert_eq!(trace_id, "trace-request-protocol-traversal");
                assert_eq!(field, "route");
            }
            other => panic!("unexpected protocol traversal response: {other:?}"),
        }
    }

    #[test]
    fn global_shortcut_is_registered_returns_false_until_adapter_is_connected() {
        let response = test_router()
            .dispatch_at(
                request(
                    "request-global-shortcut-registered",
                    host_protocol::GLOBAL_SHORTCUT_IS_REGISTERED_METHOD,
                ),
                1710000000110,
            )
            .expect("global shortcut support request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-global-shortcut-registered".to_string(),
                timestamp: 1710000000110,
                trace_id: "trace-request-global-shortcut-registered".to_string(),
                payload: Some(serde_json::json!({ "registered": false })),
                error: None,
            }
        );
    }

    #[test]
    fn safe_storage_is_available_returns_boolean_payload() {
        let response = test_router()
            .dispatch_at(
                request(
                    "request-safe-storage-available",
                    host_protocol::SAFE_STORAGE_IS_AVAILABLE_METHOD,
                ),
                1710000000111,
            )
            .expect("safe storage availability request should return response");

        match response {
            HostProtocolEnvelope::Response {
                id,
                timestamp,
                trace_id,
                payload: Some(payload),
                error: None,
            } => {
                assert_eq!(id, "request-safe-storage-available");
                assert_eq!(timestamp, 1710000000111);
                assert_eq!(trace_id, "trace-request-safe-storage-available");
                assert!(payload
                    .get("available")
                    .and_then(serde_json::Value::as_bool)
                    .is_some());
            }
            other => panic!("unexpected safe storage response: {other:?}"),
        }
    }

    #[test]
    fn safe_storage_secret_methods_fail_closed_after_validation() {
        let router = test_router();
        for (id, method, payload) in [
            (
                "request-safe-storage-set",
                host_protocol::SAFE_STORAGE_SET_METHOD,
                serde_json::json!({ "key": "token", "value": "AAE=" }),
            ),
            (
                "request-safe-storage-get",
                host_protocol::SAFE_STORAGE_GET_METHOD,
                serde_json::json!({ "key": "token" }),
            ),
            (
                "request-safe-storage-delete",
                host_protocol::SAFE_STORAGE_DELETE_METHOD,
                serde_json::json!({ "key": "token" }),
            ),
            (
                "request-safe-storage-list",
                host_protocol::SAFE_STORAGE_LIST_METHOD,
                serde_json::Value::Null,
            ),
        ] {
            let response = router
                .dispatch_at(request_with_payload(id, method, payload), 1710000000112)
                .expect("safe storage request should return response");

            assert!(matches!(
                response,
                HostProtocolEnvelope::Response {
                    payload: None,
                    error: Some(HostProtocolError::Unsupported { .. }),
                    ..
                }
            ));
        }
    }

    #[test]
    fn safe_storage_secret_methods_reject_invalid_payloads_before_unsupported() {
        let router = test_router();
        for (id, method, payload) in [
            (
                "request-safe-storage-set-invalid",
                host_protocol::SAFE_STORAGE_SET_METHOD,
                serde_json::json!({ "key": "bad\nkey", "value": "AAE=" }),
            ),
            (
                "request-safe-storage-get-invalid",
                host_protocol::SAFE_STORAGE_GET_METHOD,
                serde_json::json!({ "key": "" }),
            ),
            (
                "request-safe-storage-delete-invalid",
                host_protocol::SAFE_STORAGE_DELETE_METHOD,
                serde_json::json!({ "key": "token", "unexpected": true }),
            ),
            (
                "request-safe-storage-list-invalid",
                host_protocol::SAFE_STORAGE_LIST_METHOD,
                serde_json::json!({}),
            ),
        ] {
            let response = router
                .dispatch_at(request_with_payload(id, method, payload), 1710000000113)
                .expect("safe storage invalid request should return response");

            assert!(matches!(
                response,
                HostProtocolEnvelope::Response {
                    error: Some(HostProtocolError::InvalidArgument { .. }),
                    ..
                }
            ));
        }
    }

    #[test]
    fn webview_methods_fail_closed_after_validation() {
        let router = test_router();
        let webview = serde_json::json!({
            "kind": "webview",
            "id": "webview-1",
            "generation": 0,
            "ownerScope": "window:window-1",
            "state": "open"
        });
        let frame = serde_json::json!({
            "kind": "webview-frame",
            "id": "frame-1",
            "generation": 0,
            "ownerScope": "webview:webview-1",
            "state": "open"
        });
        let window = serde_json::json!({
            "kind": "window",
            "id": "window-1",
            "generation": 0,
            "ownerScope": "runtime:test",
            "state": "open"
        });
        for (id, method, payload) in [
            (
                "request-webview-create",
                host_protocol::WEBVIEW_CREATE_METHOD,
                serde_json::json!({
                    "window": window,
                    "url": "app://localhost/settings",
                    "originPolicy": {
                        "allowedOrigins": ["app://localhost"],
                        "onDisallowed": "block"
                    },
                    "isolation": {
                        "exposedApis": [
                            { "name": "desktop", "methods": ["ping"] }
                        ]
                    }
                }),
            ),
            (
                "request-webview-load-url",
                host_protocol::WEBVIEW_LOAD_URL_METHOD,
                serde_json::json!({
                    "webview": webview,
                    "url": "https://example.com/settings"
                }),
            ),
            (
                "request-webview-set-navigation-policy",
                host_protocol::WEBVIEW_SET_NAVIGATION_POLICY_METHOD,
                serde_json::json!({
                    "webview": serde_json::json!({
                        "kind": "webview",
                        "id": "webview-1",
                        "generation": 0,
                        "ownerScope": "window:window-1",
                        "state": "open"
                    }),
                    "policy": {
                        "allowedOrigins": ["app://localhost", "https://example.com"],
                        "onDisallowed": "openExternal"
                    }
                }),
            ),
            (
                "request-webview-open-devtools",
                host_protocol::WEBVIEW_OPEN_DEVTOOLS_METHOD,
                serde_json::json!({ "webview": webview }),
            ),
            (
                "request-webview-print",
                host_protocol::WEBVIEW_PRINT_METHOD,
                serde_json::json!({ "webview": webview }),
            ),
            (
                "request-webview-print-to-pdf",
                host_protocol::WEBVIEW_PRINT_TO_PDF_METHOD,
                serde_json::json!({ "webview": webview }),
            ),
            (
                "request-webview-find-in-page",
                host_protocol::WEBVIEW_FIND_IN_PAGE_METHOD,
                serde_json::json!({ "webview": webview, "query": "needle" }),
            ),
            (
                "request-webview-set-zoom",
                host_protocol::WEBVIEW_SET_ZOOM_METHOD,
                serde_json::json!({ "webview": webview, "zoom": 1.25 }),
            ),
            (
                "request-webview-set-user-agent",
                host_protocol::WEBVIEW_SET_USER_AGENT_METHOD,
                serde_json::json!({ "webview": webview, "userAgent": "EffectDesktopTest/1.0" }),
            ),
            (
                "request-webview-set-audio-muted",
                host_protocol::WEBVIEW_SET_AUDIO_MUTED_METHOD,
                serde_json::json!({ "webview": webview, "muted": true }),
            ),
            (
                "request-webview-respond-to-permission",
                host_protocol::WEBVIEW_RESPOND_TO_PERMISSION_METHOD,
                serde_json::json!({
                    "webview": webview,
                    "requestId": "permission-1",
                    "decision": "deny"
                }),
            ),
            (
                "request-webview-list-frames",
                host_protocol::WEBVIEW_LIST_FRAMES_METHOD,
                serde_json::json!({ "webview": webview }),
            ),
            (
                "request-webview-post-to-frame",
                host_protocol::WEBVIEW_POST_TO_FRAME_METHOD,
                serde_json::json!({
                    "webview": webview,
                    "frame": frame,
                    "payload": "{\"kind\":\"ping\"}"
                }),
            ),
            (
                "request-webview-close-devtools",
                host_protocol::WEBVIEW_CLOSE_DEVTOOLS_METHOD,
                serde_json::json!({ "webview": webview }),
            ),
            (
                "request-webview-attach-debugger",
                host_protocol::WEBVIEW_ATTACH_DEBUGGER_METHOD,
                serde_json::json!({ "webview": webview }),
            ),
            (
                "request-webview-capability",
                host_protocol::WEBVIEW_CAPABILITY_METHOD,
                serde_json::json!({ "name": "devtools open", "platform": "windows" }),
            ),
        ] {
            let response = router
                .dispatch_at(request_with_payload(id, method, payload), 1710000000114)
                .expect("webview request should return response");

            assert!(matches!(
                response,
                HostProtocolEnvelope::Response {
                    payload: None,
                    error: Some(HostProtocolError::Unsupported { .. }),
                    ..
                }
            ));
        }
    }

    #[test]
    fn webview_methods_reject_invalid_payloads_before_unsupported() {
        let router = test_router();
        let webview = serde_json::json!({
            "kind": "webview",
            "id": "webview-1",
            "generation": 0,
            "ownerScope": "window:window-1",
            "state": "open"
        });
        let frame = serde_json::json!({
            "kind": "webview-frame",
            "id": "frame-1",
            "generation": 0,
            "ownerScope": "webview:webview-1",
            "state": "open"
        });
        let window = serde_json::json!({
            "kind": "window",
            "id": "window-1",
            "generation": 0,
            "ownerScope": "runtime:test",
            "state": "open"
        });
        for (id, method, payload) in [
            (
                "request-webview-create-invalid-url",
                host_protocol::WEBVIEW_CREATE_METHOD,
                serde_json::json!({
                    "window": window,
                    "url": "file://localhost/secret",
                    "originPolicy": {
                        "allowedOrigins": ["app://localhost"],
                        "onDisallowed": "block"
                    }
                }),
            ),
            (
                "request-webview-create-invalid-isolation",
                host_protocol::WEBVIEW_CREATE_METHOD,
                serde_json::json!({
                    "window": window,
                    "url": "app://localhost/settings",
                    "originPolicy": {
                        "allowedOrigins": ["app://localhost"],
                        "onDisallowed": "block"
                    },
                    "isolation": {
                        "exposedApis": [
                            { "name": "desktop", "methods": ["bad-name"] }
                        ]
                    }
                }),
            ),
            (
                "request-webview-load-route-traversal",
                host_protocol::WEBVIEW_LOAD_ROUTE_METHOD,
                serde_json::json!({
                    "webview": webview,
                    "route": "/../settings"
                }),
            ),
            (
                "request-webview-stop-wrong-handle",
                host_protocol::WEBVIEW_STOP_METHOD,
                serde_json::json!({
                    "webview": {
                        "kind": "window",
                        "id": "webview-1",
                        "generation": 0,
                        "ownerScope": "window:window-1",
                        "state": "open"
                    }
                }),
            ),
            (
                "request-webview-respond-to-permission-invalid-decision",
                host_protocol::WEBVIEW_RESPOND_TO_PERMISSION_METHOD,
                serde_json::json!({
                    "webview": webview,
                    "requestId": "permission-1",
                    "decision": "allow"
                }),
            ),
            (
                "request-webview-post-to-frame-invalid-frame",
                host_protocol::WEBVIEW_POST_TO_FRAME_METHOD,
                serde_json::json!({
                    "webview": webview,
                    "frame": {
                        "kind": "webview",
                        "id": "frame-1",
                        "generation": 0,
                        "ownerScope": "webview:webview-1",
                        "state": "open"
                    },
                    "payload": "{\"kind\":\"ping\"}"
                }),
            ),
            (
                "request-webview-post-to-frame-control-byte",
                host_protocol::WEBVIEW_POST_TO_FRAME_METHOD,
                serde_json::json!({
                    "webview": webview,
                    "frame": frame,
                    "payload": format!("bad{}payload", char::from(0))
                }),
            ),
            (
                "request-webview-capability-unknown",
                host_protocol::WEBVIEW_CAPABILITY_METHOD,
                serde_json::json!({ "name": "unknown" }),
            ),
        ] {
            let response = router
                .dispatch_at(request_with_payload(id, method, payload), 1710000000115)
                .expect("webview invalid request should return response");

            assert!(matches!(
                response,
                HostProtocolEnvelope::Response {
                    error: Some(HostProtocolError::InvalidArgument { .. }),
                    ..
                }
            ));
        }
    }

    #[test]
    fn clipboard_write_text_routes_to_host_adapter() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-clipboard-write-text",
                    host_protocol::CLIPBOARD_WRITE_TEXT_METHOD,
                    serde_json::json!({ "text": "hello" }),
                ),
                1710000000112,
            )
            .expect("clipboard write should return response");

        let HostProtocolEnvelope::Response {
            id,
            timestamp,
            trace_id,
            payload,
            error,
        } = response
        else {
            panic!("clipboard write should return a response");
        };
        assert_eq!(id, "request-clipboard-write-text");
        assert_eq!(timestamp, 1710000000112);
        assert_eq!(trace_id, "trace-request-clipboard-write-text");
        assert!(payload.is_none());
        if let Some(error) = error {
            assert!(
                matches!(
                    error,
                    HostProtocolError::Unsupported { .. }
                        | HostProtocolError::HostUnavailable { .. }
                        | HostProtocolError::ResourceBusy { .. }
                ),
                "clipboard write should surface a typed host error: {error:?}"
            );
        }
    }

    #[test]
    fn clipboard_invalid_payload_rejects_before_host_access() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-clipboard-invalid",
                    host_protocol::CLIPBOARD_WRITE_HTML_METHOD,
                    serde_json::json!({ "html": "<p>bad\u{0000}</p>" }),
                ),
                1710000000112,
            )
            .expect("clipboard write should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-clipboard-invalid".to_string(),
                timestamp: 1710000000112,
                trace_id: "trace-request-clipboard-invalid".to_string(),
                payload: None,
                error: Some(HostProtocolError::invalid_argument(
                    "html",
                    "must not contain NUL bytes",
                    host_protocol::CLIPBOARD_WRITE_HTML_METHOD,
                )),
            }
        );
    }

    #[test]
    fn updater_check_routes_to_typed_unsupported() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-updater-check",
                    host_protocol::UPDATER_CHECK_METHOD,
                    serde_json::json!({ "currentVersion": "1.0.0" }),
                ),
                1710000000112,
            )
            .expect("updater check should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-updater-check".to_string(),
                timestamp: 1710000000112,
                trace_id: "trace-request-updater-check".to_string(),
                payload: None,
                error: Some(HostProtocolError::unsupported(
                    host_protocol::UPDATER_UNSUPPORTED_REASON,
                    host_protocol::UPDATER_CHECK_METHOD,
                )),
            }
        );
    }

    #[test]
    fn updater_invalid_payload_rejects_before_unsupported() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-updater-invalid",
                    host_protocol::UPDATER_INSTALL_METHOD,
                    serde_json::json!({ "version": "bad\nversion" }),
                ),
                1710000000112,
            )
            .expect("updater install should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-updater-invalid".to_string(),
                timestamp: 1710000000112,
                trace_id: "trace-request-updater-invalid".to_string(),
                payload: None,
                error: Some(HostProtocolError::invalid_argument(
                    "version",
                    "must not include control characters",
                    host_protocol::UPDATER_INSTALL_METHOD,
                )),
            }
        );
    }

    #[test]
    fn crash_reporter_start_routes_to_host_state() {
        let _env = super::crash_reporter::CrashReporterTestEnv::new("route-start");
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-crash-reporter-start",
                    host_protocol::CRASH_REPORTER_START_METHOD,
                    serde_json::json!({ "enabled": true }),
                ),
                1710000000112,
            )
            .expect("crash reporter start should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-crash-reporter-start".to_string(),
                timestamp: 1710000000112,
                trace_id: "trace-request-crash-reporter-start".to_string(),
                payload: None,
                error: None,
            }
        );
    }

    #[test]
    fn crash_reporter_get_reports_routes_to_host_state() {
        let _env = super::crash_reporter::CrashReporterTestEnv::new("route-get-reports");
        let response = test_router()
            .dispatch_at(
                request(
                    "request-crash-reporter-get-reports",
                    host_protocol::CRASH_REPORTER_GET_REPORTS_METHOD,
                ),
                1710000000112,
            )
            .expect("crash reporter getReports should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-crash-reporter-get-reports".to_string(),
                timestamp: 1710000000112,
                trace_id: "trace-request-crash-reporter-get-reports".to_string(),
                payload: Some(serde_json::json!({ "reports": [] })),
                error: None,
            }
        );
    }

    #[test]
    fn crash_reporter_invalid_payload_rejects_before_unsupported() {
        let _env = super::crash_reporter::CrashReporterTestEnv::new("route-invalid");
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-crash-reporter-invalid",
                    host_protocol::CRASH_REPORTER_RECORD_BREADCRUMB_METHOD,
                    serde_json::json!({ "category": "bad\ncategory", "message": "bad" }),
                ),
                1710000000112,
            )
            .expect("crash reporter breadcrumb should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-crash-reporter-invalid".to_string(),
                timestamp: 1710000000112,
                trace_id: "trace-request-crash-reporter-invalid".to_string(),
                payload: None,
                error: Some(HostProtocolError::invalid_argument(
                    "category",
                    "must not include ASCII control characters",
                    host_protocol::CRASH_REPORTER_RECORD_BREADCRUMB_METHOD,
                )),
            }
        );
    }

    #[test]
    fn power_monitor_support_routes_false_payload() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-power-monitor-support",
                    host_protocol::POWER_MONITOR_IS_SUPPORTED_METHOD,
                    serde_json::json!({ "method": "onSuspend" }),
                ),
                1710000000112,
            )
            .expect("power monitor support should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-power-monitor-support".to_string(),
                timestamp: 1710000000112,
                trace_id: "trace-request-power-monitor-support".to_string(),
                payload: Some(serde_json::json!({ "supported": cfg!(target_os = "macos") })),
                error: None,
            }
        );
    }

    #[test]
    fn power_monitor_support_rejects_unknown_method() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-power-monitor-invalid",
                    host_protocol::POWER_MONITOR_IS_SUPPORTED_METHOD,
                    serde_json::json!({ "method": "onDisplayOff" }),
                ),
                1710000000112,
            )
            .expect("power monitor support should return response");

        let HostProtocolEnvelope::Response {
            error: Some(error), ..
        } = response
        else {
            panic!("power monitor support should reject unknown method");
        };
        assert_eq!(error.tag(), "InvalidArgument");
    }

    #[test]
    fn system_appearance_get_routes_to_typed_unsupported() {
        let response = test_router()
            .dispatch_at(
                request(
                    "request-system-appearance-get",
                    host_protocol::SYSTEM_APPEARANCE_GET_APPEARANCE_METHOD,
                ),
                1710000000112,
            )
            .expect("system appearance get should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-system-appearance-get".to_string(),
                timestamp: 1710000000112,
                trace_id: "trace-request-system-appearance-get".to_string(),
                payload: None,
                error: Some(HostProtocolError::unsupported(
                    host_protocol::SYSTEM_APPEARANCE_UNSUPPORTED_REASON,
                    host_protocol::SYSTEM_APPEARANCE_GET_APPEARANCE_METHOD,
                )),
            }
        );
    }

    #[test]
    fn system_appearance_support_routes_false_payload() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-system-appearance-support",
                    host_protocol::SYSTEM_APPEARANCE_IS_SUPPORTED_METHOD,
                    serde_json::json!({ "method": "getAppearance" }),
                ),
                1710000000112,
            )
            .expect("system appearance support should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-system-appearance-support".to_string(),
                timestamp: 1710000000112,
                trace_id: "trace-request-system-appearance-support".to_string(),
                payload: Some(serde_json::json!({ "supported": false })),
                error: None,
            }
        );
    }

    #[test]
    fn system_appearance_support_rejects_unknown_method() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-system-appearance-invalid",
                    host_protocol::SYSTEM_APPEARANCE_IS_SUPPORTED_METHOD,
                    serde_json::json!({ "method": "theme" }),
                ),
                1710000000112,
            )
            .expect("system appearance support should return response");

        let HostProtocolEnvelope::Response {
            error: Some(error), ..
        } = response
        else {
            panic!("system appearance support should reject unknown method");
        };
        assert_eq!(error.tag(), "InvalidArgument");
    }

    #[test]
    fn clipboard_support_reports_unimplemented_selection() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-clipboard-supported",
                    host_protocol::CLIPBOARD_IS_SUPPORTED_METHOD,
                    serde_json::json!({ "capability": "selection" }),
                ),
                1710000000112,
            )
            .expect("clipboard support should return response");

        let HostProtocolEnvelope::Response {
            payload: Some(payload),
            error: None,
            ..
        } = &response
        else {
            panic!("clipboard support should return successful payload: {response:?}");
        };
        let supported = serde_json::from_value::<ClipboardSupportedPayload>(payload.clone())
            .expect("support payload should decode");

        assert!(!supported.is_supported());
        assert_eq!(
            supported.reason(),
            Some(host_protocol::CLIPBOARD_UNSUPPORTED_REASON)
        );
    }

    #[test]
    fn realtime_media_session_known_methods_route_to_host_adapter() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-realtime-media-close",
                    host_protocol::REALTIME_MEDIA_SESSION_CLOSE_METHOD,
                    serde_json::json!({
                        "profileId": "profile-1",
                        "sessionId": "session-1"
                    }),
                ),
                1710000000113,
            )
            .expect("realtime media close should return response");

        match response {
            HostProtocolEnvelope::Response {
                id,
                timestamp,
                trace_id,
                payload: None,
                error: Some(error),
            } => {
                assert_eq!(id, "request-realtime-media-close");
                assert_eq!(timestamp, 1710000000113);
                assert_eq!(trace_id, "trace-request-realtime-media-close");
                if cfg!(target_os = "macos") {
                    assert_eq!(error.tag(), "NotFound");
                } else {
                    assert_eq!(error.tag(), "Unsupported");
                }
            }
            other => panic!("unexpected realtime media close response: {other:?}"),
        }
    }

    #[test]
    fn realtime_media_session_rejects_invalid_payload_before_unsupported() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-realtime-media-invalid",
                    host_protocol::REALTIME_MEDIA_SESSION_OPEN_METHOD,
                    serde_json::json!({
                        "profileId": "",
                        "sessionId": "session-1"
                    }),
                ),
                1710000000114,
            )
            .expect("realtime media request should return response");

        match response {
            HostProtocolEnvelope::Response {
                error: Some(error), ..
            } => assert_eq!(error.tag(), "InvalidArgument"),
            other => panic!("unexpected realtime media invalid response: {other:?}"),
        }
    }

    #[test]
    fn realtime_media_session_is_supported_reports_runtime_probe_result() {
        let response = test_router()
            .dispatch_at(
                request(
                    "request-realtime-media-supported",
                    host_protocol::REALTIME_MEDIA_SESSION_IS_SUPPORTED_METHOD,
                ),
                1710000000115,
            )
            .expect("realtime media support request should return response");

        match response {
            HostProtocolEnvelope::Response {
                id,
                timestamp,
                trace_id,
                payload: Some(payload),
                error: None,
            } => {
                assert_eq!(id, "request-realtime-media-supported");
                assert_eq!(timestamp, 1710000000115);
                assert_eq!(trace_id, "trace-request-realtime-media-supported");
                assert!(payload
                    .get("supported")
                    .and_then(serde_json::Value::as_bool)
                    .is_some());
                if payload.get("supported") == Some(&serde_json::Value::Bool(false)) {
                    assert!(matches!(
                        payload.get("reason").and_then(serde_json::Value::as_str),
                        Some(host_protocol::REALTIME_MEDIA_SESSION_MEDIA_UNAVAILABLE_REASON)
                            | Some(host_protocol::REALTIME_MEDIA_SESSION_STARTUP_UNVERIFIED_REASON)
                    ));
                }
            }
            other => panic!("unexpected realtime media support response: {other:?}"),
        }
    }

    #[test]
    fn diagnostics_bundle_collect_returns_summary_payload() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-diagnostics-router-collect",
                    host_protocol::DIAGNOSTICS_BUNDLE_COLLECT_METHOD,
                    serde_json::json!({
                        "bundleId": "bundle-router-collect",
                        "sources": ["logs", "audit-events"]
                    }),
                ),
                1710000000116,
            )
            .expect("diagnostics request should return response");

        match response {
            HostProtocolEnvelope::Response {
                id,
                timestamp,
                trace_id,
                payload: Some(payload),
                error: None,
            } => {
                assert_eq!(id, "request-diagnostics-router-collect");
                assert_eq!(timestamp, 1710000000116);
                assert_eq!(trace_id, "trace-request-diagnostics-router-collect");
                assert_eq!(payload["bundleId"], "bundle-router-collect");
                assert_eq!(payload["artifactCount"], 2);
                assert_eq!(payload["sources"][0]["source"], "logs");
                assert_eq!(
                    payload["sources"][0]["redactionPolicy"]["id"],
                    "host-secret-patterns"
                );
            }
            other => panic!("unexpected diagnostics collect response: {other:?}"),
        }
    }

    #[test]
    fn diagnostics_bundle_rejects_invalid_payload() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-diagnostics-invalid",
                    host_protocol::DIAGNOSTICS_BUNDLE_WRITE_METHOD,
                    serde_json::json!({
                        "bundleId": "bundle-1",
                        "destinationPath": ""
                    }),
                ),
                1710000000117,
            )
            .expect("diagnostics request should return response");

        match response {
            HostProtocolEnvelope::Response {
                error: Some(error), ..
            } => assert_eq!(error.tag(), "InvalidArgument"),
            other => panic!("unexpected diagnostics invalid response: {other:?}"),
        }
    }

    #[test]
    fn diagnostics_bundle_is_supported_reports_host_exporter_support() {
        let response = test_router()
            .dispatch_at(
                request(
                    "request-diagnostics-supported",
                    host_protocol::DIAGNOSTICS_BUNDLE_IS_SUPPORTED_METHOD,
                ),
                1710000000118,
            )
            .expect("diagnostics support request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-diagnostics-supported".to_string(),
                timestamp: 1710000000118,
                trace_id: "trace-request-diagnostics-supported".to_string(),
                payload: Some(serde_json::json!({
                    "supported": true
                })),
                error: None,
            }
        );
    }

    #[test]
    fn diagnostics_bundle_router_collect_write_persists_source_records() {
        let router = test_router();
        let bundle_id = "bundle-router-write";
        let dir = unique_temp_dir("diagnostics-router-write");
        fs::create_dir_all(&dir).expect("temp dir should be created");
        let path = dir.join("diagnostics.json");

        let collect = router
            .dispatch_at(
                request_with_payload(
                    "request-diagnostics-router-real-collect",
                    host_protocol::DIAGNOSTICS_BUNDLE_COLLECT_METHOD,
                    serde_json::json!({
                        "bundleId": bundle_id,
                        "sources": ["host-state", "logs"],
                        "traceId": "trace-diagnostics-router"
                    }),
                ),
                1710000000119,
            )
            .expect("diagnostics collect should return response");
        assert!(matches!(
            collect,
            HostProtocolEnvelope::Response { error: None, .. }
        ));

        let write = router
            .dispatch_at(
                request_with_payload(
                    "request-diagnostics-router-real-write",
                    host_protocol::DIAGNOSTICS_BUNDLE_WRITE_METHOD,
                    serde_json::json!({
                        "bundleId": bundle_id,
                        "destinationPath": path.to_string_lossy()
                    }),
                ),
                1710000000120,
            )
            .expect("diagnostics write should return response");
        assert!(matches!(
            write,
            HostProtocolEnvelope::Response { error: None, .. }
        ));

        let body = fs::read_to_string(path).expect("bundle file should exist");
        assert!(!body.contains("metadata-only"));
        let parsed: serde_json::Value = serde_json::from_str(&body).expect("bundle should be JSON");
        assert_eq!(parsed["bundleId"], bundle_id);
        assert_eq!(parsed["artifacts"]["host-state"]["status"], "collected");
        assert_eq!(parsed["artifacts"]["logs"]["status"], "unavailable");
        assert_eq!(
            parsed["artifacts"]["logs"]["unavailable"]["reason"],
            "collector-unavailable"
        );
    }

    #[test]
    fn notification_is_supported_routes_to_host_adapter() {
        let response = test_router()
            .dispatch_at(
                request(
                    "request-notification-supported",
                    host_protocol::NOTIFICATION_IS_SUPPORTED_METHOD,
                ),
                1710000000188,
            )
            .expect("notification support should return response");

        #[cfg(target_os = "linux")]
        let expected_payload = serde_json::json!({ "supported": true });
        #[cfg(not(target_os = "linux"))]
        let expected_payload = serde_json::json!({
            "supported": false,
            "reason": host_protocol::NOTIFICATION_UNSUPPORTED_REASON
        });

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-notification-supported".to_string(),
                timestamp: 1710000000188,
                trace_id: "trace-request-notification-supported".to_string(),
                payload: Some(expected_payload),
                error: None,
            }
        );
    }

    #[test]
    fn notification_show_rejects_invalid_payload_before_native_work() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-notification-show-invalid",
                    host_protocol::NOTIFICATION_SHOW_METHOD,
                    serde_json::json!({
                        "title": "",
                        "body": "Open results"
                    }),
                ),
                1710000000189,
            )
            .expect("notification show should return response");

        assert!(matches!(
            response,
            HostProtocolEnvelope::Response {
                error: Some(HostProtocolError::InvalidArgument { .. }),
                ..
            }
        ));
    }

    #[test]
    fn egress_policy_decide_routes_to_host_adapter() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-egress-policy",
                    host_protocol::EGRESS_POLICY_DECIDE_METHOD,
                    serde_json::json!({
                        "actor": { "kind": "extension", "id": "extension-1" },
                        "destination": {
                            "protocol": "https",
                            "host": "api.example.test",
                            "port": 443
                        },
                        "traceId": "trace-egress-policy"
                    }),
                ),
                1710000000119,
            )
            .expect("egress policy request should return response");

        let decision_id = egress_policy_decision_id(&response);
        assert!(decision_id.starts_with("egress-decision-"));
        assert_ne!(decision_id, "trace-egress-policy");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-egress-policy".to_string(),
                timestamp: 1710000000119,
                trace_id: "trace-request-egress-policy".to_string(),
                payload: Some(serde_json::json!({
                    "decisionId": decision_id,
                    "outcome": "denied",
                    "actor": { "kind": "extension", "id": "extension-1" },
                    "destination": {
                        "protocol": "https",
                        "host": "api.example.test",
                        "port": 443
                    },
                    "rule": {
                        "id": "default-deny",
                        "effect": "deny",
                        "hosts": ["*"],
                        "reason": "no matching egress allow rule"
                    },
                    "reason": "no matching egress allow rule"
                })),
                error: None,
            }
        );
    }

    #[test]
    fn egress_policy_invalid_payload_returns_invalid_argument() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-egress-policy-invalid",
                    host_protocol::EGRESS_POLICY_DECIDE_METHOD,
                    serde_json::json!({
                        "actor": { "kind": "extension", "id": "extension-1" },
                        "destination": {
                            "protocol": "https",
                            "host": ""
                        }
                    }),
                ),
                1710000000120,
            )
            .expect("egress policy request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-egress-policy-invalid".to_string(),
                timestamp: 1710000000120,
                trace_id: "trace-request-egress-policy-invalid".to_string(),
                payload: None,
                error: Some(HostProtocolError::invalid_argument(
                    "destination.host",
                    "must be non-empty",
                    host_protocol::EGRESS_POLICY_DECIDE_METHOD,
                )),
            }
        );
    }

    #[test]
    fn egress_policy_record_routes_response_and_native_event() {
        let _guard = super::egress_policy::EGRESS_POLICY_ENV_LOCK
            .lock()
            .expect("egress policy env lock should not be poisoned");
        let dir = unique_temp_dir("egress-policy-record-route");
        fs::create_dir_all(&dir).expect("temp dir should be created");
        let log_path = dir.join("egress-policy.jsonl");
        let previous_log_path = std::env::var_os("EFFECT_DESKTOP_EGRESS_POLICY_LOG");
        std::env::set_var("EFFECT_DESKTOP_EGRESS_POLICY_LOG", &log_path);

        let router = test_router();
        let decision_response = router
            .dispatch_at(
                request_with_payload(
                    "request-egress-policy-issue",
                    host_protocol::EGRESS_POLICY_DECIDE_METHOD,
                    serde_json::json!({
                        "actor": { "kind": "extension", "id": "extension-1" },
                        "destination": {
                            "protocol": "https",
                            "host": "api.example.test",
                            "port": 443
                        },
                        "traceId": "decision-router-record"
                    }),
                ),
                1710000000121,
            )
            .expect("egress policy decision should be issued");
        let decision_id = egress_policy_decision_id(&decision_response);

        let frames = router.dispatch_frames_at(
            request_with_payload(
                "request-egress-policy-record",
                host_protocol::EGRESS_POLICY_RECORD_METHOD,
                serde_json::json!({
                    "decisionId": decision_id,
                    "actor": { "kind": "extension", "id": "extension-1" },
                    "destination": {
                        "protocol": "https",
                        "host": "api.example.test",
                        "port": 443
                    },
                    "traceId": "trace-record"
                }),
            ),
            1710000000122,
        );

        match previous_log_path {
            Some(path) => std::env::set_var("EFFECT_DESKTOP_EGRESS_POLICY_LOG", path),
            None => std::env::remove_var("EFFECT_DESKTOP_EGRESS_POLICY_LOG"),
        }

        assert_eq!(
            frames,
            vec![
                HostProtocolEnvelope::Event {
                    method: host_protocol::EGRESS_POLICY_DECISION_RECORDED_EVENT.to_string(),
                    timestamp: 1710000000122,
                    trace_id: "trace-request-egress-policy-record".to_string(),
                    window_id: None,
                    payload: Some(serde_json::json!({
                    "type": "decision-recorded",
                    "timestamp": 1_710_000_000_122_u64,
                        "decision": {
                            "decisionId": decision_id,
                            "outcome": "denied",
                            "actor": { "kind": "extension", "id": "extension-1" },
                            "destination": {
                                "protocol": "https",
                            "host": "api.example.test",
                            "port": 443
                            },
                            "rule": {
                                "id": "default-deny",
                                "effect": "deny",
                                "hosts": ["*"],
                                "reason": "no matching egress allow rule"
                            },
                            "reason": "no matching egress allow rule"
                        }
                    })),
                },
                HostProtocolEnvelope::Response {
                    id: "request-egress-policy-record".to_string(),
                    timestamp: 1710000000122,
                    trace_id: "trace-request-egress-policy-record".to_string(),
                    payload: Some(serde_json::json!({
                        "decisionId": decision_id,
                        "recorded": true
                    })),
                    error: None,
                },
            ]
        );
        assert!(log_path.exists());

        fs::remove_dir_all(dir).expect("temp dir should be removed");
    }

    #[test]
    fn execution_sandbox_create_routes_to_typed_unsupported() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-execution-sandbox-create",
                    host_protocol::EXECUTION_SANDBOX_CREATE_METHOD,
                    execution_sandbox_create_payload(),
                ),
                1710000000121,
            )
            .expect("execution sandbox request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-execution-sandbox-create".to_string(),
                timestamp: 1710000000121,
                trace_id: "trace-request-execution-sandbox-create".to_string(),
                payload: None,
                error: Some(HostProtocolError::unsupported(
                    host_protocol::EXECUTION_SANDBOX_UNSUPPORTED_REASON,
                    host_protocol::EXECUTION_SANDBOX_CREATE_METHOD,
                )),
            }
        );
    }

    #[test]
    fn execution_sandbox_invalid_payload_returns_invalid_argument_before_unsupported() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-execution-sandbox-invalid",
                    host_protocol::EXECUTION_SANDBOX_CREATE_METHOD,
                    serde_json::json!({
                        "actor": { "kind": "extension", "id": "extension-1" },
                        "policy": {
                            "cwd": "/tmp/app",
                            "budgets": {
                                "cpuMillis": 0,
                                "memoryBytes": 67108864,
                                "wallClockMillis": 1000,
                                "stdoutBytes": 1024,
                                "stderrBytes": 1024
                            },
                            "cleanup": {
                                "killProcessTree": true,
                                "removeWorkingDirectory": true
                            }
                        }
                    }),
                ),
                1710000000122,
            )
            .expect("execution sandbox request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-execution-sandbox-invalid".to_string(),
                timestamp: 1710000000122,
                trace_id: "trace-request-execution-sandbox-invalid".to_string(),
                payload: None,
                error: Some(HostProtocolError::invalid_argument(
                    "policy.budgets.cpuMillis",
                    "must be greater than zero",
                    host_protocol::EXECUTION_SANDBOX_CREATE_METHOD,
                )),
            }
        );
    }

    #[test]
    fn execution_sandbox_is_supported_reports_unimplemented_adapter() {
        let response = test_router()
            .dispatch_at(
                request(
                    "request-execution-sandbox-supported",
                    host_protocol::EXECUTION_SANDBOX_IS_SUPPORTED_METHOD,
                ),
                1710000000123,
            )
            .expect("execution sandbox support request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-execution-sandbox-supported".to_string(),
                timestamp: 1710000000123,
                trace_id: "trace-request-execution-sandbox-supported".to_string(),
                payload: Some(serde_json::json!({
                    "supported": false,
                    "reason": host_protocol::EXECUTION_SANDBOX_UNSUPPORTED_REASON
                })),
                error: None,
            }
        );
    }

    #[test]
    fn extension_config_read_routes_response_and_native_event() {
        let frames = with_extension_config_store("extension-config-read-route", || {
            test_router().dispatch_frames_at(
                request_with_payload(
                    "request-extension-config-read",
                    host_protocol::EXTENSION_CONFIG_READ_METHOD,
                    extension_config_read_payload(),
                ),
                1710000000124,
            )
        });

        assert_eq!(
            frames,
            vec![
                HostProtocolEnvelope::Event {
                    method: host_protocol::EXTENSION_CONFIG_EVENT.to_string(),
                    timestamp: 1710000000124,
                    trace_id: "trace-request-extension-config-read".to_string(),
                    window_id: None,
                    payload: Some(serde_json::json!({
                        "type": "extension-config-event",
                        "timestamp": 1_710_000_000_124_u64,
                        "extensionId": "extension-1",
                        "phase": "read",
                        "keys": ["theme", "apiKey"],
                        "revision": 0
                    })),
                },
                HostProtocolEnvelope::Response {
                    id: "request-extension-config-read".to_string(),
                    timestamp: 1710000000124,
                    trace_id: "trace-request-extension-config-read".to_string(),
                    payload: Some(serde_json::json!({
                        "extensionId": "extension-1",
                        "values": [{ "key": "theme", "value": "light" }],
                        "secrets": [{ "key": "apiKey", "present": false }],
                        "revision": 0
                    })),
                    error: None,
                },
            ]
        );
    }

    #[test]
    fn extension_config_write_routes_response_and_native_event() {
        let frames = with_extension_config_store("extension-config-write-route", || {
            test_router().dispatch_frames_at(
                request_with_payload(
                    "request-extension-config-write",
                    host_protocol::EXTENSION_CONFIG_WRITE_METHOD,
                    extension_config_write_payload(),
                ),
                1710000000125,
            )
        });

        assert_eq!(
            frames,
            vec![
                HostProtocolEnvelope::Event {
                    method: host_protocol::EXTENSION_CONFIG_EVENT.to_string(),
                    timestamp: 1710000000125,
                    trace_id: "trace-request-extension-config-write".to_string(),
                    window_id: None,
                    payload: Some(serde_json::json!({
                        "type": "extension-config-event",
                        "timestamp": 1_710_000_000_125_u64,
                        "extensionId": "extension-1",
                        "phase": "written",
                        "keys": ["theme", "apiKey"],
                        "revision": 1
                    })),
                },
                HostProtocolEnvelope::Response {
                    id: "request-extension-config-write".to_string(),
                    timestamp: 1710000000125,
                    trace_id: "trace-request-extension-config-write".to_string(),
                    payload: Some(serde_json::json!({
                        "extensionId": "extension-1",
                        "writtenKeys": ["theme", "apiKey"],
                        "revision": 1
                    })),
                    error: None,
                },
            ]
        );
    }

    #[test]
    fn extension_config_reset_routes_response_and_native_event() {
        let frames = with_extension_config_store("extension-config-reset-route", || {
            test_router().dispatch_frames_at(
                request_with_payload(
                    "request-extension-config-reset",
                    host_protocol::EXTENSION_CONFIG_RESET_METHOD,
                    extension_config_reset_payload(),
                ),
                1710000000126,
            )
        });

        assert_eq!(
            frames,
            vec![
                HostProtocolEnvelope::Event {
                    method: host_protocol::EXTENSION_CONFIG_EVENT.to_string(),
                    timestamp: 1710000000126,
                    trace_id: "trace-request-extension-config-reset".to_string(),
                    window_id: None,
                    payload: Some(serde_json::json!({
                        "type": "extension-config-event",
                        "timestamp": 1_710_000_000_126_u64,
                        "extensionId": "extension-1",
                        "phase": "reset",
                        "keys": ["theme", "apiKey"],
                        "revision": 1
                    })),
                },
                HostProtocolEnvelope::Response {
                    id: "request-extension-config-reset".to_string(),
                    timestamp: 1710000000126,
                    trace_id: "trace-request-extension-config-reset".to_string(),
                    payload: Some(serde_json::json!({
                        "extensionId": "extension-1",
                        "resetKeys": ["theme", "apiKey"],
                        "revision": 1
                    })),
                    error: None,
                },
            ]
        );
    }

    #[test]
    fn extension_config_redact_routes_response_and_native_event() {
        let frames = with_extension_config_store("extension-config-redact-route", || {
            test_router().dispatch_frames_at(
                request_with_payload(
                    "request-extension-config-redact",
                    host_protocol::EXTENSION_CONFIG_REDACT_METHOD,
                    extension_config_read_payload(),
                ),
                1710000000127,
            )
        });

        assert_eq!(
            frames,
            vec![
                HostProtocolEnvelope::Event {
                    method: host_protocol::EXTENSION_CONFIG_EVENT.to_string(),
                    timestamp: 1710000000127,
                    trace_id: "trace-request-extension-config-redact".to_string(),
                    window_id: None,
                    payload: Some(serde_json::json!({
                        "type": "extension-config-event",
                        "timestamp": 1_710_000_000_127_u64,
                        "extensionId": "extension-1",
                        "phase": "redacted",
                        "keys": ["theme", "apiKey"]
                    })),
                },
                HostProtocolEnvelope::Response {
                    id: "request-extension-config-redact".to_string(),
                    timestamp: 1710000000127,
                    trace_id: "trace-request-extension-config-redact".to_string(),
                    payload: Some(serde_json::json!({
                        "extensionId": "extension-1",
                        "values": [
                            { "key": "theme", "value": "light" },
                            { "key": "apiKey", "value": "<redacted:ExtensionConfigSecret>" }
                        ],
                        "redactions": [{ "key": "apiKey", "reason": "secret-field" }]
                    })),
                    error: None,
                },
            ]
        );
    }

    #[test]
    fn extension_config_invalid_payload_returns_invalid_argument_before_unsupported() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-extension-config-invalid",
                    host_protocol::EXTENSION_CONFIG_WRITE_METHOD,
                    serde_json::json!({
                        "actor": { "kind": "extension", "id": "extension-1" },
                        "extensionId": "extension-1",
                        "fields": [{ "key": "enabled", "valueType": "boolean", "secret": false }],
                        "values": [{ "key": "enabled", "value": "yes" }]
                    }),
                ),
                1710000000125,
            )
            .expect("extension config request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-extension-config-invalid".to_string(),
                timestamp: 1710000000125,
                trace_id: "trace-request-extension-config-invalid".to_string(),
                payload: None,
                error: Some(HostProtocolError::invalid_argument(
                    "values.value",
                    "does not match declared field type",
                    host_protocol::EXTENSION_CONFIG_WRITE_METHOD,
                )),
            }
        );
    }

    #[test]
    fn extension_config_is_supported_reports_store_availability() {
        let response = with_extension_config_store("extension-config-supported-route", || {
            test_router()
                .dispatch_at(
                    request(
                        "request-extension-config-supported",
                        host_protocol::EXTENSION_CONFIG_IS_SUPPORTED_METHOD,
                    ),
                    1710000000126,
                )
                .expect("extension config support request should return response")
        });

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-extension-config-supported".to_string(),
                timestamp: 1710000000126,
                trace_id: "trace-request-extension-config-supported".to_string(),
                payload: Some(serde_json::json!({ "supported": true })),
                error: None,
            }
        );
    }

    #[test]
    fn extension_package_install_routes_with_event_and_response() {
        let frames = with_extension_package_store("extension-package-install-route", |source| {
            test_router().dispatch_frames_at(
                request_with_payload(
                    "request-extension-package-install",
                    host_protocol::EXTENSION_PACKAGE_INSTALL_METHOD,
                    extension_package_install_payload(source),
                ),
                1710000000127,
            )
        });

        assert_eq!(
            frames,
            vec![
                HostProtocolEnvelope::Event {
                    method: host_protocol::EXTENSION_PACKAGE_EVENT.to_string(),
                    timestamp: 1710000000127,
                    trace_id: "trace-request-extension-package-install".to_string(),
                    window_id: None,
                    payload: Some(serde_json::json!({
                        "type": "extension-package-event",
                        "timestamp": 1710000000127_u64,
                        "packageId": "extension-1",
                        "phase": "installed",
                        "version": "1.0.0",
                        "revision": 1
                    })),
                },
                HostProtocolEnvelope::Response {
                    id: "request-extension-package-install".to_string(),
                    timestamp: 1710000000127,
                    trace_id: "trace-request-extension-package-install".to_string(),
                    payload: Some(serde_json::json!({
                        "packageId": "extension-1",
                        "version": "1.0.0",
                        "revision": 1,
                        "registeredCapabilities": [
                            {
                                "kind": "filesystem.read",
                                "roots": ["/tmp/extensions"],
                                "audit": "always"
                            }
                        ]
                    })),
                    error: None,
                }
            ]
        );
    }

    #[test]
    fn extension_package_invalid_payload_returns_invalid_argument_before_unsupported() {
        let mut payload =
            extension_package_install_payload(Path::new("/tmp/extensions/extension-1"));
        payload["manifest"]["entrypoint"] = serde_json::json!("../escape.js");
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-extension-package-invalid",
                    host_protocol::EXTENSION_PACKAGE_INSTALL_METHOD,
                    payload,
                ),
                1710000000128,
            )
            .expect("extension package request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-extension-package-invalid".to_string(),
                timestamp: 1710000000128,
                trace_id: "trace-request-extension-package-invalid".to_string(),
                payload: None,
                error: Some(HostProtocolError::invalid_argument(
                    "manifest.entrypoint",
                    "must stay inside the package",
                    host_protocol::EXTENSION_PACKAGE_INSTALL_METHOD,
                )),
            }
        );
    }

    #[test]
    fn extension_package_is_supported_reports_store_availability() {
        let response =
            with_extension_package_store("extension-package-supported-route", |_source| {
                test_router()
                    .dispatch_at(
                        request(
                            "request-extension-package-supported",
                            host_protocol::EXTENSION_PACKAGE_IS_SUPPORTED_METHOD,
                        ),
                        1710000000129,
                    )
                    .expect("extension package support request should return response")
            });

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-extension-package-supported".to_string(),
                timestamp: 1710000000129,
                trace_id: "trace-request-extension-package-supported".to_string(),
                payload: Some(serde_json::json!({
                    "supported": true
                })),
                error: None,
            }
        );
    }

    #[test]
    fn local_tool_runtime_register_routes_to_supported_adapter_with_events() {
        let root = temp_dir("local-tool-runtime-route-register");
        let frames = test_router().dispatch_frames_at(
            request_with_payload(
                "request-local-tool-runtime-register",
                host_protocol::LOCAL_TOOL_RUNTIME_REGISTER_METHOD,
                local_tool_runtime_register_payload(&root, "runtime-route-register"),
            ),
            1710000000130,
        );

        assert_eq!(frames.len(), 2);
        assert!(matches!(
            &frames[0],
            HostProtocolEnvelope::Event { method, payload, .. }
                if method == host_protocol::LOCAL_TOOL_RUNTIME_EVENT
                    && payload
                        .as_ref()
                        .and_then(|payload| payload.get("phase"))
                        .and_then(serde_json::Value::as_str)
                        == Some("registered")
        ));
        assert!(matches!(
            &frames[1],
            HostProtocolEnvelope::Response {
                id,
                timestamp: 1710000000130,
                error: None,
                ..
            } if id == "request-local-tool-runtime-register"
        ));
    }

    #[test]
    fn local_tool_runtime_run_routes_to_supported_adapter_with_events() {
        let root = temp_dir("local-tool-runtime-route-run");
        let router = test_router();
        let _ = router.dispatch_frames_at(
            request_with_payload(
                "request-local-tool-runtime-register-run",
                host_protocol::LOCAL_TOOL_RUNTIME_REGISTER_METHOD,
                local_tool_runtime_register_payload(&root, "runtime-route-run"),
            ),
            1710000000130,
        );

        let frames = router.dispatch_frames_at(
            request_with_payload(
                "request-local-tool-runtime-run",
                host_protocol::LOCAL_TOOL_RUNTIME_RUN_METHOD,
                serde_json::json!({
                    "runtimeId": "runtime-route-run",
                    "commandId": "help",
                    "runId": "run-route"
                }),
            ),
            1710000000131,
        );

        assert_eq!(frames.len(), 3);
        assert!(matches!(
            &frames[0],
            HostProtocolEnvelope::Event { method, payload, .. }
                if method == host_protocol::LOCAL_TOOL_RUNTIME_EVENT
                    && payload
                        .as_ref()
                        .and_then(|payload| payload.get("phase"))
                        .and_then(serde_json::Value::as_str)
                        == Some("run-started")
                    && payload
                        .as_ref()
                        .and_then(|payload| payload.get("status"))
                        .is_none()
        ));
        assert!(matches!(
            &frames[1],
            HostProtocolEnvelope::Event { method, payload, .. }
                if method == host_protocol::LOCAL_TOOL_RUNTIME_EVENT
                    && payload
                        .as_ref()
                        .and_then(|payload| payload.get("phase"))
                        .and_then(serde_json::Value::as_str)
                        == Some("run-completed")
                    && payload
                        .as_ref()
                        .and_then(|payload| payload.get("status"))
                        .and_then(serde_json::Value::as_str)
                        == Some("completed")
        ));
        assert!(matches!(
            &frames[2],
            HostProtocolEnvelope::Response {
                id,
                payload: Some(payload),
                error: None,
                ..
            } if id == "request-local-tool-runtime-run"
                && payload.get("status").and_then(serde_json::Value::as_str) == Some("completed")
        ));
    }

    #[test]
    fn local_tool_runtime_invalid_payload_returns_invalid_argument_before_unsupported() {
        let root = temp_dir("local-tool-runtime-route-invalid");
        let mut payload = local_tool_runtime_register_payload(&root, "runtime-route-invalid");
        payload["manifest"]["commands"][0]["executable"] = serde_json::json!("/usr/bin/node;rm");
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-local-tool-runtime-invalid",
                    host_protocol::LOCAL_TOOL_RUNTIME_REGISTER_METHOD,
                    payload,
                ),
                1710000000131,
            )
            .expect("local tool runtime request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-local-tool-runtime-invalid".to_string(),
                timestamp: 1710000000131,
                trace_id: "trace-request-local-tool-runtime-invalid".to_string(),
                payload: None,
                error: Some(HostProtocolError::invalid_argument(
                    "manifest.commands.executable",
                    "contains shell metacharacters",
                    host_protocol::LOCAL_TOOL_RUNTIME_REGISTER_METHOD,
                )),
            }
        );
    }

    #[test]
    fn local_tool_runtime_is_supported_reports_host_adapter() {
        let response = test_router()
            .dispatch_at(
                request(
                    "request-local-tool-runtime-supported",
                    host_protocol::LOCAL_TOOL_RUNTIME_IS_SUPPORTED_METHOD,
                ),
                1710000000132,
            )
            .expect("local tool runtime support request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-local-tool-runtime-supported".to_string(),
                timestamp: 1710000000132,
                trace_id: "trace-request-local-tool-runtime-supported".to_string(),
                payload: Some(
                    if cfg!(any(
                        target_os = "macos",
                        target_os = "linux",
                        target_os = "windows"
                    )) {
                        serde_json::json!({ "supported": true })
                    } else {
                        serde_json::json!({
                            "supported": false,
                            "reason": "local-tool-runtime-platform-unsupported"
                        })
                    }
                ),
                error: None,
            }
        );
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    #[test]
    fn local_tool_runtime_unsupported_platform_operations_return_typed_failures() {
        let root = temp_dir("local-tool-runtime-route-unsupported");
        let cases = [
            (
                host_protocol::LOCAL_TOOL_RUNTIME_REGISTER_METHOD,
                local_tool_runtime_register_payload(&root, "runtime-route-unsupported"),
            ),
            (
                host_protocol::LOCAL_TOOL_RUNTIME_RUN_METHOD,
                serde_json::json!({
                    "runtimeId": "runtime-route-unsupported",
                    "commandId": "node-version",
                    "runId": "run-route-unsupported"
                }),
            ),
            (
                host_protocol::LOCAL_TOOL_RUNTIME_STOP_METHOD,
                serde_json::json!({ "runtimeId": "runtime-route-unsupported" }),
            ),
            (
                host_protocol::LOCAL_TOOL_RUNTIME_HEALTH_METHOD,
                serde_json::json!({ "runtimeId": "runtime-route-unsupported" }),
            ),
        ];

        for (method, payload) in cases {
            let response = test_router()
                .dispatch_at(
                    request_with_payload("request-local-tool-runtime-unsupported", method, payload),
                    1710000000133,
                )
                .expect("local tool runtime request should return response");

            assert!(matches!(
                response,
                HostProtocolEnvelope::Response {
                    error: Some(HostProtocolError::Unsupported { reason, .. }),
                    ..
                } if reason == "local-tool-runtime-platform-unsupported"
            ));
        }
    }

    #[test]
    fn workspace_index_open_routes_to_supported_adapter_with_events() {
        let workspace = temp_dir("workspace-index-route");
        fs::create_dir_all(workspace.join("src")).expect("src dir");
        fs::write(workspace.join("src/main.ts"), b"export {}\n").expect("source file");

        let frames = test_router().dispatch_frames_at(
            request_with_payload(
                "request-workspace-index-open",
                host_protocol::WORKSPACE_INDEX_OPEN_METHOD,
                workspace_index_open_payload(&workspace),
            ),
            1710000000133,
        );

        assert!(matches!(
            frames.first(),
            Some(HostProtocolEnvelope::Event { method, payload, .. })
                if method == host_protocol::WORKSPACE_INDEX_EVENT
                    && payload.as_ref().is_some_and(|payload| payload["phase"] == "opened")
        ));
        assert_eq!(
            frames.last(),
            Some(&HostProtocolEnvelope::Response {
                id: "request-workspace-index-open".to_string(),
                timestamp: 1710000000133,
                trace_id: "trace-request-workspace-index-open".to_string(),
                payload: Some(serde_json::json!({
                    "indexId": "workspace-index-1",
                    "root": workspace.display().to_string(),
                    "state": "opened"
                })),
                error: None,
            })
        );
    }

    #[test]
    fn workspace_index_invalid_payload_returns_invalid_argument_before_unsupported() {
        let mut payload = workspace_index_open_payload(&temp_dir("workspace-index-invalid"));
        payload["scope"]["root"] = serde_json::json!("workspace/app");
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-workspace-index-invalid",
                    host_protocol::WORKSPACE_INDEX_OPEN_METHOD,
                    payload,
                ),
                1710000000134,
            )
            .expect("workspace index request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-workspace-index-invalid".to_string(),
                timestamp: 1710000000134,
                trace_id: "trace-request-workspace-index-invalid".to_string(),
                payload: None,
                error: Some(HostProtocolError::invalid_argument(
                    "scope.root",
                    "must be an absolute path",
                    host_protocol::WORKSPACE_INDEX_OPEN_METHOD,
                )),
            }
        );
    }

    #[test]
    fn workspace_index_is_supported_reports_supported_adapter() {
        let response = test_router()
            .dispatch_at(
                request(
                    "request-workspace-index-supported",
                    host_protocol::WORKSPACE_INDEX_IS_SUPPORTED_METHOD,
                ),
                1710000000135,
            )
            .expect("workspace index support request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-workspace-index-supported".to_string(),
                timestamp: 1710000000135,
                trace_id: "trace-request-workspace-index-supported".to_string(),
                payload: Some(serde_json::json!({ "supported": true })),
                error: None,
            }
        );
    }

    #[test]
    fn native_file_system_methods_route_to_fail_closed_adapter() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-native-file-system-open",
                    host_protocol::NATIVE_FILE_SYSTEM_OPEN_METHOD,
                    serde_json::json!({
                        "path": { "path": "/tmp/report.txt" },
                        "mode": "read"
                    }),
                ),
                1710000000136,
            )
            .expect("native filesystem request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-native-file-system-open".to_string(),
                timestamp: 1710000000136,
                trace_id: "trace-request-native-file-system-open".to_string(),
                payload: None,
                error: Some(HostProtocolError::unsupported(
                    host_protocol::NATIVE_FILE_SYSTEM_UNSUPPORTED_REASON,
                    host_protocol::NATIVE_FILE_SYSTEM_OPEN_METHOD,
                )),
            }
        );
    }

    #[test]
    fn native_file_system_invalid_payload_returns_invalid_argument_before_unsupported() {
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-native-file-system-invalid",
                    host_protocol::NATIVE_FILE_SYSTEM_WATCH_METHOD,
                    serde_json::json!({
                        "path": { "path": "workspace/app" },
                        "watchId": "watch-1"
                    }),
                ),
                1710000000137,
            )
            .expect("native filesystem request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-native-file-system-invalid".to_string(),
                timestamp: 1710000000137,
                trace_id: "trace-request-native-file-system-invalid".to_string(),
                payload: None,
                error: Some(HostProtocolError::invalid_argument(
                    "path",
                    "must be an absolute path without dot segments",
                    host_protocol::NATIVE_FILE_SYSTEM_WATCH_METHOD,
                )),
            }
        );
    }

    #[test]
    fn native_file_system_is_supported_reports_unsupported_adapter() {
        let response = test_router()
            .dispatch_at(
                request(
                    "request-native-file-system-supported",
                    host_protocol::NATIVE_FILE_SYSTEM_IS_SUPPORTED_METHOD,
                ),
                1710000000138,
            )
            .expect("native filesystem support request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-native-file-system-supported".to_string(),
                timestamp: 1710000000138,
                trace_id: "trace-request-native-file-system-supported".to_string(),
                payload: Some(serde_json::json!({
                    "supported": false,
                    "reason": host_protocol::NATIVE_FILE_SYSTEM_UNSUPPORTED_REASON
                })),
                error: None,
            }
        );
    }

    #[test]
    fn transactional_file_mutation_prepare_routes_to_supported_adapter() {
        let path = temp_file("transactional-file-mutation-route", b"source\n");
        let mut payload = transactional_file_mutation_prepare_payload();
        payload["path"] = serde_json::json!(path.display().to_string());
        payload["expectedSourceHash"] = serde_json::json!("fnv1a-991ed596");
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-file-mutation-prepare",
                    host_protocol::TRANSACTIONAL_FILE_MUTATION_PREPARE_METHOD,
                    payload,
                ),
                1710000000136,
            )
            .expect("transactional file mutation request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-file-mutation-prepare".to_string(),
                timestamp: 1710000000136,
                trace_id: "trace-request-file-mutation-prepare".to_string(),
                payload: Some(serde_json::json!({
                    "mutationId": "file-mutation-1",
                    "path": path.display().to_string(),
                    "state": "prepared",
                    "ownerScope": "transactional-file-mutation-workspace-workspace-1",
                    "sourceHash": "fnv1a-991ed596",
                    "replacementHash": "fnv1a-d5615ac6",
                    "diff": {
                        "format": "unified",
                        "text": format!(
                            "--- {}\n+++ {}\n@@ -1,2 +1,2 @@\n-source\n-\n+next\n+",
                            path.display(),
                            path.display()
                        ),
                        "additions": 2,
                        "deletions": 2
                    }
                })),
                error: None,
            }
        );
        let _ = test_router().dispatch_at(
            request_with_payload(
                "request-file-mutation-cleanup",
                host_protocol::TRANSACTIONAL_FILE_MUTATION_ROLLBACK_METHOD,
                serde_json::json!({
                    "actor": { "kind": "workspace", "id": "workspace-1" },
                    "mutationId": "file-mutation-1"
                }),
            ),
            1710000000139,
        );
        cleanup_path(path);
    }

    #[test]
    fn transactional_file_mutation_invalid_payload_returns_invalid_argument_before_host_work() {
        let mut payload = transactional_file_mutation_prepare_payload();
        payload["path"] = serde_json::json!("workspace/app/src/main.ts");
        let response = test_router()
            .dispatch_at(
                request_with_payload(
                    "request-file-mutation-invalid",
                    host_protocol::TRANSACTIONAL_FILE_MUTATION_PREPARE_METHOD,
                    payload,
                ),
                1710000000137,
            )
            .expect("transactional file mutation request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-file-mutation-invalid".to_string(),
                timestamp: 1710000000137,
                trace_id: "trace-request-file-mutation-invalid".to_string(),
                payload: None,
                error: Some(HostProtocolError::invalid_argument(
                    "path",
                    "must be an absolute path",
                    host_protocol::TRANSACTIONAL_FILE_MUTATION_PREPARE_METHOD,
                )),
            }
        );
    }

    #[test]
    fn transactional_file_mutation_is_supported_reports_supported_adapter() {
        let response = test_router()
            .dispatch_at(
                request(
                    "request-file-mutation-supported",
                    host_protocol::TRANSACTIONAL_FILE_MUTATION_IS_SUPPORTED_METHOD,
                ),
                1710000000138,
            )
            .expect("transactional file mutation support request should return response");

        assert_eq!(
            response,
            HostProtocolEnvelope::Response {
                id: "request-file-mutation-supported".to_string(),
                timestamp: 1710000000138,
                trace_id: "trace-request-file-mutation-supported".to_string(),
                payload: Some(serde_json::json!({
                    "supported": true
                })),
                error: None,
            }
        );
    }

    fn request(id: &str, method: &str) -> HostProtocolEnvelope {
        request_with_payload(id, method, serde_json::Value::Null)
    }

    fn request_with_payload(
        id: &str,
        method: &str,
        payload: serde_json::Value,
    ) -> HostProtocolEnvelope {
        HostProtocolEnvelope::Request {
            id: id.to_string(),
            method: method.to_string(),
            timestamp: 1710000000000,
            trace_id: format!("trace-{id}"),
            window_id: None,
            origin_token: None,
            payload: if payload.is_null() {
                None
            } else {
                Some(payload)
            },
        }
    }

    fn test_router() -> HostMethodRouter {
        HostMethodRouter::new(Arc::new(FakeWindowHandler::new(
            Ok(WindowCreateResponse::new("window-test")),
            Ok(()),
        )))
    }

    fn declared_host_protocol_methods() -> Vec<String> {
        let source = include_str!("../../../host-protocol/src/lib.rs");
        let mut declarations = Vec::new();
        let mut current = String::new();
        for line in source.lines() {
            if current.is_empty() {
                let is_method_constant = line.starts_with("pub const ") && line.contains("_METHOD");
                if !is_method_constant {
                    continue;
                }
            }
            current.push_str(line);
            if line.ends_with(';') {
                if let Some(method) = method_literal(&current) {
                    declarations.push(method);
                }
                current.clear();
            }
        }
        declarations
    }

    fn method_literal(declaration: &str) -> Option<String> {
        let start = declaration.find('"')? + 1;
        let end = declaration[start..].find('"')? + start;
        Some(declaration[start..end].to_string())
    }

    fn transient_window_role_handle() -> serde_json::Value {
        serde_json::json!({
            "kind": "transient-window-role",
            "id": "palette-1",
            "generation": 0,
            "ownerScope": "workspace:workspace-1",
            "state": "open"
        })
    }

    fn egress_policy_decision_id(response: &HostProtocolEnvelope) -> String {
        let HostProtocolEnvelope::Response {
            payload: Some(payload),
            error: None,
            ..
        } = response
        else {
            panic!("egress policy decision response should be successful");
        };

        payload
            .get("decisionId")
            .and_then(serde_json::Value::as_str)
            .expect("egress policy decision response should include decisionId")
            .to_string()
    }

    fn unique_temp_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time should be after epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("effect-desktop-method-router-{nanos}-{name}"))
    }

    fn execution_sandbox_create_payload() -> serde_json::Value {
        serde_json::json!({
            "actor": { "kind": "extension", "id": "extension-1" },
            "policy": {
                "cwd": "/tmp/app",
                "filesystem": {
                    "readRoots": ["/tmp/app"],
                    "writeRoots": ["/tmp/app/out"]
                },
                "network": {
                    "hosts": ["api.example.test"]
                },
                "budgets": {
                    "cpuMillis": 500,
                    "memoryBytes": 67108864,
                    "wallClockMillis": 1000,
                    "stdoutBytes": 1024,
                    "stderrBytes": 1024
                },
                "cleanup": {
                    "killProcessTree": true,
                    "removeWorkingDirectory": true
                }
            },
            "sandboxId": "sandbox-1",
            "traceId": "trace-sandbox"
        })
    }

    fn extension_config_read_payload() -> serde_json::Value {
        serde_json::json!({
            "actor": { "kind": "extension", "id": "extension-1" },
            "extensionId": "extension-1",
            "fields": [
                {
                    "key": "theme",
                    "valueType": "string",
                    "secret": false,
                    "defaultValue": "light"
                },
                { "key": "apiKey", "valueType": "string", "secret": true }
            ],
            "traceId": "trace-extension-config"
        })
    }

    fn extension_config_write_payload() -> serde_json::Value {
        serde_json::json!({
            "actor": { "kind": "extension", "id": "extension-1" },
            "extensionId": "extension-1",
            "fields": [
                {
                    "key": "theme",
                    "valueType": "string",
                    "secret": false,
                    "defaultValue": "light"
                },
                { "key": "apiKey", "valueType": "string", "secret": true }
            ],
            "values": [{ "key": "theme", "value": "dark" }],
            "secretKeys": ["apiKey"],
            "traceId": "trace-extension-config"
        })
    }

    fn extension_config_reset_payload() -> serde_json::Value {
        serde_json::json!({
            "actor": { "kind": "extension", "id": "extension-1" },
            "extensionId": "extension-1",
            "fields": [
                {
                    "key": "theme",
                    "valueType": "string",
                    "secret": false,
                    "defaultValue": "light"
                },
                { "key": "apiKey", "valueType": "string", "secret": true }
            ],
            "keys": ["theme", "apiKey"],
            "traceId": "trace-extension-config"
        })
    }

    fn with_extension_config_store<T>(name: &str, test: impl FnOnce() -> T) -> T {
        let _guard = super::extension_config::EXTENSION_CONFIG_ENV_LOCK
            .lock()
            .expect("extension config env lock should not be poisoned");
        let dir = unique_temp_dir(name);
        fs::create_dir_all(&dir).expect("temp dir should be created");
        let store_path = dir.join("extension-config.json");
        let previous_store_path = std::env::var_os("EFFECT_DESKTOP_EXTENSION_CONFIG_STORE");
        std::env::set_var("EFFECT_DESKTOP_EXTENSION_CONFIG_STORE", &store_path);
        let result = test();
        match previous_store_path {
            Some(path) => std::env::set_var("EFFECT_DESKTOP_EXTENSION_CONFIG_STORE", path),
            None => std::env::remove_var("EFFECT_DESKTOP_EXTENSION_CONFIG_STORE"),
        }
        let _ = fs::remove_dir_all(dir);
        result
    }

    fn with_extension_package_store<T>(name: &str, test: impl FnOnce(&Path) -> T) -> T {
        let _guard = super::EXTENSION_PACKAGE_ENV_LOCK
            .lock()
            .expect("extension package env lock should not be poisoned");
        let dir = unique_temp_dir(name);
        let source = dir.join("source");
        fs::create_dir_all(source.join("dist")).expect("extension package source should exist");
        fs::write(source.join("dist/main.js"), "export default 1\n")
            .expect("extension package source file should be written");
        let store_path = dir.join("store");
        let previous_store_path = std::env::var_os("EFFECT_DESKTOP_EXTENSION_PACKAGE_STORE");
        std::env::set_var("EFFECT_DESKTOP_EXTENSION_PACKAGE_STORE", &store_path);
        let result = test(&source);
        match previous_store_path {
            Some(path) => std::env::set_var("EFFECT_DESKTOP_EXTENSION_PACKAGE_STORE", path),
            None => std::env::remove_var("EFFECT_DESKTOP_EXTENSION_PACKAGE_STORE"),
        }
        let _ = fs::remove_dir_all(dir);
        result
    }

    fn extension_package_install_payload(source: &Path) -> serde_json::Value {
        serde_json::json!({
            "actor": { "kind": "extension", "id": "extension-1" },
            "source": {
                "kind": "directory",
                "uri": source.to_string_lossy()
            },
            "manifest": {
                "id": "extension-1",
                "name": "Extension One",
                "version": "1.0.0",
                "entrypoint": "dist/main.js",
                "compatibility": {
                    "minHostVersion": "1.0.0",
                    "maxHostVersion": "2.0.0"
                },
                "capabilities": [
                    {
                        "capability": {
                            "kind": "filesystem.read",
                            "roots": ["/tmp/extensions"],
                            "audit": "always"
                        },
                        "reason": "read extension files"
                    }
                ]
            },
            "traceId": "trace-extension-package"
        })
    }

    fn local_tool_runtime_register_payload(root: &Path, runtime_id: &str) -> serde_json::Value {
        let executable = env::current_exe()
            .expect("current test executable")
            .display()
            .to_string();
        let root = root.display().to_string();
        serde_json::json!({
            "actor": { "kind": "extension", "id": "extension-1" },
            "manifest": {
                "toolId": "tool-1",
                "name": "Tool One",
                "version": "1.0.0",
                "commands": [
                    {
                        "commandId": "help",
                        "executable": executable,
                        "defaultArgs": ["--help"],
                        "cwd": root,
                        "timeoutMillis": 5000
                    }
                ],
                "permissions": [
                    {
                        "kind": "process.spawn",
                        "commands": [executable],
                        "cwd": [root],
                        "environment": "none",
                        "shell": false,
                        "audit": "always"
                    }
                ],
                "policy": {
                    "cwd": { "roots": [root] },
                    "environment": { "variables": [] },
                    "filesystem": { "readRoots": [root] },
                    "network": { "hosts": [] },
                    "budgets": {
                        "cpuMillis": 9007199254740991u64,
                        "memoryBytes": 9007199254740991u64,
                        "wallClockMillis": 5000,
                        "stdoutBytes": 65536,
                        "stderrBytes": 65536
                    },
                    "stdio": { "stdout": "capture", "stderr": "capture" },
                    "cleanup": {
                        "killProcessTree": true,
                        "removeWorkingDirectory": false
                    }
                }
            },
            "runtimeId": runtime_id,
            "traceId": "trace-local-tool-runtime"
        })
    }

    fn workspace_index_open_payload(workspace: &Path) -> serde_json::Value {
        serde_json::json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "scope": {
                "root": workspace.display().to_string(),
                "ignoreRules": [
                    { "pattern": "node_modules/**", "reason": "dependencies" }
                ],
                "grants": [
                    {
                        "kind": "filesystem.read",
                        "roots": [workspace.display().to_string()],
                        "audit": "always"
                    }
                ],
                "watch": false
            },
            "indexId": "workspace-index-1",
            "traceId": "trace-workspace-index"
        })
    }

    fn transactional_file_mutation_prepare_payload() -> serde_json::Value {
        serde_json::json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "path": "/workspace/app/src/main.ts",
            "replacementBytes": [110, 101, 120, 116, 10],
            "expectedSourceHash": "fnv1a-source",
            "mutationId": "file-mutation-1",
            "traceId": "trace-file-mutation"
        })
    }

    fn temp_file(name: &str, bytes: &[u8]) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after Unix epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("effect-desktop-methods-{nanos}"));
        fs::create_dir_all(&dir).expect("temp dir should be created");
        let path = dir.join(format!("{name}.txt"));
        fs::write(&path, bytes).expect("temp file should be written");
        path
    }

    fn write_evidence_file(root: &Path, name: &str, capability: &serde_json::Value) -> String {
        let path = root.join(format!("{name}.json"));
        fs::write(
            &path,
            serde_json::json!({
                "kind": name,
                "capabilities": [capability.clone()]
            })
            .to_string(),
        )
        .expect("distribution parity evidence should be written");
        path.display().to_string()
    }

    fn temp_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after Unix epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("effect-desktop-methods-{name}-{nanos}"));
        fs::create_dir_all(&dir).expect("temp dir should be created");
        dir
    }

    fn cleanup_path(path: PathBuf) {
        if let Some(parent) = path.parent() {
            let _ = fs::remove_dir_all(parent);
        }
    }

    pub(crate) struct FakeWindowHandler {
        create_result: Result<WindowCreateResponse, HostProtocolError>,
        destroy_result: Result<(), HostProtocolError>,
        quit: Mutex<Vec<u8>>,
        restarts: Mutex<Vec<Vec<String>>>,
        created: Mutex<Vec<WindowCreateRequest>>,
        shown: Mutex<Vec<String>>,
        hidden: Mutex<Vec<String>>,
        focused: Mutex<Vec<String>>,
        lookup_ids: Mutex<Vec<String>>,
        titles: Mutex<Vec<(String, String)>>,
        resizable: Mutex<Vec<(String, bool)>>,
        decorations: Mutex<Vec<(String, bool)>>,
        shadows: Mutex<Vec<(String, bool)>>,
        always_on_top: Mutex<Vec<(String, bool)>>,
        skip_taskbar: Mutex<Vec<(String, bool)>>,
        progress: Mutex<Vec<host_protocol::WindowSetProgressPayload>>,
        dock_progress: Mutex<Vec<host_protocol::DockSetProgressPayload>>,
        attention: Mutex<Vec<(String, host_protocol::WindowAttentionType)>>,
        attention_cancellations: Mutex<Vec<String>>,
        minimized: Mutex<Vec<String>>,
        maximized: Mutex<Vec<String>>,
        restored: Mutex<Vec<String>>,
        fullscreen: Mutex<Vec<(String, bool)>>,
        simple_fullscreen: Mutex<Vec<(String, bool)>>,
        dock_badge_labels: Mutex<Vec<Option<String>>>,
    }

    impl FakeWindowHandler {
        fn new(
            create_result: Result<WindowCreateResponse, HostProtocolError>,
            destroy_result: Result<(), HostProtocolError>,
        ) -> Self {
            Self {
                create_result,
                destroy_result,
                quit: Mutex::new(Vec::new()),
                restarts: Mutex::new(Vec::new()),
                created: Mutex::new(Vec::new()),
                shown: Mutex::new(Vec::new()),
                hidden: Mutex::new(Vec::new()),
                focused: Mutex::new(Vec::new()),
                lookup_ids: Mutex::new(Vec::new()),
                titles: Mutex::new(Vec::new()),
                resizable: Mutex::new(Vec::new()),
                decorations: Mutex::new(Vec::new()),
                shadows: Mutex::new(Vec::new()),
                always_on_top: Mutex::new(Vec::new()),
                skip_taskbar: Mutex::new(Vec::new()),
                progress: Mutex::new(Vec::new()),
                dock_progress: Mutex::new(Vec::new()),
                attention: Mutex::new(Vec::new()),
                attention_cancellations: Mutex::new(Vec::new()),
                minimized: Mutex::new(Vec::new()),
                maximized: Mutex::new(Vec::new()),
                restored: Mutex::new(Vec::new()),
                fullscreen: Mutex::new(Vec::new()),
                simple_fullscreen: Mutex::new(Vec::new()),
                dock_badge_labels: Mutex::new(Vec::new()),
            }
        }

        fn created(&self) -> Vec<WindowCreateRequest> {
            self.created
                .lock()
                .expect("fake created requests should lock")
                .clone()
        }

        fn quit(&self) -> Vec<u8> {
            self.quit
                .lock()
                .expect("fake quit requests should lock")
                .clone()
        }

        pub(crate) fn restarts(&self) -> Vec<Vec<String>> {
            self.restarts
                .lock()
                .expect("fake restart requests should lock")
                .clone()
        }

        fn dock_badge_labels(&self) -> Vec<Option<String>> {
            self.dock_badge_labels
                .lock()
                .expect("fake dock badge labels should lock")
                .clone()
        }

        fn shown(&self) -> Vec<String> {
            self.shown
                .lock()
                .expect("fake shown requests should lock")
                .clone()
        }

        fn hidden(&self) -> Vec<String> {
            self.hidden
                .lock()
                .expect("fake hidden requests should lock")
                .clone()
        }

        fn focused(&self) -> Vec<String> {
            self.focused
                .lock()
                .expect("fake focused requests should lock")
                .clone()
        }

        fn lookup_ids(&self) -> Vec<String> {
            self.lookup_ids
                .lock()
                .expect("fake lookup requests should lock")
                .clone()
        }

        fn titles(&self) -> Vec<(String, String)> {
            self.titles
                .lock()
                .expect("fake titles requests should lock")
                .clone()
        }

        fn resizable(&self) -> Vec<(String, bool)> {
            self.resizable
                .lock()
                .expect("fake resizable requests should lock")
                .clone()
        }

        fn decorations(&self) -> Vec<(String, bool)> {
            self.decorations
                .lock()
                .expect("fake decorations requests should lock")
                .clone()
        }

        fn shadows(&self) -> Vec<(String, bool)> {
            self.shadows
                .lock()
                .expect("fake shadow requests should lock")
                .clone()
        }

        fn always_on_top(&self) -> Vec<(String, bool)> {
            self.always_on_top
                .lock()
                .expect("fake always on top requests should lock")
                .clone()
        }

        fn skip_taskbar(&self) -> Vec<(String, bool)> {
            self.skip_taskbar
                .lock()
                .expect("fake skip taskbar requests should lock")
                .clone()
        }

        fn progress(&self) -> Vec<host_protocol::WindowSetProgressPayload> {
            self.progress
                .lock()
                .expect("fake progress requests should lock")
                .clone()
        }

        fn dock_progress(&self) -> Vec<host_protocol::DockSetProgressPayload> {
            self.dock_progress
                .lock()
                .expect("fake dock progress requests should lock")
                .clone()
        }

        fn attention(&self) -> Vec<(String, host_protocol::WindowAttentionType)> {
            self.attention
                .lock()
                .expect("fake attention requests should lock")
                .clone()
        }

        fn attention_cancellations(&self) -> Vec<String> {
            self.attention_cancellations
                .lock()
                .expect("fake attention cancellation requests should lock")
                .clone()
        }

        fn minimized(&self) -> Vec<String> {
            self.minimized
                .lock()
                .expect("fake minimized requests should lock")
                .clone()
        }

        fn maximized(&self) -> Vec<String> {
            self.maximized
                .lock()
                .expect("fake maximized requests should lock")
                .clone()
        }

        fn restored(&self) -> Vec<String> {
            self.restored
                .lock()
                .expect("fake restored requests should lock")
                .clone()
        }

        fn fullscreen(&self) -> Vec<(String, bool)> {
            self.fullscreen
                .lock()
                .expect("fake fullscreen requests should lock")
                .clone()
        }

        fn simple_fullscreen(&self) -> Vec<(String, bool)> {
            self.simple_fullscreen
                .lock()
                .expect("fake simple fullscreen requests should lock")
                .clone()
        }
    }

    impl Default for FakeWindowHandler {
        fn default() -> Self {
            Self::new(Ok(WindowCreateResponse::new("window-test")), Ok(()))
        }
    }

    impl WindowMethodHandler for FakeWindowHandler {
        fn quit(&self, exit_code: u8) -> Result<(), HostProtocolError> {
            self.quit
                .lock()
                .expect("fake quit requests should lock")
                .push(exit_code);
            Ok(())
        }

        fn restart(&self, args: &[String]) -> Result<(), HostProtocolError> {
            self.restarts
                .lock()
                .expect("fake restart requests should lock")
                .push(args.to_vec());
            Ok(())
        }

        fn create(
            &self,
            request: WindowCreateRequest,
        ) -> Result<WindowCreateResponse, HostProtocolError> {
            self.created
                .lock()
                .expect("fake created requests should lock")
                .push(request);
            self.create_result.clone()
        }

        fn destroy(&self, _window_id: &str) -> Result<(), HostProtocolError> {
            self.destroy_result.clone()
        }

        fn show(&self, window_id: &str) -> Result<(), HostProtocolError> {
            self.shown
                .lock()
                .expect("fake shown requests should lock")
                .push(window_id.to_string());
            Ok(())
        }

        fn hide(&self, window_id: &str) -> Result<(), HostProtocolError> {
            self.hidden
                .lock()
                .expect("fake hidden requests should lock")
                .push(window_id.to_string());
            Ok(())
        }

        fn focus(&self, window_id: &str) -> Result<(), HostProtocolError> {
            self.focused
                .lock()
                .expect("fake focused requests should lock")
                .push(window_id.to_string());
            Ok(())
        }

        fn get_current(&self) -> Result<host_protocol::WindowLookupResponse, HostProtocolError> {
            Ok(host_protocol::WindowLookupResponse::new("window-current"))
        }

        fn get_by_id(
            &self,
            window_id: &str,
        ) -> Result<host_protocol::WindowLookupResponse, HostProtocolError> {
            self.lookup_ids
                .lock()
                .expect("fake lookup requests should lock")
                .push(window_id.to_string());
            Ok(host_protocol::WindowLookupResponse::new(window_id))
        }

        fn list(&self) -> Result<host_protocol::WindowListResponse, HostProtocolError> {
            Ok(host_protocol::WindowListResponse::new(vec![
                host_protocol::WindowLookupResponse::new("window-1"),
                host_protocol::WindowLookupResponse::new("window-2"),
            ]))
        }

        fn get_parent(
            &self,
            _window_id: &str,
        ) -> Result<host_protocol::WindowParentResponse, HostProtocolError> {
            Ok(host_protocol::WindowParentResponse::new(Some(
                "window-parent".to_string(),
            )))
        }

        fn get_children(
            &self,
            _window_id: &str,
        ) -> Result<host_protocol::WindowListResponse, HostProtocolError> {
            Ok(host_protocol::WindowListResponse::new(vec![
                host_protocol::WindowLookupResponse::new("window-child-1"),
                host_protocol::WindowLookupResponse::new("window-child-2"),
            ]))
        }

        fn get_bounds(&self, _window_id: &str) -> Result<WindowBoundsPayload, HostProtocolError> {
            Ok(WindowBoundsPayload::new(10.0, 20.0, 640.0, 480.0))
        }

        fn set_bounds(
            &self,
            _window_id: &str,
            _bounds: &WindowBoundsPayload,
        ) -> Result<WindowBoundsPayload, HostProtocolError> {
            Ok(WindowBoundsPayload::new(15.0, 25.0, 700.0, 500.0))
        }

        fn set_bounds_on_display(
            &self,
            _window_id: &str,
            _display_id: &str,
            _bounds: &WindowBoundsPayload,
        ) -> Result<WindowBoundsPayload, HostProtocolError> {
            Ok(WindowBoundsPayload::new(15.0, 25.0, 700.0, 500.0))
        }

        fn center(&self, _window_id: &str) -> Result<WindowBoundsPayload, HostProtocolError> {
            Ok(WindowBoundsPayload::new(30.0, 40.0, 640.0, 480.0))
        }

        fn center_on_display(
            &self,
            _window_id: &str,
            _display_id: &str,
        ) -> Result<WindowBoundsPayload, HostProtocolError> {
            Ok(WindowBoundsPayload::new(35.0, 45.0, 640.0, 480.0))
        }

        fn set_title(&self, window_id: &str, title: &str) -> Result<(), HostProtocolError> {
            self.titles
                .lock()
                .expect("fake titles requests should lock")
                .push((window_id.to_string(), title.to_string()));
            Ok(())
        }

        fn set_resizable(&self, window_id: &str, resizable: bool) -> Result<(), HostProtocolError> {
            self.resizable
                .lock()
                .expect("fake resizable requests should lock")
                .push((window_id.to_string(), resizable));
            Ok(())
        }

        fn set_decorations(
            &self,
            window_id: &str,
            decorations: bool,
        ) -> Result<(), HostProtocolError> {
            self.decorations
                .lock()
                .expect("fake decorations requests should lock")
                .push((window_id.to_string(), decorations));
            Ok(())
        }

        fn set_traffic_lights(
            &self,
            _window_id: &str,
            _traffic_lights: &host_protocol::WindowTrafficLights,
        ) -> Result<(), HostProtocolError> {
            Ok(())
        }

        fn set_vibrancy(&self, _window_id: &str, _material: &str) -> Result<(), HostProtocolError> {
            Ok(())
        }

        fn clear_vibrancy(&self, _window_id: &str) -> Result<(), HostProtocolError> {
            Ok(())
        }

        fn set_shadow(&self, window_id: &str, has_shadow: bool) -> Result<(), HostProtocolError> {
            self.shadows
                .lock()
                .expect("fake shadow requests should lock")
                .push((window_id.to_string(), has_shadow));
            Ok(())
        }

        fn set_title_bar_style(
            &self,
            _window_id: &str,
            _title_bar_style: host_protocol::WindowTitleBarStyle,
        ) -> Result<(), HostProtocolError> {
            Ok(())
        }

        fn set_title_bar_transparent(
            &self,
            _window_id: &str,
            _title_bar_transparent: bool,
        ) -> Result<(), HostProtocolError> {
            Ok(())
        }

        fn set_transparent(
            &self,
            _window_id: &str,
            _transparent: bool,
        ) -> Result<(), HostProtocolError> {
            Ok(())
        }

        fn set_always_on_top(
            &self,
            window_id: &str,
            always_on_top: bool,
        ) -> Result<(), HostProtocolError> {
            self.always_on_top
                .lock()
                .expect("fake always on top requests should lock")
                .push((window_id.to_string(), always_on_top));
            Ok(())
        }

        fn set_skip_taskbar(
            &self,
            window_id: &str,
            skip_taskbar: bool,
        ) -> Result<(), HostProtocolError> {
            self.skip_taskbar
                .lock()
                .expect("fake skip taskbar requests should lock")
                .push((window_id.to_string(), skip_taskbar));
            Ok(())
        }

        fn set_progress(
            &self,
            _window_id: &str,
            progress: &host_protocol::WindowSetProgressPayload,
        ) -> Result<(), HostProtocolError> {
            self.progress
                .lock()
                .expect("fake progress requests should lock")
                .push(progress.clone());
            Ok(())
        }

        fn set_dock_progress(
            &self,
            progress: &host_protocol::DockSetProgressPayload,
        ) -> Result<(), HostProtocolError> {
            self.dock_progress
                .lock()
                .expect("fake dock progress requests should lock")
                .push(progress.clone());
            Ok(())
        }

        fn request_attention(
            &self,
            window_id: &str,
            request_type: host_protocol::WindowAttentionType,
        ) -> Result<(), HostProtocolError> {
            self.attention
                .lock()
                .expect("fake attention requests should lock")
                .push((window_id.to_string(), request_type));
            Ok(())
        }

        fn cancel_attention(&self, window_id: &str) -> Result<(), HostProtocolError> {
            self.attention_cancellations
                .lock()
                .expect("fake attention cancellation requests should lock")
                .push(window_id.to_string());
            Ok(())
        }

        fn minimize(
            &self,
            window_id: &str,
        ) -> Result<host_protocol::WindowStatePayload, HostProtocolError> {
            self.minimized
                .lock()
                .expect("fake minimized requests should lock")
                .push(window_id.to_string());
            Ok(host_protocol::WindowStatePayload::new(
                false, false, false, false,
            ))
        }

        fn maximize(
            &self,
            window_id: &str,
        ) -> Result<host_protocol::WindowStatePayload, HostProtocolError> {
            self.maximized
                .lock()
                .expect("fake maximized requests should lock")
                .push(window_id.to_string());
            Ok(host_protocol::WindowStatePayload::new(
                false, false, false, false,
            ))
        }

        fn restore(
            &self,
            window_id: &str,
        ) -> Result<host_protocol::WindowStatePayload, HostProtocolError> {
            self.restored
                .lock()
                .expect("fake restored requests should lock")
                .push(window_id.to_string());
            Ok(host_protocol::WindowStatePayload::new(
                false, false, false, false,
            ))
        }

        fn set_fullscreen(
            &self,
            window_id: &str,
            fullscreen: bool,
        ) -> Result<host_protocol::WindowStatePayload, HostProtocolError> {
            self.fullscreen
                .lock()
                .expect("fake fullscreen requests should lock")
                .push((window_id.to_string(), fullscreen));
            Ok(host_protocol::WindowStatePayload::new(
                false, false, false, false,
            ))
        }

        fn set_simple_fullscreen(
            &self,
            window_id: &str,
            simple_fullscreen: bool,
        ) -> Result<host_protocol::WindowStatePayload, HostProtocolError> {
            self.simple_fullscreen
                .lock()
                .expect("fake simple fullscreen requests should lock")
                .push((window_id.to_string(), simple_fullscreen));
            Ok(host_protocol::WindowStatePayload::new(
                false, false, false, false,
            ))
        }

        fn get_state(
            &self,
            _window_id: &str,
        ) -> Result<host_protocol::WindowStatePayload, HostProtocolError> {
            Ok(host_protocol::WindowStatePayload::new(
                false, false, false, false,
            ))
        }

        fn set_dock_badge_label(
            &self,
            label: Option<String>,
            _operation: &'static str,
        ) -> Result<(), HostProtocolError> {
            self.dock_badge_labels
                .lock()
                .expect("fake dock badge labels should lock")
                .push(label);
            Ok(())
        }

        fn request_dock_attention(&self, _critical: bool) -> Result<(), HostProtocolError> {
            Ok(())
        }

        fn set_dock_menu(
            &self,
            _template: Option<serde_json::Value>,
        ) -> Result<(), HostProtocolError> {
            Ok(())
        }

        fn set_application_menu(
            &self,
            _template: serde_json::Value,
        ) -> Result<(), HostProtocolError> {
            Ok(())
        }

        fn set_window_menu(
            &self,
            _window_id: &str,
            _template: serde_json::Value,
        ) -> Result<(), HostProtocolError> {
            Ok(())
        }

        fn create_tray(
            &self,
            _request: TrayCreateRequest,
        ) -> Result<host_protocol::TrayResourcePayload, HostProtocolError> {
            Ok(host_protocol::TrayResourcePayload::new(
                "tray-1",
                0,
                "tray:tray-1",
            ))
        }

        fn set_tray_icon(
            &self,
            _tray: &host_protocol::TrayResourcePayload,
            _icon: String,
        ) -> Result<(), HostProtocolError> {
            Ok(())
        }

        fn set_tray_tooltip(
            &self,
            _tray: &host_protocol::TrayResourcePayload,
            _tooltip: String,
        ) -> Result<(), HostProtocolError> {
            Ok(())
        }

        fn set_tray_title(
            &self,
            _tray: &host_protocol::TrayResourcePayload,
            _title: String,
        ) -> Result<(), HostProtocolError> {
            Ok(())
        }

        fn set_tray_menu(
            &self,
            _tray: &host_protocol::TrayResourcePayload,
            _menu: serde_json::Value,
        ) -> Result<(), HostProtocolError> {
            Ok(())
        }

        fn destroy_tray(
            &self,
            _tray: &host_protocol::TrayResourcePayload,
        ) -> Result<(), HostProtocolError> {
            Ok(())
        }

        fn clear_runtime_trays(&self) -> Result<(), HostProtocolError> {
            Ok(())
        }

        fn get_screen_displays(
            &self,
        ) -> Result<host_protocol::ScreenDisplaysResultPayload, HostProtocolError> {
            Ok(host_protocol::ScreenDisplaysResultPayload::new(vec![
                fake_screen_display(true),
            ]))
        }

        fn get_primary_screen_display(
            &self,
        ) -> Result<host_protocol::ScreenDisplayPayload, HostProtocolError> {
            Ok(fake_screen_display(true))
        }

        fn get_screen_pointer_point(
            &self,
        ) -> Result<host_protocol::ScreenPointPayload, HostProtocolError> {
            Ok(host_protocol::ScreenPointPayload::new(12.0, 34.0))
        }

        fn screen_is_supported(
            &self,
            _method: host_protocol::ScreenMethodPayload,
        ) -> Result<host_protocol::ScreenSupportedPayload, HostProtocolError> {
            Ok(host_protocol::ScreenSupportedPayload::supported())
        }
    }

    fn fake_screen_display(primary: bool) -> host_protocol::ScreenDisplayPayload {
        let bounds = host_protocol::ScreenBoundsPayload::new(0.0, 0.0, 1920.0, 1080.0);
        host_protocol::ScreenDisplayPayload::new("display-1", bounds.clone(), bounds, 2.0, primary)
    }
}
