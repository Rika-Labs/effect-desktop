//! Host-runtime protocol wire types.

mod error;

pub use error::{
    HostProtocolError, HostProtocolErrorSpec, HostProtocolPlatform, HOST_PROTOCOL_ERROR_SPECS,
};

use std::collections::BTreeMap;

use serde::{de, ser, Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;

pub const HOST_PING_METHOD: &str = "host.ping";
pub const HOST_VERSION_METHOD: &str = "host.version";
pub const PROTOCOL_VERSION: &str = env!("EFFECT_DESKTOP_HOST_PROTOCOL_VERSION");
pub const APP_QUIT_METHOD: &str = "App.quit";
pub const APP_EXIT_METHOD: &str = "App.exit";
pub const APP_RESTART_METHOD: &str = "App.restart";
pub const APP_RELAUNCH_METHOD: &str = "App.relaunch";
pub const APP_FOCUS_METHOD: &str = "App.focus";
pub const APP_ACTIVATE_METHOD: &str = "App.activate";
pub const APP_REQUEST_SINGLE_INSTANCE_LOCK_METHOD: &str = "App.requestSingleInstanceLock";
pub const APP_RELEASE_SINGLE_INSTANCE_LOCK_METHOD: &str = "App.releaseSingleInstanceLock";
pub const APP_SECOND_INSTANCE_EVENT: &str = "App.onSecondInstance";
pub const APP_OPEN_FILE_EVENT: &str = "App.onOpenFile";
pub const APP_OPEN_URL_EVENT: &str = "App.onOpenUrl";
pub const APP_BEFORE_QUIT_EVENT: &str = "App.onBeforeQuit";
pub const APP_METADATA_GET_INFO_METHOD: &str = "AppMetadata.getInfo";
pub const APP_METADATA_GET_PATHS_METHOD: &str = "AppMetadata.getPaths";
pub const APP_METADATA_GET_LAUNCH_CONTEXT_METHOD: &str = "AppMetadata.getLaunchContext";
pub const APP_METADATA_EVENT: &str = "AppMetadata.Event";
pub const ASSOCIATION_IS_DEFAULT_PROTOCOL_CLIENT_METHOD: &str =
    "Association.isDefaultProtocolClient";
pub const ASSOCIATION_SET_DEFAULT_PROTOCOL_CLIENT_METHOD: &str =
    "Association.setDefaultProtocolClient";
pub const ASSOCIATION_GET_FILE_ASSOCIATIONS_METHOD: &str = "Association.getFileAssociations";
pub const ASSOCIATION_EVENT: &str = "Association.Event";
pub const RECENT_DOCUMENTS_ADD_METHOD: &str = "RecentDocuments.add";
pub const RECENT_DOCUMENTS_CLEAR_METHOD: &str = "RecentDocuments.clear";
pub const RECENT_DOCUMENTS_LIST_METHOD: &str = "RecentDocuments.list";
pub const RECENT_DOCUMENTS_EVENT: &str = "RecentDocuments.Event";
pub const NATIVE_FILE_SYSTEM_OPEN_METHOD: &str = "NativeFileSystem.open";
pub const NATIVE_FILE_SYSTEM_STAT_METHOD: &str = "NativeFileSystem.stat";
pub const NATIVE_FILE_SYSTEM_WATCH_METHOD: &str = "NativeFileSystem.watch";
pub const NATIVE_FILE_SYSTEM_STOP_WATCHING_METHOD: &str = "NativeFileSystem.stopWatching";
pub const NATIVE_FILE_SYSTEM_IS_SUPPORTED_METHOD: &str = "NativeFileSystem.isSupported";
pub const NATIVE_FILE_SYSTEM_EVENT: &str = "NativeFileSystem.Event";
pub const AUTOSTART_IS_ENABLED_METHOD: &str = "Autostart.isEnabled";
pub const AUTOSTART_ENABLE_METHOD: &str = "Autostart.enable";
pub const AUTOSTART_DISABLE_METHOD: &str = "Autostart.disable";
pub const AUTOSTART_EVENT: &str = "Autostart.Event";
pub const WINDOW_CREATE_METHOD: &str = "Window.create";
pub const WINDOW_SHOW_METHOD: &str = "Window.show";
pub const WINDOW_HIDE_METHOD: &str = "Window.hide";
pub const WINDOW_FOCUS_METHOD: &str = "Window.focus";
pub const WINDOW_GET_CURRENT_METHOD: &str = "Window.getCurrent";
pub const WINDOW_GET_BY_ID_METHOD: &str = "Window.getById";
pub const WINDOW_LIST_METHOD: &str = "Window.list";
pub const WINDOW_GET_PARENT_METHOD: &str = "Window.getParent";
pub const WINDOW_GET_CHILDREN_METHOD: &str = "Window.getChildren";
pub const WINDOW_GET_BOUNDS_METHOD: &str = "Window.getBounds";
pub const WINDOW_SET_BOUNDS_METHOD: &str = "Window.setBounds";
pub const WINDOW_SET_BOUNDS_ON_DISPLAY_METHOD: &str = "Window.setBoundsOnDisplay";
pub const WINDOW_CENTER_METHOD: &str = "Window.center";
pub const WINDOW_CENTER_ON_DISPLAY_METHOD: &str = "Window.centerOnDisplay";
pub const WINDOW_SET_TITLE_METHOD: &str = "Window.setTitle";
pub const WINDOW_SET_RESIZABLE_METHOD: &str = "Window.setResizable";
pub const WINDOW_SET_DECORATIONS_METHOD: &str = "Window.setDecorations";
pub const WINDOW_SET_TRAFFIC_LIGHTS_METHOD: &str = "Window.setTrafficLights";
pub const WINDOW_SET_VIBRANCY_METHOD: &str = "Window.setVibrancy";
pub const WINDOW_CLEAR_VIBRANCY_METHOD: &str = "Window.clearVibrancy";
pub const WINDOW_SET_SHADOW_METHOD: &str = "Window.setShadow";
pub const WINDOW_SET_TITLE_BAR_STYLE_METHOD: &str = "Window.setTitleBarStyle";
pub const WINDOW_SET_TITLE_BAR_TRANSPARENT_METHOD: &str = "Window.setTitleBarTransparent";
pub const WINDOW_SET_TRANSPARENT_METHOD: &str = "Window.setTransparent";
pub const WINDOW_SET_ALWAYS_ON_TOP_METHOD: &str = "Window.setAlwaysOnTop";
pub const WINDOW_SET_SKIP_TASKBAR_METHOD: &str = "Window.setSkipTaskbar";
pub const WINDOW_SET_PROGRESS_METHOD: &str = "Window.setProgress";
pub const WINDOW_REQUEST_ATTENTION_METHOD: &str = "Window.requestAttention";
pub const WINDOW_CANCEL_ATTENTION_METHOD: &str = "Window.cancelAttention";
pub const WINDOW_MINIMIZE_METHOD: &str = "Window.minimize";
pub const WINDOW_MAXIMIZE_METHOD: &str = "Window.maximize";
pub const WINDOW_RESTORE_METHOD: &str = "Window.restore";
pub const WINDOW_SET_FULLSCREEN_METHOD: &str = "Window.setFullscreen";
pub const WINDOW_SET_SIMPLE_FULLSCREEN_METHOD: &str = "Window.setSimpleFullscreen";
pub const WINDOW_GET_STATE_METHOD: &str = "Window.getState";
pub const WINDOW_DESTROY_METHOD: &str = "Window.destroy";
pub const WINDOW_EVENT: &str = "Window.Event";
pub const DOCK_SET_BADGE_COUNT_METHOD: &str = "Dock.setBadgeCount";
pub const DOCK_SET_BADGE_TEXT_METHOD: &str = "Dock.setBadgeText";
pub const DOCK_SET_PROGRESS_METHOD: &str = "Dock.setProgress";
pub const DOCK_REQUEST_ATTENTION_METHOD: &str = "Dock.requestAttention";
pub const DOCK_IS_SUPPORTED_METHOD: &str = "Dock.isSupported";
pub const GLOBAL_SHORTCUT_IS_REGISTERED_METHOD: &str = "GlobalShortcut.isRegistered";
pub const GLOBAL_SHORTCUT_IS_SUPPORTED_METHOD: &str = "GlobalShortcut.isSupported";
pub const SAFE_STORAGE_SET_METHOD: &str = "SafeStorage.set";
pub const SAFE_STORAGE_GET_METHOD: &str = "SafeStorage.get";
pub const SAFE_STORAGE_DELETE_METHOD: &str = "SafeStorage.delete";
pub const SAFE_STORAGE_LIST_METHOD: &str = "SafeStorage.list";
pub const SAFE_STORAGE_IS_AVAILABLE_METHOD: &str = "SafeStorage.isAvailable";
pub const SAFE_STORAGE_UNSUPPORTED_REASON: &str = "host-adapter-unimplemented";
pub const DIALOG_OPEN_FILE_METHOD: &str = "Dialog.openFile";
pub const DIALOG_OPEN_DIRECTORY_METHOD: &str = "Dialog.openDirectory";
pub const DIALOG_SAVE_FILE_METHOD: &str = "Dialog.saveFile";
pub const DIALOG_MESSAGE_METHOD: &str = "Dialog.message";
pub const DIALOG_CONFIRM_METHOD: &str = "Dialog.confirm";
pub const TRAY_CREATE_METHOD: &str = "Tray.create";
pub const TRAY_SET_ICON_METHOD: &str = "Tray.setIcon";
pub const TRAY_SET_TOOLTIP_METHOD: &str = "Tray.setTooltip";
pub const TRAY_SET_TITLE_METHOD: &str = "Tray.setTitle";
pub const TRAY_SET_MENU_METHOD: &str = "Tray.setMenu";
pub const TRAY_DESTROY_METHOD: &str = "Tray.destroy";
pub const TRAY_IS_SUPPORTED_METHOD: &str = "Tray.isSupported";
pub const TRAY_ACTIVATED_EVENT: &str = "Tray.Activated";
pub const NOTIFICATION_SHOW_METHOD: &str = "Notification.show";
pub const NOTIFICATION_CLOSE_METHOD: &str = "Notification.close";
pub const NOTIFICATION_IS_SUPPORTED_METHOD: &str = "Notification.isSupported";
pub const NOTIFICATION_REQUEST_PERMISSION_METHOD: &str = "Notification.requestPermission";
pub const NOTIFICATION_GET_PERMISSION_STATUS_METHOD: &str = "Notification.getPermissionStatus";
pub const NOTIFICATION_CLICK_EVENT: &str = "Notification.Click";
pub const NOTIFICATION_ACTION_EVENT: &str = "Notification.Action";
pub const NOTIFICATION_UNSUPPORTED_REASON: &str = "host-notification-unavailable";
pub const PATH_APP_DATA_METHOD: &str = "Path.appData";
pub const PATH_CACHE_METHOD: &str = "Path.cache";
pub const PATH_LOGS_METHOD: &str = "Path.logs";
pub const PATH_TEMP_METHOD: &str = "Path.temp";
pub const PATH_HOME_METHOD: &str = "Path.home";
pub const PATH_DOWNLOADS_METHOD: &str = "Path.downloads";
pub const PATH_UNSUPPORTED_REASON: &str = "host-path-unavailable";
pub const PROTOCOL_REGISTER_APP_PROTOCOL_METHOD: &str = "Protocol.registerAppProtocol";
pub const PROTOCOL_SERVE_ASSET_METHOD: &str = "Protocol.serveAsset";
pub const PROTOCOL_SERVE_ROUTE_METHOD: &str = "Protocol.serveRoute";
pub const PROTOCOL_DENY_METHOD: &str = "Protocol.deny";
pub const SCREEN_GET_DISPLAYS_METHOD: &str = "Screen.getDisplays";
pub const SCREEN_GET_PRIMARY_DISPLAY_METHOD: &str = "Screen.getPrimaryDisplay";
pub const SCREEN_GET_POINTER_POINT_METHOD: &str = "Screen.getPointerPoint";
pub const SCREEN_IS_SUPPORTED_METHOD: &str = "Screen.isSupported";
pub const SCREEN_DISPLAYS_CHANGED_EVENT: &str = "Screen.DisplaysChanged";
pub const SCREEN_UNSUPPORTED_REASON: &str = "host-screen-unavailable";
pub const SHELL_OPEN_EXTERNAL_METHOD: &str = "Shell.openExternal";
pub const SHELL_SHOW_ITEM_IN_FOLDER_METHOD: &str = "Shell.showItemInFolder";
pub const SHELL_OPEN_PATH_METHOD: &str = "Shell.openPath";
pub const SHELL_TRASH_ITEM_METHOD: &str = "Shell.trashItem";
pub const SHELL_UNSUPPORTED_REASON: &str = "host-shell-unavailable";
pub const CLIPBOARD_READ_TEXT_METHOD: &str = "Clipboard.readText";
pub const CLIPBOARD_WRITE_TEXT_METHOD: &str = "Clipboard.writeText";
pub const CLIPBOARD_READ_HTML_METHOD: &str = "Clipboard.readHtml";
pub const CLIPBOARD_WRITE_HTML_METHOD: &str = "Clipboard.writeHtml";
pub const CLIPBOARD_READ_IMAGE_METHOD: &str = "Clipboard.readImage";
pub const CLIPBOARD_WRITE_IMAGE_METHOD: &str = "Clipboard.writeImage";
pub const CLIPBOARD_CLEAR_METHOD: &str = "Clipboard.clear";
pub const CLIPBOARD_IS_SUPPORTED_METHOD: &str = "Clipboard.isSupported";
pub const UPDATER_CHECK_METHOD: &str = "Updater.check";
pub const UPDATER_DOWNLOAD_METHOD: &str = "Updater.download";
pub const UPDATER_INSTALL_METHOD: &str = "Updater.install";
pub const UPDATER_INSTALL_AND_RESTART_METHOD: &str = "Updater.installAndRestart";
pub const UPDATER_GET_STATUS_METHOD: &str = "Updater.getStatus";
pub const UPDATER_READY_FOR_RESTART_METHOD: &str = "Updater.readyForRestart";
pub const UPDATER_PREPARING_RESTART_EVENT: &str = "Updater.PreparingRestart";
pub const CRASH_REPORTER_START_METHOD: &str = "CrashReporter.start";
pub const CRASH_REPORTER_RECORD_BREADCRUMB_METHOD: &str = "CrashReporter.recordBreadcrumb";
pub const CRASH_REPORTER_FLUSH_METHOD: &str = "CrashReporter.flush";
pub const CRASH_REPORTER_GET_REPORTS_METHOD: &str = "CrashReporter.getReports";
pub const CRASH_REPORTER_UNSUPPORTED_REASON: &str = "host-adapter-unimplemented";
pub const POWER_MONITOR_IS_SUPPORTED_METHOD: &str = "PowerMonitor.isSupported";
pub const POWER_MONITOR_SUSPEND_EVENT: &str = "PowerMonitor.Suspend";
pub const POWER_MONITOR_RESUME_EVENT: &str = "PowerMonitor.Resume";
pub const POWER_MONITOR_SHUTDOWN_EVENT: &str = "PowerMonitor.Shutdown";
pub const POWER_MONITOR_LOCK_SCREEN_EVENT: &str = "PowerMonitor.LockScreen";
pub const POWER_MONITOR_UNLOCK_SCREEN_EVENT: &str = "PowerMonitor.UnlockScreen";
pub const POWER_MONITOR_POWER_SOURCE_CHANGED_EVENT: &str = "PowerMonitor.PowerSourceChanged";
pub const SYSTEM_APPEARANCE_GET_APPEARANCE_METHOD: &str = "SystemAppearance.getAppearance";
pub const SYSTEM_APPEARANCE_GET_ACCENT_COLOR_METHOD: &str = "SystemAppearance.getAccentColor";
pub const SYSTEM_APPEARANCE_GET_REDUCED_MOTION_METHOD: &str = "SystemAppearance.getReducedMotion";
pub const SYSTEM_APPEARANCE_GET_REDUCED_TRANSPARENCY_METHOD: &str =
    "SystemAppearance.getReducedTransparency";
pub const SYSTEM_APPEARANCE_IS_SUPPORTED_METHOD: &str = "SystemAppearance.isSupported";
pub const SYSTEM_APPEARANCE_APPEARANCE_CHANGED_EVENT: &str = "SystemAppearance.AppearanceChanged";
pub const SYSTEM_APPEARANCE_UNSUPPORTED_REASON: &str = "host-adapter-unimplemented";
pub const REALTIME_MEDIA_SESSION_OPEN_METHOD: &str = "RealtimeMediaSession.open";
pub const REALTIME_MEDIA_SESSION_CLOSE_METHOD: &str = "RealtimeMediaSession.close";
pub const REALTIME_MEDIA_SESSION_SELECT_DEVICE_METHOD: &str = "RealtimeMediaSession.selectDevice";
pub const REALTIME_MEDIA_SESSION_INTERRUPT_METHOD: &str = "RealtimeMediaSession.interrupt";
pub const REALTIME_MEDIA_SESSION_IS_SUPPORTED_METHOD: &str = "RealtimeMediaSession.isSupported";
pub const REALTIME_MEDIA_SESSION_DEVICE_STATE_EVENT: &str = "RealtimeMediaSession.DeviceState";
pub const REALTIME_MEDIA_SESSION_PERMISSION_STATE_EVENT: &str =
    "RealtimeMediaSession.PermissionState";
pub const REALTIME_MEDIA_SESSION_INTERRUPTION_EVENT: &str = "RealtimeMediaSession.Interruption";
pub const REALTIME_MEDIA_SESSION_SESSION_STATE_EVENT: &str = "RealtimeMediaSession.SessionState";
pub const DIAGNOSTICS_BUNDLE_COLLECT_METHOD: &str = "DiagnosticsBundle.collect";
pub const DIAGNOSTICS_BUNDLE_REDACT_METHOD: &str = "DiagnosticsBundle.redact";
pub const DIAGNOSTICS_BUNDLE_WRITE_METHOD: &str = "DiagnosticsBundle.write";
pub const DIAGNOSTICS_BUNDLE_IS_SUPPORTED_METHOD: &str = "DiagnosticsBundle.isSupported";
pub const DIAGNOSTICS_BUNDLE_COLLECT_STARTED_EVENT: &str = "DiagnosticsBundle.CollectStarted";
pub const DIAGNOSTICS_BUNDLE_SOURCE_REDACTED_EVENT: &str = "DiagnosticsBundle.SourceRedacted";
pub const DIAGNOSTICS_BUNDLE_WRITE_COMPLETED_EVENT: &str = "DiagnosticsBundle.WriteCompleted";
pub const DIAGNOSTICS_BUNDLE_FAILED_EVENT: &str = "DiagnosticsBundle.Failed";
pub const ATTACHMENT_INTAKE_INGEST_METHOD: &str = "AttachmentIntake.ingest";
pub const ATTACHMENT_INTAKE_INSPECT_METHOD: &str = "AttachmentIntake.inspect";
pub const ATTACHMENT_INTAKE_DISPOSE_METHOD: &str = "AttachmentIntake.dispose";
pub const ATTACHMENT_INTAKE_IS_SUPPORTED_METHOD: &str = "AttachmentIntake.isSupported";
pub const ATTACHMENT_INTAKE_EVENT: &str = "AttachmentIntake.Event";
pub const SELECTION_CONTEXT_IS_SUPPORTED_METHOD: &str = "SelectionContext.isSupported";
pub const SELECTION_CONTEXT_EVENT: &str = "SelectionContext.Event";
pub const FOCUSED_APPLICATION_CONTEXT_SNAPSHOT_METHOD: &str = "FocusedApplicationContext.snapshot";
pub const FOCUSED_APPLICATION_CONTEXT_IS_SUPPORTED_METHOD: &str =
    "FocusedApplicationContext.isSupported";
pub const FOCUSED_APPLICATION_CONTEXT_EVENT: &str = "FocusedApplicationContext.Event";
pub const DISPLAY_CAPTURE_CAPTURE_DISPLAY_METHOD: &str = "DisplayCapture.captureDisplay";
pub const DISPLAY_CAPTURE_CAPTURE_WINDOW_METHOD: &str = "DisplayCapture.captureWindow";
pub const DISPLAY_CAPTURE_CAPTURE_REGION_METHOD: &str = "DisplayCapture.captureRegion";
pub const DISPLAY_CAPTURE_IS_SUPPORTED_METHOD: &str = "DisplayCapture.isSupported";
pub const DISPLAY_CAPTURE_EVENT: &str = "DisplayCapture.Event";
pub const TRANSIENT_WINDOW_ROLE_IS_SUPPORTED_METHOD: &str = "TransientWindowRole.isSupported";
pub const TRANSIENT_WINDOW_ROLE_EVENT: &str = "TransientWindowRole.Event";
pub const ACTIVATION_REGISTRY_REGISTER_SURFACE_METHOD: &str = "ActivationRegistry.registerSurface";
pub const ACTIVATION_REGISTRY_UNREGISTER_SURFACE_METHOD: &str =
    "ActivationRegistry.unregisterSurface";
pub const ACTIVATION_REGISTRY_LIST_SURFACES_METHOD: &str = "ActivationRegistry.listSurfaces";
pub const ACTIVATION_REGISTRY_IS_SUPPORTED_METHOD: &str = "ActivationRegistry.isSupported";
pub const ACTIVATION_REGISTRY_EVENT: &str = "ActivationRegistry.Event";
pub const RESIDENT_LIFECYCLE_ENABLE_METHOD: &str = "ResidentLifecycle.enable";
pub const RESIDENT_LIFECYCLE_DISABLE_METHOD: &str = "ResidentLifecycle.disable";
pub const RESIDENT_LIFECYCLE_GET_STATE_METHOD: &str = "ResidentLifecycle.getState";
pub const RESIDENT_LIFECYCLE_IS_SUPPORTED_METHOD: &str = "ResidentLifecycle.isSupported";
pub const RESIDENT_LIFECYCLE_EVENT: &str = "ResidentLifecycle.Event";
pub const DISTRIBUTION_PARITY_VERIFY_METHOD: &str = "DistributionParity.verify";
pub const DISTRIBUTION_PARITY_IS_SUPPORTED_METHOD: &str = "DistributionParity.isSupported";
pub const DISTRIBUTION_PARITY_EVENT: &str = "DistributionParity.Event";
pub const JOB_START_METHOD: &str = "Job.start";
pub const JOB_PAUSE_METHOD: &str = "Job.pause";
pub const JOB_RESUME_METHOD: &str = "Job.resume";
pub const JOB_RETRY_METHOD: &str = "Job.retry";
pub const JOB_INTERRUPT_METHOD: &str = "Job.interrupt";
pub const JOB_SUCCEED_METHOD: &str = "Job.succeed";
pub const JOB_FAIL_METHOD: &str = "Job.fail";
pub const JOB_REPORT_PROGRESS_METHOD: &str = "Job.reportProgress";
pub const JOB_GET_METHOD: &str = "Job.get";
pub const JOB_IS_SUPPORTED_METHOD: &str = "Job.isSupported";
pub const JOB_EVENT: &str = "Job.Event";
pub const EGRESS_POLICY_DECIDE_METHOD: &str = "EgressPolicy.decide";
pub const EGRESS_POLICY_RECORD_METHOD: &str = "EgressPolicy.record";
pub const EGRESS_POLICY_IS_SUPPORTED_METHOD: &str = "EgressPolicy.isSupported";
pub const EGRESS_POLICY_DECISION_RECORDED_EVENT: &str = "EgressPolicy.DecisionRecorded";
pub const EXECUTION_SANDBOX_IS_SUPPORTED_METHOD: &str = "ExecutionSandbox.isSupported";
pub const EXECUTION_SANDBOX_EVENT: &str = "ExecutionSandbox.Event";
pub const EXTENSION_CONFIG_READ_METHOD: &str = "ExtensionConfig.read";
pub const EXTENSION_CONFIG_WRITE_METHOD: &str = "ExtensionConfig.write";
pub const EXTENSION_CONFIG_RESET_METHOD: &str = "ExtensionConfig.reset";
pub const EXTENSION_CONFIG_REDACT_METHOD: &str = "ExtensionConfig.redact";
pub const EXTENSION_CONFIG_IS_SUPPORTED_METHOD: &str = "ExtensionConfig.isSupported";
pub const EXTENSION_CONFIG_EVENT: &str = "ExtensionConfig.Event";
pub const EXTENSION_PACKAGE_INSTALL_METHOD: &str = "ExtensionPackage.install";
pub const EXTENSION_PACKAGE_UPDATE_METHOD: &str = "ExtensionPackage.update";
pub const EXTENSION_PACKAGE_REMOVE_METHOD: &str = "ExtensionPackage.remove";
pub const EXTENSION_PACKAGE_LIST_METHOD: &str = "ExtensionPackage.list";
pub const EXTENSION_PACKAGE_IS_SUPPORTED_METHOD: &str = "ExtensionPackage.isSupported";
pub const EXTENSION_PACKAGE_EVENT: &str = "ExtensionPackage.Event";
pub const LOCAL_TOOL_RUNTIME_REGISTER_METHOD: &str = "LocalToolRuntime.register";
pub const LOCAL_TOOL_RUNTIME_RUN_METHOD: &str = "LocalToolRuntime.run";
pub const LOCAL_TOOL_RUNTIME_STOP_METHOD: &str = "LocalToolRuntime.stop";
pub const LOCAL_TOOL_RUNTIME_HEALTH_METHOD: &str = "LocalToolRuntime.health";
pub const LOCAL_TOOL_RUNTIME_IS_SUPPORTED_METHOD: &str = "LocalToolRuntime.isSupported";
pub const LOCAL_TOOL_RUNTIME_EVENT: &str = "LocalToolRuntime.Event";
pub const WORKSPACE_INDEX_OPEN_METHOD: &str = "WorkspaceIndex.open";
pub const WORKSPACE_INDEX_REFRESH_METHOD: &str = "WorkspaceIndex.refresh";
pub const WORKSPACE_INDEX_CLOSE_METHOD: &str = "WorkspaceIndex.close";
pub const WORKSPACE_INDEX_IS_SUPPORTED_METHOD: &str = "WorkspaceIndex.isSupported";
pub const WORKSPACE_INDEX_EVENT: &str = "WorkspaceIndex.Event";
pub const SCOPED_ACCESS_GRANT_IS_SUPPORTED_METHOD: &str = "ScopedAccessGrant.isSupported";
pub const SCOPED_ACCESS_GRANT_EVENT: &str = "ScopedAccessGrant.Event";
pub const TRANSACTIONAL_FILE_MUTATION_PREPARE_METHOD: &str = "TransactionalFileMutation.prepare";
pub const TRANSACTIONAL_FILE_MUTATION_COMMIT_METHOD: &str = "TransactionalFileMutation.commit";
pub const TRANSACTIONAL_FILE_MUTATION_ROLLBACK_METHOD: &str = "TransactionalFileMutation.rollback";
pub const TRANSACTIONAL_FILE_MUTATION_IS_SUPPORTED_METHOD: &str =
    "TransactionalFileMutation.isSupported";
pub const TRANSACTIONAL_FILE_MUTATION_EVENT: &str = "TransactionalFileMutation.Event";
pub const MENU_SET_APPLICATION_MENU_METHOD: &str = "Menu.setApplicationMenu";
pub const MENU_SET_WINDOW_MENU_METHOD: &str = "Menu.setWindowMenu";
pub const MENU_CLEAR_METHOD: &str = "Menu.clear";
pub const MENU_CAPABILITY_METHOD: &str = "Menu.capability";
pub const MENU_ACTIVATED_EVENT: &str = "Menu.Activated";
pub const CONTEXT_MENU_SHOW_METHOD: &str = "ContextMenu.show";
pub const CONTEXT_MENU_ACTIVATED_EVENT: &str = "ContextMenu.Activated";
pub const MENU_UNSUPPORTED_REASON: &str = "host-adapter-unimplemented";
pub const WEBVIEW_CREATE_METHOD: &str = "WebView.create";
pub const WEBVIEW_LOAD_ROUTE_METHOD: &str = "WebView.loadRoute";
pub const WEBVIEW_LOAD_URL_METHOD: &str = "WebView.loadUrl";
pub const WEBVIEW_RELOAD_METHOD: &str = "WebView.reload";
pub const WEBVIEW_STOP_METHOD: &str = "WebView.stop";
pub const WEBVIEW_GO_BACK_METHOD: &str = "WebView.goBack";
pub const WEBVIEW_GO_FORWARD_METHOD: &str = "WebView.goForward";
pub const WEBVIEW_GET_NAVIGATION_STATE_METHOD: &str = "WebView.getNavigationState";
pub const WEBVIEW_PRINT_METHOD: &str = "WebView.print";
pub const WEBVIEW_SET_ZOOM_METHOD: &str = "WebView.setZoom";
pub const WEBVIEW_OPEN_DEVTOOLS_METHOD: &str = "WebView.openDevTools";
pub const WEBVIEW_CLOSE_DEVTOOLS_METHOD: &str = "WebView.closeDevTools";
pub const WEBVIEW_SET_NAVIGATION_POLICY_METHOD: &str = "WebView.setNavigationPolicy";
pub const WEBVIEW_DESTROY_METHOD: &str = "WebView.destroy";
pub const WEBVIEW_NAVIGATION_BLOCKED_EVENT: &str = "WebView.NavigationBlocked";
pub const WEBVIEW_API_CALL_EVENT: &str = "WebView.ApiCall";
pub const WEBVIEW_RUNTIME_EVENT: &str = "WebView.RuntimeEvent";
pub const WEBVIEW_FRAME_EVENT: &str = "WebView.FrameEvent";
pub const SESSION_PROFILE_FROM_PARTITION_METHOD: &str = "SessionProfile.fromPartition";
pub const SESSION_PROFILE_DESTROY_METHOD: &str = "SessionProfile.destroy";
pub const SESSION_PROFILE_LIST_METHOD: &str = "SessionProfile.list";
pub const SESSION_PROFILE_IS_SUPPORTED_METHOD: &str = "SessionProfile.isSupported";
pub const SESSION_PROFILE_EVENT: &str = "SessionProfile.Event";
pub const COOKIE_STORE_GET_METHOD: &str = "CookieStore.get";
pub const COOKIE_STORE_REMOVE_METHOD: &str = "CookieStore.remove";
pub const COOKIE_STORE_SET_METHOD: &str = "CookieStore.set";
pub const COOKIE_STORE_IS_SUPPORTED_METHOD: &str = "CookieStore.isSupported";
pub const COOKIE_STORE_EVENT: &str = "CookieStore.Event";
pub const BROWSING_DATA_CLEAR_METHOD: &str = "BrowsingData.clear";
pub const BROWSING_DATA_LIST_TYPES_METHOD: &str = "BrowsingData.listTypes";
pub const BROWSING_DATA_IS_SUPPORTED_METHOD: &str = "BrowsingData.isSupported";
pub const BROWSING_DATA_EVENT: &str = "BrowsingData.Event";
pub const SESSION_PERMISSION_IS_SUPPORTED_METHOD: &str = "SessionPermission.isSupported";
pub const SESSION_PERMISSION_EVENT: &str = "SessionPermission.Event";
pub const DOWNLOAD_IS_SUPPORTED_METHOD: &str = "Download.isSupported";
pub const DOWNLOAD_EVENT: &str = "Download.Event";
pub const NETWORK_AUTH_SET_PROXY_METHOD: &str = "NetworkAuth.setProxy";
pub const NETWORK_AUTH_IS_SUPPORTED_METHOD: &str = "NetworkAuth.isSupported";
pub const NETWORK_AUTH_EVENT: &str = "NetworkAuth.Event";
pub const WEB_REQUEST_IS_SUPPORTED_METHOD: &str = "WebRequest.isSupported";
pub const WEB_REQUEST_EVENT: &str = "WebRequest.Event";
pub const NATIVE_NETWORK_IS_SUPPORTED_METHOD: &str = "NativeNetwork.isSupported";
pub const NATIVE_NETWORK_EVENT: &str = "NativeNetwork.Event";
pub const WEBVIEW_UNSUPPORTED_REASON: &str = "host-adapter-unimplemented";
pub const RENDERER_DISCONNECTED_EVENT: &str = "renderer.disconnected";
pub const RENDERER_RESUME_METHOD: &str = "renderer.resume";
pub const RENDERER_RESUMED_EVENT: &str = "renderer.resumed";
pub const RENDERER_RESUME_DENIED_EVENT: &str = "renderer.resume.denied";
pub const DEFAULT_RECONNECT_WINDOW_MS: u64 = 30_000;
pub const DEFAULT_MAX_BACKFILL_EVENTS: u64 = 1_024;
pub const REALTIME_MEDIA_SESSION_UNSUPPORTED_REASON: &str = "host-adapter-unimplemented";
pub const REALTIME_MEDIA_SESSION_MEDIA_UNAVAILABLE_REASON: &str = "host-media-unavailable";
pub const REALTIME_MEDIA_SESSION_STARTUP_UNVERIFIED_REASON: &str = "host-media-startup-unverified";
pub const DIAGNOSTICS_BUNDLE_UNSUPPORTED_REASON: &str = "host-adapter-unimplemented";
pub const ATTACHMENT_INTAKE_UNSUPPORTED_REASON: &str = "host-adapter-unimplemented";
pub const SELECTION_CONTEXT_UNSUPPORTED_REASON: &str = "host-adapter-unimplemented";
pub const FOCUSED_APPLICATION_CONTEXT_UNSUPPORTED_REASON: &str = "host-adapter-unimplemented";
pub const DISPLAY_CAPTURE_UNSUPPORTED_REASON: &str = "host-adapter-unimplemented";
pub const TRANSIENT_WINDOW_ROLE_UNSUPPORTED_REASON: &str = "host-adapter-unimplemented";
pub const ACTIVATION_REGISTRY_UNSUPPORTED_REASON: &str = "host-adapter-unimplemented";
pub const RESIDENT_LIFECYCLE_UNSUPPORTED_REASON: &str = "host-adapter-unimplemented";
pub const DISTRIBUTION_PARITY_UNSUPPORTED_REASON: &str = "host-adapter-unimplemented";
pub const JOB_UNSUPPORTED_REASON: &str = "host-adapter-unimplemented";
pub const EGRESS_POLICY_UNSUPPORTED_REASON: &str = "host-adapter-unimplemented";
pub const EXECUTION_SANDBOX_UNSUPPORTED_REASON: &str = "host-adapter-unimplemented";
pub const EXTENSION_CONFIG_UNSUPPORTED_REASON: &str = "host-adapter-unimplemented";
pub const EXTENSION_PACKAGE_UNSUPPORTED_REASON: &str = "host-adapter-unimplemented";
pub const LOCAL_TOOL_RUNTIME_UNSUPPORTED_REASON: &str = "host-adapter-unimplemented";
pub const WORKSPACE_INDEX_UNSUPPORTED_REASON: &str = "host-adapter-unimplemented";
pub const SCOPED_ACCESS_GRANT_UNSUPPORTED_REASON: &str = "host-adapter-unimplemented";
pub const TRANSACTIONAL_FILE_MUTATION_UNSUPPORTED_REASON: &str = "host-adapter-unimplemented";
pub const APP_UNSUPPORTED_REASON: &str = "host-adapter-unimplemented";
pub const ASSOCIATION_UNSUPPORTED_REASON: &str = "host-adapter-unimplemented";
pub const RECENT_DOCUMENTS_UNSUPPORTED_REASON: &str = "host-adapter-unimplemented";
pub const NATIVE_FILE_SYSTEM_UNSUPPORTED_REASON: &str = "host-adapter-unimplemented";
pub const AUTOSTART_UNSUPPORTED_REASON: &str = "host-adapter-unimplemented";
pub const CLIPBOARD_UNSUPPORTED_REASON: &str = "host-adapter-unimplemented";
pub const TRAY_UNSUPPORTED_REASON: &str = "host-tray-unavailable";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostVersionPayload {
    protocol_version: String,
}

impl HostVersionPayload {
    pub fn current() -> Self {
        Self {
            protocol_version: PROTOCOL_VERSION.to_string(),
        }
    }

    pub fn protocol_version(&self) -> &str {
        &self.protocol_version
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppQuitPayload {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    exit_code: Option<u8>,
}

impl AppQuitPayload {
    pub fn new(exit_code: Option<u8>) -> Self {
        Self { exit_code }
    }

    pub fn exit_code(&self) -> Option<u8> {
        self.exit_code
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppRestartPayload {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    args: Option<Vec<String>>,
}

impl AppRestartPayload {
    pub fn new(args: Option<Vec<String>>) -> Self {
        Self { args }
    }

    pub fn args(&self) -> Option<&[String]> {
        self.args.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppSingleInstancePayload {
    acquired: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    primary_pid: Option<u64>,
}

impl AppSingleInstancePayload {
    pub fn acquired() -> Self {
        Self {
            acquired: true,
            primary_pid: None,
        }
    }

    pub fn owned_by(primary_pid: u64) -> Self {
        Self {
            acquired: false,
            primary_pid: Some(primary_pid),
        }
    }

    pub fn is_acquired(&self) -> bool {
        self.acquired
    }

    pub fn primary_pid(&self) -> Option<u64> {
        self.primary_pid
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AppActivationReasonPayload {
    Launch,
    OpenFile,
    OpenUrl,
    Unknown,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppSecondInstanceEventPayload {
    activation_reason: AppActivationReasonPayload,
    argv: Vec<String>,
    cwd: String,
    trace_id: String,
}

impl AppSecondInstanceEventPayload {
    pub fn new(
        activation_reason: AppActivationReasonPayload,
        argv: Vec<String>,
        cwd: impl Into<String>,
        trace_id: impl Into<String>,
    ) -> Self {
        Self {
            activation_reason,
            argv,
            cwd: cwd.into(),
            trace_id: trace_id.into(),
        }
    }

    pub fn trace_id(&self) -> &str {
        &self.trace_id
    }

    pub fn argv(&self) -> &[String] {
        &self.argv
    }

    pub fn cwd(&self) -> &str {
        &self.cwd
    }

    pub fn activation_reason(&self) -> AppActivationReasonPayload {
        self.activation_reason
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppOpenFileEventPayload {
    path: String,
}

impl AppOpenFileEventPayload {
    pub fn new(path: impl Into<String>) -> Self {
        Self { path: path.into() }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppOpenUrlEventPayload {
    url: String,
}

impl AppOpenUrlEventPayload {
    pub fn new(url: impl Into<String>) -> Self {
        Self { url: url.into() }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppBeforeQuitEventPayload {
    trace_id: String,
}

impl AppBeforeQuitEventPayload {
    pub fn new(trace_id: impl Into<String>) -> Self {
        Self {
            trace_id: trace_id.into(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppMetadataInfoPayload {
    id: String,
    name: String,
    version: String,
}

impl AppMetadataInfoPayload {
    pub fn new(id: impl Into<String>, name: impl Into<String>, version: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            version: version.into(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppMetadataPathsPayload {
    executable: CanonicalPathPayload,
    resources: CanonicalPathPayload,
    cwd: CanonicalPathPayload,
}

impl AppMetadataPathsPayload {
    pub fn new(
        executable: CanonicalPathPayload,
        resources: CanonicalPathPayload,
        cwd: CanonicalPathPayload,
    ) -> Self {
        Self {
            executable,
            resources,
            cwd,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AppMetadataLaunchReasonPayload {
    Launch,
    OpenFile,
    OpenUrl,
    Unknown,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppMetadataEnvironmentShapePayload {
    variable_names: Vec<String>,
}

impl AppMetadataEnvironmentShapePayload {
    pub fn new(variable_names: Vec<String>) -> Self {
        Self { variable_names }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppMetadataLaunchContextPayload {
    argv: Vec<String>,
    cwd: CanonicalPathPayload,
    reason: AppMetadataLaunchReasonPayload,
    environment: AppMetadataEnvironmentShapePayload,
}

impl AppMetadataLaunchContextPayload {
    pub fn new(
        argv: Vec<String>,
        cwd: CanonicalPathPayload,
        reason: AppMetadataLaunchReasonPayload,
        environment: AppMetadataEnvironmentShapePayload,
    ) -> Self {
        Self {
            argv,
            cwd,
            reason,
            environment,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AppMetadataEventPhasePayload {
    InfoRead,
    PathsRead,
    LaunchContextRead,
    Failed,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AppMetadataEventPayload {
    phase: AppMetadataEventPhasePayload,
    reason: Option<String>,
}

impl AppMetadataEventPayload {
    pub fn info_read() -> Self {
        Self {
            phase: AppMetadataEventPhasePayload::InfoRead,
            reason: None,
        }
    }

    pub fn paths_read() -> Self {
        Self {
            phase: AppMetadataEventPhasePayload::PathsRead,
            reason: None,
        }
    }

    pub fn launch_context_read() -> Self {
        Self {
            phase: AppMetadataEventPhasePayload::LaunchContextRead,
            reason: None,
        }
    }

    pub fn failed(reason: impl Into<String>) -> Self {
        Self {
            phase: AppMetadataEventPhasePayload::Failed,
            reason: Some(reason.into()),
        }
    }

    #[cfg(test)]
    fn new_for_test(phase: AppMetadataEventPhasePayload, reason: Option<String>) -> Self {
        Self { phase, reason }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SerializableAppMetadataEventPayload<'a> {
    phase: AppMetadataEventPhasePayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'a str>,
}

impl<'a> TryFrom<&'a AppMetadataEventPayload> for SerializableAppMetadataEventPayload<'a> {
    type Error = &'static str;

    fn try_from(payload: &'a AppMetadataEventPayload) -> Result<Self, Self::Error> {
        validate_app_metadata_event_payload(payload.phase, &payload.reason)?;
        Ok(Self {
            phase: payload.phase,
            reason: payload.reason.as_deref(),
        })
    }
}

impl Serialize for AppMetadataEventPayload {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        SerializableAppMetadataEventPayload::try_from(self)
            .map_err(ser::Error::custom)?
            .serialize(serializer)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawAppMetadataEventPayload {
    phase: AppMetadataEventPhasePayload,
    #[serde(default)]
    reason: Option<String>,
}

impl TryFrom<RawAppMetadataEventPayload> for AppMetadataEventPayload {
    type Error = &'static str;

    fn try_from(raw: RawAppMetadataEventPayload) -> Result<Self, Self::Error> {
        validate_app_metadata_event_payload(raw.phase, &raw.reason)?;
        Ok(Self {
            phase: raw.phase,
            reason: raw.reason,
        })
    }
}

impl<'de> Deserialize<'de> for AppMetadataEventPayload {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        RawAppMetadataEventPayload::deserialize(deserializer)?
            .try_into()
            .map_err(de::Error::custom)
    }
}

fn validate_app_metadata_event_payload(
    phase: AppMetadataEventPhasePayload,
    reason: &Option<String>,
) -> Result<(), &'static str> {
    match phase {
        AppMetadataEventPhasePayload::InfoRead
        | AppMetadataEventPhasePayload::PathsRead
        | AppMetadataEventPhasePayload::LaunchContextRead
            if reason.is_none() =>
        {
            Ok(())
        }
        AppMetadataEventPhasePayload::InfoRead
        | AppMetadataEventPhasePayload::PathsRead
        | AppMetadataEventPhasePayload::LaunchContextRead => {
            Err("successful app metadata events must not include failure reason")
        }
        AppMetadataEventPhasePayload::Failed if reason.is_some() => Ok(()),
        AppMetadataEventPhasePayload::Failed => Err("failed app metadata events require reason"),
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssociationProtocolPayload {
    scheme: String,
}

impl AssociationProtocolPayload {
    pub fn new(scheme: impl Into<String>) -> Self {
        Self {
            scheme: scheme.into(),
        }
    }

    pub fn scheme(&self) -> &str {
        &self.scheme
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssociationProtocolStatusPayload {
    scheme: String,
    is_default: bool,
}

impl AssociationProtocolStatusPayload {
    pub fn new(scheme: impl Into<String>, is_default: bool) -> Self {
        Self {
            scheme: scheme.into(),
            is_default,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssociationFileAssociationsPayload {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    extensions: Option<Vec<String>>,
}

impl AssociationFileAssociationsPayload {
    pub fn new(extensions: Option<Vec<String>>) -> Self {
        Self { extensions }
    }

    pub fn extensions(&self) -> Option<&[String]> {
        self.extensions.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssociationFileAssociationPayload {
    extension: String,
    is_default: bool,
}

impl AssociationFileAssociationPayload {
    pub fn new(extension: impl Into<String>, is_default: bool) -> Self {
        Self {
            extension: extension.into(),
            is_default,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssociationFileAssociationsResultPayload {
    associations: Vec<AssociationFileAssociationPayload>,
}

impl AssociationFileAssociationsResultPayload {
    pub fn new(associations: Vec<AssociationFileAssociationPayload>) -> Self {
        Self { associations }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AssociationEventPhasePayload {
    ProtocolChecked,
    ProtocolUpdated,
    FileAssociationsChecked,
    Failed,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AssociationEventPayload {
    phase: AssociationEventPhasePayload,
    reason: Option<String>,
}

impl AssociationEventPayload {
    pub fn protocol_checked() -> Self {
        Self {
            phase: AssociationEventPhasePayload::ProtocolChecked,
            reason: None,
        }
    }

    pub fn protocol_updated() -> Self {
        Self {
            phase: AssociationEventPhasePayload::ProtocolUpdated,
            reason: None,
        }
    }

    pub fn file_associations_checked() -> Self {
        Self {
            phase: AssociationEventPhasePayload::FileAssociationsChecked,
            reason: None,
        }
    }

    pub fn failed(reason: impl Into<String>) -> Self {
        Self {
            phase: AssociationEventPhasePayload::Failed,
            reason: Some(reason.into()),
        }
    }

    #[cfg(test)]
    fn new_for_test(phase: AssociationEventPhasePayload, reason: Option<String>) -> Self {
        Self { phase, reason }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SerializableAssociationEventPayload<'a> {
    phase: AssociationEventPhasePayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'a str>,
}

impl<'a> TryFrom<&'a AssociationEventPayload> for SerializableAssociationEventPayload<'a> {
    type Error = &'static str;

    fn try_from(payload: &'a AssociationEventPayload) -> Result<Self, Self::Error> {
        validate_association_event_payload(payload.phase, &payload.reason)?;
        Ok(Self {
            phase: payload.phase,
            reason: payload.reason.as_deref(),
        })
    }
}

impl Serialize for AssociationEventPayload {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        SerializableAssociationEventPayload::try_from(self)
            .map_err(ser::Error::custom)?
            .serialize(serializer)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawAssociationEventPayload {
    phase: AssociationEventPhasePayload,
    #[serde(default)]
    reason: Option<String>,
}

impl TryFrom<RawAssociationEventPayload> for AssociationEventPayload {
    type Error = &'static str;

    fn try_from(raw: RawAssociationEventPayload) -> Result<Self, Self::Error> {
        validate_association_event_payload(raw.phase, &raw.reason)?;
        Ok(Self {
            phase: raw.phase,
            reason: raw.reason,
        })
    }
}

impl<'de> Deserialize<'de> for AssociationEventPayload {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        RawAssociationEventPayload::deserialize(deserializer)?
            .try_into()
            .map_err(de::Error::custom)
    }
}

fn validate_association_event_payload(
    phase: AssociationEventPhasePayload,
    reason: &Option<String>,
) -> Result<(), &'static str> {
    match phase {
        AssociationEventPhasePayload::ProtocolChecked
        | AssociationEventPhasePayload::ProtocolUpdated
        | AssociationEventPhasePayload::FileAssociationsChecked
            if reason.is_none() =>
        {
            Ok(())
        }
        AssociationEventPhasePayload::ProtocolChecked
        | AssociationEventPhasePayload::ProtocolUpdated
        | AssociationEventPhasePayload::FileAssociationsChecked => {
            Err("successful association events must not include failure reason")
        }
        AssociationEventPhasePayload::Failed if reason.is_some() => Ok(()),
        AssociationEventPhasePayload::Failed => Err("failed association events require reason"),
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecentDocumentsAddPayload {
    path: CanonicalPathPayload,
}

impl RecentDocumentsAddPayload {
    pub fn new(path: CanonicalPathPayload) -> Self {
        Self { path }
    }

    pub fn path(&self) -> &CanonicalPathPayload {
        &self.path
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecentDocumentPayload {
    path: CanonicalPathPayload,
}

impl RecentDocumentPayload {
    pub fn new(path: CanonicalPathPayload) -> Self {
        Self { path }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecentDocumentsListResultPayload {
    documents: Vec<RecentDocumentPayload>,
}

impl RecentDocumentsListResultPayload {
    pub fn new(documents: Vec<RecentDocumentPayload>) -> Self {
        Self { documents }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RecentDocumentsEventPhasePayload {
    DocumentAdded,
    Cleared,
    Failed,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecentDocumentsEventPayload {
    phase: RecentDocumentsEventPhasePayload,
    path: Option<CanonicalPathPayload>,
    reason: Option<String>,
}

impl RecentDocumentsEventPayload {
    pub fn new(
        phase: RecentDocumentsEventPhasePayload,
        path: Option<CanonicalPathPayload>,
        reason: Option<String>,
    ) -> Self {
        Self {
            phase,
            path,
            reason,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SerializableRecentDocumentsEventPayload<'a> {
    phase: RecentDocumentsEventPhasePayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<&'a CanonicalPathPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'a str>,
}

impl<'a> TryFrom<&'a RecentDocumentsEventPayload> for SerializableRecentDocumentsEventPayload<'a> {
    type Error = &'static str;

    fn try_from(payload: &'a RecentDocumentsEventPayload) -> Result<Self, Self::Error> {
        validate_recent_documents_event_payload(payload.phase, &payload.path, &payload.reason)?;
        Ok(Self {
            phase: payload.phase,
            path: payload.path.as_ref(),
            reason: payload.reason.as_deref(),
        })
    }
}

impl Serialize for RecentDocumentsEventPayload {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        SerializableRecentDocumentsEventPayload::try_from(self)
            .map_err(ser::Error::custom)?
            .serialize(serializer)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawRecentDocumentsEventPayload {
    phase: RecentDocumentsEventPhasePayload,
    path: Option<CanonicalPathPayload>,
    reason: Option<String>,
}

impl TryFrom<RawRecentDocumentsEventPayload> for RecentDocumentsEventPayload {
    type Error = &'static str;

    fn try_from(raw: RawRecentDocumentsEventPayload) -> Result<Self, Self::Error> {
        validate_recent_documents_event_payload(raw.phase, &raw.path, &raw.reason)?;
        Ok(Self {
            phase: raw.phase,
            path: raw.path,
            reason: raw.reason,
        })
    }
}

impl<'de> Deserialize<'de> for RecentDocumentsEventPayload {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        RawRecentDocumentsEventPayload::deserialize(deserializer)?
            .try_into()
            .map_err(de::Error::custom)
    }
}

fn validate_recent_documents_event_payload(
    phase: RecentDocumentsEventPhasePayload,
    path: &Option<CanonicalPathPayload>,
    reason: &Option<String>,
) -> Result<(), &'static str> {
    match phase {
        RecentDocumentsEventPhasePayload::DocumentAdded if path.is_some() && reason.is_none() => {
            Ok(())
        }
        RecentDocumentsEventPhasePayload::DocumentAdded => {
            Err("document-added recent documents event requires path only")
        }
        RecentDocumentsEventPhasePayload::Cleared if path.is_none() && reason.is_none() => Ok(()),
        RecentDocumentsEventPhasePayload::Cleared => {
            Err("cleared recent documents event must not include path or reason")
        }
        RecentDocumentsEventPhasePayload::Failed if path.is_none() && reason.is_some() => Ok(()),
        RecentDocumentsEventPhasePayload::Failed => {
            Err("failed recent documents event requires reason and no path")
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NativeFileSystemEntryKindPayload {
    File,
    Directory,
    Symlink,
    Other,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NativeFileSystemOpenModePayload {
    Read,
    Write,
    ReadWrite,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NativeFileSystemEventPhasePayload {
    WatchStarted,
    Changed,
    Removed,
    Failed,
    WatchStopped,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeFileSystemResourcePayload {
    kind: String,
    id: String,
    generation: u64,
    owner_scope: String,
    state: String,
}

impl NativeFileSystemResourcePayload {
    pub fn handle(id: impl Into<String>, generation: u64, owner_scope: impl Into<String>) -> Self {
        Self {
            kind: "native-file-system-handle".to_string(),
            id: id.into(),
            generation,
            owner_scope: owner_scope.into(),
            state: "open".to_string(),
        }
    }

    pub fn watch(id: impl Into<String>, generation: u64, owner_scope: impl Into<String>) -> Self {
        Self {
            kind: "native-file-system-watch".to_string(),
            id: id.into(),
            generation,
            owner_scope: owner_scope.into(),
            state: "open".to_string(),
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeFileSystemOpenPayload {
    path: CanonicalPathPayload,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    mode: Option<NativeFileSystemOpenModePayload>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    handle_id: Option<String>,
}

impl NativeFileSystemOpenPayload {
    pub fn new(
        path: CanonicalPathPayload,
        mode: Option<NativeFileSystemOpenModePayload>,
        handle_id: Option<String>,
    ) -> Self {
        Self {
            path,
            mode,
            handle_id,
        }
    }

    pub fn path(&self) -> &CanonicalPathPayload {
        &self.path
    }

    pub fn handle_id(&self) -> Option<&str> {
        self.handle_id.as_deref()
    }

    pub fn mode(&self) -> Option<NativeFileSystemOpenModePayload> {
        self.mode
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeFileSystemStatPayload {
    path: CanonicalPathPayload,
}

impl NativeFileSystemStatPayload {
    pub fn new(path: CanonicalPathPayload) -> Self {
        Self { path }
    }

    pub fn path(&self) -> &CanonicalPathPayload {
        &self.path
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeFileSystemWatchPayload {
    path: CanonicalPathPayload,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    recursive: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    watch_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    owner_scope: Option<String>,
}

impl NativeFileSystemWatchPayload {
    pub fn new(
        path: CanonicalPathPayload,
        recursive: Option<bool>,
        watch_id: Option<String>,
        owner_scope: Option<String>,
    ) -> Self {
        Self {
            path,
            recursive,
            watch_id,
            owner_scope,
        }
    }

    pub fn path(&self) -> &CanonicalPathPayload {
        &self.path
    }

    pub fn recursive(&self) -> Option<bool> {
        self.recursive
    }

    pub fn watch_id(&self) -> Option<&str> {
        self.watch_id.as_deref()
    }

    pub fn owner_scope(&self) -> Option<&str> {
        self.owner_scope.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeFileSystemStopWatchingPayload {
    watch_id: String,
}

impl NativeFileSystemStopWatchingPayload {
    pub fn new(watch_id: impl Into<String>) -> Self {
        Self {
            watch_id: watch_id.into(),
        }
    }

    pub fn watch_id(&self) -> &str {
        &self.watch_id
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeFileSystemMetadataPayload {
    path: CanonicalPathPayload,
    kind: NativeFileSystemEntryKindPayload,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    size_bytes: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    modified_millis: Option<u64>,
}

impl NativeFileSystemMetadataPayload {
    pub fn new(path: CanonicalPathPayload, kind: NativeFileSystemEntryKindPayload) -> Self {
        Self {
            path,
            kind,
            size_bytes: None,
            modified_millis: None,
        }
    }

    pub fn with_size_bytes(mut self, size_bytes: u64) -> Self {
        self.size_bytes = Some(size_bytes);
        self
    }

    pub fn with_modified_millis(mut self, modified_millis: u64) -> Self {
        self.modified_millis = Some(modified_millis);
        self
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeFileSystemOpenResultPayload {
    handle: NativeFileSystemResourcePayload,
    metadata: NativeFileSystemMetadataPayload,
}

impl NativeFileSystemOpenResultPayload {
    pub fn new(
        handle: NativeFileSystemResourcePayload,
        metadata: NativeFileSystemMetadataPayload,
    ) -> Self {
        Self { handle, metadata }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeFileSystemWatchResultPayload {
    watch: NativeFileSystemResourcePayload,
    path: CanonicalPathPayload,
    recursive: bool,
}

impl NativeFileSystemWatchResultPayload {
    pub fn new(
        watch: NativeFileSystemResourcePayload,
        path: CanonicalPathPayload,
        recursive: bool,
    ) -> Self {
        Self {
            watch,
            path,
            recursive,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeFileSystemStopWatchingResultPayload {
    watch_id: String,
    stopped: bool,
}

impl NativeFileSystemStopWatchingResultPayload {
    pub fn new(watch_id: impl Into<String>, stopped: bool) -> Self {
        Self {
            watch_id: watch_id.into(),
            stopped,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeFileSystemSupportedPayload {
    supported: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl NativeFileSystemSupportedPayload {
    pub fn supported() -> Self {
        Self {
            supported: true,
            reason: None,
        }
    }

    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            supported: false,
            reason: Some(reason.into()),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct NativeFileSystemEventPayload {
    r#type: String,
    timestamp: u64,
    watch_id: Option<String>,
    path: Option<CanonicalPathPayload>,
    phase: NativeFileSystemEventPhasePayload,
    reason: Option<String>,
}

impl NativeFileSystemEventPayload {
    pub fn watch_started(
        timestamp: u64,
        watch_id: impl Into<String>,
        path: CanonicalPathPayload,
    ) -> Self {
        Self {
            r#type: "native-file-system-event".to_string(),
            timestamp,
            watch_id: Some(watch_id.into()),
            path: Some(path),
            phase: NativeFileSystemEventPhasePayload::WatchStarted,
            reason: None,
        }
    }

    pub fn changed(
        timestamp: u64,
        watch_id: impl Into<String>,
        path: CanonicalPathPayload,
    ) -> Self {
        Self {
            r#type: "native-file-system-event".to_string(),
            timestamp,
            watch_id: Some(watch_id.into()),
            path: Some(path),
            phase: NativeFileSystemEventPhasePayload::Changed,
            reason: None,
        }
    }

    pub fn removed(
        timestamp: u64,
        watch_id: impl Into<String>,
        path: CanonicalPathPayload,
    ) -> Self {
        Self {
            r#type: "native-file-system-event".to_string(),
            timestamp,
            watch_id: Some(watch_id.into()),
            path: Some(path),
            phase: NativeFileSystemEventPhasePayload::Removed,
            reason: None,
        }
    }

    pub fn failed(timestamp: u64, watch_id: impl Into<String>, reason: impl Into<String>) -> Self {
        Self {
            r#type: "native-file-system-event".to_string(),
            timestamp,
            watch_id: Some(watch_id.into()),
            path: None,
            phase: NativeFileSystemEventPhasePayload::Failed,
            reason: Some(reason.into()),
        }
    }

    pub fn watch_stopped(timestamp: u64, watch_id: impl Into<String>) -> Self {
        Self {
            r#type: "native-file-system-event".to_string(),
            timestamp,
            watch_id: Some(watch_id.into()),
            path: None,
            phase: NativeFileSystemEventPhasePayload::WatchStopped,
            reason: None,
        }
    }

    #[cfg(test)]
    fn new_for_test(timestamp: u64, phase: NativeFileSystemEventPhasePayload) -> Self {
        Self {
            r#type: "native-file-system-event".to_string(),
            timestamp,
            watch_id: None,
            path: None,
            phase,
            reason: None,
        }
    }

    #[cfg(test)]
    fn with_watch_id_for_test(mut self, watch_id: impl Into<String>) -> Self {
        self.watch_id = Some(watch_id.into());
        self
    }

    #[cfg(test)]
    fn with_path_for_test(mut self, path: CanonicalPathPayload) -> Self {
        self.path = Some(path);
        self
    }

    #[cfg(test)]
    fn with_reason_for_test(mut self, reason: impl Into<String>) -> Self {
        self.reason = Some(reason.into());
        self
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SerializableNativeFileSystemEventPayload<'a> {
    r#type: &'a str,
    timestamp: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    watch_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<&'a CanonicalPathPayload>,
    phase: NativeFileSystemEventPhasePayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'a str>,
}

impl<'a> TryFrom<&'a NativeFileSystemEventPayload>
    for SerializableNativeFileSystemEventPayload<'a>
{
    type Error = &'static str;

    fn try_from(payload: &'a NativeFileSystemEventPayload) -> Result<Self, Self::Error> {
        if payload.r#type != "native-file-system-event" {
            return Err("native filesystem event type must be native-file-system-event");
        }
        validate_native_file_system_event_payload(
            payload.phase,
            &payload.watch_id,
            &payload.path,
            &payload.reason,
        )?;
        Ok(Self {
            r#type: &payload.r#type,
            timestamp: payload.timestamp,
            watch_id: payload.watch_id.as_deref(),
            path: payload.path.as_ref(),
            phase: payload.phase,
            reason: payload.reason.as_deref(),
        })
    }
}

impl Serialize for NativeFileSystemEventPayload {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        SerializableNativeFileSystemEventPayload::try_from(self)
            .map_err(ser::Error::custom)?
            .serialize(serializer)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawNativeFileSystemEventPayload {
    r#type: String,
    timestamp: u64,
    #[serde(default)]
    watch_id: Option<String>,
    #[serde(default)]
    path: Option<CanonicalPathPayload>,
    phase: NativeFileSystemEventPhasePayload,
    #[serde(default)]
    reason: Option<String>,
}

impl TryFrom<RawNativeFileSystemEventPayload> for NativeFileSystemEventPayload {
    type Error = &'static str;

    fn try_from(raw: RawNativeFileSystemEventPayload) -> Result<Self, Self::Error> {
        if raw.r#type != "native-file-system-event" {
            return Err("native filesystem event type must be native-file-system-event");
        }
        validate_native_file_system_event_payload(
            raw.phase,
            &raw.watch_id,
            &raw.path,
            &raw.reason,
        )?;
        Ok(Self {
            r#type: raw.r#type,
            timestamp: raw.timestamp,
            watch_id: raw.watch_id,
            path: raw.path,
            phase: raw.phase,
            reason: raw.reason,
        })
    }
}

impl<'de> Deserialize<'de> for NativeFileSystemEventPayload {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        RawNativeFileSystemEventPayload::deserialize(deserializer)?
            .try_into()
            .map_err(de::Error::custom)
    }
}

fn validate_native_file_system_event_payload(
    phase: NativeFileSystemEventPhasePayload,
    watch_id: &Option<String>,
    path: &Option<CanonicalPathPayload>,
    reason: &Option<String>,
) -> Result<(), &'static str> {
    match phase {
        NativeFileSystemEventPhasePayload::WatchStarted
        | NativeFileSystemEventPhasePayload::Changed
        | NativeFileSystemEventPhasePayload::Removed
            if watch_id.is_some() && path.is_some() && reason.is_none() =>
        {
            Ok(())
        }
        NativeFileSystemEventPhasePayload::WatchStarted
        | NativeFileSystemEventPhasePayload::Changed
        | NativeFileSystemEventPhasePayload::Removed => {
            Err("native filesystem watch change events require watchId and path only")
        }
        NativeFileSystemEventPhasePayload::Failed
            if watch_id.is_some() && path.is_none() && reason.is_some() =>
        {
            Ok(())
        }
        NativeFileSystemEventPhasePayload::Failed => {
            Err("failed native filesystem events require watchId and reason only")
        }
        NativeFileSystemEventPhasePayload::WatchStopped
            if watch_id.is_some() && path.is_none() && reason.is_none() =>
        {
            Ok(())
        }
        NativeFileSystemEventPhasePayload::WatchStopped => {
            Err("watch-stopped native filesystem events require watchId only")
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutostartEnablePayload {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    args: Option<Vec<String>>,
}

impl AutostartEnablePayload {
    pub fn new(args: Option<Vec<String>>) -> Self {
        Self { args }
    }

    pub fn args(&self) -> Option<&[String]> {
        self.args.as_deref()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AutostartMechanismPayload {
    MacosLoginItem,
    WindowsRunKey,
    LinuxXdgAutostart,
    Unsupported,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutostartStatusPayload {
    enabled: bool,
    mechanism: AutostartMechanismPayload,
}

impl AutostartStatusPayload {
    pub fn new(enabled: bool, mechanism: AutostartMechanismPayload) -> Self {
        Self { enabled, mechanism }
    }

    pub fn mechanism(&self) -> AutostartMechanismPayload {
        self.mechanism
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AutostartEventPhasePayload {
    Checked,
    Enabled,
    Disabled,
    Failed,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AutostartEventPayload {
    phase: AutostartEventPhasePayload,
    mechanism: Option<AutostartMechanismPayload>,
    reason: Option<String>,
}

impl AutostartEventPayload {
    pub fn new(
        phase: AutostartEventPhasePayload,
        mechanism: Option<AutostartMechanismPayload>,
        reason: Option<String>,
    ) -> Self {
        Self {
            phase,
            mechanism,
            reason,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SerializableAutostartEventPayload<'a> {
    phase: AutostartEventPhasePayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    mechanism: Option<AutostartMechanismPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'a str>,
}

impl<'a> TryFrom<&'a AutostartEventPayload> for SerializableAutostartEventPayload<'a> {
    type Error = &'static str;

    fn try_from(payload: &'a AutostartEventPayload) -> Result<Self, Self::Error> {
        validate_autostart_event_payload(payload.phase, &payload.mechanism, &payload.reason)?;
        Ok(Self {
            phase: payload.phase,
            mechanism: payload.mechanism,
            reason: payload.reason.as_deref(),
        })
    }
}

impl Serialize for AutostartEventPayload {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        SerializableAutostartEventPayload::try_from(self)
            .map_err(ser::Error::custom)?
            .serialize(serializer)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawAutostartEventPayload {
    phase: AutostartEventPhasePayload,
    mechanism: Option<AutostartMechanismPayload>,
    reason: Option<String>,
}

impl TryFrom<RawAutostartEventPayload> for AutostartEventPayload {
    type Error = &'static str;

    fn try_from(raw: RawAutostartEventPayload) -> Result<Self, Self::Error> {
        validate_autostart_event_payload(raw.phase, &raw.mechanism, &raw.reason)?;
        Ok(Self {
            phase: raw.phase,
            mechanism: raw.mechanism,
            reason: raw.reason,
        })
    }
}

impl<'de> Deserialize<'de> for AutostartEventPayload {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        RawAutostartEventPayload::deserialize(deserializer)?
            .try_into()
            .map_err(de::Error::custom)
    }
}

fn validate_autostart_event_payload(
    phase: AutostartEventPhasePayload,
    mechanism: &Option<AutostartMechanismPayload>,
    reason: &Option<String>,
) -> Result<(), &'static str> {
    match phase {
        AutostartEventPhasePayload::Checked
        | AutostartEventPhasePayload::Enabled
        | AutostartEventPhasePayload::Disabled
            if mechanism.is_some() && reason.is_none() =>
        {
            Ok(())
        }
        AutostartEventPhasePayload::Checked
        | AutostartEventPhasePayload::Enabled
        | AutostartEventPhasePayload::Disabled => {
            Err("successful autostart events require mechanism only")
        }
        AutostartEventPhasePayload::Failed if reason.is_some() => Ok(()),
        AutostartEventPhasePayload::Failed => Err("failed autostart events require reason"),
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DialogFileFilterPayload {
    name: String,
    extensions: Vec<String>,
}

impl DialogFileFilterPayload {
    pub fn new(name: impl Into<String>, extensions: Vec<String>) -> Self {
        Self {
            name: name.into(),
            extensions,
        }
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn extensions(&self) -> &[String] {
        &self.extensions
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DialogOpenFilePayload {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    default_path: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    filters: Vec<DialogFileFilterPayload>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    multiple: Option<bool>,
}

impl DialogOpenFilePayload {
    pub fn new() -> Self {
        Self {
            title: None,
            default_path: None,
            filters: Vec::new(),
            multiple: None,
        }
    }

    pub fn with_title(mut self, title: impl Into<String>) -> Self {
        self.title = Some(title.into());
        self
    }

    pub fn with_default_path(mut self, default_path: impl Into<String>) -> Self {
        self.default_path = Some(default_path.into());
        self
    }

    pub fn with_filters(mut self, filters: Vec<DialogFileFilterPayload>) -> Self {
        self.filters = filters;
        self
    }

    pub fn with_multiple(mut self, multiple: bool) -> Self {
        self.multiple = Some(multiple);
        self
    }

    pub fn title(&self) -> Option<&str> {
        self.title.as_deref()
    }

    pub fn default_path(&self) -> Option<&str> {
        self.default_path.as_deref()
    }

    pub fn filters(&self) -> &[DialogFileFilterPayload] {
        &self.filters
    }

    pub fn multiple(&self) -> bool {
        self.multiple.unwrap_or(false)
    }
}

impl Default for DialogOpenFilePayload {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DialogOpenDirectoryPayload {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    default_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    multiple: Option<bool>,
}

impl DialogOpenDirectoryPayload {
    pub fn new() -> Self {
        Self {
            title: None,
            default_path: None,
            multiple: None,
        }
    }

    pub fn with_title(mut self, title: impl Into<String>) -> Self {
        self.title = Some(title.into());
        self
    }

    pub fn with_default_path(mut self, default_path: impl Into<String>) -> Self {
        self.default_path = Some(default_path.into());
        self
    }

    pub fn with_multiple(mut self, multiple: bool) -> Self {
        self.multiple = Some(multiple);
        self
    }

    pub fn title(&self) -> Option<&str> {
        self.title.as_deref()
    }

    pub fn default_path(&self) -> Option<&str> {
        self.default_path.as_deref()
    }

    pub fn multiple(&self) -> bool {
        self.multiple.unwrap_or(false)
    }
}

impl Default for DialogOpenDirectoryPayload {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DialogSaveFilePayload {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    default_path: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    filters: Vec<DialogFileFilterPayload>,
}

impl DialogSaveFilePayload {
    pub fn new() -> Self {
        Self {
            title: None,
            default_path: None,
            filters: Vec::new(),
        }
    }

    pub fn with_title(mut self, title: impl Into<String>) -> Self {
        self.title = Some(title.into());
        self
    }

    pub fn with_default_path(mut self, default_path: impl Into<String>) -> Self {
        self.default_path = Some(default_path.into());
        self
    }

    pub fn with_filters(mut self, filters: Vec<DialogFileFilterPayload>) -> Self {
        self.filters = filters;
        self
    }

    pub fn title(&self) -> Option<&str> {
        self.title.as_deref()
    }

    pub fn default_path(&self) -> Option<&str> {
        self.default_path.as_deref()
    }

    pub fn filters(&self) -> &[DialogFileFilterPayload] {
        &self.filters
    }
}

impl Default for DialogSaveFilePayload {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DialogLevelPayload {
    Info,
    Warning,
    Error,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DialogMessagePayload {
    level: DialogLevelPayload,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
}

impl DialogMessagePayload {
    pub fn new(level: DialogLevelPayload, message: impl Into<String>) -> Self {
        Self {
            level,
            title: None,
            message: message.into(),
            detail: None,
        }
    }

    pub fn with_title(mut self, title: impl Into<String>) -> Self {
        self.title = Some(title.into());
        self
    }

    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }

    pub fn level(&self) -> DialogLevelPayload {
        self.level
    }

    pub fn title(&self) -> Option<&str> {
        self.title.as_deref()
    }

    pub fn message(&self) -> &str {
        &self.message
    }

    pub fn detail(&self) -> Option<&str> {
        self.detail.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DialogConfirmPayload {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    confirm_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cancel_label: Option<String>,
}

impl DialogConfirmPayload {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            title: None,
            message: message.into(),
            detail: None,
            confirm_label: None,
            cancel_label: None,
        }
    }

    pub fn with_title(mut self, title: impl Into<String>) -> Self {
        self.title = Some(title.into());
        self
    }

    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }

    pub fn with_labels(
        mut self,
        confirm_label: impl Into<String>,
        cancel_label: impl Into<String>,
    ) -> Self {
        self.confirm_label = Some(confirm_label.into());
        self.cancel_label = Some(cancel_label.into());
        self
    }

    pub fn title(&self) -> Option<&str> {
        self.title.as_deref()
    }

    pub fn message(&self) -> &str {
        &self.message
    }

    pub fn detail(&self) -> Option<&str> {
        self.detail.as_deref()
    }

    pub fn confirm_label(&self) -> Option<&str> {
        self.confirm_label.as_deref()
    }

    pub fn cancel_label(&self) -> Option<&str> {
        self.cancel_label.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DialogOpenResultPayload {
    paths: Vec<String>,
}

impl DialogOpenResultPayload {
    pub fn new(paths: Vec<String>) -> Self {
        Self { paths }
    }

    pub fn paths(&self) -> &[String] {
        &self.paths
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DialogSaveResultPayload {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    path: Option<String>,
}

impl DialogSaveResultPayload {
    pub fn selected(path: impl Into<String>) -> Self {
        Self {
            path: Some(path.into()),
        }
    }

    pub fn canceled() -> Self {
        Self { path: None }
    }

    pub fn path(&self) -> Option<&str> {
        self.path.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DialogConfirmResultPayload {
    confirmed: bool,
}

impl DialogConfirmResultPayload {
    pub fn new(confirmed: bool) -> Self {
        Self { confirmed }
    }

    pub fn confirmed(&self) -> bool {
        self.confirmed
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TrayResourcePayload {
    kind: String,
    id: String,
    generation: u64,
    owner_scope: String,
    state: String,
}

impl TrayResourcePayload {
    pub fn new(id: impl Into<String>, generation: u64, owner_scope: impl Into<String>) -> Self {
        Self {
            kind: "tray".to_string(),
            id: id.into(),
            generation,
            owner_scope: owner_scope.into(),
            state: "open".to_string(),
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn kind(&self) -> &str {
        &self.kind
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn owner_scope(&self) -> &str {
        &self.owner_scope
    }

    pub fn state(&self) -> &str {
        &self.state
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TrayCreatePayload {
    icon: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    tooltip: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    menu: Option<Value>,
}

impl TrayCreatePayload {
    pub fn new(icon: impl Into<String>) -> Self {
        Self {
            icon: icon.into(),
            tooltip: None,
            title: None,
            menu: None,
        }
    }

    pub fn icon(&self) -> &str {
        &self.icon
    }

    pub fn tooltip(&self) -> Option<&str> {
        self.tooltip.as_deref()
    }

    pub fn title(&self) -> Option<&str> {
        self.title.as_deref()
    }

    pub fn menu(&self) -> Option<&Value> {
        self.menu.as_ref()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TraySetIconPayload {
    tray: TrayResourcePayload,
    icon: String,
}

impl TraySetIconPayload {
    pub fn tray(&self) -> &TrayResourcePayload {
        &self.tray
    }

    pub fn icon(&self) -> &str {
        &self.icon
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TraySetTooltipPayload {
    tray: TrayResourcePayload,
    tooltip: String,
}

impl TraySetTooltipPayload {
    pub fn tray(&self) -> &TrayResourcePayload {
        &self.tray
    }

    pub fn tooltip(&self) -> &str {
        &self.tooltip
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TraySetTitlePayload {
    tray: TrayResourcePayload,
    title: String,
}

impl TraySetTitlePayload {
    pub fn tray(&self) -> &TrayResourcePayload {
        &self.tray
    }

    pub fn title(&self) -> &str {
        &self.title
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TraySetMenuPayload {
    tray: TrayResourcePayload,
    menu: Value,
}

impl TraySetMenuPayload {
    pub fn tray(&self) -> &TrayResourcePayload {
        &self.tray
    }

    pub fn menu(&self) -> &Value {
        &self.menu
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TrayDestroyPayload {
    tray: TrayResourcePayload,
}

impl TrayDestroyPayload {
    pub fn tray(&self) -> &TrayResourcePayload {
        &self.tray
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TraySupportedPayload {
    supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl TraySupportedPayload {
    pub fn supported() -> Self {
        Self {
            supported: true,
            reason: None,
        }
    }

    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            supported: false,
            reason: Some(reason.into()),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TrayActivatedEventPayload {
    tray: TrayResourcePayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    owner_window_id: Option<String>,
}

impl TrayActivatedEventPayload {
    pub fn new(tray: TrayResourcePayload) -> Self {
        Self {
            tray,
            owner_window_id: None,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MenuActivatedEventPayload {
    item_id: String,
    command_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    window_id: Option<String>,
}

impl MenuActivatedEventPayload {
    pub fn new(
        item_id: impl Into<String>,
        command_id: impl Into<String>,
        window_id: Option<String>,
    ) -> Self {
        Self {
            item_id: item_id.into(),
            command_id: command_id.into(),
            window_id,
        }
    }

    pub fn item_id(&self) -> &str {
        &self.item_id
    }

    pub fn command_id(&self) -> &str {
        &self.command_id
    }

    pub fn window_id(&self) -> Option<&str> {
        self.window_id.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContextMenuActivatedEventPayload {
    item_id: String,
    command_id: String,
    window_id: String,
}

impl ContextMenuActivatedEventPayload {
    pub fn new(
        item_id: impl Into<String>,
        command_id: impl Into<String>,
        window_id: impl Into<String>,
    ) -> Self {
        Self {
            item_id: item_id.into(),
            command_id: command_id.into(),
            window_id: window_id.into(),
        }
    }

    pub fn item_id(&self) -> &str {
        &self.item_id
    }

    pub fn command_id(&self) -> &str {
        &self.command_id
    }

    pub fn window_id(&self) -> &str {
        &self.window_id
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NotificationResourcePayload {
    kind: String,
    id: String,
    generation: u64,
    owner_scope: String,
    state: String,
}

impl NotificationResourcePayload {
    pub fn new(id: impl Into<String>, generation: u64, owner_scope: impl Into<String>) -> Self {
        Self {
            kind: "notification".to_string(),
            id: id.into(),
            generation,
            owner_scope: owner_scope.into(),
            state: "open".to_string(),
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn kind(&self) -> &str {
        &self.kind
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn owner_scope(&self) -> &str {
        &self.owner_scope
    }

    pub fn state(&self) -> &str {
        &self.state
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NotificationWindowResourcePayload {
    kind: String,
    id: String,
    generation: u64,
    owner_scope: String,
    state: String,
}

impl NotificationWindowResourcePayload {
    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn kind(&self) -> &str {
        &self.kind
    }

    pub fn owner_scope(&self) -> &str {
        &self.owner_scope
    }

    pub fn state(&self) -> &str {
        &self.state
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NotificationActionPayload {
    id: String,
    label: String,
}

impl NotificationActionPayload {
    pub fn new(id: impl Into<String>, label: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn label(&self) -> &str {
        &self.label
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NotificationShowPayload {
    title: String,
    body: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    actions: Vec<NotificationActionPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    owner_window: Option<NotificationWindowResourcePayload>,
}

impl NotificationShowPayload {
    pub fn new(title: impl Into<String>, body: impl Into<String>) -> Self {
        Self {
            title: title.into(),
            body: body.into(),
            actions: Vec::new(),
            owner_window: None,
        }
    }

    pub fn title(&self) -> &str {
        &self.title
    }

    pub fn body(&self) -> &str {
        &self.body
    }

    pub fn actions(&self) -> &[NotificationActionPayload] {
        &self.actions
    }

    pub fn owner_window(&self) -> Option<&NotificationWindowResourcePayload> {
        self.owner_window.as_ref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NotificationClosePayload {
    notification: NotificationResourcePayload,
}

impl NotificationClosePayload {
    pub fn notification(&self) -> &NotificationResourcePayload {
        &self.notification
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NotificationSupportedPayload {
    supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl NotificationSupportedPayload {
    pub fn supported() -> Self {
        Self {
            supported: true,
            reason: None,
        }
    }

    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            supported: false,
            reason: Some(reason.into()),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NotificationPermissionStatePayload {
    Granted,
    Denied,
    Default,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NotificationPermissionPayload {
    state: NotificationPermissionStatePayload,
}

impl NotificationPermissionPayload {
    pub fn new(state: NotificationPermissionStatePayload) -> Self {
        Self { state }
    }

    pub fn state(&self) -> NotificationPermissionStatePayload {
        self.state
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CanonicalPathPayload {
    path: String,
}

impl CanonicalPathPayload {
    pub fn new(path: impl Into<String>) -> Self {
        Self { path: path.into() }
    }

    pub fn path(&self) -> &str {
        &self.path
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProtocolRegisterAppProtocolPayload {
    scheme: String,
}

impl ProtocolRegisterAppProtocolPayload {
    pub fn new(scheme: impl Into<String>) -> Self {
        Self {
            scheme: scheme.into(),
        }
    }

    pub fn scheme(&self) -> &str {
        &self.scheme
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProtocolServeAssetPayload {
    scheme: String,
    root: String,
}

impl ProtocolServeAssetPayload {
    pub fn new(scheme: impl Into<String>, root: impl Into<String>) -> Self {
        Self {
            scheme: scheme.into(),
            root: root.into(),
        }
    }

    pub fn scheme(&self) -> &str {
        &self.scheme
    }

    pub fn root(&self) -> &str {
        &self.root
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProtocolServeRoutePayload {
    scheme: String,
    route: String,
}

impl ProtocolServeRoutePayload {
    pub fn new(scheme: impl Into<String>, route: impl Into<String>) -> Self {
        Self {
            scheme: scheme.into(),
            route: route.into(),
        }
    }

    pub fn scheme(&self) -> &str {
        &self.scheme
    }

    pub fn route(&self) -> &str {
        &self.route
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProtocolDenyPayload {
    scheme: String,
    path: String,
}

impl ProtocolDenyPayload {
    pub fn new(scheme: impl Into<String>, path: impl Into<String>) -> Self {
        Self {
            scheme: scheme.into(),
            path: path.into(),
        }
    }

    pub fn scheme(&self) -> &str {
        &self.scheme
    }

    pub fn path(&self) -> &str {
        &self.path
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NotificationClickEventPayload {
    notification: NotificationResourcePayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    owner_window_id: Option<String>,
}

impl NotificationClickEventPayload {
    pub fn new(notification: NotificationResourcePayload, owner_window_id: Option<String>) -> Self {
        Self {
            notification,
            owner_window_id,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NotificationActionEventPayload {
    notification: NotificationResourcePayload,
    action_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    owner_window_id: Option<String>,
}

impl NotificationActionEventPayload {
    pub fn new(
        notification: NotificationResourcePayload,
        action_id: impl Into<String>,
        owner_window_id: Option<String>,
    ) -> Self {
        Self {
            notification,
            action_id: action_id.into(),
            owner_window_id,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScreenBoundsPayload {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl ScreenBoundsPayload {
    pub fn new(x: f64, y: f64, width: f64, height: f64) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }

    pub fn x(&self) -> f64 {
        self.x
    }

    pub fn y(&self) -> f64 {
        self.y
    }

    pub fn width(&self) -> f64 {
        self.width
    }

    pub fn height(&self) -> f64 {
        self.height
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScreenPointPayload {
    x: f64,
    y: f64,
}

impl ScreenPointPayload {
    pub fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }

    pub fn x(&self) -> f64 {
        self.x
    }

    pub fn y(&self) -> f64 {
        self.y
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScreenDisplayPayload {
    id: String,
    bounds: ScreenBoundsPayload,
    work_area: ScreenBoundsPayload,
    scale_factor: f64,
    primary: bool,
}

impl ScreenDisplayPayload {
    pub fn new(
        id: impl Into<String>,
        bounds: ScreenBoundsPayload,
        work_area: ScreenBoundsPayload,
        scale_factor: f64,
        primary: bool,
    ) -> Self {
        Self {
            id: id.into(),
            bounds,
            work_area,
            scale_factor,
            primary,
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn bounds(&self) -> &ScreenBoundsPayload {
        &self.bounds
    }

    pub fn work_area(&self) -> &ScreenBoundsPayload {
        &self.work_area
    }

    pub fn scale_factor(&self) -> f64 {
        self.scale_factor
    }

    pub fn primary(&self) -> bool {
        self.primary
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct ScreenDisplaysPayload {
    displays: Vec<ScreenDisplayPayload>,
}

impl ScreenDisplaysPayload {
    pub fn new(displays: Vec<ScreenDisplayPayload>) -> Self {
        Self { displays }
    }

    pub fn displays(&self) -> &[ScreenDisplayPayload] {
        &self.displays
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SerializableScreenDisplaysPayload<'a> {
    displays: &'a [ScreenDisplayPayload],
}

impl<'a> TryFrom<&'a ScreenDisplaysPayload> for SerializableScreenDisplaysPayload<'a> {
    type Error = &'static str;

    fn try_from(payload: &'a ScreenDisplaysPayload) -> Result<Self, Self::Error> {
        validate_screen_display_list(&payload.displays)?;
        Ok(Self {
            displays: &payload.displays,
        })
    }
}

impl Serialize for ScreenDisplaysPayload {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        SerializableScreenDisplaysPayload::try_from(self)
            .map_err(ser::Error::custom)?
            .serialize(serializer)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawScreenDisplaysPayload {
    displays: Vec<ScreenDisplayPayload>,
}

impl TryFrom<RawScreenDisplaysPayload> for ScreenDisplaysPayload {
    type Error = &'static str;

    fn try_from(raw: RawScreenDisplaysPayload) -> Result<Self, Self::Error> {
        validate_screen_display_list(&raw.displays)?;
        Ok(Self {
            displays: raw.displays,
        })
    }
}

impl<'de> Deserialize<'de> for ScreenDisplaysPayload {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        RawScreenDisplaysPayload::deserialize(deserializer)?
            .try_into()
            .map_err(de::Error::custom)
    }
}

fn validate_screen_display_list(displays: &[ScreenDisplayPayload]) -> Result<(), &'static str> {
    if displays.is_empty() {
        return Err("screen display payload must include at least one display");
    }

    let primary_count = displays.iter().filter(|display| display.primary()).count();
    if primary_count != 1 {
        return Err("screen display payload must include exactly one primary display");
    }

    Ok(())
}

pub type ScreenDisplaysResultPayload = ScreenDisplaysPayload;

pub type ScreenDisplaysChangedEventPayload = ScreenDisplaysPayload;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ScreenMethodPayload {
    GetDisplays,
    GetPrimaryDisplay,
    GetPointerPoint,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScreenIsSupportedPayload {
    method: ScreenMethodPayload,
}

impl ScreenIsSupportedPayload {
    pub fn method(&self) -> ScreenMethodPayload {
        self.method
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScreenSupportedPayload {
    supported: bool,
}

impl ScreenSupportedPayload {
    pub fn supported() -> Self {
        Self { supported: true }
    }

    pub fn unsupported() -> Self {
        Self { supported: false }
    }

    pub fn is_supported(&self) -> bool {
        self.supported
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShellOpenExternalPayload {
    url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    allowed_schemes: Option<Vec<String>>,
}

impl ShellOpenExternalPayload {
    pub fn new(url: impl Into<String>, allowed_schemes: Option<Vec<String>>) -> Self {
        Self {
            url: url.into(),
            allowed_schemes,
        }
    }

    pub fn url(&self) -> &str {
        &self.url
    }

    pub fn allowed_schemes(&self) -> Option<&[String]> {
        self.allowed_schemes.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShellShowItemInFolderPayload {
    path: String,
}

impl ShellShowItemInFolderPayload {
    pub fn new(path: impl Into<String>) -> Self {
        Self { path: path.into() }
    }

    pub fn path(&self) -> &str {
        &self.path
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShellOpenPathPayload {
    path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    allow_executable: Option<bool>,
}

impl ShellOpenPathPayload {
    pub fn new(path: impl Into<String>, allow_executable: Option<bool>) -> Self {
        Self {
            path: path.into(),
            allow_executable,
        }
    }

    pub fn path(&self) -> &str {
        &self.path
    }

    pub fn allow_executable(&self) -> Option<bool> {
        self.allow_executable
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShellTrashItemPayload {
    path: String,
}

impl ShellTrashItemPayload {
    pub fn new(path: impl Into<String>) -> Self {
        Self { path: path.into() }
    }

    pub fn path(&self) -> &str {
        &self.path
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ClipboardCapabilityPayload {
    Text,
    Html,
    Image,
    Clear,
    Selection,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClipboardTextPayload {
    text: String,
}

impl ClipboardTextPayload {
    pub fn new(text: impl Into<String>) -> Self {
        Self { text: text.into() }
    }

    pub fn text(&self) -> &str {
        &self.text
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClipboardHtmlPayload {
    html: String,
}

impl ClipboardHtmlPayload {
    pub fn new(html: impl Into<String>) -> Self {
        Self { html: html.into() }
    }

    pub fn html(&self) -> &str {
        &self.html
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClipboardImagePayload {
    mime: String,
    bytes: Vec<u8>,
}

impl ClipboardImagePayload {
    pub fn new(mime: impl Into<String>, bytes: Vec<u8>) -> Self {
        Self {
            mime: mime.into(),
            bytes,
        }
    }

    pub fn mime(&self) -> &str {
        &self.mime
    }

    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClipboardIsSupportedPayload {
    capability: ClipboardCapabilityPayload,
}

impl ClipboardIsSupportedPayload {
    pub fn new(capability: ClipboardCapabilityPayload) -> Self {
        Self { capability }
    }

    pub fn capability(&self) -> ClipboardCapabilityPayload {
        self.capability
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClipboardSupportedPayload {
    supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl ClipboardSupportedPayload {
    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            supported: false,
            reason: Some(reason.into()),
        }
    }

    pub fn supported() -> Self {
        Self {
            supported: true,
            reason: None,
        }
    }

    pub fn is_supported(&self) -> bool {
        self.supported
    }

    pub fn reason(&self) -> Option<&str> {
        self.reason.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdaterCheckPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    current_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    manifest_json: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trust_anchors: Option<Vec<UpdaterTrustAnchorPayload>>,
}

impl UpdaterCheckPayload {
    pub fn with_signed_manifest(
        current_version: Option<String>,
        manifest_json: String,
        trust_anchors: Vec<UpdaterTrustAnchorPayload>,
    ) -> Self {
        Self {
            current_version,
            manifest_json: Some(manifest_json),
            trust_anchors: Some(trust_anchors),
        }
    }

    pub fn current_version(&self) -> Option<&str> {
        self.current_version.as_deref()
    }

    pub fn manifest_json(&self) -> Option<&str> {
        self.manifest_json.as_deref()
    }

    pub fn trust_anchors(&self) -> Option<&[UpdaterTrustAnchorPayload]> {
        self.trust_anchors.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdaterTrustAnchorPayload {
    key_version: u32,
    public_key: String,
}

impl UpdaterTrustAnchorPayload {
    pub fn new(key_version: u32, public_key: String) -> Self {
        Self {
            key_version,
            public_key,
        }
    }

    pub fn key_version(&self) -> u32 {
        self.key_version
    }

    pub fn public_key(&self) -> &str {
        &self.public_key
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdaterDownloadPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
}

impl UpdaterDownloadPayload {
    pub fn new(version: Option<String>) -> Self {
        Self { version }
    }

    pub fn version(&self) -> Option<&str> {
        self.version.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdaterInstallPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
}

impl UpdaterInstallPayload {
    pub fn new(version: Option<String>) -> Self {
        Self { version }
    }

    pub fn version(&self) -> Option<&str> {
        self.version.as_deref()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UpdaterStatusState {
    Idle,
    Checking,
    UpdateAvailable,
    Downloading,
    Downloaded,
    Installing,
    Error,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdaterStatusPayload {
    state: UpdaterStatusState,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    progress: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

impl UpdaterStatusPayload {
    pub fn new(
        state: UpdaterStatusState,
        version: Option<String>,
        progress: Option<f64>,
        message: Option<String>,
    ) -> Self {
        Self {
            state,
            version,
            progress,
            message,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdaterCheckResultPayload {
    available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    notes: Option<String>,
}

impl UpdaterCheckResultPayload {
    pub fn unavailable(version: Option<String>, notes: Option<String>) -> Self {
        Self {
            available: false,
            version,
            notes,
        }
    }

    pub fn available(version: impl Into<String>, notes: Option<String>) -> Self {
        Self {
            available: true,
            version: Some(version.into()),
            notes,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdaterPreparingRestartPayload {
    deadline_ms: u64,
}

impl UpdaterPreparingRestartPayload {
    pub fn new(deadline_ms: u64) -> Self {
        Self { deadline_ms }
    }

    pub fn deadline_ms(&self) -> u64 {
        self.deadline_ms
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CrashReporterStartPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    enabled: Option<bool>,
}

impl CrashReporterStartPayload {
    pub fn new(enabled: Option<bool>) -> Self {
        Self { enabled }
    }

    pub fn enabled(&self) -> Option<bool> {
        self.enabled
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CrashReporterBreadcrumbPayload {
    category: String,
    message: String,
    #[serde(default, skip_serializing_if = "OptionalJsonValue::is_missing")]
    details: OptionalJsonValue,
    #[serde(skip_serializing_if = "Option::is_none")]
    timestamp: Option<f64>,
}

impl CrashReporterBreadcrumbPayload {
    pub fn new(
        category: impl Into<String>,
        message: impl Into<String>,
        details: Option<Value>,
        timestamp: Option<f64>,
    ) -> Self {
        Self {
            category: category.into(),
            message: message.into(),
            details: OptionalJsonValue::from_option(details),
            timestamp,
        }
    }

    pub fn category(&self) -> &str {
        &self.category
    }

    pub fn message(&self) -> &str {
        &self.message
    }

    pub fn details(&self) -> Option<&Value> {
        self.details.as_value()
    }

    pub fn timestamp(&self) -> Option<f64> {
        self.timestamp
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
enum OptionalJsonValue {
    #[default]
    Missing,
    Present(Value),
}

impl OptionalJsonValue {
    fn from_option(value: Option<Value>) -> Self {
        match value {
            Some(value) => Self::Present(value),
            None => Self::Missing,
        }
    }

    fn is_missing(&self) -> bool {
        matches!(self, Self::Missing)
    }

    fn as_value(&self) -> Option<&Value> {
        match self {
            Self::Missing => None,
            Self::Present(value) => Some(value),
        }
    }
}

impl Serialize for OptionalJsonValue {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            Self::Missing => serializer.serialize_unit(),
            Self::Present(value) => value.serialize(serializer),
        }
    }
}

impl<'de> Deserialize<'de> for OptionalJsonValue {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Value::deserialize(deserializer).map(Self::Present)
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CrashReporterFlushPayload {
    flushed: u64,
}

impl CrashReporterFlushPayload {
    pub fn new(flushed: u64) -> Self {
        Self { flushed }
    }

    pub fn flushed(&self) -> u64 {
        self.flushed
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CrashReporterReportPayload {
    report_id: String,
    artifact_path: String,
    created_at: u64,
    size_bytes: u64,
    uploaded: bool,
}

impl CrashReporterReportPayload {
    pub fn new(
        report_id: impl Into<String>,
        artifact_path: impl Into<String>,
        created_at: u64,
        size_bytes: u64,
        uploaded: bool,
    ) -> Self {
        Self {
            report_id: report_id.into(),
            artifact_path: artifact_path.into(),
            created_at,
            size_bytes,
            uploaded,
        }
    }

    pub fn report_id(&self) -> &str {
        &self.report_id
    }

    pub fn artifact_path(&self) -> &str {
        &self.artifact_path
    }

    pub fn created_at(&self) -> u64 {
        self.created_at
    }

    pub fn size_bytes(&self) -> u64 {
        self.size_bytes
    }

    pub fn uploaded(&self) -> bool {
        self.uploaded
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CrashReporterGetReportsPayload {
    reports: Vec<CrashReporterReportPayload>,
}

impl CrashReporterGetReportsPayload {
    pub fn new(reports: Vec<CrashReporterReportPayload>) -> Self {
        Self { reports }
    }

    pub fn reports(&self) -> &[CrashReporterReportPayload] {
        &self.reports
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PowerMonitorMethodPayload {
    OnSuspend,
    OnResume,
    OnShutdown,
    OnLockScreen,
    OnUnlockScreen,
    OnPowerSourceChanged,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PowerMonitorIsSupportedPayload {
    method: PowerMonitorMethodPayload,
}

impl PowerMonitorIsSupportedPayload {
    pub fn new(method: PowerMonitorMethodPayload) -> Self {
        Self { method }
    }

    pub fn method(&self) -> PowerMonitorMethodPayload {
        self.method
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PowerMonitorSupportedPayload {
    supported: bool,
}

impl PowerMonitorSupportedPayload {
    pub fn supported() -> Self {
        Self { supported: true }
    }

    pub fn unsupported() -> Self {
        Self { supported: false }
    }

    pub fn is_supported(&self) -> bool {
        self.supported
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PowerMonitorReasonEventPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

pub type PowerMonitorSuspendEventPayload = PowerMonitorReasonEventPayload;
pub type PowerMonitorResumeEventPayload = PowerMonitorReasonEventPayload;
pub type PowerMonitorShutdownEventPayload = PowerMonitorReasonEventPayload;
pub type PowerMonitorLockScreenEventPayload = PowerMonitorReasonEventPayload;
pub type PowerMonitorUnlockScreenEventPayload = PowerMonitorReasonEventPayload;

impl PowerMonitorReasonEventPayload {
    pub fn new(reason: Option<String>) -> Self {
        Self { reason }
    }

    pub fn reason(&self) -> Option<&str> {
        self.reason.as_deref()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PowerMonitorSourcePayload {
    Ac,
    Battery,
    Unknown,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PowerMonitorSourceChangedEventPayload {
    source: PowerMonitorSourcePayload,
}

impl PowerMonitorSourceChangedEventPayload {
    pub fn new(source: PowerMonitorSourcePayload) -> Self {
        Self { source }
    }

    pub fn source(&self) -> PowerMonitorSourcePayload {
        self.source
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SystemAppearanceMethodPayload {
    GetAppearance,
    GetAccentColor,
    GetReducedMotion,
    GetReducedTransparency,
    OnAppearanceChanged,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SystemAppearanceModePayload {
    Light,
    Dark,
    HighContrast,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SystemAppearanceColorPayload {
    r: f64,
    g: f64,
    b: f64,
    a: f64,
}

impl SystemAppearanceColorPayload {
    pub fn new(r: f64, g: f64, b: f64, a: f64) -> Self {
        Self::try_new(r, g, b, a)
            .expect("system appearance color channels must be finite numbers between 0 and 1")
    }

    pub fn try_new(r: f64, g: f64, b: f64, a: f64) -> Result<Self, &'static str> {
        validate_system_appearance_color_channel(r)?;
        validate_system_appearance_color_channel(g)?;
        validate_system_appearance_color_channel(b)?;
        validate_system_appearance_color_channel(a)?;
        Ok(Self { r, g, b, a })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawSystemAppearanceColorPayload {
    r: f64,
    g: f64,
    b: f64,
    a: f64,
}

impl<'de> Deserialize<'de> for SystemAppearanceColorPayload {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = RawSystemAppearanceColorPayload::deserialize(deserializer)?;
        Self::try_new(raw.r, raw.g, raw.b, raw.a).map_err(de::Error::custom)
    }
}

fn validate_system_appearance_color_channel(value: f64) -> Result<(), &'static str> {
    if value.is_finite() && (0.0..=1.0).contains(&value) {
        Ok(())
    } else {
        Err("system appearance color channel must be a finite number between 0 and 1")
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SystemAppearanceResultPayload {
    appearance: SystemAppearanceModePayload,
}

impl SystemAppearanceResultPayload {
    pub fn new(appearance: SystemAppearanceModePayload) -> Self {
        Self { appearance }
    }

    pub fn appearance(&self) -> SystemAppearanceModePayload {
        self.appearance
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SystemAppearanceAccentColorPayload {
    color: Option<SystemAppearanceColorPayload>,
}

impl SystemAppearanceAccentColorPayload {
    pub fn new(color: Option<SystemAppearanceColorPayload>) -> Self {
        Self { color }
    }

    pub fn color(&self) -> Option<&SystemAppearanceColorPayload> {
        self.color.as_ref()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(transparent)]
pub struct SystemAppearanceNullableColorPayload(Option<SystemAppearanceColorPayload>);

impl SystemAppearanceNullableColorPayload {
    pub fn new(color: Option<SystemAppearanceColorPayload>) -> Self {
        Self(color)
    }

    pub fn color(&self) -> Option<&SystemAppearanceColorPayload> {
        self.0.as_ref()
    }
}

impl<'de> Deserialize<'de> for SystemAppearanceNullableColorPayload {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = Value::deserialize(deserializer)?;
        if value.is_null() {
            return Ok(Self(None));
        }
        serde_json::from_value(value)
            .map(Some)
            .map(Self)
            .map_err(de::Error::custom)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SystemAppearanceChangedPayload {
    appearance: SystemAppearanceModePayload,
    accent_color: SystemAppearanceNullableColorPayload,
    reduced_motion: bool,
    reduced_transparency: bool,
}

impl SystemAppearanceChangedPayload {
    pub fn new(
        appearance: SystemAppearanceModePayload,
        accent_color: Option<SystemAppearanceColorPayload>,
        reduced_motion: bool,
        reduced_transparency: bool,
    ) -> Self {
        Self {
            appearance,
            accent_color: SystemAppearanceNullableColorPayload::new(accent_color),
            reduced_motion,
            reduced_transparency,
        }
    }

    pub fn appearance(&self) -> SystemAppearanceModePayload {
        self.appearance
    }

    pub fn accent_color(&self) -> Option<&SystemAppearanceColorPayload> {
        self.accent_color.color()
    }

    pub fn reduced_motion(&self) -> bool {
        self.reduced_motion
    }

    pub fn reduced_transparency(&self) -> bool {
        self.reduced_transparency
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SystemAppearanceBooleanPayload {
    enabled: bool,
}

impl SystemAppearanceBooleanPayload {
    pub fn new(enabled: bool) -> Self {
        Self { enabled }
    }

    pub fn enabled(&self) -> bool {
        self.enabled
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SystemAppearanceIsSupportedPayload {
    method: SystemAppearanceMethodPayload,
}

impl SystemAppearanceIsSupportedPayload {
    pub fn new(method: SystemAppearanceMethodPayload) -> Self {
        Self { method }
    }

    pub fn method(&self) -> SystemAppearanceMethodPayload {
        self.method
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SystemAppearanceSupportedPayload {
    supported: bool,
}

impl SystemAppearanceSupportedPayload {
    pub fn supported() -> Self {
        Self { supported: true }
    }

    pub fn unsupported() -> Self {
        Self { supported: false }
    }

    pub fn is_supported(&self) -> bool {
        self.supported
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowCreatePayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    height: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    parent_window_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    title_bar_style: Option<WindowTitleBarStyle>,
    #[serde(skip_serializing_if = "Option::is_none")]
    vibrancy: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    traffic_lights: Option<WindowTrafficLights>,
}

impl WindowCreatePayload {
    pub fn new(title: Option<String>, width: Option<f64>, height: Option<f64>) -> Self {
        Self {
            title,
            width,
            height,
            parent_window_id: None,
            title_bar_style: None,
            vibrancy: None,
            traffic_lights: None,
        }
    }

    pub fn title(&self) -> Option<&str> {
        self.title.as_deref()
    }

    pub fn width(&self) -> Option<f64> {
        self.width
    }

    pub fn height(&self) -> Option<f64> {
        self.height
    }

    pub fn parent_window_id(&self) -> Option<&str> {
        self.parent_window_id.as_deref()
    }

    pub fn title_bar_style(&self) -> Option<WindowTitleBarStyle> {
        self.title_bar_style
    }

    pub fn vibrancy(&self) -> Option<&str> {
        self.vibrancy.as_deref()
    }

    pub fn traffic_lights(&self) -> Option<&WindowTrafficLights> {
        self.traffic_lights.as_ref()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WindowTitleBarStyle {
    Default,
    Hidden,
    HiddenInset,
    CustomButtonsOnHover,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowTrafficLights {
    x: f64,
    y: f64,
}

impl WindowTrafficLights {
    pub fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }

    pub fn x(&self) -> f64 {
        self.x
    }

    pub fn y(&self) -> f64 {
        self.y
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowCreateResponse {
    window_id: String,
}

impl WindowCreateResponse {
    pub fn new(window_id: impl Into<String>) -> Self {
        Self {
            window_id: window_id.into(),
        }
    }

    pub fn window_id(&self) -> &str {
        &self.window_id
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowDestroyPayload {
    window_id: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowLookupResponse {
    window_id: String,
}

impl WindowLookupResponse {
    pub fn new(window_id: impl Into<String>) -> Self {
        Self {
            window_id: window_id.into(),
        }
    }

    pub fn window_id(&self) -> &str {
        &self.window_id
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowListResponse {
    windows: Vec<WindowLookupResponse>,
}

impl WindowListResponse {
    pub fn new(windows: Vec<WindowLookupResponse>) -> Self {
        Self { windows }
    }

    pub fn windows(&self) -> &[WindowLookupResponse] {
        &self.windows
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowParentResponse {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    parent_window_id: Option<String>,
}

impl WindowParentResponse {
    pub fn new(parent_window_id: Option<String>) -> Self {
        Self { parent_window_id }
    }

    pub fn parent_window_id(&self) -> Option<&str> {
        self.parent_window_id.as_deref()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WindowRegistryEventPhase {
    Opened,
    Shown,
    Hidden,
    Focused,
    CloseRequested,
    Closed,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowRegistryEventPayload {
    #[serde(rename = "type")]
    type_name: String,
    phase: WindowRegistryEventPhase,
    window_id: String,
    terminal: bool,
}

impl WindowRegistryEventPayload {
    pub fn new(window_id: impl Into<String>, phase: WindowRegistryEventPhase) -> Self {
        let terminal = matches!(phase, WindowRegistryEventPhase::Closed);
        Self {
            type_name: "window-registry-event".to_string(),
            phase,
            window_id: window_id.into(),
            terminal,
        }
    }

    pub fn type_name(&self) -> &str {
        &self.type_name
    }

    pub fn phase(&self) -> &WindowRegistryEventPhase {
        &self.phase
    }

    pub fn window_id(&self) -> &str {
        &self.window_id
    }

    pub fn terminal(&self) -> bool {
        self.terminal
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowStateEventPayload {
    #[serde(rename = "type")]
    type_name: String,
    window_id: String,
    state: WindowStatePayload,
}

impl WindowStateEventPayload {
    pub fn new(window_id: impl Into<String>, state: WindowStatePayload) -> Self {
        Self {
            type_name: "window-state-event".to_string(),
            window_id: window_id.into(),
            state,
        }
    }

    pub fn type_name(&self) -> &str {
        &self.type_name
    }

    pub fn window_id(&self) -> &str {
        &self.window_id
    }

    pub fn state(&self) -> &WindowStatePayload {
        &self.state
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowBoundsEventPayload {
    #[serde(rename = "type")]
    type_name: String,
    window_id: String,
    bounds: WindowBoundsPayload,
}

impl WindowBoundsEventPayload {
    pub fn new(window_id: impl Into<String>, bounds: WindowBoundsPayload) -> Self {
        Self {
            type_name: "window-bounds-event".to_string(),
            window_id: window_id.into(),
            bounds,
        }
    }

    pub fn type_name(&self) -> &str {
        &self.type_name
    }

    pub fn window_id(&self) -> &str {
        &self.window_id
    }

    pub fn bounds(&self) -> &WindowBoundsPayload {
        &self.bounds
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawWindowBoundsEventPayload {
    #[serde(rename = "type")]
    type_name: String,
    window_id: String,
    bounds: WindowBoundsPayload,
}

impl<'de> Deserialize<'de> for WindowBoundsEventPayload {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = RawWindowBoundsEventPayload::deserialize(deserializer)?;
        if raw.type_name != "window-bounds-event" {
            return Err(de::Error::custom(
                "window bounds event type must be window-bounds-event",
            ));
        }
        Ok(Self {
            type_name: raw.type_name,
            window_id: raw.window_id,
            bounds: raw.bounds,
        })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawWindowStateEventPayload {
    #[serde(rename = "type")]
    type_name: String,
    window_id: String,
    state: WindowStatePayload,
}

impl<'de> Deserialize<'de> for WindowStateEventPayload {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = RawWindowStateEventPayload::deserialize(deserializer)?;
        if raw.type_name != "window-state-event" {
            return Err(de::Error::custom(
                "window state event type must be window-state-event",
            ));
        }
        Ok(Self {
            type_name: raw.type_name,
            window_id: raw.window_id,
            state: raw.state,
        })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawWindowRegistryEventPayload {
    #[serde(rename = "type")]
    type_name: String,
    phase: WindowRegistryEventPhase,
    window_id: String,
    terminal: bool,
}

impl<'de> Deserialize<'de> for WindowRegistryEventPayload {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = RawWindowRegistryEventPayload::deserialize(deserializer)?;
        if raw.type_name != "window-registry-event" {
            return Err(de::Error::custom(
                "window registry event type must be window-registry-event",
            ));
        }
        let expected_terminal = matches!(raw.phase, WindowRegistryEventPhase::Closed);
        if raw.terminal != expected_terminal {
            return Err(de::Error::custom(
                "window registry event terminal must match phase",
            ));
        }
        Ok(Self {
            type_name: raw.type_name,
            phase: raw.phase,
            window_id: raw.window_id,
            terminal: raw.terminal,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowBoundsPayload {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl WindowBoundsPayload {
    pub fn new(x: f64, y: f64, width: f64, height: f64) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }

    pub fn x(&self) -> f64 {
        self.x
    }

    pub fn y(&self) -> f64 {
        self.y
    }

    pub fn width(&self) -> f64 {
        self.width
    }

    pub fn height(&self) -> f64 {
        self.height
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowSetBoundsPayload {
    window_id: String,
    bounds: WindowBoundsPayload,
}

impl WindowSetBoundsPayload {
    pub fn new(window_id: impl Into<String>, bounds: WindowBoundsPayload) -> Self {
        Self {
            window_id: window_id.into(),
            bounds,
        }
    }

    pub fn window_id(&self) -> &str {
        &self.window_id
    }

    pub fn bounds(&self) -> &WindowBoundsPayload {
        &self.bounds
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowSetBoundsOnDisplayPayload {
    window_id: String,
    display_id: String,
    bounds: WindowBoundsPayload,
}

impl WindowSetBoundsOnDisplayPayload {
    pub fn new(
        window_id: impl Into<String>,
        display_id: impl Into<String>,
        bounds: WindowBoundsPayload,
    ) -> Self {
        Self {
            window_id: window_id.into(),
            display_id: display_id.into(),
            bounds,
        }
    }

    pub fn window_id(&self) -> &str {
        &self.window_id
    }

    pub fn display_id(&self) -> &str {
        &self.display_id
    }

    pub fn bounds(&self) -> &WindowBoundsPayload {
        &self.bounds
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowCenterOnDisplayPayload {
    window_id: String,
    display_id: String,
}

impl WindowCenterOnDisplayPayload {
    pub fn new(window_id: impl Into<String>, display_id: impl Into<String>) -> Self {
        Self {
            window_id: window_id.into(),
            display_id: display_id.into(),
        }
    }

    pub fn window_id(&self) -> &str {
        &self.window_id
    }

    pub fn display_id(&self) -> &str {
        &self.display_id
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowSetTitlePayload {
    window_id: String,
    title: String,
}

impl WindowSetTitlePayload {
    pub fn new(window_id: impl Into<String>, title: impl Into<String>) -> Self {
        Self {
            window_id: window_id.into(),
            title: title.into(),
        }
    }

    pub fn window_id(&self) -> &str {
        &self.window_id
    }

    pub fn title(&self) -> &str {
        &self.title
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowSetResizablePayload {
    window_id: String,
    resizable: bool,
}

impl WindowSetResizablePayload {
    pub fn new(window_id: impl Into<String>, resizable: bool) -> Self {
        Self {
            window_id: window_id.into(),
            resizable,
        }
    }

    pub fn window_id(&self) -> &str {
        &self.window_id
    }

    pub fn resizable(&self) -> bool {
        self.resizable
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowSetDecorationsPayload {
    window_id: String,
    decorations: bool,
}

impl WindowSetDecorationsPayload {
    pub fn new(window_id: impl Into<String>, decorations: bool) -> Self {
        Self {
            window_id: window_id.into(),
            decorations,
        }
    }

    pub fn window_id(&self) -> &str {
        &self.window_id
    }

    pub fn decorations(&self) -> bool {
        self.decorations
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowSetTrafficLightsPayload {
    window_id: String,
    traffic_lights: WindowTrafficLights,
}

impl WindowSetTrafficLightsPayload {
    pub fn new(window_id: impl Into<String>, traffic_lights: WindowTrafficLights) -> Self {
        Self {
            window_id: window_id.into(),
            traffic_lights,
        }
    }

    pub fn window_id(&self) -> &str {
        &self.window_id
    }

    pub fn traffic_lights(&self) -> &WindowTrafficLights {
        &self.traffic_lights
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowSetVibrancyPayload {
    window_id: String,
    material: String,
}

impl WindowSetVibrancyPayload {
    pub fn new(window_id: impl Into<String>, material: impl Into<String>) -> Self {
        Self {
            window_id: window_id.into(),
            material: material.into(),
        }
    }

    pub fn window_id(&self) -> &str {
        &self.window_id
    }

    pub fn material(&self) -> &str {
        &self.material
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowClearVibrancyPayload {
    window_id: String,
}

impl WindowClearVibrancyPayload {
    pub fn new(window_id: impl Into<String>) -> Self {
        Self {
            window_id: window_id.into(),
        }
    }

    pub fn window_id(&self) -> &str {
        &self.window_id
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowSetShadowPayload {
    window_id: String,
    has_shadow: bool,
}

impl WindowSetShadowPayload {
    pub fn new(window_id: impl Into<String>, has_shadow: bool) -> Self {
        Self {
            window_id: window_id.into(),
            has_shadow,
        }
    }

    pub fn window_id(&self) -> &str {
        &self.window_id
    }

    pub fn has_shadow(&self) -> bool {
        self.has_shadow
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowSetTitleBarStylePayload {
    window_id: String,
    title_bar_style: WindowTitleBarStyle,
}

impl WindowSetTitleBarStylePayload {
    pub fn new(window_id: impl Into<String>, title_bar_style: WindowTitleBarStyle) -> Self {
        Self {
            window_id: window_id.into(),
            title_bar_style,
        }
    }

    pub fn window_id(&self) -> &str {
        &self.window_id
    }

    pub fn title_bar_style(&self) -> WindowTitleBarStyle {
        self.title_bar_style
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowSetTitleBarTransparentPayload {
    window_id: String,
    title_bar_transparent: bool,
}

impl WindowSetTitleBarTransparentPayload {
    pub fn new(window_id: impl Into<String>, title_bar_transparent: bool) -> Self {
        Self {
            window_id: window_id.into(),
            title_bar_transparent,
        }
    }

    pub fn window_id(&self) -> &str {
        &self.window_id
    }

    pub fn title_bar_transparent(&self) -> bool {
        self.title_bar_transparent
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowSetTransparentPayload {
    window_id: String,
    transparent: bool,
}

impl WindowSetTransparentPayload {
    pub fn new(window_id: impl Into<String>, transparent: bool) -> Self {
        Self {
            window_id: window_id.into(),
            transparent,
        }
    }

    pub fn window_id(&self) -> &str {
        &self.window_id
    }

    pub fn transparent(&self) -> bool {
        self.transparent
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowSetAlwaysOnTopPayload {
    window_id: String,
    always_on_top: bool,
}

impl WindowSetAlwaysOnTopPayload {
    pub fn new(window_id: impl Into<String>, always_on_top: bool) -> Self {
        Self {
            window_id: window_id.into(),
            always_on_top,
        }
    }

    pub fn window_id(&self) -> &str {
        &self.window_id
    }

    pub fn always_on_top(&self) -> bool {
        self.always_on_top
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowSetSkipTaskbarPayload {
    window_id: String,
    skip_taskbar: bool,
}

impl WindowSetSkipTaskbarPayload {
    pub fn new(window_id: impl Into<String>, skip_taskbar: bool) -> Self {
        Self {
            window_id: window_id.into(),
            skip_taskbar,
        }
    }

    pub fn window_id(&self) -> &str {
        &self.window_id
    }

    pub fn skip_taskbar(&self) -> bool {
        self.skip_taskbar
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WindowProgressState {
    None,
    Normal,
    Indeterminate,
    Paused,
    Error,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowSetProgressPayload {
    window_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    state: Option<WindowProgressState>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    progress: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    desktop_filename: Option<String>,
}

impl WindowSetProgressPayload {
    pub fn new(
        window_id: impl Into<String>,
        state: Option<WindowProgressState>,
        progress: Option<u64>,
        desktop_filename: Option<String>,
    ) -> Self {
        Self {
            window_id: window_id.into(),
            state,
            progress,
            desktop_filename,
        }
    }

    pub fn window_id(&self) -> &str {
        &self.window_id
    }

    pub fn state(&self) -> Option<WindowProgressState> {
        self.state
    }

    pub fn progress(&self) -> Option<u64> {
        self.progress
    }

    pub fn desktop_filename(&self) -> Option<&str> {
        self.desktop_filename.as_deref()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DockProgressState {
    Normal,
    Indeterminate,
    Error,
    Paused,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DockSetProgressOptionsPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    state: Option<DockProgressState>,
}

impl DockSetProgressOptionsPayload {
    pub fn new(state: Option<DockProgressState>) -> Self {
        Self { state }
    }

    pub fn state(&self) -> Option<DockProgressState> {
        self.state
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DockSetProgressPayload {
    value: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    options: Option<DockSetProgressOptionsPayload>,
}

impl DockSetProgressPayload {
    pub fn new(value: serde_json::Value, options: Option<DockSetProgressOptionsPayload>) -> Self {
        Self { value, options }
    }

    pub fn value(&self) -> &serde_json::Value {
        &self.value
    }

    pub fn options(&self) -> Option<&DockSetProgressOptionsPayload> {
        self.options.as_ref()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DockJumpListItemPayload {
    id: String,
    title: String,
    command_id: String,
}

impl DockJumpListItemPayload {
    pub fn new(
        id: impl Into<String>,
        title: impl Into<String>,
        command_id: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            title: title.into(),
            command_id: command_id.into(),
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn title(&self) -> &str {
        &self.title
    }

    pub fn command_id(&self) -> &str {
        &self.command_id
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DockSetJumpListPayload {
    items: Vec<DockJumpListItemPayload>,
}

impl DockSetJumpListPayload {
    pub fn new(items: Vec<DockJumpListItemPayload>) -> Self {
        Self { items }
    }

    pub fn items(&self) -> &[DockJumpListItemPayload] {
        &self.items
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SafeStorageKeyPayload {
    key: String,
}

impl SafeStorageKeyPayload {
    pub fn new(key: impl Into<String>) -> Self {
        Self { key: key.into() }
    }

    pub fn key(&self) -> &str {
        &self.key
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SafeStorageSetPayload {
    key: String,
    value: String,
}

impl SafeStorageSetPayload {
    pub fn new(key: impl Into<String>, value: impl Into<String>) -> Self {
        Self {
            key: key.into(),
            value: value.into(),
        }
    }

    pub fn key(&self) -> &str {
        &self.key
    }

    pub fn value(&self) -> &str {
        &self.value
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SafeStorageListResultPayload {
    keys: Vec<String>,
}

impl SafeStorageListResultPayload {
    pub fn new(keys: Vec<String>) -> Self {
        Self { keys }
    }

    pub fn keys(&self) -> &[String] {
        &self.keys
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WindowAttentionType {
    Critical,
    Informational,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowRequestAttentionPayload {
    window_id: String,
    request_type: WindowAttentionType,
}

impl WindowRequestAttentionPayload {
    pub fn new(window_id: impl Into<String>, request_type: WindowAttentionType) -> Self {
        Self {
            window_id: window_id.into(),
            request_type,
        }
    }

    pub fn window_id(&self) -> &str {
        &self.window_id
    }

    pub fn request_type(&self) -> WindowAttentionType {
        self.request_type
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowSetFullscreenPayload {
    window_id: String,
    fullscreen: bool,
}

impl WindowSetFullscreenPayload {
    pub fn new(window_id: impl Into<String>, fullscreen: bool) -> Self {
        Self {
            window_id: window_id.into(),
            fullscreen,
        }
    }

    pub fn window_id(&self) -> &str {
        &self.window_id
    }

    pub fn fullscreen(&self) -> bool {
        self.fullscreen
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowSetSimpleFullscreenPayload {
    window_id: String,
    simple_fullscreen: bool,
}

impl WindowSetSimpleFullscreenPayload {
    pub fn new(window_id: impl Into<String>, simple_fullscreen: bool) -> Self {
        Self {
            window_id: window_id.into(),
            simple_fullscreen,
        }
    }

    pub fn window_id(&self) -> &str {
        &self.window_id
    }

    pub fn simple_fullscreen(&self) -> bool {
        self.simple_fullscreen
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowStatePayload {
    minimized: bool,
    maximized: bool,
    fullscreen: bool,
    simple_fullscreen: bool,
}

impl WindowStatePayload {
    pub fn new(
        minimized: bool,
        maximized: bool,
        fullscreen: bool,
        simple_fullscreen: bool,
    ) -> Self {
        Self {
            minimized,
            maximized,
            fullscreen,
            simple_fullscreen,
        }
    }

    pub fn minimized(&self) -> bool {
        self.minimized
    }

    pub fn maximized(&self) -> bool {
        self.maximized
    }

    pub fn fullscreen(&self) -> bool {
        self.fullscreen
    }

    pub fn simple_fullscreen(&self) -> bool {
        self.simple_fullscreen
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RealtimeMediaSessionIdentityPayload {
    profile_id: String,
    session_id: String,
}

impl RealtimeMediaSessionIdentityPayload {
    pub fn new(profile_id: impl Into<String>, session_id: impl Into<String>) -> Self {
        Self {
            profile_id: profile_id.into(),
            session_id: session_id.into(),
        }
    }

    pub fn profile_id(&self) -> &str {
        &self.profile_id
    }

    pub fn session_id(&self) -> &str {
        &self.session_id
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RealtimeMediaDeviceKind {
    Microphone,
    Speaker,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RealtimeMediaInterruptionReason {
    System,
    User,
    Background,
    DeviceLost,
    HostFailed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RealtimeMediaPermissionState {
    Unknown,
    PromptRequired,
    Granted,
    Denied,
    Unsupported,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RealtimeMediaSessionState {
    Idle,
    Opening,
    Active,
    Interrupted,
    Closed,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RealtimeMediaSessionSelectDevicePayload {
    profile_id: String,
    session_id: String,
    kind: RealtimeMediaDeviceKind,
    device_id: String,
}

impl RealtimeMediaSessionSelectDevicePayload {
    pub fn new(
        profile_id: impl Into<String>,
        session_id: impl Into<String>,
        kind: RealtimeMediaDeviceKind,
        device_id: impl Into<String>,
    ) -> Self {
        Self {
            profile_id: profile_id.into(),
            session_id: session_id.into(),
            kind,
            device_id: device_id.into(),
        }
    }

    pub fn profile_id(&self) -> &str {
        &self.profile_id
    }

    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub fn kind(&self) -> RealtimeMediaDeviceKind {
        self.kind
    }

    pub fn device_id(&self) -> &str {
        &self.device_id
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RealtimeMediaSessionInterruptPayload {
    profile_id: String,
    session_id: String,
    reason: RealtimeMediaInterruptionReason,
}

impl RealtimeMediaSessionInterruptPayload {
    pub fn new(
        profile_id: impl Into<String>,
        session_id: impl Into<String>,
        reason: RealtimeMediaInterruptionReason,
    ) -> Self {
        Self {
            profile_id: profile_id.into(),
            session_id: session_id.into(),
            reason,
        }
    }

    pub fn profile_id(&self) -> &str {
        &self.profile_id
    }

    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub fn reason(&self) -> RealtimeMediaInterruptionReason {
        self.reason
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RealtimeMediaSessionSupportedPayload {
    supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl RealtimeMediaSessionSupportedPayload {
    pub fn available() -> Self {
        Self {
            supported: true,
            reason: None,
        }
    }

    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            supported: false,
            reason: Some(reason.into()),
        }
    }

    pub fn supported(&self) -> bool {
        self.supported
    }

    pub fn reason(&self) -> Option<&str> {
        self.reason.as_deref()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RealtimeMediaDeviceStatePayload {
    kind: RealtimeMediaDeviceKind,
    device_id: String,
    label: String,
    selected: bool,
    available: bool,
}

impl RealtimeMediaDeviceStatePayload {
    pub fn new(
        kind: RealtimeMediaDeviceKind,
        device_id: impl Into<String>,
        label: impl Into<String>,
        selected: bool,
        available: bool,
    ) -> Self {
        Self {
            kind,
            device_id: device_id.into(),
            label: label.into(),
            selected,
            available,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RealtimeMediaDeviceStateEventPayload {
    #[serde(rename = "type")]
    event_type: String,
    profile_id: String,
    session_id: String,
    devices: Vec<RealtimeMediaDeviceStatePayload>,
}

impl RealtimeMediaDeviceStateEventPayload {
    pub fn new(
        profile_id: impl Into<String>,
        session_id: impl Into<String>,
        devices: Vec<RealtimeMediaDeviceStatePayload>,
    ) -> Self {
        Self {
            event_type: "device-state".to_string(),
            profile_id: profile_id.into(),
            session_id: session_id.into(),
            devices,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RealtimeMediaPermissionStateEventPayload {
    #[serde(rename = "type")]
    event_type: String,
    profile_id: String,
    session_id: String,
    microphone: RealtimeMediaPermissionState,
    speaker: RealtimeMediaPermissionState,
}

impl RealtimeMediaPermissionStateEventPayload {
    pub fn new(
        profile_id: impl Into<String>,
        session_id: impl Into<String>,
        microphone: RealtimeMediaPermissionState,
        speaker: RealtimeMediaPermissionState,
    ) -> Self {
        Self {
            event_type: "permission-state".to_string(),
            profile_id: profile_id.into(),
            session_id: session_id.into(),
            microphone,
            speaker,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RealtimeMediaInterruptionEventPayload {
    #[serde(rename = "type")]
    event_type: String,
    profile_id: String,
    session_id: String,
    reason: RealtimeMediaInterruptionReason,
}

impl RealtimeMediaInterruptionEventPayload {
    pub fn new(
        profile_id: impl Into<String>,
        session_id: impl Into<String>,
        reason: RealtimeMediaInterruptionReason,
    ) -> Self {
        Self {
            event_type: "interruption".to_string(),
            profile_id: profile_id.into(),
            session_id: session_id.into(),
            reason,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RealtimeMediaSessionStateEventPayload {
    #[serde(rename = "type")]
    event_type: String,
    profile_id: String,
    session_id: String,
    state: RealtimeMediaSessionState,
}

impl RealtimeMediaSessionStateEventPayload {
    pub fn new(
        profile_id: impl Into<String>,
        session_id: impl Into<String>,
        state: RealtimeMediaSessionState,
    ) -> Self {
        Self {
            event_type: "session-state".to_string(),
            profile_id: profile_id.into(),
            session_id: session_id.into(),
            state,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DiagnosticsBundleSourceKind {
    Logs,
    Traces,
    CrashReports,
    HostState,
    ExtensionHealth,
    AuditEvents,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AttachmentIntakeActorKind {
    Workspace,
    Extension,
    Tool,
    Process,
    Native,
    App,
    Window,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AttachmentIntakeSource {
    ProvidedByCaller,
    DragDrop,
    Paste,
    FilePicker,
    ClipboardFile,
    Screenshot,
    MimePayload,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AttachmentIntakeState {
    Ingested,
    Disposed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AttachmentIntakeEventPhase {
    Ingested,
    Disposed,
    Failed,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttachmentIntakeActorPayload {
    kind: AttachmentIntakeActorKind,
    id: String,
}

impl AttachmentIntakeActorPayload {
    pub fn new(kind: AttachmentIntakeActorKind, id: impl Into<String>) -> Self {
        Self {
            kind,
            id: id.into(),
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttachmentIntakePolicyPayload {
    allowed_mime_types: Vec<String>,
    max_items: u64,
    max_bytes_per_item: u64,
    max_total_bytes: u64,
    lifetime_millis: u64,
}

impl AttachmentIntakePolicyPayload {
    pub fn new(
        allowed_mime_types: Vec<String>,
        max_items: u64,
        max_bytes_per_item: u64,
        max_total_bytes: u64,
        lifetime_millis: u64,
    ) -> Self {
        Self {
            allowed_mime_types,
            max_items,
            max_bytes_per_item,
            max_total_bytes,
            lifetime_millis,
        }
    }

    pub fn allowed_mime_types(&self) -> &[String] {
        &self.allowed_mime_types
    }

    pub fn max_items(&self) -> u64 {
        self.max_items
    }

    pub fn max_bytes_per_item(&self) -> u64 {
        self.max_bytes_per_item
    }

    pub fn max_total_bytes(&self) -> u64 {
        self.max_total_bytes
    }

    pub fn lifetime_millis(&self) -> u64 {
        self.lifetime_millis
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttachmentIntakeItemInputPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    item_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    mime_type: String,
    source: AttachmentIntakeSource,
    bytes: Vec<u8>,
}

impl AttachmentIntakeItemInputPayload {
    pub fn new(
        item_id: Option<String>,
        name: Option<String>,
        mime_type: impl Into<String>,
        source: AttachmentIntakeSource,
        bytes: Vec<u8>,
    ) -> Self {
        Self {
            item_id,
            name,
            mime_type: mime_type.into(),
            source,
            bytes,
        }
    }

    pub fn item_id(&self) -> Option<&str> {
        self.item_id.as_deref()
    }

    pub fn name(&self) -> Option<&str> {
        self.name.as_deref()
    }

    pub fn mime_type(&self) -> &str {
        &self.mime_type
    }

    pub fn source(&self) -> AttachmentIntakeSource {
        self.source
    }

    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttachmentIntakeItemPayload {
    item_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    mime_type: String,
    source: AttachmentIntakeSource,
    size_bytes: u64,
}

impl AttachmentIntakeItemPayload {
    pub fn new(
        item_id: impl Into<String>,
        name: Option<String>,
        mime_type: impl Into<String>,
        source: AttachmentIntakeSource,
        size_bytes: u64,
    ) -> Self {
        Self {
            item_id: item_id.into(),
            name,
            mime_type: mime_type.into(),
            source,
            size_bytes,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttachmentIntakeIngestPayload {
    actor: AttachmentIntakeActorPayload,
    policy: AttachmentIntakePolicyPayload,
    items: Vec<AttachmentIntakeItemInputPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    intake_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl AttachmentIntakeIngestPayload {
    pub fn new(
        actor: AttachmentIntakeActorPayload,
        policy: AttachmentIntakePolicyPayload,
        items: Vec<AttachmentIntakeItemInputPayload>,
        intake_id: Option<String>,
        trace_id: Option<String>,
    ) -> Self {
        Self {
            actor,
            policy,
            items,
            intake_id,
            trace_id,
        }
    }

    pub fn actor(&self) -> &AttachmentIntakeActorPayload {
        &self.actor
    }

    pub fn policy(&self) -> &AttachmentIntakePolicyPayload {
        &self.policy
    }

    pub fn items(&self) -> &[AttachmentIntakeItemInputPayload] {
        &self.items
    }

    pub fn intake_id(&self) -> Option<&str> {
        self.intake_id.as_deref()
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttachmentIntakeInspectPayload {
    intake_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl AttachmentIntakeInspectPayload {
    pub fn new(intake_id: impl Into<String>, trace_id: Option<String>) -> Self {
        Self {
            intake_id: intake_id.into(),
            trace_id,
        }
    }

    pub fn intake_id(&self) -> &str {
        &self.intake_id
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttachmentIntakeDisposePayload {
    intake_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl AttachmentIntakeDisposePayload {
    pub fn new(intake_id: impl Into<String>, trace_id: Option<String>) -> Self {
        Self {
            intake_id: intake_id.into(),
            trace_id,
        }
    }

    pub fn intake_id(&self) -> &str {
        &self.intake_id
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttachmentIntakeIngestResultPayload {
    intake_id: String,
    items: Vec<AttachmentIntakeItemPayload>,
    state: AttachmentIntakeState,
    expires_at: u64,
}

impl AttachmentIntakeIngestResultPayload {
    pub fn ingested(
        intake_id: impl Into<String>,
        items: Vec<AttachmentIntakeItemPayload>,
        expires_at: u64,
    ) -> Self {
        Self {
            intake_id: intake_id.into(),
            items,
            state: AttachmentIntakeState::Ingested,
            expires_at,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttachmentIntakeInspectResultPayload {
    intake_id: String,
    items: Vec<AttachmentIntakeItemPayload>,
    state: AttachmentIntakeState,
    expires_at: u64,
}

impl AttachmentIntakeInspectResultPayload {
    pub fn new(
        intake_id: impl Into<String>,
        items: Vec<AttachmentIntakeItemPayload>,
        state: AttachmentIntakeState,
        expires_at: u64,
    ) -> Self {
        Self {
            intake_id: intake_id.into(),
            items,
            state,
            expires_at,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttachmentIntakeDisposeResultPayload {
    intake_id: String,
    disposed: bool,
}

impl AttachmentIntakeDisposeResultPayload {
    pub fn new(intake_id: impl Into<String>, disposed: bool) -> Self {
        Self {
            intake_id: intake_id.into(),
            disposed,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttachmentIntakeSupportedPayload {
    supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl AttachmentIntakeSupportedPayload {
    pub fn supported() -> Self {
        Self {
            supported: true,
            reason: None,
        }
    }

    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            supported: false,
            reason: Some(reason.into()),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct AttachmentIntakeEventPayload {
    r#type: String,
    timestamp: u64,
    intake_id: Option<String>,
    phase: AttachmentIntakeEventPhase,
    state: Option<AttachmentIntakeState>,
    item_count: Option<u64>,
    reason: Option<String>,
    message: Option<String>,
}

impl AttachmentIntakeEventPayload {
    pub fn ingested(timestamp: u64, intake_id: impl Into<String>, item_count: u64) -> Self {
        Self {
            r#type: "attachment-intake-event".to_string(),
            timestamp,
            intake_id: Some(intake_id.into()),
            phase: AttachmentIntakeEventPhase::Ingested,
            state: Some(AttachmentIntakeState::Ingested),
            item_count: Some(item_count),
            reason: None,
            message: None,
        }
    }

    pub fn disposed(timestamp: u64, intake_id: impl Into<String>) -> Self {
        Self {
            r#type: "attachment-intake-event".to_string(),
            timestamp,
            intake_id: Some(intake_id.into()),
            phase: AttachmentIntakeEventPhase::Disposed,
            state: Some(AttachmentIntakeState::Disposed),
            item_count: None,
            reason: None,
            message: None,
        }
    }

    pub fn failed(
        timestamp: u64,
        intake_id: impl Into<String>,
        reason: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            r#type: "attachment-intake-event".to_string(),
            timestamp,
            intake_id: Some(intake_id.into()),
            phase: AttachmentIntakeEventPhase::Failed,
            state: None,
            item_count: None,
            reason: Some(reason.into()),
            message: Some(message.into()),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SerializableAttachmentIntakeEventPayload<'a> {
    r#type: &'a str,
    timestamp: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    intake_id: Option<&'a str>,
    phase: AttachmentIntakeEventPhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    state: Option<AttachmentIntakeState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    item_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<&'a str>,
}

impl<'a> TryFrom<&'a AttachmentIntakeEventPayload>
    for SerializableAttachmentIntakeEventPayload<'a>
{
    type Error = &'static str;

    fn try_from(payload: &'a AttachmentIntakeEventPayload) -> Result<Self, Self::Error> {
        validate_attachment_intake_event_payload(
            payload.phase,
            payload.state,
            payload.item_count,
            &payload.reason,
            &payload.message,
        )?;
        Ok(Self {
            r#type: &payload.r#type,
            timestamp: payload.timestamp,
            intake_id: payload.intake_id.as_deref(),
            phase: payload.phase,
            state: payload.state,
            item_count: payload.item_count,
            reason: payload.reason.as_deref(),
            message: payload.message.as_deref(),
        })
    }
}

impl Serialize for AttachmentIntakeEventPayload {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        SerializableAttachmentIntakeEventPayload::try_from(self)
            .map_err(ser::Error::custom)?
            .serialize(serializer)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawAttachmentIntakeEventPayload {
    r#type: String,
    timestamp: u64,
    intake_id: Option<String>,
    phase: AttachmentIntakeEventPhase,
    state: Option<AttachmentIntakeState>,
    item_count: Option<u64>,
    reason: Option<String>,
    message: Option<String>,
}

impl TryFrom<RawAttachmentIntakeEventPayload> for AttachmentIntakeEventPayload {
    type Error = &'static str;

    fn try_from(raw: RawAttachmentIntakeEventPayload) -> Result<Self, Self::Error> {
        validate_attachment_intake_event_payload(
            raw.phase,
            raw.state,
            raw.item_count,
            &raw.reason,
            &raw.message,
        )?;
        Ok(Self {
            r#type: raw.r#type,
            timestamp: raw.timestamp,
            intake_id: raw.intake_id,
            phase: raw.phase,
            state: raw.state,
            item_count: raw.item_count,
            reason: raw.reason,
            message: raw.message,
        })
    }
}

impl<'de> Deserialize<'de> for AttachmentIntakeEventPayload {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        RawAttachmentIntakeEventPayload::deserialize(deserializer)?
            .try_into()
            .map_err(de::Error::custom)
    }
}

fn validate_attachment_intake_event_payload(
    phase: AttachmentIntakeEventPhase,
    state: Option<AttachmentIntakeState>,
    item_count: Option<u64>,
    reason: &Option<String>,
    message: &Option<String>,
) -> Result<(), &'static str> {
    match phase {
        AttachmentIntakeEventPhase::Ingested
            if state == Some(AttachmentIntakeState::Ingested)
                && item_count.is_some()
                && reason.is_none()
                && message.is_none() =>
        {
            Ok(())
        }
        AttachmentIntakeEventPhase::Ingested => {
            Err("ingested attachment intake event requires ingested state and itemCount only")
        }
        AttachmentIntakeEventPhase::Disposed
            if state == Some(AttachmentIntakeState::Disposed)
                && item_count.is_none()
                && reason.is_none()
                && message.is_none() =>
        {
            Ok(())
        }
        AttachmentIntakeEventPhase::Disposed => {
            Err("disposed attachment intake event requires disposed state only")
        }
        AttachmentIntakeEventPhase::Failed
            if state.is_none() && item_count.is_none() && reason.is_some() =>
        {
            Ok(())
        }
        AttachmentIntakeEventPhase::Failed => {
            Err("failed attachment intake event requires reason and no state or itemCount")
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SelectionContextActorKind {
    Workspace,
    Extension,
    Tool,
    Process,
    Native,
    App,
    Window,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SelectionContextAccess {
    Metadata,
    Content,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SelectionContextDocumentKind {
    File,
    BrowserPage,
    EditorBuffer,
    Unknown,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SelectionContextEventPhase {
    FocusChanged,
    SelectionChanged,
    WatchStarted,
    WatchStopped,
    Failed,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectionContextActorPayload {
    kind: SelectionContextActorKind,
    id: String,
}

impl SelectionContextActorPayload {
    pub fn new(kind: SelectionContextActorKind, id: impl Into<String>) -> Self {
        Self {
            kind,
            id: id.into(),
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectionContextReadSelectionPayload {
    actor: SelectionContextActorPayload,
    access: SelectionContextAccess,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl SelectionContextReadSelectionPayload {
    pub fn new(
        actor: SelectionContextActorPayload,
        access: SelectionContextAccess,
        trace_id: Option<String>,
    ) -> Self {
        Self {
            actor,
            access,
            trace_id,
        }
    }

    pub fn actor(&self) -> &SelectionContextActorPayload {
        &self.actor
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectionContextReadDocumentPayload {
    actor: SelectionContextActorPayload,
    access: SelectionContextAccess,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl SelectionContextReadDocumentPayload {
    pub fn new(
        actor: SelectionContextActorPayload,
        access: SelectionContextAccess,
        trace_id: Option<String>,
    ) -> Self {
        Self {
            actor,
            access,
            trace_id,
        }
    }

    pub fn actor(&self) -> &SelectionContextActorPayload {
        &self.actor
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectionContextWatchFocusPayload {
    actor: SelectionContextActorPayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    watch_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    owner_scope: Option<String>,
    access: SelectionContextAccess,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl SelectionContextWatchFocusPayload {
    pub fn new(
        actor: SelectionContextActorPayload,
        watch_id: Option<String>,
        owner_scope: Option<String>,
        access: SelectionContextAccess,
        trace_id: Option<String>,
    ) -> Self {
        Self {
            actor,
            watch_id,
            owner_scope,
            access,
            trace_id,
        }
    }

    pub fn actor(&self) -> &SelectionContextActorPayload {
        &self.actor
    }

    pub fn watch_id(&self) -> Option<&str> {
        self.watch_id.as_deref()
    }

    pub fn owner_scope(&self) -> Option<&str> {
        self.owner_scope.as_deref()
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectionContextStopWatchingPayload {
    actor: SelectionContextActorPayload,
    watch_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl SelectionContextStopWatchingPayload {
    pub fn new(
        actor: SelectionContextActorPayload,
        watch_id: impl Into<String>,
        trace_id: Option<String>,
    ) -> Self {
        Self {
            actor,
            watch_id: watch_id.into(),
            trace_id,
        }
    }

    pub fn actor(&self) -> &SelectionContextActorPayload {
        &self.actor
    }

    pub fn watch_id(&self) -> &str {
        &self.watch_id
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectionContextSelectionMetadataPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    source_application: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mime_type: Option<String>,
    character_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    selection_hash: Option<String>,
}

impl SelectionContextSelectionMetadataPayload {
    pub fn new(
        source_application: Option<String>,
        mime_type: Option<String>,
        character_count: u64,
        selection_hash: Option<String>,
    ) -> Self {
        Self {
            source_application,
            mime_type,
            character_count,
            selection_hash,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectionContextDocumentMetadataPayload {
    document_id: String,
    kind: SelectionContextDocumentKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    application_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    buffer_id: Option<String>,
}

impl SelectionContextDocumentMetadataPayload {
    pub fn new(document_id: impl Into<String>, kind: SelectionContextDocumentKind) -> Self {
        Self {
            document_id: document_id.into(),
            kind,
            title: None,
            application_id: None,
            file_path: None,
            url: None,
            buffer_id: None,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectionContextReadSelectionResultPayload {
    metadata: SelectionContextSelectionMetadataPayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
}

impl SelectionContextReadSelectionResultPayload {
    pub fn new(metadata: SelectionContextSelectionMetadataPayload, text: Option<String>) -> Self {
        Self { metadata, text }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectionContextReadDocumentResultPayload {
    metadata: SelectionContextDocumentMetadataPayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
}

impl SelectionContextReadDocumentResultPayload {
    pub fn new(metadata: SelectionContextDocumentMetadataPayload, text: Option<String>) -> Self {
        Self { metadata, text }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectionContextWatchFocusResultPayload {
    watch_id: String,
    active: bool,
    access: SelectionContextAccess,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectionContextStopWatchingResultPayload {
    watch_id: String,
    stopped: bool,
}

impl SelectionContextStopWatchingResultPayload {
    pub fn new(watch_id: impl Into<String>, stopped: bool) -> Self {
        Self {
            watch_id: watch_id.into(),
            stopped,
        }
    }
}

impl SelectionContextWatchFocusResultPayload {
    pub fn new(watch_id: impl Into<String>, active: bool, access: SelectionContextAccess) -> Self {
        Self {
            watch_id: watch_id.into(),
            active,
            access,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectionContextSupportedPayload {
    supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl SelectionContextSupportedPayload {
    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            supported: false,
            reason: Some(reason.into()),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct SelectionContextEventPayload {
    r#type: String,
    timestamp: u64,
    phase: SelectionContextEventPhase,
    watch_id: Option<String>,
    document: Option<SelectionContextDocumentMetadataPayload>,
    selection: Option<SelectionContextSelectionMetadataPayload>,
    reason: Option<String>,
    message: Option<String>,
}

impl SelectionContextEventPayload {
    pub fn focus_changed(
        timestamp: u64,
        document: SelectionContextDocumentMetadataPayload,
    ) -> Self {
        Self {
            r#type: "selection-context-event".to_string(),
            timestamp,
            phase: SelectionContextEventPhase::FocusChanged,
            watch_id: None,
            document: Some(document),
            selection: None,
            reason: None,
            message: None,
        }
    }

    pub fn selection_changed(
        timestamp: u64,
        selection: SelectionContextSelectionMetadataPayload,
    ) -> Self {
        Self {
            r#type: "selection-context-event".to_string(),
            timestamp,
            phase: SelectionContextEventPhase::SelectionChanged,
            watch_id: None,
            document: None,
            selection: Some(selection),
            reason: None,
            message: None,
        }
    }

    pub fn watch_started(timestamp: u64, watch_id: impl Into<String>) -> Self {
        Self {
            r#type: "selection-context-event".to_string(),
            timestamp,
            phase: SelectionContextEventPhase::WatchStarted,
            watch_id: Some(watch_id.into()),
            document: None,
            selection: None,
            reason: None,
            message: None,
        }
    }

    pub fn watch_stopped(timestamp: u64, watch_id: impl Into<String>) -> Self {
        Self {
            r#type: "selection-context-event".to_string(),
            timestamp,
            phase: SelectionContextEventPhase::WatchStopped,
            watch_id: Some(watch_id.into()),
            document: None,
            selection: None,
            reason: None,
            message: None,
        }
    }

    pub fn failed(timestamp: u64, reason: impl Into<String>) -> Self {
        Self {
            r#type: "selection-context-event".to_string(),
            timestamp,
            phase: SelectionContextEventPhase::Failed,
            watch_id: None,
            document: None,
            selection: None,
            reason: Some(reason.into()),
            message: None,
        }
    }

    pub fn with_watch_id(mut self, watch_id: impl Into<String>) -> Self {
        self.watch_id = Some(watch_id.into());
        self
    }

    pub fn with_document(mut self, document: SelectionContextDocumentMetadataPayload) -> Self {
        self.document = Some(document);
        self
    }

    pub fn with_message(mut self, message: impl Into<String>) -> Self {
        self.message = Some(message.into());
        self
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SerializableSelectionContextEventPayload<'a> {
    r#type: &'a str,
    timestamp: u64,
    phase: SelectionContextEventPhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    watch_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    document: Option<&'a SelectionContextDocumentMetadataPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    selection: Option<&'a SelectionContextSelectionMetadataPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<&'a str>,
}

impl<'a> TryFrom<&'a SelectionContextEventPayload>
    for SerializableSelectionContextEventPayload<'a>
{
    type Error = &'static str;

    fn try_from(payload: &'a SelectionContextEventPayload) -> Result<Self, Self::Error> {
        validate_selection_context_event_payload(
            &payload.r#type,
            payload.phase,
            payload.watch_id.as_deref(),
            payload.document.as_ref(),
            payload.selection.as_ref(),
            payload.reason.as_deref(),
            payload.message.as_deref(),
        )?;
        Ok(Self {
            r#type: &payload.r#type,
            timestamp: payload.timestamp,
            phase: payload.phase,
            watch_id: payload.watch_id.as_deref(),
            document: payload.document.as_ref(),
            selection: payload.selection.as_ref(),
            reason: payload.reason.as_deref(),
            message: payload.message.as_deref(),
        })
    }
}

impl Serialize for SelectionContextEventPayload {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        SerializableSelectionContextEventPayload::try_from(self)
            .map_err(ser::Error::custom)?
            .serialize(serializer)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawSelectionContextEventPayload {
    r#type: String,
    timestamp: u64,
    phase: SelectionContextEventPhase,
    #[serde(default)]
    watch_id: Option<String>,
    #[serde(default)]
    document: Option<SelectionContextDocumentMetadataPayload>,
    #[serde(default)]
    selection: Option<SelectionContextSelectionMetadataPayload>,
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    message: Option<String>,
}

impl TryFrom<RawSelectionContextEventPayload> for SelectionContextEventPayload {
    type Error = &'static str;

    fn try_from(raw: RawSelectionContextEventPayload) -> Result<Self, Self::Error> {
        validate_selection_context_event_payload(
            &raw.r#type,
            raw.phase,
            raw.watch_id.as_deref(),
            raw.document.as_ref(),
            raw.selection.as_ref(),
            raw.reason.as_deref(),
            raw.message.as_deref(),
        )?;
        Ok(Self {
            r#type: raw.r#type,
            timestamp: raw.timestamp,
            phase: raw.phase,
            watch_id: raw.watch_id,
            document: raw.document,
            selection: raw.selection,
            reason: raw.reason,
            message: raw.message,
        })
    }
}

impl<'de> Deserialize<'de> for SelectionContextEventPayload {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        RawSelectionContextEventPayload::deserialize(deserializer)?
            .try_into()
            .map_err(de::Error::custom)
    }
}

fn validate_selection_context_event_payload(
    event_type: &str,
    phase: SelectionContextEventPhase,
    watch_id: Option<&str>,
    document: Option<&SelectionContextDocumentMetadataPayload>,
    selection: Option<&SelectionContextSelectionMetadataPayload>,
    reason: Option<&str>,
    message: Option<&str>,
) -> Result<(), &'static str> {
    if event_type != "selection-context-event" {
        return Err("selection context event type must match the protocol event name");
    }

    match phase {
        SelectionContextEventPhase::FocusChanged
            if document.is_some()
                && selection.is_none()
                && reason.is_none()
                && message.is_none() =>
        {
            Ok(())
        }
        SelectionContextEventPhase::FocusChanged => {
            Err("focus-changed selection context events require document and no selection or failure metadata")
        }
        SelectionContextEventPhase::SelectionChanged
            if selection.is_some() && reason.is_none() && message.is_none() =>
        {
            Ok(())
        }
        SelectionContextEventPhase::SelectionChanged => {
            Err("selection-changed selection context events require selection and no failure metadata")
        }
        SelectionContextEventPhase::WatchStarted | SelectionContextEventPhase::WatchStopped
            if watch_id.is_some()
                && document.is_none()
                && selection.is_none()
                && reason.is_none()
                && message.is_none() =>
        {
            Ok(())
        }
        SelectionContextEventPhase::WatchStarted | SelectionContextEventPhase::WatchStopped => {
            Err("watch lifecycle selection context events require watch id only")
        }
        SelectionContextEventPhase::Failed
            if reason.is_some() && document.is_none() && selection.is_none() =>
        {
            Ok(())
        }
        SelectionContextEventPhase::Failed => {
            Err("failed selection context events require reason and no context payload")
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FocusedApplicationContextActorKind {
    Workspace,
    Extension,
    Tool,
    Process,
    Native,
    App,
    Window,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FocusedApplicationContextEventPhase {
    FocusChanged,
    WatchStarted,
    WatchStopped,
    Failed,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FocusedApplicationContextActorPayload {
    kind: FocusedApplicationContextActorKind,
    id: String,
}

impl FocusedApplicationContextActorPayload {
    pub fn new(kind: FocusedApplicationContextActorKind, id: impl Into<String>) -> Self {
        Self {
            kind,
            id: id.into(),
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FocusedApplicationContextSnapshotPayload {
    actor: FocusedApplicationContextActorPayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl FocusedApplicationContextSnapshotPayload {
    pub fn new(actor: FocusedApplicationContextActorPayload, trace_id: Option<String>) -> Self {
        Self { actor, trace_id }
    }

    pub fn actor(&self) -> &FocusedApplicationContextActorPayload {
        &self.actor
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FocusedApplicationContextWatchPayload {
    actor: FocusedApplicationContextActorPayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    watch_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    owner_scope: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl FocusedApplicationContextWatchPayload {
    pub fn new(
        actor: FocusedApplicationContextActorPayload,
        watch_id: Option<String>,
        owner_scope: Option<String>,
        trace_id: Option<String>,
    ) -> Self {
        Self {
            actor,
            watch_id,
            owner_scope,
            trace_id,
        }
    }

    pub fn actor(&self) -> &FocusedApplicationContextActorPayload {
        &self.actor
    }

    pub fn watch_id(&self) -> Option<&str> {
        self.watch_id.as_deref()
    }

    pub fn owner_scope(&self) -> Option<&str> {
        self.owner_scope.as_deref()
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FocusedApplicationContextStopWatchingPayload {
    actor: FocusedApplicationContextActorPayload,
    watch_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl FocusedApplicationContextStopWatchingPayload {
    pub fn new(
        actor: FocusedApplicationContextActorPayload,
        watch_id: impl Into<String>,
        trace_id: Option<String>,
    ) -> Self {
        Self {
            actor,
            watch_id: watch_id.into(),
            trace_id,
        }
    }

    pub fn actor(&self) -> &FocusedApplicationContextActorPayload {
        &self.actor
    }

    pub fn watch_id(&self) -> &str {
        &self.watch_id
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FocusedApplicationContextBoundsPayload {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl FocusedApplicationContextBoundsPayload {
    pub fn new(x: f64, y: f64, width: f64, height: f64) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FocusedApplicationMetadataPayload {
    application_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bundle_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    package_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    executable_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    process_id: Option<u64>,
}

impl FocusedApplicationMetadataPayload {
    pub fn new(application_id: impl Into<String>) -> Self {
        Self {
            application_id: application_id.into(),
            name: None,
            bundle_id: None,
            package_name: None,
            executable_path: None,
            process_id: None,
        }
    }

    pub fn with_name(mut self, name: impl Into<String>) -> Self {
        self.name = Some(name.into());
        self
    }

    pub fn with_bundle_id(mut self, bundle_id: impl Into<String>) -> Self {
        self.bundle_id = Some(bundle_id.into());
        self
    }

    pub fn with_executable_path(mut self, executable_path: impl Into<String>) -> Self {
        self.executable_path = Some(executable_path.into());
        self
    }

    pub fn with_process_id(mut self, process_id: u64) -> Self {
        self.process_id = Some(process_id);
        self
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FocusedWindowMetadataPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    window_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bounds: Option<FocusedApplicationContextBoundsPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    display_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FocusedDisplayMetadataPayload {
    display_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    bounds: Option<FocusedApplicationContextBoundsPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    scale_factor: Option<f64>,
}

impl FocusedDisplayMetadataPayload {
    pub fn new(display_id: impl Into<String>) -> Self {
        Self {
            display_id: display_id.into(),
            bounds: None,
            scale_factor: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FocusedApplicationContextSnapshotResultPayload {
    application: FocusedApplicationMetadataPayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    window: Option<FocusedWindowMetadataPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    display: Option<FocusedDisplayMetadataPayload>,
    observed_at: u64,
}

impl FocusedApplicationContextSnapshotResultPayload {
    pub fn new(application: FocusedApplicationMetadataPayload, observed_at: u64) -> Self {
        Self {
            application,
            window: None,
            display: None,
            observed_at,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FocusedApplicationContextWatchResultPayload {
    watch_id: String,
    active: bool,
}

impl FocusedApplicationContextWatchResultPayload {
    pub fn new(watch_id: impl Into<String>, active: bool) -> Self {
        Self {
            watch_id: watch_id.into(),
            active,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FocusedApplicationContextStopWatchingResultPayload {
    watch_id: String,
    stopped: bool,
}

impl FocusedApplicationContextStopWatchingResultPayload {
    pub fn new(watch_id: impl Into<String>, stopped: bool) -> Self {
        Self {
            watch_id: watch_id.into(),
            stopped,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FocusedApplicationContextSupportedPayload {
    supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl FocusedApplicationContextSupportedPayload {
    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            supported: false,
            reason: Some(reason.into()),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct FocusedApplicationContextEventPayload {
    r#type: String,
    timestamp: u64,
    phase: FocusedApplicationContextEventPhase,
    watch_id: Option<String>,
    snapshot: Option<FocusedApplicationContextSnapshotResultPayload>,
    reason: Option<String>,
    message: Option<String>,
}

impl FocusedApplicationContextEventPayload {
    pub fn focus_changed(
        timestamp: u64,
        snapshot: FocusedApplicationContextSnapshotResultPayload,
    ) -> Self {
        Self {
            r#type: "focused-application-context-event".to_string(),
            timestamp,
            phase: FocusedApplicationContextEventPhase::FocusChanged,
            watch_id: None,
            snapshot: Some(snapshot),
            reason: None,
            message: None,
        }
    }

    pub fn watch_started(timestamp: u64, watch_id: impl Into<String>) -> Self {
        Self {
            r#type: "focused-application-context-event".to_string(),
            timestamp,
            phase: FocusedApplicationContextEventPhase::WatchStarted,
            watch_id: Some(watch_id.into()),
            snapshot: None,
            reason: None,
            message: None,
        }
    }

    pub fn watch_stopped(timestamp: u64, watch_id: impl Into<String>) -> Self {
        Self {
            r#type: "focused-application-context-event".to_string(),
            timestamp,
            phase: FocusedApplicationContextEventPhase::WatchStopped,
            watch_id: Some(watch_id.into()),
            snapshot: None,
            reason: None,
            message: None,
        }
    }

    pub fn failed(timestamp: u64, reason: impl Into<String>) -> Self {
        Self {
            r#type: "focused-application-context-event".to_string(),
            timestamp,
            phase: FocusedApplicationContextEventPhase::Failed,
            watch_id: None,
            snapshot: None,
            reason: Some(reason.into()),
            message: None,
        }
    }

    pub fn with_watch_id(mut self, watch_id: impl Into<String>) -> Self {
        self.watch_id = Some(watch_id.into());
        self
    }

    pub fn with_message(mut self, message: impl Into<String>) -> Self {
        self.message = Some(message.into());
        self
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SerializableFocusedApplicationContextEventPayload<'a> {
    r#type: &'a str,
    timestamp: u64,
    phase: FocusedApplicationContextEventPhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    watch_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    snapshot: Option<&'a FocusedApplicationContextSnapshotResultPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<&'a str>,
}

impl<'a> TryFrom<&'a FocusedApplicationContextEventPayload>
    for SerializableFocusedApplicationContextEventPayload<'a>
{
    type Error = &'static str;

    fn try_from(payload: &'a FocusedApplicationContextEventPayload) -> Result<Self, Self::Error> {
        validate_focused_application_context_event_payload(
            &payload.r#type,
            payload.phase,
            payload.watch_id.as_deref(),
            payload.snapshot.as_ref(),
            payload.reason.as_deref(),
            payload.message.as_deref(),
        )?;
        Ok(Self {
            r#type: &payload.r#type,
            timestamp: payload.timestamp,
            phase: payload.phase,
            watch_id: payload.watch_id.as_deref(),
            snapshot: payload.snapshot.as_ref(),
            reason: payload.reason.as_deref(),
            message: payload.message.as_deref(),
        })
    }
}

impl Serialize for FocusedApplicationContextEventPayload {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        SerializableFocusedApplicationContextEventPayload::try_from(self)
            .map_err(ser::Error::custom)?
            .serialize(serializer)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawFocusedApplicationContextEventPayload {
    r#type: String,
    timestamp: u64,
    phase: FocusedApplicationContextEventPhase,
    #[serde(default)]
    watch_id: Option<String>,
    #[serde(default)]
    snapshot: Option<FocusedApplicationContextSnapshotResultPayload>,
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    message: Option<String>,
}

impl TryFrom<RawFocusedApplicationContextEventPayload> for FocusedApplicationContextEventPayload {
    type Error = &'static str;

    fn try_from(raw: RawFocusedApplicationContextEventPayload) -> Result<Self, Self::Error> {
        validate_focused_application_context_event_payload(
            &raw.r#type,
            raw.phase,
            raw.watch_id.as_deref(),
            raw.snapshot.as_ref(),
            raw.reason.as_deref(),
            raw.message.as_deref(),
        )?;
        Ok(Self {
            r#type: raw.r#type,
            timestamp: raw.timestamp,
            phase: raw.phase,
            watch_id: raw.watch_id,
            snapshot: raw.snapshot,
            reason: raw.reason,
            message: raw.message,
        })
    }
}

impl<'de> Deserialize<'de> for FocusedApplicationContextEventPayload {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        RawFocusedApplicationContextEventPayload::deserialize(deserializer)?
            .try_into()
            .map_err(de::Error::custom)
    }
}

fn validate_focused_application_context_event_payload(
    event_type: &str,
    phase: FocusedApplicationContextEventPhase,
    watch_id: Option<&str>,
    snapshot: Option<&FocusedApplicationContextSnapshotResultPayload>,
    reason: Option<&str>,
    message: Option<&str>,
) -> Result<(), &'static str> {
    if event_type != "focused-application-context-event" {
        return Err("focused application context event type must match the protocol event name");
    }

    match phase {
        FocusedApplicationContextEventPhase::FocusChanged
            if snapshot.is_some() && reason.is_none() && message.is_none() =>
        {
            Ok(())
        }
        FocusedApplicationContextEventPhase::FocusChanged => {
            Err("focus-changed focused application context events require snapshot and no failure metadata")
        }
        FocusedApplicationContextEventPhase::WatchStarted
        | FocusedApplicationContextEventPhase::WatchStopped
            if watch_id.is_some()
                && snapshot.is_none()
                && reason.is_none()
                && message.is_none() =>
        {
            Ok(())
        }
        FocusedApplicationContextEventPhase::WatchStarted
        | FocusedApplicationContextEventPhase::WatchStopped => {
            Err("watch lifecycle focused application context events require watch id only")
        }
        FocusedApplicationContextEventPhase::Failed if reason.is_some() && snapshot.is_none() => {
            Ok(())
        }
        FocusedApplicationContextEventPhase::Failed => {
            Err("failed focused application context events require reason and no snapshot")
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DisplayCaptureActorKind {
    Workspace,
    Extension,
    Tool,
    Process,
    Native,
    App,
    Window,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DisplayCaptureGrantKind {
    User,
    Policy,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DisplayCaptureSource {
    Display,
    Window,
    Region,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DisplayCaptureEventPhase {
    Captured,
    Failed,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DisplayCaptureActorPayload {
    kind: DisplayCaptureActorKind,
    id: String,
}

impl DisplayCaptureActorPayload {
    pub fn new(kind: DisplayCaptureActorKind, id: impl Into<String>) -> Self {
        Self {
            kind,
            id: id.into(),
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DisplayCaptureGrantPayload {
    kind: DisplayCaptureGrantKind,
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl DisplayCaptureGrantPayload {
    pub fn new(kind: DisplayCaptureGrantKind, id: impl Into<String>) -> Self {
        Self {
            kind,
            id: id.into(),
            reason: None,
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn reason(&self) -> Option<&str> {
        self.reason.as_deref()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DisplayCaptureRegionPayload {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl DisplayCaptureRegionPayload {
    pub fn new(x: f64, y: f64, width: f64, height: f64) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }

    pub fn values(&self) -> (f64, f64, f64, f64) {
        (self.x, self.y, self.width, self.height)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DisplayCaptureTargetPayload {
    source: DisplayCaptureSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    display_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    window_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    region: Option<DisplayCaptureRegionPayload>,
}

impl DisplayCaptureTargetPayload {
    pub fn display(display_id: impl Into<String>) -> Self {
        Self {
            source: DisplayCaptureSource::Display,
            display_id: Some(display_id.into()),
            window_id: None,
            region: None,
        }
    }

    pub fn window(window_id: impl Into<String>) -> Self {
        Self {
            source: DisplayCaptureSource::Window,
            display_id: None,
            window_id: Some(window_id.into()),
            region: None,
        }
    }

    pub fn region(display_id: impl Into<String>, region: DisplayCaptureRegionPayload) -> Self {
        Self {
            source: DisplayCaptureSource::Region,
            display_id: Some(display_id.into()),
            window_id: None,
            region: Some(region),
        }
    }

    pub fn source(&self) -> DisplayCaptureSource {
        self.source
    }

    pub fn display_id(&self) -> Option<&str> {
        self.display_id.as_deref()
    }

    pub fn window_id(&self) -> Option<&str> {
        self.window_id.as_deref()
    }

    pub fn region_payload(&self) -> Option<&DisplayCaptureRegionPayload> {
        self.region.as_ref()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DisplayCaptureRequestPayload {
    actor: DisplayCaptureActorPayload,
    grant: DisplayCaptureGrantPayload,
    target: DisplayCaptureTargetPayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl DisplayCaptureRequestPayload {
    pub fn new(
        actor: DisplayCaptureActorPayload,
        grant: DisplayCaptureGrantPayload,
        target: DisplayCaptureTargetPayload,
        trace_id: Option<String>,
    ) -> Self {
        Self {
            actor,
            grant,
            target,
            trace_id,
        }
    }

    pub fn actor(&self) -> &DisplayCaptureActorPayload {
        &self.actor
    }

    pub fn grant(&self) -> &DisplayCaptureGrantPayload {
        &self.grant
    }

    pub fn target(&self) -> &DisplayCaptureTargetPayload {
        &self.target
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DisplayCaptureImagePayload {
    mime: String,
    bytes: Vec<u8>,
}

impl DisplayCaptureImagePayload {
    pub fn new(mime: impl Into<String>, bytes: Vec<u8>) -> Self {
        Self {
            mime: mime.into(),
            bytes,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DisplayCaptureMetadataPayload {
    capture_id: String,
    source: DisplayCaptureSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    display_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    window_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    region: Option<DisplayCaptureRegionPayload>,
    byte_length: u64,
    observed_at: u64,
}

impl DisplayCaptureMetadataPayload {
    pub fn new(
        capture_id: impl Into<String>,
        source: DisplayCaptureSource,
        byte_length: u64,
        observed_at: u64,
    ) -> Self {
        Self {
            capture_id: capture_id.into(),
            source,
            display_id: None,
            window_id: None,
            region: None,
            byte_length,
            observed_at,
        }
    }

    pub fn with_display_id(mut self, display_id: impl Into<String>) -> Self {
        self.display_id = Some(display_id.into());
        self
    }

    pub fn with_window_id(mut self, window_id: impl Into<String>) -> Self {
        self.window_id = Some(window_id.into());
        self
    }

    pub fn with_region(mut self, region: DisplayCaptureRegionPayload) -> Self {
        self.region = Some(region);
        self
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DisplayCaptureResultPayload {
    image: DisplayCaptureImagePayload,
    metadata: DisplayCaptureMetadataPayload,
}

impl DisplayCaptureResultPayload {
    pub fn new(image: DisplayCaptureImagePayload, metadata: DisplayCaptureMetadataPayload) -> Self {
        Self { image, metadata }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DisplayCaptureSupportedPayload {
    supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl DisplayCaptureSupportedPayload {
    pub fn supported() -> Self {
        Self {
            supported: true,
            reason: None,
        }
    }

    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            supported: false,
            reason: Some(reason.into()),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct DisplayCaptureEventPayload {
    r#type: String,
    timestamp: u64,
    phase: DisplayCaptureEventPhase,
    capture_id: Option<String>,
    source: Option<DisplayCaptureSource>,
    byte_length: Option<u64>,
    reason: Option<String>,
    message: Option<String>,
}

impl DisplayCaptureEventPayload {
    pub fn new(timestamp: u64, phase: DisplayCaptureEventPhase) -> Self {
        Self {
            r#type: "display-capture-event".to_string(),
            timestamp,
            phase,
            capture_id: None,
            source: None,
            byte_length: None,
            reason: None,
            message: None,
        }
    }

    pub fn captured(
        timestamp: u64,
        capture_id: impl Into<String>,
        source: DisplayCaptureSource,
        byte_length: u64,
    ) -> Self {
        Self {
            r#type: "display-capture-event".to_string(),
            timestamp,
            phase: DisplayCaptureEventPhase::Captured,
            capture_id: Some(capture_id.into()),
            source: Some(source),
            byte_length: Some(byte_length),
            reason: None,
            message: None,
        }
    }

    pub fn failed(
        timestamp: u64,
        capture_id: impl Into<String>,
        source: DisplayCaptureSource,
        reason: impl Into<String>,
    ) -> Self {
        Self {
            r#type: "display-capture-event".to_string(),
            timestamp,
            phase: DisplayCaptureEventPhase::Failed,
            capture_id: Some(capture_id.into()),
            source: Some(source),
            byte_length: None,
            reason: Some(reason.into()),
            message: None,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SerializableDisplayCaptureEventPayload<'a> {
    r#type: &'a str,
    timestamp: u64,
    phase: DisplayCaptureEventPhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    capture_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<DisplayCaptureSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    byte_length: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<&'a str>,
}

impl<'a> TryFrom<&'a DisplayCaptureEventPayload> for SerializableDisplayCaptureEventPayload<'a> {
    type Error = &'static str;

    fn try_from(payload: &'a DisplayCaptureEventPayload) -> Result<Self, Self::Error> {
        validate_display_capture_event_payload(
            payload.phase,
            &payload.capture_id,
            payload.source,
            payload.byte_length,
            &payload.reason,
            &payload.message,
        )?;
        Ok(Self {
            r#type: &payload.r#type,
            timestamp: payload.timestamp,
            phase: payload.phase,
            capture_id: payload.capture_id.as_deref(),
            source: payload.source,
            byte_length: payload.byte_length,
            reason: payload.reason.as_deref(),
            message: payload.message.as_deref(),
        })
    }
}

impl Serialize for DisplayCaptureEventPayload {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        SerializableDisplayCaptureEventPayload::try_from(self)
            .map_err(ser::Error::custom)?
            .serialize(serializer)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawDisplayCaptureEventPayload {
    r#type: String,
    timestamp: u64,
    phase: DisplayCaptureEventPhase,
    capture_id: Option<String>,
    source: Option<DisplayCaptureSource>,
    byte_length: Option<u64>,
    reason: Option<String>,
    message: Option<String>,
}

impl TryFrom<RawDisplayCaptureEventPayload> for DisplayCaptureEventPayload {
    type Error = &'static str;

    fn try_from(raw: RawDisplayCaptureEventPayload) -> Result<Self, Self::Error> {
        validate_display_capture_event_payload(
            raw.phase,
            &raw.capture_id,
            raw.source,
            raw.byte_length,
            &raw.reason,
            &raw.message,
        )?;
        Ok(Self {
            r#type: raw.r#type,
            timestamp: raw.timestamp,
            phase: raw.phase,
            capture_id: raw.capture_id,
            source: raw.source,
            byte_length: raw.byte_length,
            reason: raw.reason,
            message: raw.message,
        })
    }
}

impl<'de> Deserialize<'de> for DisplayCaptureEventPayload {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        RawDisplayCaptureEventPayload::deserialize(deserializer)?
            .try_into()
            .map_err(de::Error::custom)
    }
}

fn validate_display_capture_event_payload(
    phase: DisplayCaptureEventPhase,
    capture_id: &Option<String>,
    source: Option<DisplayCaptureSource>,
    byte_length: Option<u64>,
    reason: &Option<String>,
    message: &Option<String>,
) -> Result<(), &'static str> {
    match phase {
        DisplayCaptureEventPhase::Captured
            if capture_id.is_some()
                && source.is_some()
                && byte_length.is_some()
                && reason.is_none()
                && message.is_none() =>
        {
            Ok(())
        }
        DisplayCaptureEventPhase::Captured => {
            Err("captured display capture event requires capture metadata only")
        }
        DisplayCaptureEventPhase::Failed
            if capture_id.is_some()
                && source.is_some()
                && byte_length.is_none()
                && reason.is_some() =>
        {
            Ok(())
        }
        DisplayCaptureEventPhase::Failed => {
            Err("failed display capture event requires failure metadata and no capture byte length")
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TransientWindowRoleActorKind {
    Workspace,
    Extension,
    Tool,
    Process,
    Native,
    App,
    Window,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TransientWindowRoleKind {
    Launcher,
    Palette,
    Popover,
    UtilityPanel,
    CompanionWindow,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TransientWindowFocusPolicy {
    TakeFocus,
    PreserveFocus,
    RestorePrevious,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TransientWindowDismissalPolicy {
    Manual,
    Blur,
    Escape,
    InteractOutside,
    Transient,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TransientWindowZOrderPolicy {
    Normal,
    Floating,
    AlwaysOnTop,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TransientWindowRestorationPolicy {
    None,
    RestoreFocus,
    RestoreOwner,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TransientWindowRoleEventPhase {
    Opened,
    Repositioned,
    Dismissed,
    Failed,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransientWindowRoleActorPayload {
    kind: TransientWindowRoleActorKind,
    id: String,
}

impl TransientWindowRoleActorPayload {
    pub fn new(kind: TransientWindowRoleActorKind, id: impl Into<String>) -> Self {
        Self {
            kind,
            id: id.into(),
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransientWindowRolePointPayload {
    x: f64,
    y: f64,
}

impl TransientWindowRolePointPayload {
    pub fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }

    pub fn values(&self) -> (f64, f64) {
        (self.x, self.y)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TransientWindowRolePlacementKind {
    Centered,
    Point,
    OwnerRelative,
    DisplayRelative,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransientWindowRolePlacementPayload {
    kind: TransientWindowRolePlacementKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    owner_window_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    display_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    point: Option<TransientWindowRolePointPayload>,
}

impl TransientWindowRolePlacementPayload {
    pub fn point(point: TransientWindowRolePointPayload) -> Self {
        Self {
            kind: TransientWindowRolePlacementKind::Point,
            owner_window_id: None,
            display_id: None,
            point: Some(point),
        }
    }

    pub fn kind(&self) -> &TransientWindowRolePlacementKind {
        &self.kind
    }

    pub fn owner_window_id(&self) -> Option<&str> {
        self.owner_window_id.as_deref()
    }

    pub fn display_id(&self) -> Option<&str> {
        self.display_id.as_deref()
    }

    pub fn point_payload(&self) -> Option<&TransientWindowRolePointPayload> {
        self.point.as_ref()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransientWindowRolePolicyPayload {
    role: TransientWindowRoleKind,
    focus: TransientWindowFocusPolicy,
    dismissal: TransientWindowDismissalPolicy,
    z_order: TransientWindowZOrderPolicy,
    placement: TransientWindowRolePlacementPayload,
    restoration: TransientWindowRestorationPolicy,
}

impl TransientWindowRolePolicyPayload {
    pub fn new(
        role: TransientWindowRoleKind,
        focus: TransientWindowFocusPolicy,
        dismissal: TransientWindowDismissalPolicy,
        z_order: TransientWindowZOrderPolicy,
        placement: TransientWindowRolePlacementPayload,
        restoration: TransientWindowRestorationPolicy,
    ) -> Self {
        Self {
            role,
            focus,
            dismissal,
            z_order,
            placement,
            restoration,
        }
    }

    pub fn placement(&self) -> &TransientWindowRolePlacementPayload {
        &self.placement
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransientWindowRoleResourcePayload {
    kind: String,
    id: String,
    generation: u64,
    owner_scope: String,
    state: String,
}

impl TransientWindowRoleResourcePayload {
    pub fn new(id: impl Into<String>, generation: u64, owner_scope: impl Into<String>) -> Self {
        Self {
            kind: "transient-window-role".to_string(),
            id: id.into(),
            generation,
            owner_scope: owner_scope.into(),
            state: "open".to_string(),
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn kind(&self) -> &str {
        &self.kind
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn owner_scope(&self) -> &str {
        &self.owner_scope
    }

    pub fn state(&self) -> &str {
        &self.state
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransientWindowRoleOpenPayload {
    actor: TransientWindowRoleActorPayload,
    role_id: String,
    policy: TransientWindowRolePolicyPayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl TransientWindowRoleOpenPayload {
    pub fn new(
        actor: TransientWindowRoleActorPayload,
        role_id: impl Into<String>,
        policy: TransientWindowRolePolicyPayload,
        trace_id: Option<String>,
    ) -> Self {
        Self {
            actor,
            role_id: role_id.into(),
            policy,
            trace_id,
        }
    }

    pub fn actor(&self) -> &TransientWindowRoleActorPayload {
        &self.actor
    }

    pub fn role_id(&self) -> &str {
        &self.role_id
    }

    pub fn policy(&self) -> &TransientWindowRolePolicyPayload {
        &self.policy
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransientWindowRoleHandlePayload {
    actor: TransientWindowRoleActorPayload,
    handle: TransientWindowRoleResourcePayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl TransientWindowRoleHandlePayload {
    pub fn new(
        actor: TransientWindowRoleActorPayload,
        handle: TransientWindowRoleResourcePayload,
        trace_id: Option<String>,
    ) -> Self {
        Self {
            actor,
            handle,
            trace_id,
        }
    }

    pub fn actor(&self) -> &TransientWindowRoleActorPayload {
        &self.actor
    }

    pub fn handle(&self) -> &TransientWindowRoleResourcePayload {
        &self.handle
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransientWindowRoleRepositionPayload {
    actor: TransientWindowRoleActorPayload,
    handle: TransientWindowRoleResourcePayload,
    placement: TransientWindowRolePlacementPayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl TransientWindowRoleRepositionPayload {
    pub fn actor(&self) -> &TransientWindowRoleActorPayload {
        &self.actor
    }

    pub fn handle(&self) -> &TransientWindowRoleResourcePayload {
        &self.handle
    }

    pub fn placement(&self) -> &TransientWindowRolePlacementPayload {
        &self.placement
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransientWindowRoleSupportedPayload {
    supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl TransientWindowRoleSupportedPayload {
    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            supported: false,
            reason: Some(reason.into()),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct TransientWindowRoleEventPayload {
    r#type: String,
    timestamp: u64,
    phase: TransientWindowRoleEventPhase,
    role_id: Option<String>,
    reason: Option<String>,
    message: Option<String>,
}

impl TransientWindowRoleEventPayload {
    pub fn opened(timestamp: u64, role_id: impl Into<String>) -> Self {
        Self {
            r#type: "transient-window-role-event".to_string(),
            timestamp,
            phase: TransientWindowRoleEventPhase::Opened,
            role_id: Some(role_id.into()),
            reason: None,
            message: None,
        }
    }

    pub fn repositioned(timestamp: u64, role_id: impl Into<String>) -> Self {
        Self {
            r#type: "transient-window-role-event".to_string(),
            timestamp,
            phase: TransientWindowRoleEventPhase::Repositioned,
            role_id: Some(role_id.into()),
            reason: None,
            message: None,
        }
    }

    pub fn dismissed(timestamp: u64, role_id: impl Into<String>) -> Self {
        Self {
            r#type: "transient-window-role-event".to_string(),
            timestamp,
            phase: TransientWindowRoleEventPhase::Dismissed,
            role_id: Some(role_id.into()),
            reason: None,
            message: None,
        }
    }

    pub fn failed(timestamp: u64, reason: impl Into<String>) -> Self {
        Self {
            r#type: "transient-window-role-event".to_string(),
            timestamp,
            phase: TransientWindowRoleEventPhase::Failed,
            role_id: None,
            reason: Some(reason.into()),
            message: None,
        }
    }

    pub fn with_role_id(mut self, role_id: impl Into<String>) -> Self {
        self.role_id = Some(role_id.into());
        self
    }

    pub fn with_message(mut self, message: impl Into<String>) -> Self {
        self.message = Some(message.into());
        self
    }

    #[cfg(test)]
    fn new_for_test(timestamp: u64, phase: TransientWindowRoleEventPhase) -> Self {
        Self {
            r#type: "transient-window-role-event".to_string(),
            timestamp,
            phase,
            role_id: None,
            reason: None,
            message: None,
        }
    }

    #[cfg(test)]
    fn with_reason_for_test(mut self, reason: impl Into<String>) -> Self {
        self.reason = Some(reason.into());
        self
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SerializableTransientWindowRoleEventPayload<'a> {
    r#type: &'a str,
    timestamp: u64,
    phase: TransientWindowRoleEventPhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    role_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<&'a str>,
}

impl<'a> TryFrom<&'a TransientWindowRoleEventPayload>
    for SerializableTransientWindowRoleEventPayload<'a>
{
    type Error = &'static str;

    fn try_from(payload: &'a TransientWindowRoleEventPayload) -> Result<Self, Self::Error> {
        validate_transient_window_role_event_payload(
            &payload.r#type,
            payload.phase,
            payload.role_id.as_deref(),
            payload.reason.as_deref(),
            payload.message.as_deref(),
        )?;
        Ok(Self {
            r#type: &payload.r#type,
            timestamp: payload.timestamp,
            phase: payload.phase,
            role_id: payload.role_id.as_deref(),
            reason: payload.reason.as_deref(),
            message: payload.message.as_deref(),
        })
    }
}

impl Serialize for TransientWindowRoleEventPayload {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        SerializableTransientWindowRoleEventPayload::try_from(self)
            .map_err(ser::Error::custom)?
            .serialize(serializer)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawTransientWindowRoleEventPayload {
    r#type: String,
    timestamp: u64,
    phase: TransientWindowRoleEventPhase,
    #[serde(default)]
    role_id: Option<String>,
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    message: Option<String>,
}

impl TryFrom<RawTransientWindowRoleEventPayload> for TransientWindowRoleEventPayload {
    type Error = &'static str;

    fn try_from(raw: RawTransientWindowRoleEventPayload) -> Result<Self, Self::Error> {
        validate_transient_window_role_event_payload(
            &raw.r#type,
            raw.phase,
            raw.role_id.as_deref(),
            raw.reason.as_deref(),
            raw.message.as_deref(),
        )?;
        Ok(Self {
            r#type: raw.r#type,
            timestamp: raw.timestamp,
            phase: raw.phase,
            role_id: raw.role_id,
            reason: raw.reason,
            message: raw.message,
        })
    }
}

impl<'de> Deserialize<'de> for TransientWindowRoleEventPayload {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        RawTransientWindowRoleEventPayload::deserialize(deserializer)?
            .try_into()
            .map_err(de::Error::custom)
    }
}

fn validate_transient_window_role_event_payload(
    event_type: &str,
    phase: TransientWindowRoleEventPhase,
    role_id: Option<&str>,
    reason: Option<&str>,
    message: Option<&str>,
) -> Result<(), &'static str> {
    if event_type != "transient-window-role-event" {
        return Err("transient window role event type must match the protocol event name");
    }

    match phase {
        TransientWindowRoleEventPhase::Opened
        | TransientWindowRoleEventPhase::Repositioned
        | TransientWindowRoleEventPhase::Dismissed
            if role_id.is_some() && reason.is_none() && message.is_none() =>
        {
            Ok(())
        }
        TransientWindowRoleEventPhase::Opened
        | TransientWindowRoleEventPhase::Repositioned
        | TransientWindowRoleEventPhase::Dismissed => {
            Err("successful transient window role events require role id and no failure metadata")
        }
        TransientWindowRoleEventPhase::Failed if reason.is_some() => Ok(()),
        TransientWindowRoleEventPhase::Failed => {
            Err("failed transient window role events require reason")
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ActivationRegistryActorKind {
    Workspace,
    Extension,
    Tool,
    Process,
    Native,
    App,
    Window,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ActivationRegistrySource {
    GlobalShortcut,
    Tray,
    Dock,
    Taskbar,
    ProtocolLink,
    FileOpen,
    Notification,
    Custom,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActivationRegistryActorPayload {
    kind: ActivationRegistryActorKind,
    id: String,
}

impl ActivationRegistryActorPayload {
    pub fn new(kind: ActivationRegistryActorKind, id: impl Into<String>) -> Self {
        Self {
            kind,
            id: id.into(),
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActivationRegistryPermissionContextPayload {
    actor: ActivationRegistryActorPayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    resource: Option<String>,
    trace_id: String,
}

impl ActivationRegistryPermissionContextPayload {
    pub fn new(actor: ActivationRegistryActorPayload, trace_id: impl Into<String>) -> Self {
        Self {
            actor,
            resource: None,
            trace_id: trace_id.into(),
        }
    }

    pub fn actor(&self) -> &ActivationRegistryActorPayload {
        &self.actor
    }

    pub fn resource(&self) -> Option<&str> {
        self.resource.as_deref()
    }

    pub fn trace_id(&self) -> &str {
        &self.trace_id
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActivationRegistrySurfacePayload {
    surface_id: String,
    source: ActivationRegistrySource,
    command_id: String,
    actor: ActivationRegistryActorPayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    owner_scope: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl ActivationRegistrySurfacePayload {
    pub fn new(
        surface_id: impl Into<String>,
        source: ActivationRegistrySource,
        command_id: impl Into<String>,
        actor: ActivationRegistryActorPayload,
    ) -> Self {
        Self {
            surface_id: surface_id.into(),
            source,
            command_id: command_id.into(),
            actor,
            owner_scope: None,
            trace_id: None,
        }
    }

    pub fn surface_id(&self) -> &str {
        &self.surface_id
    }

    pub fn command_id(&self) -> &str {
        &self.command_id
    }

    pub fn actor(&self) -> &ActivationRegistryActorPayload {
        &self.actor
    }

    pub fn owner_scope(&self) -> Option<&str> {
        self.owner_scope.as_deref()
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActivationRegistrySurfaceRequestPayload {
    surface_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl ActivationRegistrySurfaceRequestPayload {
    pub fn new(surface_id: impl Into<String>) -> Self {
        Self {
            surface_id: surface_id.into(),
            trace_id: None,
        }
    }

    pub fn surface_id(&self) -> &str {
        &self.surface_id
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActivationRegistryResourcePayload {
    kind: String,
    id: String,
    generation: u64,
    owner_scope: String,
    state: String,
}

impl ActivationRegistryResourcePayload {
    pub fn new(id: impl Into<String>, generation: u64, owner_scope: impl Into<String>) -> Self {
        Self {
            kind: "activation-surface".to_string(),
            id: id.into(),
            generation,
            owner_scope: owner_scope.into(),
            state: "registered".to_string(),
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn kind(&self) -> &str {
        &self.kind
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn owner_scope(&self) -> &str {
        &self.owner_scope
    }

    pub fn state(&self) -> &str {
        &self.state
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActivationRegistrySurfaceListPayload {
    surfaces: Vec<ActivationRegistrySurfacePayload>,
}

impl ActivationRegistrySurfaceListPayload {
    pub fn empty() -> Self {
        Self { surfaces: vec![] }
    }

    pub fn new(surfaces: Vec<ActivationRegistrySurfacePayload>) -> Self {
        Self { surfaces }
    }

    pub fn surfaces(&self) -> &[ActivationRegistrySurfacePayload] {
        &self.surfaces
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActivationRegistrySupportedPayload {
    supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl ActivationRegistrySupportedPayload {
    pub fn supported() -> Self {
        Self {
            supported: true,
            reason: None,
        }
    }

    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            supported: false,
            reason: Some(reason.into()),
        }
    }

    pub fn is_supported(&self) -> bool {
        self.supported
    }

    pub fn reason(&self) -> Option<&str> {
        self.reason.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ActivationRegistryEventPhase {
    Registered,
    Routed,
    Unregistered,
    Failed,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ActivationRegistryEventPayload {
    r#type: String,
    timestamp: u64,
    phase: ActivationRegistryEventPhase,
    surface_id: String,
    source: ActivationRegistrySource,
    payload: Value,
    actor: ActivationRegistryActorPayload,
    trace_id: String,
    permission_context: ActivationRegistryPermissionContextPayload,
    reason: Option<String>,
}

impl ActivationRegistryEventPayload {
    pub fn registered(
        timestamp: u64,
        surface_id: impl Into<String>,
        source: ActivationRegistrySource,
        actor: ActivationRegistryActorPayload,
        permission_context: ActivationRegistryPermissionContextPayload,
    ) -> Self {
        Self::success(
            timestamp,
            ActivationRegistryEventPhase::Registered,
            surface_id,
            source,
            actor,
            permission_context,
        )
    }

    pub fn routed(
        timestamp: u64,
        surface_id: impl Into<String>,
        source: ActivationRegistrySource,
        actor: ActivationRegistryActorPayload,
        permission_context: ActivationRegistryPermissionContextPayload,
    ) -> Self {
        Self::success(
            timestamp,
            ActivationRegistryEventPhase::Routed,
            surface_id,
            source,
            actor,
            permission_context,
        )
    }

    pub fn unregistered(
        timestamp: u64,
        surface_id: impl Into<String>,
        source: ActivationRegistrySource,
        actor: ActivationRegistryActorPayload,
        permission_context: ActivationRegistryPermissionContextPayload,
    ) -> Self {
        Self::success(
            timestamp,
            ActivationRegistryEventPhase::Unregistered,
            surface_id,
            source,
            actor,
            permission_context,
        )
    }

    pub fn failed(
        timestamp: u64,
        surface_id: impl Into<String>,
        source: ActivationRegistrySource,
        actor: ActivationRegistryActorPayload,
        permission_context: ActivationRegistryPermissionContextPayload,
        reason: impl Into<String>,
    ) -> Self {
        let mut event = Self::make(
            timestamp,
            ActivationRegistryEventPhase::Failed,
            surface_id,
            source,
            actor,
            permission_context,
        );
        event.reason = Some(reason.into());
        event
    }

    fn success(
        timestamp: u64,
        phase: ActivationRegistryEventPhase,
        surface_id: impl Into<String>,
        source: ActivationRegistrySource,
        actor: ActivationRegistryActorPayload,
        permission_context: ActivationRegistryPermissionContextPayload,
    ) -> Self {
        Self::make(
            timestamp,
            phase,
            surface_id,
            source,
            actor,
            permission_context,
        )
    }

    fn make(
        timestamp: u64,
        phase: ActivationRegistryEventPhase,
        surface_id: impl Into<String>,
        source: ActivationRegistrySource,
        actor: ActivationRegistryActorPayload,
        permission_context: ActivationRegistryPermissionContextPayload,
    ) -> Self {
        let trace_id = permission_context.trace_id().to_string();
        let surface_id = surface_id.into();
        Self {
            r#type: "activation-registry-event".to_string(),
            timestamp,
            phase,
            surface_id: surface_id.clone(),
            source,
            payload: serde_json::json!({ "surfaceId": surface_id }),
            actor,
            trace_id,
            permission_context,
            reason: None,
        }
    }

    #[cfg(test)]
    fn new_for_test(
        timestamp: u64,
        phase: ActivationRegistryEventPhase,
        surface_id: impl Into<String>,
        source: ActivationRegistrySource,
        actor: ActivationRegistryActorPayload,
        permission_context: ActivationRegistryPermissionContextPayload,
    ) -> Self {
        Self::make(
            timestamp,
            phase,
            surface_id,
            source,
            actor,
            permission_context,
        )
    }

    #[cfg(test)]
    fn with_reason_for_test(mut self, reason: impl Into<String>) -> Self {
        self.reason = Some(reason.into());
        self
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SerializableActivationRegistryEventPayload<'a> {
    r#type: &'a str,
    timestamp: u64,
    phase: ActivationRegistryEventPhase,
    surface_id: &'a str,
    source: ActivationRegistrySource,
    payload: &'a Value,
    actor: &'a ActivationRegistryActorPayload,
    trace_id: &'a str,
    permission_context: &'a ActivationRegistryPermissionContextPayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'a str>,
}

impl<'a> TryFrom<&'a ActivationRegistryEventPayload>
    for SerializableActivationRegistryEventPayload<'a>
{
    type Error = &'static str;

    fn try_from(payload: &'a ActivationRegistryEventPayload) -> Result<Self, Self::Error> {
        validate_activation_registry_event_reason(
            payload.phase.clone(),
            payload.reason.as_deref(),
        )?;
        Ok(Self {
            r#type: &payload.r#type,
            timestamp: payload.timestamp,
            phase: payload.phase.clone(),
            surface_id: &payload.surface_id,
            source: payload.source.clone(),
            payload: &payload.payload,
            actor: &payload.actor,
            trace_id: &payload.trace_id,
            permission_context: &payload.permission_context,
            reason: payload.reason.as_deref(),
        })
    }
}

impl Serialize for ActivationRegistryEventPayload {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        SerializableActivationRegistryEventPayload::try_from(self)
            .map_err(ser::Error::custom)?
            .serialize(serializer)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawActivationRegistryEventPayload {
    r#type: String,
    timestamp: u64,
    phase: ActivationRegistryEventPhase,
    surface_id: String,
    source: ActivationRegistrySource,
    payload: Value,
    actor: ActivationRegistryActorPayload,
    trace_id: String,
    permission_context: ActivationRegistryPermissionContextPayload,
    #[serde(default)]
    reason: Option<String>,
}

impl TryFrom<RawActivationRegistryEventPayload> for ActivationRegistryEventPayload {
    type Error = &'static str;

    fn try_from(raw: RawActivationRegistryEventPayload) -> Result<Self, Self::Error> {
        validate_activation_registry_event_reason(raw.phase.clone(), raw.reason.as_deref())?;
        Ok(Self {
            r#type: raw.r#type,
            timestamp: raw.timestamp,
            phase: raw.phase,
            surface_id: raw.surface_id,
            source: raw.source,
            payload: raw.payload,
            actor: raw.actor,
            trace_id: raw.trace_id,
            permission_context: raw.permission_context,
            reason: raw.reason,
        })
    }
}

impl<'de> Deserialize<'de> for ActivationRegistryEventPayload {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        RawActivationRegistryEventPayload::deserialize(deserializer)?
            .try_into()
            .map_err(de::Error::custom)
    }
}

fn validate_activation_registry_event_reason(
    phase: ActivationRegistryEventPhase,
    reason: Option<&str>,
) -> Result<(), &'static str> {
    match phase {
        ActivationRegistryEventPhase::Registered
        | ActivationRegistryEventPhase::Routed
        | ActivationRegistryEventPhase::Unregistered
            if reason.is_none() =>
        {
            Ok(())
        }
        ActivationRegistryEventPhase::Registered
        | ActivationRegistryEventPhase::Routed
        | ActivationRegistryEventPhase::Unregistered => {
            Err("successful activation registry events must not carry reason")
        }
        ActivationRegistryEventPhase::Failed if reason.is_some() => Ok(()),
        ActivationRegistryEventPhase::Failed => {
            Err("failed activation registry events require reason")
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ResidentLifecycleProcessPolicy {
    QuitWithLastWindow,
    KeepRunning,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ResidentLifecycleWindowPolicy {
    QuitOnLastWindow,
    CloseToBackground,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ResidentLifecycleBackgroundAvailability {
    Disabled,
    Tray,
    MenuBar,
    Headless,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResidentLifecyclePolicyPayload {
    process: ResidentLifecycleProcessPolicy,
    windows: ResidentLifecycleWindowPolicy,
    background: ResidentLifecycleBackgroundAvailability,
    #[serde(skip_serializing_if = "Option::is_none")]
    launch_at_login: Option<bool>,
}

impl ResidentLifecyclePolicyPayload {
    pub fn new(
        process: ResidentLifecycleProcessPolicy,
        windows: ResidentLifecycleWindowPolicy,
        background: ResidentLifecycleBackgroundAvailability,
        launch_at_login: Option<bool>,
    ) -> Self {
        Self {
            process,
            windows,
            background,
            launch_at_login,
        }
    }

    pub fn process(&self) -> &ResidentLifecycleProcessPolicy {
        &self.process
    }

    pub fn windows(&self) -> &ResidentLifecycleWindowPolicy {
        &self.windows
    }

    pub fn background(&self) -> &ResidentLifecycleBackgroundAvailability {
        &self.background
    }

    pub fn launch_at_login(&self) -> Option<bool> {
        self.launch_at_login
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResidentLifecycleEnablePayload {
    policy: ResidentLifecyclePolicyPayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    owner_scope: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl ResidentLifecycleEnablePayload {
    pub fn new(policy: ResidentLifecyclePolicyPayload) -> Self {
        Self {
            policy,
            owner_scope: None,
            trace_id: None,
        }
    }

    pub fn owner_scope(&self) -> Option<&str> {
        self.owner_scope.as_deref()
    }

    pub fn policy(&self) -> &ResidentLifecyclePolicyPayload {
        &self.policy
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResidentLifecycleDisablePayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl ResidentLifecycleDisablePayload {
    pub fn new(trace_id: Option<String>) -> Self {
        Self { trace_id }
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResidentLifecycleStatePayload {
    enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    policy: Option<ResidentLifecyclePolicyPayload>,
}

impl ResidentLifecycleStatePayload {
    pub fn enabled(policy: ResidentLifecyclePolicyPayload) -> Self {
        Self {
            enabled: true,
            policy: Some(policy),
        }
    }

    pub fn disabled() -> Self {
        Self {
            enabled: false,
            policy: None,
        }
    }

    pub fn policy(&self) -> Option<&ResidentLifecyclePolicyPayload> {
        self.policy.as_ref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResidentLifecycleSupportedPayload {
    supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl ResidentLifecycleSupportedPayload {
    pub fn supported() -> Self {
        Self {
            supported: true,
            reason: None,
        }
    }

    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            supported: false,
            reason: Some(reason.into()),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ResidentLifecycleEventPhase {
    Enabled,
    Disabled,
    Changed,
    Failed,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResidentLifecycleEventPayload {
    r#type: String,
    timestamp: u64,
    phase: ResidentLifecycleEventPhase,
    state: ResidentLifecycleStatePayload,
    trace_id: String,
    reason: Option<String>,
}

impl ResidentLifecycleEventPayload {
    pub fn new(
        timestamp: u64,
        phase: ResidentLifecycleEventPhase,
        state: ResidentLifecycleStatePayload,
        trace_id: impl Into<String>,
    ) -> Self {
        Self {
            r#type: "resident-lifecycle-event".to_string(),
            timestamp,
            phase,
            state,
            trace_id: trace_id.into(),
            reason: None,
        }
    }

    pub fn failed(
        timestamp: u64,
        state: ResidentLifecycleStatePayload,
        trace_id: impl Into<String>,
        reason: impl Into<String>,
    ) -> Self {
        Self {
            r#type: "resident-lifecycle-event".to_string(),
            timestamp,
            phase: ResidentLifecycleEventPhase::Failed,
            state,
            trace_id: trace_id.into(),
            reason: Some(reason.into()),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SerializableResidentLifecycleEventPayload<'a> {
    r#type: &'a str,
    timestamp: u64,
    phase: ResidentLifecycleEventPhase,
    state: &'a ResidentLifecycleStatePayload,
    trace_id: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'a str>,
}

impl<'a> TryFrom<&'a ResidentLifecycleEventPayload>
    for SerializableResidentLifecycleEventPayload<'a>
{
    type Error = &'static str;

    fn try_from(payload: &'a ResidentLifecycleEventPayload) -> Result<Self, Self::Error> {
        validate_resident_lifecycle_event_payload(
            &payload.r#type,
            payload.phase.clone(),
            payload.reason.as_deref(),
        )?;
        Ok(Self {
            r#type: &payload.r#type,
            timestamp: payload.timestamp,
            phase: payload.phase.clone(),
            state: &payload.state,
            trace_id: &payload.trace_id,
            reason: payload.reason.as_deref(),
        })
    }
}

impl Serialize for ResidentLifecycleEventPayload {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        SerializableResidentLifecycleEventPayload::try_from(self)
            .map_err(ser::Error::custom)?
            .serialize(serializer)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawResidentLifecycleEventPayload {
    r#type: String,
    timestamp: u64,
    phase: ResidentLifecycleEventPhase,
    state: ResidentLifecycleStatePayload,
    trace_id: String,
    #[serde(default)]
    reason: Option<String>,
}

impl TryFrom<RawResidentLifecycleEventPayload> for ResidentLifecycleEventPayload {
    type Error = &'static str;

    fn try_from(raw: RawResidentLifecycleEventPayload) -> Result<Self, Self::Error> {
        validate_resident_lifecycle_event_payload(
            &raw.r#type,
            raw.phase.clone(),
            raw.reason.as_deref(),
        )?;
        Ok(Self {
            r#type: raw.r#type,
            timestamp: raw.timestamp,
            phase: raw.phase,
            state: raw.state,
            trace_id: raw.trace_id,
            reason: raw.reason,
        })
    }
}

impl<'de> Deserialize<'de> for ResidentLifecycleEventPayload {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        RawResidentLifecycleEventPayload::deserialize(deserializer)?
            .try_into()
            .map_err(de::Error::custom)
    }
}

fn validate_resident_lifecycle_event_payload(
    event_type: &str,
    phase: ResidentLifecycleEventPhase,
    reason: Option<&str>,
) -> Result<(), &'static str> {
    if event_type != "resident-lifecycle-event" {
        return Err("resident lifecycle event type must match the protocol event name");
    }

    match phase {
        ResidentLifecycleEventPhase::Enabled
        | ResidentLifecycleEventPhase::Disabled
        | ResidentLifecycleEventPhase::Changed
            if reason.is_none() =>
        {
            Ok(())
        }
        ResidentLifecycleEventPhase::Enabled
        | ResidentLifecycleEventPhase::Disabled
        | ResidentLifecycleEventPhase::Changed => {
            Err("successful resident lifecycle events must not include failure reason")
        }
        ResidentLifecycleEventPhase::Failed if reason.is_some() => Ok(()),
        ResidentLifecycleEventPhase::Failed => {
            Err("failed resident lifecycle events require reason")
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticsBundleCollectPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    bundle_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    sources: Vec<DiagnosticsBundleSourceKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl DiagnosticsBundleCollectPayload {
    pub fn new(
        bundle_id: Option<String>,
        sources: Vec<DiagnosticsBundleSourceKind>,
        trace_id: Option<String>,
    ) -> Self {
        Self {
            bundle_id,
            sources,
            trace_id,
        }
    }

    pub fn bundle_id(&self) -> Option<&str> {
        self.bundle_id.as_deref()
    }

    pub fn sources(&self) -> &[DiagnosticsBundleSourceKind] {
        &self.sources
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticsBundleRedactPayload {
    bundle_id: String,
    source: DiagnosticsBundleSourceKind,
    payload: Value,
}

impl DiagnosticsBundleRedactPayload {
    pub fn new(
        bundle_id: impl Into<String>,
        source: DiagnosticsBundleSourceKind,
        payload: Value,
    ) -> Self {
        Self {
            bundle_id: bundle_id.into(),
            source,
            payload,
        }
    }

    pub fn bundle_id(&self) -> &str {
        &self.bundle_id
    }

    pub fn source(&self) -> DiagnosticsBundleSourceKind {
        self.source
    }

    pub fn payload(&self) -> &Value {
        &self.payload
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticsBundleWritePayload {
    bundle_id: String,
    destination_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl DiagnosticsBundleWritePayload {
    pub fn new(
        bundle_id: impl Into<String>,
        destination_path: impl Into<String>,
        trace_id: Option<String>,
    ) -> Self {
        Self {
            bundle_id: bundle_id.into(),
            destination_path: destination_path.into(),
            trace_id,
        }
    }

    pub fn bundle_id(&self) -> &str {
        &self.bundle_id
    }

    pub fn destination_path(&self) -> &str {
        &self.destination_path
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticsBundleSupportedPayload {
    supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl DiagnosticsBundleSupportedPayload {
    pub fn available() -> Self {
        Self {
            supported: true,
            reason: None,
        }
    }

    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            supported: false,
            reason: Some(reason.into()),
        }
    }

    pub fn supported(&self) -> bool {
        self.supported
    }

    pub fn reason(&self) -> Option<&str> {
        self.reason.as_deref()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticsBundleRedactionEvidencePayload {
    path: String,
    action: String,
    reason: String,
}

impl DiagnosticsBundleRedactionEvidencePayload {
    pub fn new(path: impl Into<String>, reason: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            action: "redacted".to_string(),
            reason: reason.into(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticsBundleRedactionPolicyPayload {
    id: String,
    evidence: Vec<DiagnosticsBundleRedactionEvidencePayload>,
}

impl DiagnosticsBundleRedactionPolicyPayload {
    pub fn new(
        id: impl Into<String>,
        evidence: Vec<DiagnosticsBundleRedactionEvidencePayload>,
    ) -> Self {
        Self {
            id: id.into(),
            evidence,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticsBundleSourceSummaryPayload {
    source: DiagnosticsBundleSourceKind,
    item_count: u64,
    redaction_policy: DiagnosticsBundleRedactionPolicyPayload,
}

impl DiagnosticsBundleSourceSummaryPayload {
    pub fn new(
        source: DiagnosticsBundleSourceKind,
        item_count: u64,
        redaction_policy: DiagnosticsBundleRedactionPolicyPayload,
    ) -> Self {
        Self {
            source,
            item_count,
            redaction_policy,
        }
    }

    pub fn source(&self) -> DiagnosticsBundleSourceKind {
        self.source
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticsBundleCollectResultPayload {
    bundle_id: String,
    collected_at: u64,
    sources: Vec<DiagnosticsBundleSourceSummaryPayload>,
    artifact_count: u64,
}

impl DiagnosticsBundleCollectResultPayload {
    pub fn new(
        bundle_id: impl Into<String>,
        collected_at: u64,
        sources: Vec<DiagnosticsBundleSourceSummaryPayload>,
    ) -> Self {
        let artifact_count = sources.iter().map(|source| source.item_count).sum();
        Self {
            bundle_id: bundle_id.into(),
            collected_at,
            sources,
            artifact_count,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticsBundleRedactResultPayload {
    bundle_id: String,
    source: DiagnosticsBundleSourceKind,
    payload: Value,
    redaction_policy: DiagnosticsBundleRedactionPolicyPayload,
}

impl DiagnosticsBundleRedactResultPayload {
    pub fn new(
        bundle_id: impl Into<String>,
        source: DiagnosticsBundleSourceKind,
        payload: Value,
        redaction_policy: DiagnosticsBundleRedactionPolicyPayload,
    ) -> Self {
        Self {
            bundle_id: bundle_id.into(),
            source,
            payload,
            redaction_policy,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticsBundleWriteResultPayload {
    bundle_id: String,
    destination_path: String,
    bytes_written: u64,
    sources: Vec<DiagnosticsBundleSourceSummaryPayload>,
}

impl DiagnosticsBundleWriteResultPayload {
    pub fn new(
        bundle_id: impl Into<String>,
        destination_path: impl Into<String>,
        bytes_written: u64,
        sources: Vec<DiagnosticsBundleSourceSummaryPayload>,
    ) -> Self {
        Self {
            bundle_id: bundle_id.into(),
            destination_path: destination_path.into(),
            bytes_written,
            sources,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EgressPolicyActorKind {
    Workspace,
    Extension,
    Tool,
    Process,
    Native,
    App,
    Window,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EgressPolicyProtocol {
    Http,
    Https,
    Ws,
    Wss,
    Tcp,
    Udp,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EgressPolicyRuleEffect {
    Allow,
    Deny,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EgressPolicyOutcome {
    Allowed,
    Denied,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EgressPolicyActorPayload {
    kind: EgressPolicyActorKind,
    id: String,
}

impl EgressPolicyActorPayload {
    pub fn new(kind: EgressPolicyActorKind, id: impl Into<String>) -> Self {
        Self {
            kind,
            id: id.into(),
        }
    }

    pub fn kind(&self) -> EgressPolicyActorKind {
        self.kind
    }

    pub fn id(&self) -> &str {
        &self.id
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EgressPolicyDestinationPayload {
    protocol: EgressPolicyProtocol,
    host: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
}

impl EgressPolicyDestinationPayload {
    pub fn new(
        protocol: EgressPolicyProtocol,
        host: impl Into<String>,
        port: Option<u16>,
        path: Option<String>,
    ) -> Self {
        Self {
            protocol,
            host: host.into(),
            port,
            path,
        }
    }

    pub fn protocol(&self) -> EgressPolicyProtocol {
        self.protocol
    }

    pub fn host(&self) -> &str {
        &self.host
    }

    pub fn port(&self) -> Option<u16> {
        self.port
    }

    pub fn path(&self) -> Option<&str> {
        self.path.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EgressPolicyRulePayload {
    id: String,
    effect: EgressPolicyRuleEffect,
    hosts: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    protocols: Vec<EgressPolicyProtocol>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    ports: Vec<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    actor: Option<EgressPolicyActorPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl EgressPolicyRulePayload {
    pub fn new(
        id: impl Into<String>,
        effect: EgressPolicyRuleEffect,
        hosts: Vec<String>,
        protocols: Vec<EgressPolicyProtocol>,
        ports: Vec<u16>,
        reason: Option<String>,
    ) -> Self {
        Self {
            id: id.into(),
            effect,
            hosts,
            protocols,
            ports,
            actor: None,
            reason,
        }
    }

    pub fn with_actor(mut self, actor: EgressPolicyActorPayload) -> Self {
        self.actor = Some(actor);
        self
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn effect(&self) -> EgressPolicyRuleEffect {
        self.effect
    }

    pub fn hosts(&self) -> &[String] {
        &self.hosts
    }

    pub fn protocols(&self) -> &[EgressPolicyProtocol] {
        &self.protocols
    }

    pub fn ports(&self) -> &[u16] {
        &self.ports
    }

    pub fn actor(&self) -> Option<&EgressPolicyActorPayload> {
        self.actor.as_ref()
    }

    pub fn reason(&self) -> Option<&str> {
        self.reason.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EgressPolicyDecisionPayload {
    actor: EgressPolicyActorPayload,
    destination: EgressPolicyDestinationPayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl EgressPolicyDecisionPayload {
    pub fn new(
        actor: EgressPolicyActorPayload,
        destination: EgressPolicyDestinationPayload,
        trace_id: Option<String>,
    ) -> Self {
        Self {
            actor,
            destination,
            trace_id,
        }
    }

    pub fn actor(&self) -> &EgressPolicyActorPayload {
        &self.actor
    }

    pub fn destination(&self) -> &EgressPolicyDestinationPayload {
        &self.destination
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EgressPolicyDecisionResultPayload {
    decision_id: String,
    outcome: EgressPolicyOutcome,
    actor: EgressPolicyActorPayload,
    destination: EgressPolicyDestinationPayload,
    rule: EgressPolicyRulePayload,
    reason: String,
}

impl EgressPolicyDecisionResultPayload {
    pub fn new(
        decision_id: impl Into<String>,
        outcome: EgressPolicyOutcome,
        actor: EgressPolicyActorPayload,
        destination: EgressPolicyDestinationPayload,
        rule: EgressPolicyRulePayload,
        reason: impl Into<String>,
    ) -> Self {
        Self {
            decision_id: decision_id.into(),
            outcome,
            actor,
            destination,
            rule,
            reason: reason.into(),
        }
    }

    pub fn decision_id(&self) -> &str {
        &self.decision_id
    }

    pub fn outcome(&self) -> EgressPolicyOutcome {
        self.outcome
    }

    pub fn actor(&self) -> &EgressPolicyActorPayload {
        &self.actor
    }

    pub fn destination(&self) -> &EgressPolicyDestinationPayload {
        &self.destination
    }

    pub fn rule(&self) -> &EgressPolicyRulePayload {
        &self.rule
    }

    pub fn reason(&self) -> &str {
        &self.reason
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EgressPolicyRecordPayload {
    decision_id: String,
    actor: EgressPolicyActorPayload,
    destination: EgressPolicyDestinationPayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl EgressPolicyRecordPayload {
    pub fn new(
        decision_id: impl Into<String>,
        actor: EgressPolicyActorPayload,
        destination: EgressPolicyDestinationPayload,
        trace_id: Option<String>,
    ) -> Self {
        Self {
            decision_id: decision_id.into(),
            actor,
            destination,
            trace_id,
        }
    }

    pub fn decision_id(&self) -> &str {
        &self.decision_id
    }

    pub fn actor(&self) -> &EgressPolicyActorPayload {
        &self.actor
    }

    pub fn destination(&self) -> &EgressPolicyDestinationPayload {
        &self.destination
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EgressPolicyRecordResultPayload {
    decision_id: String,
    recorded: bool,
}

impl EgressPolicyRecordResultPayload {
    pub fn recorded(decision_id: impl Into<String>) -> Self {
        Self {
            decision_id: decision_id.into(),
            recorded: true,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EgressPolicyDecisionRecordedEventPayload {
    #[serde(rename = "type")]
    event_type: String,
    timestamp: u64,
    decision: EgressPolicyDecisionResultPayload,
}

impl EgressPolicyDecisionRecordedEventPayload {
    pub fn new(timestamp: u64, decision: EgressPolicyDecisionResultPayload) -> Self {
        Self {
            event_type: "decision-recorded".to_string(),
            timestamp,
            decision,
        }
    }

    pub fn event_type(&self) -> &str {
        &self.event_type
    }

    pub fn timestamp(&self) -> u64 {
        self.timestamp
    }

    pub fn decision(&self) -> &EgressPolicyDecisionResultPayload {
        &self.decision
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EgressPolicySupportedPayload {
    supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl EgressPolicySupportedPayload {
    pub fn available() -> Self {
        Self {
            supported: true,
            reason: None,
        }
    }

    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            supported: false,
            reason: Some(reason.into()),
        }
    }

    pub fn supported(&self) -> bool {
        self.supported
    }

    pub fn reason(&self) -> Option<&str> {
        self.reason.as_deref()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExecutionSandboxActorKind {
    Workspace,
    Extension,
    Tool,
    Process,
    Native,
    App,
    Window,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExecutionSandboxRunStatus {
    Completed,
    Failed,
    Timeout,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExecutionSandboxEventPhase {
    Created,
    RunStarted,
    RunCompleted,
    Destroyed,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionSandboxActorPayload {
    kind: ExecutionSandboxActorKind,
    id: String,
}

impl ExecutionSandboxActorPayload {
    pub fn new(kind: ExecutionSandboxActorKind, id: impl Into<String>) -> Self {
        Self {
            kind,
            id: id.into(),
        }
    }

    pub fn kind(&self) -> ExecutionSandboxActorKind {
        self.kind
    }

    pub fn id(&self) -> &str {
        &self.id
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionSandboxEnvironmentEntryPayload {
    name: String,
    value: String,
}

impl ExecutionSandboxEnvironmentEntryPayload {
    pub fn new(name: impl Into<String>, value: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            value: value.into(),
        }
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn value(&self) -> &str {
        &self.value
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionSandboxFilesystemPolicyPayload {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    read_roots: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    write_roots: Vec<String>,
}

impl ExecutionSandboxFilesystemPolicyPayload {
    pub fn new(read_roots: Vec<String>, write_roots: Vec<String>) -> Self {
        Self {
            read_roots,
            write_roots,
        }
    }

    pub fn read_roots(&self) -> &[String] {
        &self.read_roots
    }

    pub fn write_roots(&self) -> &[String] {
        &self.write_roots
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionSandboxNetworkPolicyPayload {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    hosts: Vec<String>,
}

impl ExecutionSandboxNetworkPolicyPayload {
    pub fn new(hosts: Vec<String>) -> Self {
        Self { hosts }
    }

    pub fn hosts(&self) -> &[String] {
        &self.hosts
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionSandboxBudgetPolicyPayload {
    cpu_millis: u64,
    memory_bytes: u64,
    wall_clock_millis: u64,
    stdout_bytes: u64,
    stderr_bytes: u64,
}

impl ExecutionSandboxBudgetPolicyPayload {
    pub fn new(
        cpu_millis: u64,
        memory_bytes: u64,
        wall_clock_millis: u64,
        stdout_bytes: u64,
        stderr_bytes: u64,
    ) -> Self {
        Self {
            cpu_millis,
            memory_bytes,
            wall_clock_millis,
            stdout_bytes,
            stderr_bytes,
        }
    }

    pub fn cpu_millis(&self) -> u64 {
        self.cpu_millis
    }

    pub fn memory_bytes(&self) -> u64 {
        self.memory_bytes
    }

    pub fn wall_clock_millis(&self) -> u64 {
        self.wall_clock_millis
    }

    pub fn stdout_bytes(&self) -> u64 {
        self.stdout_bytes
    }

    pub fn stderr_bytes(&self) -> u64 {
        self.stderr_bytes
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionSandboxCleanupPolicyPayload {
    kill_process_tree: bool,
    remove_working_directory: bool,
}

impl ExecutionSandboxCleanupPolicyPayload {
    pub fn new(kill_process_tree: bool, remove_working_directory: bool) -> Self {
        Self {
            kill_process_tree,
            remove_working_directory,
        }
    }

    pub fn kill_process_tree(&self) -> bool {
        self.kill_process_tree
    }

    pub fn remove_working_directory(&self) -> bool {
        self.remove_working_directory
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionSandboxPolicyPayload {
    cwd: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    environment: Vec<ExecutionSandboxEnvironmentEntryPayload>,
    #[serde(
        default,
        skip_serializing_if = "ExecutionSandboxFilesystemPolicyPayload::is_empty"
    )]
    filesystem: ExecutionSandboxFilesystemPolicyPayload,
    #[serde(
        default,
        skip_serializing_if = "ExecutionSandboxNetworkPolicyPayload::is_empty"
    )]
    network: ExecutionSandboxNetworkPolicyPayload,
    budgets: ExecutionSandboxBudgetPolicyPayload,
    cleanup: ExecutionSandboxCleanupPolicyPayload,
}

impl ExecutionSandboxFilesystemPolicyPayload {
    fn is_empty(&self) -> bool {
        self.read_roots.is_empty() && self.write_roots.is_empty()
    }
}

impl ExecutionSandboxNetworkPolicyPayload {
    fn is_empty(&self) -> bool {
        self.hosts.is_empty()
    }
}

impl ExecutionSandboxPolicyPayload {
    pub fn new(
        cwd: impl Into<String>,
        environment: Vec<ExecutionSandboxEnvironmentEntryPayload>,
        filesystem: ExecutionSandboxFilesystemPolicyPayload,
        network: ExecutionSandboxNetworkPolicyPayload,
        budgets: ExecutionSandboxBudgetPolicyPayload,
        cleanup: ExecutionSandboxCleanupPolicyPayload,
    ) -> Self {
        Self {
            cwd: cwd.into(),
            environment,
            filesystem,
            network,
            budgets,
            cleanup,
        }
    }

    pub fn cwd(&self) -> &str {
        &self.cwd
    }

    pub fn environment(&self) -> &[ExecutionSandboxEnvironmentEntryPayload] {
        &self.environment
    }

    pub fn filesystem(&self) -> &ExecutionSandboxFilesystemPolicyPayload {
        &self.filesystem
    }

    pub fn network(&self) -> &ExecutionSandboxNetworkPolicyPayload {
        &self.network
    }

    pub fn budgets(&self) -> &ExecutionSandboxBudgetPolicyPayload {
        &self.budgets
    }

    pub fn cleanup(&self) -> &ExecutionSandboxCleanupPolicyPayload {
        &self.cleanup
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionSandboxCreatePayload {
    actor: ExecutionSandboxActorPayload,
    policy: ExecutionSandboxPolicyPayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    sandbox_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl ExecutionSandboxCreatePayload {
    pub fn new(
        actor: ExecutionSandboxActorPayload,
        policy: ExecutionSandboxPolicyPayload,
        sandbox_id: Option<String>,
        trace_id: Option<String>,
    ) -> Self {
        Self {
            actor,
            policy,
            sandbox_id,
            trace_id,
        }
    }

    pub fn actor(&self) -> &ExecutionSandboxActorPayload {
        &self.actor
    }

    pub fn policy(&self) -> &ExecutionSandboxPolicyPayload {
        &self.policy
    }

    pub fn sandbox_id(&self) -> Option<&str> {
        self.sandbox_id.as_deref()
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionSandboxCreateResultPayload {
    sandbox_id: String,
    policy: ExecutionSandboxPolicyPayload,
    state: String,
}

impl ExecutionSandboxCreateResultPayload {
    pub fn created(sandbox_id: impl Into<String>, policy: ExecutionSandboxPolicyPayload) -> Self {
        Self {
            sandbox_id: sandbox_id.into(),
            policy,
            state: "created".to_string(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionSandboxRunPayload {
    sandbox_id: String,
    command: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    args: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    run_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl ExecutionSandboxRunPayload {
    pub fn new(
        sandbox_id: impl Into<String>,
        command: impl Into<String>,
        args: Vec<String>,
        run_id: Option<String>,
        trace_id: Option<String>,
    ) -> Self {
        Self {
            sandbox_id: sandbox_id.into(),
            command: command.into(),
            args,
            run_id,
            trace_id,
        }
    }

    pub fn sandbox_id(&self) -> &str {
        &self.sandbox_id
    }

    pub fn command(&self) -> &str {
        &self.command
    }

    pub fn args(&self) -> &[String] {
        &self.args
    }

    pub fn run_id(&self) -> Option<&str> {
        self.run_id.as_deref()
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionSandboxRunResultPayload {
    sandbox_id: String,
    run_id: String,
    status: ExecutionSandboxRunStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    exit_code: Option<u32>,
    stdout: String,
    stderr: String,
}

impl ExecutionSandboxRunResultPayload {
    pub fn new(
        sandbox_id: impl Into<String>,
        run_id: impl Into<String>,
        status: ExecutionSandboxRunStatus,
        exit_code: Option<u32>,
        stdout: impl Into<String>,
        stderr: impl Into<String>,
    ) -> Self {
        Self {
            sandbox_id: sandbox_id.into(),
            run_id: run_id.into(),
            status,
            exit_code,
            stdout: stdout.into(),
            stderr: stderr.into(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionSandboxDestroyPayload {
    sandbox_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl ExecutionSandboxDestroyPayload {
    pub fn new(sandbox_id: impl Into<String>, trace_id: Option<String>) -> Self {
        Self {
            sandbox_id: sandbox_id.into(),
            trace_id,
        }
    }

    pub fn sandbox_id(&self) -> &str {
        &self.sandbox_id
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionSandboxDestroyResultPayload {
    sandbox_id: String,
    destroyed: bool,
}

impl ExecutionSandboxDestroyResultPayload {
    pub fn destroyed(sandbox_id: impl Into<String>) -> Self {
        Self {
            sandbox_id: sandbox_id.into(),
            destroyed: true,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionSandboxSupportedPayload {
    supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl ExecutionSandboxSupportedPayload {
    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            supported: false,
            reason: Some(reason.into()),
        }
    }

    pub fn supported(&self) -> bool {
        self.supported
    }

    pub fn reason(&self) -> Option<&str> {
        self.reason.as_deref()
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct ExecutionSandboxEventPayload {
    r#type: String,
    timestamp: u64,
    sandbox_id: String,
    phase: ExecutionSandboxEventPhase,
    run_id: Option<String>,
    status: Option<ExecutionSandboxRunStatus>,
    reason: Option<String>,
}

impl ExecutionSandboxEventPayload {
    pub fn new(
        timestamp: u64,
        sandbox_id: impl Into<String>,
        phase: ExecutionSandboxEventPhase,
        run_id: Option<String>,
        status: Option<ExecutionSandboxRunStatus>,
        reason: Option<String>,
    ) -> Self {
        Self {
            r#type: "sandbox-event".to_string(),
            timestamp,
            sandbox_id: sandbox_id.into(),
            phase,
            run_id,
            status,
            reason,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SerializableExecutionSandboxEventPayload<'a> {
    r#type: &'a str,
    timestamp: u64,
    sandbox_id: &'a str,
    phase: ExecutionSandboxEventPhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    run_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<ExecutionSandboxRunStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'a str>,
}

impl<'a> TryFrom<&'a ExecutionSandboxEventPayload>
    for SerializableExecutionSandboxEventPayload<'a>
{
    type Error = &'static str;

    fn try_from(payload: &'a ExecutionSandboxEventPayload) -> Result<Self, Self::Error> {
        validate_execution_sandbox_event_payload(payload.phase, &payload.run_id, payload.status)?;
        Ok(Self {
            r#type: &payload.r#type,
            timestamp: payload.timestamp,
            sandbox_id: &payload.sandbox_id,
            phase: payload.phase,
            run_id: payload.run_id.as_deref(),
            status: payload.status,
            reason: payload.reason.as_deref(),
        })
    }
}

impl Serialize for ExecutionSandboxEventPayload {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        SerializableExecutionSandboxEventPayload::try_from(self)
            .map_err(ser::Error::custom)?
            .serialize(serializer)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawExecutionSandboxEventPayload {
    r#type: String,
    timestamp: u64,
    sandbox_id: String,
    phase: ExecutionSandboxEventPhase,
    run_id: Option<String>,
    status: Option<ExecutionSandboxRunStatus>,
    reason: Option<String>,
}

impl TryFrom<RawExecutionSandboxEventPayload> for ExecutionSandboxEventPayload {
    type Error = &'static str;

    fn try_from(raw: RawExecutionSandboxEventPayload) -> Result<Self, Self::Error> {
        validate_execution_sandbox_event_payload(raw.phase, &raw.run_id, raw.status)?;
        Ok(Self {
            r#type: raw.r#type,
            timestamp: raw.timestamp,
            sandbox_id: raw.sandbox_id,
            phase: raw.phase,
            run_id: raw.run_id,
            status: raw.status,
            reason: raw.reason,
        })
    }
}

impl<'de> Deserialize<'de> for ExecutionSandboxEventPayload {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        RawExecutionSandboxEventPayload::deserialize(deserializer)?
            .try_into()
            .map_err(de::Error::custom)
    }
}

fn validate_execution_sandbox_event_payload(
    phase: ExecutionSandboxEventPhase,
    run_id: &Option<String>,
    status: Option<ExecutionSandboxRunStatus>,
) -> Result<(), &'static str> {
    match phase {
        ExecutionSandboxEventPhase::RunStarted if run_id.is_none() => {
            Err("run-started sandbox event requires runId")
        }
        ExecutionSandboxEventPhase::RunStarted if status.is_some() => {
            Err("run-started sandbox event must not carry status")
        }
        ExecutionSandboxEventPhase::RunCompleted if run_id.is_none() => {
            Err("run-completed sandbox event requires runId")
        }
        ExecutionSandboxEventPhase::RunCompleted if status.is_none() => {
            Err("run-completed sandbox event requires status")
        }
        ExecutionSandboxEventPhase::RunStarted | ExecutionSandboxEventPhase::RunCompleted => Ok(()),
        ExecutionSandboxEventPhase::Created | ExecutionSandboxEventPhase::Destroyed
            if run_id.is_some() =>
        {
            Err("non-run sandbox event must not carry runId")
        }
        ExecutionSandboxEventPhase::Created | ExecutionSandboxEventPhase::Destroyed
            if status.is_some() =>
        {
            Err("non-run sandbox event must not carry status")
        }
        ExecutionSandboxEventPhase::Created | ExecutionSandboxEventPhase::Destroyed => Ok(()),
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LocalToolRuntimeActorKind {
    Workspace,
    Extension,
    Tool,
    Process,
    Native,
    App,
    Window,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LocalToolRuntimeRunStatus {
    Completed,
    Failed,
    Timeout,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LocalToolRuntimeHealthStatus {
    Unknown,
    Healthy,
    Unhealthy,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LocalToolRuntimeEventPhase {
    Registered,
    RunStarted,
    RunCompleted,
    HealthChecked,
    Stopped,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LocalToolRuntimeStdioMode {
    Capture,
    Inherit,
    Ignore,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalToolRuntimeActorPayload {
    kind: LocalToolRuntimeActorKind,
    id: String,
}

impl LocalToolRuntimeActorPayload {
    pub fn new(kind: LocalToolRuntimeActorKind, id: impl Into<String>) -> Self {
        Self {
            kind,
            id: id.into(),
        }
    }

    pub fn kind(&self) -> LocalToolRuntimeActorKind {
        self.kind
    }

    pub fn id(&self) -> &str {
        &self.id
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalToolRuntimeEnvironmentEntryPayload {
    name: String,
    value: String,
}

impl LocalToolRuntimeEnvironmentEntryPayload {
    pub fn new(name: impl Into<String>, value: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            value: value.into(),
        }
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn value(&self) -> &str {
        &self.value
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalToolRuntimeCwdPolicyPayload {
    roots: Vec<String>,
}

impl LocalToolRuntimeCwdPolicyPayload {
    pub fn new(roots: Vec<String>) -> Self {
        Self { roots }
    }

    pub fn roots(&self) -> &[String] {
        &self.roots
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalToolRuntimeEnvironmentPolicyPayload {
    #[serde(default)]
    variables: Vec<LocalToolRuntimeEnvironmentEntryPayload>,
}

impl LocalToolRuntimeEnvironmentPolicyPayload {
    pub fn new(variables: Vec<LocalToolRuntimeEnvironmentEntryPayload>) -> Self {
        Self { variables }
    }

    pub fn variables(&self) -> &[LocalToolRuntimeEnvironmentEntryPayload] {
        &self.variables
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalToolRuntimeFilesystemPolicyPayload {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    read_roots: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    write_roots: Vec<String>,
}

impl LocalToolRuntimeFilesystemPolicyPayload {
    pub fn new(read_roots: Vec<String>, write_roots: Vec<String>) -> Self {
        Self {
            read_roots,
            write_roots,
        }
    }

    pub fn read_roots(&self) -> &[String] {
        &self.read_roots
    }

    pub fn write_roots(&self) -> &[String] {
        &self.write_roots
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalToolRuntimeNetworkPolicyPayload {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    hosts: Vec<String>,
}

impl LocalToolRuntimeNetworkPolicyPayload {
    pub fn new(hosts: Vec<String>) -> Self {
        Self { hosts }
    }

    pub fn hosts(&self) -> &[String] {
        &self.hosts
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalToolRuntimeBudgetPolicyPayload {
    cpu_millis: u64,
    memory_bytes: u64,
    wall_clock_millis: u64,
    stdout_bytes: u64,
    stderr_bytes: u64,
}

impl LocalToolRuntimeBudgetPolicyPayload {
    pub fn new(
        cpu_millis: u64,
        memory_bytes: u64,
        wall_clock_millis: u64,
        stdout_bytes: u64,
        stderr_bytes: u64,
    ) -> Self {
        Self {
            cpu_millis,
            memory_bytes,
            wall_clock_millis,
            stdout_bytes,
            stderr_bytes,
        }
    }

    pub fn cpu_millis(&self) -> u64 {
        self.cpu_millis
    }

    pub fn memory_bytes(&self) -> u64 {
        self.memory_bytes
    }

    pub fn wall_clock_millis(&self) -> u64 {
        self.wall_clock_millis
    }

    pub fn stdout_bytes(&self) -> u64 {
        self.stdout_bytes
    }

    pub fn stderr_bytes(&self) -> u64 {
        self.stderr_bytes
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalToolRuntimeStdioPolicyPayload {
    stdout: LocalToolRuntimeStdioMode,
    stderr: LocalToolRuntimeStdioMode,
}

impl LocalToolRuntimeStdioPolicyPayload {
    pub fn new(stdout: LocalToolRuntimeStdioMode, stderr: LocalToolRuntimeStdioMode) -> Self {
        Self { stdout, stderr }
    }

    pub fn stdout(&self) -> LocalToolRuntimeStdioMode {
        self.stdout
    }

    pub fn stderr(&self) -> LocalToolRuntimeStdioMode {
        self.stderr
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalToolRuntimeCleanupPolicyPayload {
    kill_process_tree: bool,
    remove_working_directory: bool,
}

impl LocalToolRuntimeCleanupPolicyPayload {
    pub fn new(kill_process_tree: bool, remove_working_directory: bool) -> Self {
        Self {
            kill_process_tree,
            remove_working_directory,
        }
    }

    pub fn kill_process_tree(&self) -> bool {
        self.kill_process_tree
    }

    pub fn remove_working_directory(&self) -> bool {
        self.remove_working_directory
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalToolRuntimePolicyPayload {
    cwd: LocalToolRuntimeCwdPolicyPayload,
    environment: LocalToolRuntimeEnvironmentPolicyPayload,
    #[serde(default)]
    filesystem: LocalToolRuntimeFilesystemPolicyPayload,
    #[serde(default)]
    network: LocalToolRuntimeNetworkPolicyPayload,
    budgets: LocalToolRuntimeBudgetPolicyPayload,
    stdio: LocalToolRuntimeStdioPolicyPayload,
    cleanup: LocalToolRuntimeCleanupPolicyPayload,
}

impl LocalToolRuntimePolicyPayload {
    pub fn new(
        cwd: LocalToolRuntimeCwdPolicyPayload,
        environment: LocalToolRuntimeEnvironmentPolicyPayload,
        filesystem: LocalToolRuntimeFilesystemPolicyPayload,
        network: LocalToolRuntimeNetworkPolicyPayload,
        budgets: LocalToolRuntimeBudgetPolicyPayload,
        stdio: LocalToolRuntimeStdioPolicyPayload,
        cleanup: LocalToolRuntimeCleanupPolicyPayload,
    ) -> Self {
        Self {
            cwd,
            environment,
            filesystem,
            network,
            budgets,
            stdio,
            cleanup,
        }
    }

    pub fn cwd(&self) -> &LocalToolRuntimeCwdPolicyPayload {
        &self.cwd
    }

    pub fn environment(&self) -> &LocalToolRuntimeEnvironmentPolicyPayload {
        &self.environment
    }

    pub fn filesystem(&self) -> &LocalToolRuntimeFilesystemPolicyPayload {
        &self.filesystem
    }

    pub fn network(&self) -> &LocalToolRuntimeNetworkPolicyPayload {
        &self.network
    }

    pub fn budgets(&self) -> &LocalToolRuntimeBudgetPolicyPayload {
        &self.budgets
    }

    pub fn stdio(&self) -> &LocalToolRuntimeStdioPolicyPayload {
        &self.stdio
    }

    pub fn cleanup(&self) -> &LocalToolRuntimeCleanupPolicyPayload {
        &self.cleanup
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalToolRuntimeCommandPayload {
    command_id: String,
    executable: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    default_args: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cwd: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    environment: Vec<LocalToolRuntimeEnvironmentEntryPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    timeout_millis: Option<u64>,
}

impl LocalToolRuntimeCommandPayload {
    pub fn new(
        command_id: impl Into<String>,
        executable: impl Into<String>,
        default_args: Vec<String>,
        cwd: Option<String>,
        environment: Vec<LocalToolRuntimeEnvironmentEntryPayload>,
        timeout_millis: Option<u64>,
    ) -> Self {
        Self {
            command_id: command_id.into(),
            executable: executable.into(),
            default_args,
            cwd,
            environment,
            timeout_millis,
        }
    }

    pub fn command_id(&self) -> &str {
        &self.command_id
    }

    pub fn executable(&self) -> &str {
        &self.executable
    }

    pub fn default_args(&self) -> &[String] {
        &self.default_args
    }

    pub fn cwd(&self) -> Option<&str> {
        self.cwd.as_deref()
    }

    pub fn environment(&self) -> &[LocalToolRuntimeEnvironmentEntryPayload] {
        &self.environment
    }

    pub fn timeout_millis(&self) -> Option<u64> {
        self.timeout_millis
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalToolRuntimeHealthCheckPayload {
    command_id: String,
    interval_millis: u64,
    timeout_millis: u64,
}

impl LocalToolRuntimeHealthCheckPayload {
    pub fn new(command_id: impl Into<String>, interval_millis: u64, timeout_millis: u64) -> Self {
        Self {
            command_id: command_id.into(),
            interval_millis,
            timeout_millis,
        }
    }

    pub fn command_id(&self) -> &str {
        &self.command_id
    }

    pub fn interval_millis(&self) -> u64 {
        self.interval_millis
    }

    pub fn timeout_millis(&self) -> u64 {
        self.timeout_millis
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalToolRuntimeManifestPayload {
    tool_id: String,
    name: String,
    version: String,
    commands: Vec<LocalToolRuntimeCommandPayload>,
    permissions: Vec<Value>,
    policy: LocalToolRuntimePolicyPayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    health: Option<LocalToolRuntimeHealthCheckPayload>,
}

impl LocalToolRuntimeManifestPayload {
    pub fn new(
        tool_id: impl Into<String>,
        name: impl Into<String>,
        version: impl Into<String>,
        commands: Vec<LocalToolRuntimeCommandPayload>,
        permissions: Vec<Value>,
        policy: LocalToolRuntimePolicyPayload,
    ) -> Self {
        Self {
            tool_id: tool_id.into(),
            name: name.into(),
            version: version.into(),
            commands,
            permissions,
            policy,
            health: None,
        }
    }

    pub fn with_health(mut self, health: LocalToolRuntimeHealthCheckPayload) -> Self {
        self.health = Some(health);
        self
    }

    pub fn tool_id(&self) -> &str {
        &self.tool_id
    }

    pub fn version(&self) -> &str {
        &self.version
    }

    pub fn commands(&self) -> &[LocalToolRuntimeCommandPayload] {
        &self.commands
    }

    pub fn permissions(&self) -> &[Value] {
        &self.permissions
    }

    pub fn policy(&self) -> &LocalToolRuntimePolicyPayload {
        &self.policy
    }

    pub fn health(&self) -> Option<&LocalToolRuntimeHealthCheckPayload> {
        self.health.as_ref()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalToolRuntimeRegisterPayload {
    actor: LocalToolRuntimeActorPayload,
    manifest: LocalToolRuntimeManifestPayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    runtime_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl LocalToolRuntimeRegisterPayload {
    pub fn new(
        actor: LocalToolRuntimeActorPayload,
        manifest: LocalToolRuntimeManifestPayload,
        runtime_id: Option<String>,
        trace_id: Option<String>,
    ) -> Self {
        Self {
            actor,
            manifest,
            runtime_id,
            trace_id,
        }
    }

    pub fn actor(&self) -> &LocalToolRuntimeActorPayload {
        &self.actor
    }

    pub fn manifest(&self) -> &LocalToolRuntimeManifestPayload {
        &self.manifest
    }

    pub fn runtime_id(&self) -> Option<&str> {
        self.runtime_id.as_deref()
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalToolRuntimeRegisterResultPayload {
    runtime_id: String,
    tool_id: String,
    manifest: LocalToolRuntimeManifestPayload,
    state: String,
}

impl LocalToolRuntimeRegisterResultPayload {
    pub fn registered(
        runtime_id: impl Into<String>,
        tool_id: impl Into<String>,
        manifest: LocalToolRuntimeManifestPayload,
    ) -> Self {
        Self {
            runtime_id: runtime_id.into(),
            tool_id: tool_id.into(),
            manifest,
            state: "registered".to_string(),
        }
    }

    pub fn runtime_id(&self) -> &str {
        &self.runtime_id
    }

    pub fn tool_id(&self) -> &str {
        &self.tool_id
    }

    pub fn manifest(&self) -> &LocalToolRuntimeManifestPayload {
        &self.manifest
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalToolRuntimeRunPayload {
    runtime_id: String,
    command_id: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    args: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    run_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl LocalToolRuntimeRunPayload {
    pub fn new(
        runtime_id: impl Into<String>,
        command_id: impl Into<String>,
        args: Vec<String>,
        run_id: Option<String>,
        trace_id: Option<String>,
    ) -> Self {
        Self {
            runtime_id: runtime_id.into(),
            command_id: command_id.into(),
            args,
            run_id,
            trace_id,
        }
    }

    pub fn runtime_id(&self) -> &str {
        &self.runtime_id
    }

    pub fn command_id(&self) -> &str {
        &self.command_id
    }

    pub fn args(&self) -> &[String] {
        &self.args
    }

    pub fn run_id(&self) -> Option<&str> {
        self.run_id.as_deref()
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalToolRuntimeRunResultPayload {
    runtime_id: String,
    command_id: String,
    run_id: String,
    status: LocalToolRuntimeRunStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    exit_code: Option<u32>,
    stdout: String,
    stderr: String,
}

impl LocalToolRuntimeRunResultPayload {
    pub fn new(
        runtime_id: impl Into<String>,
        command_id: impl Into<String>,
        run_id: impl Into<String>,
        status: LocalToolRuntimeRunStatus,
        exit_code: Option<u32>,
        stdout: impl Into<String>,
        stderr: impl Into<String>,
    ) -> Self {
        Self {
            runtime_id: runtime_id.into(),
            command_id: command_id.into(),
            run_id: run_id.into(),
            status,
            exit_code,
            stdout: stdout.into(),
            stderr: stderr.into(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalToolRuntimeStopPayload {
    runtime_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl LocalToolRuntimeStopPayload {
    pub fn new(runtime_id: impl Into<String>, trace_id: Option<String>) -> Self {
        Self {
            runtime_id: runtime_id.into(),
            trace_id,
        }
    }

    pub fn runtime_id(&self) -> &str {
        &self.runtime_id
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalToolRuntimeStopResultPayload {
    runtime_id: String,
    stopped: bool,
}

impl LocalToolRuntimeStopResultPayload {
    pub fn stopped(runtime_id: impl Into<String>) -> Self {
        Self {
            runtime_id: runtime_id.into(),
            stopped: true,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalToolRuntimeHealthPayload {
    runtime_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl LocalToolRuntimeHealthPayload {
    pub fn new(runtime_id: impl Into<String>, trace_id: Option<String>) -> Self {
        Self {
            runtime_id: runtime_id.into(),
            trace_id,
        }
    }

    pub fn runtime_id(&self) -> &str {
        &self.runtime_id
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalToolRuntimeHealthResultPayload {
    runtime_id: String,
    status: LocalToolRuntimeHealthStatus,
    checked_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl LocalToolRuntimeHealthResultPayload {
    pub fn new(
        runtime_id: impl Into<String>,
        status: LocalToolRuntimeHealthStatus,
        checked_at: u64,
        reason: Option<String>,
    ) -> Self {
        Self {
            runtime_id: runtime_id.into(),
            status,
            checked_at,
            reason,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalToolRuntimeSupportedPayload {
    supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl LocalToolRuntimeSupportedPayload {
    pub fn supported() -> Self {
        Self {
            supported: true,
            reason: None,
        }
    }

    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            supported: false,
            reason: Some(reason.into()),
        }
    }

    pub fn reason(&self) -> Option<&str> {
        self.reason.as_deref()
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct LocalToolRuntimeEventPayload {
    r#type: String,
    timestamp: u64,
    runtime_id: String,
    tool_id: Option<String>,
    command_id: Option<String>,
    run_id: Option<String>,
    phase: LocalToolRuntimeEventPhase,
    status: Option<LocalToolRuntimeRunStatus>,
    health: Option<LocalToolRuntimeHealthStatus>,
    reason: Option<String>,
}

impl LocalToolRuntimeEventPayload {
    pub fn new(
        timestamp: u64,
        runtime_id: impl Into<String>,
        phase: LocalToolRuntimeEventPhase,
    ) -> Self {
        Self {
            r#type: "local-tool-runtime-event".to_string(),
            timestamp,
            runtime_id: runtime_id.into(),
            tool_id: None,
            command_id: None,
            run_id: None,
            phase,
            status: None,
            health: None,
            reason: None,
        }
    }

    pub fn with_run(
        mut self,
        tool_id: impl Into<String>,
        command_id: impl Into<String>,
        run_id: impl Into<String>,
        status: LocalToolRuntimeRunStatus,
    ) -> Self {
        self.tool_id = Some(tool_id.into());
        self.command_id = Some(command_id.into());
        self.run_id = Some(run_id.into());
        self.status = Some(status);
        self
    }

    pub fn with_run_ref(
        mut self,
        tool_id: impl Into<String>,
        command_id: impl Into<String>,
        run_id: impl Into<String>,
    ) -> Self {
        self.tool_id = Some(tool_id.into());
        self.command_id = Some(command_id.into());
        self.run_id = Some(run_id.into());
        self
    }

    pub fn with_tool(mut self, tool_id: impl Into<String>) -> Self {
        self.tool_id = Some(tool_id.into());
        self
    }

    pub fn with_health(
        mut self,
        tool_id: impl Into<String>,
        health: LocalToolRuntimeHealthStatus,
    ) -> Self {
        self.tool_id = Some(tool_id.into());
        self.health = Some(health);
        self
    }

    pub fn with_reason(mut self, reason: impl Into<String>) -> Self {
        self.reason = Some(reason.into());
        self
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SerializableLocalToolRuntimeEventPayload<'a> {
    r#type: &'a str,
    timestamp: u64,
    runtime_id: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    command_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    run_id: Option<&'a str>,
    phase: LocalToolRuntimeEventPhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<LocalToolRuntimeRunStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    health: Option<LocalToolRuntimeHealthStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'a str>,
}

impl<'a> TryFrom<&'a LocalToolRuntimeEventPayload>
    for SerializableLocalToolRuntimeEventPayload<'a>
{
    type Error = &'static str;

    fn try_from(payload: &'a LocalToolRuntimeEventPayload) -> Result<Self, Self::Error> {
        validate_local_tool_runtime_event_payload(
            payload.phase,
            &payload.run_id,
            payload.status,
            payload.health,
        )?;
        Ok(Self {
            r#type: &payload.r#type,
            timestamp: payload.timestamp,
            runtime_id: &payload.runtime_id,
            tool_id: payload.tool_id.as_deref(),
            command_id: payload.command_id.as_deref(),
            run_id: payload.run_id.as_deref(),
            phase: payload.phase,
            status: payload.status,
            health: payload.health,
            reason: payload.reason.as_deref(),
        })
    }
}

impl Serialize for LocalToolRuntimeEventPayload {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        SerializableLocalToolRuntimeEventPayload::try_from(self)
            .map_err(ser::Error::custom)?
            .serialize(serializer)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawLocalToolRuntimeEventPayload {
    r#type: String,
    timestamp: u64,
    runtime_id: String,
    tool_id: Option<String>,
    command_id: Option<String>,
    run_id: Option<String>,
    phase: LocalToolRuntimeEventPhase,
    status: Option<LocalToolRuntimeRunStatus>,
    health: Option<LocalToolRuntimeHealthStatus>,
    reason: Option<String>,
}

impl TryFrom<RawLocalToolRuntimeEventPayload> for LocalToolRuntimeEventPayload {
    type Error = &'static str;

    fn try_from(raw: RawLocalToolRuntimeEventPayload) -> Result<Self, Self::Error> {
        validate_local_tool_runtime_event_payload(raw.phase, &raw.run_id, raw.status, raw.health)?;
        Ok(Self {
            r#type: raw.r#type,
            timestamp: raw.timestamp,
            runtime_id: raw.runtime_id,
            tool_id: raw.tool_id,
            command_id: raw.command_id,
            run_id: raw.run_id,
            phase: raw.phase,
            status: raw.status,
            health: raw.health,
            reason: raw.reason,
        })
    }
}

impl<'de> Deserialize<'de> for LocalToolRuntimeEventPayload {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        RawLocalToolRuntimeEventPayload::deserialize(deserializer)?
            .try_into()
            .map_err(de::Error::custom)
    }
}

fn validate_local_tool_runtime_event_payload(
    phase: LocalToolRuntimeEventPhase,
    run_id: &Option<String>,
    status: Option<LocalToolRuntimeRunStatus>,
    health: Option<LocalToolRuntimeHealthStatus>,
) -> Result<(), &'static str> {
    match phase {
        LocalToolRuntimeEventPhase::RunStarted if run_id.is_none() => {
            Err("run-started local tool runtime event requires runId")
        }
        LocalToolRuntimeEventPhase::RunStarted if status.is_some() => {
            Err("run-started local tool runtime event must not carry status")
        }
        LocalToolRuntimeEventPhase::RunStarted if health.is_some() => {
            Err("run-started local tool runtime event must not carry health")
        }
        LocalToolRuntimeEventPhase::RunCompleted if run_id.is_none() => {
            Err("run-completed local tool runtime event requires runId")
        }
        LocalToolRuntimeEventPhase::RunCompleted if status.is_none() => {
            Err("run-completed local tool runtime event requires status")
        }
        LocalToolRuntimeEventPhase::RunCompleted if health.is_some() => {
            Err("run-completed local tool runtime event must not carry health")
        }
        LocalToolRuntimeEventPhase::RunStarted | LocalToolRuntimeEventPhase::RunCompleted => Ok(()),
        LocalToolRuntimeEventPhase::HealthChecked if health.is_none() => {
            Err("health-checked local tool runtime event requires health")
        }
        LocalToolRuntimeEventPhase::HealthChecked if run_id.is_some() => {
            Err("health-checked local tool runtime event must not carry runId")
        }
        LocalToolRuntimeEventPhase::HealthChecked if status.is_some() => {
            Err("health-checked local tool runtime event must not carry status")
        }
        LocalToolRuntimeEventPhase::HealthChecked => Ok(()),
        LocalToolRuntimeEventPhase::Registered | LocalToolRuntimeEventPhase::Stopped
            if run_id.is_some() =>
        {
            Err("non-run local tool runtime event must not carry runId")
        }
        LocalToolRuntimeEventPhase::Registered | LocalToolRuntimeEventPhase::Stopped
            if status.is_some() =>
        {
            Err("non-run local tool runtime event must not carry status")
        }
        LocalToolRuntimeEventPhase::Registered | LocalToolRuntimeEventPhase::Stopped
            if health.is_some() =>
        {
            Err("non-health local tool runtime event must not carry health")
        }
        LocalToolRuntimeEventPhase::Registered | LocalToolRuntimeEventPhase::Stopped => Ok(()),
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WorkspaceIndexActorKind {
    Workspace,
    Extension,
    Tool,
    Process,
    Native,
    App,
    Window,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WorkspaceIndexState {
    Opened,
    Refreshing,
    Closed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WorkspaceIndexEventPhase {
    Opened,
    RefreshStarted,
    EntryIndexed,
    EntryInvalidated,
    RefreshCompleted,
    Closed,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceIndexActorPayload {
    kind: WorkspaceIndexActorKind,
    id: String,
}

impl WorkspaceIndexActorPayload {
    pub fn new(kind: WorkspaceIndexActorKind, id: impl Into<String>) -> Self {
        Self {
            kind,
            id: id.into(),
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceIndexIgnoreRulePayload {
    pattern: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl WorkspaceIndexIgnoreRulePayload {
    pub fn new(pattern: impl Into<String>, reason: Option<String>) -> Self {
        Self {
            pattern: pattern.into(),
            reason,
        }
    }

    pub fn pattern(&self) -> &str {
        &self.pattern
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceIndexScopePayload {
    root: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    ignore_rules: Vec<WorkspaceIndexIgnoreRulePayload>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    grants: Vec<serde_json::Value>,
    #[serde(default)]
    watch: bool,
}

impl WorkspaceIndexScopePayload {
    pub fn new(
        root: impl Into<String>,
        ignore_rules: Vec<WorkspaceIndexIgnoreRulePayload>,
        grants: Vec<serde_json::Value>,
        watch: bool,
    ) -> Self {
        Self {
            root: root.into(),
            ignore_rules,
            grants,
            watch,
        }
    }

    pub fn root(&self) -> &str {
        &self.root
    }

    pub fn ignore_rules(&self) -> &[WorkspaceIndexIgnoreRulePayload] {
        &self.ignore_rules
    }

    pub fn grants(&self) -> &[serde_json::Value] {
        &self.grants
    }

    pub fn watch(&self) -> bool {
        self.watch
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceIndexOpenPayload {
    actor: WorkspaceIndexActorPayload,
    scope: WorkspaceIndexScopePayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    index_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl WorkspaceIndexOpenPayload {
    pub fn new(
        actor: WorkspaceIndexActorPayload,
        scope: WorkspaceIndexScopePayload,
        index_id: Option<String>,
        trace_id: Option<String>,
    ) -> Self {
        Self {
            actor,
            scope,
            index_id,
            trace_id,
        }
    }

    pub fn actor(&self) -> &WorkspaceIndexActorPayload {
        &self.actor
    }

    pub fn scope(&self) -> &WorkspaceIndexScopePayload {
        &self.scope
    }

    pub fn index_id(&self) -> Option<&str> {
        self.index_id.as_deref()
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceIndexOpenResultPayload {
    index_id: String,
    root: String,
    state: WorkspaceIndexState,
}

impl WorkspaceIndexOpenResultPayload {
    pub fn opened(index_id: impl Into<String>, root: impl Into<String>) -> Self {
        Self {
            index_id: index_id.into(),
            root: root.into(),
            state: WorkspaceIndexState::Opened,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceIndexRefreshPayload {
    index_id: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    changed_paths: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl WorkspaceIndexRefreshPayload {
    pub fn new(
        index_id: impl Into<String>,
        changed_paths: Vec<String>,
        trace_id: Option<String>,
    ) -> Self {
        Self {
            index_id: index_id.into(),
            changed_paths,
            trace_id,
        }
    }

    pub fn index_id(&self) -> &str {
        &self.index_id
    }

    pub fn changed_paths(&self) -> &[String] {
        &self.changed_paths
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceIndexRefreshResultPayload {
    index_id: String,
    state: WorkspaceIndexState,
    indexed: u64,
    invalidated: u64,
    ignored: u64,
}

impl WorkspaceIndexRefreshResultPayload {
    pub fn new(
        index_id: impl Into<String>,
        state: WorkspaceIndexState,
        indexed: u64,
        invalidated: u64,
        ignored: u64,
    ) -> Self {
        Self {
            index_id: index_id.into(),
            state,
            indexed,
            invalidated,
            ignored,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceIndexClosePayload {
    index_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl WorkspaceIndexClosePayload {
    pub fn new(index_id: impl Into<String>, trace_id: Option<String>) -> Self {
        Self {
            index_id: index_id.into(),
            trace_id,
        }
    }

    pub fn index_id(&self) -> &str {
        &self.index_id
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceIndexCloseResultPayload {
    index_id: String,
    closed: bool,
}

impl WorkspaceIndexCloseResultPayload {
    pub fn closed(index_id: impl Into<String>) -> Self {
        Self {
            index_id: index_id.into(),
            closed: true,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceIndexSupportedPayload {
    supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl WorkspaceIndexSupportedPayload {
    pub fn supported() -> Self {
        Self {
            supported: true,
            reason: None,
        }
    }

    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            supported: false,
            reason: Some(reason.into()),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ScopedAccessGrantActorKind {
    Workspace,
    Extension,
    Tool,
    Process,
    Native,
    App,
    Window,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ScopedAccessGrantScopeKind {
    File,
    Directory,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ScopedAccessGrantAccess {
    Read,
    Write,
    ReadWrite,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ScopedAccessGrantState {
    Granted,
    Resolved,
    Revoked,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ScopedAccessGrantEventPhase {
    Granted,
    Resolved,
    Revoked,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScopedAccessGrantActorPayload {
    kind: ScopedAccessGrantActorKind,
    id: String,
}

impl ScopedAccessGrantActorPayload {
    pub fn new(kind: ScopedAccessGrantActorKind, id: impl Into<String>) -> Self {
        Self {
            kind,
            id: id.into(),
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScopedAccessGrantScopePayload {
    path: String,
    kind: ScopedAccessGrantScopeKind,
    access: ScopedAccessGrantAccess,
}

impl ScopedAccessGrantScopePayload {
    pub fn new(
        path: impl Into<String>,
        kind: ScopedAccessGrantScopeKind,
        access: ScopedAccessGrantAccess,
    ) -> Self {
        Self {
            path: path.into(),
            kind,
            access,
        }
    }

    pub fn path(&self) -> &str {
        &self.path
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScopedAccessGrantGrantPayload {
    actor: ScopedAccessGrantActorPayload,
    scope: ScopedAccessGrantScopePayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    grant_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl ScopedAccessGrantGrantPayload {
    pub fn new(
        actor: ScopedAccessGrantActorPayload,
        scope: ScopedAccessGrantScopePayload,
        grant_id: Option<String>,
        trace_id: Option<String>,
    ) -> Self {
        Self {
            actor,
            scope,
            grant_id,
            trace_id,
        }
    }

    pub fn actor(&self) -> &ScopedAccessGrantActorPayload {
        &self.actor
    }

    pub fn scope(&self) -> &ScopedAccessGrantScopePayload {
        &self.scope
    }

    pub fn grant_id(&self) -> Option<&str> {
        self.grant_id.as_deref()
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScopedAccessGrantResolvePayload {
    grant_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl ScopedAccessGrantResolvePayload {
    pub fn new(grant_id: impl Into<String>, trace_id: Option<String>) -> Self {
        Self {
            grant_id: grant_id.into(),
            trace_id,
        }
    }

    pub fn grant_id(&self) -> &str {
        &self.grant_id
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScopedAccessGrantRevokePayload {
    grant_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl ScopedAccessGrantRevokePayload {
    pub fn new(grant_id: impl Into<String>, trace_id: Option<String>) -> Self {
        Self {
            grant_id: grant_id.into(),
            trace_id,
        }
    }

    pub fn grant_id(&self) -> &str {
        &self.grant_id
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScopedAccessGrantGrantResultPayload {
    grant_id: String,
    scope: ScopedAccessGrantScopePayload,
    state: ScopedAccessGrantState,
}

impl ScopedAccessGrantGrantResultPayload {
    pub fn granted(grant_id: impl Into<String>, scope: ScopedAccessGrantScopePayload) -> Self {
        Self {
            grant_id: grant_id.into(),
            scope,
            state: ScopedAccessGrantState::Granted,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScopedAccessGrantResolveResultPayload {
    grant_id: String,
    scope: ScopedAccessGrantScopePayload,
    state: ScopedAccessGrantState,
    revalidated: bool,
}

impl ScopedAccessGrantResolveResultPayload {
    pub fn resolved(
        grant_id: impl Into<String>,
        scope: ScopedAccessGrantScopePayload,
        revalidated: bool,
    ) -> Self {
        Self {
            grant_id: grant_id.into(),
            scope,
            state: ScopedAccessGrantState::Resolved,
            revalidated,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScopedAccessGrantRevokeResultPayload {
    grant_id: String,
    revoked: bool,
}

impl ScopedAccessGrantRevokeResultPayload {
    pub fn new(grant_id: impl Into<String>, revoked: bool) -> Self {
        Self {
            grant_id: grant_id.into(),
            revoked,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScopedAccessGrantSupportedPayload {
    supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl ScopedAccessGrantSupportedPayload {
    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            supported: false,
            reason: Some(reason.into()),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct ScopedAccessGrantEventPayload {
    r#type: String,
    timestamp: u64,
    grant_id: String,
    path: Option<String>,
    phase: ScopedAccessGrantEventPhase,
    state: Option<ScopedAccessGrantState>,
}

impl ScopedAccessGrantEventPayload {
    pub fn new(
        timestamp: u64,
        grant_id: impl Into<String>,
        phase: ScopedAccessGrantEventPhase,
    ) -> Self {
        let state = match phase {
            ScopedAccessGrantEventPhase::Granted => ScopedAccessGrantState::Granted,
            ScopedAccessGrantEventPhase::Resolved => ScopedAccessGrantState::Resolved,
            ScopedAccessGrantEventPhase::Revoked => ScopedAccessGrantState::Revoked,
        };
        Self {
            r#type: "scoped-access-grant-event".to_string(),
            timestamp,
            grant_id: grant_id.into(),
            path: None,
            phase,
            state: Some(state),
        }
    }

    pub fn with_path(mut self, path: impl Into<String>) -> Self {
        self.path = Some(path.into());
        self
    }

    #[cfg(test)]
    fn with_state_for_test(mut self, state: ScopedAccessGrantState) -> Self {
        self.state = Some(state);
        self
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SerializableScopedAccessGrantEventPayload<'a> {
    r#type: &'a str,
    timestamp: u64,
    grant_id: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<&'a str>,
    phase: ScopedAccessGrantEventPhase,
    state: ScopedAccessGrantState,
}

impl<'a> TryFrom<&'a ScopedAccessGrantEventPayload>
    for SerializableScopedAccessGrantEventPayload<'a>
{
    type Error = &'static str;

    fn try_from(payload: &'a ScopedAccessGrantEventPayload) -> Result<Self, Self::Error> {
        let state = validate_scoped_access_grant_event_state(payload.phase, payload.state)?;
        Ok(Self {
            r#type: &payload.r#type,
            timestamp: payload.timestamp,
            grant_id: &payload.grant_id,
            path: payload.path.as_deref(),
            phase: payload.phase,
            state,
        })
    }
}

impl Serialize for ScopedAccessGrantEventPayload {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        SerializableScopedAccessGrantEventPayload::try_from(self)
            .map_err(ser::Error::custom)?
            .serialize(serializer)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawScopedAccessGrantEventPayload {
    r#type: String,
    timestamp: u64,
    grant_id: String,
    path: Option<String>,
    phase: ScopedAccessGrantEventPhase,
    state: Option<ScopedAccessGrantState>,
}

impl TryFrom<RawScopedAccessGrantEventPayload> for ScopedAccessGrantEventPayload {
    type Error = &'static str;

    fn try_from(raw: RawScopedAccessGrantEventPayload) -> Result<Self, Self::Error> {
        validate_scoped_access_grant_event_state(raw.phase, raw.state)?;
        Ok(Self {
            r#type: raw.r#type,
            timestamp: raw.timestamp,
            grant_id: raw.grant_id,
            path: raw.path,
            phase: raw.phase,
            state: raw.state,
        })
    }
}

impl<'de> Deserialize<'de> for ScopedAccessGrantEventPayload {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        RawScopedAccessGrantEventPayload::deserialize(deserializer)?
            .try_into()
            .map_err(de::Error::custom)
    }
}

fn validate_scoped_access_grant_event_state(
    phase: ScopedAccessGrantEventPhase,
    state: Option<ScopedAccessGrantState>,
) -> Result<ScopedAccessGrantState, &'static str> {
    let expected = match phase {
        ScopedAccessGrantEventPhase::Granted => ScopedAccessGrantState::Granted,
        ScopedAccessGrantEventPhase::Resolved => ScopedAccessGrantState::Resolved,
        ScopedAccessGrantEventPhase::Revoked => ScopedAccessGrantState::Revoked,
    };
    match state {
        Some(actual) if actual == expected => Ok(actual),
        _ => Err("scoped access grant event phase requires matching state"),
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionProfileResourcePayload {
    kind: String,
    id: String,
    generation: u64,
    owner_scope: String,
    state: String,
}

impl SessionProfileResourcePayload {
    pub fn new(id: impl Into<String>, generation: u64, owner_scope: impl Into<String>) -> Self {
        Self {
            kind: "session-profile".to_string(),
            id: id.into(),
            generation,
            owner_scope: owner_scope.into(),
            state: "open".to_string(),
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn kind(&self) -> &str {
        &self.kind
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn owner_scope(&self) -> &str {
        &self.owner_scope
    }

    pub fn state(&self) -> &str {
        &self.state
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionProfileFromPartitionPayload {
    partition: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    owner_scope: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl SessionProfileFromPartitionPayload {
    pub fn new(partition: impl Into<String>) -> Self {
        Self {
            partition: partition.into(),
            owner_scope: None,
            trace_id: None,
        }
    }

    pub fn with_owner_scope(mut self, owner_scope: impl Into<String>) -> Self {
        self.owner_scope = Some(owner_scope.into());
        self
    }

    pub fn partition(&self) -> &str {
        &self.partition
    }

    pub fn owner_scope(&self) -> Option<&str> {
        self.owner_scope.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionProfileHandlePayload {
    profile: SessionProfileResourcePayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl SessionProfileHandlePayload {
    pub fn new(profile: SessionProfileResourcePayload) -> Self {
        Self {
            profile,
            trace_id: None,
        }
    }

    pub fn profile(&self) -> &SessionProfileResourcePayload {
        &self.profile
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionProfileListPayload {
    profiles: Vec<SessionProfileResourcePayload>,
}

impl SessionProfileListPayload {
    pub fn new(profiles: Vec<SessionProfileResourcePayload>) -> Self {
        Self { profiles }
    }

    pub fn profiles(&self) -> &[SessionProfileResourcePayload] {
        &self.profiles
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionProfileSupportedPayload {
    supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl SessionProfileSupportedPayload {
    pub fn supported() -> Self {
        Self {
            supported: true,
            reason: None,
        }
    }

    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            supported: false,
            reason: Some(reason.into()),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SessionProfileEventPhasePayload {
    Opened,
    Closed,
    Failed,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SessionProfileEventPayload {
    r#type: String,
    timestamp: u64,
    phase: SessionProfileEventPhasePayload,
    profile: Option<SessionProfileResourcePayload>,
    partition: Option<String>,
    message: Option<String>,
}

impl SessionProfileEventPayload {
    pub fn opened(
        timestamp: u64,
        profile: SessionProfileResourcePayload,
        partition: impl Into<String>,
    ) -> Self {
        Self {
            r#type: "session-profile-event".to_string(),
            timestamp,
            phase: SessionProfileEventPhasePayload::Opened,
            profile: Some(profile),
            partition: Some(partition.into()),
            message: None,
        }
    }

    pub fn closed(
        timestamp: u64,
        profile: SessionProfileResourcePayload,
        partition: impl Into<String>,
    ) -> Self {
        Self {
            r#type: "session-profile-event".to_string(),
            timestamp,
            phase: SessionProfileEventPhasePayload::Closed,
            profile: Some(profile),
            partition: Some(partition.into()),
            message: None,
        }
    }

    pub fn failed(timestamp: u64, message: impl Into<String>) -> Self {
        Self {
            r#type: "session-profile-event".to_string(),
            timestamp,
            phase: SessionProfileEventPhasePayload::Failed,
            profile: None,
            partition: None,
            message: Some(message.into()),
        }
    }

    #[cfg(test)]
    fn new_for_test(timestamp: u64, phase: SessionProfileEventPhasePayload) -> Self {
        Self {
            r#type: "session-profile-event".to_string(),
            timestamp,
            phase,
            profile: None,
            partition: None,
            message: None,
        }
    }

    #[cfg(test)]
    fn with_profile_for_test(
        mut self,
        profile: SessionProfileResourcePayload,
        partition: impl Into<String>,
    ) -> Self {
        self.profile = Some(profile);
        self.partition = Some(partition.into());
        self
    }

    #[cfg(test)]
    fn with_message_for_test(mut self, message: impl Into<String>) -> Self {
        self.message = Some(message.into());
        self
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SerializableSessionProfileEventPayload<'a> {
    r#type: &'a str,
    timestamp: u64,
    phase: SessionProfileEventPhasePayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    profile: Option<&'a SessionProfileResourcePayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    partition: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<&'a str>,
}

impl<'a> TryFrom<&'a SessionProfileEventPayload> for SerializableSessionProfileEventPayload<'a> {
    type Error = &'static str;

    fn try_from(payload: &'a SessionProfileEventPayload) -> Result<Self, Self::Error> {
        validate_session_profile_event_payload(
            payload.phase,
            &payload.profile,
            &payload.partition,
            &payload.message,
        )?;
        Ok(Self {
            r#type: &payload.r#type,
            timestamp: payload.timestamp,
            phase: payload.phase,
            profile: payload.profile.as_ref(),
            partition: payload.partition.as_deref(),
            message: payload.message.as_deref(),
        })
    }
}

impl Serialize for SessionProfileEventPayload {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        SerializableSessionProfileEventPayload::try_from(self)
            .map_err(ser::Error::custom)?
            .serialize(serializer)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawSessionProfileEventPayload {
    r#type: String,
    timestamp: u64,
    phase: SessionProfileEventPhasePayload,
    profile: Option<SessionProfileResourcePayload>,
    partition: Option<String>,
    message: Option<String>,
}

impl TryFrom<RawSessionProfileEventPayload> for SessionProfileEventPayload {
    type Error = &'static str;

    fn try_from(raw: RawSessionProfileEventPayload) -> Result<Self, Self::Error> {
        validate_session_profile_event_payload(
            raw.phase,
            &raw.profile,
            &raw.partition,
            &raw.message,
        )?;
        Ok(Self {
            r#type: raw.r#type,
            timestamp: raw.timestamp,
            phase: raw.phase,
            profile: raw.profile,
            partition: raw.partition,
            message: raw.message,
        })
    }
}

impl<'de> Deserialize<'de> for SessionProfileEventPayload {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        RawSessionProfileEventPayload::deserialize(deserializer)?
            .try_into()
            .map_err(de::Error::custom)
    }
}

fn validate_session_profile_event_payload(
    phase: SessionProfileEventPhasePayload,
    profile: &Option<SessionProfileResourcePayload>,
    partition: &Option<String>,
    message: &Option<String>,
) -> Result<(), &'static str> {
    let has_profile = profile.is_some();
    let has_partition = partition.is_some();
    match phase {
        SessionProfileEventPhasePayload::Opened | SessionProfileEventPhasePayload::Closed => {
            if has_profile && has_partition && message.is_none() {
                Ok(())
            } else {
                Err("session profile lifecycle events require profile and partition only")
            }
        }
        SessionProfileEventPhasePayload::Failed => {
            if !has_profile && !has_partition && message.is_some() {
                Ok(())
            } else {
                Err("failed session profile events require message only")
            }
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum CookieStoreSameSitePayload {
    Lax,
    Strict,
    None,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CookieStoreCookiePayload {
    name: String,
    value: String,
    domain: String,
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    secure: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    http_only: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    same_site: Option<CookieStoreSameSitePayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    expires_at: Option<f64>,
}

impl CookieStoreCookiePayload {
    pub fn new(
        name: impl Into<String>,
        value: impl Into<String>,
        domain: impl Into<String>,
        path: impl Into<String>,
    ) -> Self {
        Self {
            name: name.into(),
            value: value.into(),
            domain: domain.into(),
            path: path.into(),
            secure: None,
            http_only: None,
            same_site: None,
            expires_at: None,
        }
    }

    pub fn with_secure(mut self, secure: bool) -> Self {
        self.secure = Some(secure);
        self
    }

    pub fn with_http_only(mut self, http_only: bool) -> Self {
        self.http_only = Some(http_only);
        self
    }

    pub fn with_same_site(mut self, same_site: CookieStoreSameSitePayload) -> Self {
        self.same_site = Some(same_site);
        self
    }

    pub fn with_expires_at(mut self, expires_at: f64) -> Self {
        self.expires_at = Some(expires_at);
        self
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn value(&self) -> &str {
        &self.value
    }

    pub fn domain(&self) -> &str {
        &self.domain
    }

    pub fn path(&self) -> &str {
        &self.path
    }

    pub fn secure(&self) -> Option<bool> {
        self.secure
    }

    pub fn http_only(&self) -> Option<bool> {
        self.http_only
    }

    pub fn same_site(&self) -> Option<CookieStoreSameSitePayload> {
        self.same_site
    }

    pub fn expires_at(&self) -> Option<f64> {
        self.expires_at
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CookieStoreGetPayload {
    profile: SessionProfileResourcePayload,
    url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl CookieStoreGetPayload {
    pub fn new(profile: SessionProfileResourcePayload, url: impl Into<String>) -> Self {
        Self {
            profile,
            url: url.into(),
            name: None,
            trace_id: None,
        }
    }

    pub fn profile(&self) -> &SessionProfileResourcePayload {
        &self.profile
    }

    pub fn url(&self) -> &str {
        &self.url
    }

    pub fn name(&self) -> Option<&str> {
        self.name.as_deref()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CookieStoreSetPayload {
    profile: SessionProfileResourcePayload,
    url: String,
    cookie: CookieStoreCookiePayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl CookieStoreSetPayload {
    pub fn new(
        profile: SessionProfileResourcePayload,
        url: impl Into<String>,
        cookie: CookieStoreCookiePayload,
    ) -> Self {
        Self {
            profile,
            url: url.into(),
            cookie,
            trace_id: None,
        }
    }

    pub fn profile(&self) -> &SessionProfileResourcePayload {
        &self.profile
    }

    pub fn url(&self) -> &str {
        &self.url
    }

    pub fn cookie(&self) -> &CookieStoreCookiePayload {
        &self.cookie
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CookieStoreRemovePayload {
    profile: SessionProfileResourcePayload,
    url: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl CookieStoreRemovePayload {
    pub fn new(
        profile: SessionProfileResourcePayload,
        url: impl Into<String>,
        name: impl Into<String>,
    ) -> Self {
        Self {
            profile,
            url: url.into(),
            name: name.into(),
            trace_id: None,
        }
    }

    pub fn profile(&self) -> &SessionProfileResourcePayload {
        &self.profile
    }

    pub fn url(&self) -> &str {
        &self.url
    }

    pub fn name(&self) -> &str {
        &self.name
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CookieStoreGetResultPayload {
    cookies: Vec<CookieStoreCookiePayload>,
}

impl CookieStoreGetResultPayload {
    pub fn new(cookies: Vec<CookieStoreCookiePayload>) -> Self {
        Self { cookies }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CookieStoreSupportedPayload {
    supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl CookieStoreSupportedPayload {
    pub fn supported() -> Self {
        Self {
            supported: true,
            reason: None,
        }
    }

    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            supported: false,
            reason: Some(reason.into()),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CookieStoreEventPhasePayload {
    Set,
    Removed,
    Failed,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CookieStoreEventPayload {
    r#type: String,
    timestamp: u64,
    phase: CookieStoreEventPhasePayload,
    profile: SessionProfileResourcePayload,
    url: String,
    cookie: Option<CookieStoreCookiePayload>,
    name: Option<String>,
    message: Option<String>,
}

impl CookieStoreEventPayload {
    pub fn set(
        timestamp: u64,
        profile: SessionProfileResourcePayload,
        url: impl Into<String>,
        cookie: CookieStoreCookiePayload,
    ) -> Self {
        Self {
            r#type: "cookie-store-event".to_string(),
            timestamp,
            phase: CookieStoreEventPhasePayload::Set,
            profile,
            url: url.into(),
            cookie: Some(cookie),
            name: None,
            message: None,
        }
    }

    pub fn removed(
        timestamp: u64,
        profile: SessionProfileResourcePayload,
        url: impl Into<String>,
        name: impl Into<String>,
    ) -> Self {
        Self {
            r#type: "cookie-store-event".to_string(),
            timestamp,
            phase: CookieStoreEventPhasePayload::Removed,
            profile,
            url: url.into(),
            cookie: None,
            name: Some(name.into()),
            message: None,
        }
    }

    pub fn failed(
        timestamp: u64,
        profile: SessionProfileResourcePayload,
        url: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            r#type: "cookie-store-event".to_string(),
            timestamp,
            phase: CookieStoreEventPhasePayload::Failed,
            profile,
            url: url.into(),
            cookie: None,
            name: None,
            message: Some(message.into()),
        }
    }

    #[cfg(test)]
    fn new_for_test(
        timestamp: u64,
        phase: CookieStoreEventPhasePayload,
        profile: SessionProfileResourcePayload,
        url: impl Into<String>,
    ) -> Self {
        Self {
            r#type: "cookie-store-event".to_string(),
            timestamp,
            phase,
            profile,
            url: url.into(),
            cookie: None,
            name: None,
            message: None,
        }
    }

    #[cfg(test)]
    fn with_cookie_for_test(mut self, cookie: CookieStoreCookiePayload) -> Self {
        self.cookie = Some(cookie);
        self
    }

    #[cfg(test)]
    fn with_name_for_test(mut self, name: impl Into<String>) -> Self {
        self.name = Some(name.into());
        self
    }

    #[cfg(test)]
    fn with_message_for_test(mut self, message: impl Into<String>) -> Self {
        self.message = Some(message.into());
        self
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SerializableCookieStoreEventPayload<'a> {
    r#type: &'a str,
    timestamp: u64,
    phase: CookieStoreEventPhasePayload,
    profile: &'a SessionProfileResourcePayload,
    url: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    cookie: Option<&'a CookieStoreCookiePayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<&'a str>,
}

impl<'a> TryFrom<&'a CookieStoreEventPayload> for SerializableCookieStoreEventPayload<'a> {
    type Error = &'static str;

    fn try_from(payload: &'a CookieStoreEventPayload) -> Result<Self, Self::Error> {
        validate_cookie_store_event_payload(
            payload.phase,
            &payload.cookie,
            &payload.name,
            &payload.message,
        )?;
        Ok(Self {
            r#type: &payload.r#type,
            timestamp: payload.timestamp,
            phase: payload.phase,
            profile: &payload.profile,
            url: &payload.url,
            cookie: payload.cookie.as_ref(),
            name: payload.name.as_deref(),
            message: payload.message.as_deref(),
        })
    }
}

impl Serialize for CookieStoreEventPayload {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        SerializableCookieStoreEventPayload::try_from(self)
            .map_err(ser::Error::custom)?
            .serialize(serializer)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawCookieStoreEventPayload {
    r#type: String,
    timestamp: u64,
    phase: CookieStoreEventPhasePayload,
    profile: SessionProfileResourcePayload,
    url: String,
    #[serde(default)]
    cookie: Option<CookieStoreCookiePayload>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    message: Option<String>,
}

impl TryFrom<RawCookieStoreEventPayload> for CookieStoreEventPayload {
    type Error = &'static str;

    fn try_from(raw: RawCookieStoreEventPayload) -> Result<Self, Self::Error> {
        if raw.r#type != "cookie-store-event" {
            return Err("cookie store event type must be cookie-store-event");
        }
        validate_cookie_store_event_payload(raw.phase, &raw.cookie, &raw.name, &raw.message)?;
        Ok(Self {
            r#type: raw.r#type,
            timestamp: raw.timestamp,
            phase: raw.phase,
            profile: raw.profile,
            url: raw.url,
            cookie: raw.cookie,
            name: raw.name,
            message: raw.message,
        })
    }
}

impl<'de> Deserialize<'de> for CookieStoreEventPayload {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        RawCookieStoreEventPayload::deserialize(deserializer)?
            .try_into()
            .map_err(de::Error::custom)
    }
}

fn validate_cookie_store_event_payload(
    phase: CookieStoreEventPhasePayload,
    cookie: &Option<CookieStoreCookiePayload>,
    name: &Option<String>,
    message: &Option<String>,
) -> Result<(), &'static str> {
    match phase {
        CookieStoreEventPhasePayload::Set
            if cookie.is_some() && name.is_none() && message.is_none() =>
        {
            Ok(())
        }
        CookieStoreEventPhasePayload::Set => Err("set cookie store events require cookie only"),
        CookieStoreEventPhasePayload::Removed
            if cookie.is_none() && name.is_some() && message.is_none() =>
        {
            Ok(())
        }
        CookieStoreEventPhasePayload::Removed => {
            Err("removed cookie store events require name only")
        }
        CookieStoreEventPhasePayload::Failed
            if cookie.is_none() && name.is_none() && message.is_some() =>
        {
            Ok(())
        }
        CookieStoreEventPhasePayload::Failed => {
            Err("failed cookie store events require message only")
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum BrowsingDataTypePayload {
    Cache,
    Cookies,
    LocalStorage,
    IndexedDb,
    History,
    ServiceWorkers,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BrowsingDataClearPayload {
    profile: SessionProfileResourcePayload,
    types: Vec<BrowsingDataTypePayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl BrowsingDataClearPayload {
    pub fn new(
        profile: SessionProfileResourcePayload,
        types: Vec<BrowsingDataTypePayload>,
    ) -> Self {
        Self {
            profile,
            types,
            trace_id: None,
        }
    }

    pub fn profile(&self) -> &SessionProfileResourcePayload {
        &self.profile
    }

    pub fn types(&self) -> &[BrowsingDataTypePayload] {
        &self.types
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BrowsingDataEstimatePayload {
    profile: SessionProfileResourcePayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    types: Option<Vec<BrowsingDataTypePayload>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl BrowsingDataEstimatePayload {
    pub fn new(profile: SessionProfileResourcePayload) -> Self {
        Self {
            profile,
            types: None,
            trace_id: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BrowsingDataTypeEstimatePayload {
    r#type: BrowsingDataTypePayload,
    supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    bytes: Option<u64>,
}

impl BrowsingDataTypeEstimatePayload {
    pub fn new(r#type: BrowsingDataTypePayload, supported: bool, bytes: Option<u64>) -> Self {
        Self {
            r#type,
            supported,
            bytes,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BrowsingDataClearResultPayload {
    cleared: Vec<BrowsingDataTypePayload>,
    unsupported: Vec<BrowsingDataTypePayload>,
}

impl BrowsingDataClearResultPayload {
    pub fn new(
        cleared: Vec<BrowsingDataTypePayload>,
        unsupported: Vec<BrowsingDataTypePayload>,
    ) -> Self {
        Self {
            cleared,
            unsupported,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BrowsingDataEstimateResultPayload {
    estimates: Vec<BrowsingDataTypeEstimatePayload>,
}

impl BrowsingDataEstimateResultPayload {
    pub fn new(estimates: Vec<BrowsingDataTypeEstimatePayload>) -> Self {
        Self { estimates }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BrowsingDataListTypesPayload {
    types: Vec<BrowsingDataTypePayload>,
}

impl BrowsingDataListTypesPayload {
    pub fn new(types: Vec<BrowsingDataTypePayload>) -> Self {
        Self { types }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BrowsingDataSupportedPayload {
    supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl BrowsingDataSupportedPayload {
    pub fn supported() -> Self {
        Self {
            supported: true,
            reason: None,
        }
    }

    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            supported: false,
            reason: Some(reason.into()),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum SessionPermissionKindPayload {
    Camera,
    Microphone,
    Notifications,
    Geolocation,
    ClipboardRead,
    ClipboardWrite,
    DisplayCapture,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum SessionPermissionDecisionPayload {
    Grant,
    Deny,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum SessionPermissionRequestStatusPayload {
    Pending,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum SessionPermissionEventPhasePayload {
    Requested,
    Decided,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionPermissionRequestPayload {
    profile: SessionProfileResourcePayload,
    kind: SessionPermissionKindPayload,
    origin: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl SessionPermissionRequestPayload {
    pub fn new(
        profile: SessionProfileResourcePayload,
        kind: SessionPermissionKindPayload,
        origin: impl Into<String>,
    ) -> Self {
        Self {
            profile,
            kind,
            origin: origin.into(),
            request_id: None,
            trace_id: None,
        }
    }

    pub fn with_request_id(mut self, request_id: impl Into<String>) -> Self {
        self.request_id = Some(request_id.into());
        self
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionPermissionDecidePayload {
    profile: SessionProfileResourcePayload,
    request_id: String,
    kind: SessionPermissionKindPayload,
    origin: String,
    decision: SessionPermissionDecisionPayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl SessionPermissionDecidePayload {
    pub fn new(
        profile: SessionProfileResourcePayload,
        request_id: impl Into<String>,
        kind: SessionPermissionKindPayload,
        origin: impl Into<String>,
        decision: SessionPermissionDecisionPayload,
    ) -> Self {
        Self {
            profile,
            request_id: request_id.into(),
            kind,
            origin: origin.into(),
            decision,
            trace_id: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionPermissionListPayload {
    profile: SessionProfileResourcePayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    kind: Option<SessionPermissionKindPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    origin: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl SessionPermissionListPayload {
    pub fn new(profile: SessionProfileResourcePayload) -> Self {
        Self {
            profile,
            kind: None,
            origin: None,
            trace_id: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionPermissionRequestResultPayload {
    request_id: String,
    status: SessionPermissionRequestStatusPayload,
}

impl SessionPermissionRequestResultPayload {
    pub fn new(request_id: impl Into<String>) -> Self {
        Self {
            request_id: request_id.into(),
            status: SessionPermissionRequestStatusPayload::Pending,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionPermissionDecisionRecordPayload {
    profile: SessionProfileResourcePayload,
    request_id: String,
    kind: SessionPermissionKindPayload,
    origin: String,
    decision: SessionPermissionDecisionPayload,
    decided_at: u64,
}

impl SessionPermissionDecisionRecordPayload {
    pub fn new(
        profile: SessionProfileResourcePayload,
        request_id: impl Into<String>,
        kind: SessionPermissionKindPayload,
        origin: impl Into<String>,
        decision: SessionPermissionDecisionPayload,
        decided_at: u64,
    ) -> Self {
        Self {
            profile,
            request_id: request_id.into(),
            kind,
            origin: origin.into(),
            decision,
            decided_at,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionPermissionListResultPayload {
    decisions: Vec<SessionPermissionDecisionRecordPayload>,
}

impl SessionPermissionListResultPayload {
    pub fn new(decisions: Vec<SessionPermissionDecisionRecordPayload>) -> Self {
        Self { decisions }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionPermissionSupportedPayload {
    supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl SessionPermissionSupportedPayload {
    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            supported: false,
            reason: Some(reason.into()),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct SessionPermissionEventPayload {
    r#type: String,
    timestamp: u64,
    phase: SessionPermissionEventPhasePayload,
    profile: SessionProfileResourcePayload,
    request_id: String,
    kind: SessionPermissionKindPayload,
    origin: String,
    decision: Option<SessionPermissionDecisionPayload>,
    message: Option<String>,
}

impl SessionPermissionEventPayload {
    pub fn new(
        timestamp: u64,
        phase: SessionPermissionEventPhasePayload,
        profile: SessionProfileResourcePayload,
        request_id: impl Into<String>,
        kind: SessionPermissionKindPayload,
        origin: impl Into<String>,
    ) -> Self {
        Self {
            r#type: "session-permission-event".to_string(),
            timestamp,
            phase,
            profile,
            request_id: request_id.into(),
            kind,
            origin: origin.into(),
            decision: None,
            message: None,
        }
    }

    pub fn with_decision(mut self, decision: SessionPermissionDecisionPayload) -> Self {
        self.decision = Some(decision);
        self
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SerializableSessionPermissionEventPayload<'a> {
    r#type: &'a str,
    timestamp: u64,
    phase: SessionPermissionEventPhasePayload,
    profile: &'a SessionProfileResourcePayload,
    request_id: &'a str,
    kind: &'a SessionPermissionKindPayload,
    origin: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    decision: Option<SessionPermissionDecisionPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<&'a str>,
}

impl<'a> TryFrom<&'a SessionPermissionEventPayload>
    for SerializableSessionPermissionEventPayload<'a>
{
    type Error = &'static str;

    fn try_from(payload: &'a SessionPermissionEventPayload) -> Result<Self, Self::Error> {
        validate_session_permission_event_decision(payload.phase, payload.decision)?;
        Ok(Self {
            r#type: &payload.r#type,
            timestamp: payload.timestamp,
            phase: payload.phase,
            profile: &payload.profile,
            request_id: &payload.request_id,
            kind: &payload.kind,
            origin: &payload.origin,
            decision: payload.decision,
            message: payload.message.as_deref(),
        })
    }
}

impl Serialize for SessionPermissionEventPayload {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        SerializableSessionPermissionEventPayload::try_from(self)
            .map_err(ser::Error::custom)?
            .serialize(serializer)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawSessionPermissionEventPayload {
    r#type: String,
    timestamp: u64,
    phase: SessionPermissionEventPhasePayload,
    profile: SessionProfileResourcePayload,
    request_id: String,
    kind: SessionPermissionKindPayload,
    origin: String,
    decision: Option<SessionPermissionDecisionPayload>,
    message: Option<String>,
}

impl TryFrom<RawSessionPermissionEventPayload> for SessionPermissionEventPayload {
    type Error = &'static str;

    fn try_from(raw: RawSessionPermissionEventPayload) -> Result<Self, Self::Error> {
        validate_session_permission_event_decision(raw.phase, raw.decision)?;
        Ok(Self {
            r#type: raw.r#type,
            timestamp: raw.timestamp,
            phase: raw.phase,
            profile: raw.profile,
            request_id: raw.request_id,
            kind: raw.kind,
            origin: raw.origin,
            decision: raw.decision,
            message: raw.message,
        })
    }
}

impl<'de> Deserialize<'de> for SessionPermissionEventPayload {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        RawSessionPermissionEventPayload::deserialize(deserializer)?
            .try_into()
            .map_err(de::Error::custom)
    }
}

fn validate_session_permission_event_decision(
    phase: SessionPermissionEventPhasePayload,
    decision: Option<SessionPermissionDecisionPayload>,
) -> Result<(), &'static str> {
    match phase {
        SessionPermissionEventPhasePayload::Decided if decision.is_none() => {
            Err("decided session permission event requires decision")
        }
        SessionPermissionEventPhasePayload::Decided => Ok(()),
        SessionPermissionEventPhasePayload::Requested
        | SessionPermissionEventPhasePayload::Failed
            if decision.is_some() =>
        {
            Err("non-decision session permission event must not carry decision")
        }
        SessionPermissionEventPhasePayload::Requested
        | SessionPermissionEventPhasePayload::Failed => Ok(()),
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DownloadResourcePayload {
    kind: String,
    id: String,
    generation: u64,
    owner_scope: String,
    state: String,
}

impl DownloadResourcePayload {
    pub fn new(id: impl Into<String>, generation: u64, owner_scope: impl Into<String>) -> Self {
        Self {
            kind: "download".to_string(),
            id: id.into(),
            generation,
            owner_scope: owner_scope.into(),
            state: "open".to_string(),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum DownloadStatePayload {
    Running,
    Paused,
    Completed,
    Canceled,
    Failed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum DownloadEventPhasePayload {
    Started,
    Progressed,
    Paused,
    Resumed,
    Completed,
    Canceled,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DownloadStartPayload {
    profile: SessionProfileResourcePayload,
    url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    destination: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    owner_scope: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl DownloadStartPayload {
    pub fn new(profile: SessionProfileResourcePayload, url: impl Into<String>) -> Self {
        Self {
            profile,
            url: url.into(),
            destination: None,
            owner_scope: None,
            trace_id: None,
        }
    }

    pub fn with_destination(mut self, destination: impl Into<String>) -> Self {
        self.destination = Some(destination.into());
        self
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DownloadHandlePayload {
    download: DownloadResourcePayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl DownloadHandlePayload {
    pub fn new(download: DownloadResourcePayload) -> Self {
        Self {
            download,
            trace_id: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DownloadListPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    profile: Option<SessionProfileResourcePayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl DownloadListPayload {
    pub fn all() -> Self {
        Self {
            profile: None,
            trace_id: None,
        }
    }

    pub fn for_profile(profile: SessionProfileResourcePayload) -> Self {
        Self {
            profile: Some(profile),
            trace_id: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct DownloadSnapshotPayload {
    download: DownloadResourcePayload,
    profile: SessionProfileResourcePayload,
    url: String,
    destination: Option<String>,
    state: DownloadStatePayload,
    received_bytes: u64,
    total_bytes: Option<u64>,
    message: Option<String>,
}

impl DownloadSnapshotPayload {
    pub fn new(
        download: DownloadResourcePayload,
        profile: SessionProfileResourcePayload,
        url: impl Into<String>,
        state: DownloadStatePayload,
        received_bytes: u64,
    ) -> Self {
        Self {
            download,
            profile,
            url: url.into(),
            destination: None,
            state,
            received_bytes,
            total_bytes: None,
            message: None,
        }
    }

    pub fn with_total_bytes(mut self, total_bytes: u64) -> Self {
        self.total_bytes = Some(total_bytes);
        self
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SerializableDownloadSnapshotPayload<'a> {
    download: &'a DownloadResourcePayload,
    profile: &'a SessionProfileResourcePayload,
    url: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    destination: Option<&'a str>,
    state: DownloadStatePayload,
    received_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    total_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<&'a str>,
}

impl<'a> TryFrom<&'a DownloadSnapshotPayload> for SerializableDownloadSnapshotPayload<'a> {
    type Error = &'static str;

    fn try_from(payload: &'a DownloadSnapshotPayload) -> Result<Self, Self::Error> {
        validate_download_byte_progress(payload.received_bytes, payload.total_bytes)?;
        Ok(Self {
            download: &payload.download,
            profile: &payload.profile,
            url: &payload.url,
            destination: payload.destination.as_deref(),
            state: payload.state,
            received_bytes: payload.received_bytes,
            total_bytes: payload.total_bytes,
            message: payload.message.as_deref(),
        })
    }
}

impl Serialize for DownloadSnapshotPayload {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        SerializableDownloadSnapshotPayload::try_from(self)
            .map_err(ser::Error::custom)?
            .serialize(serializer)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawDownloadSnapshotPayload {
    download: DownloadResourcePayload,
    profile: SessionProfileResourcePayload,
    url: String,
    #[serde(default)]
    destination: Option<String>,
    state: DownloadStatePayload,
    received_bytes: u64,
    #[serde(default)]
    total_bytes: Option<u64>,
    #[serde(default)]
    message: Option<String>,
}

impl TryFrom<RawDownloadSnapshotPayload> for DownloadSnapshotPayload {
    type Error = &'static str;

    fn try_from(raw: RawDownloadSnapshotPayload) -> Result<Self, Self::Error> {
        validate_download_byte_progress(raw.received_bytes, raw.total_bytes)?;
        Ok(Self {
            download: raw.download,
            profile: raw.profile,
            url: raw.url,
            destination: raw.destination,
            state: raw.state,
            received_bytes: raw.received_bytes,
            total_bytes: raw.total_bytes,
            message: raw.message,
        })
    }
}

impl<'de> Deserialize<'de> for DownloadSnapshotPayload {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        RawDownloadSnapshotPayload::deserialize(deserializer)?
            .try_into()
            .map_err(de::Error::custom)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DownloadListResultPayload {
    downloads: Vec<DownloadSnapshotPayload>,
}

impl DownloadListResultPayload {
    pub fn new(downloads: Vec<DownloadSnapshotPayload>) -> Self {
        Self { downloads }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DownloadSupportedPayload {
    supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl DownloadSupportedPayload {
    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            supported: false,
            reason: Some(reason.into()),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct DownloadEventPayload {
    r#type: String,
    timestamp: u64,
    phase: DownloadEventPhasePayload,
    download: DownloadResourcePayload,
    profile: SessionProfileResourcePayload,
    url: String,
    destination: Option<String>,
    received_bytes: u64,
    total_bytes: Option<u64>,
    message: Option<String>,
}

impl DownloadEventPayload {
    pub fn new(
        timestamp: u64,
        phase: DownloadEventPhasePayload,
        download: DownloadResourcePayload,
        profile: SessionProfileResourcePayload,
        url: impl Into<String>,
        received_bytes: u64,
    ) -> Self {
        Self {
            r#type: "download-event".to_string(),
            timestamp,
            phase,
            download,
            profile,
            url: url.into(),
            destination: None,
            received_bytes,
            total_bytes: None,
            message: None,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SerializableDownloadEventPayload<'a> {
    r#type: &'a str,
    timestamp: u64,
    phase: DownloadEventPhasePayload,
    download: &'a DownloadResourcePayload,
    profile: &'a SessionProfileResourcePayload,
    url: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    destination: Option<&'a str>,
    received_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    total_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<&'a str>,
}

impl<'a> TryFrom<&'a DownloadEventPayload> for SerializableDownloadEventPayload<'a> {
    type Error = &'static str;

    fn try_from(payload: &'a DownloadEventPayload) -> Result<Self, Self::Error> {
        validate_download_byte_progress(payload.received_bytes, payload.total_bytes)?;
        Ok(Self {
            r#type: &payload.r#type,
            timestamp: payload.timestamp,
            phase: payload.phase,
            download: &payload.download,
            profile: &payload.profile,
            url: &payload.url,
            destination: payload.destination.as_deref(),
            received_bytes: payload.received_bytes,
            total_bytes: payload.total_bytes,
            message: payload.message.as_deref(),
        })
    }
}

impl Serialize for DownloadEventPayload {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        SerializableDownloadEventPayload::try_from(self)
            .map_err(ser::Error::custom)?
            .serialize(serializer)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawDownloadEventPayload {
    r#type: String,
    timestamp: u64,
    phase: DownloadEventPhasePayload,
    download: DownloadResourcePayload,
    profile: SessionProfileResourcePayload,
    url: String,
    #[serde(default)]
    destination: Option<String>,
    received_bytes: u64,
    #[serde(default)]
    total_bytes: Option<u64>,
    #[serde(default)]
    message: Option<String>,
}

impl TryFrom<RawDownloadEventPayload> for DownloadEventPayload {
    type Error = &'static str;

    fn try_from(raw: RawDownloadEventPayload) -> Result<Self, Self::Error> {
        if raw.r#type != "download-event" {
            return Err("download event type must be download-event");
        }
        validate_download_byte_progress(raw.received_bytes, raw.total_bytes)?;
        Ok(Self {
            r#type: raw.r#type,
            timestamp: raw.timestamp,
            phase: raw.phase,
            download: raw.download,
            profile: raw.profile,
            url: raw.url,
            destination: raw.destination,
            received_bytes: raw.received_bytes,
            total_bytes: raw.total_bytes,
            message: raw.message,
        })
    }
}

impl<'de> Deserialize<'de> for DownloadEventPayload {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        RawDownloadEventPayload::deserialize(deserializer)?
            .try_into()
            .map_err(de::Error::custom)
    }
}

fn validate_download_byte_progress(
    received_bytes: u64,
    total_bytes: Option<u64>,
) -> Result<(), &'static str> {
    match total_bytes {
        Some(total_bytes) if received_bytes > total_bytes => {
            Err("receivedBytes must not exceed totalBytes")
        }
        _ => Ok(()),
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum NetworkAuthProxyModePayload {
    Direct,
    System,
    Fixed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum NetworkAuthDecisionPayload {
    Allow,
    Deny,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum NetworkAuthDecisionKindPayload {
    HttpAuth,
    Certificate,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum NetworkAuthEventPhasePayload {
    ProxyUpdated,
    AuthDecided,
    CertificateDecided,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NetworkAuthSetProxyPayload {
    profile: SessionProfileResourcePayload,
    mode: NetworkAuthProxyModePayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    server: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    bypass: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl NetworkAuthSetProxyPayload {
    pub fn new(profile: SessionProfileResourcePayload, mode: NetworkAuthProxyModePayload) -> Self {
        Self {
            profile,
            mode,
            server: None,
            bypass: Vec::new(),
            trace_id: None,
        }
    }

    pub fn with_server(mut self, server: impl Into<String>) -> Self {
        self.server = Some(server.into());
        self
    }

    pub fn with_bypass(mut self, bypass: Vec<String>) -> Self {
        self.bypass = bypass;
        self
    }

    pub fn profile(&self) -> &SessionProfileResourcePayload {
        &self.profile
    }

    pub fn mode(&self) -> NetworkAuthProxyModePayload {
        self.mode
    }

    pub fn server(&self) -> Option<&str> {
        self.server.as_deref()
    }

    pub fn bypass(&self) -> &[String] {
        &self.bypass
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NetworkAuthProxyResultPayload {
    profile: SessionProfileResourcePayload,
    mode: NetworkAuthProxyModePayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    server: Option<String>,
    bypass: Vec<String>,
}

impl NetworkAuthProxyResultPayload {
    pub fn new(profile: SessionProfileResourcePayload, mode: NetworkAuthProxyModePayload) -> Self {
        Self {
            profile,
            mode,
            server: None,
            bypass: Vec::new(),
        }
    }

    pub fn with_server(mut self, server: impl Into<String>) -> Self {
        self.server = Some(server.into());
        self
    }

    pub fn with_bypass(mut self, bypass: Vec<String>) -> Self {
        self.bypass = bypass;
        self
    }

    pub fn profile(&self) -> &SessionProfileResourcePayload {
        &self.profile
    }

    pub fn mode(&self) -> NetworkAuthProxyModePayload {
        self.mode
    }

    pub fn server(&self) -> Option<&str> {
        self.server.as_deref()
    }

    pub fn bypass(&self) -> &[String] {
        &self.bypass
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NetworkAuthHttpAuthPayload {
    profile: SessionProfileResourcePayload,
    request_id: String,
    origin: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    realm: Option<String>,
    decision: NetworkAuthDecisionPayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    password: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl NetworkAuthHttpAuthPayload {
    pub fn new(
        profile: SessionProfileResourcePayload,
        request_id: impl Into<String>,
        origin: impl Into<String>,
        decision: NetworkAuthDecisionPayload,
    ) -> Self {
        Self {
            profile,
            request_id: request_id.into(),
            origin: origin.into(),
            realm: None,
            decision,
            username: None,
            password: None,
            trace_id: None,
        }
    }

    pub fn with_credentials(
        mut self,
        username: impl Into<String>,
        password: impl Into<String>,
    ) -> Self {
        self.username = Some(username.into());
        self.password = Some(password.into());
        self
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NetworkAuthCertificatePayload {
    profile: SessionProfileResourcePayload,
    request_id: String,
    origin: String,
    fingerprint_sha256: String,
    decision: NetworkAuthDecisionPayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl NetworkAuthCertificatePayload {
    pub fn new(
        profile: SessionProfileResourcePayload,
        request_id: impl Into<String>,
        origin: impl Into<String>,
        fingerprint_sha256: impl Into<String>,
        decision: NetworkAuthDecisionPayload,
    ) -> Self {
        Self {
            profile,
            request_id: request_id.into(),
            origin: origin.into(),
            fingerprint_sha256: fingerprint_sha256.into(),
            decision,
            trace_id: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NetworkAuthDecisionRecordPayload {
    profile: SessionProfileResourcePayload,
    request_id: String,
    origin: String,
    kind: NetworkAuthDecisionKindPayload,
    decision: NetworkAuthDecisionPayload,
    decided_at: u64,
}

impl NetworkAuthDecisionRecordPayload {
    pub fn new(
        profile: SessionProfileResourcePayload,
        request_id: impl Into<String>,
        origin: impl Into<String>,
        kind: NetworkAuthDecisionKindPayload,
        decision: NetworkAuthDecisionPayload,
        decided_at: u64,
    ) -> Self {
        Self {
            profile,
            request_id: request_id.into(),
            origin: origin.into(),
            kind,
            decision,
            decided_at,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NetworkAuthSupportedPayload {
    supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl NetworkAuthSupportedPayload {
    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            supported: false,
            reason: Some(reason.into()),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct NetworkAuthEventPayload {
    r#type: String,
    timestamp: u64,
    phase: NetworkAuthEventPhasePayload,
    profile: SessionProfileResourcePayload,
    request_id: Option<String>,
    origin: Option<String>,
    decision: Option<NetworkAuthDecisionPayload>,
    message: Option<String>,
}

impl NetworkAuthEventPayload {
    pub fn proxy_updated(timestamp: u64, profile: SessionProfileResourcePayload) -> Self {
        Self {
            r#type: "network-auth-event".to_string(),
            timestamp,
            phase: NetworkAuthEventPhasePayload::ProxyUpdated,
            profile,
            request_id: None,
            origin: None,
            decision: None,
            message: None,
        }
    }

    pub fn auth_decided(
        timestamp: u64,
        profile: SessionProfileResourcePayload,
        request_id: impl Into<String>,
        origin: impl Into<String>,
        decision: NetworkAuthDecisionPayload,
    ) -> Self {
        Self {
            r#type: "network-auth-event".to_string(),
            timestamp,
            phase: NetworkAuthEventPhasePayload::AuthDecided,
            profile,
            request_id: Some(request_id.into()),
            origin: Some(origin.into()),
            decision: Some(decision),
            message: None,
        }
    }

    pub fn certificate_decided(
        timestamp: u64,
        profile: SessionProfileResourcePayload,
        request_id: impl Into<String>,
        origin: impl Into<String>,
        decision: NetworkAuthDecisionPayload,
    ) -> Self {
        Self {
            r#type: "network-auth-event".to_string(),
            timestamp,
            phase: NetworkAuthEventPhasePayload::CertificateDecided,
            profile,
            request_id: Some(request_id.into()),
            origin: Some(origin.into()),
            decision: Some(decision),
            message: None,
        }
    }

    pub fn failed(
        timestamp: u64,
        profile: SessionProfileResourcePayload,
        message: impl Into<String>,
    ) -> Self {
        Self {
            r#type: "network-auth-event".to_string(),
            timestamp,
            phase: NetworkAuthEventPhasePayload::Failed,
            profile,
            request_id: None,
            origin: None,
            decision: None,
            message: Some(message.into()),
        }
    }

    #[cfg(test)]
    fn new_for_test(
        timestamp: u64,
        phase: NetworkAuthEventPhasePayload,
        profile: SessionProfileResourcePayload,
    ) -> Self {
        Self {
            r#type: "network-auth-event".to_string(),
            timestamp,
            phase,
            profile,
            request_id: None,
            origin: None,
            decision: None,
            message: None,
        }
    }

    #[cfg(test)]
    fn with_decision_for_test(
        mut self,
        request_id: impl Into<String>,
        origin: impl Into<String>,
        decision: NetworkAuthDecisionPayload,
    ) -> Self {
        self.request_id = Some(request_id.into());
        self.origin = Some(origin.into());
        self.decision = Some(decision);
        self
    }

    #[cfg(test)]
    fn with_message_for_test(mut self, message: impl Into<String>) -> Self {
        self.message = Some(message.into());
        self
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SerializableNetworkAuthEventPayload<'a> {
    r#type: &'a str,
    timestamp: u64,
    phase: NetworkAuthEventPhasePayload,
    profile: &'a SessionProfileResourcePayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    request_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    origin: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    decision: Option<NetworkAuthDecisionPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<&'a str>,
}

impl<'a> TryFrom<&'a NetworkAuthEventPayload> for SerializableNetworkAuthEventPayload<'a> {
    type Error = &'static str;

    fn try_from(payload: &'a NetworkAuthEventPayload) -> Result<Self, Self::Error> {
        validate_network_auth_event_payload(
            payload.phase,
            &payload.request_id,
            &payload.origin,
            &payload.decision,
            &payload.message,
        )?;
        Ok(Self {
            r#type: &payload.r#type,
            timestamp: payload.timestamp,
            phase: payload.phase,
            profile: &payload.profile,
            request_id: payload.request_id.as_deref(),
            origin: payload.origin.as_deref(),
            decision: payload.decision,
            message: payload.message.as_deref(),
        })
    }
}

impl Serialize for NetworkAuthEventPayload {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        SerializableNetworkAuthEventPayload::try_from(self)
            .map_err(ser::Error::custom)?
            .serialize(serializer)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawNetworkAuthEventPayload {
    r#type: String,
    timestamp: u64,
    phase: NetworkAuthEventPhasePayload,
    profile: SessionProfileResourcePayload,
    #[serde(default)]
    request_id: Option<String>,
    #[serde(default)]
    origin: Option<String>,
    #[serde(default)]
    decision: Option<NetworkAuthDecisionPayload>,
    #[serde(default)]
    message: Option<String>,
}

impl TryFrom<RawNetworkAuthEventPayload> for NetworkAuthEventPayload {
    type Error = &'static str;

    fn try_from(raw: RawNetworkAuthEventPayload) -> Result<Self, Self::Error> {
        if raw.r#type != "network-auth-event" {
            return Err("network auth event type must be network-auth-event");
        }
        validate_network_auth_event_payload(
            raw.phase,
            &raw.request_id,
            &raw.origin,
            &raw.decision,
            &raw.message,
        )?;
        Ok(Self {
            r#type: raw.r#type,
            timestamp: raw.timestamp,
            phase: raw.phase,
            profile: raw.profile,
            request_id: raw.request_id,
            origin: raw.origin,
            decision: raw.decision,
            message: raw.message,
        })
    }
}

impl<'de> Deserialize<'de> for NetworkAuthEventPayload {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        RawNetworkAuthEventPayload::deserialize(deserializer)?
            .try_into()
            .map_err(de::Error::custom)
    }
}

fn validate_network_auth_event_payload(
    phase: NetworkAuthEventPhasePayload,
    request_id: &Option<String>,
    origin: &Option<String>,
    decision: &Option<NetworkAuthDecisionPayload>,
    message: &Option<String>,
) -> Result<(), &'static str> {
    match phase {
        NetworkAuthEventPhasePayload::ProxyUpdated
            if request_id.is_none()
                && origin.is_none()
                && decision.is_none()
                && message.is_none() =>
        {
            Ok(())
        }
        NetworkAuthEventPhasePayload::ProxyUpdated => {
            Err("proxy-updated network auth events must not include decision or message fields")
        }
        NetworkAuthEventPhasePayload::AuthDecided
        | NetworkAuthEventPhasePayload::CertificateDecided
            if request_id.is_some()
                && origin.is_some()
                && decision.is_some()
                && message.is_none() =>
        {
            Ok(())
        }
        NetworkAuthEventPhasePayload::AuthDecided
        | NetworkAuthEventPhasePayload::CertificateDecided => {
            Err("network auth decision events require requestId, origin, and decision only")
        }
        NetworkAuthEventPhasePayload::Failed
            if request_id.is_none()
                && origin.is_none()
                && decision.is_none()
                && message.is_some() =>
        {
            Ok(())
        }
        NetworkAuthEventPhasePayload::Failed => {
            Err("failed network auth events require message only")
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WebRequestInterceptorResourcePayload {
    kind: String,
    id: String,
    generation: u64,
    owner_scope: String,
    state: String,
}

impl WebRequestInterceptorResourcePayload {
    pub fn new(id: impl Into<String>, generation: u64, owner_scope: impl Into<String>) -> Self {
        Self {
            kind: "web-request-interceptor".to_string(),
            id: id.into(),
            generation,
            owner_scope: owner_scope.into(),
            state: "open".to_string(),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum WebRequestPhasePayload {
    BeforeRequest,
    HeadersReceived,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum WebRequestActionPayload {
    Allow,
    Block,
    Redirect,
    ModifyHeaders,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum WebRequestEventPhasePayload {
    Registered,
    Removed,
    Matched,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WebRequestHeaderPayload {
    name: String,
    value: String,
}

impl WebRequestHeaderPayload {
    pub fn new(name: impl Into<String>, value: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            value: value.into(),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct WebRequestBeforeRequestPayload {
    profile: SessionProfileResourcePayload,
    url_pattern: String,
    action: WebRequestActionPayload,
    redirect_url: Option<String>,
    owner_scope: Option<String>,
    trace_id: Option<String>,
}

impl WebRequestBeforeRequestPayload {
    pub fn new(
        profile: SessionProfileResourcePayload,
        url_pattern: impl Into<String>,
        action: WebRequestActionPayload,
    ) -> Self {
        Self {
            profile,
            url_pattern: url_pattern.into(),
            action,
            redirect_url: None,
            owner_scope: None,
            trace_id: None,
        }
    }

    pub fn with_redirect_url(mut self, redirect_url: impl Into<String>) -> Self {
        self.redirect_url = Some(redirect_url.into());
        self
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SerializableWebRequestBeforeRequestPayload<'a> {
    profile: &'a SessionProfileResourcePayload,
    url_pattern: &'a str,
    action: WebRequestActionPayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    redirect_url: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    owner_scope: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<&'a str>,
}

impl<'a> TryFrom<&'a WebRequestBeforeRequestPayload>
    for SerializableWebRequestBeforeRequestPayload<'a>
{
    type Error = &'static str;

    fn try_from(payload: &'a WebRequestBeforeRequestPayload) -> Result<Self, Self::Error> {
        validate_web_request_before_request_shape(payload.action, payload.redirect_url.as_deref())?;
        Ok(Self {
            profile: &payload.profile,
            url_pattern: &payload.url_pattern,
            action: payload.action,
            redirect_url: payload.redirect_url.as_deref(),
            owner_scope: payload.owner_scope.as_deref(),
            trace_id: payload.trace_id.as_deref(),
        })
    }
}

impl Serialize for WebRequestBeforeRequestPayload {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        SerializableWebRequestBeforeRequestPayload::try_from(self)
            .map_err(ser::Error::custom)?
            .serialize(serializer)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawWebRequestBeforeRequestPayload {
    profile: SessionProfileResourcePayload,
    url_pattern: String,
    action: WebRequestActionPayload,
    redirect_url: Option<String>,
    owner_scope: Option<String>,
    trace_id: Option<String>,
}

impl TryFrom<RawWebRequestBeforeRequestPayload> for WebRequestBeforeRequestPayload {
    type Error = &'static str;

    fn try_from(raw: RawWebRequestBeforeRequestPayload) -> Result<Self, Self::Error> {
        validate_web_request_before_request_shape(raw.action, raw.redirect_url.as_deref())?;
        Ok(Self {
            profile: raw.profile,
            url_pattern: raw.url_pattern,
            action: raw.action,
            redirect_url: raw.redirect_url,
            owner_scope: raw.owner_scope,
            trace_id: raw.trace_id,
        })
    }
}

impl<'de> Deserialize<'de> for WebRequestBeforeRequestPayload {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        RawWebRequestBeforeRequestPayload::deserialize(deserializer)?
            .try_into()
            .map_err(de::Error::custom)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WebRequestHeadersReceivedPayload {
    profile: SessionProfileResourcePayload,
    url_pattern: String,
    response_headers: Vec<WebRequestHeaderPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    owner_scope: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl WebRequestHeadersReceivedPayload {
    pub fn new(
        profile: SessionProfileResourcePayload,
        url_pattern: impl Into<String>,
        response_headers: Vec<WebRequestHeaderPayload>,
    ) -> Self {
        Self {
            profile,
            url_pattern: url_pattern.into(),
            response_headers,
            owner_scope: None,
            trace_id: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WebRequestRemoveListenerPayload {
    interceptor: WebRequestInterceptorResourcePayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl WebRequestRemoveListenerPayload {
    pub fn new(interceptor: WebRequestInterceptorResourcePayload) -> Self {
        Self {
            interceptor,
            trace_id: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct WebRequestInterceptorSnapshotPayload {
    interceptor: WebRequestInterceptorResourcePayload,
    profile: SessionProfileResourcePayload,
    phase: WebRequestPhasePayload,
    url_pattern: String,
    action: WebRequestActionPayload,
    order: u64,
    redirect_url: Option<String>,
    response_headers: Option<Vec<WebRequestHeaderPayload>>,
}

impl WebRequestInterceptorSnapshotPayload {
    pub fn new(
        interceptor: WebRequestInterceptorResourcePayload,
        profile: SessionProfileResourcePayload,
        phase: WebRequestPhasePayload,
        url_pattern: impl Into<String>,
        action: WebRequestActionPayload,
        order: u64,
    ) -> Self {
        Self {
            interceptor,
            profile,
            phase,
            url_pattern: url_pattern.into(),
            action,
            order,
            redirect_url: None,
            response_headers: None,
        }
    }

    pub fn with_redirect_url(mut self, redirect_url: impl Into<String>) -> Self {
        self.redirect_url = Some(redirect_url.into());
        self
    }

    pub fn with_response_headers(mut self, headers: Vec<WebRequestHeaderPayload>) -> Self {
        self.response_headers = Some(headers);
        self
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SerializableWebRequestInterceptorSnapshotPayload<'a> {
    interceptor: &'a WebRequestInterceptorResourcePayload,
    profile: &'a SessionProfileResourcePayload,
    phase: WebRequestPhasePayload,
    url_pattern: &'a str,
    action: WebRequestActionPayload,
    order: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    redirect_url: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_headers: Option<&'a [WebRequestHeaderPayload]>,
}

impl<'a> TryFrom<&'a WebRequestInterceptorSnapshotPayload>
    for SerializableWebRequestInterceptorSnapshotPayload<'a>
{
    type Error = &'static str;

    fn try_from(payload: &'a WebRequestInterceptorSnapshotPayload) -> Result<Self, Self::Error> {
        validate_web_request_snapshot_shape(
            payload.phase,
            payload.action,
            payload.redirect_url.as_deref(),
            payload.response_headers.as_deref(),
        )?;
        Ok(Self {
            interceptor: &payload.interceptor,
            profile: &payload.profile,
            phase: payload.phase,
            url_pattern: &payload.url_pattern,
            action: payload.action,
            order: payload.order,
            redirect_url: payload.redirect_url.as_deref(),
            response_headers: payload.response_headers.as_deref(),
        })
    }
}

impl Serialize for WebRequestInterceptorSnapshotPayload {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        SerializableWebRequestInterceptorSnapshotPayload::try_from(self)
            .map_err(ser::Error::custom)?
            .serialize(serializer)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawWebRequestInterceptorSnapshotPayload {
    interceptor: WebRequestInterceptorResourcePayload,
    profile: SessionProfileResourcePayload,
    phase: WebRequestPhasePayload,
    url_pattern: String,
    action: WebRequestActionPayload,
    order: u64,
    redirect_url: Option<String>,
    response_headers: Option<Vec<WebRequestHeaderPayload>>,
}

impl TryFrom<RawWebRequestInterceptorSnapshotPayload> for WebRequestInterceptorSnapshotPayload {
    type Error = &'static str;

    fn try_from(raw: RawWebRequestInterceptorSnapshotPayload) -> Result<Self, Self::Error> {
        validate_web_request_snapshot_shape(
            raw.phase,
            raw.action,
            raw.redirect_url.as_deref(),
            raw.response_headers.as_deref(),
        )?;
        Ok(Self {
            interceptor: raw.interceptor,
            profile: raw.profile,
            phase: raw.phase,
            url_pattern: raw.url_pattern,
            action: raw.action,
            order: raw.order,
            redirect_url: raw.redirect_url,
            response_headers: raw.response_headers,
        })
    }
}

impl<'de> Deserialize<'de> for WebRequestInterceptorSnapshotPayload {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        RawWebRequestInterceptorSnapshotPayload::deserialize(deserializer)?
            .try_into()
            .map_err(de::Error::custom)
    }
}

fn validate_web_request_before_request_shape(
    action: WebRequestActionPayload,
    redirect_url: Option<&str>,
) -> Result<(), &'static str> {
    match action {
        WebRequestActionPayload::Redirect if redirect_url.is_none() => {
            Err("web request redirect action requires redirectUrl")
        }
        WebRequestActionPayload::Redirect => Ok(()),
        WebRequestActionPayload::Allow | WebRequestActionPayload::Block
            if redirect_url.is_some() =>
        {
            Err("web request redirectUrl requires redirect action")
        }
        WebRequestActionPayload::Allow | WebRequestActionPayload::Block => Ok(()),
        WebRequestActionPayload::ModifyHeaders => {
            Err("web request before-request payload must not use modify-headers action")
        }
    }
}

fn validate_web_request_snapshot_shape(
    phase: WebRequestPhasePayload,
    action: WebRequestActionPayload,
    redirect_url: Option<&str>,
    response_headers: Option<&[WebRequestHeaderPayload]>,
) -> Result<(), &'static str> {
    match phase {
        WebRequestPhasePayload::BeforeRequest => {
            if action == WebRequestActionPayload::ModifyHeaders {
                return Err(
                    "web request before-request snapshot must not use modify-headers action",
                );
            }
            if response_headers.is_some() {
                return Err("web request before-request snapshot must not carry responseHeaders");
            }
            validate_web_request_before_request_shape(action, redirect_url)
        }
        WebRequestPhasePayload::HeadersReceived => {
            if action != WebRequestActionPayload::ModifyHeaders {
                return Err("web request headers-received snapshot requires modify-headers action");
            }
            if redirect_url.is_some() {
                return Err("web request headers-received snapshot must not carry redirectUrl");
            }
            if response_headers.is_none() {
                return Err("web request headers-received snapshot requires responseHeaders");
            }
            Ok(())
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WebRequestSupportedPayload {
    supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl WebRequestSupportedPayload {
    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            supported: false,
            reason: Some(reason.into()),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct WebRequestEventPayload {
    r#type: String,
    timestamp: u64,
    phase: WebRequestEventPhasePayload,
    interceptor: WebRequestInterceptorResourcePayload,
    profile: SessionProfileResourcePayload,
    request_phase: WebRequestPhasePayload,
    url_pattern: String,
    action: WebRequestActionPayload,
    order: u64,
    message: Option<String>,
}

impl WebRequestEventPayload {
    pub fn new(
        timestamp: u64,
        phase: WebRequestEventPhasePayload,
        snapshot: WebRequestInterceptorSnapshotPayload,
    ) -> Self {
        Self {
            r#type: "web-request-event".to_string(),
            timestamp,
            phase,
            interceptor: snapshot.interceptor,
            profile: snapshot.profile,
            request_phase: snapshot.phase,
            url_pattern: snapshot.url_pattern,
            action: snapshot.action,
            order: snapshot.order,
            message: None,
        }
    }

    pub fn failed(
        timestamp: u64,
        snapshot: WebRequestInterceptorSnapshotPayload,
        message: impl Into<String>,
    ) -> Self {
        let mut event = Self::new(timestamp, WebRequestEventPhasePayload::Failed, snapshot);
        event.message = Some(message.into());
        event
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SerializableWebRequestEventPayload<'a> {
    r#type: &'a str,
    timestamp: u64,
    phase: WebRequestEventPhasePayload,
    interceptor: &'a WebRequestInterceptorResourcePayload,
    profile: &'a SessionProfileResourcePayload,
    request_phase: WebRequestPhasePayload,
    url_pattern: &'a str,
    action: WebRequestActionPayload,
    order: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<&'a str>,
}

impl<'a> TryFrom<&'a WebRequestEventPayload> for SerializableWebRequestEventPayload<'a> {
    type Error = &'static str;

    fn try_from(payload: &'a WebRequestEventPayload) -> Result<Self, Self::Error> {
        validate_web_request_event_payload(payload.phase, payload.message.as_deref())?;
        Ok(Self {
            r#type: &payload.r#type,
            timestamp: payload.timestamp,
            phase: payload.phase,
            interceptor: &payload.interceptor,
            profile: &payload.profile,
            request_phase: payload.request_phase,
            url_pattern: &payload.url_pattern,
            action: payload.action,
            order: payload.order,
            message: payload.message.as_deref(),
        })
    }
}

impl Serialize for WebRequestEventPayload {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        SerializableWebRequestEventPayload::try_from(self)
            .map_err(ser::Error::custom)?
            .serialize(serializer)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawWebRequestEventPayload {
    r#type: String,
    timestamp: u64,
    phase: WebRequestEventPhasePayload,
    interceptor: WebRequestInterceptorResourcePayload,
    profile: SessionProfileResourcePayload,
    request_phase: WebRequestPhasePayload,
    url_pattern: String,
    action: WebRequestActionPayload,
    order: u64,
    #[serde(default)]
    message: Option<String>,
}

impl TryFrom<RawWebRequestEventPayload> for WebRequestEventPayload {
    type Error = &'static str;

    fn try_from(raw: RawWebRequestEventPayload) -> Result<Self, Self::Error> {
        validate_web_request_event_payload(raw.phase, raw.message.as_deref())?;
        Ok(Self {
            r#type: raw.r#type,
            timestamp: raw.timestamp,
            phase: raw.phase,
            interceptor: raw.interceptor,
            profile: raw.profile,
            request_phase: raw.request_phase,
            url_pattern: raw.url_pattern,
            action: raw.action,
            order: raw.order,
            message: raw.message,
        })
    }
}

impl<'de> Deserialize<'de> for WebRequestEventPayload {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        RawWebRequestEventPayload::deserialize(deserializer)?
            .try_into()
            .map_err(de::Error::custom)
    }
}

fn validate_web_request_event_payload(
    phase: WebRequestEventPhasePayload,
    message: Option<&str>,
) -> Result<(), &'static str> {
    match phase {
        WebRequestEventPhasePayload::Registered
        | WebRequestEventPhasePayload::Removed
        | WebRequestEventPhasePayload::Matched
            if message.is_none() =>
        {
            Ok(())
        }
        WebRequestEventPhasePayload::Registered
        | WebRequestEventPhasePayload::Removed
        | WebRequestEventPhasePayload::Matched => {
            Err("successful web request events must not carry message")
        }
        WebRequestEventPhasePayload::Failed if message.is_some() => Ok(()),
        WebRequestEventPhasePayload::Failed => Err("failed web request events require message"),
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeNetworkRequestResourcePayload {
    kind: String,
    id: String,
    generation: u64,
    owner_scope: String,
    state: String,
}

impl NativeNetworkRequestResourcePayload {
    pub fn new(id: impl Into<String>, generation: u64, owner_scope: impl Into<String>) -> Self {
        Self {
            kind: "native-network-request".to_string(),
            id: id.into(),
            generation,
            owner_scope: owner_scope.into(),
            state: "open".to_string(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeNetworkWebSocketResourcePayload {
    kind: String,
    id: String,
    generation: u64,
    owner_scope: String,
    state: String,
}

impl NativeNetworkWebSocketResourcePayload {
    pub fn new(id: impl Into<String>, generation: u64, owner_scope: impl Into<String>) -> Self {
        Self {
            kind: "native-network-websocket".to_string(),
            id: id.into(),
            generation,
            owner_scope: owner_scope.into(),
            state: "open".to_string(),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE", rename_all_fields = "camelCase")]
pub enum NativeNetworkHttpMethodPayload {
    Get,
    Post,
    Put,
    Patch,
    Delete,
    Head,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum NativeNetworkWebSocketStatePayload {
    Open,
    Closing,
    Closed,
    Failed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum NativeNetworkEventPhasePayload {
    FetchStarted,
    FetchCompleted,
    UploadStarted,
    UploadProgress,
    UploadCompleted,
    WebsocketOpened,
    WebsocketClosed,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeNetworkHeaderPayload {
    name: String,
    value: String,
}

impl NativeNetworkHeaderPayload {
    pub fn new(name: impl Into<String>, value: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            value: value.into(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeNetworkFetchPayload {
    url: String,
    method: NativeNetworkHttpMethodPayload,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    headers: Vec<NativeNetworkHeaderPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    owner_scope: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl NativeNetworkFetchPayload {
    pub fn new(url: impl Into<String>, method: NativeNetworkHttpMethodPayload) -> Self {
        Self {
            url: url.into(),
            method,
            headers: Vec::new(),
            body: None,
            owner_scope: None,
            trace_id: None,
        }
    }

    pub fn with_body(mut self, body: impl Into<String>) -> Self {
        self.body = Some(body.into());
        self
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeNetworkUploadPayload {
    url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    method: Option<NativeNetworkHttpMethodPayload>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    headers: Vec<NativeNetworkHeaderPayload>,
    body: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    file_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    owner_scope: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl NativeNetworkUploadPayload {
    pub fn new(url: impl Into<String>, body: impl Into<String>) -> Self {
        Self {
            url: url.into(),
            method: None,
            headers: Vec::new(),
            body: body.into(),
            file_name: None,
            owner_scope: None,
            trace_id: None,
        }
    }

    pub fn with_file_name(mut self, file_name: impl Into<String>) -> Self {
        self.file_name = Some(file_name.into());
        self
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeNetworkWebSocketConnectPayload {
    url: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    protocols: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    owner_scope: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl NativeNetworkWebSocketConnectPayload {
    pub fn new(url: impl Into<String>) -> Self {
        Self {
            url: url.into(),
            protocols: Vec::new(),
            owner_scope: None,
            trace_id: None,
        }
    }

    pub fn with_protocol(mut self, protocol: impl Into<String>) -> Self {
        self.protocols.push(protocol.into());
        self
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeNetworkWebSocketHandlePayload {
    socket: NativeNetworkWebSocketResourcePayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl NativeNetworkWebSocketHandlePayload {
    pub fn new(socket: NativeNetworkWebSocketResourcePayload) -> Self {
        Self {
            socket,
            trace_id: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeNetworkLocalhostUrlPayload {
    port: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    secure: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl NativeNetworkLocalhostUrlPayload {
    pub fn new(port: u16) -> Self {
        Self {
            port,
            path: None,
            secure: None,
            trace_id: None,
        }
    }

    pub fn with_path(mut self, path: impl Into<String>) -> Self {
        self.path = Some(path.into());
        self
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeNetworkFetchResultPayload {
    request: NativeNetworkRequestResourcePayload,
    url: String,
    method: NativeNetworkHttpMethodPayload,
    status: u16,
    response_headers: Vec<NativeNetworkHeaderPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    body: Option<String>,
}

impl NativeNetworkFetchResultPayload {
    pub fn new(
        request: NativeNetworkRequestResourcePayload,
        url: impl Into<String>,
        method: NativeNetworkHttpMethodPayload,
        status: u16,
    ) -> Self {
        Self {
            request,
            url: url.into(),
            method,
            status,
            response_headers: Vec::new(),
            body: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeNetworkUploadResultPayload {
    request: NativeNetworkRequestResourcePayload,
    url: String,
    status: u16,
    sent_bytes: u64,
    response_headers: Vec<NativeNetworkHeaderPayload>,
}

impl NativeNetworkUploadResultPayload {
    pub fn new(
        request: NativeNetworkRequestResourcePayload,
        url: impl Into<String>,
        status: u16,
        sent_bytes: u64,
    ) -> Self {
        Self {
            request,
            url: url.into(),
            status,
            sent_bytes,
            response_headers: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeNetworkWebSocketSnapshotPayload {
    socket: NativeNetworkWebSocketResourcePayload,
    url: String,
    state: NativeNetworkWebSocketStatePayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    protocol: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

impl NativeNetworkWebSocketSnapshotPayload {
    pub fn new(
        socket: NativeNetworkWebSocketResourcePayload,
        url: impl Into<String>,
        state: NativeNetworkWebSocketStatePayload,
    ) -> Self {
        Self {
            socket,
            url: url.into(),
            state,
            protocol: None,
            message: None,
        }
    }

    pub fn with_protocol(mut self, protocol: impl Into<String>) -> Self {
        self.protocol = Some(protocol.into());
        self
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeNetworkLocalhostUrlResultPayload {
    url: String,
}

impl NativeNetworkLocalhostUrlResultPayload {
    pub fn new(url: impl Into<String>) -> Self {
        Self { url: url.into() }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NativeNetworkSupportedPayload {
    supported: bool,
    reason: Option<String>,
}

impl NativeNetworkSupportedPayload {
    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            supported: false,
            reason: Some(reason.into()),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SerializableNativeNetworkSupportedPayload<'a> {
    supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'a str>,
}

impl<'a> TryFrom<&'a NativeNetworkSupportedPayload>
    for SerializableNativeNetworkSupportedPayload<'a>
{
    type Error = &'static str;

    fn try_from(payload: &'a NativeNetworkSupportedPayload) -> Result<Self, Self::Error> {
        validate_native_network_support(payload.supported, payload.reason.as_deref())?;
        Ok(Self {
            supported: payload.supported,
            reason: payload.reason.as_deref(),
        })
    }
}

impl Serialize for NativeNetworkSupportedPayload {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        SerializableNativeNetworkSupportedPayload::try_from(self)
            .map_err(ser::Error::custom)?
            .serialize(serializer)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawNativeNetworkSupportedPayload {
    supported: bool,
    #[serde(default)]
    reason: Option<String>,
}

impl TryFrom<RawNativeNetworkSupportedPayload> for NativeNetworkSupportedPayload {
    type Error = &'static str;

    fn try_from(raw: RawNativeNetworkSupportedPayload) -> Result<Self, Self::Error> {
        validate_native_network_support(raw.supported, raw.reason.as_deref())?;
        Ok(Self {
            supported: raw.supported,
            reason: raw.reason,
        })
    }
}

impl<'de> Deserialize<'de> for NativeNetworkSupportedPayload {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        RawNativeNetworkSupportedPayload::deserialize(deserializer)?
            .try_into()
            .map_err(de::Error::custom)
    }
}

fn validate_native_network_support(
    supported: bool,
    reason: Option<&str>,
) -> Result<(), &'static str> {
    if supported && reason.is_some() {
        return Err("supported native network result must not include reason");
    }

    if !supported && reason.is_none() {
        return Err("unsupported native network result requires reason");
    }

    Ok(())
}

#[derive(Clone, Debug, PartialEq)]
pub struct NativeNetworkEventPayload {
    r#type: String,
    timestamp: u64,
    phase: NativeNetworkEventPhasePayload,
    request: Option<NativeNetworkRequestResourcePayload>,
    socket: Option<NativeNetworkWebSocketResourcePayload>,
    url: Option<String>,
    sent_bytes: Option<u64>,
    total_bytes: Option<u64>,
    message: Option<String>,
}

impl NativeNetworkEventPayload {
    pub fn new(timestamp: u64, phase: NativeNetworkEventPhasePayload) -> Self {
        Self {
            r#type: "native-network-event".to_string(),
            timestamp,
            phase,
            request: None,
            socket: None,
            url: None,
            sent_bytes: None,
            total_bytes: None,
            message: None,
        }
    }

    pub fn with_request(
        mut self,
        request: NativeNetworkRequestResourcePayload,
        url: impl Into<String>,
    ) -> Self {
        self.request = Some(request);
        self.url = Some(url.into());
        self
    }

    pub fn with_socket(
        mut self,
        socket: NativeNetworkWebSocketResourcePayload,
        url: impl Into<String>,
    ) -> Self {
        self.socket = Some(socket);
        self.url = Some(url.into());
        self
    }

    #[cfg(test)]
    fn with_byte_progress(mut self, sent_bytes: u64, total_bytes: u64) -> Self {
        self.sent_bytes = Some(sent_bytes);
        self.total_bytes = Some(total_bytes);
        self
    }

    #[cfg(test)]
    fn with_message(mut self, message: impl Into<String>) -> Self {
        self.message = Some(message.into());
        self
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SerializableNativeNetworkEventPayload<'a> {
    r#type: &'a str,
    timestamp: u64,
    phase: NativeNetworkEventPhasePayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    request: Option<&'a NativeNetworkRequestResourcePayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    socket: Option<&'a NativeNetworkWebSocketResourcePayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sent_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    total_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<&'a str>,
}

impl<'a> TryFrom<&'a NativeNetworkEventPayload> for SerializableNativeNetworkEventPayload<'a> {
    type Error = &'static str;

    fn try_from(payload: &'a NativeNetworkEventPayload) -> Result<Self, Self::Error> {
        validate_native_network_event_payload(
            payload.phase,
            &payload.request,
            &payload.socket,
            &payload.url,
            payload.sent_bytes,
            payload.total_bytes,
            &payload.message,
        )?;
        Ok(Self {
            r#type: &payload.r#type,
            timestamp: payload.timestamp,
            phase: payload.phase,
            request: payload.request.as_ref(),
            socket: payload.socket.as_ref(),
            url: payload.url.as_deref(),
            sent_bytes: payload.sent_bytes,
            total_bytes: payload.total_bytes,
            message: payload.message.as_deref(),
        })
    }
}

impl Serialize for NativeNetworkEventPayload {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        SerializableNativeNetworkEventPayload::try_from(self)
            .map_err(ser::Error::custom)?
            .serialize(serializer)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawNativeNetworkEventPayload {
    r#type: String,
    timestamp: u64,
    phase: NativeNetworkEventPhasePayload,
    request: Option<NativeNetworkRequestResourcePayload>,
    socket: Option<NativeNetworkWebSocketResourcePayload>,
    url: Option<String>,
    sent_bytes: Option<u64>,
    total_bytes: Option<u64>,
    message: Option<String>,
}

impl TryFrom<RawNativeNetworkEventPayload> for NativeNetworkEventPayload {
    type Error = &'static str;

    fn try_from(raw: RawNativeNetworkEventPayload) -> Result<Self, Self::Error> {
        validate_native_network_event_payload(
            raw.phase,
            &raw.request,
            &raw.socket,
            &raw.url,
            raw.sent_bytes,
            raw.total_bytes,
            &raw.message,
        )?;
        Ok(Self {
            r#type: raw.r#type,
            timestamp: raw.timestamp,
            phase: raw.phase,
            request: raw.request,
            socket: raw.socket,
            url: raw.url,
            sent_bytes: raw.sent_bytes,
            total_bytes: raw.total_bytes,
            message: raw.message,
        })
    }
}

impl<'de> Deserialize<'de> for NativeNetworkEventPayload {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        RawNativeNetworkEventPayload::deserialize(deserializer)?
            .try_into()
            .map_err(de::Error::custom)
    }
}

fn validate_native_network_event_payload(
    phase: NativeNetworkEventPhasePayload,
    request: &Option<NativeNetworkRequestResourcePayload>,
    socket: &Option<NativeNetworkWebSocketResourcePayload>,
    url: &Option<String>,
    sent_bytes: Option<u64>,
    total_bytes: Option<u64>,
    message: &Option<String>,
) -> Result<(), &'static str> {
    if let (Some(sent), Some(total)) = (sent_bytes, total_bytes) {
        if sent > total {
            return Err("sentBytes must not exceed totalBytes");
        }
    }

    let has_request = request.is_some();
    let has_socket = socket.is_some();
    let has_byte_progress = sent_bytes.is_some() || total_bytes.is_some();
    let has_http_url = url
        .as_ref()
        .is_some_and(|value| is_native_network_http_url(value));
    let has_websocket_url = url
        .as_ref()
        .is_some_and(|value| is_native_network_websocket_url(value));
    let has_only_request_resource = has_request && !has_socket && has_http_url;
    let has_only_socket_resource = has_socket && !has_request && has_websocket_url;

    match phase {
        NativeNetworkEventPhasePayload::FetchStarted
        | NativeNetworkEventPhasePayload::FetchCompleted => {
            if has_only_request_resource && !has_byte_progress && message.is_none() {
                Ok(())
            } else {
                Err("fetch native network events require request HTTP metadata only")
            }
        }
        NativeNetworkEventPhasePayload::UploadStarted => {
            if has_only_request_resource && !has_byte_progress && message.is_none() {
                Ok(())
            } else {
                Err("upload-started native network events require request HTTP metadata only")
            }
        }
        NativeNetworkEventPhasePayload::UploadProgress => {
            if has_only_request_resource && sent_bytes.is_some() && message.is_none() {
                Ok(())
            } else {
                Err("upload-progress native network events require request HTTP byte progress")
            }
        }
        NativeNetworkEventPhasePayload::UploadCompleted => {
            if has_only_request_resource && !has_byte_progress && message.is_none() {
                Ok(())
            } else {
                Err("upload-completed native network events require request HTTP metadata")
            }
        }
        NativeNetworkEventPhasePayload::WebsocketOpened
        | NativeNetworkEventPhasePayload::WebsocketClosed => {
            if has_only_socket_resource && !has_byte_progress && message.is_none() {
                Ok(())
            } else {
                Err("websocket native network events require websocket metadata only")
            }
        }
        NativeNetworkEventPhasePayload::Failed => {
            if (has_only_request_resource || has_only_socket_resource)
                && !has_byte_progress
                && message.is_some()
            {
                Ok(())
            } else {
                Err("failed native network events require one request or socket resource and message")
            }
        }
    }
}

fn is_native_network_http_url(value: &str) -> bool {
    value.starts_with("http://") || value.starts_with("https://")
}

fn is_native_network_websocket_url(value: &str) -> bool {
    value.starts_with("ws://") || value.starts_with("wss://")
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkspaceIndexEventPayload {
    r#type: String,
    timestamp: u64,
    index_id: String,
    root: Option<String>,
    path: Option<String>,
    phase: WorkspaceIndexEventPhase,
    state: Option<WorkspaceIndexState>,
    indexed: Option<u64>,
    invalidated: Option<u64>,
    ignored: Option<u64>,
}

impl WorkspaceIndexEventPayload {
    pub fn new(
        timestamp: u64,
        index_id: impl Into<String>,
        phase: WorkspaceIndexEventPhase,
    ) -> Self {
        Self {
            r#type: "workspace-index-event".to_string(),
            timestamp,
            index_id: index_id.into(),
            root: None,
            path: None,
            phase,
            state: None,
            indexed: None,
            invalidated: None,
            ignored: None,
        }
    }

    pub fn with_root(mut self, root: impl Into<String>, state: WorkspaceIndexState) -> Self {
        self.root = Some(root.into());
        self.state = Some(state);
        self
    }

    pub fn with_path(mut self, path: impl Into<String>) -> Self {
        self.path = Some(path.into());
        self
    }

    pub fn with_counts(mut self, indexed: u64, invalidated: u64, ignored: u64) -> Self {
        self.indexed = Some(indexed);
        self.invalidated = Some(invalidated);
        self.ignored = Some(ignored);
        self
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SerializableWorkspaceIndexEventPayload<'a> {
    r#type: &'a str,
    timestamp: u64,
    index_id: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    root: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<&'a str>,
    phase: WorkspaceIndexEventPhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    state: Option<WorkspaceIndexState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    indexed: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    invalidated: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ignored: Option<u64>,
}

impl<'a> TryFrom<&'a WorkspaceIndexEventPayload> for SerializableWorkspaceIndexEventPayload<'a> {
    type Error = &'static str;

    fn try_from(payload: &'a WorkspaceIndexEventPayload) -> Result<Self, Self::Error> {
        validate_workspace_index_event_payload(payload.phase, payload.state)?;
        Ok(Self {
            r#type: &payload.r#type,
            timestamp: payload.timestamp,
            index_id: &payload.index_id,
            root: payload.root.as_deref(),
            path: payload.path.as_deref(),
            phase: payload.phase,
            state: payload.state,
            indexed: payload.indexed,
            invalidated: payload.invalidated,
            ignored: payload.ignored,
        })
    }
}

impl Serialize for WorkspaceIndexEventPayload {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        SerializableWorkspaceIndexEventPayload::try_from(self)
            .map_err(ser::Error::custom)?
            .serialize(serializer)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawWorkspaceIndexEventPayload {
    r#type: String,
    timestamp: u64,
    index_id: String,
    root: Option<String>,
    path: Option<String>,
    phase: WorkspaceIndexEventPhase,
    state: Option<WorkspaceIndexState>,
    indexed: Option<u64>,
    invalidated: Option<u64>,
    ignored: Option<u64>,
}

impl TryFrom<RawWorkspaceIndexEventPayload> for WorkspaceIndexEventPayload {
    type Error = &'static str;

    fn try_from(raw: RawWorkspaceIndexEventPayload) -> Result<Self, Self::Error> {
        validate_workspace_index_event_payload(raw.phase, raw.state)?;
        Ok(Self {
            r#type: raw.r#type,
            timestamp: raw.timestamp,
            index_id: raw.index_id,
            root: raw.root,
            path: raw.path,
            phase: raw.phase,
            state: raw.state,
            indexed: raw.indexed,
            invalidated: raw.invalidated,
            ignored: raw.ignored,
        })
    }
}

impl<'de> Deserialize<'de> for WorkspaceIndexEventPayload {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        RawWorkspaceIndexEventPayload::deserialize(deserializer)?
            .try_into()
            .map_err(de::Error::custom)
    }
}

fn workspace_index_state_for_event_phase(
    phase: WorkspaceIndexEventPhase,
) -> Option<WorkspaceIndexState> {
    match phase {
        WorkspaceIndexEventPhase::Opened => Some(WorkspaceIndexState::Opened),
        WorkspaceIndexEventPhase::RefreshStarted => Some(WorkspaceIndexState::Refreshing),
        WorkspaceIndexEventPhase::RefreshCompleted => Some(WorkspaceIndexState::Opened),
        WorkspaceIndexEventPhase::Closed => Some(WorkspaceIndexState::Closed),
        WorkspaceIndexEventPhase::EntryIndexed | WorkspaceIndexEventPhase::EntryInvalidated => None,
    }
}

fn validate_workspace_index_event_payload(
    phase: WorkspaceIndexEventPhase,
    state: Option<WorkspaceIndexState>,
) -> Result<(), &'static str> {
    match (workspace_index_state_for_event_phase(phase), state) {
        (_, None) => Ok(()),
        (Some(expected), Some(actual)) if expected == actual => Ok(()),
        (Some(_), Some(_)) => Err("workspace index event state must match phase"),
        (None, Some(_)) => Err("workspace index entry events must not carry state"),
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TransactionalFileMutationActorKind {
    Workspace,
    Extension,
    Tool,
    Process,
    Native,
    App,
    Window,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TransactionalFileMutationState {
    Prepared,
    Committing,
    Committed,
    RollingBack,
    RolledBack,
    Conflicted,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TransactionalFileMutationEventPhase {
    Prepared,
    CommitStarted,
    Committed,
    RollbackStarted,
    RolledBack,
    Conflicted,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransactionalFileMutationActorPayload {
    kind: TransactionalFileMutationActorKind,
    id: String,
}

impl TransactionalFileMutationActorPayload {
    pub fn new(kind: TransactionalFileMutationActorKind, id: impl Into<String>) -> Self {
        Self {
            kind,
            id: id.into(),
        }
    }

    pub fn kind(&self) -> TransactionalFileMutationActorKind {
        self.kind
    }

    pub fn id(&self) -> &str {
        &self.id
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransactionalFileMutationDiffPayload {
    format: String,
    text: String,
    additions: u64,
    deletions: u64,
}

impl TransactionalFileMutationDiffPayload {
    pub fn unified(text: impl Into<String>, additions: u64, deletions: u64) -> Self {
        Self {
            format: "unified".to_string(),
            text: text.into(),
            additions,
            deletions,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransactionalFileMutationPreparePayload {
    actor: TransactionalFileMutationActorPayload,
    path: String,
    replacement_bytes: Vec<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    expected_source_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mutation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    owner_scope: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl TransactionalFileMutationPreparePayload {
    pub fn new(
        actor: TransactionalFileMutationActorPayload,
        path: impl Into<String>,
        replacement_bytes: Vec<u8>,
        expected_source_hash: Option<String>,
        mutation_id: Option<String>,
        owner_scope: Option<String>,
        trace_id: Option<String>,
    ) -> Self {
        Self {
            actor,
            path: path.into(),
            replacement_bytes,
            expected_source_hash,
            mutation_id,
            owner_scope,
            trace_id,
        }
    }

    pub fn actor(&self) -> &TransactionalFileMutationActorPayload {
        &self.actor
    }

    pub fn path(&self) -> &str {
        &self.path
    }

    pub fn replacement_bytes(&self) -> &[u8] {
        &self.replacement_bytes
    }

    pub fn expected_source_hash(&self) -> Option<&str> {
        self.expected_source_hash.as_deref()
    }

    pub fn mutation_id(&self) -> Option<&str> {
        self.mutation_id.as_deref()
    }

    pub fn owner_scope(&self) -> Option<&str> {
        self.owner_scope.as_deref()
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransactionalFileMutationPrepareResultPayload {
    mutation_id: String,
    path: String,
    state: TransactionalFileMutationState,
    owner_scope: String,
    source_hash: String,
    replacement_hash: String,
    diff: TransactionalFileMutationDiffPayload,
}

impl TransactionalFileMutationPrepareResultPayload {
    pub fn prepared(
        mutation_id: impl Into<String>,
        path: impl Into<String>,
        owner_scope: impl Into<String>,
        source_hash: impl Into<String>,
        replacement_hash: impl Into<String>,
        diff: TransactionalFileMutationDiffPayload,
    ) -> Self {
        Self {
            mutation_id: mutation_id.into(),
            path: path.into(),
            state: TransactionalFileMutationState::Prepared,
            owner_scope: owner_scope.into(),
            source_hash: source_hash.into(),
            replacement_hash: replacement_hash.into(),
            diff,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransactionalFileMutationCommitPayload {
    actor: TransactionalFileMutationActorPayload,
    mutation_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    expected_source_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl TransactionalFileMutationCommitPayload {
    pub fn new(
        actor: TransactionalFileMutationActorPayload,
        mutation_id: impl Into<String>,
        expected_source_hash: Option<String>,
        trace_id: Option<String>,
    ) -> Self {
        Self {
            actor,
            mutation_id: mutation_id.into(),
            expected_source_hash,
            trace_id,
        }
    }

    pub fn actor(&self) -> &TransactionalFileMutationActorPayload {
        &self.actor
    }

    pub fn mutation_id(&self) -> &str {
        &self.mutation_id
    }

    pub fn expected_source_hash(&self) -> Option<&str> {
        self.expected_source_hash.as_deref()
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransactionalFileMutationCommitResultPayload {
    mutation_id: String,
    path: String,
    state: TransactionalFileMutationState,
    committed: bool,
}

impl TransactionalFileMutationCommitResultPayload {
    pub fn committed(mutation_id: impl Into<String>, path: impl Into<String>) -> Self {
        Self {
            mutation_id: mutation_id.into(),
            path: path.into(),
            state: TransactionalFileMutationState::Committed,
            committed: true,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransactionalFileMutationRollbackPayload {
    actor: TransactionalFileMutationActorPayload,
    mutation_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl TransactionalFileMutationRollbackPayload {
    pub fn new(
        actor: TransactionalFileMutationActorPayload,
        mutation_id: impl Into<String>,
        trace_id: Option<String>,
    ) -> Self {
        Self {
            actor,
            mutation_id: mutation_id.into(),
            trace_id,
        }
    }

    pub fn actor(&self) -> &TransactionalFileMutationActorPayload {
        &self.actor
    }

    pub fn mutation_id(&self) -> &str {
        &self.mutation_id
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransactionalFileMutationRollbackResultPayload {
    mutation_id: String,
    path: String,
    state: TransactionalFileMutationState,
    rolled_back: bool,
}

impl TransactionalFileMutationRollbackResultPayload {
    pub fn rolled_back(mutation_id: impl Into<String>, path: impl Into<String>) -> Self {
        Self {
            mutation_id: mutation_id.into(),
            path: path.into(),
            state: TransactionalFileMutationState::RolledBack,
            rolled_back: true,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransactionalFileMutationSupportedPayload {
    supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl TransactionalFileMutationSupportedPayload {
    pub fn supported() -> Self {
        Self {
            supported: true,
            reason: None,
        }
    }

    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            supported: false,
            reason: Some(reason.into()),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransactionalFileMutationEventPayload {
    r#type: String,
    timestamp: u64,
    mutation_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    phase: TransactionalFileMutationEventPhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    state: Option<TransactionalFileMutationState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    replacement_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    diff: Option<TransactionalFileMutationDiffPayload>,
}

impl TransactionalFileMutationEventPayload {
    pub fn new(
        timestamp: u64,
        mutation_id: impl Into<String>,
        phase: TransactionalFileMutationEventPhase,
    ) -> Self {
        Self {
            r#type: "transactional-file-mutation-event".to_string(),
            timestamp,
            mutation_id: mutation_id.into(),
            path: None,
            phase,
            state: None,
            source_hash: None,
            replacement_hash: None,
            diff: None,
        }
    }

    pub fn with_file(
        mut self,
        path: impl Into<String>,
        state: TransactionalFileMutationState,
    ) -> Self {
        self.path = Some(path.into());
        self.state = Some(state);
        self
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExtensionConfigActorKind {
    Workspace,
    Extension,
    Tool,
    Process,
    Native,
    App,
    Window,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExtensionConfigValueType {
    String,
    Number,
    Boolean,
    Json,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExtensionConfigExportPolicy {
    Diagnostics,
    Private,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExtensionConfigEventPhase {
    Read,
    Written,
    Reset,
    Redacted,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionConfigActorPayload {
    kind: ExtensionConfigActorKind,
    id: String,
}

impl ExtensionConfigActorPayload {
    pub fn new(kind: ExtensionConfigActorKind, id: impl Into<String>) -> Self {
        Self {
            kind,
            id: id.into(),
        }
    }

    pub fn kind(&self) -> ExtensionConfigActorKind {
        self.kind
    }

    pub fn id(&self) -> &str {
        &self.id
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionConfigFieldPayload {
    key: String,
    value_type: ExtensionConfigValueType,
    secret: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    required: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    default_value: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    export_policy: Option<ExtensionConfigExportPolicy>,
}

impl ExtensionConfigFieldPayload {
    pub fn new(key: impl Into<String>, value_type: ExtensionConfigValueType, secret: bool) -> Self {
        Self {
            key: key.into(),
            value_type,
            secret,
            required: None,
            default_value: None,
            export_policy: None,
        }
    }

    pub fn with_default(mut self, value: Value) -> Self {
        self.default_value = Some(value);
        self
    }

    pub fn with_export_policy(mut self, export_policy: ExtensionConfigExportPolicy) -> Self {
        self.export_policy = Some(export_policy);
        self
    }

    pub fn key(&self) -> &str {
        &self.key
    }

    pub fn value_type(&self) -> ExtensionConfigValueType {
        self.value_type
    }

    pub fn secret(&self) -> bool {
        self.secret
    }

    pub fn default_value(&self) -> Option<&Value> {
        self.default_value.as_ref()
    }

    pub fn export_policy(&self) -> Option<ExtensionConfigExportPolicy> {
        self.export_policy
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionConfigValueEntryPayload {
    key: String,
    value: Value,
}

impl ExtensionConfigValueEntryPayload {
    pub fn new(key: impl Into<String>, value: Value) -> Self {
        Self {
            key: key.into(),
            value,
        }
    }

    pub fn key(&self) -> &str {
        &self.key
    }

    pub fn value(&self) -> &Value {
        &self.value
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionConfigSecretStatePayload {
    key: String,
    present: bool,
}

impl ExtensionConfigSecretStatePayload {
    pub fn new(key: impl Into<String>, present: bool) -> Self {
        Self {
            key: key.into(),
            present,
        }
    }

    pub fn key(&self) -> &str {
        &self.key
    }

    pub fn present(&self) -> bool {
        self.present
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionConfigReadPayload {
    actor: ExtensionConfigActorPayload,
    extension_id: String,
    fields: Vec<ExtensionConfigFieldPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl ExtensionConfigReadPayload {
    pub fn new(
        actor: ExtensionConfigActorPayload,
        extension_id: impl Into<String>,
        fields: Vec<ExtensionConfigFieldPayload>,
        trace_id: Option<String>,
    ) -> Self {
        Self {
            actor,
            extension_id: extension_id.into(),
            fields,
            trace_id,
        }
    }

    pub fn actor(&self) -> &ExtensionConfigActorPayload {
        &self.actor
    }

    pub fn extension_id(&self) -> &str {
        &self.extension_id
    }

    pub fn fields(&self) -> &[ExtensionConfigFieldPayload] {
        &self.fields
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionConfigWritePayload {
    actor: ExtensionConfigActorPayload,
    extension_id: String,
    fields: Vec<ExtensionConfigFieldPayload>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    values: Vec<ExtensionConfigValueEntryPayload>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    secret_keys: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl ExtensionConfigWritePayload {
    pub fn new(
        actor: ExtensionConfigActorPayload,
        extension_id: impl Into<String>,
        fields: Vec<ExtensionConfigFieldPayload>,
        values: Vec<ExtensionConfigValueEntryPayload>,
        secret_keys: Vec<String>,
        trace_id: Option<String>,
    ) -> Self {
        Self {
            actor,
            extension_id: extension_id.into(),
            fields,
            values,
            secret_keys,
            trace_id,
        }
    }

    pub fn actor(&self) -> &ExtensionConfigActorPayload {
        &self.actor
    }

    pub fn extension_id(&self) -> &str {
        &self.extension_id
    }

    pub fn fields(&self) -> &[ExtensionConfigFieldPayload] {
        &self.fields
    }

    pub fn values(&self) -> &[ExtensionConfigValueEntryPayload] {
        &self.values
    }

    pub fn secret_keys(&self) -> &[String] {
        &self.secret_keys
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionConfigResetPayload {
    actor: ExtensionConfigActorPayload,
    extension_id: String,
    fields: Vec<ExtensionConfigFieldPayload>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    keys: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl ExtensionConfigResetPayload {
    pub fn new(
        actor: ExtensionConfigActorPayload,
        extension_id: impl Into<String>,
        fields: Vec<ExtensionConfigFieldPayload>,
        keys: Vec<String>,
        trace_id: Option<String>,
    ) -> Self {
        Self {
            actor,
            extension_id: extension_id.into(),
            fields,
            keys,
            trace_id,
        }
    }

    pub fn actor(&self) -> &ExtensionConfigActorPayload {
        &self.actor
    }

    pub fn extension_id(&self) -> &str {
        &self.extension_id
    }

    pub fn fields(&self) -> &[ExtensionConfigFieldPayload] {
        &self.fields
    }

    pub fn keys(&self) -> &[String] {
        &self.keys
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

pub type ExtensionConfigRedactPayload = ExtensionConfigReadPayload;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionConfigReadResultPayload {
    extension_id: String,
    values: Vec<ExtensionConfigValueEntryPayload>,
    secrets: Vec<ExtensionConfigSecretStatePayload>,
    revision: u64,
}

impl ExtensionConfigReadResultPayload {
    pub fn new(
        extension_id: impl Into<String>,
        values: Vec<ExtensionConfigValueEntryPayload>,
        secrets: Vec<ExtensionConfigSecretStatePayload>,
        revision: u64,
    ) -> Self {
        Self {
            extension_id: extension_id.into(),
            values,
            secrets,
            revision,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionConfigWriteResultPayload {
    extension_id: String,
    written_keys: Vec<String>,
    revision: u64,
}

impl ExtensionConfigWriteResultPayload {
    pub fn new(extension_id: impl Into<String>, written_keys: Vec<String>, revision: u64) -> Self {
        Self {
            extension_id: extension_id.into(),
            written_keys,
            revision,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionConfigResetResultPayload {
    extension_id: String,
    reset_keys: Vec<String>,
    revision: u64,
}

impl ExtensionConfigResetResultPayload {
    pub fn new(extension_id: impl Into<String>, reset_keys: Vec<String>, revision: u64) -> Self {
        Self {
            extension_id: extension_id.into(),
            reset_keys,
            revision,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionConfigRedactionEvidencePayload {
    key: String,
    reason: String,
}

impl ExtensionConfigRedactionEvidencePayload {
    pub fn new(key: impl Into<String>, reason: impl Into<String>) -> Self {
        Self {
            key: key.into(),
            reason: reason.into(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionConfigRedactResultPayload {
    extension_id: String,
    values: Vec<ExtensionConfigValueEntryPayload>,
    redactions: Vec<ExtensionConfigRedactionEvidencePayload>,
}

impl ExtensionConfigRedactResultPayload {
    pub fn new(
        extension_id: impl Into<String>,
        values: Vec<ExtensionConfigValueEntryPayload>,
        redactions: Vec<ExtensionConfigRedactionEvidencePayload>,
    ) -> Self {
        Self {
            extension_id: extension_id.into(),
            values,
            redactions,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionConfigSupportedPayload {
    supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl ExtensionConfigSupportedPayload {
    pub fn supported() -> Self {
        Self {
            supported: true,
            reason: None,
        }
    }

    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            supported: false,
            reason: Some(reason.into()),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionConfigEventPayload {
    r#type: String,
    timestamp: u64,
    extension_id: String,
    phase: ExtensionConfigEventPhase,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    keys: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    revision: Option<u64>,
}

impl ExtensionConfigEventPayload {
    pub fn new(
        timestamp: u64,
        extension_id: impl Into<String>,
        phase: ExtensionConfigEventPhase,
        keys: Vec<String>,
        revision: Option<u64>,
    ) -> Self {
        Self {
            r#type: "extension-config-event".to_string(),
            timestamp,
            extension_id: extension_id.into(),
            phase,
            keys,
            revision,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExtensionPackageActorKind {
    Workspace,
    Extension,
    Tool,
    Process,
    Native,
    App,
    Window,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExtensionPackageSourceKind {
    Directory,
    Archive,
    Registry,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExtensionPackageEventPhase {
    Installing,
    Installed,
    Updating,
    Updated,
    Removing,
    Removed,
    Failed,
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DistributionParityEvidenceKind {
    PackageArtifact,
    PluginRegistration,
    Template,
    Docs,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DistributionParityEvidencePayload {
    kind: DistributionParityEvidenceKind,
    id: String,
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    sha256: Option<String>,
    capabilities: Vec<Value>,
}

impl DistributionParityEvidencePayload {
    pub fn new(
        kind: DistributionParityEvidenceKind,
        id: impl Into<String>,
        path: impl Into<String>,
        sha256: Option<String>,
        capabilities: Vec<Value>,
    ) -> Self {
        Self {
            kind,
            id: id.into(),
            path: path.into(),
            sha256,
            capabilities,
        }
    }

    pub fn kind(&self) -> &DistributionParityEvidenceKind {
        &self.kind
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn path(&self) -> &str {
        &self.path
    }

    pub fn sha256(&self) -> Option<&str> {
        self.sha256.as_deref()
    }

    pub fn capabilities(&self) -> &[Value] {
        &self.capabilities
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DistributionParityVerifyPayload {
    package_id: String,
    version: String,
    capabilities: Vec<Value>,
    evidence: Vec<DistributionParityEvidencePayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl DistributionParityVerifyPayload {
    pub fn new(
        package_id: impl Into<String>,
        version: impl Into<String>,
        capabilities: Vec<Value>,
        evidence: Vec<DistributionParityEvidencePayload>,
        trace_id: Option<String>,
    ) -> Self {
        Self {
            package_id: package_id.into(),
            version: version.into(),
            capabilities,
            evidence,
            trace_id,
        }
    }

    pub fn package_id(&self) -> &str {
        &self.package_id
    }

    pub fn version(&self) -> &str {
        &self.version
    }

    pub fn capabilities(&self) -> &[Value] {
        &self.capabilities
    }

    pub fn evidence(&self) -> &[DistributionParityEvidencePayload] {
        &self.evidence
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DistributionParityVerifyResultPayload {
    package_id: String,
    version: String,
    capability_count: u64,
    evidence_count: u64,
}

impl DistributionParityVerifyResultPayload {
    pub fn new(
        package_id: impl Into<String>,
        version: impl Into<String>,
        capability_count: u64,
        evidence_count: u64,
    ) -> Self {
        Self {
            package_id: package_id.into(),
            version: version.into(),
            capability_count,
            evidence_count,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DistributionParitySupportedPayload {
    supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl DistributionParitySupportedPayload {
    pub fn supported() -> Self {
        Self {
            supported: true,
            reason: None,
        }
    }

    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            supported: false,
            reason: Some(reason.into()),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DistributionParityEventPhase {
    Verified,
    Failed,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DistributionParityEventPayload {
    event_type: String,
    timestamp: u64,
    phase: DistributionParityEventPhase,
    package_id: String,
    version: Option<String>,
    reason: Option<String>,
}

impl DistributionParityEventPayload {
    pub fn verified(
        timestamp: u64,
        package_id: impl Into<String>,
        version: impl Into<String>,
    ) -> Self {
        Self {
            event_type: "distribution-parity-event".to_string(),
            timestamp,
            phase: DistributionParityEventPhase::Verified,
            package_id: package_id.into(),
            version: Some(version.into()),
            reason: None,
        }
    }

    pub fn failed(
        timestamp: u64,
        package_id: impl Into<String>,
        version: impl Into<String>,
        reason: impl Into<String>,
    ) -> Self {
        Self {
            event_type: "distribution-parity-event".to_string(),
            timestamp,
            phase: DistributionParityEventPhase::Failed,
            package_id: package_id.into(),
            version: Some(version.into()),
            reason: Some(reason.into()),
        }
    }

    #[cfg(test)]
    fn new_for_test(
        timestamp: u64,
        phase: DistributionParityEventPhase,
        package_id: impl Into<String>,
        version: Option<String>,
        reason: Option<String>,
    ) -> Self {
        Self {
            event_type: "distribution-parity-event".to_string(),
            timestamp,
            phase,
            package_id: package_id.into(),
            version,
            reason,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SerializableDistributionParityEventPayload<'a> {
    #[serde(rename = "type")]
    event_type: &'a str,
    timestamp: u64,
    phase: DistributionParityEventPhase,
    package_id: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'a str>,
}

impl<'a> TryFrom<&'a DistributionParityEventPayload>
    for SerializableDistributionParityEventPayload<'a>
{
    type Error = &'static str;

    fn try_from(payload: &'a DistributionParityEventPayload) -> Result<Self, Self::Error> {
        if payload.event_type != "distribution-parity-event" {
            return Err("distribution parity event type must be distribution-parity-event");
        }
        validate_distribution_parity_event_payload(
            payload.phase.clone(),
            &payload.version,
            &payload.reason,
        )?;
        Ok(Self {
            event_type: &payload.event_type,
            timestamp: payload.timestamp,
            phase: payload.phase.clone(),
            package_id: &payload.package_id,
            version: payload.version.as_deref(),
            reason: payload.reason.as_deref(),
        })
    }
}

impl Serialize for DistributionParityEventPayload {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        SerializableDistributionParityEventPayload::try_from(self)
            .map_err(ser::Error::custom)?
            .serialize(serializer)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawDistributionParityEventPayload {
    #[serde(rename = "type")]
    event_type: String,
    timestamp: u64,
    phase: DistributionParityEventPhase,
    package_id: String,
    version: Option<String>,
    reason: Option<String>,
}

impl TryFrom<RawDistributionParityEventPayload> for DistributionParityEventPayload {
    type Error = &'static str;

    fn try_from(raw: RawDistributionParityEventPayload) -> Result<Self, Self::Error> {
        if raw.event_type != "distribution-parity-event" {
            return Err("distribution parity event type must be distribution-parity-event");
        }
        validate_distribution_parity_event_payload(raw.phase.clone(), &raw.version, &raw.reason)?;
        Ok(Self {
            event_type: raw.event_type,
            timestamp: raw.timestamp,
            phase: raw.phase,
            package_id: raw.package_id,
            version: raw.version,
            reason: raw.reason,
        })
    }
}

impl<'de> Deserialize<'de> for DistributionParityEventPayload {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        RawDistributionParityEventPayload::deserialize(deserializer)?
            .try_into()
            .map_err(de::Error::custom)
    }
}

fn validate_distribution_parity_event_payload(
    phase: DistributionParityEventPhase,
    version: &Option<String>,
    reason: &Option<String>,
) -> Result<(), &'static str> {
    match phase {
        DistributionParityEventPhase::Verified if version.is_some() && reason.is_none() => Ok(()),
        DistributionParityEventPhase::Verified => {
            Err("verified distribution parity events require version only")
        }
        DistributionParityEventPhase::Failed if version.is_some() && reason.is_some() => Ok(()),
        DistributionParityEventPhase::Failed => {
            Err("failed distribution parity events require version and reason")
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum JobState {
    Running,
    Paused,
    Interrupted,
    Succeeded,
    Failed,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum JobEventPhase {
    Started,
    Paused,
    Resumed,
    Retried,
    Interrupted,
    Progress,
    Succeeded,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JobHandlePayload {
    kind: String,
    id: String,
    generation: u64,
    owner_scope: String,
    state: JobState,
}

impl JobHandlePayload {
    pub fn new(
        id: impl Into<String>,
        generation: u64,
        owner_scope: impl Into<String>,
        state: JobState,
    ) -> Self {
        Self {
            kind: "job".to_string(),
            id: id.into(),
            generation,
            owner_scope: owner_scope.into(),
            state,
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn state(&self) -> &JobState {
        &self.state
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JobProgressPayload {
    completed: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    total: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    updated_at: u64,
}

impl JobProgressPayload {
    pub fn new(
        completed: f64,
        total: Option<f64>,
        message: Option<String>,
        updated_at: u64,
    ) -> Self {
        Self {
            completed,
            total,
            message,
            updated_at,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JobSnapshotPayload {
    handle: JobHandlePayload,
    name: String,
    state: JobState,
    started_at: u64,
    updated_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    progress: Option<JobProgressPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl JobSnapshotPayload {
    pub fn new(
        handle: JobHandlePayload,
        name: impl Into<String>,
        state: JobState,
        started_at: u64,
        updated_at: u64,
        progress: Option<JobProgressPayload>,
        reason: Option<String>,
    ) -> Self {
        Self {
            handle,
            name: name.into(),
            state,
            started_at,
            updated_at,
            progress,
            reason,
        }
    }

    pub fn handle(&self) -> &JobHandlePayload {
        &self.handle
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn state(&self) -> &JobState {
        &self.state
    }

    pub fn started_at(&self) -> u64 {
        self.started_at
    }

    pub fn updated_at(&self) -> u64 {
        self.updated_at
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JobStartPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    job_id: Option<String>,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl JobStartPayload {
    pub fn job_id(&self) -> Option<&str> {
        self.job_id.as_deref()
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JobControlPayload {
    job_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl JobControlPayload {
    pub fn job_id(&self) -> &str {
        &self.job_id
    }

    pub fn reason(&self) -> Option<&str> {
        self.reason.as_deref()
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JobProgressReportPayload {
    job_id: String,
    completed: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    total: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl JobProgressReportPayload {
    pub fn job_id(&self) -> &str {
        &self.job_id
    }

    pub fn completed(&self) -> f64 {
        self.completed
    }

    pub fn total(&self) -> Option<f64> {
        self.total
    }

    pub fn message(&self) -> Option<&str> {
        self.message.as_deref()
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JobGetPayload {
    job_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl JobGetPayload {
    pub fn job_id(&self) -> &str {
        &self.job_id
    }

    pub fn trace_id(&self) -> Option<&str> {
        self.trace_id.as_deref()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JobSupportedPayload {
    supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl JobSupportedPayload {
    pub fn supported() -> Self {
        Self {
            supported: true,
            reason: None,
        }
    }

    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            supported: false,
            reason: Some(reason.into()),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JobEventPayload {
    #[serde(rename = "type")]
    event_type: String,
    timestamp: u64,
    phase: JobEventPhase,
    job: JobSnapshotPayload,
}

impl JobEventPayload {
    pub fn new(timestamp: u64, phase: JobEventPhase, job: JobSnapshotPayload) -> Self {
        Self {
            event_type: "job-event".to_string(),
            timestamp,
            phase,
            job,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionPackageActorPayload {
    kind: ExtensionPackageActorKind,
    id: String,
}

impl ExtensionPackageActorPayload {
    pub fn new(kind: ExtensionPackageActorKind, id: impl Into<String>) -> Self {
        Self {
            kind,
            id: id.into(),
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionPackageSourcePayload {
    kind: ExtensionPackageSourceKind,
    uri: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    digest: Option<String>,
}

impl ExtensionPackageSourcePayload {
    pub fn new(kind: ExtensionPackageSourceKind, uri: impl Into<String>) -> Self {
        Self {
            kind,
            uri: uri.into(),
            digest: None,
        }
    }

    pub fn with_digest(mut self, digest: impl Into<String>) -> Self {
        self.digest = Some(digest.into());
        self
    }

    pub fn uri(&self) -> &str {
        &self.uri
    }

    pub fn kind(&self) -> ExtensionPackageSourceKind {
        self.kind
    }

    pub fn digest(&self) -> Option<&str> {
        self.digest.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionPackageCompatibilityPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    min_host_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_host_version: Option<String>,
}

impl ExtensionPackageCompatibilityPayload {
    pub fn new(min_host_version: Option<String>, max_host_version: Option<String>) -> Self {
        Self {
            min_host_version,
            max_host_version,
        }
    }

    pub fn min_host_version(&self) -> Option<&str> {
        self.min_host_version.as_deref()
    }

    pub fn max_host_version(&self) -> Option<&str> {
        self.max_host_version.as_deref()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionPackageCapabilityDeclarationPayload {
    capability: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl ExtensionPackageCapabilityDeclarationPayload {
    pub fn new(capability: Value) -> Self {
        Self {
            capability,
            reason: None,
        }
    }

    pub fn with_reason(mut self, reason: impl Into<String>) -> Self {
        self.reason = Some(reason.into());
        self
    }

    pub fn capability(&self) -> &Value {
        &self.capability
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionPackageManifestPayload {
    id: String,
    name: String,
    version: String,
    entrypoint: String,
    compatibility: ExtensionPackageCompatibilityPayload,
    capabilities: Vec<ExtensionPackageCapabilityDeclarationPayload>,
}

impl ExtensionPackageManifestPayload {
    pub fn new(
        id: impl Into<String>,
        name: impl Into<String>,
        version: impl Into<String>,
        entrypoint: impl Into<String>,
        compatibility: ExtensionPackageCompatibilityPayload,
        capabilities: Vec<ExtensionPackageCapabilityDeclarationPayload>,
    ) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            version: version.into(),
            entrypoint: entrypoint.into(),
            compatibility,
            capabilities,
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn version(&self) -> &str {
        &self.version
    }

    pub fn entrypoint(&self) -> &str {
        &self.entrypoint
    }

    pub fn compatibility(&self) -> &ExtensionPackageCompatibilityPayload {
        &self.compatibility
    }

    pub fn capabilities(&self) -> &[ExtensionPackageCapabilityDeclarationPayload] {
        &self.capabilities
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionPackageInstallPayload {
    actor: ExtensionPackageActorPayload,
    source: ExtensionPackageSourcePayload,
    manifest: ExtensionPackageManifestPayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl ExtensionPackageInstallPayload {
    pub fn new(
        actor: ExtensionPackageActorPayload,
        source: ExtensionPackageSourcePayload,
        manifest: ExtensionPackageManifestPayload,
        trace_id: Option<String>,
    ) -> Self {
        Self {
            actor,
            source,
            manifest,
            trace_id,
        }
    }

    pub fn actor(&self) -> &ExtensionPackageActorPayload {
        &self.actor
    }

    pub fn source(&self) -> &ExtensionPackageSourcePayload {
        &self.source
    }

    pub fn manifest(&self) -> &ExtensionPackageManifestPayload {
        &self.manifest
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionPackageUpdatePayload {
    actor: ExtensionPackageActorPayload,
    source: ExtensionPackageSourcePayload,
    manifest: ExtensionPackageManifestPayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    expected_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl ExtensionPackageUpdatePayload {
    pub fn new(
        actor: ExtensionPackageActorPayload,
        source: ExtensionPackageSourcePayload,
        manifest: ExtensionPackageManifestPayload,
        expected_version: Option<String>,
        trace_id: Option<String>,
    ) -> Self {
        Self {
            actor,
            source,
            manifest,
            expected_version,
            trace_id,
        }
    }

    pub fn actor(&self) -> &ExtensionPackageActorPayload {
        &self.actor
    }

    pub fn source(&self) -> &ExtensionPackageSourcePayload {
        &self.source
    }

    pub fn manifest(&self) -> &ExtensionPackageManifestPayload {
        &self.manifest
    }

    pub fn expected_version(&self) -> Option<&str> {
        self.expected_version.as_deref()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionPackageRemovePayload {
    actor: ExtensionPackageActorPayload,
    package_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

impl ExtensionPackageRemovePayload {
    pub fn new(
        actor: ExtensionPackageActorPayload,
        package_id: impl Into<String>,
        trace_id: Option<String>,
    ) -> Self {
        Self {
            actor,
            package_id: package_id.into(),
            trace_id,
        }
    }

    pub fn actor(&self) -> &ExtensionPackageActorPayload {
        &self.actor
    }

    pub fn package_id(&self) -> &str {
        &self.package_id
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionPackageStatePayload {
    package_id: String,
    manifest: ExtensionPackageManifestPayload,
    source: ExtensionPackageSourcePayload,
    revision: u64,
}

impl ExtensionPackageStatePayload {
    pub fn new(
        package_id: impl Into<String>,
        manifest: ExtensionPackageManifestPayload,
        source: ExtensionPackageSourcePayload,
        revision: u64,
    ) -> Self {
        Self {
            package_id: package_id.into(),
            manifest,
            source,
            revision,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionPackageInstallResultPayload {
    package_id: String,
    version: String,
    revision: u64,
    registered_capabilities: Vec<Value>,
}

impl ExtensionPackageInstallResultPayload {
    pub fn new(
        package_id: impl Into<String>,
        version: impl Into<String>,
        revision: u64,
        registered_capabilities: Vec<Value>,
    ) -> Self {
        Self {
            package_id: package_id.into(),
            version: version.into(),
            revision,
            registered_capabilities,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionPackageUpdateResultPayload {
    package_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    previous_version: Option<String>,
    version: String,
    revision: u64,
    registered_capabilities: Vec<Value>,
}

impl ExtensionPackageUpdateResultPayload {
    pub fn new(
        package_id: impl Into<String>,
        previous_version: Option<String>,
        version: impl Into<String>,
        revision: u64,
        registered_capabilities: Vec<Value>,
    ) -> Self {
        Self {
            package_id: package_id.into(),
            previous_version,
            version: version.into(),
            revision,
            registered_capabilities,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionPackageRemoveResultPayload {
    package_id: String,
    removed: bool,
    revision: u64,
}

impl ExtensionPackageRemoveResultPayload {
    pub fn new(package_id: impl Into<String>, removed: bool, revision: u64) -> Self {
        Self {
            package_id: package_id.into(),
            removed,
            revision,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionPackageListResultPayload {
    packages: Vec<ExtensionPackageStatePayload>,
}

impl ExtensionPackageListResultPayload {
    pub fn new(packages: Vec<ExtensionPackageStatePayload>) -> Self {
        Self { packages }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionPackageSupportedPayload {
    supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl ExtensionPackageSupportedPayload {
    pub fn supported() -> Self {
        Self {
            supported: true,
            reason: None,
        }
    }

    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            supported: false,
            reason: Some(reason.into()),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct ExtensionPackageEventPayload {
    r#type: String,
    timestamp: u64,
    package_id: String,
    phase: ExtensionPackageEventPhase,
    version: Option<String>,
    revision: Option<u64>,
    reason: Option<String>,
}

impl ExtensionPackageEventPayload {
    pub fn new(
        timestamp: u64,
        package_id: impl Into<String>,
        phase: ExtensionPackageEventPhase,
        version: Option<String>,
        revision: Option<u64>,
        reason: Option<String>,
    ) -> Self {
        Self {
            r#type: "extension-package-event".to_string(),
            timestamp,
            package_id: package_id.into(),
            phase,
            version,
            revision,
            reason,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SerializableExtensionPackageEventPayload<'a> {
    r#type: &'a str,
    timestamp: u64,
    package_id: &'a str,
    phase: ExtensionPackageEventPhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    revision: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'a str>,
}

impl<'a> TryFrom<&'a ExtensionPackageEventPayload>
    for SerializableExtensionPackageEventPayload<'a>
{
    type Error = &'static str;

    fn try_from(payload: &'a ExtensionPackageEventPayload) -> Result<Self, Self::Error> {
        validate_extension_package_event_payload(&payload.r#type, payload.phase, &payload.reason)?;
        Ok(Self {
            r#type: &payload.r#type,
            timestamp: payload.timestamp,
            package_id: &payload.package_id,
            phase: payload.phase,
            version: payload.version.as_deref(),
            revision: payload.revision,
            reason: payload.reason.as_deref(),
        })
    }
}

impl Serialize for ExtensionPackageEventPayload {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        SerializableExtensionPackageEventPayload::try_from(self)
            .map_err(ser::Error::custom)?
            .serialize(serializer)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawExtensionPackageEventPayload {
    r#type: String,
    timestamp: u64,
    package_id: String,
    phase: ExtensionPackageEventPhase,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    revision: Option<u64>,
    #[serde(default)]
    reason: Option<String>,
}

impl TryFrom<RawExtensionPackageEventPayload> for ExtensionPackageEventPayload {
    type Error = &'static str;

    fn try_from(raw: RawExtensionPackageEventPayload) -> Result<Self, Self::Error> {
        validate_extension_package_event_payload(&raw.r#type, raw.phase, &raw.reason)?;
        Ok(Self {
            r#type: raw.r#type,
            timestamp: raw.timestamp,
            package_id: raw.package_id,
            phase: raw.phase,
            version: raw.version,
            revision: raw.revision,
            reason: raw.reason,
        })
    }
}

impl<'de> Deserialize<'de> for ExtensionPackageEventPayload {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        RawExtensionPackageEventPayload::deserialize(deserializer)?
            .try_into()
            .map_err(de::Error::custom)
    }
}

fn validate_extension_package_event_payload(
    event_type: &str,
    phase: ExtensionPackageEventPhase,
    reason: &Option<String>,
) -> Result<(), &'static str> {
    if event_type != "extension-package-event" {
        return Err("extension package event type must match the protocol event name");
    }
    match phase {
        ExtensionPackageEventPhase::Installing
        | ExtensionPackageEventPhase::Installed
        | ExtensionPackageEventPhase::Updating
        | ExtensionPackageEventPhase::Updated
        | ExtensionPackageEventPhase::Removing
        | ExtensionPackageEventPhase::Removed
            if reason.is_none() =>
        {
            Ok(())
        }
        ExtensionPackageEventPhase::Installing
        | ExtensionPackageEventPhase::Installed
        | ExtensionPackageEventPhase::Updating
        | ExtensionPackageEventPhase::Updated
        | ExtensionPackageEventPhase::Removing
        | ExtensionPackageEventPhase::Removed => {
            Err("successful extension package events must not include failure reason")
        }
        ExtensionPackageEventPhase::Failed if reason.is_some() => Ok(()),
        ExtensionPackageEventPhase::Failed => Err("failed extension package events require reason"),
    }
}

impl WindowDestroyPayload {
    pub fn new(window_id: impl Into<String>) -> Self {
        Self {
            window_id: window_id.into(),
        }
    }

    pub fn window_id(&self) -> &str {
        &self.window_id
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResumeTicket {
    window_id: String,
    origin_token_hash: String,
    resume_nonce: String,
    expires_at: u64,
    last_stream_cursors: BTreeMap<String, String>,
}

impl ResumeTicket {
    pub fn new(
        window_id: impl Into<String>,
        origin_token_hash: impl Into<String>,
        resume_nonce: impl Into<String>,
        expires_at: u64,
        last_stream_cursors: BTreeMap<String, String>,
    ) -> Self {
        Self {
            window_id: window_id.into(),
            origin_token_hash: origin_token_hash.into(),
            resume_nonce: resume_nonce.into(),
            expires_at,
            last_stream_cursors,
        }
    }

    pub fn window_id(&self) -> &str {
        &self.window_id
    }

    pub fn origin_token_hash(&self) -> &str {
        &self.origin_token_hash
    }

    pub fn resume_nonce(&self) -> &str {
        &self.resume_nonce
    }

    pub fn expires_at(&self) -> u64 {
        self.expires_at
    }

    pub fn last_stream_cursors(&self) -> &BTreeMap<String, String> {
        &self.last_stream_cursors
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RendererDisconnectedPayload {
    window_id: String,
    resume_ticket: ResumeTicket,
}

impl RendererDisconnectedPayload {
    pub fn new(window_id: impl Into<String>, resume_ticket: ResumeTicket) -> Self {
        Self {
            window_id: window_id.into(),
            resume_ticket,
        }
    }

    pub fn window_id(&self) -> &str {
        &self.window_id
    }

    pub fn resume_ticket(&self) -> &ResumeTicket {
        &self.resume_ticket
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RendererResumePayload {
    window_id: String,
    resume_nonce: String,
    cursors: BTreeMap<String, String>,
}

impl RendererResumePayload {
    pub fn new(
        window_id: impl Into<String>,
        resume_nonce: impl Into<String>,
        cursors: BTreeMap<String, String>,
    ) -> Self {
        Self {
            window_id: window_id.into(),
            resume_nonce: resume_nonce.into(),
            cursors,
        }
    }

    pub fn window_id(&self) -> &str {
        &self.window_id
    }

    pub fn resume_nonce(&self) -> &str {
        &self.resume_nonce
    }

    pub fn cursors(&self) -> &BTreeMap<String, String> {
        &self.cursors
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RendererResumedPayload {
    window_id: String,
    replayed_stream_ids: Vec<String>,
}

impl RendererResumedPayload {
    pub fn new(window_id: impl Into<String>, replayed_stream_ids: Vec<String>) -> Self {
        Self {
            window_id: window_id.into(),
            replayed_stream_ids,
        }
    }

    pub fn window_id(&self) -> &str {
        &self.window_id
    }

    pub fn replayed_stream_ids(&self) -> &[String] {
        &self.replayed_stream_ids
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RendererResumeDeniedReason {
    Expired,
    WindowMismatch,
    OriginInvalid,
    BackfillExhausted,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RendererResumeDeniedPayload {
    window_id: String,
    reason: RendererResumeDeniedReason,
    message: String,
}

impl RendererResumeDeniedPayload {
    pub fn new(
        window_id: impl Into<String>,
        reason: RendererResumeDeniedReason,
        message: impl Into<String>,
    ) -> Self {
        Self {
            window_id: window_id.into(),
            reason,
            message: message.into(),
        }
    }

    pub fn window_id(&self) -> &str {
        &self.window_id
    }

    pub fn reason(&self) -> &RendererResumeDeniedReason {
        &self.reason
    }

    pub fn message(&self) -> &str {
        &self.message
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum HostProtocolEnvelope {
    Request {
        id: String,
        method: String,
        timestamp: u64,
        trace_id: String,
        window_id: Option<String>,
        origin_token: Option<String>,
        payload: Option<Value>,
    },
    Response {
        id: String,
        timestamp: u64,
        trace_id: String,
        payload: Option<Value>,
        error: Option<HostProtocolError>,
    },
    Event {
        method: String,
        timestamp: u64,
        trace_id: String,
        window_id: Option<String>,
        payload: Option<Value>,
    },
    Stream {
        id: Option<String>,
        resource_id: Option<String>,
        timestamp: u64,
        trace_id: String,
        payload: Option<Value>,
        error: Option<HostProtocolError>,
    },
    Cancel {
        id: Option<String>,
        resource_id: Option<String>,
        timestamp: u64,
        trace_id: String,
    },
}

impl Serialize for HostProtocolEnvelope {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        SerializableHostProtocolEnvelope::try_from(self)
            .map_err(ser::Error::custom)?
            .serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for HostProtocolEnvelope {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = RawHostProtocolEnvelope::deserialize(deserializer)?;
        HostProtocolEnvelope::try_from(raw).map_err(de::Error::custom)
    }
}

#[derive(Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum SerializableHostProtocolEnvelope<'a> {
    Request {
        id: &'a str,
        method: &'a str,
        timestamp: u64,
        trace_id: &'a str,
        #[serde(skip_serializing_if = "Option::is_none")]
        window_id: Option<&'a str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        origin_token: Option<&'a str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        payload: Option<&'a Value>,
    },
    Response {
        id: &'a str,
        timestamp: u64,
        trace_id: &'a str,
        #[serde(skip_serializing_if = "Option::is_none")]
        payload: Option<&'a Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<&'a HostProtocolError>,
    },
    Event {
        method: &'a str,
        timestamp: u64,
        trace_id: &'a str,
        #[serde(skip_serializing_if = "Option::is_none")]
        window_id: Option<&'a str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        payload: Option<&'a Value>,
    },
    Stream {
        #[serde(skip_serializing_if = "Option::is_none")]
        id: Option<&'a str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        resource_id: Option<&'a str>,
        timestamp: u64,
        trace_id: &'a str,
        #[serde(skip_serializing_if = "Option::is_none")]
        payload: Option<&'a Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<&'a HostProtocolError>,
    },
    Cancel {
        #[serde(skip_serializing_if = "Option::is_none")]
        id: Option<&'a str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        resource_id: Option<&'a str>,
        timestamp: u64,
        trace_id: &'a str,
    },
}

impl<'a> TryFrom<&'a HostProtocolEnvelope> for SerializableHostProtocolEnvelope<'a> {
    type Error = &'static str;

    fn try_from(envelope: &'a HostProtocolEnvelope) -> Result<Self, Self::Error> {
        match envelope {
            HostProtocolEnvelope::Request {
                id,
                method,
                timestamp,
                trace_id,
                window_id,
                origin_token,
                payload,
            } => {
                validate_host_identity_ref(id)?;
                validate_host_identity_ref(trace_id)?;
                validate_optional_host_identity_ref(window_id.as_deref())?;
                validate_optional_host_identity_ref(origin_token.as_deref())?;

                Ok(Self::Request {
                    id,
                    method,
                    timestamp: *timestamp,
                    trace_id,
                    window_id: window_id.as_deref(),
                    origin_token: origin_token.as_deref(),
                    payload: payload.as_ref(),
                })
            }
            HostProtocolEnvelope::Response {
                id,
                timestamp,
                trace_id,
                payload,
                error,
            } => {
                validate_host_identity_ref(id)?;
                validate_host_identity_ref(trace_id)?;
                validate_host_protocol_outcome("response", payload.is_some(), error.is_some())?;

                Ok(Self::Response {
                    id,
                    timestamp: *timestamp,
                    trace_id,
                    payload: payload.as_ref(),
                    error: error.as_ref(),
                })
            }
            HostProtocolEnvelope::Event {
                method,
                timestamp,
                trace_id,
                window_id,
                payload,
            } => {
                validate_host_identity_ref(trace_id)?;
                validate_optional_host_identity_ref(window_id.as_deref())?;

                Ok(Self::Event {
                    method,
                    timestamp: *timestamp,
                    trace_id,
                    window_id: window_id.as_deref(),
                    payload: payload.as_ref(),
                })
            }
            HostProtocolEnvelope::Stream {
                id,
                resource_id,
                timestamp,
                trace_id,
                payload,
                error,
            } => {
                validate_host_protocol_target("stream", id.as_deref(), resource_id.as_deref())?;
                validate_host_protocol_outcome("stream", payload.is_some(), error.is_some())?;

                validate_optional_host_identity_ref(id.as_deref())?;
                validate_optional_host_identity_ref(resource_id.as_deref())?;
                validate_host_identity_ref(trace_id)?;

                Ok(Self::Stream {
                    id: id.as_deref(),
                    resource_id: resource_id.as_deref(),
                    timestamp: *timestamp,
                    trace_id,
                    payload: payload.as_ref(),
                    error: error.as_ref(),
                })
            }
            HostProtocolEnvelope::Cancel {
                id,
                resource_id,
                timestamp,
                trace_id,
            } => {
                validate_host_protocol_target("cancel", id.as_deref(), resource_id.as_deref())?;

                validate_optional_host_identity_ref(id.as_deref())?;
                validate_optional_host_identity_ref(resource_id.as_deref())?;
                validate_host_identity_ref(trace_id)?;

                Ok(Self::Cancel {
                    id: id.as_deref(),
                    resource_id: resource_id.as_deref(),
                    timestamp: *timestamp,
                    trace_id,
                })
            }
        }
    }
}

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum RawHostProtocolEnvelope {
    Request {
        id: String,
        method: String,
        timestamp: u64,
        trace_id: String,
        window_id: Option<String>,
        origin_token: Option<String>,
        payload: Option<Value>,
    },
    Response {
        id: String,
        timestamp: u64,
        trace_id: String,
        payload: Option<Value>,
        error: Option<HostProtocolError>,
    },
    Event {
        method: String,
        timestamp: u64,
        trace_id: String,
        window_id: Option<String>,
        payload: Option<Value>,
    },
    Stream {
        id: Option<String>,
        resource_id: Option<String>,
        timestamp: u64,
        trace_id: String,
        payload: Option<Value>,
        error: Option<HostProtocolError>,
    },
    Cancel {
        id: Option<String>,
        resource_id: Option<String>,
        timestamp: u64,
        trace_id: String,
    },
}

impl TryFrom<RawHostProtocolEnvelope> for HostProtocolEnvelope {
    type Error = &'static str;

    fn try_from(raw: RawHostProtocolEnvelope) -> Result<Self, Self::Error> {
        match raw {
            RawHostProtocolEnvelope::Request {
                id,
                method,
                timestamp,
                trace_id,
                window_id,
                origin_token,
                payload,
            } => Ok(Self::Request {
                id: validate_host_identity(id)?,
                method,
                timestamp,
                trace_id: validate_host_identity(trace_id)?,
                window_id: validate_optional_host_identity(window_id)?,
                origin_token: validate_optional_host_identity(origin_token)?,
                payload,
            }),
            RawHostProtocolEnvelope::Response {
                id,
                timestamp,
                trace_id,
                payload,
                error,
            } => {
                validate_host_protocol_outcome("response", payload.is_some(), error.is_some())?;

                Ok(Self::Response {
                    id: validate_host_identity(id)?,
                    timestamp,
                    trace_id: validate_host_identity(trace_id)?,
                    payload,
                    error,
                })
            }
            RawHostProtocolEnvelope::Event {
                method,
                timestamp,
                trace_id,
                window_id,
                payload,
            } => Ok(Self::Event {
                method,
                timestamp,
                trace_id: validate_host_identity(trace_id)?,
                window_id: validate_optional_host_identity(window_id)?,
                payload,
            }),
            RawHostProtocolEnvelope::Stream {
                id,
                resource_id,
                timestamp,
                trace_id,
                payload,
                error,
            } => {
                validate_host_protocol_target("stream", id.as_deref(), resource_id.as_deref())?;
                validate_host_protocol_outcome("stream", payload.is_some(), error.is_some())?;

                Ok(Self::Stream {
                    id: validate_optional_host_identity(id)?,
                    resource_id: validate_optional_host_identity(resource_id)?,
                    timestamp,
                    trace_id: validate_host_identity(trace_id)?,
                    payload,
                    error,
                })
            }
            RawHostProtocolEnvelope::Cancel {
                id,
                resource_id,
                timestamp,
                trace_id,
            } => {
                validate_host_protocol_target("cancel", id.as_deref(), resource_id.as_deref())?;

                Ok(Self::Cancel {
                    id: validate_optional_host_identity(id)?,
                    resource_id: validate_optional_host_identity(resource_id)?,
                    timestamp,
                    trace_id: validate_host_identity(trace_id)?,
                })
            }
        }
    }
}

fn validate_host_identity(value: String) -> Result<String, &'static str> {
    validate_host_identity_ref(&value)?;
    Ok(value)
}

fn validate_host_identity_ref(value: &str) -> Result<(), &'static str> {
    if value.is_empty() {
        return Err("host protocol identity must be non-empty");
    }
    if value
        .chars()
        .any(|ch| matches!(ch, '\u{0000}'..='\u{001f}' | '\u{007f}'))
    {
        return Err("host protocol identity must not contain ASCII control characters");
    }
    Ok(())
}

fn validate_optional_host_identity(value: Option<String>) -> Result<Option<String>, &'static str> {
    value.map(validate_host_identity).transpose()
}

fn validate_optional_host_identity_ref(value: Option<&str>) -> Result<(), &'static str> {
    value
        .map(validate_host_identity_ref)
        .transpose()
        .map(|_| ())
}

fn validate_host_protocol_target(
    kind: &'static str,
    id: Option<&str>,
    resource_id: Option<&str>,
) -> Result<(), &'static str> {
    match (id, resource_id) {
        (None, None) => match kind {
            "stream" => Err("stream envelope requires id or resourceId"),
            "cancel" => Err("cancel envelope requires id or resourceId"),
            _ => Err("host protocol envelope requires id or resourceId"),
        },
        (Some(_), Some(_)) => match kind {
            "stream" => Err("stream envelope must not contain both id and resourceId"),
            "cancel" => Err("cancel envelope must not contain both id and resourceId"),
            _ => Err("host protocol envelope must not contain both id and resourceId"),
        },
        (Some(_), None) | (None, Some(_)) => Ok(()),
    }
}

fn validate_host_protocol_outcome(
    kind: &'static str,
    has_payload: bool,
    has_error: bool,
) -> Result<(), &'static str> {
    if has_payload && has_error {
        match kind {
            "response" => Err("response envelope must not contain both payload and error"),
            "stream" => Err("stream envelope must not contain both payload and error"),
            _ => Err("host protocol envelope must not contain both payload and error"),
        }
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ActivationRegistryActorKind, ActivationRegistryActorPayload,
        ActivationRegistryEventPayload, ActivationRegistryEventPhase,
        ActivationRegistryPermissionContextPayload, ActivationRegistrySource,
        ActivationRegistrySupportedPayload, ActivationRegistrySurfacePayload,
        AppActivationReasonPayload, AppBeforeQuitEventPayload, AppMetadataEnvironmentShapePayload,
        AppMetadataEventPayload, AppMetadataEventPhasePayload, AppMetadataInfoPayload,
        AppMetadataLaunchContextPayload, AppMetadataLaunchReasonPayload, AppMetadataPathsPayload,
        AppOpenFileEventPayload, AppOpenUrlEventPayload, AppQuitPayload, AppRestartPayload,
        AppSecondInstanceEventPayload, AppSingleInstancePayload, AssociationEventPayload,
        AssociationEventPhasePayload, AssociationFileAssociationPayload,
        AssociationFileAssociationsPayload, AssociationFileAssociationsResultPayload,
        AssociationProtocolPayload, AssociationProtocolStatusPayload, AttachmentIntakeEventPayload,
        AttachmentIntakeEventPhase, AttachmentIntakeState, AutostartEnablePayload,
        AutostartEventPayload, AutostartEventPhasePayload, AutostartMechanismPayload,
        AutostartStatusPayload, BrowsingDataClearPayload, BrowsingDataClearResultPayload,
        BrowsingDataEstimatePayload, BrowsingDataEstimateResultPayload,
        BrowsingDataListTypesPayload, BrowsingDataSupportedPayload,
        BrowsingDataTypeEstimatePayload, BrowsingDataTypePayload, CanonicalPathPayload,
        ClipboardCapabilityPayload, ClipboardHtmlPayload, ClipboardImagePayload,
        ClipboardIsSupportedPayload, ClipboardSupportedPayload, ClipboardTextPayload,
        ContextMenuActivatedEventPayload, CookieStoreCookiePayload, CookieStoreEventPayload,
        CookieStoreEventPhasePayload, CookieStoreGetPayload, CookieStoreGetResultPayload,
        CookieStoreRemovePayload, CookieStoreSetPayload, CookieStoreSupportedPayload,
        CrashReporterBreadcrumbPayload, CrashReporterFlushPayload, CrashReporterGetReportsPayload,
        CrashReporterReportPayload, CrashReporterStartPayload, DiagnosticsBundleCollectPayload,
        DiagnosticsBundleCollectResultPayload, DiagnosticsBundleRedactPayload,
        DiagnosticsBundleRedactResultPayload, DiagnosticsBundleRedactionEvidencePayload,
        DiagnosticsBundleRedactionPolicyPayload, DiagnosticsBundleSourceKind,
        DiagnosticsBundleSourceSummaryPayload, DiagnosticsBundleSupportedPayload,
        DiagnosticsBundleWritePayload, DiagnosticsBundleWriteResultPayload, DialogConfirmPayload,
        DialogConfirmResultPayload, DialogFileFilterPayload, DialogLevelPayload,
        DialogMessagePayload, DialogOpenDirectoryPayload, DialogOpenFilePayload,
        DialogOpenResultPayload, DialogSaveFilePayload, DialogSaveResultPayload,
        DisplayCaptureActorKind, DisplayCaptureActorPayload, DisplayCaptureEventPayload,
        DisplayCaptureEventPhase, DisplayCaptureGrantKind, DisplayCaptureGrantPayload,
        DisplayCaptureImagePayload, DisplayCaptureMetadataPayload, DisplayCaptureRegionPayload,
        DisplayCaptureRequestPayload, DisplayCaptureResultPayload, DisplayCaptureSource,
        DisplayCaptureSupportedPayload, DisplayCaptureTargetPayload,
        DistributionParityEventPayload, DistributionParityEventPhase,
        DistributionParityEvidenceKind, DistributionParityEvidencePayload,
        DistributionParitySupportedPayload, DistributionParityVerifyPayload,
        DistributionParityVerifyResultPayload, DockJumpListItemPayload, DockProgressState,
        DockSetJumpListPayload, DockSetProgressOptionsPayload, DockSetProgressPayload,
        DownloadEventPayload, DownloadEventPhasePayload, DownloadHandlePayload,
        DownloadListPayload, DownloadListResultPayload, DownloadResourcePayload,
        DownloadSnapshotPayload, DownloadStartPayload, DownloadStatePayload,
        DownloadSupportedPayload, EgressPolicyActorKind, EgressPolicyActorPayload,
        EgressPolicyDecisionPayload, EgressPolicyDecisionRecordedEventPayload,
        EgressPolicyDecisionResultPayload, EgressPolicyDestinationPayload, EgressPolicyOutcome,
        EgressPolicyProtocol, EgressPolicyRecordPayload, EgressPolicyRecordResultPayload,
        EgressPolicyRuleEffect, EgressPolicyRulePayload, EgressPolicySupportedPayload,
        ExecutionSandboxActorKind, ExecutionSandboxActorPayload,
        ExecutionSandboxBudgetPolicyPayload, ExecutionSandboxCleanupPolicyPayload,
        ExecutionSandboxCreatePayload, ExecutionSandboxEnvironmentEntryPayload,
        ExecutionSandboxEventPayload, ExecutionSandboxEventPhase,
        ExecutionSandboxFilesystemPolicyPayload, ExecutionSandboxNetworkPolicyPayload,
        ExecutionSandboxPolicyPayload, ExecutionSandboxRunPayload, ExecutionSandboxRunStatus,
        ExecutionSandboxSupportedPayload, ExtensionConfigActorKind, ExtensionConfigActorPayload,
        ExtensionConfigEventPayload, ExtensionConfigEventPhase, ExtensionConfigExportPolicy,
        ExtensionConfigFieldPayload, ExtensionConfigReadPayload,
        ExtensionConfigRedactResultPayload, ExtensionConfigRedactionEvidencePayload,
        ExtensionConfigResetResultPayload, ExtensionConfigSupportedPayload,
        ExtensionConfigValueEntryPayload, ExtensionConfigValueType, ExtensionConfigWritePayload,
        ExtensionPackageActorKind, ExtensionPackageActorPayload,
        ExtensionPackageCapabilityDeclarationPayload, ExtensionPackageCompatibilityPayload,
        ExtensionPackageEventPayload, ExtensionPackageEventPhase, ExtensionPackageInstallPayload,
        ExtensionPackageInstallResultPayload, ExtensionPackageManifestPayload,
        ExtensionPackageRemoveResultPayload, ExtensionPackageSourceKind,
        ExtensionPackageSourcePayload, ExtensionPackageSupportedPayload,
        ExtensionPackageUpdateResultPayload, FocusedApplicationContextEventPayload,
        FocusedApplicationContextEventPhase, FocusedApplicationContextSnapshotResultPayload,
        FocusedApplicationMetadataPayload, HostProtocolEnvelope, HostProtocolError,
        HostVersionPayload, JobControlPayload, JobEventPayload, JobEventPhase, JobGetPayload,
        JobHandlePayload, JobProgressPayload, JobProgressReportPayload, JobSnapshotPayload,
        JobStartPayload, JobState, JobSupportedPayload, LocalToolRuntimeActorKind,
        LocalToolRuntimeActorPayload, LocalToolRuntimeBudgetPolicyPayload,
        LocalToolRuntimeCleanupPolicyPayload, LocalToolRuntimeCommandPayload,
        LocalToolRuntimeCwdPolicyPayload, LocalToolRuntimeEnvironmentEntryPayload,
        LocalToolRuntimeEnvironmentPolicyPayload, LocalToolRuntimeEventPayload,
        LocalToolRuntimeEventPhase, LocalToolRuntimeFilesystemPolicyPayload,
        LocalToolRuntimeHealthCheckPayload, LocalToolRuntimeHealthResultPayload,
        LocalToolRuntimeHealthStatus, LocalToolRuntimeManifestPayload,
        LocalToolRuntimeNetworkPolicyPayload, LocalToolRuntimePolicyPayload,
        LocalToolRuntimeRegisterPayload, LocalToolRuntimeRegisterResultPayload,
        LocalToolRuntimeRunPayload, LocalToolRuntimeRunResultPayload, LocalToolRuntimeRunStatus,
        LocalToolRuntimeStdioMode, LocalToolRuntimeStdioPolicyPayload,
        LocalToolRuntimeStopResultPayload, LocalToolRuntimeSupportedPayload,
        MenuActivatedEventPayload, NativeFileSystemEntryKindPayload, NativeFileSystemEventPayload,
        NativeFileSystemEventPhasePayload, NativeFileSystemMetadataPayload,
        NativeFileSystemOpenModePayload, NativeFileSystemOpenPayload,
        NativeFileSystemOpenResultPayload, NativeFileSystemResourcePayload,
        NativeFileSystemStatPayload, NativeFileSystemStopWatchingPayload,
        NativeFileSystemStopWatchingResultPayload, NativeFileSystemSupportedPayload,
        NativeFileSystemWatchPayload, NativeFileSystemWatchResultPayload,
        NativeNetworkEventPayload, NativeNetworkEventPhasePayload, NativeNetworkFetchPayload,
        NativeNetworkFetchResultPayload, NativeNetworkHeaderPayload,
        NativeNetworkHttpMethodPayload, NativeNetworkLocalhostUrlPayload,
        NativeNetworkLocalhostUrlResultPayload, NativeNetworkRequestResourcePayload,
        NativeNetworkSupportedPayload, NativeNetworkUploadPayload,
        NativeNetworkUploadResultPayload, NativeNetworkWebSocketConnectPayload,
        NativeNetworkWebSocketHandlePayload, NativeNetworkWebSocketResourcePayload,
        NativeNetworkWebSocketSnapshotPayload, NativeNetworkWebSocketStatePayload,
        NetworkAuthCertificatePayload, NetworkAuthDecisionKindPayload, NetworkAuthDecisionPayload,
        NetworkAuthDecisionRecordPayload, NetworkAuthEventPayload, NetworkAuthEventPhasePayload,
        NetworkAuthHttpAuthPayload, NetworkAuthProxyModePayload, NetworkAuthProxyResultPayload,
        NetworkAuthSetProxyPayload, NetworkAuthSupportedPayload, NotificationActionEventPayload,
        NotificationActionPayload, NotificationClickEventPayload, NotificationPermissionPayload,
        NotificationPermissionStatePayload, NotificationResourcePayload, NotificationShowPayload,
        NotificationSupportedPayload, PowerMonitorIsSupportedPayload, PowerMonitorMethodPayload,
        PowerMonitorReasonEventPayload, PowerMonitorSourceChangedEventPayload,
        PowerMonitorSourcePayload, PowerMonitorSupportedPayload, ProtocolDenyPayload,
        ProtocolRegisterAppProtocolPayload, ProtocolServeAssetPayload, ProtocolServeRoutePayload,
        RealtimeMediaDeviceKind, RealtimeMediaDeviceStateEventPayload,
        RealtimeMediaDeviceStatePayload, RealtimeMediaInterruptionEventPayload,
        RealtimeMediaInterruptionReason, RealtimeMediaPermissionState,
        RealtimeMediaPermissionStateEventPayload, RealtimeMediaSessionIdentityPayload,
        RealtimeMediaSessionInterruptPayload, RealtimeMediaSessionSelectDevicePayload,
        RealtimeMediaSessionState, RealtimeMediaSessionStateEventPayload,
        RealtimeMediaSessionSupportedPayload, RecentDocumentPayload, RecentDocumentsAddPayload,
        RecentDocumentsEventPayload, RecentDocumentsEventPhasePayload,
        RecentDocumentsListResultPayload, RendererResumeDeniedPayload, RendererResumeDeniedReason,
        RendererResumePayload, RendererResumedPayload, ResidentLifecycleBackgroundAvailability,
        ResidentLifecycleDisablePayload, ResidentLifecycleEnablePayload,
        ResidentLifecycleEventPayload, ResidentLifecycleEventPhase, ResidentLifecyclePolicyPayload,
        ResidentLifecycleProcessPolicy, ResidentLifecycleStatePayload,
        ResidentLifecycleSupportedPayload, ResidentLifecycleWindowPolicy, ResumeTicket,
        SafeStorageKeyPayload, SafeStorageListResultPayload, SafeStorageSetPayload,
        ScopedAccessGrantEventPayload, ScopedAccessGrantEventPhase, ScopedAccessGrantState,
        ScreenBoundsPayload, ScreenDisplayPayload, ScreenDisplaysChangedEventPayload,
        ScreenDisplaysPayload, ScreenDisplaysResultPayload, ScreenIsSupportedPayload,
        ScreenPointPayload, ScreenSupportedPayload, SelectionContextDocumentKind,
        SelectionContextDocumentMetadataPayload, SelectionContextEventPayload,
        SessionPermissionDecidePayload, SessionPermissionDecisionPayload,
        SessionPermissionDecisionRecordPayload, SessionPermissionEventPayload,
        SessionPermissionEventPhasePayload, SessionPermissionKindPayload,
        SessionPermissionListPayload, SessionPermissionListResultPayload,
        SessionPermissionRequestPayload, SessionPermissionRequestResultPayload,
        SessionPermissionSupportedPayload, SessionProfileEventPayload,
        SessionProfileEventPhasePayload, SessionProfileFromPartitionPayload,
        SessionProfileHandlePayload, SessionProfileListPayload, SessionProfileResourcePayload,
        SessionProfileSupportedPayload, ShellOpenExternalPayload, ShellOpenPathPayload,
        ShellShowItemInFolderPayload, ShellTrashItemPayload, SystemAppearanceAccentColorPayload,
        SystemAppearanceBooleanPayload, SystemAppearanceChangedPayload,
        SystemAppearanceColorPayload, SystemAppearanceIsSupportedPayload,
        SystemAppearanceMethodPayload, SystemAppearanceModePayload, SystemAppearanceResultPayload,
        SystemAppearanceSupportedPayload, TransactionalFileMutationActorKind,
        TransactionalFileMutationActorPayload, TransactionalFileMutationCommitPayload,
        TransactionalFileMutationCommitResultPayload, TransactionalFileMutationDiffPayload,
        TransactionalFileMutationEventPayload, TransactionalFileMutationEventPhase,
        TransactionalFileMutationPreparePayload, TransactionalFileMutationPrepareResultPayload,
        TransactionalFileMutationRollbackPayload, TransactionalFileMutationRollbackResultPayload,
        TransactionalFileMutationState, TransactionalFileMutationSupportedPayload,
        TransientWindowDismissalPolicy, TransientWindowFocusPolicy,
        TransientWindowRestorationPolicy, TransientWindowRoleActorKind,
        TransientWindowRoleActorPayload, TransientWindowRoleEventPayload,
        TransientWindowRoleEventPhase, TransientWindowRoleKind, TransientWindowRoleOpenPayload,
        TransientWindowRolePlacementPayload, TransientWindowRolePointPayload,
        TransientWindowRolePolicyPayload, TransientWindowRoleSupportedPayload,
        TransientWindowZOrderPolicy, TrayActivatedEventPayload, TrayCreatePayload,
        TrayResourcePayload, TraySupportedPayload, UpdaterCheckPayload, UpdaterCheckResultPayload,
        UpdaterDownloadPayload, UpdaterInstallPayload, UpdaterPreparingRestartPayload,
        UpdaterStatusPayload, UpdaterStatusState, UpdaterTrustAnchorPayload,
        WebRequestActionPayload, WebRequestBeforeRequestPayload, WebRequestEventPayload,
        WebRequestEventPhasePayload, WebRequestHeaderPayload, WebRequestHeadersReceivedPayload,
        WebRequestInterceptorResourcePayload, WebRequestInterceptorSnapshotPayload,
        WebRequestPhasePayload, WebRequestRemoveListenerPayload, WebRequestSupportedPayload,
        WindowAttentionType, WindowBoundsEventPayload, WindowBoundsPayload,
        WindowCenterOnDisplayPayload, WindowClearVibrancyPayload, WindowCreatePayload,
        WindowCreateResponse, WindowDestroyPayload, WindowListResponse, WindowLookupResponse,
        WindowParentResponse, WindowProgressState, WindowRegistryEventPayload,
        WindowRegistryEventPhase, WindowRequestAttentionPayload, WindowSetAlwaysOnTopPayload,
        WindowSetBoundsOnDisplayPayload, WindowSetBoundsPayload, WindowSetDecorationsPayload,
        WindowSetFullscreenPayload, WindowSetProgressPayload, WindowSetResizablePayload,
        WindowSetShadowPayload, WindowSetSimpleFullscreenPayload, WindowSetSkipTaskbarPayload,
        WindowSetTitleBarStylePayload, WindowSetTitleBarTransparentPayload, WindowSetTitlePayload,
        WindowSetTrafficLightsPayload, WindowSetTransparentPayload, WindowSetVibrancyPayload,
        WindowStateEventPayload, WindowStatePayload, WindowTitleBarStyle, WindowTrafficLights,
        WorkspaceIndexActorKind, WorkspaceIndexActorPayload, WorkspaceIndexClosePayload,
        WorkspaceIndexCloseResultPayload, WorkspaceIndexEventPayload, WorkspaceIndexEventPhase,
        WorkspaceIndexIgnoreRulePayload, WorkspaceIndexOpenPayload,
        WorkspaceIndexOpenResultPayload, WorkspaceIndexRefreshPayload,
        WorkspaceIndexRefreshResultPayload, WorkspaceIndexScopePayload, WorkspaceIndexState,
        WorkspaceIndexSupportedPayload, CLIPBOARD_UNSUPPORTED_REASON,
        CRASH_REPORTER_UNSUPPORTED_REASON, DEFAULT_MAX_BACKFILL_EVENTS,
        DEFAULT_RECONNECT_WINDOW_MS, DIAGNOSTICS_BUNDLE_UNSUPPORTED_REASON,
        DISPLAY_CAPTURE_UNSUPPORTED_REASON, DISTRIBUTION_PARITY_UNSUPPORTED_REASON,
        EGRESS_POLICY_UNSUPPORTED_REASON, EXECUTION_SANDBOX_UNSUPPORTED_REASON,
        EXTENSION_CONFIG_UNSUPPORTED_REASON, EXTENSION_PACKAGE_UNSUPPORTED_REASON,
        HOST_PROTOCOL_ERROR_SPECS, JOB_UNSUPPORTED_REASON, LOCAL_TOOL_RUNTIME_UNSUPPORTED_REASON,
        NATIVE_FILE_SYSTEM_UNSUPPORTED_REASON, NOTIFICATION_UNSUPPORTED_REASON, PROTOCOL_VERSION,
        REALTIME_MEDIA_SESSION_UNSUPPORTED_REASON, TRANSACTIONAL_FILE_MUTATION_UNSUPPORTED_REASON,
        TRANSIENT_WINDOW_ROLE_UNSUPPORTED_REASON, TRAY_UNSUPPORTED_REASON,
        WORKSPACE_INDEX_UNSUPPORTED_REASON,
    };
    use std::{
        collections::{BTreeMap, BTreeSet},
        fs,
        path::PathBuf,
    };

    const FIXTURE_NAMES: &[&str] = &[
        "request.json",
        "response.json",
        "event.json",
        "renderer-disconnected-event.json",
        "renderer-resume-denied-event.json",
        "renderer-resume-request.json",
        "renderer-resumed-event.json",
        "stream.json",
        "cancel.json",
        "error-response.json",
    ];

    #[test]
    fn shared_fixtures_round_trip_to_canonical_json() {
        for fixture_name in FIXTURE_NAMES {
            let source = read_fixture(fixture_name);
            let envelope: HostProtocolEnvelope =
                serde_json::from_str(&source).expect("fixture should decode");

            assert_eq!(
                serde_json::to_string(&envelope).expect("fixture should encode"),
                source,
                "{fixture_name} should be canonical"
            );
        }
    }

    #[test]
    fn missing_request_id_is_rejected() {
        let error = serde_json::from_str::<HostProtocolEnvelope>(
            r#"{"kind":"request","method":"host.ping","timestamp":1710000000000,"traceId":"trace-missing"}"#,
        )
        .expect_err("request id is required");

        assert!(
            error.to_string().contains("missing field `id`"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn stream_requires_request_or_resource_target() {
        let error = serde_json::from_str::<HostProtocolEnvelope>(
            r#"{"kind":"stream","timestamp":1710000000000,"traceId":"trace-missing"}"#,
        )
        .expect_err("stream target is required");

        assert_eq!(
            error.to_string(),
            "stream envelope requires id or resourceId"
        );
    }

    #[test]
    fn cancel_requires_request_or_resource_target() {
        let error = serde_json::from_str::<HostProtocolEnvelope>(
            r#"{"kind":"cancel","timestamp":1710000000000,"traceId":"trace-missing"}"#,
        )
        .expect_err("cancel target is required");

        assert_eq!(
            error.to_string(),
            "cancel envelope requires id or resourceId"
        );
    }

    #[test]
    fn stream_rejects_ambiguous_request_and_resource_targets() {
        let error = serde_json::from_str::<HostProtocolEnvelope>(
            r#"{"kind":"stream","id":"request-1","resourceId":"resource-1","timestamp":1710000000000,"traceId":"trace-1"}"#,
        )
        .expect_err("stream target must not be ambiguous");

        assert_eq!(
            error.to_string(),
            "stream envelope must not contain both id and resourceId"
        );
    }

    #[test]
    fn cancel_rejects_ambiguous_request_and_resource_targets() {
        let error = serde_json::from_str::<HostProtocolEnvelope>(
            r#"{"kind":"cancel","id":"request-1","resourceId":"resource-1","timestamp":1710000000000,"traceId":"trace-1"}"#,
        )
        .expect_err("cancel target must not be ambiguous");

        assert_eq!(
            error.to_string(),
            "cancel envelope must not contain both id and resourceId"
        );
    }

    #[test]
    fn response_rejects_mixed_payload_and_error_outcomes() {
        let error = serde_json::from_str::<HostProtocolEnvelope>(
            r#"{"kind":"response","id":"request-1","timestamp":1710000000000,"traceId":"trace-1","payload":{"ok":true},"error":{"tag":"InvalidOutput","method":"fixture.operation","reason":"bad","message":"bad","operation":"fixture.operation","recoverable":false}}"#,
        )
        .expect_err("response outcome must not be ambiguous");

        assert_eq!(
            error.to_string(),
            "response envelope must not contain both payload and error"
        );
    }

    #[test]
    fn stream_rejects_mixed_payload_and_error_outcomes() {
        let error = serde_json::from_str::<HostProtocolEnvelope>(
            r#"{"kind":"stream","resourceId":"resource-1","timestamp":1710000000000,"traceId":"trace-1","payload":{"chunk":true},"error":{"tag":"InvalidOutput","method":"fixture.operation","reason":"bad","message":"bad","operation":"fixture.operation","recoverable":false}}"#,
        )
        .expect_err("stream outcome must not be ambiguous");

        assert_eq!(
            error.to_string(),
            "stream envelope must not contain both payload and error"
        );
    }

    #[test]
    fn app_payloads_encode_current_contract() {
        assert_eq!(
            serde_json::to_string(&AppQuitPayload::new(Some(0))).expect("quit should encode"),
            r#"{"exitCode":0}"#
        );
        assert_eq!(
            serde_json::to_string(&AppRestartPayload::new(Some(vec![
                "--restarted".to_string()
            ])))
            .expect("restart should encode"),
            r#"{"args":["--restarted"]}"#
        );
        assert_eq!(
            serde_json::to_string(&AppSingleInstancePayload::owned_by(1234))
                .expect("single instance should encode"),
            r#"{"acquired":false,"primaryPid":1234}"#
        );
    }

    #[test]
    fn app_payloads_reject_excess_fields_and_invalid_shapes() {
        let error = serde_json::from_str::<AppQuitPayload>(r#"{"exitCode":0,"force":true}"#)
            .expect_err("excess quit field should be rejected");
        assert!(error.to_string().contains("unknown field `force`"));

        let error = serde_json::from_str::<AppQuitPayload>(r#"{"exitCode":256}"#)
            .expect_err("exit code must be portable");
        assert!(error.to_string().contains("invalid value"));
    }

    #[test]
    fn app_event_payloads_encode_current_contract() {
        assert_eq!(
            serde_json::to_string(&AppSecondInstanceEventPayload::new(
                AppActivationReasonPayload::OpenFile,
                vec!["app".to_string()],
                "/repo",
                "trace-second"
            ))
            .expect("second instance event should encode"),
            r#"{"activationReason":"open-file","argv":["app"],"cwd":"/repo","traceId":"trace-second"}"#
        );
        let error = serde_json::from_str::<AppSecondInstanceEventPayload>(
            r#"{"argv":["app"],"cwd":"/repo","traceId":"trace-second"}"#,
        )
        .expect_err("activation reason should be required");
        assert!(error
            .to_string()
            .contains("missing field `activationReason`"));
        assert_eq!(
            serde_json::to_string(&AppOpenFileEventPayload::new("/tmp/README.md"))
                .expect("open file event should encode"),
            r#"{"path":"/tmp/README.md"}"#
        );
        assert_eq!(
            serde_json::to_string(&AppOpenUrlEventPayload::new("effect-desktop://open"))
                .expect("open url event should encode"),
            r#"{"url":"effect-desktop://open"}"#
        );
        assert_eq!(
            serde_json::to_string(&AppBeforeQuitEventPayload::new("trace-before-quit"))
                .expect("before quit event should encode"),
            r#"{"traceId":"trace-before-quit"}"#
        );
    }

    #[test]
    fn app_metadata_payloads_encode_current_contract() {
        assert_eq!(
            serde_json::to_string(&AppMetadataInfoPayload::new(
                "dev.effect-desktop.test",
                "ORIKA Test",
                "0.0.0"
            ))
            .expect("app metadata info should encode"),
            r#"{"id":"dev.effect-desktop.test","name":"ORIKA Test","version":"0.0.0"}"#
        );
        assert_eq!(
            serde_json::to_string(&AppMetadataPathsPayload::new(
                CanonicalPathPayload::new("/Applications/Test.app/Contents/MacOS/test"),
                CanonicalPathPayload::new("/Applications/Test.app/Contents/Resources"),
                CanonicalPathPayload::new("/repo")
            ))
            .expect("app metadata paths should encode"),
            r#"{"executable":{"path":"/Applications/Test.app/Contents/MacOS/test"},"resources":{"path":"/Applications/Test.app/Contents/Resources"},"cwd":{"path":"/repo"}}"#
        );
        assert_eq!(
            serde_json::to_string(&AppMetadataLaunchContextPayload::new(
                vec!["test".to_string(), "--safe-mode".to_string()],
                CanonicalPathPayload::new("/repo"),
                AppMetadataLaunchReasonPayload::Launch,
                AppMetadataEnvironmentShapePayload::new(vec!["PATH".to_string()])
            ))
            .expect("app metadata launch context should encode"),
            r#"{"argv":["test","--safe-mode"],"cwd":{"path":"/repo"},"reason":"launch","environment":{"variableNames":["PATH"]}}"#
        );
        assert_eq!(
            serde_json::to_string(&AppMetadataEventPayload::failed(
                "host-adapter-unimplemented"
            ))
            .expect("app metadata event should encode"),
            r#"{"phase":"failed","reason":"host-adapter-unimplemented"}"#
        );
    }

    #[test]
    fn app_metadata_payloads_reject_excess_fields_and_invalid_shapes() {
        let error = serde_json::from_str::<AppMetadataInfoPayload>(
            r#"{"id":"app","name":"App","version":"0.0.0","x":true}"#,
        )
        .expect_err("excess metadata info field should be rejected");
        assert!(error.to_string().contains("unknown field `x`"));

        let error = serde_json::from_str::<AppMetadataPathsPayload>(
            r#"{"executable":{"path":"/bin/app"},"resources":{"path":"/app/resources"},"cwd":{"path":"/repo"},"x":true}"#,
        )
        .expect_err("excess metadata paths field should be rejected");
        assert!(error.to_string().contains("unknown field `x`"));

        let error = serde_json::from_str::<AppMetadataLaunchContextPayload>(
            r#"{"argv":["app"],"cwd":{"path":"/repo"},"reason":"scheduled","environment":{"variableNames":["PATH"]}}"#,
        )
        .expect_err("unknown launch reason should be rejected");
        assert!(error.to_string().contains("unknown variant `scheduled`"));

        let error = serde_json::from_str::<AppMetadataEventPayload>(
            r#"{"phase":"changed","reason":"unexpected"}"#,
        )
        .expect_err("unknown metadata event phase should be rejected");
        assert!(error.to_string().contains("unknown variant `changed`"));
    }

    #[test]
    fn app_metadata_events_reject_inconsistent_phase_payloads() {
        for payload in [
            r#"{"phase":"info-read","reason":"host failed"}"#,
            r#"{"phase":"paths-read","reason":"host failed"}"#,
            r#"{"phase":"launch-context-read","reason":"host failed"}"#,
            r#"{"phase":"failed"}"#,
        ] {
            serde_json::from_str::<AppMetadataEventPayload>(payload)
                .expect_err("inconsistent app metadata event payload should be rejected");
        }

        for payload in [
            r#"{"phase":"info-read"}"#,
            r#"{"phase":"paths-read"}"#,
            r#"{"phase":"launch-context-read"}"#,
            r#"{"phase":"failed","reason":"host failed"}"#,
        ] {
            serde_json::from_str::<AppMetadataEventPayload>(payload)
                .expect("consistent app metadata event payload should decode");
        }
    }

    #[test]
    fn app_metadata_events_reject_inconsistent_phase_payloads_before_serializing() {
        for payload in [
            AppMetadataEventPayload::new_for_test(
                AppMetadataEventPhasePayload::InfoRead,
                Some("host failed".to_string()),
            ),
            AppMetadataEventPayload::new_for_test(
                AppMetadataEventPhasePayload::PathsRead,
                Some("host failed".to_string()),
            ),
            AppMetadataEventPayload::new_for_test(
                AppMetadataEventPhasePayload::LaunchContextRead,
                Some("host failed".to_string()),
            ),
            AppMetadataEventPayload::new_for_test(AppMetadataEventPhasePayload::Failed, None),
        ] {
            serde_json::to_string(&payload)
                .expect_err("inconsistent app metadata event payload should not encode");
        }
    }

    #[test]
    fn association_payloads_encode_current_contract() {
        assert_eq!(
            serde_json::to_string(&AssociationProtocolPayload::new("example"))
                .expect("protocol input should encode"),
            r#"{"scheme":"example"}"#
        );
        assert_eq!(
            serde_json::to_string(&AssociationProtocolStatusPayload::new("example", false))
                .expect("protocol status should encode"),
            r#"{"scheme":"example","isDefault":false}"#
        );
        assert_eq!(
            serde_json::to_string(&AssociationFileAssociationsPayload::new(Some(vec![
                ".txt".to_string()
            ])))
            .expect("file association input should encode"),
            r#"{"extensions":[".txt"]}"#
        );
        assert_eq!(
            serde_json::to_string(&AssociationFileAssociationsResultPayload::new(vec![
                AssociationFileAssociationPayload::new(".txt", false)
            ]))
            .expect("file association result should encode"),
            r#"{"associations":[{"extension":".txt","isDefault":false}]}"#
        );
        assert_eq!(
            serde_json::to_string(&AssociationEventPayload::failed(
                "host-adapter-unimplemented"
            ))
            .expect("association event should encode"),
            r#"{"phase":"failed","reason":"host-adapter-unimplemented"}"#
        );
    }

    #[test]
    fn association_payloads_reject_excess_fields() {
        let error =
            serde_json::from_str::<AssociationProtocolPayload>(r#"{"scheme":"example","x":true}"#)
                .expect_err("excess association field should be rejected");
        assert!(error.to_string().contains("unknown field `x`"));

        let error = serde_json::from_str::<AssociationEventPayload>(
            r#"{"phase":"changed","reason":"unexpected"}"#,
        )
        .expect_err("unknown association event phase should be rejected");
        assert!(error.to_string().contains("unknown variant `changed`"));
    }

    #[test]
    fn association_events_reject_inconsistent_phase_payloads() {
        for payload in [
            r#"{"phase":"protocol-checked","reason":"host failed"}"#,
            r#"{"phase":"protocol-updated","reason":"host failed"}"#,
            r#"{"phase":"file-associations-checked","reason":"host failed"}"#,
            r#"{"phase":"failed"}"#,
        ] {
            serde_json::from_str::<AssociationEventPayload>(payload)
                .expect_err("inconsistent association event payload should be rejected");
        }

        for payload in [
            r#"{"phase":"protocol-checked"}"#,
            r#"{"phase":"protocol-updated"}"#,
            r#"{"phase":"file-associations-checked"}"#,
            r#"{"phase":"failed","reason":"host failed"}"#,
        ] {
            serde_json::from_str::<AssociationEventPayload>(payload)
                .expect("consistent association event payload should decode");
        }
    }

    #[test]
    fn association_events_reject_inconsistent_phase_payloads_before_serializing() {
        for payload in [
            AssociationEventPayload::new_for_test(
                AssociationEventPhasePayload::ProtocolChecked,
                Some("host failed".to_string()),
            ),
            AssociationEventPayload::new_for_test(
                AssociationEventPhasePayload::ProtocolUpdated,
                Some("host failed".to_string()),
            ),
            AssociationEventPayload::new_for_test(
                AssociationEventPhasePayload::FileAssociationsChecked,
                Some("host failed".to_string()),
            ),
            AssociationEventPayload::new_for_test(AssociationEventPhasePayload::Failed, None),
        ] {
            serde_json::to_string(&payload)
                .expect_err("inconsistent association event payload should not encode");
        }
    }

    #[test]
    fn recent_documents_payloads_encode_current_contract() {
        assert_eq!(
            serde_json::to_string(&RecentDocumentsAddPayload::new(CanonicalPathPayload::new(
                "/tmp/report.txt"
            )))
            .expect("recent document add should encode"),
            r#"{"path":{"path":"/tmp/report.txt"}}"#
        );
        assert_eq!(
            serde_json::to_string(&RecentDocumentsListResultPayload::new(vec![
                RecentDocumentPayload::new(CanonicalPathPayload::new("/tmp/report.txt"))
            ]))
            .expect("recent document list should encode"),
            r#"{"documents":[{"path":{"path":"/tmp/report.txt"}}]}"#
        );
        assert_eq!(
            serde_json::to_string(&RecentDocumentsEventPayload::new(
                RecentDocumentsEventPhasePayload::DocumentAdded,
                Some(CanonicalPathPayload::new("/tmp/report.txt")),
                None,
            ))
            .expect("recent document event should encode"),
            r#"{"phase":"document-added","path":{"path":"/tmp/report.txt"}}"#
        );
    }

    #[test]
    fn recent_documents_payloads_reject_excess_fields() {
        let error = serde_json::from_str::<RecentDocumentsAddPayload>(
            r#"{"path":{"path":"/tmp/report.txt"},"x":true}"#,
        )
        .expect_err("excess recent document field should be rejected");
        assert!(error.to_string().contains("unknown field `x`"));

        let error = serde_json::from_str::<RecentDocumentsEventPayload>(
            r#"{"phase":"changed","reason":"unexpected"}"#,
        )
        .expect_err("unknown recent document event phase should be rejected");
        assert!(error.to_string().contains("unknown variant `changed`"));
    }

    #[test]
    fn recent_documents_events_reject_inconsistent_phase_payloads() {
        for source in [
            r#"{"phase":"document-added"}"#,
            r#"{"phase":"document-added","reason":"host-failed"}"#,
            r#"{"phase":"cleared","path":{"path":"/tmp/report.txt"}}"#,
            r#"{"phase":"cleared","reason":"host-failed"}"#,
            r#"{"phase":"failed"}"#,
            r#"{"phase":"failed","path":{"path":"/tmp/report.txt"},"reason":"host-failed"}"#,
        ] {
            let error = serde_json::from_str::<RecentDocumentsEventPayload>(source)
                .expect_err("inconsistent recent documents event should be rejected");
            assert!(
                error.to_string().contains("document-added")
                    || error.to_string().contains("cleared")
                    || error.to_string().contains("failed")
                    || error.to_string().contains("phase"),
                "unexpected error: {error}"
            );
        }
    }

    #[test]
    fn recent_documents_events_reject_inconsistent_phase_payloads_before_serializing() {
        for event in [
            RecentDocumentsEventPayload::new(
                RecentDocumentsEventPhasePayload::DocumentAdded,
                None,
                None,
            ),
            RecentDocumentsEventPayload::new(
                RecentDocumentsEventPhasePayload::DocumentAdded,
                None,
                Some("host-failed".to_string()),
            ),
            RecentDocumentsEventPayload::new(
                RecentDocumentsEventPhasePayload::Cleared,
                Some(CanonicalPathPayload::new("/tmp/report.txt")),
                None,
            ),
            RecentDocumentsEventPayload::new(
                RecentDocumentsEventPhasePayload::Cleared,
                None,
                Some("host-failed".to_string()),
            ),
            RecentDocumentsEventPayload::new(RecentDocumentsEventPhasePayload::Failed, None, None),
            RecentDocumentsEventPayload::new(
                RecentDocumentsEventPhasePayload::Failed,
                Some(CanonicalPathPayload::new("/tmp/report.txt")),
                Some("host-failed".to_string()),
            ),
        ] {
            let error = serde_json::to_string(&event)
                .expect_err("inconsistent recent documents event should not encode");
            assert!(
                error.to_string().contains("document-added")
                    || error.to_string().contains("cleared")
                    || error.to_string().contains("failed")
                    || error.to_string().contains("phase"),
                "unexpected error: {error}"
            );
        }
    }

    #[test]
    fn native_file_system_payloads_encode_current_contract() {
        assert_eq!(
            serde_json::to_string(&NativeFileSystemOpenPayload::new(
                CanonicalPathPayload::new("/tmp/report.txt"),
                Some(NativeFileSystemOpenModePayload::Read),
                Some("handle-1".to_string()),
            ))
            .expect("native filesystem open should encode"),
            r#"{"path":{"path":"/tmp/report.txt"},"mode":"read","handleId":"handle-1"}"#
        );
        assert_eq!(
            serde_json::to_string(&NativeFileSystemStatPayload::new(
                CanonicalPathPayload::new("/tmp/report.txt")
            ))
            .expect("native filesystem stat should encode"),
            r#"{"path":{"path":"/tmp/report.txt"}}"#
        );
        assert_eq!(
            serde_json::to_string(&NativeFileSystemWatchPayload::new(
                CanonicalPathPayload::new("/tmp"),
                Some(true),
                Some("watch-1".to_string()),
                Some("workspace:workspace-1".to_string()),
            ))
            .expect("native filesystem watch should encode"),
            r#"{"path":{"path":"/tmp"},"recursive":true,"watchId":"watch-1","ownerScope":"workspace:workspace-1"}"#
        );
        assert_eq!(
            serde_json::to_string(&NativeFileSystemStopWatchingPayload::new("watch-1"))
                .expect("native filesystem stop watch should encode"),
            r#"{"watchId":"watch-1"}"#
        );
        assert_eq!(
            serde_json::to_string(&NativeFileSystemOpenResultPayload::new(
                NativeFileSystemResourcePayload::handle(
                    "handle-1",
                    0,
                    "native-file-system:handle-1",
                ),
                NativeFileSystemMetadataPayload::new(
                    CanonicalPathPayload::new("/tmp/report.txt"),
                    NativeFileSystemEntryKindPayload::File,
                ),
            ))
            .expect("native filesystem open result should encode"),
            r#"{"handle":{"kind":"native-file-system-handle","id":"handle-1","generation":0,"ownerScope":"native-file-system:handle-1","state":"open"},"metadata":{"path":{"path":"/tmp/report.txt"},"kind":"file"}}"#
        );
        assert_eq!(
            serde_json::to_string(&NativeFileSystemWatchResultPayload::new(
                NativeFileSystemResourcePayload::watch("watch-1", 0, "workspace:workspace-1"),
                CanonicalPathPayload::new("/tmp"),
                true,
            ))
            .expect("native filesystem watch result should encode"),
            r#"{"watch":{"kind":"native-file-system-watch","id":"watch-1","generation":0,"ownerScope":"workspace:workspace-1","state":"open"},"path":{"path":"/tmp"},"recursive":true}"#
        );
        assert_eq!(
            serde_json::to_string(&NativeFileSystemStopWatchingResultPayload::new(
                "watch-1", true,
            ))
            .expect("native filesystem stop result should encode"),
            r#"{"watchId":"watch-1","stopped":true}"#
        );
        assert_eq!(
            serde_json::to_string(&NativeFileSystemSupportedPayload::unsupported(
                NATIVE_FILE_SYSTEM_UNSUPPORTED_REASON,
            ))
            .expect("native filesystem support should encode"),
            r#"{"supported":false,"reason":"host-adapter-unimplemented"}"#
        );
        assert_eq!(
            serde_json::to_string(&NativeFileSystemEventPayload::failed(
                1710000000000,
                "watch-1",
                "host-adapter-unimplemented",
            ))
            .expect("native filesystem event should encode"),
            r#"{"type":"native-file-system-event","timestamp":1710000000000,"watchId":"watch-1","phase":"failed","reason":"host-adapter-unimplemented"}"#
        );
    }

    #[test]
    fn native_file_system_payloads_reject_excess_fields() {
        let error = serde_json::from_str::<NativeFileSystemOpenPayload>(
            r#"{"path":{"path":"/tmp/report.txt"},"x":true}"#,
        )
        .expect_err("excess native filesystem field should be rejected");
        assert!(error.to_string().contains("unknown field `x`"));

        let error = serde_json::from_str::<NativeFileSystemWatchPayload>(
            r#"{"path":{"path":"/tmp"},"recursive":true,"unknown":true}"#,
        )
        .expect_err("excess native filesystem watch field should be rejected");
        assert!(error.to_string().contains("unknown field `unknown`"));

        let error = serde_json::from_str::<NativeFileSystemEventPayload>(
            r#"{"type":"native-file-system-event","timestamp":1710000000000,"phase":"started"}"#,
        )
        .expect_err("unknown native filesystem event phase should be rejected");
        assert!(error.to_string().contains("unknown variant `started`"));
    }

    #[test]
    fn native_file_system_events_reject_inconsistent_phase_payloads() {
        for source in [
            r#"{"type":"native-file-system-event","timestamp":1710000000100,"phase":"watch-started","watchId":"watch-1"}"#,
            r#"{"type":"native-file-system-event","timestamp":1710000000100,"phase":"changed"}"#,
            r#"{"type":"native-file-system-event","timestamp":1710000000100,"phase":"removed","watchId":"watch-1","path":{"path":"/tmp/report.txt"},"reason":"not a failure"}"#,
            r#"{"type":"native-file-system-event","timestamp":1710000000100,"phase":"failed","watchId":"watch-1"}"#,
            r#"{"type":"native-file-system-event","timestamp":1710000000100,"phase":"watch-stopped","watchId":"watch-1","path":{"path":"/tmp/report.txt"},"reason":"not a failure"}"#,
        ] {
            let error = serde_json::from_str::<NativeFileSystemEventPayload>(source)
                .expect_err("inconsistent native filesystem event should be rejected");
            assert!(
                error.to_string().contains("watch")
                    || error.to_string().contains("path")
                    || error.to_string().contains("reason")
                    || error.to_string().contains("phase"),
                "unexpected error: {error}"
            );
        }
    }

    #[test]
    fn native_file_system_events_reject_inconsistent_phase_payloads_before_serializing() {
        for event in [
            NativeFileSystemEventPayload::new_for_test(
                1_710_000_000_100,
                NativeFileSystemEventPhasePayload::WatchStarted,
            )
            .with_watch_id_for_test("watch-1"),
            NativeFileSystemEventPayload::new_for_test(
                1_710_000_000_100,
                NativeFileSystemEventPhasePayload::Changed,
            ),
            NativeFileSystemEventPayload::new_for_test(
                1_710_000_000_100,
                NativeFileSystemEventPhasePayload::Removed,
            )
            .with_watch_id_for_test("watch-1")
            .with_path_for_test(CanonicalPathPayload::new("/tmp/report.txt"))
            .with_reason_for_test("not a failure"),
            NativeFileSystemEventPayload::new_for_test(
                1_710_000_000_100,
                NativeFileSystemEventPhasePayload::Failed,
            )
            .with_watch_id_for_test("watch-1"),
            NativeFileSystemEventPayload::new_for_test(
                1_710_000_000_100,
                NativeFileSystemEventPhasePayload::WatchStopped,
            )
            .with_watch_id_for_test("watch-1")
            .with_path_for_test(CanonicalPathPayload::new("/tmp/report.txt"))
            .with_reason_for_test("not a failure"),
        ] {
            let error = serde_json::to_string(&event)
                .expect_err("inconsistent native filesystem event should not encode");
            assert!(
                error.to_string().contains("watch")
                    || error.to_string().contains("path")
                    || error.to_string().contains("reason")
                    || error.to_string().contains("phase"),
                "unexpected error: {error}"
            );
        }
    }

    #[test]
    fn autostart_payloads_encode_current_contract() {
        assert_eq!(
            serde_json::to_string(&AutostartEnablePayload::new(Some(vec![
                "--hidden".to_string()
            ])))
            .expect("autostart enable should encode"),
            r#"{"args":["--hidden"]}"#
        );
        assert_eq!(
            serde_json::to_string(&AutostartStatusPayload::new(
                true,
                AutostartMechanismPayload::LinuxXdgAutostart,
            ))
            .expect("autostart status should encode"),
            r#"{"enabled":true,"mechanism":"linux-xdg-autostart"}"#
        );
        assert_eq!(
            serde_json::to_string(&AutostartEventPayload::new(
                AutostartEventPhasePayload::Failed,
                Some(AutostartMechanismPayload::Unsupported),
                Some("host-adapter-unimplemented".to_string()),
            ))
            .expect("autostart event should encode"),
            r#"{"phase":"failed","mechanism":"unsupported","reason":"host-adapter-unimplemented"}"#
        );
    }

    #[test]
    fn autostart_payloads_reject_excess_fields() {
        let error =
            serde_json::from_str::<AutostartEnablePayload>(r#"{"args":["--hidden"],"x":true}"#)
                .expect_err("excess autostart field should be rejected");
        assert!(error.to_string().contains("unknown field `x`"));

        let error = serde_json::from_str::<AutostartEventPayload>(
            r#"{"phase":"changed","reason":"unexpected"}"#,
        )
        .expect_err("unknown autostart event phase should be rejected");
        assert!(error.to_string().contains("unknown variant `changed`"));
    }

    #[test]
    fn autostart_events_reject_inconsistent_phase_payloads() {
        for payload in [
            r#"{"phase":"checked"}"#,
            r#"{"phase":"enabled"}"#,
            r#"{"phase":"disabled","mechanism":"linux-xdg-autostart","reason":"host failed"}"#,
            r#"{"phase":"failed"}"#,
        ] {
            serde_json::from_str::<AutostartEventPayload>(payload)
                .expect_err("inconsistent autostart event payload should be rejected");
        }

        for payload in [
            r#"{"phase":"checked","mechanism":"linux-xdg-autostart"}"#,
            r#"{"phase":"enabled","mechanism":"linux-xdg-autostart"}"#,
            r#"{"phase":"disabled","mechanism":"linux-xdg-autostart"}"#,
            r#"{"phase":"failed","mechanism":"unsupported","reason":"host-adapter-unavailable"}"#,
            r#"{"phase":"failed","reason":"host-adapter-unavailable"}"#,
        ] {
            serde_json::from_str::<AutostartEventPayload>(payload)
                .expect("consistent autostart event payload should decode");
        }
    }

    #[test]
    fn autostart_events_reject_inconsistent_phase_payloads_before_serializing() {
        for payload in [
            AutostartEventPayload {
                phase: AutostartEventPhasePayload::Checked,
                mechanism: None,
                reason: None,
            },
            AutostartEventPayload {
                phase: AutostartEventPhasePayload::Enabled,
                mechanism: Some(AutostartMechanismPayload::LinuxXdgAutostart),
                reason: Some("host failed".to_string()),
            },
            AutostartEventPayload {
                phase: AutostartEventPhasePayload::Failed,
                mechanism: None,
                reason: None,
            },
        ] {
            serde_json::to_string(&payload)
                .expect_err("inconsistent autostart event payload should not encode");
        }
    }

    #[test]
    fn envelope_excess_fields_are_rejected() {
        let error = serde_json::from_str::<HostProtocolEnvelope>(
            r#"{"kind":"request","id":"request-1","method":"host.ping","timestamp":1710000000000,"traceId":"trace-1","error":{"tag":"Internal","message":"extra"}}"#,
        )
        .expect_err("unknown envelope fields must fail");

        assert!(
            error.to_string().contains("unknown field `error`"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn host_protocol_error_excess_fields_are_rejected() {
        let error = serde_json::from_str::<HostProtocolError>(
            r#"{"tag":"FileNotFound","path":"/tmp/missing.txt","message":"FileNotFound sample","operation":"fixture.operation","recoverable":false,"unexpected":true}"#,
        )
        .expect_err("unknown error fields must fail");

        assert!(
            error.to_string().contains("unknown field `unexpected`"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn host_protocol_error_platform_is_closed() {
        let error = serde_json::from_str::<HostProtocolError>(
            r#"{"tag":"FileNotFound","path":"/tmp/missing.txt","message":"FileNotFound sample","operation":"fixture.operation","platform":"solaris","recoverable":false}"#,
        )
        .expect_err("unknown platforms must fail");

        assert!(
            error.to_string().contains("unknown variant `solaris`"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn host_protocol_error_recoverable_defaults_come_from_specs() {
        for spec in HOST_PROTOCOL_ERROR_SPECS {
            assert_eq!(
                HostProtocolError::recoverable_default(spec.tag),
                Some(spec.recoverable),
                "{} recoverable default should come from the spec manifest",
                spec.tag
            );
        }
    }

    #[test]
    fn host_protocol_error_fixtures_match_closed_registry() {
        let source = read_fixture("errors.json");
        let errors =
            serde_json::from_str::<Vec<HostProtocolError>>(&source).expect("errors should decode");

        assert_eq!(
            serde_json::to_string(&errors).expect("errors should encode"),
            source,
            "errors.json should be canonical"
        );

        let fixture_tags = errors
            .iter()
            .map(HostProtocolError::tag)
            .collect::<Vec<_>>();
        let spec_tags = HOST_PROTOCOL_ERROR_SPECS
            .iter()
            .map(|spec| spec.tag)
            .collect::<Vec<_>>();

        assert_eq!(fixture_tags, spec_tags);
        assert_eq!(
            fixture_tags.iter().copied().collect::<BTreeSet<_>>().len(),
            fixture_tags.len(),
            "error fixtures should not contain duplicate tags"
        );

        for error in errors {
            assert_eq!(
                error.recoverable(),
                HostProtocolError::recoverable_default(error.tag()).expect("fixture tag is known"),
                "{} recoverable field should match registry default",
                error.tag()
            );
        }
    }

    #[test]
    fn stream_requires_request_or_resource_target_before_serializing() {
        let envelope = HostProtocolEnvelope::Stream {
            id: None,
            resource_id: None,
            timestamp: 1710000000000,
            trace_id: "trace-missing".to_string(),
            payload: None,
            error: None,
        };

        let error = serde_json::to_string(&envelope).expect_err("stream target is required");

        assert_eq!(
            error.to_string(),
            "stream envelope requires id or resourceId"
        );
    }

    #[test]
    fn cancel_requires_request_or_resource_target_before_serializing() {
        let envelope = HostProtocolEnvelope::Cancel {
            id: None,
            resource_id: None,
            timestamp: 1710000000000,
            trace_id: "trace-missing".to_string(),
        };

        let error = serde_json::to_string(&envelope).expect_err("cancel target is required");

        assert_eq!(
            error.to_string(),
            "cancel envelope requires id or resourceId"
        );
    }

    #[test]
    fn stream_rejects_ambiguous_request_and_resource_targets_before_serializing() {
        let envelope = HostProtocolEnvelope::Stream {
            id: Some("request-1".to_string()),
            resource_id: Some("resource-1".to_string()),
            timestamp: 1710000000000,
            trace_id: "trace-1".to_string(),
            payload: None,
            error: None,
        };

        let error = serde_json::to_string(&envelope).expect_err("stream target is ambiguous");

        assert_eq!(
            error.to_string(),
            "stream envelope must not contain both id and resourceId"
        );
    }

    #[test]
    fn cancel_rejects_ambiguous_request_and_resource_targets_before_serializing() {
        let envelope = HostProtocolEnvelope::Cancel {
            id: Some("request-1".to_string()),
            resource_id: Some("resource-1".to_string()),
            timestamp: 1710000000000,
            trace_id: "trace-1".to_string(),
        };

        let error = serde_json::to_string(&envelope).expect_err("cancel target is ambiguous");

        assert_eq!(
            error.to_string(),
            "cancel envelope must not contain both id and resourceId"
        );
    }

    #[test]
    fn response_rejects_mixed_payload_and_error_outcomes_before_serializing() {
        let envelope = HostProtocolEnvelope::Response {
            id: "request-1".to_string(),
            timestamp: 1710000000000,
            trace_id: "trace-1".to_string(),
            payload: Some(serde_json::json!({ "ok": true })),
            error: Some(HostProtocolError::invalid_output(
                "fixture.operation",
                "bad",
            )),
        };

        let error = serde_json::to_string(&envelope).expect_err("response outcome is ambiguous");

        assert_eq!(
            error.to_string(),
            "response envelope must not contain both payload and error"
        );
    }

    #[test]
    fn stream_rejects_mixed_payload_and_error_outcomes_before_serializing() {
        let envelope = HostProtocolEnvelope::Stream {
            id: None,
            resource_id: Some("resource-1".to_string()),
            timestamp: 1710000000000,
            trace_id: "trace-1".to_string(),
            payload: Some(serde_json::json!({ "chunk": true })),
            error: Some(HostProtocolError::invalid_output(
                "fixture.operation",
                "bad",
            )),
        };

        let error = serde_json::to_string(&envelope).expect_err("stream outcome is ambiguous");

        assert_eq!(
            error.to_string(),
            "stream envelope must not contain both payload and error"
        );
    }

    #[test]
    fn host_protocol_envelopes_reject_invalid_identity_fields_before_serializing() {
        for envelope in [
            HostProtocolEnvelope::Response {
                id: String::new(),
                timestamp: 1710000000000,
                trace_id: "trace-1".to_string(),
                payload: None,
                error: None,
            },
            HostProtocolEnvelope::Stream {
                id: None,
                resource_id: Some("resource\nforged".to_string()),
                timestamp: 1710000000000,
                trace_id: "trace-1".to_string(),
                payload: None,
                error: None,
            },
            HostProtocolEnvelope::Cancel {
                id: Some("request\nforged".to_string()),
                resource_id: None,
                timestamp: 1710000000000,
                trace_id: "trace-1".to_string(),
            },
        ] {
            let error =
                serde_json::to_string(&envelope).expect_err("invalid identity should not encode");
            assert!(
                error.to_string().contains("host protocol identity must"),
                "unexpected error: {error}"
            );
        }
    }

    #[test]
    fn host_protocol_envelopes_reject_control_identity_fields() {
        for source in [
            r#"{"kind":"request","id":"request\nforged","method":"host.ping","timestamp":1710000000000,"traceId":"trace-1"}"#,
            r#"{"kind":"request","id":"request-1","method":"host.ping","timestamp":1710000000000,"traceId":"trace\nforged"}"#,
            r#"{"kind":"request","id":"request-1","method":"host.ping","timestamp":1710000000000,"traceId":"trace-1","windowId":"main\nforged"}"#,
            r#"{"kind":"request","id":"request-1","method":"host.ping","timestamp":1710000000000,"traceId":"trace-1","originToken":"origin\nforged"}"#,
            r#"{"kind":"response","id":"request\u0000forged","timestamp":1710000000000,"traceId":"trace-1"}"#,
            r#"{"kind":"response","id":"request-1","timestamp":1710000000000,"traceId":"trace\u0000forged"}"#,
            r#"{"kind":"stream","id":"request\nforged","timestamp":1710000000000,"traceId":"trace-1"}"#,
            r#"{"kind":"stream","resourceId":"resource\u0000forged","timestamp":1710000000000,"traceId":"trace-1"}"#,
            r#"{"kind":"cancel","id":"request\nforged","timestamp":1710000000000,"traceId":"trace-1"}"#,
            r#"{"kind":"cancel","resourceId":"resource\u0000forged","timestamp":1710000000000,"traceId":"trace-1"}"#,
        ] {
            let error = serde_json::from_str::<HostProtocolEnvelope>(source)
                .expect_err("identity controls should be rejected");
            assert!(error
                .to_string()
                .contains("must not contain ASCII control characters"));
        }
    }

    #[test]
    fn host_protocol_envelopes_reject_empty_identity_fields() {
        for source in [
            r#"{"kind":"request","id":"","method":"host.ping","timestamp":1710000000000,"traceId":"trace-1"}"#,
            r#"{"kind":"request","id":"request-1","method":"host.ping","timestamp":1710000000000,"traceId":""}"#,
            r#"{"kind":"response","id":"","timestamp":1710000000000,"traceId":"trace-1"}"#,
            r#"{"kind":"stream","id":"","timestamp":1710000000000,"traceId":"trace-1"}"#,
            r#"{"kind":"stream","resourceId":"","timestamp":1710000000000,"traceId":"trace-1"}"#,
            r#"{"kind":"cancel","id":"","timestamp":1710000000000,"traceId":"trace-1"}"#,
            r#"{"kind":"cancel","resourceId":"","timestamp":1710000000000,"traceId":"trace-1"}"#,
        ] {
            let error = serde_json::from_str::<HostProtocolEnvelope>(source)
                .expect_err("empty identities should be rejected");
            assert!(
                error
                    .to_string()
                    .contains("host protocol identity must be non-empty"),
                "unexpected error: {error}"
            );
        }
    }

    #[test]
    fn host_protocol_error_tags_are_closed() {
        let error = serde_json::from_str::<HostProtocolError>(
            r#"{"tag":"NotARealError","message":"not real"}"#,
        )
        .expect_err("unknown tags must fail");

        assert!(
            error
                .to_string()
                .contains("unknown variant `NotARealError`"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn host_version_payload_serializes_canonically() {
        let payload = HostVersionPayload::current();

        assert_eq!(payload.protocol_version(), PROTOCOL_VERSION);
        assert_eq!(
            serde_json::to_string(&payload).expect("version payload should encode"),
            format!(r#"{{"protocolVersion":"{PROTOCOL_VERSION}"}}"#)
        );
    }

    #[test]
    fn dialog_payloads_serialize_canonically() {
        let filter = DialogFileFilterPayload::new("Text", vec!["txt".to_string()]);
        assert_eq!(filter.name(), "Text");
        assert_eq!(filter.extensions(), ["txt"]);

        let open_file = DialogOpenFilePayload::new()
            .with_title("Open")
            .with_default_path("/tmp/input.txt")
            .with_filters(vec![filter.clone()])
            .with_multiple(true);
        assert_eq!(open_file.title(), Some("Open"));
        assert_eq!(open_file.default_path(), Some("/tmp/input.txt"));
        assert!(open_file.multiple());
        assert_eq!(
            serde_json::to_string(&open_file).expect("open file should encode"),
            r#"{"title":"Open","defaultPath":"/tmp/input.txt","filters":[{"name":"Text","extensions":["txt"]}],"multiple":true}"#
        );

        let open_directory = DialogOpenDirectoryPayload::new()
            .with_title("Directory")
            .with_default_path("/tmp")
            .with_multiple(true);
        assert_eq!(open_directory.title(), Some("Directory"));
        assert_eq!(
            serde_json::to_string(&open_directory).expect("open directory should encode"),
            r#"{"title":"Directory","defaultPath":"/tmp","multiple":true}"#
        );

        let save_file = DialogSaveFilePayload::new()
            .with_title("Save")
            .with_default_path("/tmp/report.md")
            .with_filters(vec![filter]);
        assert_eq!(save_file.default_path(), Some("/tmp/report.md"));
        assert_eq!(
            serde_json::to_string(&save_file).expect("save file should encode"),
            r#"{"title":"Save","defaultPath":"/tmp/report.md","filters":[{"name":"Text","extensions":["txt"]}]}"#
        );

        let message = DialogMessagePayload::new(DialogLevelPayload::Warning, "Check input")
            .with_detail("Details");
        assert_eq!(message.level(), DialogLevelPayload::Warning);
        assert_eq!(message.message(), "Check input");
        assert_eq!(
            serde_json::to_string(&message).expect("message should encode"),
            r#"{"level":"warning","message":"Check input","detail":"Details"}"#
        );

        let confirm = DialogConfirmPayload::new("Proceed?")
            .with_title("Confirm")
            .with_labels("Yes", "No");
        assert_eq!(confirm.confirm_label(), Some("Yes"));
        assert_eq!(
            serde_json::to_string(&confirm).expect("confirm should encode"),
            r#"{"title":"Confirm","message":"Proceed?","confirmLabel":"Yes","cancelLabel":"No"}"#
        );

        let open_result =
            DialogOpenResultPayload::new(vec!["/tmp/a.txt".to_string(), "/tmp/b.txt".to_string()]);
        assert_eq!(open_result.paths(), ["/tmp/a.txt", "/tmp/b.txt"]);
        assert_eq!(
            serde_json::to_string(&open_result).expect("open result should encode"),
            r#"{"paths":["/tmp/a.txt","/tmp/b.txt"]}"#
        );

        let save_selected = DialogSaveResultPayload::selected("/tmp/report.md");
        assert_eq!(save_selected.path(), Some("/tmp/report.md"));
        assert_eq!(
            serde_json::to_string(&save_selected).expect("save result should encode"),
            r#"{"path":"/tmp/report.md"}"#
        );
        assert_eq!(
            serde_json::to_string(&DialogSaveResultPayload::canceled())
                .expect("cancel result should encode"),
            r#"{}"#
        );

        let confirm_result = DialogConfirmResultPayload::new(false);
        assert!(!confirm_result.confirmed());
        assert_eq!(
            serde_json::to_string(&confirm_result).expect("confirm result should encode"),
            r#"{"confirmed":false}"#
        );
    }

    #[test]
    fn dialog_payloads_reject_excess_fields() {
        let error =
            serde_json::from_str::<DialogOpenFilePayload>(r#"{"title":"Open","unexpected":true}"#)
                .expect_err("dialog open should reject excess fields");
        assert!(error.to_string().contains("unknown field `unexpected`"));

        let error =
            serde_json::from_str::<DialogMessagePayload>(r#"{"level":"fatal","message":"bad"}"#)
                .expect_err("dialog message should reject invalid level");
        assert!(error.to_string().contains("unknown variant `fatal`"));
    }

    #[test]
    fn clipboard_payloads_serialize_canonically() {
        let text = ClipboardTextPayload::new("hello");
        assert_eq!(text.text(), "hello");
        assert_eq!(
            serde_json::to_string(&text).expect("clipboard text should encode"),
            r#"{"text":"hello"}"#
        );

        let html = ClipboardHtmlPayload::new("<p>hello</p>");
        assert_eq!(html.html(), "<p>hello</p>");
        assert_eq!(
            serde_json::to_string(&html).expect("clipboard html should encode"),
            r#"{"html":"<p>hello</p>"}"#
        );

        let image = ClipboardImagePayload::new("image/png", vec![137, 80, 78, 71]);
        assert_eq!(image.mime(), "image/png");
        assert_eq!(image.bytes(), [137, 80, 78, 71]);
        assert_eq!(
            serde_json::to_string(&image).expect("clipboard image should encode"),
            r#"{"mime":"image/png","bytes":[137,80,78,71]}"#
        );

        let support = ClipboardIsSupportedPayload::new(ClipboardCapabilityPayload::Selection);
        assert_eq!(support.capability(), ClipboardCapabilityPayload::Selection);
        assert_eq!(
            serde_json::to_string(&support).expect("clipboard support input should encode"),
            r#"{"capability":"selection"}"#
        );

        let unsupported = ClipboardSupportedPayload::unsupported(CLIPBOARD_UNSUPPORTED_REASON);
        assert!(!unsupported.is_supported());
        assert_eq!(unsupported.reason(), Some(CLIPBOARD_UNSUPPORTED_REASON));
        assert_eq!(
            serde_json::to_string(&unsupported).expect("clipboard support should encode"),
            r#"{"supported":false,"reason":"host-adapter-unimplemented"}"#
        );
    }

    #[test]
    fn clipboard_payloads_reject_excess_fields() {
        let error = serde_json::from_str::<ClipboardTextPayload>(
            r#"{"text":"hello","selection":"primary"}"#,
        )
        .expect_err("excess clipboard text field should be rejected");
        assert!(error.to_string().contains("unknown field `selection`"));

        let error =
            serde_json::from_str::<ClipboardIsSupportedPayload>(r#"{"capability":"primary"}"#)
                .expect_err("unknown clipboard capability should be rejected");
        assert!(error.to_string().contains("unknown variant `primary`"));
    }

    #[test]
    fn updater_payloads_encode_current_contract() {
        let signed_check = UpdaterCheckPayload::with_signed_manifest(
            Some("1.0.0".to_string()),
            r#"{"schemaVersion":1}"#.to_string(),
            vec![UpdaterTrustAnchorPayload::new(
                7,
                "ed25519:public-key".to_string(),
            )],
        );
        assert_eq!(
            serde_json::to_string(&signed_check).expect("signed updater check should encode"),
            r#"{"currentVersion":"1.0.0","manifestJson":"{\"schemaVersion\":1}","trustAnchors":[{"keyVersion":7,"publicKey":"ed25519:public-key"}]}"#
        );

        let download = UpdaterDownloadPayload::new(Some("1.1.0".to_string()));
        assert_eq!(download.version(), Some("1.1.0"));
        assert_eq!(
            serde_json::to_string(&download).expect("updater download should encode"),
            r#"{"version":"1.1.0"}"#
        );

        let install = UpdaterInstallPayload::new(Some("1.1.0".to_string()));
        assert_eq!(install.version(), Some("1.1.0"));
        assert_eq!(
            serde_json::to_string(&install).expect("updater install should encode"),
            r#"{"version":"1.1.0"}"#
        );

        let available =
            UpdaterCheckResultPayload::available("1.1.0", Some("security fix".to_string()));
        assert_eq!(
            serde_json::to_string(&available).expect("updater check result should encode"),
            r#"{"available":true,"version":"1.1.0","notes":"security fix"}"#
        );

        let unavailable = UpdaterCheckResultPayload::unavailable(None, None);
        assert_eq!(
            serde_json::to_string(&unavailable).expect("updater unavailable result should encode"),
            r#"{"available":false}"#
        );

        let status = UpdaterStatusPayload::new(
            UpdaterStatusState::Downloading,
            Some("1.1.0".to_string()),
            Some(0.5),
            Some("downloading".to_string()),
        );
        assert_eq!(
            serde_json::to_string(&status).expect("updater status should encode"),
            r#"{"state":"downloading","version":"1.1.0","progress":0.5,"message":"downloading"}"#
        );

        let restart = UpdaterPreparingRestartPayload::new(5000);
        assert_eq!(restart.deadline_ms(), 5000);
        assert_eq!(
            serde_json::to_string(&restart).expect("updater restart event should encode"),
            r#"{"deadlineMs":5000}"#
        );
    }

    #[test]
    fn updater_payloads_reject_excess_fields() {
        let error = serde_json::from_str::<UpdaterCheckPayload>(
            r#"{"currentVersion":"1.0.0","signature":"ignored"}"#,
        )
        .expect_err("excess updater check field should be rejected");
        assert!(error.to_string().contains("unknown field `signature`"));
    }

    #[test]
    fn crash_reporter_payloads_encode_current_contract() {
        let start = CrashReporterStartPayload::new(Some(true));
        assert_eq!(start.enabled(), Some(true));
        assert_eq!(
            serde_json::to_string(&start).expect("crash reporter start should encode"),
            r#"{"enabled":true}"#
        );

        let breadcrumb = CrashReporterBreadcrumbPayload::new(
            "startup",
            "renderer ready",
            Some(serde_json::json!({ "windowId": "window-1" })),
            Some(1710000000000.0),
        );
        assert_eq!(breadcrumb.category(), "startup");
        assert_eq!(breadcrumb.message(), "renderer ready");
        assert_eq!(
            breadcrumb.details(),
            Some(&serde_json::json!({ "windowId": "window-1" }))
        );
        assert_eq!(breadcrumb.timestamp(), Some(1710000000000.0));
        assert_eq!(
            serde_json::to_string(&breadcrumb).expect("crash reporter breadcrumb should encode"),
            r#"{"category":"startup","message":"renderer ready","details":{"windowId":"window-1"},"timestamp":1710000000000.0}"#
        );

        let null_details = CrashReporterBreadcrumbPayload::new(
            "startup",
            "null detail",
            Some(serde_json::Value::Null),
            None,
        );
        assert_eq!(null_details.details(), Some(&serde_json::Value::Null));
        assert_eq!(
            serde_json::to_string(&null_details)
                .expect("crash reporter null details should encode"),
            r#"{"category":"startup","message":"null detail","details":null}"#
        );

        let decoded_null_details = serde_json::from_str::<CrashReporterBreadcrumbPayload>(
            r#"{"category":"startup","message":"null detail","details":null}"#,
        )
        .expect("null details should decode");
        assert_eq!(
            decoded_null_details.details(),
            Some(&serde_json::Value::Null)
        );

        let flush = CrashReporterFlushPayload::new(3);
        assert_eq!(flush.flushed(), 3);
        assert_eq!(
            serde_json::to_string(&flush).expect("crash reporter flush should encode"),
            r#"{"flushed":3}"#
        );

        let report = CrashReporterReportPayload::new(
            "crash-1",
            "/tmp/effect-desktop/crash-1.json",
            1710000000000,
            4096,
            false,
        );
        assert_eq!(report.report_id(), "crash-1");
        assert_eq!(report.artifact_path(), "/tmp/effect-desktop/crash-1.json");
        assert_eq!(report.created_at(), 1710000000000);
        assert_eq!(report.size_bytes(), 4096);
        assert!(!report.uploaded());

        let reports = CrashReporterGetReportsPayload::new(vec![report]);
        assert_eq!(reports.reports().len(), 1);
        assert_eq!(
            serde_json::to_string(&reports).expect("crash reporter reports should encode"),
            r#"{"reports":[{"reportId":"crash-1","artifactPath":"/tmp/effect-desktop/crash-1.json","createdAt":1710000000000,"sizeBytes":4096,"uploaded":false}]}"#
        );

        assert_eq!(
            CRASH_REPORTER_UNSUPPORTED_REASON,
            "host-adapter-unimplemented"
        );
    }

    #[test]
    fn crash_reporter_payloads_reject_excess_fields() {
        let error = serde_json::from_str::<CrashReporterStartPayload>(
            r#"{"enabled":true,"submitUrl":"https://example.invalid"}"#,
        )
        .expect_err("excess crash reporter start field should be rejected");
        assert!(error.to_string().contains("unknown field `submitUrl`"));

        let error = serde_json::from_str::<CrashReporterGetReportsPayload>(
            r#"{"reports":[],"uploadToken":"secret"}"#,
        )
        .expect_err("excess crash reporter getReports field should be rejected");
        assert!(error.to_string().contains("unknown field `uploadToken`"));
    }

    #[test]
    fn power_monitor_payloads_encode_current_contract() {
        let support = PowerMonitorIsSupportedPayload::new(PowerMonitorMethodPayload::OnSuspend);
        assert_eq!(support.method(), PowerMonitorMethodPayload::OnSuspend);
        assert_eq!(
            serde_json::to_string(&support).expect("power monitor support should encode"),
            r#"{"method":"onSuspend"}"#
        );

        let supported = PowerMonitorSupportedPayload::supported();
        assert!(supported.is_supported());
        assert_eq!(
            serde_json::to_string(&supported).expect("power monitor supported should encode"),
            r#"{"supported":true}"#
        );

        let unsupported = PowerMonitorSupportedPayload::unsupported();
        assert!(!unsupported.is_supported());
        assert_eq!(
            serde_json::to_string(&unsupported).expect("power monitor unsupported should encode"),
            r#"{"supported":false}"#
        );

        let suspend = PowerMonitorReasonEventPayload::new(Some("sleep".to_string()));
        assert_eq!(suspend.reason(), Some("sleep"));
        assert_eq!(
            serde_json::to_string(&suspend).expect("power monitor reason event should encode"),
            r#"{"reason":"sleep"}"#
        );

        let resume = PowerMonitorReasonEventPayload::new(None);
        assert_eq!(resume.reason(), None);
        assert_eq!(
            serde_json::to_string(&resume).expect("power monitor empty reason event should encode"),
            r#"{}"#
        );

        let source = PowerMonitorSourceChangedEventPayload::new(PowerMonitorSourcePayload::Battery);
        assert_eq!(source.source(), PowerMonitorSourcePayload::Battery);
        assert_eq!(
            serde_json::to_string(&source)
                .expect("power monitor source changed event should encode"),
            r#"{"source":"battery"}"#
        );
    }

    #[test]
    fn power_monitor_payloads_reject_unknown_methods_and_excess_fields() {
        let lock_screen =
            PowerMonitorIsSupportedPayload::new(PowerMonitorMethodPayload::OnLockScreen);
        assert_eq!(
            lock_screen.method(),
            PowerMonitorMethodPayload::OnLockScreen
        );
        assert_eq!(
            serde_json::to_string(&lock_screen).expect("power monitor lock support should encode"),
            r#"{"method":"onLockScreen"}"#
        );

        let error =
            serde_json::from_str::<PowerMonitorIsSupportedPayload>(r#"{"method":"onDisplayOff"}"#)
                .expect_err("unknown power monitor method should be rejected");
        assert!(error.to_string().contains("unknown variant `onDisplayOff`"));

        let error = serde_json::from_str::<PowerMonitorIsSupportedPayload>(
            r#"{"method":"onSuspend","watch":true}"#,
        )
        .expect_err("excess power monitor support field should be rejected");
        assert!(error.to_string().contains("unknown field `watch`"));

        let error = serde_json::from_str::<PowerMonitorReasonEventPayload>(
            r#"{"reason":"sleep","timestamp":1710000000000}"#,
        )
        .expect_err("excess power monitor event field should be rejected");
        assert!(error.to_string().contains("unknown field `timestamp`"));

        let error =
            serde_json::from_str::<PowerMonitorSourceChangedEventPayload>(r#"{"source":"ups"}"#)
                .expect_err("unknown power source should be rejected");
        assert!(error.to_string().contains("unknown variant `ups`"));
    }

    #[test]
    fn system_appearance_payloads_encode_current_contract() {
        let appearance = SystemAppearanceResultPayload::new(SystemAppearanceModePayload::Dark);
        assert_eq!(appearance.appearance(), SystemAppearanceModePayload::Dark);
        assert_eq!(
            serde_json::to_string(&appearance).expect("appearance should encode"),
            r#"{"appearance":"dark"}"#
        );

        let color = SystemAppearanceColorPayload::new(1.0, 0.2, 0.3, 0.5);
        let accent = SystemAppearanceAccentColorPayload::new(Some(color));
        assert!(accent.color().is_some());
        assert_eq!(
            serde_json::to_string(&accent).expect("accent should encode"),
            r#"{"color":{"r":1.0,"g":0.2,"b":0.3,"a":0.5}}"#
        );

        let no_accent = SystemAppearanceAccentColorPayload::new(None);
        assert_eq!(no_accent.color(), None);
        assert_eq!(
            serde_json::to_string(&no_accent).expect("null accent should encode"),
            r#"{"color":null}"#
        );

        let changed = SystemAppearanceChangedPayload::new(
            SystemAppearanceModePayload::HighContrast,
            None,
            true,
            false,
        );
        assert_eq!(
            changed.appearance(),
            SystemAppearanceModePayload::HighContrast
        );
        assert_eq!(changed.accent_color(), None);
        assert!(changed.reduced_motion());
        assert!(!changed.reduced_transparency());
        assert_eq!(
            serde_json::to_string(&changed).expect("changed event should encode"),
            r#"{"appearance":"highContrast","accentColor":null,"reducedMotion":true,"reducedTransparency":false}"#
        );

        let reduced = SystemAppearanceBooleanPayload::new(true);
        assert!(reduced.enabled());
        assert_eq!(
            serde_json::to_string(&reduced).expect("boolean result should encode"),
            r#"{"enabled":true}"#
        );

        let support =
            SystemAppearanceIsSupportedPayload::new(SystemAppearanceMethodPayload::GetAppearance);
        assert_eq!(
            support.method(),
            SystemAppearanceMethodPayload::GetAppearance
        );
        assert_eq!(
            serde_json::to_string(&support).expect("support input should encode"),
            r#"{"method":"getAppearance"}"#
        );

        let unsupported = SystemAppearanceSupportedPayload::unsupported();
        assert!(!unsupported.is_supported());
        assert_eq!(
            serde_json::to_string(&unsupported).expect("support output should encode"),
            r#"{"supported":false}"#
        );
    }

    #[test]
    fn system_appearance_payloads_reject_unknown_methods_and_excess_fields() {
        let error =
            serde_json::from_str::<SystemAppearanceIsSupportedPayload>(r#"{"method":"theme"}"#)
                .expect_err("unknown system appearance method should be rejected");
        assert!(error.to_string().contains("unknown variant `theme`"));

        let error = serde_json::from_str::<SystemAppearanceResultPayload>(
            r#"{"appearance":"dark","isDark":true}"#,
        )
        .expect_err("excess appearance field should be rejected");
        assert!(error.to_string().contains("unknown field `isDark`"));

        let error = serde_json::from_str::<SystemAppearanceChangedPayload>(
            r#"{"appearance":"dark","reducedMotion":true,"reducedTransparency":false}"#,
        )
        .expect_err("changed event without accent color should be rejected");
        assert!(error.to_string().contains("missing field `accentColor`"));
    }

    #[test]
    fn system_appearance_color_payloads_reject_invalid_channels() {
        for payload in [
            r#"{"r":-0.1,"g":0.0,"b":0.0,"a":1.0}"#,
            r#"{"r":1.1,"g":0.0,"b":0.0,"a":1.0}"#,
            r#"{"r":0.0,"g":0.0,"b":0.0,"a":1.1}"#,
        ] {
            let error = serde_json::from_str::<SystemAppearanceColorPayload>(payload)
                .expect_err("invalid color channel should be rejected");
            assert!(error.to_string().contains("color channel"));
        }

        let error = serde_json::from_str::<SystemAppearanceAccentColorPayload>(
            r#"{"color":{"r":0.0,"g":2.0,"b":0.0,"a":1.0}}"#,
        )
        .expect_err("invalid accent color channel should be rejected");
        assert!(error.to_string().contains("color channel"));

        let error = serde_json::from_str::<SystemAppearanceChangedPayload>(
            r#"{"appearance":"dark","accentColor":{"r":0.0,"g":0.0,"b":0.0,"a":-0.1},"reducedMotion":true,"reducedTransparency":false}"#,
        )
        .expect_err("invalid changed accent color channel should be rejected");
        assert!(error.to_string().contains("color channel"));

        assert!(std::panic::catch_unwind(|| {
            let _ = SystemAppearanceColorPayload::new(0.0, 0.0, 0.0, f64::INFINITY);
        })
        .is_err());
    }

    #[test]
    fn window_create_payload_accepts_macos_polish_fields() {
        let payload = serde_json::from_str::<WindowCreatePayload>(
            r#"{"title":"Polished","width":320,"height":240,"parentWindowId":"window-parent","titleBarStyle":"hiddenInset","vibrancy":"windowBackground","trafficLights":{"x":12,"y":13}}"#,
        )
        .expect("macOS window polish payload should decode");

        assert_eq!(payload.title(), Some("Polished"));
        assert_eq!(payload.parent_window_id(), Some("window-parent"));
        assert_eq!(
            payload.title_bar_style(),
            Some(WindowTitleBarStyle::HiddenInset)
        );
        assert_eq!(payload.vibrancy(), Some("windowBackground"));
        assert_eq!(
            payload.traffic_lights(),
            Some(&WindowTrafficLights::new(12.0, 13.0))
        );
    }

    #[test]
    fn window_create_payload_rejects_unknown_fields() {
        let error = serde_json::from_str::<WindowCreatePayload>(
            r#"{"width":320,"height":240,"unknown":true}"#,
        )
        .expect_err("unknown window create fields must fail");

        assert!(
            error.to_string().contains("unknown field `unknown`"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn window_create_response_serializes_canonically() {
        let payload = WindowCreateResponse::new("window-1");

        assert_eq!(payload.window_id(), "window-1");
        assert_eq!(
            serde_json::to_string(&payload).expect("window create response should encode"),
            r#"{"windowId":"window-1"}"#
        );
    }

    #[test]
    fn window_destroy_payload_serializes_canonically() {
        let payload = WindowDestroyPayload::new("window-1");

        assert_eq!(payload.window_id(), "window-1");
        assert_eq!(
            serde_json::to_string(&payload).expect("window destroy payload should encode"),
            r#"{"windowId":"window-1"}"#
        );
    }

    #[test]
    fn window_lookup_payloads_serialize_canonically() {
        let lookup = WindowLookupResponse::new("window-1");

        assert_eq!(lookup.window_id(), "window-1");
        assert_eq!(
            serde_json::to_string(&lookup).expect("window lookup response should encode"),
            r#"{"windowId":"window-1"}"#
        );

        let parent = WindowParentResponse::new(Some("window-parent".to_string()));
        assert_eq!(parent.parent_window_id(), Some("window-parent"));
        assert_eq!(
            serde_json::to_string(&parent).expect("window parent response should encode"),
            r#"{"parentWindowId":"window-parent"}"#
        );

        let root_parent = WindowParentResponse::new(None);
        assert_eq!(root_parent.parent_window_id(), None);
        assert_eq!(
            serde_json::to_string(&root_parent).expect("root window parent response should encode"),
            r#"{}"#
        );

        let list = WindowListResponse::new(vec![
            WindowLookupResponse::new("window-1"),
            WindowLookupResponse::new("window-2"),
        ]);
        assert_eq!(
            list.windows()
                .iter()
                .map(WindowLookupResponse::window_id)
                .collect::<Vec<_>>(),
            vec!["window-1", "window-2"]
        );
        assert_eq!(
            serde_json::to_string(&list).expect("window list response should encode"),
            r#"{"windows":[{"windowId":"window-1"},{"windowId":"window-2"}]}"#
        );
    }

    #[test]
    fn window_lookup_payloads_reject_unknown_fields() {
        let error = serde_json::from_str::<WindowLookupResponse>(
            r#"{"windowId":"window-1","unknown":true}"#,
        )
        .expect_err("excess window lookup response fields must fail");
        assert!(
            error.to_string().contains("unknown field `unknown`"),
            "unexpected error: {error}"
        );

        let error = serde_json::from_str::<WindowListResponse>(
            r#"{"windows":[{"windowId":"window-1"}],"unknown":true}"#,
        )
        .expect_err("excess window list response fields must fail");
        assert!(
            error.to_string().contains("unknown field `unknown`"),
            "unexpected error: {error}"
        );

        let error = serde_json::from_str::<WindowParentResponse>(
            r#"{"parentWindowId":"window-parent","unknown":true}"#,
        )
        .expect_err("excess window parent response fields must fail");
        assert!(
            error.to_string().contains("unknown field `unknown`"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn window_registry_event_payload_serializes_canonically() {
        let opened = WindowRegistryEventPayload::new("window-1", WindowRegistryEventPhase::Opened);
        assert_eq!(opened.type_name(), "window-registry-event");
        assert_eq!(opened.window_id(), "window-1");
        assert_eq!(opened.phase(), &WindowRegistryEventPhase::Opened);
        assert!(!opened.terminal());
        assert_eq!(
            serde_json::to_string(&opened).expect("window opened event should encode"),
            r#"{"type":"window-registry-event","phase":"opened","windowId":"window-1","terminal":false}"#
        );

        let shown = WindowRegistryEventPayload::new("window-1", WindowRegistryEventPhase::Shown);
        assert!(!shown.terminal());
        assert_eq!(
            serde_json::to_string(&shown).expect("window shown event should encode"),
            r#"{"type":"window-registry-event","phase":"shown","windowId":"window-1","terminal":false}"#
        );

        let hidden = WindowRegistryEventPayload::new("window-1", WindowRegistryEventPhase::Hidden);
        assert!(!hidden.terminal());
        assert_eq!(
            serde_json::to_string(&hidden).expect("window hidden event should encode"),
            r#"{"type":"window-registry-event","phase":"hidden","windowId":"window-1","terminal":false}"#
        );

        let close_requested =
            WindowRegistryEventPayload::new("window-1", WindowRegistryEventPhase::CloseRequested);
        assert!(!close_requested.terminal());
        assert_eq!(
            serde_json::to_string(&close_requested)
                .expect("window close-requested event should encode"),
            r#"{"type":"window-registry-event","phase":"closeRequested","windowId":"window-1","terminal":false}"#
        );

        let closed = WindowRegistryEventPayload::new("window-1", WindowRegistryEventPhase::Closed);
        assert!(closed.terminal());
        assert_eq!(
            serde_json::to_string(&closed).expect("window closed event should encode"),
            r#"{"type":"window-registry-event","phase":"closed","windowId":"window-1","terminal":true}"#
        );
    }

    #[test]
    fn window_registry_event_payload_rejects_unknown_fields() {
        let error = serde_json::from_str::<WindowRegistryEventPayload>(
            r#"{"type":"window-registry-event","phase":"closed","windowId":"window-1","terminal":true,"unknown":true}"#,
        )
        .expect_err("excess window registry event fields must fail");
        assert!(
            error.to_string().contains("unknown field `unknown`"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn window_registry_event_payload_rejects_invalid_invariants() {
        let error = serde_json::from_str::<WindowRegistryEventPayload>(
            r#"{"type":"not-window-registry-event","phase":"closed","windowId":"window-1","terminal":true}"#,
        )
        .expect_err("invalid window registry event type must fail");
        assert!(
            error
                .to_string()
                .contains("window registry event type must be window-registry-event"),
            "unexpected error: {error}"
        );

        let error = serde_json::from_str::<WindowRegistryEventPayload>(
            r#"{"type":"window-registry-event","phase":"opened","windowId":"window-1","terminal":true}"#,
        )
        .expect_err("invalid terminal flag must fail");
        assert!(
            error
                .to_string()
                .contains("window registry event terminal must match phase"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn window_bounds_payloads_serialize_canonically() {
        let bounds = WindowBoundsPayload::new(10.0, 20.0, 640.0, 480.0);
        assert_eq!(bounds.x(), 10.0);
        assert_eq!(bounds.y(), 20.0);
        assert_eq!(bounds.width(), 640.0);
        assert_eq!(bounds.height(), 480.0);
        assert_eq!(
            serde_json::to_string(&bounds).expect("window bounds payload should encode"),
            r#"{"x":10.0,"y":20.0,"width":640.0,"height":480.0}"#
        );

        let set_bounds = WindowSetBoundsPayload::new("window-1", bounds);
        assert_eq!(set_bounds.window_id(), "window-1");
        assert_eq!(set_bounds.bounds().width(), 640.0);
        assert_eq!(
            serde_json::to_string(&set_bounds).expect("window set bounds payload should encode"),
            r#"{"windowId":"window-1","bounds":{"x":10.0,"y":20.0,"width":640.0,"height":480.0}}"#
        );

        let display_bounds = WindowBoundsPayload::new(5.0, 15.0, 320.0, 240.0);
        let set_bounds_on_display =
            WindowSetBoundsOnDisplayPayload::new("window-1", "display-1", display_bounds);
        assert_eq!(set_bounds_on_display.window_id(), "window-1");
        assert_eq!(set_bounds_on_display.display_id(), "display-1");
        assert_eq!(set_bounds_on_display.bounds().height(), 240.0);
        assert_eq!(
            serde_json::to_string(&set_bounds_on_display)
                .expect("window display bounds payload should encode"),
            r#"{"windowId":"window-1","displayId":"display-1","bounds":{"x":5.0,"y":15.0,"width":320.0,"height":240.0}}"#
        );

        let center_on_display = WindowCenterOnDisplayPayload::new("window-1", "display-1");
        assert_eq!(center_on_display.window_id(), "window-1");
        assert_eq!(center_on_display.display_id(), "display-1");
        assert_eq!(
            serde_json::to_string(&center_on_display)
                .expect("window center-on-display payload should encode"),
            r#"{"windowId":"window-1","displayId":"display-1"}"#
        );

        let set_title = WindowSetTitlePayload::new("window-1", "Main");
        assert_eq!(set_title.window_id(), "window-1");
        assert_eq!(set_title.title(), "Main");
        assert_eq!(
            serde_json::to_string(&set_title).expect("window set title payload should encode"),
            r#"{"windowId":"window-1","title":"Main"}"#
        );

        let set_resizable = WindowSetResizablePayload::new("window-1", false);
        assert_eq!(set_resizable.window_id(), "window-1");
        assert!(!set_resizable.resizable());
        assert_eq!(
            serde_json::to_string(&set_resizable)
                .expect("window set resizable payload should encode"),
            r#"{"windowId":"window-1","resizable":false}"#
        );

        let set_decorations = WindowSetDecorationsPayload::new("window-1", true);
        assert_eq!(set_decorations.window_id(), "window-1");
        assert!(set_decorations.decorations());
        assert_eq!(
            serde_json::to_string(&set_decorations)
                .expect("window set decorations payload should encode"),
            r#"{"windowId":"window-1","decorations":true}"#
        );

        let traffic_lights =
            WindowSetTrafficLightsPayload::new("window-1", WindowTrafficLights::new(12.0, 13.0));
        assert_eq!(traffic_lights.window_id(), "window-1");
        assert_eq!(traffic_lights.traffic_lights().x(), 12.0);
        assert_eq!(
            serde_json::to_string(&traffic_lights)
                .expect("window set traffic lights payload should encode"),
            r#"{"windowId":"window-1","trafficLights":{"x":12.0,"y":13.0}}"#
        );

        let set_vibrancy = WindowSetVibrancyPayload::new("window-1", "windowBackground");
        assert_eq!(set_vibrancy.window_id(), "window-1");
        assert_eq!(set_vibrancy.material(), "windowBackground");
        assert_eq!(
            serde_json::to_string(&set_vibrancy)
                .expect("window set vibrancy payload should encode"),
            r#"{"windowId":"window-1","material":"windowBackground"}"#
        );

        let clear_vibrancy = WindowClearVibrancyPayload::new("window-1");
        assert_eq!(clear_vibrancy.window_id(), "window-1");
        assert_eq!(
            serde_json::to_string(&clear_vibrancy)
                .expect("window clear vibrancy payload should encode"),
            r#"{"windowId":"window-1"}"#
        );

        let set_shadow = WindowSetShadowPayload::new("window-1", false);
        assert_eq!(set_shadow.window_id(), "window-1");
        assert!(!set_shadow.has_shadow());
        assert_eq!(
            serde_json::to_string(&set_shadow).expect("window set shadow payload should encode"),
            r#"{"windowId":"window-1","hasShadow":false}"#
        );

        let set_title_bar_style =
            WindowSetTitleBarStylePayload::new("window-1", WindowTitleBarStyle::HiddenInset);
        assert_eq!(set_title_bar_style.window_id(), "window-1");
        assert_eq!(
            set_title_bar_style.title_bar_style(),
            WindowTitleBarStyle::HiddenInset
        );
        assert_eq!(
            serde_json::to_string(&set_title_bar_style)
                .expect("window set titlebar style payload should encode"),
            r#"{"windowId":"window-1","titleBarStyle":"hiddenInset"}"#
        );

        let set_title_bar_transparent = WindowSetTitleBarTransparentPayload::new("window-1", true);
        assert_eq!(set_title_bar_transparent.window_id(), "window-1");
        assert!(set_title_bar_transparent.title_bar_transparent());
        assert_eq!(
            serde_json::to_string(&set_title_bar_transparent)
                .expect("window set title bar transparent payload should encode"),
            r#"{"windowId":"window-1","titleBarTransparent":true}"#
        );

        let set_transparent = WindowSetTransparentPayload::new("window-1", true);
        assert_eq!(set_transparent.window_id(), "window-1");
        assert!(set_transparent.transparent());
        assert_eq!(
            serde_json::to_string(&set_transparent)
                .expect("window set transparent payload should encode"),
            r#"{"windowId":"window-1","transparent":true}"#
        );

        let set_always_on_top = WindowSetAlwaysOnTopPayload::new("window-1", true);
        assert_eq!(set_always_on_top.window_id(), "window-1");
        assert!(set_always_on_top.always_on_top());
        assert_eq!(
            serde_json::to_string(&set_always_on_top)
                .expect("window set always on top payload should encode"),
            r#"{"windowId":"window-1","alwaysOnTop":true}"#
        );

        let set_skip_taskbar = WindowSetSkipTaskbarPayload::new("window-1", true);
        assert_eq!(set_skip_taskbar.window_id(), "window-1");
        assert!(set_skip_taskbar.skip_taskbar());
        assert_eq!(
            serde_json::to_string(&set_skip_taskbar)
                .expect("window set skip taskbar payload should encode"),
            r#"{"windowId":"window-1","skipTaskbar":true}"#
        );

        let set_progress = WindowSetProgressPayload::new(
            "window-1",
            Some(WindowProgressState::Normal),
            Some(42),
            Some("app.desktop".to_string()),
        );
        assert_eq!(set_progress.window_id(), "window-1");
        assert_eq!(set_progress.state(), Some(WindowProgressState::Normal));
        assert_eq!(set_progress.progress(), Some(42));
        assert_eq!(set_progress.desktop_filename(), Some("app.desktop"));
        assert_eq!(
            serde_json::to_string(&set_progress)
                .expect("window set progress payload should encode"),
            r#"{"windowId":"window-1","state":"normal","progress":42,"desktopFilename":"app.desktop"}"#
        );

        let request_attention =
            WindowRequestAttentionPayload::new("window-1", WindowAttentionType::Critical);
        assert_eq!(request_attention.window_id(), "window-1");
        assert_eq!(
            request_attention.request_type(),
            WindowAttentionType::Critical
        );
        assert_eq!(
            serde_json::to_string(&request_attention)
                .expect("window request attention payload should encode"),
            r#"{"windowId":"window-1","requestType":"critical"}"#
        );

        let set_fullscreen = WindowSetFullscreenPayload::new("window-1", true);
        assert_eq!(set_fullscreen.window_id(), "window-1");
        assert!(set_fullscreen.fullscreen());
        assert_eq!(
            serde_json::to_string(&set_fullscreen)
                .expect("window set fullscreen payload should encode"),
            r#"{"windowId":"window-1","fullscreen":true}"#
        );

        let set_simple_fullscreen = WindowSetSimpleFullscreenPayload::new("window-1", true);
        assert_eq!(set_simple_fullscreen.window_id(), "window-1");
        assert!(set_simple_fullscreen.simple_fullscreen());
        assert_eq!(
            serde_json::to_string(&set_simple_fullscreen)
                .expect("window set simple fullscreen payload should encode"),
            r#"{"windowId":"window-1","simpleFullscreen":true}"#
        );

        let state = WindowStatePayload::new(false, true, true, true);
        assert!(!state.minimized());
        assert!(state.maximized());
        assert!(state.fullscreen());
        assert!(state.simple_fullscreen());
        assert_eq!(
            serde_json::to_string(&state).expect("window state payload should encode"),
            r#"{"minimized":false,"maximized":true,"fullscreen":true,"simpleFullscreen":true}"#
        );

        let state_event = WindowStateEventPayload::new("window-1", state);
        assert_eq!(state_event.type_name(), "window-state-event");
        assert_eq!(state_event.window_id(), "window-1");
        assert!(state_event.state().maximized());
        assert_eq!(
            serde_json::to_string(&state_event).expect("window state event should encode"),
            r#"{"type":"window-state-event","windowId":"window-1","state":{"minimized":false,"maximized":true,"fullscreen":true,"simpleFullscreen":true}}"#
        );

        let error = serde_json::from_str::<WindowStateEventPayload>(
            r#"{"type":"not-window-state-event","windowId":"window-1","state":{"minimized":false,"maximized":true,"fullscreen":true,"simpleFullscreen":true}}"#,
        )
        .expect_err("invalid window state event type must fail");
        assert!(
            error
                .to_string()
                .contains("window state event type must be window-state-event"),
            "unexpected error: {error}"
        );

        let bounds_event =
            WindowBoundsEventPayload::new("window-1", WindowBoundsPayload::new(1.0, 2.0, 3.0, 4.0));
        assert_eq!(bounds_event.type_name(), "window-bounds-event");
        assert_eq!(bounds_event.window_id(), "window-1");
        assert_eq!(bounds_event.bounds().width(), 3.0);
        assert_eq!(
            serde_json::to_string(&bounds_event).expect("window bounds event should encode"),
            r#"{"type":"window-bounds-event","windowId":"window-1","bounds":{"x":1.0,"y":2.0,"width":3.0,"height":4.0}}"#
        );

        let error = serde_json::from_str::<WindowBoundsEventPayload>(
            r#"{"type":"not-window-bounds-event","windowId":"window-1","bounds":{"x":1.0,"y":2.0,"width":3.0,"height":4.0}}"#,
        )
        .expect_err("invalid window bounds event type must fail");
        assert!(
            error
                .to_string()
                .contains("window bounds event type must be window-bounds-event"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn dock_taskbar_payloads_serialize_canonically() {
        let progress = DockSetProgressPayload::new(
            serde_json::json!(0.5),
            Some(DockSetProgressOptionsPayload::new(Some(
                DockProgressState::Indeterminate,
            ))),
        );
        assert_eq!(progress.value(), &serde_json::json!(0.5));
        assert_eq!(
            progress
                .options()
                .and_then(DockSetProgressOptionsPayload::state),
            Some(DockProgressState::Indeterminate)
        );
        assert_eq!(
            serde_json::to_string(&progress).expect("dock progress payload should encode"),
            r#"{"value":0.5,"options":{"state":"indeterminate"}}"#
        );

        let clear_progress = DockSetProgressPayload::new(serde_json::Value::Null, None);
        assert_eq!(
            serde_json::to_string(&clear_progress)
                .expect("dock clear progress payload should encode"),
            r#"{"value":null}"#
        );

        let item = DockJumpListItemPayload::new("open", "Open", "app.open");
        assert_eq!(item.id(), "open");
        assert_eq!(item.title(), "Open");
        assert_eq!(item.command_id(), "app.open");

        let jump_list = DockSetJumpListPayload::new(vec![item]);
        assert_eq!(jump_list.items()[0].command_id(), "app.open");
        assert_eq!(
            serde_json::to_string(&jump_list).expect("dock jump list payload should encode"),
            r#"{"items":[{"id":"open","title":"Open","commandId":"app.open"}]}"#
        );
    }

    #[test]
    fn dock_taskbar_payloads_reject_excess_fields() {
        let progress_error =
            serde_json::from_str::<DockSetProgressPayload>(r#"{"value":0.5,"unexpected":true}"#)
                .expect_err("dock progress excess fields should reject");
        assert!(
            progress_error.to_string().contains("unknown field"),
            "unexpected progress error: {progress_error}"
        );

        let item_error = serde_json::from_str::<DockSetJumpListPayload>(
            r#"{"items":[{"id":"open","title":"Open","commandId":"app.open","unexpected":true}]}"#,
        )
        .expect_err("dock jump list item excess fields should reject");
        assert!(
            item_error.to_string().contains("unknown field"),
            "unexpected jump list error: {item_error}"
        );
    }

    #[test]
    fn safe_storage_payloads_serialize_canonically() {
        let key = SafeStorageKeyPayload::new("token");
        assert_eq!(key.key(), "token");
        assert_eq!(
            serde_json::to_string(&key).expect("safe storage key payload should encode"),
            r#"{"key":"token"}"#
        );

        let set = SafeStorageSetPayload::new("token", "AAE=");
        assert_eq!(set.key(), "token");
        assert_eq!(set.value(), "AAE=");
        assert_eq!(
            serde_json::to_string(&set).expect("safe storage set payload should encode"),
            r#"{"key":"token","value":"AAE="}"#
        );

        let list = SafeStorageListResultPayload::new(vec!["token".to_string()]);
        assert_eq!(list.keys(), &["token".to_string()]);
        assert_eq!(
            serde_json::to_string(&list).expect("safe storage list payload should encode"),
            r#"{"keys":["token"]}"#
        );
    }

    #[test]
    fn safe_storage_payloads_reject_excess_fields() {
        let set_error = serde_json::from_str::<SafeStorageSetPayload>(
            r#"{"key":"token","value":"AAE=","unexpected":true}"#,
        )
        .expect_err("safe storage set excess fields should reject");
        assert!(
            set_error.to_string().contains("unknown field"),
            "unexpected safe storage set error: {set_error}"
        );

        let key_error =
            serde_json::from_str::<SafeStorageKeyPayload>(r#"{"key":"token","unexpected":true}"#)
                .expect_err("safe storage key excess fields should reject");
        assert!(
            key_error.to_string().contains("unknown field"),
            "unexpected safe storage key error: {key_error}"
        );
    }

    #[test]
    fn realtime_media_session_payloads_serialize_canonically() {
        let identity = RealtimeMediaSessionIdentityPayload::new("profile-1", "session-1");
        assert_eq!(identity.profile_id(), "profile-1");
        assert_eq!(identity.session_id(), "session-1");
        assert_eq!(
            serde_json::to_string(&identity).expect("identity should encode"),
            r#"{"profileId":"profile-1","sessionId":"session-1"}"#
        );

        let select_device = RealtimeMediaSessionSelectDevicePayload::new(
            "profile-1",
            "session-1",
            RealtimeMediaDeviceKind::Microphone,
            "input-1",
        );
        assert_eq!(select_device.kind(), RealtimeMediaDeviceKind::Microphone);
        assert_eq!(select_device.device_id(), "input-1");
        assert_eq!(
            serde_json::to_string(&select_device).expect("select device should encode"),
            r#"{"profileId":"profile-1","sessionId":"session-1","kind":"microphone","deviceId":"input-1"}"#
        );

        let interrupt = RealtimeMediaSessionInterruptPayload::new(
            "profile-1",
            "session-1",
            RealtimeMediaInterruptionReason::DeviceLost,
        );
        assert_eq!(
            interrupt.reason(),
            RealtimeMediaInterruptionReason::DeviceLost
        );
        assert_eq!(
            serde_json::to_string(&interrupt).expect("interrupt should encode"),
            r#"{"profileId":"profile-1","sessionId":"session-1","reason":"device-lost"}"#
        );

        let supported = RealtimeMediaSessionSupportedPayload::unsupported(
            REALTIME_MEDIA_SESSION_UNSUPPORTED_REASON,
        );
        assert!(!supported.supported());
        assert_eq!(
            supported.reason(),
            Some(REALTIME_MEDIA_SESSION_UNSUPPORTED_REASON)
        );
        assert_eq!(
            serde_json::to_string(&supported).expect("support result should encode"),
            r#"{"supported":false,"reason":"host-adapter-unimplemented"}"#
        );
    }

    #[test]
    fn realtime_media_session_events_serialize_canonically() {
        let device = RealtimeMediaDeviceStatePayload::new(
            RealtimeMediaDeviceKind::Speaker,
            "speaker-1",
            "Speakers",
            true,
            true,
        );
        let device_event =
            RealtimeMediaDeviceStateEventPayload::new("profile-1", "session-1", vec![device]);
        assert_eq!(
            serde_json::to_string(&device_event).expect("device event should encode"),
            r#"{"type":"device-state","profileId":"profile-1","sessionId":"session-1","devices":[{"kind":"speaker","deviceId":"speaker-1","label":"Speakers","selected":true,"available":true}]}"#
        );

        let permission_event = RealtimeMediaPermissionStateEventPayload::new(
            "profile-1",
            "session-1",
            RealtimeMediaPermissionState::Granted,
            RealtimeMediaPermissionState::PromptRequired,
        );
        assert_eq!(
            serde_json::to_string(&permission_event).expect("permission event should encode"),
            r#"{"type":"permission-state","profileId":"profile-1","sessionId":"session-1","microphone":"granted","speaker":"prompt-required"}"#
        );

        let interruption_event = RealtimeMediaInterruptionEventPayload::new(
            "profile-1",
            "session-1",
            RealtimeMediaInterruptionReason::Background,
        );
        assert_eq!(
            serde_json::to_string(&interruption_event).expect("interruption event should encode"),
            r#"{"type":"interruption","profileId":"profile-1","sessionId":"session-1","reason":"background"}"#
        );

        let session_event = RealtimeMediaSessionStateEventPayload::new(
            "profile-1",
            "session-1",
            RealtimeMediaSessionState::Interrupted,
        );
        assert_eq!(
            serde_json::to_string(&session_event).expect("session event should encode"),
            r#"{"type":"session-state","profileId":"profile-1","sessionId":"session-1","state":"interrupted"}"#
        );
    }

    #[test]
    fn diagnostics_bundle_payloads_serialize_canonically() {
        let collect = DiagnosticsBundleCollectPayload::new(
            Some("bundle-1".to_string()),
            vec![
                DiagnosticsBundleSourceKind::Logs,
                DiagnosticsBundleSourceKind::AuditEvents,
            ],
            Some("trace-1".to_string()),
        );
        assert_eq!(collect.bundle_id(), Some("bundle-1"));
        assert_eq!(
            collect.sources(),
            &[
                DiagnosticsBundleSourceKind::Logs,
                DiagnosticsBundleSourceKind::AuditEvents
            ]
        );
        assert_eq!(collect.trace_id(), Some("trace-1"));
        assert_eq!(
            serde_json::to_string(&collect).expect("collect payload should encode"),
            r#"{"bundleId":"bundle-1","sources":["logs","audit-events"],"traceId":"trace-1"}"#
        );

        let redact = DiagnosticsBundleRedactPayload::new(
            "bundle-1",
            DiagnosticsBundleSourceKind::Logs,
            serde_json::json!({ "apiKey": "secret" }),
        );
        assert_eq!(redact.bundle_id(), "bundle-1");
        assert_eq!(redact.source(), DiagnosticsBundleSourceKind::Logs);
        assert_eq!(redact.payload(), &serde_json::json!({ "apiKey": "secret" }));
        assert_eq!(
            serde_json::to_string(&redact).expect("redact payload should encode"),
            r#"{"bundleId":"bundle-1","source":"logs","payload":{"apiKey":"secret"}}"#
        );

        let write = DiagnosticsBundleWritePayload::new("bundle-1", "/tmp/diagnostics.zip", None);
        assert_eq!(write.bundle_id(), "bundle-1");
        assert_eq!(write.destination_path(), "/tmp/diagnostics.zip");
        assert_eq!(write.trace_id(), None);
        assert_eq!(
            serde_json::to_string(&write).expect("write payload should encode"),
            r#"{"bundleId":"bundle-1","destinationPath":"/tmp/diagnostics.zip"}"#
        );

        let policy = DiagnosticsBundleRedactionPolicyPayload::new(
            "host-secret-patterns",
            vec![DiagnosticsBundleRedactionEvidencePayload::new(
                "<redacted-path>",
                "secret-pattern",
            )],
        );
        let summary = DiagnosticsBundleSourceSummaryPayload::new(
            DiagnosticsBundleSourceKind::Logs,
            1,
            policy,
        );
        assert_eq!(summary.source(), DiagnosticsBundleSourceKind::Logs);
        let collect_result = DiagnosticsBundleCollectResultPayload::new(
            "bundle-1",
            1_710_000_000_000,
            vec![summary.clone()],
        );
        assert_eq!(
            serde_json::to_string(&collect_result).expect("collect result should encode"),
            r#"{"bundleId":"bundle-1","collectedAt":1710000000000,"sources":[{"source":"logs","itemCount":1,"redactionPolicy":{"id":"host-secret-patterns","evidence":[{"path":"<redacted-path>","action":"redacted","reason":"secret-pattern"}]}}],"artifactCount":1}"#
        );
        let redact_result = DiagnosticsBundleRedactResultPayload::new(
            "bundle-1",
            DiagnosticsBundleSourceKind::Logs,
            serde_json::json!({ "token": "<redacted:redacted>" }),
            DiagnosticsBundleRedactionPolicyPayload::new("host-secret-patterns", Vec::new()),
        );
        assert_eq!(
            serde_json::to_string(&redact_result).expect("redact result should encode"),
            r#"{"bundleId":"bundle-1","source":"logs","payload":{"token":"<redacted:redacted>"},"redactionPolicy":{"id":"host-secret-patterns","evidence":[]}}"#
        );
        let write_result = DiagnosticsBundleWriteResultPayload::new(
            "bundle-1",
            "/tmp/diagnostics.zip",
            42,
            vec![summary],
        );
        assert_eq!(
            serde_json::to_string(&write_result).expect("write result should encode"),
            r#"{"bundleId":"bundle-1","destinationPath":"/tmp/diagnostics.zip","bytesWritten":42,"sources":[{"source":"logs","itemCount":1,"redactionPolicy":{"id":"host-secret-patterns","evidence":[{"path":"<redacted-path>","action":"redacted","reason":"secret-pattern"}]}}]}"#
        );

        let supported =
            DiagnosticsBundleSupportedPayload::unsupported(DIAGNOSTICS_BUNDLE_UNSUPPORTED_REASON);
        assert!(!supported.supported());
        assert_eq!(
            supported.reason(),
            Some(DIAGNOSTICS_BUNDLE_UNSUPPORTED_REASON)
        );
        assert_eq!(
            serde_json::to_string(&supported).expect("support payload should encode"),
            r#"{"supported":false,"reason":"host-adapter-unimplemented"}"#
        );
    }

    #[test]
    fn attachment_intake_events_reject_inconsistent_phase_payloads() {
        for source in [
            r#"{"type":"attachment-intake-event","timestamp":1710000000000,"intakeId":"intake-1","phase":"failed","state":"ingested","reason":"host-failed"}"#,
            r#"{"type":"attachment-intake-event","timestamp":1710000000000,"intakeId":"intake-1","phase":"ingested","state":"ingested","reason":"denied"}"#,
            r#"{"type":"attachment-intake-event","timestamp":1710000000000,"intakeId":"intake-1","phase":"disposed","state":"ingested"}"#,
        ] {
            let error = serde_json::from_str::<AttachmentIntakeEventPayload>(source)
                .expect_err("inconsistent attachment intake event should be rejected");
            assert!(
                error.to_string().contains("phase")
                    || error.to_string().contains("state")
                    || error.to_string().contains("reason"),
                "unexpected error: {error}"
            );
        }
    }

    #[test]
    fn attachment_intake_events_reject_inconsistent_phase_payloads_before_serializing() {
        for event in [
            AttachmentIntakeEventPayload {
                r#type: "attachment-intake-event".to_string(),
                timestamp: 1_710_000_000_000,
                intake_id: Some("intake-1".to_string()),
                phase: AttachmentIntakeEventPhase::Failed,
                state: Some(AttachmentIntakeState::Ingested),
                item_count: None,
                reason: Some("host-failed".to_string()),
                message: Some("host failed".to_string()),
            },
            AttachmentIntakeEventPayload {
                r#type: "attachment-intake-event".to_string(),
                timestamp: 1_710_000_000_000,
                intake_id: Some("intake-1".to_string()),
                phase: AttachmentIntakeEventPhase::Ingested,
                state: Some(AttachmentIntakeState::Ingested),
                item_count: Some(1),
                reason: Some("denied".to_string()),
                message: None,
            },
            AttachmentIntakeEventPayload {
                r#type: "attachment-intake-event".to_string(),
                timestamp: 1_710_000_000_000,
                intake_id: Some("intake-1".to_string()),
                phase: AttachmentIntakeEventPhase::Disposed,
                state: Some(AttachmentIntakeState::Ingested),
                item_count: None,
                reason: None,
                message: None,
            },
        ] {
            let error = serde_json::to_string(&event)
                .expect_err("inconsistent attachment intake event should not encode");
            assert!(
                error.to_string().contains("phase")
                    || error.to_string().contains("state")
                    || error.to_string().contains("reason"),
                "unexpected error: {error}"
            );
        }
    }

    #[test]
    fn selection_context_events_reject_inconsistent_phase_payloads() {
        for source in [
            r#"{"type":"selection-context-event","timestamp":1710000000100,"phase":"focus-changed"}"#,
            r#"{"type":"selection-context-event","timestamp":1710000000100,"phase":"focus-changed","document":{"documentId":"document-1","kind":"editor-buffer"},"selection":{"characterCount":12}}"#,
            r#"{"type":"selection-context-event","timestamp":1710000000100,"phase":"selection-changed"}"#,
            r#"{"type":"selection-context-event","timestamp":1710000000100,"phase":"selection-changed","selection":{"characterCount":12},"reason":"host-failed"}"#,
            r#"{"type":"selection-context-event","timestamp":1710000000100,"phase":"watch-started"}"#,
            r#"{"type":"selection-context-event","timestamp":1710000000100,"phase":"watch-stopped","watchId":"watch-1","message":"stopped"}"#,
            r#"{"type":"selection-context-event","timestamp":1710000000100,"phase":"failed"}"#,
            r#"{"type":"selection-context-event","timestamp":1710000000100,"phase":"failed","reason":"host-failed","document":{"documentId":"document-1","kind":"editor-buffer"}}"#,
        ] {
            serde_json::from_str::<SelectionContextEventPayload>(source)
                .expect_err("inconsistent selection context event should be rejected");
        }

        for source in [
            r#"{"type":"selection-context-event","timestamp":1710000000100,"phase":"focus-changed","document":{"documentId":"document-1","kind":"editor-buffer"}}"#,
            r#"{"type":"selection-context-event","timestamp":1710000000100,"phase":"focus-changed","watchId":"watch-1","document":{"documentId":"document-1","kind":"editor-buffer"}}"#,
            r#"{"type":"selection-context-event","timestamp":1710000000100,"phase":"selection-changed","selection":{"characterCount":12}}"#,
            r#"{"type":"selection-context-event","timestamp":1710000000100,"phase":"selection-changed","watchId":"watch-1","document":{"documentId":"document-1","kind":"editor-buffer"},"selection":{"characterCount":12}}"#,
            r#"{"type":"selection-context-event","timestamp":1710000000100,"phase":"watch-started","watchId":"watch-1"}"#,
            r#"{"type":"selection-context-event","timestamp":1710000000100,"phase":"watch-stopped","watchId":"watch-1"}"#,
            r#"{"type":"selection-context-event","timestamp":1710000000100,"phase":"failed","reason":"host-failed","message":"host failed"}"#,
            r#"{"type":"selection-context-event","timestamp":1710000000100,"phase":"failed","watchId":"watch-1","reason":"host-failed"}"#,
        ] {
            serde_json::from_str::<SelectionContextEventPayload>(source)
                .expect("consistent selection context event should decode");
        }
    }

    #[test]
    fn selection_context_events_reject_inconsistent_phase_payloads_before_serializing() {
        for event in [
            SelectionContextEventPayload::focus_changed(
                1_710_000_000_100,
                SelectionContextDocumentMetadataPayload::new(
                    "document-1",
                    SelectionContextDocumentKind::EditorBuffer,
                ),
            )
            .with_message("host failed"),
            SelectionContextEventPayload::watch_started(1_710_000_000_100, "watch-1")
                .with_message("host failed"),
            SelectionContextEventPayload::failed(1_710_000_000_100, "host failed").with_document(
                SelectionContextDocumentMetadataPayload::new(
                    "document-1",
                    SelectionContextDocumentKind::EditorBuffer,
                ),
            ),
        ] {
            serde_json::to_string(&event)
                .expect_err("inconsistent selection context event should not encode");
        }
    }

    #[test]
    fn focused_application_context_events_reject_inconsistent_phase_payloads() {
        for source in [
            r#"{"type":"focused-application-context-event","timestamp":1710000000100,"phase":"focus-changed"}"#,
            r#"{"type":"focused-application-context-event","timestamp":1710000000100,"phase":"focus-changed","snapshot":{"application":{"applicationId":"app-1"},"observedAt":1710000000000},"reason":"host-failed"}"#,
            r#"{"type":"focused-application-context-event","timestamp":1710000000100,"phase":"watch-started"}"#,
            r#"{"type":"focused-application-context-event","timestamp":1710000000100,"phase":"watch-stopped","watchId":"watch-1","message":"stopped"}"#,
            r#"{"type":"focused-application-context-event","timestamp":1710000000100,"phase":"failed"}"#,
            r#"{"type":"focused-application-context-event","timestamp":1710000000100,"phase":"failed","reason":"host-failed","snapshot":{"application":{"applicationId":"app-1"},"observedAt":1710000000000}}"#,
        ] {
            serde_json::from_str::<FocusedApplicationContextEventPayload>(source)
                .expect_err("inconsistent focused application context event should be rejected");
        }

        for source in [
            r#"{"type":"focused-application-context-event","timestamp":1710000000100,"phase":"focus-changed","snapshot":{"application":{"applicationId":"app-1"},"observedAt":1710000000000}}"#,
            r#"{"type":"focused-application-context-event","timestamp":1710000000100,"phase":"focus-changed","watchId":"watch-1","snapshot":{"application":{"applicationId":"app-1"},"observedAt":1710000000000}}"#,
            r#"{"type":"focused-application-context-event","timestamp":1710000000100,"phase":"watch-started","watchId":"watch-1"}"#,
            r#"{"type":"focused-application-context-event","timestamp":1710000000100,"phase":"watch-stopped","watchId":"watch-1"}"#,
            r#"{"type":"focused-application-context-event","timestamp":1710000000100,"phase":"failed","reason":"host-failed","message":"host failed"}"#,
        ] {
            serde_json::from_str::<FocusedApplicationContextEventPayload>(source)
                .expect("consistent focused application context event should decode");
        }
    }

    #[test]
    fn focused_application_context_events_reject_inconsistent_phase_payloads_before_serializing() {
        let snapshot = FocusedApplicationContextSnapshotResultPayload::new(
            FocusedApplicationMetadataPayload::new("app-1"),
            1_710_000_000_000,
        );
        for event in [
            FocusedApplicationContextEventPayload {
                r#type: "focused-application-context-event".to_string(),
                timestamp: 1_710_000_000_100,
                phase: FocusedApplicationContextEventPhase::FocusChanged,
                watch_id: None,
                snapshot: None,
                reason: None,
                message: None,
            },
            FocusedApplicationContextEventPayload {
                r#type: "focused-application-context-event".to_string(),
                timestamp: 1_710_000_000_100,
                phase: FocusedApplicationContextEventPhase::WatchStarted,
                watch_id: None,
                snapshot: None,
                reason: None,
                message: None,
            },
            FocusedApplicationContextEventPayload {
                r#type: "focused-application-context-event".to_string(),
                timestamp: 1_710_000_000_100,
                phase: FocusedApplicationContextEventPhase::Failed,
                watch_id: None,
                snapshot: Some(snapshot),
                reason: Some("host-failed".to_string()),
                message: None,
            },
        ] {
            serde_json::to_string(&event)
                .expect_err("inconsistent focused application context event should not encode");
        }
    }

    #[test]
    fn display_capture_payloads_serialize_canonically() {
        let actor =
            DisplayCaptureActorPayload::new(DisplayCaptureActorKind::Workspace, "workspace-1");
        let grant = DisplayCaptureGrantPayload::new(DisplayCaptureGrantKind::Policy, "grant-1");
        let target = DisplayCaptureTargetPayload::region(
            "display-1",
            DisplayCaptureRegionPayload::new(1.0, 2.0, 320.0, 240.0),
        );
        let request = DisplayCaptureRequestPayload::new(
            actor,
            grant,
            target,
            Some("trace-display-capture".to_string()),
        );
        let image = DisplayCaptureImagePayload::new("image/png", vec![137, 80, 78, 71]);
        let metadata = DisplayCaptureMetadataPayload::new(
            "capture-1",
            DisplayCaptureSource::Region,
            4,
            1710000000000,
        );
        let result = DisplayCaptureResultPayload::new(image, metadata);
        let event = DisplayCaptureEventPayload::captured(
            1710000000001,
            "capture-1",
            DisplayCaptureSource::Region,
            4,
        );
        let supported =
            DisplayCaptureSupportedPayload::unsupported(DISPLAY_CAPTURE_UNSUPPORTED_REASON);

        assert_eq!(
            serde_json::to_string(&request).expect("request payload should encode"),
            r#"{"actor":{"kind":"workspace","id":"workspace-1"},"grant":{"kind":"policy","id":"grant-1"},"target":{"source":"region","displayId":"display-1","region":{"x":1.0,"y":2.0,"width":320.0,"height":240.0}},"traceId":"trace-display-capture"}"#
        );
        assert_eq!(
            serde_json::to_string(&result).expect("result payload should encode"),
            r#"{"image":{"mime":"image/png","bytes":[137,80,78,71]},"metadata":{"captureId":"capture-1","source":"region","byteLength":4,"observedAt":1710000000000}}"#
        );
        assert_eq!(
            serde_json::to_string(&event).expect("event payload should encode"),
            r#"{"type":"display-capture-event","timestamp":1710000000001,"phase":"captured","captureId":"capture-1","source":"region","byteLength":4}"#
        );
        assert_eq!(
            serde_json::to_string(&supported).expect("support payload should encode"),
            r#"{"supported":false,"reason":"host-adapter-unimplemented"}"#
        );
    }

    #[test]
    fn display_capture_events_reject_inconsistent_phase_payloads() {
        for source in [
            r#"{"type":"display-capture-event","timestamp":1710000000000,"phase":"captured","reason":"host failed"}"#,
            r#"{"type":"display-capture-event","timestamp":1710000000000,"phase":"failed","captureId":"capture-1","source":"display","byteLength":7}"#,
            r#"{"type":"display-capture-event","timestamp":1710000000000,"phase":"captured","captureId":"capture-1","source":"display","byteLength":7,"message":"host failed"}"#,
        ] {
            let error = serde_json::from_str::<DisplayCaptureEventPayload>(source)
                .expect_err("inconsistent display capture event should be rejected");
            assert!(
                error.to_string().contains("captured")
                    || error.to_string().contains("failed")
                    || error.to_string().contains("phase"),
                "unexpected error: {error}"
            );
        }
    }

    #[test]
    fn display_capture_events_reject_inconsistent_phase_payloads_before_serializing() {
        for event in [
            DisplayCaptureEventPayload {
                r#type: "display-capture-event".to_string(),
                timestamp: 1_710_000_000_000,
                phase: DisplayCaptureEventPhase::Captured,
                capture_id: None,
                source: None,
                byte_length: None,
                reason: Some("host failed".to_string()),
                message: None,
            },
            DisplayCaptureEventPayload {
                r#type: "display-capture-event".to_string(),
                timestamp: 1_710_000_000_000,
                phase: DisplayCaptureEventPhase::Failed,
                capture_id: Some("capture-1".to_string()),
                source: Some(DisplayCaptureSource::Display),
                byte_length: Some(7),
                reason: None,
                message: None,
            },
            DisplayCaptureEventPayload {
                r#type: "display-capture-event".to_string(),
                timestamp: 1_710_000_000_000,
                phase: DisplayCaptureEventPhase::Captured,
                capture_id: Some("capture-1".to_string()),
                source: Some(DisplayCaptureSource::Display),
                byte_length: Some(7),
                reason: None,
                message: Some("host failed".to_string()),
            },
        ] {
            let error = serde_json::to_string(&event)
                .expect_err("inconsistent display capture event should not encode");
            assert!(
                error.to_string().contains("captured")
                    || error.to_string().contains("failed")
                    || error.to_string().contains("phase"),
                "unexpected error: {error}"
            );
        }
    }

    #[test]
    fn transient_window_role_payloads_serialize_canonically() {
        let actor = TransientWindowRoleActorPayload::new(
            TransientWindowRoleActorKind::Workspace,
            "workspace-1",
        );
        let placement = TransientWindowRolePlacementPayload::point(
            TransientWindowRolePointPayload::new(20.0, 40.0),
        );
        let policy = TransientWindowRolePolicyPayload::new(
            TransientWindowRoleKind::Palette,
            TransientWindowFocusPolicy::TakeFocus,
            TransientWindowDismissalPolicy::Escape,
            TransientWindowZOrderPolicy::Floating,
            placement,
            TransientWindowRestorationPolicy::RestoreFocus,
        );
        let request = TransientWindowRoleOpenPayload::new(
            actor,
            "palette-1",
            policy,
            Some("trace-transient-window-role".to_string()),
        );
        let event = TransientWindowRoleEventPayload::opened(1710000000001, "role-1");
        let supported = TransientWindowRoleSupportedPayload::unsupported(
            TRANSIENT_WINDOW_ROLE_UNSUPPORTED_REASON,
        );

        assert_eq!(
            serde_json::to_string(&request).expect("request payload should encode"),
            r#"{"actor":{"kind":"workspace","id":"workspace-1"},"roleId":"palette-1","policy":{"role":"palette","focus":"take-focus","dismissal":"escape","zOrder":"floating","placement":{"kind":"point","point":{"x":20.0,"y":40.0}},"restoration":"restore-focus"},"traceId":"trace-transient-window-role"}"#
        );
        assert_eq!(
            serde_json::to_string(&event).expect("event payload should encode"),
            r#"{"type":"transient-window-role-event","timestamp":1710000000001,"phase":"opened","roleId":"role-1"}"#
        );
        assert_eq!(
            serde_json::to_string(&supported).expect("support payload should encode"),
            r#"{"supported":false,"reason":"host-adapter-unimplemented"}"#
        );
    }

    #[test]
    fn transient_window_role_events_reject_inconsistent_phase_payloads() {
        for source in [
            r#"{"type":"transient-window-role-event","timestamp":1710000000001,"phase":"opened"}"#,
            r#"{"type":"transient-window-role-event","timestamp":1710000000001,"phase":"opened","roleId":"role-1","reason":"host failed"}"#,
            r#"{"type":"transient-window-role-event","timestamp":1710000000001,"phase":"repositioned"}"#,
            r#"{"type":"transient-window-role-event","timestamp":1710000000001,"phase":"dismissed","roleId":"role-1","message":"dismissed"}"#,
            r#"{"type":"transient-window-role-event","timestamp":1710000000001,"phase":"failed"}"#,
        ] {
            serde_json::from_str::<TransientWindowRoleEventPayload>(source)
                .expect_err("inconsistent transient window role event should be rejected");
        }

        for source in [
            r#"{"type":"transient-window-role-event","timestamp":1710000000001,"phase":"opened","roleId":"role-1"}"#,
            r#"{"type":"transient-window-role-event","timestamp":1710000000001,"phase":"repositioned","roleId":"role-1"}"#,
            r#"{"type":"transient-window-role-event","timestamp":1710000000001,"phase":"dismissed","roleId":"role-1"}"#,
            r#"{"type":"transient-window-role-event","timestamp":1710000000001,"phase":"failed","reason":"host failed"}"#,
            r#"{"type":"transient-window-role-event","timestamp":1710000000001,"phase":"failed","roleId":"role-1","reason":"host failed","message":"host failed"}"#,
        ] {
            serde_json::from_str::<TransientWindowRoleEventPayload>(source)
                .expect("consistent transient window role event should decode");
        }
    }

    #[test]
    fn transient_window_role_events_reject_inconsistent_phase_payloads_before_serializing() {
        for event in [
            TransientWindowRoleEventPayload::new_for_test(
                1_710_000_000_001,
                TransientWindowRoleEventPhase::Opened,
            ),
            TransientWindowRoleEventPayload::new_for_test(
                1_710_000_000_001,
                TransientWindowRoleEventPhase::Opened,
            )
            .with_role_id("role-1")
            .with_reason_for_test("host failed"),
            TransientWindowRoleEventPayload::new_for_test(
                1_710_000_000_001,
                TransientWindowRoleEventPhase::Failed,
            ),
        ] {
            serde_json::to_string(&event)
                .expect_err("inconsistent transient window role event should not encode");
        }
    }

    #[test]
    fn activation_registry_payloads_serialize_canonically() {
        let actor = ActivationRegistryActorPayload::new(
            ActivationRegistryActorKind::Workspace,
            "workspace-1",
        );
        let surface = ActivationRegistrySurfacePayload::new(
            "palette",
            ActivationRegistrySource::GlobalShortcut,
            "activation.open",
            actor.clone(),
        );
        let permission_context =
            ActivationRegistryPermissionContextPayload::new(actor.clone(), "trace-1");
        let event = ActivationRegistryEventPayload::routed(
            1710000000000,
            "palette",
            ActivationRegistrySource::GlobalShortcut,
            actor,
            permission_context,
        );
        let supported = ActivationRegistrySupportedPayload::supported();

        assert_eq!(surface.surface_id(), "palette");
        assert_eq!(surface.command_id(), "activation.open");
        assert_eq!(
            serde_json::to_string(&surface).expect("activation surface should encode"),
            r#"{"surfaceId":"palette","source":"global-shortcut","commandId":"activation.open","actor":{"kind":"workspace","id":"workspace-1"}}"#
        );
        assert_eq!(
            serde_json::to_string(&event).expect("activation event should encode"),
            r#"{"type":"activation-registry-event","timestamp":1710000000000,"phase":"routed","surfaceId":"palette","source":"global-shortcut","payload":{"surfaceId":"palette"},"actor":{"kind":"workspace","id":"workspace-1"},"traceId":"trace-1","permissionContext":{"actor":{"kind":"workspace","id":"workspace-1"},"traceId":"trace-1"}}"#
        );
        assert_eq!(
            serde_json::to_string(&supported).expect("activation support should encode"),
            r#"{"supported":true}"#
        );
    }

    #[test]
    fn activation_registry_events_reject_inconsistent_reasons() {
        for source in [
            r#"{"type":"activation-registry-event","timestamp":1710000000000,"phase":"registered","surfaceId":"palette","source":"global-shortcut","payload":{"surfaceId":"palette"},"actor":{"kind":"workspace","id":"workspace-1"},"traceId":"trace-1","permissionContext":{"actor":{"kind":"workspace","id":"workspace-1"},"traceId":"trace-1"},"reason":"host failed"}"#,
            r#"{"type":"activation-registry-event","timestamp":1710000000000,"phase":"routed","surfaceId":"palette","source":"global-shortcut","payload":{"surfaceId":"palette"},"actor":{"kind":"workspace","id":"workspace-1"},"traceId":"trace-1","permissionContext":{"actor":{"kind":"workspace","id":"workspace-1"},"traceId":"trace-1"},"reason":"host failed"}"#,
            r#"{"type":"activation-registry-event","timestamp":1710000000000,"phase":"unregistered","surfaceId":"palette","source":"global-shortcut","payload":{"surfaceId":"palette"},"actor":{"kind":"workspace","id":"workspace-1"},"traceId":"trace-1","permissionContext":{"actor":{"kind":"workspace","id":"workspace-1"},"traceId":"trace-1"},"reason":"host failed"}"#,
            r#"{"type":"activation-registry-event","timestamp":1710000000000,"phase":"failed","surfaceId":"palette","source":"global-shortcut","payload":{"surfaceId":"palette"},"actor":{"kind":"workspace","id":"workspace-1"},"traceId":"trace-1","permissionContext":{"actor":{"kind":"workspace","id":"workspace-1"},"traceId":"trace-1"}}"#,
        ] {
            serde_json::from_str::<ActivationRegistryEventPayload>(source)
                .expect_err("inconsistent activation registry event should be rejected");
        }

        for source in [
            r#"{"type":"activation-registry-event","timestamp":1710000000000,"phase":"registered","surfaceId":"palette","source":"global-shortcut","payload":{"surfaceId":"palette"},"actor":{"kind":"workspace","id":"workspace-1"},"traceId":"trace-1","permissionContext":{"actor":{"kind":"workspace","id":"workspace-1"},"traceId":"trace-1"}}"#,
            r#"{"type":"activation-registry-event","timestamp":1710000000000,"phase":"routed","surfaceId":"palette","source":"global-shortcut","payload":{"surfaceId":"palette"},"actor":{"kind":"workspace","id":"workspace-1"},"traceId":"trace-1","permissionContext":{"actor":{"kind":"workspace","id":"workspace-1"},"traceId":"trace-1"}}"#,
            r#"{"type":"activation-registry-event","timestamp":1710000000000,"phase":"unregistered","surfaceId":"palette","source":"global-shortcut","payload":{"surfaceId":"palette"},"actor":{"kind":"workspace","id":"workspace-1"},"traceId":"trace-1","permissionContext":{"actor":{"kind":"workspace","id":"workspace-1"},"traceId":"trace-1"}}"#,
            r#"{"type":"activation-registry-event","timestamp":1710000000000,"phase":"failed","surfaceId":"palette","source":"global-shortcut","payload":{"surfaceId":"palette"},"actor":{"kind":"workspace","id":"workspace-1"},"traceId":"trace-1","permissionContext":{"actor":{"kind":"workspace","id":"workspace-1"},"traceId":"trace-1"},"reason":"host failed"}"#,
        ] {
            serde_json::from_str::<ActivationRegistryEventPayload>(source)
                .expect("consistent activation registry event should decode");
        }
    }

    #[test]
    fn activation_registry_events_reject_inconsistent_reasons_before_serializing() {
        let actor = ActivationRegistryActorPayload::new(
            ActivationRegistryActorKind::Workspace,
            "workspace-1",
        );
        let permission_context =
            ActivationRegistryPermissionContextPayload::new(actor.clone(), "trace-1");

        for event in [
            ActivationRegistryEventPayload::new_for_test(
                1_710_000_000_000,
                ActivationRegistryEventPhase::Registered,
                "palette",
                ActivationRegistrySource::GlobalShortcut,
                actor.clone(),
                permission_context.clone(),
            )
            .with_reason_for_test("host failed"),
            ActivationRegistryEventPayload::new_for_test(
                1_710_000_000_000,
                ActivationRegistryEventPhase::Failed,
                "palette",
                ActivationRegistrySource::GlobalShortcut,
                actor,
                permission_context,
            ),
        ] {
            serde_json::to_string(&event)
                .expect_err("inconsistent activation registry event should not encode");
        }
    }

    #[test]
    fn resident_lifecycle_payloads_serialize_canonically() {
        let policy = ResidentLifecyclePolicyPayload::new(
            ResidentLifecycleProcessPolicy::KeepRunning,
            ResidentLifecycleWindowPolicy::CloseToBackground,
            ResidentLifecycleBackgroundAvailability::Tray,
            Some(true),
        );
        let enable = ResidentLifecycleEnablePayload::new(policy);
        let disable = ResidentLifecycleDisablePayload::new(Some("trace-disable".to_string()));
        let event = ResidentLifecycleEventPayload::new(
            1710000000000,
            ResidentLifecycleEventPhase::Disabled,
            ResidentLifecycleStatePayload::disabled(),
            "trace-disable",
        );
        let supported = ResidentLifecycleSupportedPayload::supported();

        assert_eq!(
            serde_json::to_string(&enable).expect("resident enable should encode"),
            r#"{"policy":{"process":"keep-running","windows":"close-to-background","background":"tray","launchAtLogin":true}}"#
        );
        assert_eq!(
            serde_json::to_string(&disable).expect("resident disable should encode"),
            r#"{"traceId":"trace-disable"}"#
        );
        assert_eq!(
            serde_json::to_string(&event).expect("resident event should encode"),
            r#"{"type":"resident-lifecycle-event","timestamp":1710000000000,"phase":"disabled","state":{"enabled":false},"traceId":"trace-disable"}"#
        );
        assert_eq!(
            serde_json::to_string(&supported).expect("resident support should encode"),
            r#"{"supported":true}"#
        );
    }

    #[test]
    fn resident_lifecycle_events_reject_inconsistent_reasons() {
        for source in [
            r#"{"type":"resident-lifecycle-event","timestamp":1710000000001,"phase":"enabled","state":{"enabled":true,"policy":{"process":"keep-running","windows":"close-to-background","background":"tray","launchAtLogin":true}},"traceId":"trace-resident","reason":"host failed"}"#,
            r#"{"type":"resident-lifecycle-event","timestamp":1710000000001,"phase":"disabled","state":{"enabled":false},"traceId":"trace-resident","reason":"host failed"}"#,
            r#"{"type":"resident-lifecycle-event","timestamp":1710000000001,"phase":"changed","state":{"enabled":true,"policy":{"process":"keep-running","windows":"close-to-background","background":"tray","launchAtLogin":true}},"traceId":"trace-resident","reason":"host failed"}"#,
            r#"{"type":"resident-lifecycle-event","timestamp":1710000000001,"phase":"failed","state":{"enabled":true,"policy":{"process":"keep-running","windows":"close-to-background","background":"tray","launchAtLogin":true}},"traceId":"trace-resident"}"#,
        ] {
            serde_json::from_str::<ResidentLifecycleEventPayload>(source)
                .expect_err("inconsistent resident lifecycle event should be rejected");
        }

        for source in [
            r#"{"type":"resident-lifecycle-event","timestamp":1710000000001,"phase":"enabled","state":{"enabled":true,"policy":{"process":"keep-running","windows":"close-to-background","background":"tray","launchAtLogin":true}},"traceId":"trace-resident"}"#,
            r#"{"type":"resident-lifecycle-event","timestamp":1710000000001,"phase":"disabled","state":{"enabled":false},"traceId":"trace-resident"}"#,
            r#"{"type":"resident-lifecycle-event","timestamp":1710000000001,"phase":"changed","state":{"enabled":true,"policy":{"process":"keep-running","windows":"close-to-background","background":"tray","launchAtLogin":true}},"traceId":"trace-resident"}"#,
            r#"{"type":"resident-lifecycle-event","timestamp":1710000000001,"phase":"failed","state":{"enabled":true,"policy":{"process":"keep-running","windows":"close-to-background","background":"tray","launchAtLogin":true}},"traceId":"trace-resident","reason":"host failed"}"#,
        ] {
            serde_json::from_str::<ResidentLifecycleEventPayload>(source)
                .expect("consistent resident lifecycle event should decode");
        }
    }

    #[test]
    fn resident_lifecycle_events_reject_inconsistent_reasons_before_serializing() {
        let policy = ResidentLifecyclePolicyPayload::new(
            ResidentLifecycleProcessPolicy::KeepRunning,
            ResidentLifecycleWindowPolicy::CloseToBackground,
            ResidentLifecycleBackgroundAvailability::Tray,
            Some(true),
        );
        let event = ResidentLifecycleEventPayload::new(
            1_710_000_000_001,
            ResidentLifecycleEventPhase::Failed,
            ResidentLifecycleStatePayload::enabled(policy),
            "trace-resident",
        );

        serde_json::to_string(&event)
            .expect_err("inconsistent resident lifecycle event should not encode");
    }

    #[test]
    fn distribution_parity_payloads_serialize_canonically() {
        let capability = serde_json::json!({
            "kind": "filesystem.read",
            "roots": ["/tmp/extensions"]
        });
        let evidence = DistributionParityEvidencePayload::new(
            DistributionParityEvidenceKind::PackageArtifact,
            "artifact-1",
            "dist/desktop/extension-1",
            Some(
                "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
                    .to_string(),
            ),
            vec![capability.clone()],
        );
        let verify = DistributionParityVerifyPayload::new(
            "extension-1",
            "1.0.0",
            vec![capability.clone()],
            vec![evidence],
            Some("trace-distribution".to_string()),
        );
        let result = DistributionParityVerifyResultPayload::new("extension-1", "1.0.0", 1, 4);
        let event = DistributionParityEventPayload::verified(1710000000000, "extension-1", "1.0.0");
        let supported =
            DistributionParitySupportedPayload::unsupported(DISTRIBUTION_PARITY_UNSUPPORTED_REASON);

        assert_eq!(
            serde_json::to_string(&verify).expect("distribution verify should encode"),
            r#"{"packageId":"extension-1","version":"1.0.0","capabilities":[{"kind":"filesystem.read","roots":["/tmp/extensions"]}],"evidence":[{"kind":"package-artifact","id":"artifact-1","path":"dist/desktop/extension-1","sha256":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","capabilities":[{"kind":"filesystem.read","roots":["/tmp/extensions"]}]}],"traceId":"trace-distribution"}"#
        );
        assert_eq!(
            serde_json::to_string(&result).expect("distribution result should encode"),
            r#"{"packageId":"extension-1","version":"1.0.0","capabilityCount":1,"evidenceCount":4}"#
        );
        assert_eq!(
            serde_json::to_string(&event).expect("distribution event should encode"),
            r#"{"type":"distribution-parity-event","timestamp":1710000000000,"phase":"verified","packageId":"extension-1","version":"1.0.0"}"#
        );
        assert_eq!(
            serde_json::to_string(&supported).expect("distribution support should encode"),
            r#"{"supported":false,"reason":"host-adapter-unimplemented"}"#
        );
    }

    #[test]
    fn distribution_parity_events_reject_inconsistent_phase_payloads() {
        for payload in [
            r#"{"type":"distribution-parity-event","timestamp":1710000000000,"phase":"verified","packageId":"extension-1"}"#,
            r#"{"type":"distribution-parity-event","timestamp":1710000000000,"phase":"verified","packageId":"extension-1","version":"1.0.0","reason":"host failed"}"#,
            r#"{"type":"distribution-parity-event","timestamp":1710000000000,"phase":"failed","packageId":"extension-1","version":"1.0.0"}"#,
        ] {
            serde_json::from_str::<DistributionParityEventPayload>(payload)
                .expect_err("inconsistent distribution parity event payload should be rejected");
        }

        for payload in [
            r#"{"type":"distribution-parity-event","timestamp":1710000000000,"phase":"verified","packageId":"extension-1","version":"1.0.0"}"#,
            r#"{"type":"distribution-parity-event","timestamp":1710000000000,"phase":"failed","packageId":"extension-1","version":"1.0.0","reason":"host failed"}"#,
        ] {
            serde_json::from_str::<DistributionParityEventPayload>(payload)
                .expect("consistent distribution parity event payload should decode");
        }
    }

    #[test]
    fn distribution_parity_events_reject_inconsistent_phase_payloads_before_serializing() {
        for payload in [
            DistributionParityEventPayload::new_for_test(
                1_710_000_000_000,
                DistributionParityEventPhase::Verified,
                "extension-1",
                None,
                None,
            ),
            DistributionParityEventPayload::new_for_test(
                1_710_000_000_000,
                DistributionParityEventPhase::Verified,
                "extension-1",
                Some("1.0.0".to_string()),
                Some("host failed".to_string()),
            ),
            DistributionParityEventPayload::new_for_test(
                1_710_000_000_000,
                DistributionParityEventPhase::Failed,
                "extension-1",
                Some("1.0.0".to_string()),
                None,
            ),
        ] {
            serde_json::to_string(&payload)
                .expect_err("inconsistent distribution parity event payload should not encode");
        }
    }

    #[test]
    fn job_payloads_serialize_canonically() {
        let start: JobStartPayload = serde_json::from_value(serde_json::json!({
            "jobId": "job-1",
            "name": "Index workspace",
            "traceId": "trace-job"
        }))
        .expect("job start should decode");
        let control: JobControlPayload = serde_json::from_value(serde_json::json!({
            "jobId": "job-1",
            "reason": "user-paused"
        }))
        .expect("job control should decode");
        let progress_report: JobProgressReportPayload = serde_json::from_value(serde_json::json!({
            "jobId": "job-1",
            "completed": 3,
            "total": 10,
            "message": "indexed 3 files"
        }))
        .expect("job progress should decode");
        let get: JobGetPayload = serde_json::from_value(serde_json::json!({
            "jobId": "job-1"
        }))
        .expect("job get should decode");
        let progress = JobProgressPayload::new(
            3.0,
            Some(10.0),
            Some("indexed 3 files".to_string()),
            1710000000001,
        );
        let snapshot = JobSnapshotPayload::new(
            JobHandlePayload::new("job-1", 1, "native-job", JobState::Running),
            "Index workspace",
            JobState::Running,
            1710000000000,
            1710000000001,
            Some(progress),
            None,
        );
        let event = JobEventPayload::new(1710000000001, JobEventPhase::Progress, snapshot.clone());
        let supported = JobSupportedPayload::unsupported(JOB_UNSUPPORTED_REASON);

        assert_eq!(start.job_id(), Some("job-1"));
        assert_eq!(control.job_id(), "job-1");
        assert_eq!(progress_report.completed(), 3.0);
        assert_eq!(get.job_id(), "job-1");
        assert_eq!(
            serde_json::to_string(&snapshot).expect("job snapshot should encode"),
            r#"{"handle":{"kind":"job","id":"job-1","generation":1,"ownerScope":"native-job","state":"running"},"name":"Index workspace","state":"running","startedAt":1710000000000,"updatedAt":1710000000001,"progress":{"completed":3.0,"total":10.0,"message":"indexed 3 files","updatedAt":1710000000001}}"#
        );
        assert_eq!(
            serde_json::to_string(&event).expect("job event should encode"),
            r#"{"type":"job-event","timestamp":1710000000001,"phase":"progress","job":{"handle":{"kind":"job","id":"job-1","generation":1,"ownerScope":"native-job","state":"running"},"name":"Index workspace","state":"running","startedAt":1710000000000,"updatedAt":1710000000001,"progress":{"completed":3.0,"total":10.0,"message":"indexed 3 files","updatedAt":1710000000001}}}"#
        );
        assert_eq!(
            serde_json::to_string(&supported).expect("job support should encode"),
            r#"{"supported":false,"reason":"host-adapter-unimplemented"}"#
        );
    }

    #[test]
    fn egress_policy_payloads_serialize_canonically() {
        let actor = EgressPolicyActorPayload::new(EgressPolicyActorKind::Extension, "extension-1");
        let destination = EgressPolicyDestinationPayload::new(
            EgressPolicyProtocol::Https,
            "api.example.test",
            Some(443),
            Some("/v1".to_string()),
        );
        let rule = EgressPolicyRulePayload::new(
            "allow-api",
            EgressPolicyRuleEffect::Allow,
            vec!["api.example.test".to_string()],
            vec![EgressPolicyProtocol::Https],
            vec![443],
            Some("workspace policy allows API access".to_string()),
        )
        .with_actor(actor.clone());
        let decision = EgressPolicyDecisionPayload::new(
            actor.clone(),
            destination.clone(),
            Some("trace-egress".to_string()),
        );

        assert_eq!(actor.kind(), EgressPolicyActorKind::Extension);
        assert_eq!(actor.id(), "extension-1");
        assert_eq!(destination.host(), "api.example.test");
        assert_eq!(destination.protocol(), EgressPolicyProtocol::Https);
        assert_eq!(destination.port(), Some(443));
        assert_eq!(destination.path(), Some("/v1"));
        assert_eq!(rule.id(), "allow-api");
        assert_eq!(rule.effect(), EgressPolicyRuleEffect::Allow);
        assert_eq!(rule.hosts(), &["api.example.test".to_string()]);
        assert_eq!(rule.protocols(), &[EgressPolicyProtocol::Https]);
        assert_eq!(rule.ports(), &[443]);
        assert_eq!(rule.actor(), Some(&actor));
        assert_eq!(
            serde_json::to_string(&decision).expect("decision payload should encode"),
            r#"{"actor":{"kind":"extension","id":"extension-1"},"destination":{"protocol":"https","host":"api.example.test","port":443,"path":"/v1"},"traceId":"trace-egress"}"#
        );

        let result = EgressPolicyDecisionResultPayload::new(
            "decision-1",
            EgressPolicyOutcome::Allowed,
            actor,
            destination,
            rule,
            "workspace policy allows API access",
        );
        assert_eq!(result.decision_id(), "decision-1");
        assert_eq!(result.outcome(), EgressPolicyOutcome::Allowed);
        assert_eq!(result.actor().id(), "extension-1");
        assert_eq!(result.destination().host(), "api.example.test");
        assert_eq!(result.rule().id(), "allow-api");
        assert_eq!(result.reason(), "workspace policy allows API access");
        assert_eq!(
            serde_json::to_string(&result).expect("decision result should encode"),
            r#"{"decisionId":"decision-1","outcome":"allowed","actor":{"kind":"extension","id":"extension-1"},"destination":{"protocol":"https","host":"api.example.test","port":443,"path":"/v1"},"rule":{"id":"allow-api","effect":"allow","hosts":["api.example.test"],"protocols":["https"],"ports":[443],"actor":{"kind":"extension","id":"extension-1"},"reason":"workspace policy allows API access"},"reason":"workspace policy allows API access"}"#
        );

        let event =
            EgressPolicyDecisionRecordedEventPayload::new(1_710_000_000_120, result.clone());
        assert_eq!(event.event_type(), "decision-recorded");
        assert_eq!(event.timestamp(), 1_710_000_000_120);
        assert_eq!(event.decision().decision_id(), "decision-1");
        assert_eq!(
            serde_json::to_string(&event).expect("recorded event payload should encode"),
            r#"{"type":"decision-recorded","timestamp":1710000000120,"decision":{"decisionId":"decision-1","outcome":"allowed","actor":{"kind":"extension","id":"extension-1"},"destination":{"protocol":"https","host":"api.example.test","port":443,"path":"/v1"},"rule":{"id":"allow-api","effect":"allow","hosts":["api.example.test"],"protocols":["https"],"ports":[443],"actor":{"kind":"extension","id":"extension-1"},"reason":"workspace policy allows API access"},"reason":"workspace policy allows API access"}}"#
        );

        let record = EgressPolicyRecordPayload::new(
            "decision-1",
            result.actor().clone(),
            result.destination().clone(),
            Some("trace-record".to_string()),
        );
        assert_eq!(record.trace_id(), Some("trace-record"));
        assert_eq!(record.decision_id(), "decision-1");
        assert_eq!(record.actor().id(), "extension-1");
        assert_eq!(record.destination().host(), "api.example.test");
        assert_eq!(
            serde_json::to_string(&record).expect("record payload should encode"),
            r#"{"decisionId":"decision-1","actor":{"kind":"extension","id":"extension-1"},"destination":{"protocol":"https","host":"api.example.test","port":443,"path":"/v1"},"traceId":"trace-record"}"#
        );
        assert_eq!(
            serde_json::to_string(&EgressPolicyRecordResultPayload::recorded("decision-1"))
                .expect("record result should encode"),
            r#"{"decisionId":"decision-1","recorded":true}"#
        );

        let supported = EgressPolicySupportedPayload::unsupported(EGRESS_POLICY_UNSUPPORTED_REASON);
        assert!(!supported.supported());
        assert_eq!(supported.reason(), Some(EGRESS_POLICY_UNSUPPORTED_REASON));
        assert_eq!(
            serde_json::to_string(&supported).expect("support payload should encode"),
            r#"{"supported":false,"reason":"host-adapter-unimplemented"}"#
        );
    }

    #[test]
    fn execution_sandbox_payloads_serialize_canonically() {
        let actor =
            ExecutionSandboxActorPayload::new(ExecutionSandboxActorKind::Extension, "extension-1");
        let policy = execution_sandbox_policy();
        let create = ExecutionSandboxCreatePayload::new(
            actor.clone(),
            policy,
            Some("sandbox-1".to_string()),
            Some("trace-sandbox".to_string()),
        );

        assert_eq!(actor.kind(), ExecutionSandboxActorKind::Extension);
        assert_eq!(actor.id(), "extension-1");
        assert_eq!(create.policy().cwd(), "/tmp/app");
        assert_eq!(
            serde_json::to_string(&create).expect("create payload should encode"),
            r#"{"actor":{"kind":"extension","id":"extension-1"},"policy":{"cwd":"/tmp/app","environment":[{"name":"PATH","value":"/usr/bin"}],"filesystem":{"readRoots":["/tmp/app"],"writeRoots":["/tmp/app/out"]},"network":{"hosts":["api.example.test"]},"budgets":{"cpuMillis":500,"memoryBytes":67108864,"wallClockMillis":1000,"stdoutBytes":1024,"stderrBytes":1024},"cleanup":{"killProcessTree":true,"removeWorkingDirectory":true}},"sandboxId":"sandbox-1","traceId":"trace-sandbox"}"#
        );

        let run = ExecutionSandboxRunPayload::new(
            "sandbox-1",
            "/usr/bin/node",
            vec!["--version".to_string()],
            Some("run-1".to_string()),
            Some("trace-run".to_string()),
        );
        assert_eq!(run.sandbox_id(), "sandbox-1");
        assert_eq!(run.command(), "/usr/bin/node");
        assert_eq!(run.args(), &["--version".to_string()]);
        assert_eq!(run.run_id(), Some("run-1"));
        assert_eq!(run.trace_id(), Some("trace-run"));
        assert_eq!(
            serde_json::to_string(&run).expect("run payload should encode"),
            r#"{"sandboxId":"sandbox-1","command":"/usr/bin/node","args":["--version"],"runId":"run-1","traceId":"trace-run"}"#
        );

        let event = ExecutionSandboxEventPayload::new(
            1_710_000_000_000,
            "sandbox-1",
            ExecutionSandboxEventPhase::RunCompleted,
            Some("run-1".to_string()),
            Some(ExecutionSandboxRunStatus::Completed),
            None,
        );
        assert_eq!(
            serde_json::to_string(&event).expect("event payload should encode"),
            r#"{"type":"sandbox-event","timestamp":1710000000000,"sandboxId":"sandbox-1","phase":"run-completed","runId":"run-1","status":"completed"}"#
        );

        let supported =
            ExecutionSandboxSupportedPayload::unsupported(EXECUTION_SANDBOX_UNSUPPORTED_REASON);
        assert!(!supported.supported());
        assert_eq!(
            supported.reason(),
            Some(EXECUTION_SANDBOX_UNSUPPORTED_REASON)
        );
        assert_eq!(
            serde_json::to_string(&supported).expect("support payload should encode"),
            r#"{"supported":false,"reason":"host-adapter-unimplemented"}"#
        );
    }

    #[test]
    fn execution_sandbox_events_reject_inconsistent_phase_payloads() {
        for source in [
            r#"{"type":"sandbox-event","timestamp":1710000000000,"sandboxId":"sandbox-1","phase":"run-started","status":"completed"}"#,
            r#"{"type":"sandbox-event","timestamp":1710000000000,"sandboxId":"sandbox-1","phase":"run-completed"}"#,
            r#"{"type":"sandbox-event","timestamp":1710000000000,"sandboxId":"sandbox-1","phase":"created","status":"completed"}"#,
            r#"{"type":"sandbox-event","timestamp":1710000000000,"sandboxId":"sandbox-1","phase":"destroyed","runId":"run-1","status":"failed"}"#,
        ] {
            let error = serde_json::from_str::<ExecutionSandboxEventPayload>(source)
                .expect_err("inconsistent execution sandbox event should be rejected");
            assert!(
                error.to_string().contains("phase")
                    || error.to_string().contains("run")
                    || error.to_string().contains("status"),
                "unexpected error: {error}"
            );
        }
    }

    #[test]
    fn execution_sandbox_events_reject_inconsistent_phase_payloads_before_serializing() {
        for event in [
            ExecutionSandboxEventPayload::new(
                1_710_000_000_000,
                "sandbox-1",
                ExecutionSandboxEventPhase::RunCompleted,
                None,
                None,
                None,
            ),
            ExecutionSandboxEventPayload::new(
                1_710_000_000_000,
                "sandbox-1",
                ExecutionSandboxEventPhase::Created,
                None,
                Some(ExecutionSandboxRunStatus::Completed),
                None,
            ),
            ExecutionSandboxEventPayload::new(
                1_710_000_000_000,
                "sandbox-1",
                ExecutionSandboxEventPhase::Destroyed,
                Some("run-1".to_string()),
                Some(ExecutionSandboxRunStatus::Failed),
                None,
            ),
        ] {
            let error = serde_json::to_string(&event)
                .expect_err("inconsistent execution sandbox event should not encode");
            assert!(
                error.to_string().contains("phase")
                    || error.to_string().contains("run")
                    || error.to_string().contains("status"),
                "unexpected error: {error}"
            );
        }
    }

    #[test]
    fn extension_config_payloads_serialize_canonically() {
        let actor =
            ExtensionConfigActorPayload::new(ExtensionConfigActorKind::Extension, "extension-1");
        let theme =
            ExtensionConfigFieldPayload::new("theme", ExtensionConfigValueType::String, false)
                .with_default(serde_json::json!("light"));
        let secret =
            ExtensionConfigFieldPayload::new("apiKey", ExtensionConfigValueType::String, true)
                .with_export_policy(ExtensionConfigExportPolicy::Private);
        let read = ExtensionConfigReadPayload::new(
            actor.clone(),
            "extension-1",
            vec![theme.clone(), secret.clone()],
            Some("trace-read".to_string()),
        );

        assert_eq!(actor.kind(), ExtensionConfigActorKind::Extension);
        assert_eq!(actor.id(), "extension-1");
        assert_eq!(read.extension_id(), "extension-1");
        assert_eq!(
            serde_json::to_string(&read).expect("read payload should encode"),
            r#"{"actor":{"kind":"extension","id":"extension-1"},"extensionId":"extension-1","fields":[{"key":"theme","valueType":"string","secret":false,"defaultValue":"light"},{"key":"apiKey","valueType":"string","secret":true,"exportPolicy":"private"}],"traceId":"trace-read"}"#
        );

        let write = ExtensionConfigWritePayload::new(
            actor,
            "extension-1",
            vec![theme, secret],
            vec![ExtensionConfigValueEntryPayload::new(
                "theme",
                serde_json::json!("dark"),
            )],
            vec!["apiKey".to_string()],
            Some("trace-write".to_string()),
        );
        assert_eq!(write.secret_keys(), &["apiKey".to_string()]);
        assert_eq!(
            serde_json::to_string(&write).expect("write payload should encode"),
            r#"{"actor":{"kind":"extension","id":"extension-1"},"extensionId":"extension-1","fields":[{"key":"theme","valueType":"string","secret":false,"defaultValue":"light"},{"key":"apiKey","valueType":"string","secret":true,"exportPolicy":"private"}],"values":[{"key":"theme","value":"dark"}],"secretKeys":["apiKey"],"traceId":"trace-write"}"#
        );

        let redacted = ExtensionConfigRedactResultPayload::new(
            "extension-1",
            vec![ExtensionConfigValueEntryPayload::new(
                "apiKey",
                serde_json::json!("<redacted:ExtensionConfigSecret>"),
            )],
            vec![ExtensionConfigRedactionEvidencePayload::new(
                "apiKey",
                "secret-field",
            )],
        );
        assert_eq!(
            serde_json::to_string(&redacted).expect("redact result should encode"),
            r#"{"extensionId":"extension-1","values":[{"key":"apiKey","value":"<redacted:ExtensionConfigSecret>"}],"redactions":[{"key":"apiKey","reason":"secret-field"}]}"#
        );

        assert_eq!(
            serde_json::to_string(&ExtensionConfigResetResultPayload::new(
                "extension-1",
                vec!["theme".to_string(), "apiKey".to_string()],
                2,
            ))
            .expect("reset result should encode"),
            r#"{"extensionId":"extension-1","resetKeys":["theme","apiKey"],"revision":2}"#
        );

        let event = ExtensionConfigEventPayload::new(
            1_710_000_000_000,
            "extension-1",
            ExtensionConfigEventPhase::Written,
            vec!["theme".to_string()],
            Some(1),
        );
        assert_eq!(
            serde_json::to_string(&event).expect("event should encode"),
            r#"{"type":"extension-config-event","timestamp":1710000000000,"extensionId":"extension-1","phase":"written","keys":["theme"],"revision":1}"#
        );

        assert_eq!(
            serde_json::to_string(&ExtensionConfigSupportedPayload::unsupported(
                EXTENSION_CONFIG_UNSUPPORTED_REASON,
            ))
            .expect("support payload should encode"),
            r#"{"supported":false,"reason":"host-adapter-unimplemented"}"#
        );
    }

    #[test]
    fn extension_config_events_reject_reasons_on_successful_phases() {
        for source in [
            r#"{"type":"extension-config-event","timestamp":1710000000000,"extensionId":"extension-1","phase":"read","reason":"host failed"}"#,
            r#"{"type":"extension-config-event","timestamp":1710000000000,"extensionId":"extension-1","phase":"written","reason":"host failed"}"#,
            r#"{"type":"extension-config-event","timestamp":1710000000000,"extensionId":"extension-1","phase":"reset","reason":"host failed"}"#,
            r#"{"type":"extension-config-event","timestamp":1710000000000,"extensionId":"extension-1","phase":"redacted","reason":"host failed"}"#,
        ] {
            serde_json::from_str::<ExtensionConfigEventPayload>(source)
                .expect_err("extension config event with reason should be rejected");
        }

        for source in [
            r#"{"type":"extension-config-event","timestamp":1710000000000,"extensionId":"extension-1","phase":"read"}"#,
            r#"{"type":"extension-config-event","timestamp":1710000000000,"extensionId":"extension-1","phase":"written","keys":["theme"],"revision":1}"#,
            r#"{"type":"extension-config-event","timestamp":1710000000000,"extensionId":"extension-1","phase":"reset","keys":["theme"],"revision":2}"#,
            r#"{"type":"extension-config-event","timestamp":1710000000000,"extensionId":"extension-1","phase":"redacted","keys":["theme"]}"#,
        ] {
            serde_json::from_str::<ExtensionConfigEventPayload>(source)
                .expect("extension config event without reason should decode");
        }
    }

    #[test]
    fn extension_package_payloads_serialize_canonically() {
        let actor =
            ExtensionPackageActorPayload::new(ExtensionPackageActorKind::Extension, "extension-1");
        let source = ExtensionPackageSourcePayload::new(
            ExtensionPackageSourceKind::Directory,
            "file:///tmp/extensions/extension-1",
        )
        .with_digest("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        let compatibility = ExtensionPackageCompatibilityPayload::new(
            Some("1.0.0".to_string()),
            Some("2.0.0".to_string()),
        );
        let capability = serde_json::json!({
            "kind": "filesystem.read",
            "roots": ["/tmp/extensions"],
            "audit": "always"
        });
        let declaration = ExtensionPackageCapabilityDeclarationPayload::new(capability.clone())
            .with_reason("read extension files");
        let manifest = ExtensionPackageManifestPayload::new(
            "extension-1",
            "Extension One",
            "1.0.0",
            "dist/main.js",
            compatibility,
            vec![declaration],
        );
        let install = ExtensionPackageInstallPayload::new(
            actor,
            source,
            manifest,
            Some("trace-install".to_string()),
        );

        assert_eq!(
            serde_json::to_string(&install).expect("install payload should encode"),
            r#"{"actor":{"kind":"extension","id":"extension-1"},"source":{"kind":"directory","uri":"file:///tmp/extensions/extension-1","digest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"manifest":{"id":"extension-1","name":"Extension One","version":"1.0.0","entrypoint":"dist/main.js","compatibility":{"minHostVersion":"1.0.0","maxHostVersion":"2.0.0"},"capabilities":[{"capability":{"audit":"always","kind":"filesystem.read","roots":["/tmp/extensions"]},"reason":"read extension files"}]},"traceId":"trace-install"}"#
        );

        assert_eq!(
            serde_json::to_string(&ExtensionPackageInstallResultPayload::new(
                "extension-1",
                "1.0.0",
                1,
                vec![capability.clone()],
            ))
            .expect("install result should encode"),
            r#"{"packageId":"extension-1","version":"1.0.0","revision":1,"registeredCapabilities":[{"audit":"always","kind":"filesystem.read","roots":["/tmp/extensions"]}]}"#
        );

        assert_eq!(
            serde_json::to_string(&ExtensionPackageUpdateResultPayload::new(
                "extension-1",
                Some("1.0.0".to_string()),
                "1.1.0",
                2,
                vec![capability],
            ))
            .expect("update result should encode"),
            r#"{"packageId":"extension-1","previousVersion":"1.0.0","version":"1.1.0","revision":2,"registeredCapabilities":[{"audit":"always","kind":"filesystem.read","roots":["/tmp/extensions"]}]}"#
        );

        assert_eq!(
            serde_json::to_string(&ExtensionPackageRemoveResultPayload::new(
                "extension-1",
                true,
                3,
            ))
            .expect("remove result should encode"),
            r#"{"packageId":"extension-1","removed":true,"revision":3}"#
        );

        let event = ExtensionPackageEventPayload::new(
            1_710_000_000_000,
            "extension-1",
            ExtensionPackageEventPhase::Installed,
            Some("1.0.0".to_string()),
            Some(1),
            None,
        );
        assert_eq!(
            serde_json::to_string(&event).expect("event should encode"),
            r#"{"type":"extension-package-event","timestamp":1710000000000,"packageId":"extension-1","phase":"installed","version":"1.0.0","revision":1}"#
        );

        assert_eq!(
            serde_json::to_string(&ExtensionPackageSupportedPayload::unsupported(
                EXTENSION_PACKAGE_UNSUPPORTED_REASON,
            ))
            .expect("support payload should encode"),
            r#"{"supported":false,"reason":"host-adapter-unimplemented"}"#
        );
    }

    #[test]
    fn extension_package_events_reject_inconsistent_reasons() {
        for source in [
            r#"{"type":"extension-package-event","timestamp":1710000000000,"packageId":"extension-1","phase":"installing","reason":"host failed"}"#,
            r#"{"type":"extension-package-event","timestamp":1710000000000,"packageId":"extension-1","phase":"installed","version":"1.0.0","revision":1,"reason":"host failed"}"#,
            r#"{"type":"extension-package-event","timestamp":1710000000000,"packageId":"extension-1","phase":"updating","reason":"host failed"}"#,
            r#"{"type":"extension-package-event","timestamp":1710000000000,"packageId":"extension-1","phase":"updated","version":"1.1.0","revision":2,"reason":"host failed"}"#,
            r#"{"type":"extension-package-event","timestamp":1710000000000,"packageId":"extension-1","phase":"removing","reason":"host failed"}"#,
            r#"{"type":"extension-package-event","timestamp":1710000000000,"packageId":"extension-1","phase":"removed","revision":3,"reason":"host failed"}"#,
            r#"{"type":"extension-package-event","timestamp":1710000000000,"packageId":"extension-1","phase":"failed"}"#,
        ] {
            serde_json::from_str::<ExtensionPackageEventPayload>(source)
                .expect_err("inconsistent extension package event should be rejected");
        }

        for source in [
            r#"{"type":"extension-package-event","timestamp":1710000000000,"packageId":"extension-1","phase":"installing"}"#,
            r#"{"type":"extension-package-event","timestamp":1710000000000,"packageId":"extension-1","phase":"installed","version":"1.0.0","revision":1}"#,
            r#"{"type":"extension-package-event","timestamp":1710000000000,"packageId":"extension-1","phase":"failed","reason":"host failed"}"#,
        ] {
            serde_json::from_str::<ExtensionPackageEventPayload>(source)
                .expect("consistent extension package event should decode");
        }
    }

    #[test]
    fn extension_package_events_reject_inconsistent_reasons_before_serializing() {
        let successful = ExtensionPackageEventPayload::new(
            1_710_000_000_000,
            "extension-1",
            ExtensionPackageEventPhase::Installed,
            Some("1.0.0".to_string()),
            Some(1),
            Some("host failed".to_string()),
        );
        serde_json::to_string(&successful)
            .expect_err("successful extension package event with reason should not encode");

        let failed = ExtensionPackageEventPayload::new(
            1_710_000_000_000,
            "extension-1",
            ExtensionPackageEventPhase::Failed,
            None,
            None,
            None,
        );
        serde_json::to_string(&failed)
            .expect_err("failed extension package event without reason should not encode");
    }

    #[test]
    fn local_tool_runtime_payloads_serialize_canonically() {
        let actor =
            LocalToolRuntimeActorPayload::new(LocalToolRuntimeActorKind::Extension, "extension-1");
        let command = LocalToolRuntimeCommandPayload::new(
            "node-version",
            "/usr/bin/node",
            vec!["--version".to_string()],
            Some("/tmp/app".to_string()),
            vec![LocalToolRuntimeEnvironmentEntryPayload::new(
                "PATH", "/usr/bin",
            )],
            Some(1_000),
        );
        let permission = serde_json::json!({
            "kind": "process.spawn",
            "commands": ["/usr/bin/node"],
            "cwd": ["/tmp/app"],
            "environment": "allowlist",
            "shell": false,
            "audit": "always"
        });
        let policy = local_tool_runtime_policy();
        let manifest = LocalToolRuntimeManifestPayload::new(
            "tool-1",
            "Tool One",
            "1.0.0",
            vec![command],
            vec![permission],
            policy,
        )
        .with_health(LocalToolRuntimeHealthCheckPayload::new(
            "node-version",
            10_000,
            1_000,
        ));
        let register = LocalToolRuntimeRegisterPayload::new(
            actor,
            manifest,
            Some("runtime-1".to_string()),
            Some("trace-register".to_string()),
        );

        assert_eq!(
            serde_json::to_string(&register).expect("register payload should encode"),
            r#"{"actor":{"kind":"extension","id":"extension-1"},"manifest":{"toolId":"tool-1","name":"Tool One","version":"1.0.0","commands":[{"commandId":"node-version","executable":"/usr/bin/node","defaultArgs":["--version"],"cwd":"/tmp/app","environment":[{"name":"PATH","value":"/usr/bin"}],"timeoutMillis":1000}],"permissions":[{"audit":"always","commands":["/usr/bin/node"],"cwd":["/tmp/app"],"environment":"allowlist","kind":"process.spawn","shell":false}],"policy":{"cwd":{"roots":["/tmp/app"]},"environment":{"variables":[{"name":"PATH","value":"/usr/bin"}]},"filesystem":{"readRoots":["/tmp/app"]},"network":{"hosts":["api.example.test"]},"budgets":{"cpuMillis":500,"memoryBytes":67108864,"wallClockMillis":1000,"stdoutBytes":1024,"stderrBytes":1024},"stdio":{"stdout":"capture","stderr":"capture"},"cleanup":{"killProcessTree":true,"removeWorkingDirectory":true}},"health":{"commandId":"node-version","intervalMillis":10000,"timeoutMillis":1000}},"runtimeId":"runtime-1","traceId":"trace-register"}"#
        );

        let manifest = register.manifest().clone();
        assert_eq!(
            serde_json::to_string(&LocalToolRuntimeRegisterResultPayload::registered(
                "runtime-1",
                "tool-1",
                manifest,
            ))
            .expect("register result should encode"),
            r#"{"runtimeId":"runtime-1","toolId":"tool-1","manifest":{"toolId":"tool-1","name":"Tool One","version":"1.0.0","commands":[{"commandId":"node-version","executable":"/usr/bin/node","defaultArgs":["--version"],"cwd":"/tmp/app","environment":[{"name":"PATH","value":"/usr/bin"}],"timeoutMillis":1000}],"permissions":[{"audit":"always","commands":["/usr/bin/node"],"cwd":["/tmp/app"],"environment":"allowlist","kind":"process.spawn","shell":false}],"policy":{"cwd":{"roots":["/tmp/app"]},"environment":{"variables":[{"name":"PATH","value":"/usr/bin"}]},"filesystem":{"readRoots":["/tmp/app"]},"network":{"hosts":["api.example.test"]},"budgets":{"cpuMillis":500,"memoryBytes":67108864,"wallClockMillis":1000,"stdoutBytes":1024,"stderrBytes":1024},"stdio":{"stdout":"capture","stderr":"capture"},"cleanup":{"killProcessTree":true,"removeWorkingDirectory":true}},"health":{"commandId":"node-version","intervalMillis":10000,"timeoutMillis":1000}},"state":"registered"}"#
        );

        let run = LocalToolRuntimeRunPayload::new(
            "runtime-1",
            "node-version",
            vec!["--version".to_string()],
            Some("run-1".to_string()),
            Some("trace-run".to_string()),
        );
        assert_eq!(run.runtime_id(), "runtime-1");
        assert_eq!(run.command_id(), "node-version");
        assert_eq!(
            serde_json::to_string(&run).expect("run payload should encode"),
            r#"{"runtimeId":"runtime-1","commandId":"node-version","args":["--version"],"runId":"run-1","traceId":"trace-run"}"#
        );

        assert_eq!(
            serde_json::to_string(&LocalToolRuntimeRunResultPayload::new(
                "runtime-1",
                "node-version",
                "run-1",
                LocalToolRuntimeRunStatus::Completed,
                Some(0),
                "v20.0.0",
                "",
            ))
            .expect("run result should encode"),
            r#"{"runtimeId":"runtime-1","commandId":"node-version","runId":"run-1","status":"completed","exitCode":0,"stdout":"v20.0.0","stderr":""}"#
        );

        assert_eq!(
            serde_json::to_string(&LocalToolRuntimeHealthResultPayload::new(
                "runtime-1",
                LocalToolRuntimeHealthStatus::Healthy,
                1_710_000_000_000,
                None,
            ))
            .expect("health result should encode"),
            r#"{"runtimeId":"runtime-1","status":"healthy","checkedAt":1710000000000}"#
        );

        assert_eq!(
            serde_json::to_string(&LocalToolRuntimeStopResultPayload::stopped("runtime-1"))
                .expect("stop result should encode"),
            r#"{"runtimeId":"runtime-1","stopped":true}"#
        );

        let event = LocalToolRuntimeEventPayload::new(
            1_710_000_000_000,
            "runtime-1",
            LocalToolRuntimeEventPhase::RunCompleted,
        )
        .with_run(
            "tool-1",
            "node-version",
            "run-1",
            LocalToolRuntimeRunStatus::Completed,
        );
        assert_eq!(
            serde_json::to_string(&event).expect("event should encode"),
            r#"{"type":"local-tool-runtime-event","timestamp":1710000000000,"runtimeId":"runtime-1","toolId":"tool-1","commandId":"node-version","runId":"run-1","phase":"run-completed","status":"completed"}"#
        );

        assert_eq!(
            serde_json::to_string(&LocalToolRuntimeSupportedPayload::unsupported(
                LOCAL_TOOL_RUNTIME_UNSUPPORTED_REASON,
            ))
            .expect("support payload should encode"),
            r#"{"supported":false,"reason":"host-adapter-unimplemented"}"#
        );

        let empty_policy = LocalToolRuntimePolicyPayload::new(
            LocalToolRuntimeCwdPolicyPayload::new(vec!["/tmp/app".to_string()]),
            LocalToolRuntimeEnvironmentPolicyPayload::new(vec![]),
            LocalToolRuntimeFilesystemPolicyPayload::new(vec![], vec![]),
            LocalToolRuntimeNetworkPolicyPayload::new(vec![]),
            LocalToolRuntimeBudgetPolicyPayload::new(500, 67_108_864, 1_000, 1_024, 1_024),
            LocalToolRuntimeStdioPolicyPayload::new(
                LocalToolRuntimeStdioMode::Capture,
                LocalToolRuntimeStdioMode::Capture,
            ),
            LocalToolRuntimeCleanupPolicyPayload::new(true, true),
        );
        assert_eq!(
            serde_json::to_string(&empty_policy).expect("empty policy should encode"),
            r#"{"cwd":{"roots":["/tmp/app"]},"environment":{"variables":[]},"filesystem":{},"network":{},"budgets":{"cpuMillis":500,"memoryBytes":67108864,"wallClockMillis":1000,"stdoutBytes":1024,"stderrBytes":1024},"stdio":{"stdout":"capture","stderr":"capture"},"cleanup":{"killProcessTree":true,"removeWorkingDirectory":true}}"#
        );
    }

    #[test]
    fn local_tool_runtime_events_reject_inconsistent_phase_payloads() {
        for source in [
            r#"{"type":"local-tool-runtime-event","timestamp":1710000000000,"runtimeId":"runtime-1","phase":"run-completed"}"#,
            r#"{"type":"local-tool-runtime-event","timestamp":1710000000000,"runtimeId":"runtime-1","phase":"registered","status":"completed"}"#,
            r#"{"type":"local-tool-runtime-event","timestamp":1710000000000,"runtimeId":"runtime-1","phase":"run-started","toolId":"tool-1","commandId":"node-version","runId":"run-1","status":"completed"}"#,
            r#"{"type":"local-tool-runtime-event","timestamp":1710000000000,"runtimeId":"runtime-1","phase":"health-checked"}"#,
            r#"{"type":"local-tool-runtime-event","timestamp":1710000000000,"runtimeId":"runtime-1","phase":"health-checked","toolId":"tool-1","health":"healthy","status":"failed"}"#,
            r#"{"type":"local-tool-runtime-event","timestamp":1710000000000,"runtimeId":"runtime-1","phase":"stopped","runId":"run-1"}"#,
        ] {
            let error = serde_json::from_str::<LocalToolRuntimeEventPayload>(source)
                .expect_err("inconsistent local tool runtime event should be rejected");
            assert!(
                error.to_string().contains("phase")
                    || error.to_string().contains("run")
                    || error.to_string().contains("status")
                    || error.to_string().contains("health"),
                "unexpected error: {error}"
            );
        }
    }

    #[test]
    fn local_tool_runtime_events_reject_inconsistent_phase_payloads_before_serializing() {
        for event in [
            LocalToolRuntimeEventPayload::new(
                1_710_000_000_000,
                "runtime-1",
                LocalToolRuntimeEventPhase::RunCompleted,
            ),
            LocalToolRuntimeEventPayload::new(
                1_710_000_000_000,
                "runtime-1",
                LocalToolRuntimeEventPhase::Registered,
            )
            .with_run(
                "tool-1",
                "node-version",
                "run-1",
                LocalToolRuntimeRunStatus::Completed,
            ),
            LocalToolRuntimeEventPayload::new(
                1_710_000_000_000,
                "runtime-1",
                LocalToolRuntimeEventPhase::HealthChecked,
            ),
            LocalToolRuntimeEventPayload::new(
                1_710_000_000_000,
                "runtime-1",
                LocalToolRuntimeEventPhase::Stopped,
            )
            .with_run_ref("tool-1", "node-version", "run-1"),
        ] {
            let error = serde_json::to_string(&event)
                .expect_err("inconsistent local tool runtime event should not encode");
            assert!(
                error.to_string().contains("phase")
                    || error.to_string().contains("run")
                    || error.to_string().contains("status")
                    || error.to_string().contains("health"),
                "unexpected error: {error}"
            );
        }
    }

    #[test]
    fn workspace_index_payloads_serialize_canonically() {
        let actor =
            WorkspaceIndexActorPayload::new(WorkspaceIndexActorKind::Workspace, "workspace-1");
        let grant = serde_json::json!({
            "kind": "filesystem.read",
            "roots": ["/workspace/app"],
            "audit": "always"
        });
        let scope = WorkspaceIndexScopePayload::new(
            "/workspace/app",
            vec![WorkspaceIndexIgnoreRulePayload::new(
                "node_modules/**",
                Some("dependencies".to_string()),
            )],
            vec![grant],
            true,
        );
        let open = WorkspaceIndexOpenPayload::new(
            actor,
            scope,
            Some("workspace-index-1".to_string()),
            Some("trace-open".to_string()),
        );

        assert_eq!(
            serde_json::to_string(&open).expect("open payload should encode"),
            r#"{"actor":{"kind":"workspace","id":"workspace-1"},"scope":{"root":"/workspace/app","ignoreRules":[{"pattern":"node_modules/**","reason":"dependencies"}],"grants":[{"audit":"always","kind":"filesystem.read","roots":["/workspace/app"]}],"watch":true},"indexId":"workspace-index-1","traceId":"trace-open"}"#
        );

        assert_eq!(
            serde_json::to_string(&WorkspaceIndexOpenResultPayload::opened(
                "workspace-index-1",
                "/workspace/app",
            ))
            .expect("open result should encode"),
            r#"{"indexId":"workspace-index-1","root":"/workspace/app","state":"opened"}"#
        );

        let refresh = WorkspaceIndexRefreshPayload::new(
            "workspace-index-1",
            vec!["/workspace/app/src/main.ts".to_string()],
            Some("trace-refresh".to_string()),
        );
        assert_eq!(
            serde_json::to_string(&refresh).expect("refresh payload should encode"),
            r#"{"indexId":"workspace-index-1","changedPaths":["/workspace/app/src/main.ts"],"traceId":"trace-refresh"}"#
        );

        assert_eq!(
            serde_json::to_string(&WorkspaceIndexRefreshResultPayload::new(
                "workspace-index-1",
                WorkspaceIndexState::Opened,
                1,
                2,
                3,
            ))
            .expect("refresh result should encode"),
            r#"{"indexId":"workspace-index-1","state":"opened","indexed":1,"invalidated":2,"ignored":3}"#
        );

        let close =
            WorkspaceIndexClosePayload::new("workspace-index-1", Some("trace-close".to_string()));
        assert_eq!(
            serde_json::to_string(&close).expect("close payload should encode"),
            r#"{"indexId":"workspace-index-1","traceId":"trace-close"}"#
        );

        assert_eq!(
            serde_json::to_string(&WorkspaceIndexCloseResultPayload::closed(
                "workspace-index-1",
            ))
            .expect("close result should encode"),
            r#"{"indexId":"workspace-index-1","closed":true}"#
        );

        let event = WorkspaceIndexEventPayload::new(
            1_710_000_000_000,
            "workspace-index-1",
            WorkspaceIndexEventPhase::RefreshCompleted,
        )
        .with_root("/workspace/app", WorkspaceIndexState::Opened);
        assert_eq!(
            serde_json::to_string(&event).expect("event should encode"),
            r#"{"type":"workspace-index-event","timestamp":1710000000000,"indexId":"workspace-index-1","root":"/workspace/app","phase":"refresh-completed","state":"opened"}"#
        );

        assert_eq!(
            serde_json::to_string(&WorkspaceIndexSupportedPayload::unsupported(
                WORKSPACE_INDEX_UNSUPPORTED_REASON,
            ))
            .expect("support payload should encode"),
            r#"{"supported":false,"reason":"host-adapter-unimplemented"}"#
        );
    }

    #[test]
    fn workspace_index_events_reject_inconsistent_phase_states() {
        for source in [
            r#"{"type":"workspace-index-event","timestamp":1710000000000,"indexId":"workspace-index-1","phase":"closed","state":"opened"}"#,
            r#"{"type":"workspace-index-event","timestamp":1710000000000,"indexId":"workspace-index-1","phase":"opened","state":"closed"}"#,
            r#"{"type":"workspace-index-event","timestamp":1710000000000,"indexId":"workspace-index-1","phase":"entry-indexed","state":"opened"}"#,
        ] {
            let error = serde_json::from_str::<WorkspaceIndexEventPayload>(source)
                .expect_err("inconsistent workspace index event should be rejected");
            assert!(
                error.to_string().contains("phase") || error.to_string().contains("state"),
                "unexpected error: {error}"
            );
        }
    }

    #[test]
    fn workspace_index_events_reject_inconsistent_phase_states_before_serializing() {
        for event in [
            WorkspaceIndexEventPayload::new(
                1_710_000_000_000,
                "workspace-index-1",
                WorkspaceIndexEventPhase::Closed,
            )
            .with_root("/workspace/app", WorkspaceIndexState::Opened),
            WorkspaceIndexEventPayload::new(
                1_710_000_000_000,
                "workspace-index-1",
                WorkspaceIndexEventPhase::EntryIndexed,
            )
            .with_root("/workspace/app", WorkspaceIndexState::Opened),
        ] {
            let error = serde_json::to_string(&event)
                .expect_err("inconsistent workspace index event should not encode");
            assert!(
                error.to_string().contains("phase") || error.to_string().contains("state"),
                "unexpected error: {error}"
            );
        }
    }

    #[test]
    fn transactional_file_mutation_payloads_serialize_canonically() {
        let actor = TransactionalFileMutationActorPayload::new(
            TransactionalFileMutationActorKind::Workspace,
            "workspace-1",
        );
        let prepare = TransactionalFileMutationPreparePayload::new(
            actor.clone(),
            "/workspace/app/src/main.ts",
            b"next\n".to_vec(),
            Some("fnv1a-source".to_string()),
            Some("file-mutation-1".to_string()),
            Some("scope-workspace".to_string()),
            Some("trace-prepare".to_string()),
        );
        assert_eq!(
            serde_json::to_string(&prepare).expect("prepare payload should encode"),
            r#"{"actor":{"kind":"workspace","id":"workspace-1"},"path":"/workspace/app/src/main.ts","replacementBytes":[110,101,120,116,10],"expectedSourceHash":"fnv1a-source","mutationId":"file-mutation-1","ownerScope":"scope-workspace","traceId":"trace-prepare"}"#
        );

        let diff = TransactionalFileMutationDiffPayload::unified(
            "--- /workspace/app/src/main.ts\n+++ /workspace/app/src/main.ts",
            1,
            1,
        );
        assert_eq!(
            serde_json::to_string(&TransactionalFileMutationPrepareResultPayload::prepared(
                "file-mutation-1",
                "/workspace/app/src/main.ts",
                "scope-workspace",
                "fnv1a-source",
                "fnv1a-next",
                diff,
            ))
            .expect("prepare result should encode"),
            r#"{"mutationId":"file-mutation-1","path":"/workspace/app/src/main.ts","state":"prepared","ownerScope":"scope-workspace","sourceHash":"fnv1a-source","replacementHash":"fnv1a-next","diff":{"format":"unified","text":"--- /workspace/app/src/main.ts\n+++ /workspace/app/src/main.ts","additions":1,"deletions":1}}"#
        );

        let commit = TransactionalFileMutationCommitPayload::new(
            actor.clone(),
            "file-mutation-1",
            Some("fnv1a-source".to_string()),
            Some("trace-commit".to_string()),
        );
        assert_eq!(
            serde_json::to_string(&commit).expect("commit payload should encode"),
            r#"{"actor":{"kind":"workspace","id":"workspace-1"},"mutationId":"file-mutation-1","expectedSourceHash":"fnv1a-source","traceId":"trace-commit"}"#
        );

        assert_eq!(
            serde_json::to_string(&TransactionalFileMutationCommitResultPayload::committed(
                "file-mutation-1",
                "/workspace/app/src/main.ts",
            ))
            .expect("commit result should encode"),
            r#"{"mutationId":"file-mutation-1","path":"/workspace/app/src/main.ts","state":"committed","committed":true}"#
        );

        let rollback = TransactionalFileMutationRollbackPayload::new(
            actor,
            "file-mutation-1",
            Some("trace-rollback".to_string()),
        );
        assert_eq!(
            serde_json::to_string(&rollback).expect("rollback payload should encode"),
            r#"{"actor":{"kind":"workspace","id":"workspace-1"},"mutationId":"file-mutation-1","traceId":"trace-rollback"}"#
        );

        assert_eq!(
            serde_json::to_string(
                &TransactionalFileMutationRollbackResultPayload::rolled_back(
                    "file-mutation-1",
                    "/workspace/app/src/main.ts",
                )
            )
            .expect("rollback result should encode"),
            r#"{"mutationId":"file-mutation-1","path":"/workspace/app/src/main.ts","state":"rolled-back","rolledBack":true}"#
        );

        let event = TransactionalFileMutationEventPayload::new(
            1_710_000_000_000,
            "file-mutation-1",
            TransactionalFileMutationEventPhase::Committed,
        )
        .with_file(
            "/workspace/app/src/main.ts",
            TransactionalFileMutationState::Committed,
        );
        assert_eq!(
            serde_json::to_string(&event).expect("event should encode"),
            r#"{"type":"transactional-file-mutation-event","timestamp":1710000000000,"mutationId":"file-mutation-1","path":"/workspace/app/src/main.ts","phase":"committed","state":"committed"}"#
        );

        assert_eq!(
            serde_json::to_string(&TransactionalFileMutationSupportedPayload::unsupported(
                TRANSACTIONAL_FILE_MUTATION_UNSUPPORTED_REASON,
            ))
            .expect("support payload should encode"),
            r#"{"supported":false,"reason":"host-adapter-unimplemented"}"#
        );
        assert_eq!(
            serde_json::to_string(&TransactionalFileMutationSupportedPayload::supported())
                .expect("support payload should encode"),
            r#"{"supported":true}"#
        );
    }

    #[test]
    fn scoped_access_grant_events_reject_contradictory_states() {
        for source in [
            r#"{"type":"scoped-access-grant-event","timestamp":1710000000000,"grantId":"grant-1","path":"/tmp/example.txt","phase":"granted","state":"revoked"}"#,
            r#"{"type":"scoped-access-grant-event","timestamp":1710000000000,"grantId":"grant-1","phase":"resolved","state":"granted"}"#,
            r#"{"type":"scoped-access-grant-event","timestamp":1710000000000,"grantId":"grant-1","phase":"revoked","state":"resolved"}"#,
        ] {
            let error = serde_json::from_str::<ScopedAccessGrantEventPayload>(source)
                .expect_err("contradictory scoped access grant event should be rejected");
            assert!(
                error.to_string().contains("phase") || error.to_string().contains("state"),
                "unexpected error: {error}"
            );
        }
    }

    #[test]
    fn scoped_access_grant_events_reject_contradictory_states_before_serializing() {
        for event in [
            ScopedAccessGrantEventPayload::new(
                1_710_000_000_000,
                "grant-1",
                ScopedAccessGrantEventPhase::Granted,
            )
            .with_state_for_test(ScopedAccessGrantState::Revoked),
            ScopedAccessGrantEventPayload::new(
                1_710_000_000_000,
                "grant-1",
                ScopedAccessGrantEventPhase::Resolved,
            )
            .with_state_for_test(ScopedAccessGrantState::Granted),
            ScopedAccessGrantEventPayload::new(
                1_710_000_000_000,
                "grant-1",
                ScopedAccessGrantEventPhase::Revoked,
            )
            .with_state_for_test(ScopedAccessGrantState::Resolved),
        ] {
            let error = serde_json::to_string(&event)
                .expect_err("contradictory scoped access grant event should not encode");
            assert!(
                error.to_string().contains("phase") || error.to_string().contains("state"),
                "unexpected error: {error}"
            );
        }
    }

    #[test]
    fn execution_sandbox_create_rejects_excess_fields() {
        let value = serde_json::json!({
            "actor": { "kind": "extension", "id": "extension-1" },
            "policy": {
                "cwd": "/tmp/app",
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
            "rules": []
        });

        let error = serde_json::from_value::<ExecutionSandboxCreatePayload>(value)
            .expect_err("excess field should be rejected");
        assert!(error.to_string().contains("unknown field `rules`"));
    }

    fn execution_sandbox_policy() -> ExecutionSandboxPolicyPayload {
        ExecutionSandboxPolicyPayload::new(
            "/tmp/app",
            vec![ExecutionSandboxEnvironmentEntryPayload::new(
                "PATH", "/usr/bin",
            )],
            ExecutionSandboxFilesystemPolicyPayload::new(
                vec!["/tmp/app".to_string()],
                vec!["/tmp/app/out".to_string()],
            ),
            ExecutionSandboxNetworkPolicyPayload::new(vec!["api.example.test".to_string()]),
            ExecutionSandboxBudgetPolicyPayload::new(500, 67_108_864, 1_000, 1_024, 1_024),
            ExecutionSandboxCleanupPolicyPayload::new(true, true),
        )
    }

    fn local_tool_runtime_policy() -> LocalToolRuntimePolicyPayload {
        LocalToolRuntimePolicyPayload::new(
            LocalToolRuntimeCwdPolicyPayload::new(vec!["/tmp/app".to_string()]),
            LocalToolRuntimeEnvironmentPolicyPayload::new(vec![
                LocalToolRuntimeEnvironmentEntryPayload::new("PATH", "/usr/bin"),
            ]),
            LocalToolRuntimeFilesystemPolicyPayload::new(vec!["/tmp/app".to_string()], vec![]),
            LocalToolRuntimeNetworkPolicyPayload::new(vec!["api.example.test".to_string()]),
            LocalToolRuntimeBudgetPolicyPayload::new(500, 67_108_864, 1_000, 1_024, 1_024),
            LocalToolRuntimeStdioPolicyPayload::new(
                LocalToolRuntimeStdioMode::Capture,
                LocalToolRuntimeStdioMode::Capture,
            ),
            LocalToolRuntimeCleanupPolicyPayload::new(true, true),
        )
    }

    #[test]
    fn reconnect_defaults_match_spec_values() {
        assert_eq!(DEFAULT_RECONNECT_WINDOW_MS, 30_000);
        assert_eq!(DEFAULT_MAX_BACKFILL_EVENTS, 1_024);
    }

    #[test]
    fn session_profile_payloads_serialize_canonically() {
        let profile =
            SessionProfileResourcePayload::new("session-profile:workspace-1", 0, "workspace:1");
        assert_eq!(profile.id(), "session-profile:workspace-1");
        assert_eq!(profile.owner_scope(), "workspace:1");
        assert_eq!(
            serde_json::to_string(&profile).expect("profile handle should encode"),
            r#"{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"}"#
        );

        let from_partition =
            SessionProfileFromPartitionPayload::new("workspace-1").with_owner_scope("workspace:1");
        assert_eq!(from_partition.partition(), "workspace-1");
        assert_eq!(from_partition.owner_scope(), Some("workspace:1"));
        assert_eq!(
            serde_json::to_string(&from_partition).expect("partition payload should encode"),
            r#"{"partition":"workspace-1","ownerScope":"workspace:1"}"#
        );

        let destroy = SessionProfileHandlePayload::new(profile.clone());
        assert_eq!(destroy.profile().id(), "session-profile:workspace-1");
        assert_eq!(
            serde_json::to_string(&destroy).expect("destroy payload should encode"),
            r#"{"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"}}"#
        );

        let list = SessionProfileListPayload::new(vec![profile.clone()]);
        assert_eq!(list.profiles().len(), 1);
        assert_eq!(
            serde_json::to_string(&list).expect("list payload should encode"),
            r#"{"profiles":[{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"}]}"#
        );

        assert_eq!(
            serde_json::to_string(&SessionProfileSupportedPayload::unsupported(
                "host-session-profile-routing-unavailable"
            ))
            .expect("support payload should encode"),
            r#"{"supported":false,"reason":"host-session-profile-routing-unavailable"}"#
        );
        assert_eq!(
            serde_json::to_string(&SessionProfileEventPayload::opened(
                1_710_000_000_000,
                profile.clone(),
                "workspace-1",
            ))
            .expect("opened event should encode"),
            r#"{"type":"session-profile-event","timestamp":1710000000000,"phase":"opened","profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"partition":"workspace-1"}"#
        );
        assert_eq!(
            serde_json::to_string(&SessionProfileEventPayload::closed(
                1_710_000_000_001,
                profile,
                "workspace-1",
            ))
            .expect("closed event should encode"),
            r#"{"type":"session-profile-event","timestamp":1710000000001,"phase":"closed","profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"partition":"workspace-1"}"#
        );
        assert_eq!(
            serde_json::to_string(&SessionProfileEventPayload::failed(
                1_710_000_000_002,
                "host failed",
            ))
            .expect("failed event should encode"),
            r#"{"type":"session-profile-event","timestamp":1710000000002,"phase":"failed","message":"host failed"}"#
        );
    }

    #[test]
    fn session_profile_events_reject_inconsistent_phase_payloads() {
        for source in [
            r#"{"type":"session-profile-event","timestamp":1710000000000,"phase":"opened","message":"host failed"}"#,
            r#"{"type":"session-profile-event","timestamp":1710000000000,"phase":"closed","profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"partition":"workspace-1","message":"closed with failure"}"#,
            r#"{"type":"session-profile-event","timestamp":1710000000000,"phase":"failed","profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"partition":"workspace-1","message":"host failed"}"#,
        ] {
            let error = serde_json::from_str::<SessionProfileEventPayload>(source)
                .expect_err("inconsistent session profile event should be rejected");
            assert!(
                error.to_string().contains("profile")
                    || error.to_string().contains("message")
                    || error.to_string().contains("phase"),
                "unexpected error: {error}"
            );
        }
    }

    #[test]
    fn session_profile_events_reject_inconsistent_phase_payloads_before_serializing() {
        let profile =
            SessionProfileResourcePayload::new("session-profile:workspace-1", 0, "workspace:1");
        for event in [
            SessionProfileEventPayload::new_for_test(
                1_710_000_000_000,
                SessionProfileEventPhasePayload::Opened,
            )
            .with_message_for_test("host failed"),
            SessionProfileEventPayload::new_for_test(
                1_710_000_000_000,
                SessionProfileEventPhasePayload::Closed,
            )
            .with_profile_for_test(profile.clone(), "workspace-1")
            .with_message_for_test("closed with failure"),
            SessionProfileEventPayload::new_for_test(
                1_710_000_000_000,
                SessionProfileEventPhasePayload::Failed,
            )
            .with_profile_for_test(profile, "workspace-1")
            .with_message_for_test("host failed"),
        ] {
            let error = serde_json::to_string(&event)
                .expect_err("inconsistent session profile event should not encode");
            assert!(
                error.to_string().contains("profile")
                    || error.to_string().contains("message")
                    || error.to_string().contains("phase"),
                "unexpected error: {error}"
            );
        }
    }

    #[test]
    fn cookie_store_payloads_serialize_canonically() {
        let profile =
            SessionProfileResourcePayload::new("session-profile:workspace-1", 0, "workspace:1");
        let cookie =
            CookieStoreCookiePayload::new("token", "secret", "example.test", "/").with_secure(true);
        assert_eq!(
            serde_json::to_string(&cookie).expect("cookie should encode"),
            r#"{"name":"token","value":"secret","domain":"example.test","path":"/","secure":true}"#
        );

        assert_eq!(
            serde_json::to_string(&CookieStoreGetPayload::new(
                profile.clone(),
                "https://example.test/account"
            ))
            .expect("get payload should encode"),
            r#"{"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"url":"https://example.test/account"}"#
        );
        assert_eq!(
            serde_json::to_string(&CookieStoreSetPayload::new(
                profile.clone(),
                "https://example.test/account",
                cookie.clone()
            ))
            .expect("set payload should encode"),
            r#"{"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"url":"https://example.test/account","cookie":{"name":"token","value":"secret","domain":"example.test","path":"/","secure":true}}"#
        );
        assert_eq!(
            serde_json::to_string(&CookieStoreRemovePayload::new(
                profile.clone(),
                "https://example.test/account",
                "token"
            ))
            .expect("remove payload should encode"),
            r#"{"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"url":"https://example.test/account","name":"token"}"#
        );
        assert_eq!(
            serde_json::to_string(&CookieStoreGetResultPayload::new(vec![cookie.clone()]))
                .expect("get result should encode"),
            r#"{"cookies":[{"name":"token","value":"secret","domain":"example.test","path":"/","secure":true}]}"#
        );
        assert_eq!(
            serde_json::to_string(&CookieStoreSupportedPayload::supported())
                .expect("support payload should encode"),
            r#"{"supported":true}"#
        );
        assert_eq!(
            serde_json::to_string(&CookieStoreEventPayload::set(
                1_710_000_000_000,
                profile.clone(),
                "https://example.test/account",
                cookie.clone()
            ))
            .expect("set event should encode"),
            r#"{"type":"cookie-store-event","timestamp":1710000000000,"phase":"set","profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"url":"https://example.test/account","cookie":{"name":"token","value":"secret","domain":"example.test","path":"/","secure":true}}"#
        );
        assert_eq!(
            serde_json::to_string(&CookieStoreEventPayload::removed(
                1_710_000_000_001,
                profile.clone(),
                "https://example.test/account",
                "token"
            ))
            .expect("removed event should encode"),
            r#"{"type":"cookie-store-event","timestamp":1710000000001,"phase":"removed","profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"url":"https://example.test/account","name":"token"}"#
        );
        assert_eq!(
            serde_json::to_string(&CookieStoreEventPayload::failed(
                1_710_000_000_002,
                profile,
                "https://example.test/account",
                "host failed"
            ))
            .expect("failed event should encode"),
            r#"{"type":"cookie-store-event","timestamp":1710000000002,"phase":"failed","profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"url":"https://example.test/account","message":"host failed"}"#
        );
    }

    #[test]
    fn cookie_store_events_reject_inconsistent_phase_payloads() {
        for source in [
            r#"{"type":"cookie-store-event","timestamp":1710000000000,"phase":"set","profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"url":"https://example.test/account","name":"token","message":"bad shape"}"#,
            r#"{"type":"cookie-store-event","timestamp":1710000000000,"phase":"removed","profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"url":"https://example.test/account","cookie":{"name":"token","value":"secret","domain":"example.test","path":"/"}}"#,
            r#"{"type":"cookie-store-event","timestamp":1710000000000,"phase":"failed","profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"url":"https://example.test/account","cookie":{"name":"token","value":"secret","domain":"example.test","path":"/"},"message":"host failed"}"#,
        ] {
            let error = serde_json::from_str::<CookieStoreEventPayload>(source)
                .expect_err("inconsistent cookie store event should be rejected");
            assert!(
                error.to_string().contains("cookie")
                    || error.to_string().contains("message")
                    || error.to_string().contains("phase"),
                "unexpected error: {error}"
            );
        }
    }

    #[test]
    fn cookie_store_events_reject_inconsistent_phase_payloads_before_serializing() {
        let profile =
            SessionProfileResourcePayload::new("session-profile:workspace-1", 0, "workspace:1");
        let cookie = CookieStoreCookiePayload::new("token", "secret", "example.test", "/");

        for event in [
            CookieStoreEventPayload::new_for_test(
                1_710_000_000_000,
                CookieStoreEventPhasePayload::Set,
                profile.clone(),
                "https://example.test/account",
            )
            .with_name_for_test("token")
            .with_message_for_test("bad shape"),
            CookieStoreEventPayload::new_for_test(
                1_710_000_000_000,
                CookieStoreEventPhasePayload::Removed,
                profile.clone(),
                "https://example.test/account",
            )
            .with_cookie_for_test(cookie.clone()),
            CookieStoreEventPayload::new_for_test(
                1_710_000_000_000,
                CookieStoreEventPhasePayload::Failed,
                profile,
                "https://example.test/account",
            )
            .with_cookie_for_test(cookie)
            .with_message_for_test("host failed"),
        ] {
            let error = serde_json::to_string(&event)
                .expect_err("inconsistent cookie store event should not encode");
            assert!(
                error.to_string().contains("cookie")
                    || error.to_string().contains("message")
                    || error.to_string().contains("phase"),
                "unexpected error: {error}"
            );
        }
    }

    #[test]
    fn browsing_data_payloads_serialize_canonically() {
        let profile =
            SessionProfileResourcePayload::new("session-profile:workspace-1", 0, "workspace:1");
        assert_eq!(
            serde_json::to_string(&BrowsingDataClearPayload::new(
                profile.clone(),
                vec![
                    BrowsingDataTypePayload::Cache,
                    BrowsingDataTypePayload::Cookies,
                    BrowsingDataTypePayload::LocalStorage
                ]
            ))
            .expect("clear payload should encode"),
            r#"{"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"types":["cache","cookies","localStorage"]}"#
        );
        assert_eq!(
            serde_json::to_string(&BrowsingDataEstimatePayload::new(profile.clone()))
                .expect("estimate payload should encode"),
            r#"{"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"}}"#
        );
        assert_eq!(
            serde_json::to_string(&BrowsingDataClearResultPayload::new(
                vec![BrowsingDataTypePayload::Cache],
                vec![BrowsingDataTypePayload::ServiceWorkers]
            ))
            .expect("clear result should encode"),
            r#"{"cleared":["cache"],"unsupported":["serviceWorkers"]}"#
        );
        assert_eq!(
            serde_json::to_string(&BrowsingDataEstimateResultPayload::new(vec![
                BrowsingDataTypeEstimatePayload::new(
                    BrowsingDataTypePayload::IndexedDb,
                    true,
                    Some(1024)
                )
            ]))
            .expect("estimate result should encode"),
            r#"{"estimates":[{"type":"indexedDb","supported":true,"bytes":1024}]}"#
        );
        assert_eq!(
            serde_json::to_string(&BrowsingDataListTypesPayload::new(vec![
                BrowsingDataTypePayload::Cache,
                BrowsingDataTypePayload::Cookies,
                BrowsingDataTypePayload::LocalStorage,
                BrowsingDataTypePayload::IndexedDb,
                BrowsingDataTypePayload::History,
                BrowsingDataTypePayload::ServiceWorkers
            ]))
            .expect("list types payload should encode"),
            r#"{"types":["cache","cookies","localStorage","indexedDb","history","serviceWorkers"]}"#
        );
        assert_eq!(
            serde_json::to_string(&BrowsingDataSupportedPayload::unsupported(
                "host-browsing-data-unavailable"
            ))
            .expect("support payload should encode"),
            r#"{"supported":false,"reason":"host-browsing-data-unavailable"}"#
        );
    }

    #[test]
    fn session_permission_payloads_serialize_canonically() {
        let profile =
            SessionProfileResourcePayload::new("session-profile:workspace-1", 0, "workspace:1");
        assert_eq!(
            serde_json::to_string(
                &SessionPermissionRequestPayload::new(
                    profile.clone(),
                    SessionPermissionKindPayload::DisplayCapture,
                    "https://example.test"
                )
                .with_request_id("permission-request-1")
            )
            .expect("request payload should encode"),
            r#"{"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"kind":"display-capture","origin":"https://example.test","requestId":"permission-request-1"}"#
        );
        assert_eq!(
            serde_json::to_string(&SessionPermissionDecidePayload::new(
                profile.clone(),
                "permission-request-1",
                SessionPermissionKindPayload::ClipboardRead,
                "app://localhost",
                SessionPermissionDecisionPayload::Grant
            ))
            .expect("decide payload should encode"),
            r#"{"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"requestId":"permission-request-1","kind":"clipboard-read","origin":"app://localhost","decision":"grant"}"#
        );
        assert_eq!(
            serde_json::to_string(&SessionPermissionListPayload::new(profile.clone()))
                .expect("list payload should encode"),
            r#"{"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"}}"#
        );
        assert_eq!(
            serde_json::to_string(&SessionPermissionRequestResultPayload::new(
                "permission-request-1"
            ))
            .expect("request result should encode"),
            r#"{"requestId":"permission-request-1","status":"pending"}"#
        );
        let record = SessionPermissionDecisionRecordPayload::new(
            profile.clone(),
            "permission-request-1",
            SessionPermissionKindPayload::Notifications,
            "https://example.test",
            SessionPermissionDecisionPayload::Deny,
            1710000000000,
        );
        assert_eq!(
            serde_json::to_string(&record).expect("decision record should encode"),
            r#"{"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"requestId":"permission-request-1","kind":"notifications","origin":"https://example.test","decision":"deny","decidedAt":1710000000000}"#
        );
        assert_eq!(
            serde_json::to_string(&SessionPermissionListResultPayload::new(vec![record]))
                .expect("list result should encode"),
            r#"{"decisions":[{"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"requestId":"permission-request-1","kind":"notifications","origin":"https://example.test","decision":"deny","decidedAt":1710000000000}]}"#
        );
        assert_eq!(
            serde_json::to_string(
                &SessionPermissionEventPayload::new(
                    1710000000001,
                    SessionPermissionEventPhasePayload::Decided,
                    profile,
                    "permission-request-1",
                    SessionPermissionKindPayload::Camera,
                    "https://example.test"
                )
                .with_decision(SessionPermissionDecisionPayload::Grant)
            )
            .expect("event should encode"),
            r#"{"type":"session-permission-event","timestamp":1710000000001,"phase":"decided","profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"requestId":"permission-request-1","kind":"camera","origin":"https://example.test","decision":"grant"}"#
        );
        assert_eq!(
            serde_json::to_string(&SessionPermissionSupportedPayload::unsupported(
                "host-session-permission-unavailable"
            ))
            .expect("support payload should encode"),
            r#"{"supported":false,"reason":"host-session-permission-unavailable"}"#
        );
    }

    #[test]
    fn session_permission_events_reject_inconsistent_decisions() {
        for source in [
            r#"{"type":"session-permission-event","timestamp":1710000000001,"phase":"decided","profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"requestId":"permission-request-1","kind":"camera","origin":"https://example.test"}"#,
            r#"{"type":"session-permission-event","timestamp":1710000000001,"phase":"requested","profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"requestId":"permission-request-1","kind":"camera","origin":"https://example.test","decision":"grant"}"#,
            r#"{"type":"session-permission-event","timestamp":1710000000001,"phase":"failed","profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"requestId":"permission-request-1","kind":"camera","origin":"https://example.test","decision":"deny"}"#,
        ] {
            let error = serde_json::from_str::<SessionPermissionEventPayload>(source)
                .expect_err("inconsistent session permission event should be rejected");
            assert!(
                error.to_string().contains("decision"),
                "unexpected error: {error}"
            );
        }
    }

    #[test]
    fn session_permission_events_reject_inconsistent_decisions_before_serializing() {
        let profile =
            SessionProfileResourcePayload::new("session-profile:workspace-1", 0, "workspace:1");

        for event in [
            SessionPermissionEventPayload::new(
                1710000000001,
                SessionPermissionEventPhasePayload::Decided,
                profile.clone(),
                "permission-request-1",
                SessionPermissionKindPayload::Camera,
                "https://example.test",
            ),
            SessionPermissionEventPayload::new(
                1710000000001,
                SessionPermissionEventPhasePayload::Requested,
                profile.clone(),
                "permission-request-1",
                SessionPermissionKindPayload::Camera,
                "https://example.test",
            )
            .with_decision(SessionPermissionDecisionPayload::Grant),
            SessionPermissionEventPayload::new(
                1710000000001,
                SessionPermissionEventPhasePayload::Failed,
                profile,
                "permission-request-1",
                SessionPermissionKindPayload::Camera,
                "https://example.test",
            )
            .with_decision(SessionPermissionDecisionPayload::Deny),
        ] {
            let error = serde_json::to_string(&event)
                .expect_err("inconsistent session permission event should not encode");
            assert!(
                error.to_string().contains("decision"),
                "unexpected error: {error}"
            );
        }
    }

    #[test]
    fn download_payloads_serialize_canonically() {
        let profile =
            SessionProfileResourcePayload::new("session-profile:workspace-1", 0, "workspace:1");
        let download = DownloadResourcePayload::new("download:1", 0, "workspace:1");
        assert_eq!(
            serde_json::to_string(
                &DownloadStartPayload::new(profile.clone(), "https://example.test/file.zip")
                    .with_destination("/tmp/file.zip")
            )
            .expect("start payload should encode"),
            r#"{"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"url":"https://example.test/file.zip","destination":"/tmp/file.zip"}"#
        );
        assert_eq!(
            serde_json::to_string(&DownloadHandlePayload::new(download.clone()))
                .expect("handle payload should encode"),
            r#"{"download":{"kind":"download","id":"download:1","generation":0,"ownerScope":"workspace:1","state":"open"}}"#
        );
        assert_eq!(
            serde_json::to_string(&DownloadListPayload::for_profile(profile.clone()))
                .expect("list payload should encode"),
            r#"{"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"}}"#
        );
        let snapshot = DownloadSnapshotPayload::new(
            download.clone(),
            profile.clone(),
            "https://example.test/file.zip",
            DownloadStatePayload::Running,
            128,
        )
        .with_total_bytes(1024);
        assert_eq!(
            serde_json::to_string(&snapshot).expect("snapshot should encode"),
            r#"{"download":{"kind":"download","id":"download:1","generation":0,"ownerScope":"workspace:1","state":"open"},"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"url":"https://example.test/file.zip","state":"running","receivedBytes":128,"totalBytes":1024}"#
        );
        assert_eq!(
            serde_json::to_string(&DownloadListResultPayload::new(vec![snapshot]))
                .expect("list result should encode"),
            r#"{"downloads":[{"download":{"kind":"download","id":"download:1","generation":0,"ownerScope":"workspace:1","state":"open"},"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"url":"https://example.test/file.zip","state":"running","receivedBytes":128,"totalBytes":1024}]}"#
        );
        assert_eq!(
            serde_json::to_string(&DownloadEventPayload::new(
                1710000000000,
                DownloadEventPhasePayload::Canceled,
                download,
                profile,
                "https://example.test/file.zip",
                128
            ))
            .expect("event should encode"),
            r#"{"type":"download-event","timestamp":1710000000000,"phase":"canceled","download":{"kind":"download","id":"download:1","generation":0,"ownerScope":"workspace:1","state":"open"},"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"url":"https://example.test/file.zip","receivedBytes":128}"#
        );
        assert_eq!(
            serde_json::to_string(&DownloadSupportedPayload::unsupported(
                "host-download-unavailable"
            ))
            .expect("support payload should encode"),
            r#"{"supported":false,"reason":"host-download-unavailable"}"#
        );
    }

    #[test]
    fn download_payloads_reject_impossible_byte_progress() {
        let snapshot_error = serde_json::from_str::<DownloadSnapshotPayload>(
            r#"{"download":{"kind":"download","id":"download:1","generation":0,"ownerScope":"workspace:1","state":"open"},"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"url":"https://example.test/file.zip","state":"running","receivedBytes":20,"totalBytes":10}"#,
        )
        .expect_err("impossible download byte progress should be rejected as snapshot");
        assert!(
            snapshot_error.to_string().contains("receivedBytes")
                || snapshot_error.to_string().contains("totalBytes")
                || snapshot_error.to_string().contains("byte"),
            "unexpected error: {snapshot_error}"
        );

        let event_error = serde_json::from_str::<DownloadEventPayload>(
            r#"{"type":"download-event","timestamp":1710000000000,"phase":"progressed","download":{"kind":"download","id":"download:1","generation":0,"ownerScope":"workspace:1","state":"open"},"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"url":"https://example.test/file.zip","receivedBytes":20,"totalBytes":10}"#,
        )
        .expect_err("impossible download byte progress should be rejected as event");
        assert!(
            event_error.to_string().contains("receivedBytes")
                || event_error.to_string().contains("totalBytes")
                || event_error.to_string().contains("byte"),
            "unexpected error: {event_error}"
        );
    }

    #[test]
    fn download_payloads_reject_impossible_byte_progress_before_serializing() {
        let profile =
            SessionProfileResourcePayload::new("session-profile:workspace-1", 0, "workspace:1");
        let download = DownloadResourcePayload::new("download:1", 0, "workspace:1");
        let snapshot = DownloadSnapshotPayload::new(
            download.clone(),
            profile.clone(),
            "https://example.test/file.zip",
            DownloadStatePayload::Running,
            20,
        )
        .with_total_bytes(10);
        let event = DownloadEventPayload {
            r#type: "download-event".to_string(),
            timestamp: 1_710_000_000_000,
            phase: DownloadEventPhasePayload::Progressed,
            download,
            profile,
            url: "https://example.test/file.zip".to_string(),
            destination: None,
            received_bytes: 20,
            total_bytes: Some(10),
            message: None,
        };

        for source in [
            serde_json::to_string(&snapshot),
            serde_json::to_string(&event),
        ] {
            let error = source.expect_err("impossible download byte progress should not encode");
            assert!(
                error.to_string().contains("receivedBytes")
                    || error.to_string().contains("totalBytes")
                    || error.to_string().contains("byte"),
                "unexpected error: {error}"
            );
        }
    }

    #[test]
    fn network_auth_payloads_serialize_canonically() {
        let profile =
            SessionProfileResourcePayload::new("session-profile:workspace-1", 0, "workspace:1");
        assert_eq!(
            serde_json::to_string(
                &NetworkAuthSetProxyPayload::new(
                    profile.clone(),
                    NetworkAuthProxyModePayload::Fixed
                )
                .with_server("http://proxy.example.test:8080")
            )
            .expect("set proxy payload should encode"),
            r#"{"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"mode":"fixed","server":"http://proxy.example.test:8080"}"#
        );
        assert_eq!(
            serde_json::to_string(&NetworkAuthProxyResultPayload::new(
                profile.clone(),
                NetworkAuthProxyModePayload::System
            ))
            .expect("proxy result should encode"),
            r#"{"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"mode":"system","bypass":[]}"#
        );
        assert_eq!(
            serde_json::to_string(
                &NetworkAuthHttpAuthPayload::new(
                    profile.clone(),
                    "auth-request-1",
                    "https://example.test",
                    NetworkAuthDecisionPayload::Allow
                )
                .with_credentials("user", "secret")
            )
            .expect("http auth payload should encode"),
            r#"{"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"requestId":"auth-request-1","origin":"https://example.test","decision":"allow","username":"user","password":"secret"}"#
        );
        let fingerprint = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        assert_eq!(
            serde_json::to_string(&NetworkAuthCertificatePayload::new(
                profile.clone(),
                "cert-request-1",
                "https://example.test",
                fingerprint,
                NetworkAuthDecisionPayload::Deny
            ))
            .expect("certificate payload should encode"),
            r#"{"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"requestId":"cert-request-1","origin":"https://example.test","fingerprintSha256":"sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","decision":"deny"}"#
        );
        assert_eq!(
            serde_json::to_string(&NetworkAuthDecisionRecordPayload::new(
                profile.clone(),
                "cert-request-1",
                "https://example.test",
                NetworkAuthDecisionKindPayload::Certificate,
                NetworkAuthDecisionPayload::Allow,
                1710000000000
            ))
            .expect("decision record should encode"),
            r#"{"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"requestId":"cert-request-1","origin":"https://example.test","kind":"certificate","decision":"allow","decidedAt":1710000000000}"#
        );
        assert_eq!(
            serde_json::to_string(&NetworkAuthEventPayload::certificate_decided(
                1710000000001,
                profile,
                "cert-request-1",
                "https://example.test",
                NetworkAuthDecisionPayload::Allow
            ))
            .expect("event should encode"),
            r#"{"type":"network-auth-event","timestamp":1710000000001,"phase":"certificate-decided","profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"requestId":"cert-request-1","origin":"https://example.test","decision":"allow"}"#
        );
        assert_eq!(
            serde_json::to_string(&NetworkAuthSupportedPayload::unsupported(
                "host-network-auth-unavailable"
            ))
            .expect("support payload should encode"),
            r#"{"supported":false,"reason":"host-network-auth-unavailable"}"#
        );
    }

    #[test]
    fn network_auth_events_reject_inconsistent_phase_payloads() {
        for source in [
            r#"{"type":"network-auth-event","timestamp":1710000000000,"phase":"proxy-updated","profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"requestId":"request-1","decision":"allow"}"#,
            r#"{"type":"network-auth-event","timestamp":1710000000000,"phase":"auth-decided","profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"message":"missing decision"}"#,
            r#"{"type":"network-auth-event","timestamp":1710000000000,"phase":"certificate-decided","profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"requestId":"request-1","origin":"https://example.test","decision":"allow","message":"extra failure"}"#,
            r#"{"type":"network-auth-event","timestamp":1710000000000,"phase":"failed","profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"requestId":"request-1","origin":"https://example.test","decision":"deny","message":"host failed"}"#,
        ] {
            let error = serde_json::from_str::<NetworkAuthEventPayload>(source)
                .expect_err("inconsistent network auth event should be rejected");
            assert!(
                error.to_string().contains("decision")
                    || error.to_string().contains("message")
                    || error.to_string().contains("phase"),
                "unexpected error: {error}"
            );
        }
    }

    #[test]
    fn network_auth_events_reject_inconsistent_phase_payloads_before_serializing() {
        let profile =
            SessionProfileResourcePayload::new("session-profile:workspace-1", 0, "workspace:1");
        for event in [
            NetworkAuthEventPayload::new_for_test(
                1_710_000_000_000,
                NetworkAuthEventPhasePayload::ProxyUpdated,
                profile.clone(),
            )
            .with_decision_for_test(
                "request-1",
                "https://example.test",
                NetworkAuthDecisionPayload::Allow,
            ),
            NetworkAuthEventPayload::new_for_test(
                1_710_000_000_000,
                NetworkAuthEventPhasePayload::AuthDecided,
                profile.clone(),
            )
            .with_message_for_test("missing decision"),
            NetworkAuthEventPayload::new_for_test(
                1_710_000_000_000,
                NetworkAuthEventPhasePayload::CertificateDecided,
                profile.clone(),
            )
            .with_decision_for_test(
                "request-1",
                "https://example.test",
                NetworkAuthDecisionPayload::Allow,
            )
            .with_message_for_test("extra failure"),
            NetworkAuthEventPayload::new_for_test(
                1_710_000_000_000,
                NetworkAuthEventPhasePayload::Failed,
                profile,
            )
            .with_decision_for_test(
                "request-1",
                "https://example.test",
                NetworkAuthDecisionPayload::Deny,
            )
            .with_message_for_test("host failed"),
        ] {
            let error = serde_json::to_string(&event)
                .expect_err("inconsistent network auth event should not encode");
            assert!(
                error.to_string().contains("decision")
                    || error.to_string().contains("message")
                    || error.to_string().contains("phase"),
                "unexpected error: {error}"
            );
        }
    }

    #[test]
    fn web_request_payloads_serialize_canonically() {
        let profile =
            SessionProfileResourcePayload::new("session-profile:workspace-1", 0, "workspace:1");
        let interceptor = WebRequestInterceptorResourcePayload::new(
            "web-request-interceptor:1",
            0,
            "workspace:1",
        );
        let headers = vec![WebRequestHeaderPayload::new("x-audit", "1")];
        assert_eq!(
            serde_json::to_string(
                &WebRequestBeforeRequestPayload::new(
                    profile.clone(),
                    "https://example.test/*",
                    WebRequestActionPayload::Redirect
                )
                .with_redirect_url("https://redirect.example.test/")
            )
            .expect("before request payload should encode"),
            r#"{"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"urlPattern":"https://example.test/*","action":"redirect","redirectUrl":"https://redirect.example.test/"}"#
        );
        assert_eq!(
            serde_json::to_string(&WebRequestHeadersReceivedPayload::new(
                profile.clone(),
                "https://example.test/*",
                headers.clone()
            ))
            .expect("headers received payload should encode"),
            r#"{"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"urlPattern":"https://example.test/*","responseHeaders":[{"name":"x-audit","value":"1"}]}"#
        );
        assert_eq!(
            serde_json::to_string(&WebRequestRemoveListenerPayload::new(interceptor.clone()))
                .expect("remove listener payload should encode"),
            r#"{"interceptor":{"kind":"web-request-interceptor","id":"web-request-interceptor:1","generation":0,"ownerScope":"workspace:1","state":"open"}}"#
        );
        let headers_snapshot = WebRequestInterceptorSnapshotPayload::new(
            interceptor.clone(),
            profile.clone(),
            WebRequestPhasePayload::HeadersReceived,
            "https://example.test/*",
            WebRequestActionPayload::ModifyHeaders,
            2,
        )
        .with_response_headers(headers);
        assert_eq!(
            serde_json::to_string(&headers_snapshot).expect("snapshot should encode"),
            r#"{"interceptor":{"kind":"web-request-interceptor","id":"web-request-interceptor:1","generation":0,"ownerScope":"workspace:1","state":"open"},"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"phase":"headers-received","urlPattern":"https://example.test/*","action":"modify-headers","order":2,"responseHeaders":[{"name":"x-audit","value":"1"}]}"#
        );
        let before_snapshot = WebRequestInterceptorSnapshotPayload::new(
            interceptor,
            profile,
            WebRequestPhasePayload::BeforeRequest,
            "https://example.test/*",
            WebRequestActionPayload::Block,
            1,
        );
        assert_eq!(
            serde_json::to_string(&WebRequestEventPayload::new(
                1710000000002,
                WebRequestEventPhasePayload::Registered,
                before_snapshot,
            ))
            .expect("event should encode"),
            r#"{"type":"web-request-event","timestamp":1710000000002,"phase":"registered","interceptor":{"kind":"web-request-interceptor","id":"web-request-interceptor:1","generation":0,"ownerScope":"workspace:1","state":"open"},"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"requestPhase":"before-request","urlPattern":"https://example.test/*","action":"block","order":1}"#
        );
        assert_eq!(
            serde_json::to_string(&WebRequestSupportedPayload::unsupported(
                "host-web-request-unavailable"
            ))
            .expect("support payload should encode"),
            r#"{"supported":false,"reason":"host-web-request-unavailable"}"#
        );
    }

    #[test]
    fn web_request_payloads_reject_inconsistent_action_shapes() {
        for source in [
            r#"{"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"urlPattern":"https://example.test/*","action":"redirect"}"#,
            r#"{"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"urlPattern":"https://example.test/*","action":"allow","redirectUrl":"https://redirect.example.test/"}"#,
            r#"{"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"urlPattern":"https://example.test/*","action":"block","redirectUrl":"https://redirect.example.test/"}"#,
        ] {
            let error = serde_json::from_str::<WebRequestBeforeRequestPayload>(source)
                .expect_err("inconsistent before-request payload should be rejected");
            assert!(
                error.to_string().contains("redirect"),
                "unexpected error: {error}"
            );
        }
    }

    #[test]
    fn web_request_snapshots_reject_inconsistent_phase_action_shapes() {
        for source in [
            r#"{"interceptor":{"kind":"web-request-interceptor","id":"web-request-interceptor:1","generation":0,"ownerScope":"workspace:1","state":"open"},"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"phase":"before-request","urlPattern":"https://example.test/*","action":"modify-headers","order":1,"responseHeaders":[{"name":"x-audit","value":"1"}]}"#,
            r#"{"interceptor":{"kind":"web-request-interceptor","id":"web-request-interceptor:1","generation":0,"ownerScope":"workspace:1","state":"open"},"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"phase":"headers-received","urlPattern":"https://example.test/*","action":"redirect","order":1,"redirectUrl":"https://redirect.example.test/"}"#,
            r#"{"interceptor":{"kind":"web-request-interceptor","id":"web-request-interceptor:1","generation":0,"ownerScope":"workspace:1","state":"open"},"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"phase":"headers-received","urlPattern":"https://example.test/*","action":"modify-headers","order":1}"#,
            r#"{"interceptor":{"kind":"web-request-interceptor","id":"web-request-interceptor:1","generation":0,"ownerScope":"workspace:1","state":"open"},"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"phase":"before-request","urlPattern":"https://example.test/*","action":"redirect","order":1}"#,
        ] {
            let error = serde_json::from_str::<WebRequestInterceptorSnapshotPayload>(source)
                .expect_err("inconsistent interceptor snapshot should be rejected");
            assert!(
                error.to_string().contains("snapshot") || error.to_string().contains("redirect"),
                "unexpected error: {error}"
            );
        }
    }

    #[test]
    fn web_request_payloads_reject_inconsistent_shapes_before_serializing() {
        let profile =
            SessionProfileResourcePayload::new("session-profile:workspace-1", 0, "workspace:1");
        let interceptor = WebRequestInterceptorResourcePayload::new(
            "web-request-interceptor:1",
            0,
            "workspace:1",
        );
        let headers = vec![WebRequestHeaderPayload::new("x-audit", "1")];

        for payload in [
            WebRequestBeforeRequestPayload::new(
                profile.clone(),
                "https://example.test/*",
                WebRequestActionPayload::Redirect,
            ),
            WebRequestBeforeRequestPayload::new(
                profile.clone(),
                "https://example.test/*",
                WebRequestActionPayload::Allow,
            )
            .with_redirect_url("https://redirect.example.test/"),
        ] {
            let error = serde_json::to_string(&payload)
                .expect_err("inconsistent before-request payload should not encode");
            assert!(
                error.to_string().contains("redirect"),
                "unexpected error: {error}"
            );
        }

        for snapshot in [
            WebRequestInterceptorSnapshotPayload::new(
                interceptor.clone(),
                profile.clone(),
                WebRequestPhasePayload::BeforeRequest,
                "https://example.test/*",
                WebRequestActionPayload::ModifyHeaders,
                1,
            )
            .with_response_headers(headers.clone()),
            WebRequestInterceptorSnapshotPayload::new(
                interceptor.clone(),
                profile.clone(),
                WebRequestPhasePayload::HeadersReceived,
                "https://example.test/*",
                WebRequestActionPayload::Redirect,
                1,
            )
            .with_redirect_url("https://redirect.example.test/"),
            WebRequestInterceptorSnapshotPayload::new(
                interceptor.clone(),
                profile.clone(),
                WebRequestPhasePayload::HeadersReceived,
                "https://example.test/*",
                WebRequestActionPayload::ModifyHeaders,
                1,
            ),
            WebRequestInterceptorSnapshotPayload::new(
                interceptor,
                profile,
                WebRequestPhasePayload::BeforeRequest,
                "https://example.test/*",
                WebRequestActionPayload::Redirect,
                1,
            ),
        ] {
            let error = serde_json::to_string(&snapshot)
                .expect_err("inconsistent interceptor snapshot should not encode");
            assert!(
                error.to_string().contains("snapshot") || error.to_string().contains("redirect"),
                "unexpected error: {error}"
            );
        }
    }

    #[test]
    fn web_request_events_reject_inconsistent_messages() {
        for source in [
            r#"{"type":"web-request-event","timestamp":1710000000002,"phase":"registered","interceptor":{"kind":"web-request-interceptor","id":"web-request-interceptor:1","generation":0,"ownerScope":"workspace:1","state":"open"},"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"requestPhase":"before-request","urlPattern":"https://example.test/*","action":"block","order":1,"message":"host failed"}"#,
            r#"{"type":"web-request-event","timestamp":1710000000002,"phase":"removed","interceptor":{"kind":"web-request-interceptor","id":"web-request-interceptor:1","generation":0,"ownerScope":"workspace:1","state":"open"},"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"requestPhase":"before-request","urlPattern":"https://example.test/*","action":"block","order":1,"message":"host failed"}"#,
            r#"{"type":"web-request-event","timestamp":1710000000002,"phase":"matched","interceptor":{"kind":"web-request-interceptor","id":"web-request-interceptor:1","generation":0,"ownerScope":"workspace:1","state":"open"},"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"requestPhase":"before-request","urlPattern":"https://example.test/*","action":"block","order":1,"message":"host failed"}"#,
            r#"{"type":"web-request-event","timestamp":1710000000002,"phase":"failed","interceptor":{"kind":"web-request-interceptor","id":"web-request-interceptor:1","generation":0,"ownerScope":"workspace:1","state":"open"},"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"requestPhase":"before-request","urlPattern":"https://example.test/*","action":"block","order":1}"#,
        ] {
            serde_json::from_str::<WebRequestEventPayload>(source)
                .expect_err("inconsistent web request event should be rejected");
        }

        for source in [
            r#"{"type":"web-request-event","timestamp":1710000000002,"phase":"registered","interceptor":{"kind":"web-request-interceptor","id":"web-request-interceptor:1","generation":0,"ownerScope":"workspace:1","state":"open"},"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"requestPhase":"before-request","urlPattern":"https://example.test/*","action":"block","order":1}"#,
            r#"{"type":"web-request-event","timestamp":1710000000002,"phase":"removed","interceptor":{"kind":"web-request-interceptor","id":"web-request-interceptor:1","generation":0,"ownerScope":"workspace:1","state":"open"},"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"requestPhase":"before-request","urlPattern":"https://example.test/*","action":"block","order":1}"#,
            r#"{"type":"web-request-event","timestamp":1710000000002,"phase":"matched","interceptor":{"kind":"web-request-interceptor","id":"web-request-interceptor:1","generation":0,"ownerScope":"workspace:1","state":"open"},"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"requestPhase":"before-request","urlPattern":"https://example.test/*","action":"block","order":1}"#,
            r#"{"type":"web-request-event","timestamp":1710000000002,"phase":"failed","interceptor":{"kind":"web-request-interceptor","id":"web-request-interceptor:1","generation":0,"ownerScope":"workspace:1","state":"open"},"profile":{"kind":"session-profile","id":"session-profile:workspace-1","generation":0,"ownerScope":"workspace:1","state":"open"},"requestPhase":"before-request","urlPattern":"https://example.test/*","action":"block","order":1,"message":"host failed"}"#,
        ] {
            serde_json::from_str::<WebRequestEventPayload>(source)
                .expect("consistent web request event should decode");
        }
    }

    #[test]
    fn web_request_events_reject_inconsistent_messages_before_serializing() {
        let profile =
            SessionProfileResourcePayload::new("session-profile:workspace-1", 0, "workspace:1");
        let interceptor = WebRequestInterceptorResourcePayload::new(
            "web-request-interceptor:1",
            0,
            "workspace:1",
        );
        let snapshot = WebRequestInterceptorSnapshotPayload::new(
            interceptor,
            profile,
            WebRequestPhasePayload::BeforeRequest,
            "https://example.test/*",
            WebRequestActionPayload::Block,
            1,
        );

        let mut registered = WebRequestEventPayload::new(
            1_710_000_000_002,
            WebRequestEventPhasePayload::Registered,
            snapshot.clone(),
        );
        registered.message = Some("host failed".to_string());
        let failed = WebRequestEventPayload::new(
            1_710_000_000_002,
            WebRequestEventPhasePayload::Failed,
            snapshot,
        );

        for event in [registered, failed] {
            serde_json::to_string(&event)
                .expect_err("inconsistent web request event should not encode");
        }
    }

    #[test]
    fn native_network_payloads_serialize_canonically() {
        let request =
            NativeNetworkRequestResourcePayload::new("native-network-request:1", 0, "workspace:1");
        let socket = NativeNetworkWebSocketResourcePayload::new(
            "native-network-websocket:1",
            0,
            "workspace:1",
        );
        assert_eq!(
            serde_json::to_string(&NativeNetworkFetchPayload::new(
                "https://example.test/data.json",
                NativeNetworkHttpMethodPayload::Get
            ))
            .expect("fetch payload should encode"),
            r#"{"url":"https://example.test/data.json","method":"GET"}"#
        );
        assert_eq!(
            serde_json::to_string(
                &NativeNetworkUploadPayload::new("https://example.test/upload", "payload")
                    .with_file_name("payload.txt")
            )
            .expect("upload payload should encode"),
            r#"{"url":"https://example.test/upload","body":"payload","fileName":"payload.txt"}"#
        );
        assert_eq!(
            serde_json::to_string(
                &NativeNetworkWebSocketConnectPayload::new("wss://example.test/socket")
                    .with_protocol("events")
            )
            .expect("websocket connect payload should encode"),
            r#"{"url":"wss://example.test/socket","protocols":["events"]}"#
        );
        assert_eq!(
            serde_json::to_string(&NativeNetworkWebSocketHandlePayload::new(socket.clone()))
                .expect("websocket handle payload should encode"),
            r#"{"socket":{"kind":"native-network-websocket","id":"native-network-websocket:1","generation":0,"ownerScope":"workspace:1","state":"open"}}"#
        );
        assert_eq!(
            serde_json::to_string(
                &NativeNetworkLocalhostUrlPayload::new(3010).with_path("/health")
            )
            .expect("localhost payload should encode"),
            r#"{"port":3010,"path":"/health"}"#
        );
        assert_eq!(
            serde_json::to_string(&NativeNetworkFetchResultPayload::new(
                request.clone(),
                "https://example.test/data.json",
                NativeNetworkHttpMethodPayload::Get,
                200
            ))
            .expect("fetch result should encode"),
            r#"{"request":{"kind":"native-network-request","id":"native-network-request:1","generation":0,"ownerScope":"workspace:1","state":"open"},"url":"https://example.test/data.json","method":"GET","status":200,"responseHeaders":[]}"#
        );
        assert_eq!(
            serde_json::to_string(&NativeNetworkUploadResultPayload::new(
                request.clone(),
                "https://example.test/upload",
                200,
                7
            ))
            .expect("upload result should encode"),
            r#"{"request":{"kind":"native-network-request","id":"native-network-request:1","generation":0,"ownerScope":"workspace:1","state":"open"},"url":"https://example.test/upload","status":200,"sentBytes":7,"responseHeaders":[]}"#
        );
        assert_eq!(
            serde_json::to_string(
                &NativeNetworkWebSocketSnapshotPayload::new(
                    socket.clone(),
                    "wss://example.test/socket",
                    NativeNetworkWebSocketStatePayload::Open
                )
                .with_protocol("events")
            )
            .expect("websocket snapshot should encode"),
            r#"{"socket":{"kind":"native-network-websocket","id":"native-network-websocket:1","generation":0,"ownerScope":"workspace:1","state":"open"},"url":"wss://example.test/socket","state":"open","protocol":"events"}"#
        );
        assert_eq!(
            serde_json::to_string(&NativeNetworkLocalhostUrlResultPayload::new(
                "http://127.0.0.1:3010/health"
            ))
            .expect("localhost result should encode"),
            r#"{"url":"http://127.0.0.1:3010/health"}"#
        );
        assert_eq!(
            serde_json::to_string(
                &NativeNetworkEventPayload::new(
                    1710000000003,
                    NativeNetworkEventPhasePayload::WebsocketOpened
                )
                .with_socket(socket, "wss://example.test/socket")
            )
            .expect("event should encode"),
            r#"{"type":"native-network-event","timestamp":1710000000003,"phase":"websocket-opened","socket":{"kind":"native-network-websocket","id":"native-network-websocket:1","generation":0,"ownerScope":"workspace:1","state":"open"},"url":"wss://example.test/socket"}"#
        );
        assert_eq!(
            serde_json::to_string(
                &NativeNetworkEventPayload::new(
                    1710000000004,
                    NativeNetworkEventPhasePayload::UploadProgress
                )
                .with_request(request.clone(), "https://example.test/upload")
                .with_byte_progress(7, 10)
            )
            .expect("upload progress event should encode"),
            r#"{"type":"native-network-event","timestamp":1710000000004,"phase":"upload-progress","request":{"kind":"native-network-request","id":"native-network-request:1","generation":0,"ownerScope":"workspace:1","state":"open"},"url":"https://example.test/upload","sentBytes":7,"totalBytes":10}"#
        );
        assert_eq!(
            serde_json::to_string(&NativeNetworkSupportedPayload::unsupported(
                "host-native-network-unavailable"
            ))
            .expect("support payload should encode"),
            r#"{"supported":false,"reason":"host-native-network-unavailable"}"#
        );
        assert_eq!(
            serde_json::to_string(&NativeNetworkHeaderPayload::new("x-audit", "1"))
                .expect("header should encode"),
            r#"{"name":"x-audit","value":"1"}"#
        );
    }

    #[test]
    fn native_network_support_rejects_inconsistent_reasons() {
        for source in [
            r#"{"supported":true,"reason":"unexpected"}"#,
            r#"{"supported":false}"#,
        ] {
            serde_json::from_str::<NativeNetworkSupportedPayload>(source)
                .expect_err("inconsistent native network support should be rejected");
        }

        for source in [
            r#"{"supported":true}"#,
            r#"{"supported":false,"reason":"host-native-network-unavailable"}"#,
        ] {
            serde_json::from_str::<NativeNetworkSupportedPayload>(source)
                .expect("consistent native network support should decode");
        }
    }

    #[test]
    fn native_network_support_rejects_inconsistent_reasons_before_serializing() {
        let mut supported = NativeNetworkSupportedPayload::unsupported("unexpected");
        supported.supported = true;
        let unsupported = NativeNetworkSupportedPayload {
            supported: false,
            reason: None,
        };

        for payload in [supported, unsupported] {
            serde_json::to_string(&payload)
                .expect_err("inconsistent native network support should not encode");
        }
    }

    #[test]
    fn native_network_events_accept_consistent_phase_payloads() {
        for source in [
            r#"{"type":"native-network-event","timestamp":1710000000000,"phase":"fetch-completed","request":{"kind":"native-network-request","id":"native-network-request:1","generation":0,"ownerScope":"workspace:1","state":"open"},"url":"https://example.test/data"}"#,
            r#"{"type":"native-network-event","timestamp":1710000000000,"phase":"upload-progress","request":{"kind":"native-network-request","id":"native-network-request:1","generation":0,"ownerScope":"workspace:1","state":"open"},"url":"https://example.test/upload","sentBytes":20,"totalBytes":100}"#,
            r#"{"type":"native-network-event","timestamp":1710000000000,"phase":"websocket-opened","socket":{"kind":"native-network-websocket","id":"native-network-websocket:1","generation":0,"ownerScope":"workspace:1","state":"open"},"url":"wss://example.test/socket"}"#,
            r#"{"type":"native-network-event","timestamp":1710000000000,"phase":"failed","request":{"kind":"native-network-request","id":"native-network-request:1","generation":0,"ownerScope":"workspace:1","state":"open"},"url":"https://example.test/data","message":"host failed"}"#,
        ] {
            serde_json::from_str::<NativeNetworkEventPayload>(source)
                .expect("consistent native network event should decode");
        }
    }

    #[test]
    fn native_network_events_reject_inconsistent_phase_payloads() {
        for source in [
            r#"{"type":"native-network-event","timestamp":1710000000000,"phase":"fetch-completed","socket":{"kind":"native-network-websocket","id":"native-network-websocket:1","generation":0,"ownerScope":"workspace:1","state":"open"},"url":"wss://example.test/socket"}"#,
            r#"{"type":"native-network-event","timestamp":1710000000000,"phase":"websocket-opened","request":{"kind":"native-network-request","id":"native-network-request:1","generation":0,"ownerScope":"workspace:1","state":"open"},"url":"https://example.test/data"}"#,
            r#"{"type":"native-network-event","timestamp":1710000000000,"phase":"failed","request":{"kind":"native-network-request","id":"native-network-request:1","generation":0,"ownerScope":"workspace:1","state":"open"},"socket":{"kind":"native-network-websocket","id":"native-network-websocket:1","generation":0,"ownerScope":"workspace:1","state":"open"},"url":"https://example.test/data","message":"host failed"}"#,
        ] {
            let error = serde_json::from_str::<NativeNetworkEventPayload>(source)
                .expect_err("inconsistent native network event should be rejected");
            assert!(
                error.to_string().contains("phase")
                    || error.to_string().contains("request")
                    || error.to_string().contains("socket"),
                "unexpected error: {error}"
            );
        }
    }

    #[test]
    fn native_network_events_reject_inconsistent_phase_payloads_before_serializing() {
        let request =
            NativeNetworkRequestResourcePayload::new("native-network-request:1", 0, "workspace:1");
        let socket = NativeNetworkWebSocketResourcePayload::new(
            "native-network-websocket:1",
            0,
            "workspace:1",
        );
        for event in [
            NativeNetworkEventPayload::new(
                1_710_000_000_000,
                NativeNetworkEventPhasePayload::FetchCompleted,
            )
            .with_socket(socket.clone(), "wss://example.test/socket"),
            NativeNetworkEventPayload::new(
                1_710_000_000_000,
                NativeNetworkEventPhasePayload::WebsocketOpened,
            )
            .with_request(request.clone(), "https://example.test/data"),
            NativeNetworkEventPayload::new(
                1_710_000_000_000,
                NativeNetworkEventPhasePayload::Failed,
            )
            .with_request(request, "https://example.test/data")
            .with_socket(socket, "wss://example.test/socket")
            .with_message("host failed"),
        ] {
            let error = serde_json::to_string(&event)
                .expect_err("inconsistent native network event should not encode");
            assert!(
                error.to_string().contains("phase")
                    || error.to_string().contains("request")
                    || error.to_string().contains("socket"),
                "unexpected error: {error}"
            );
        }
    }

    #[test]
    fn resume_ticket_serializes_canonically() {
        let ticket = ResumeTicket::new(
            "window-1",
            "sha256:origin",
            "resume-1",
            1710000030000,
            BTreeMap::from([("stream-1".to_string(), "42".to_string())]),
        );

        assert_eq!(ticket.window_id(), "window-1");
        assert_eq!(ticket.origin_token_hash(), "sha256:origin");
        assert_eq!(ticket.resume_nonce(), "resume-1");
        assert_eq!(ticket.expires_at(), 1710000030000);
        assert_eq!(
            ticket.last_stream_cursors().get("stream-1"),
            Some(&"42".to_string())
        );
        assert_eq!(
            serde_json::to_string(&ticket).expect("resume ticket should encode"),
            r#"{"windowId":"window-1","originTokenHash":"sha256:origin","resumeNonce":"resume-1","expiresAt":1710000030000,"lastStreamCursors":{"stream-1":"42"}}"#
        );
    }

    #[test]
    fn renderer_resume_payload_serializes_canonically() {
        let payload = RendererResumePayload::new(
            "window-1",
            "resume-1",
            BTreeMap::from([("stream-1".to_string(), "42".to_string())]),
        );

        assert_eq!(payload.window_id(), "window-1");
        assert_eq!(payload.resume_nonce(), "resume-1");
        assert_eq!(payload.cursors().get("stream-1"), Some(&"42".to_string()));
        assert_eq!(
            serde_json::to_string(&payload).expect("renderer resume payload should encode"),
            r#"{"windowId":"window-1","resumeNonce":"resume-1","cursors":{"stream-1":"42"}}"#
        );
    }

    #[test]
    fn renderer_resumed_payload_serializes_canonically() {
        let payload = RendererResumedPayload::new("window-1", vec!["stream-1".to_string()]);

        assert_eq!(payload.window_id(), "window-1");
        assert_eq!(payload.replayed_stream_ids(), ["stream-1".to_string()]);
        assert_eq!(
            serde_json::to_string(&payload).expect("renderer resumed payload should encode"),
            r#"{"windowId":"window-1","replayedStreamIds":["stream-1"]}"#
        );
    }

    #[test]
    fn renderer_resume_denied_payload_serializes_canonically() {
        let payload = RendererResumeDeniedPayload::new(
            "window-1",
            RendererResumeDeniedReason::BackfillExhausted,
            "reconnect backfill exhausted",
        );

        assert_eq!(payload.window_id(), "window-1");
        assert_eq!(
            payload.reason(),
            &RendererResumeDeniedReason::BackfillExhausted
        );
        assert_eq!(payload.message(), "reconnect backfill exhausted");
        assert_eq!(
            serde_json::to_string(&payload).expect("renderer resume denied payload should encode"),
            r#"{"windowId":"window-1","reason":"backfillExhausted","message":"reconnect backfill exhausted"}"#
        );
    }

    #[test]
    fn tray_payloads_serialize_canonically() {
        let tray = TrayResourcePayload::new("tray-1", 0, "tray:tray-1");
        assert_eq!(
            serde_json::to_string(&tray).expect("tray handle should encode"),
            r#"{"kind":"tray","id":"tray-1","generation":0,"ownerScope":"tray:tray-1","state":"open"}"#
        );

        let create = TrayCreatePayload::new("solid:#3366ccff");
        assert_eq!(
            serde_json::to_string(&create).expect("tray create should encode"),
            r#"{"icon":"solid:#3366ccff"}"#
        );

        let event = TrayActivatedEventPayload::new(tray);
        assert_eq!(
            serde_json::to_string(&event).expect("tray event should encode"),
            r#"{"tray":{"kind":"tray","id":"tray-1","generation":0,"ownerScope":"tray:tray-1","state":"open"}}"#
        );

        assert_eq!(
            serde_json::to_string(&TraySupportedPayload::unsupported(TRAY_UNSUPPORTED_REASON))
                .expect("support payload should encode"),
            r#"{"supported":false,"reason":"host-tray-unavailable"}"#
        );
        assert_eq!(
            serde_json::to_string(&TraySupportedPayload::supported())
                .expect("support payload should encode"),
            r#"{"supported":true}"#
        );
    }

    #[test]
    fn tray_create_rejects_excess_fields() {
        let value = serde_json::json!({
            "icon": "solid:#3366ccff",
            "badge": "1"
        });

        let error = serde_json::from_value::<TrayCreatePayload>(value)
            .expect_err("excess field should be rejected");
        assert!(error.to_string().contains("unknown field `badge`"));
    }

    #[test]
    fn context_menu_payloads_serialize_canonically() {
        let app_event = MenuActivatedEventPayload::new("file.open", "app.file.open", None);
        assert_eq!(app_event.item_id(), "file.open");
        assert_eq!(app_event.command_id(), "app.file.open");
        assert_eq!(app_event.window_id(), None);
        assert_eq!(
            serde_json::to_string(&app_event).expect("menu app event should encode"),
            r#"{"itemId":"file.open","commandId":"app.file.open"}"#
        );

        let window_event = MenuActivatedEventPayload::new(
            "file.open",
            "app.file.open",
            Some("window-1".to_string()),
        );
        assert_eq!(window_event.window_id(), Some("window-1"));
        assert_eq!(
            serde_json::to_string(&window_event).expect("menu window event should encode"),
            r#"{"itemId":"file.open","commandId":"app.file.open","windowId":"window-1"}"#
        );

        let event = ContextMenuActivatedEventPayload::new("file.open", "app.file.open", "window-1");
        assert_eq!(event.item_id(), "file.open");
        assert_eq!(event.command_id(), "app.file.open");
        assert_eq!(event.window_id(), "window-1");
        assert_eq!(
            serde_json::to_string(&event).expect("context menu event should encode"),
            r#"{"itemId":"file.open","commandId":"app.file.open","windowId":"window-1"}"#
        );
    }

    #[test]
    fn screen_payloads_serialize_canonically() {
        let bounds = ScreenBoundsPayload::new(0.0, 0.0, 1920.0, 1080.0);
        let work_area = ScreenBoundsPayload::new(0.0, 24.0, 1920.0, 1056.0);
        let display = ScreenDisplayPayload::new("display-1", bounds.clone(), work_area, 2.0, true);
        let displays = ScreenDisplaysResultPayload::new(vec![display.clone()]);

        assert_eq!(
            serde_json::to_string(&bounds).expect("bounds should encode"),
            r#"{"x":0.0,"y":0.0,"width":1920.0,"height":1080.0}"#
        );
        assert_eq!(
            serde_json::to_string(&display).expect("display should encode"),
            r#"{"id":"display-1","bounds":{"x":0.0,"y":0.0,"width":1920.0,"height":1080.0},"workArea":{"x":0.0,"y":24.0,"width":1920.0,"height":1056.0},"scaleFactor":2.0,"primary":true}"#
        );
        assert_eq!(
            serde_json::to_string(&displays).expect("display result should encode"),
            r#"{"displays":[{"id":"display-1","bounds":{"x":0.0,"y":0.0,"width":1920.0,"height":1080.0},"workArea":{"x":0.0,"y":24.0,"width":1920.0,"height":1056.0},"scaleFactor":2.0,"primary":true}]}"#
        );
        assert_eq!(
            serde_json::to_string(&ScreenDisplaysChangedEventPayload::new(vec![display]))
                .expect("screen event should encode"),
            r#"{"displays":[{"id":"display-1","bounds":{"x":0.0,"y":0.0,"width":1920.0,"height":1080.0},"workArea":{"x":0.0,"y":24.0,"width":1920.0,"height":1056.0},"scaleFactor":2.0,"primary":true}]}"#
        );
        assert_eq!(
            serde_json::to_string(&ScreenPointPayload::new(12.0, 34.0))
                .expect("point should encode"),
            r#"{"x":12.0,"y":34.0}"#
        );
        assert_eq!(
            serde_json::to_string(&ScreenSupportedPayload::supported())
                .expect("support payload should encode"),
            r#"{"supported":true}"#
        );
        assert_eq!(
            serde_json::to_string(&ScreenSupportedPayload::unsupported())
                .expect("support payload should encode"),
            r#"{"supported":false}"#
        );
    }

    #[test]
    fn screen_display_lists_reject_invalid_primary_topologies() {
        for source in [
            r#"{"displays":[]}"#,
            r#"{"displays":[{"id":"display-1","bounds":{"x":0.0,"y":0.0,"width":1920.0,"height":1080.0},"workArea":{"x":0.0,"y":24.0,"width":1920.0,"height":1056.0},"scaleFactor":2.0,"primary":false}]}"#,
            r#"{"displays":[{"id":"display-1","bounds":{"x":0.0,"y":0.0,"width":1920.0,"height":1080.0},"workArea":{"x":0.0,"y":24.0,"width":1920.0,"height":1056.0},"scaleFactor":2.0,"primary":true},{"id":"display-2","bounds":{"x":1920.0,"y":0.0,"width":1920.0,"height":1080.0},"workArea":{"x":1920.0,"y":24.0,"width":1920.0,"height":1056.0},"scaleFactor":2.0,"primary":true}]}"#,
        ] {
            serde_json::from_str::<ScreenDisplaysPayload>(source)
                .expect_err("invalid screen display list should be rejected");
        }
    }

    #[test]
    fn screen_display_lists_reject_invalid_primary_topologies_before_serializing() {
        let bounds = ScreenBoundsPayload::new(0.0, 0.0, 1920.0, 1080.0);
        let work_area = ScreenBoundsPayload::new(0.0, 24.0, 1920.0, 1056.0);
        let secondary =
            ScreenDisplayPayload::new("display-1", bounds.clone(), work_area.clone(), 2.0, false);
        let primary_a =
            ScreenDisplayPayload::new("display-1", bounds.clone(), work_area.clone(), 2.0, true);
        let primary_b =
            ScreenDisplayPayload::new("display-2", bounds.clone(), work_area.clone(), 2.0, true);

        for payload in [
            ScreenDisplaysPayload::new(vec![]),
            ScreenDisplaysPayload::new(vec![secondary]),
            ScreenDisplaysPayload::new(vec![primary_a, primary_b]),
        ] {
            serde_json::to_string(&payload)
                .expect_err("invalid screen display list should not encode");
        }
    }

    #[test]
    fn screen_support_payload_rejects_invalid_shape() {
        let value = serde_json::json!({
            "method": "getDisplays",
            "reason": "extra"
        });
        let error = serde_json::from_value::<ScreenIsSupportedPayload>(value)
            .expect_err("excess field should be rejected");
        assert!(error.to_string().contains("unknown field `reason`"));

        let value = serde_json::json!({ "method": "watchDisplays" });
        let error = serde_json::from_value::<ScreenIsSupportedPayload>(value)
            .expect_err("invalid method should be rejected");
        assert!(error.to_string().contains("unknown variant"));
    }

    #[test]
    fn shell_payloads_serialize_canonically() {
        assert_eq!(
            serde_json::to_string(&ShellOpenExternalPayload::new(
                "https://example.com",
                Some(vec!["myapp".to_string()]),
            ))
            .expect("open external should encode"),
            r#"{"url":"https://example.com","allowedSchemes":["myapp"]}"#
        );
        assert_eq!(
            serde_json::to_string(&ShellShowItemInFolderPayload::new("/tmp/report.txt"))
                .expect("show item should encode"),
            r#"{"path":"/tmp/report.txt"}"#
        );
        assert_eq!(
            serde_json::to_string(&ShellOpenPathPayload::new("/tmp/report.txt", Some(true)))
                .expect("open path should encode"),
            r#"{"path":"/tmp/report.txt","allowExecutable":true}"#
        );
        assert_eq!(
            serde_json::to_string(&ShellTrashItemPayload::new("/tmp/report.txt"))
                .expect("trash item should encode"),
            r#"{"path":"/tmp/report.txt"}"#
        );
    }

    #[test]
    fn shell_payloads_reject_excess_fields() {
        let value = serde_json::json!({
            "url": "https://example.com",
            "shell": true
        });
        let error = serde_json::from_value::<ShellOpenExternalPayload>(value)
            .expect_err("excess field should be rejected");
        assert!(error.to_string().contains("unknown field `shell`"));
    }

    #[test]
    fn canonical_path_payload_serializes_and_rejects_excess_fields() {
        assert_eq!(
            serde_json::to_string(&CanonicalPathPayload::new("/tmp/effect-desktop"))
                .expect("canonical path should encode"),
            r#"{"path":"/tmp/effect-desktop"}"#
        );

        let value = serde_json::json!({
            "path": "/tmp/effect-desktop",
            "extra": true
        });
        let error = serde_json::from_value::<CanonicalPathPayload>(value)
            .expect_err("excess field should reject");
        assert!(error.to_string().contains("unknown field `extra`"));
    }

    #[test]
    fn protocol_payloads_serialize_canonically_and_reject_excess_fields() {
        assert_eq!(
            serde_json::to_string(&ProtocolRegisterAppProtocolPayload::new("assets"))
                .expect("register protocol payload should encode"),
            r#"{"scheme":"assets"}"#
        );
        assert_eq!(
            serde_json::to_string(&ProtocolServeAssetPayload::new("assets", "/app/assets"))
                .expect("serve asset payload should encode"),
            r#"{"scheme":"assets","root":"/app/assets"}"#
        );
        assert_eq!(
            serde_json::to_string(&ProtocolServeRoutePayload::new("assets", "/settings"))
                .expect("serve route payload should encode"),
            r#"{"scheme":"assets","route":"/settings"}"#
        );
        assert_eq!(
            serde_json::to_string(&ProtocolDenyPayload::new("assets", "/private"))
                .expect("deny payload should encode"),
            r#"{"scheme":"assets","path":"/private"}"#
        );

        let value = serde_json::json!({
            "scheme": "assets",
            "root": "/app/assets",
            "extra": true
        });
        let error = serde_json::from_value::<ProtocolServeAssetPayload>(value)
            .expect_err("excess field should reject");
        assert!(error.to_string().contains("unknown field `extra`"));
    }

    #[test]
    fn notification_payloads_serialize_canonically() {
        let notification =
            NotificationResourcePayload::new("notification-1", 0, "notification:notification-1");
        assert_eq!(
            serde_json::to_string(&notification).expect("notification handle should encode"),
            r#"{"kind":"notification","id":"notification-1","generation":0,"ownerScope":"notification:notification-1","state":"open"}"#
        );

        let show = serde_json::json!({
            "title": "Build finished",
            "body": "Open results",
            "actions": [
                NotificationActionPayload::new("open", "Open")
            ],
            "ownerWindow": {
                "kind": "window",
                "id": "window-1",
                "generation": 0,
                "ownerScope": "window:window-1",
                "state": "open"
            }
        });
        let show = serde_json::from_value::<NotificationShowPayload>(show)
            .expect("notification show should decode");
        assert_eq!(show.title(), "Build finished");
        assert_eq!(show.body(), "Open results");
        assert_eq!(show.actions()[0].id(), "open");
        assert_eq!(
            show.owner_window()
                .expect("owner window should decode")
                .id(),
            "window-1"
        );

        assert_eq!(
            serde_json::to_string(&NotificationSupportedPayload::unsupported(
                NOTIFICATION_UNSUPPORTED_REASON,
            ))
            .expect("support payload should encode"),
            r#"{"supported":false,"reason":"host-notification-unavailable"}"#
        );
        assert_eq!(
            serde_json::to_string(&NotificationPermissionPayload::new(
                NotificationPermissionStatePayload::Granted,
            ))
            .expect("permission payload should encode"),
            r#"{"state":"granted"}"#
        );
        assert_eq!(
            serde_json::to_string(&NotificationClickEventPayload::new(
                notification.clone(),
                Some("window-1".to_string()),
            ))
            .expect("click event should encode"),
            r#"{"notification":{"kind":"notification","id":"notification-1","generation":0,"ownerScope":"notification:notification-1","state":"open"},"ownerWindowId":"window-1"}"#
        );
        assert_eq!(
            serde_json::to_string(&NotificationActionEventPayload::new(
                notification,
                "open",
                Some("window-1".to_string()),
            ))
            .expect("action event should encode"),
            r#"{"notification":{"kind":"notification","id":"notification-1","generation":0,"ownerScope":"notification:notification-1","state":"open"},"actionId":"open","ownerWindowId":"window-1"}"#
        );
    }

    #[test]
    fn notification_show_rejects_excess_fields() {
        let value = serde_json::json!({
            "title": "Build finished",
            "body": "Open results",
            "badge": "1"
        });

        let error = serde_json::from_value::<NotificationShowPayload>(value)
            .expect_err("excess field should be rejected");
        assert!(error.to_string().contains("unknown field `badge`"));
    }

    fn read_fixture(name: &str) -> String {
        fs::read_to_string(fixture_path(name))
            .unwrap_or_else(|error| panic!("failed to read fixture {name}: {error}"))
            .trim()
            .to_string()
    }

    fn fixture_path(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("fixtures")
            .join(name)
    }
}
