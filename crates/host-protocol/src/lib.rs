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
pub const WINDOW_CREATE_METHOD: &str = "Window.create";
pub const WINDOW_DESTROY_METHOD: &str = "Window.destroy";
pub const DOCK_SET_BADGE_COUNT_METHOD: &str = "Dock.setBadgeCount";
pub const DOCK_SET_BADGE_TEXT_METHOD: &str = "Dock.setBadgeText";
pub const DOCK_SET_MENU_METHOD: &str = "Dock.setMenu";
pub const DOCK_REQUEST_ATTENTION_METHOD: &str = "Dock.requestAttention";
pub const DOCK_IS_SUPPORTED_METHOD: &str = "Dock.isSupported";
pub const GLOBAL_SHORTCUT_REGISTER_METHOD: &str = "GlobalShortcut.register";
pub const GLOBAL_SHORTCUT_UNREGISTER_METHOD: &str = "GlobalShortcut.unregister";
pub const GLOBAL_SHORTCUT_UNREGISTER_ALL_METHOD: &str = "GlobalShortcut.unregisterAll";
pub const GLOBAL_SHORTCUT_IS_REGISTERED_METHOD: &str = "GlobalShortcut.isRegistered";
pub const GLOBAL_SHORTCUT_IS_SUPPORTED_METHOD: &str = "GlobalShortcut.isSupported";
pub const SAFE_STORAGE_IS_AVAILABLE_METHOD: &str = "SafeStorage.isAvailable";
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
pub const SELECTION_CONTEXT_READ_SELECTION_METHOD: &str = "SelectionContext.readSelection";
pub const SELECTION_CONTEXT_READ_DOCUMENT_METHOD: &str = "SelectionContext.readDocumentContext";
pub const SELECTION_CONTEXT_WATCH_FOCUS_METHOD: &str = "SelectionContext.watchFocus";
pub const SELECTION_CONTEXT_STOP_WATCHING_METHOD: &str = "SelectionContext.stopWatching";
pub const SELECTION_CONTEXT_IS_SUPPORTED_METHOD: &str = "SelectionContext.isSupported";
pub const SELECTION_CONTEXT_EVENT: &str = "SelectionContext.Event";
pub const FOCUSED_APPLICATION_CONTEXT_SNAPSHOT_METHOD: &str = "FocusedApplicationContext.snapshot";
pub const FOCUSED_APPLICATION_CONTEXT_WATCH_METHOD: &str = "FocusedApplicationContext.watch";
pub const FOCUSED_APPLICATION_CONTEXT_STOP_WATCHING_METHOD: &str =
    "FocusedApplicationContext.stopWatching";
pub const FOCUSED_APPLICATION_CONTEXT_IS_SUPPORTED_METHOD: &str =
    "FocusedApplicationContext.isSupported";
pub const FOCUSED_APPLICATION_CONTEXT_EVENT: &str = "FocusedApplicationContext.Event";
pub const DISPLAY_CAPTURE_CAPTURE_DISPLAY_METHOD: &str = "DisplayCapture.captureDisplay";
pub const DISPLAY_CAPTURE_CAPTURE_WINDOW_METHOD: &str = "DisplayCapture.captureWindow";
pub const DISPLAY_CAPTURE_CAPTURE_REGION_METHOD: &str = "DisplayCapture.captureRegion";
pub const DISPLAY_CAPTURE_IS_SUPPORTED_METHOD: &str = "DisplayCapture.isSupported";
pub const DISPLAY_CAPTURE_EVENT: &str = "DisplayCapture.Event";
pub const TRANSIENT_WINDOW_ROLE_OPEN_METHOD: &str = "TransientWindowRole.open";
pub const TRANSIENT_WINDOW_ROLE_REPOSITION_METHOD: &str = "TransientWindowRole.reposition";
pub const TRANSIENT_WINDOW_ROLE_DISMISS_METHOD: &str = "TransientWindowRole.dismiss";
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
pub const EXECUTION_SANDBOX_CREATE_METHOD: &str = "ExecutionSandbox.create";
pub const EXECUTION_SANDBOX_RUN_METHOD: &str = "ExecutionSandbox.run";
pub const EXECUTION_SANDBOX_DESTROY_METHOD: &str = "ExecutionSandbox.destroy";
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
pub const SCOPED_ACCESS_GRANT_GRANT_METHOD: &str = "ScopedAccessGrant.grant";
pub const SCOPED_ACCESS_GRANT_RESOLVE_METHOD: &str = "ScopedAccessGrant.resolve";
pub const SCOPED_ACCESS_GRANT_REVOKE_METHOD: &str = "ScopedAccessGrant.revoke";
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

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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
    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            supported: false,
            reason: Some(reason.into()),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttachmentIntakeEventPayload {
    r#type: String,
    timestamp: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    intake_id: Option<String>,
    phase: AttachmentIntakeEventPhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    state: Option<AttachmentIntakeState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    item_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
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

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectionContextEventPayload {
    r#type: String,
    timestamp: u64,
    phase: SelectionContextEventPhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    watch_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    document: Option<SelectionContextDocumentMetadataPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    selection: Option<SelectionContextSelectionMetadataPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

impl SelectionContextEventPayload {
    pub fn new(timestamp: u64, phase: SelectionContextEventPhase) -> Self {
        Self {
            r#type: "selection-context-event".to_string(),
            timestamp,
            phase,
            watch_id: None,
            document: None,
            selection: None,
            reason: None,
            message: None,
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

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FocusedApplicationContextEventPayload {
    r#type: String,
    timestamp: u64,
    phase: FocusedApplicationContextEventPhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    watch_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    snapshot: Option<FocusedApplicationContextSnapshotResultPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

impl FocusedApplicationContextEventPayload {
    pub fn new(timestamp: u64, phase: FocusedApplicationContextEventPhase) -> Self {
        Self {
            r#type: "focused-application-context-event".to_string(),
            timestamp,
            phase,
            watch_id: None,
            snapshot: None,
            reason: None,
            message: None,
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
    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            supported: false,
            reason: Some(reason.into()),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DisplayCaptureEventPayload {
    r#type: String,
    timestamp: u64,
    phase: DisplayCaptureEventPhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    capture_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<DisplayCaptureSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    byte_length: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
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

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransientWindowRoleEventPayload {
    r#type: String,
    timestamp: u64,
    phase: TransientWindowRoleEventPhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    role_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

impl TransientWindowRoleEventPayload {
    pub fn new(timestamp: u64, phase: TransientWindowRoleEventPhase) -> Self {
        Self {
            r#type: "transient-window-role-event".to_string(),
            timestamp,
            phase,
            role_id: None,
            reason: None,
            message: None,
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
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActivationRegistrySupportedPayload {
    supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl ActivationRegistrySupportedPayload {
    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self {
            supported: false,
            reason: Some(reason.into()),
        }
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

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl ActivationRegistryEventPayload {
    pub fn new(
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
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            policy: None,
        }
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

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResidentLifecycleEventPayload {
    r#type: String,
    timestamp: u64,
    phase: ResidentLifecycleEventPhase,
    state: ResidentLifecycleStatePayload,
    trace_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
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

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionSandboxEventPayload {
    r#type: String,
    timestamp: u64,
    sandbox_id: String,
    phase: ExecutionSandboxEventPhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    run_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<ExecutionSandboxRunStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
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

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalToolRuntimeEventPayload {
    r#type: String,
    timestamp: u64,
    runtime_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    command_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    run_id: Option<String>,
    phase: LocalToolRuntimeEventPhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<LocalToolRuntimeRunStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    health: Option<LocalToolRuntimeHealthStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
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

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScopedAccessGrantEventPayload {
    r#type: String,
    timestamp: u64,
    grant_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    phase: ScopedAccessGrantEventPhase,
    #[serde(skip_serializing_if = "Option::is_none")]
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
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceIndexEventPayload {
    r#type: String,
    timestamp: u64,
    index_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    root: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl ExtensionConfigEventPayload {
    pub fn new(
        timestamp: u64,
        extension_id: impl Into<String>,
        phase: ExtensionConfigEventPhase,
        keys: Vec<String>,
        revision: Option<u64>,
        reason: Option<String>,
    ) -> Self {
        Self {
            r#type: "extension-config-event".to_string(),
            timestamp,
            extension_id: extension_id.into(),
            phase,
            keys,
            revision,
            reason,
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

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DistributionParityEventPayload {
    #[serde(rename = "type")]
    event_type: String,
    timestamp: u64,
    phase: DistributionParityEventPhase,
    package_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl DistributionParityEventPayload {
    pub fn new(
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

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionPackageEventPayload {
    r#type: String,
    timestamp: u64,
    package_id: String,
    phase: ExtensionPackageEventPhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    revision: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
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
            } => Ok(Self::Request {
                id,
                method,
                timestamp: *timestamp,
                trace_id,
                window_id: window_id.as_deref(),
                origin_token: origin_token.as_deref(),
                payload: payload.as_ref(),
            }),
            HostProtocolEnvelope::Response {
                id,
                timestamp,
                trace_id,
                payload,
                error,
            } => Ok(Self::Response {
                id,
                timestamp: *timestamp,
                trace_id,
                payload: payload.as_ref(),
                error: error.as_ref(),
            }),
            HostProtocolEnvelope::Event {
                method,
                timestamp,
                trace_id,
                window_id,
                payload,
            } => Ok(Self::Event {
                method,
                timestamp: *timestamp,
                trace_id,
                window_id: window_id.as_deref(),
                payload: payload.as_ref(),
            }),
            HostProtocolEnvelope::Stream {
                id,
                resource_id,
                timestamp,
                trace_id,
                payload,
                error,
            } => {
                if id.is_none() && resource_id.is_none() {
                    return Err("stream envelope requires id or resourceId");
                }

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
                if id.is_none() && resource_id.is_none() {
                    return Err("cancel envelope requires id or resourceId");
                }

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
                id,
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
            } => Ok(Self::Response {
                id,
                timestamp,
                trace_id: validate_host_identity(trace_id)?,
                payload,
                error,
            }),
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
                if id.is_none() && resource_id.is_none() {
                    return Err("stream envelope requires id or resourceId");
                }

                Ok(Self::Stream {
                    id,
                    resource_id,
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
                if id.is_none() && resource_id.is_none() {
                    return Err("cancel envelope requires id or resourceId");
                }

                Ok(Self::Cancel {
                    id,
                    resource_id,
                    timestamp,
                    trace_id: validate_host_identity(trace_id)?,
                })
            }
        }
    }
}

fn validate_host_identity(value: String) -> Result<String, &'static str> {
    if value.is_empty() {
        return Err("host protocol identity must be non-empty");
    }
    if value
        .chars()
        .any(|ch| matches!(ch, '\u{0000}'..='\u{001f}' | '\u{007f}'))
    {
        return Err("host protocol identity must not contain ASCII control characters");
    }
    Ok(value)
}

fn validate_optional_host_identity(value: Option<String>) -> Result<Option<String>, &'static str> {
    value.map(validate_host_identity).transpose()
}

#[cfg(test)]
mod tests {
    use super::{
        ActivationRegistryActorKind, ActivationRegistryActorPayload,
        ActivationRegistryEventPayload, ActivationRegistryEventPhase,
        ActivationRegistryPermissionContextPayload, ActivationRegistrySource,
        ActivationRegistrySupportedPayload, ActivationRegistrySurfacePayload,
        ClipboardCapabilityPayload, ClipboardHtmlPayload, ClipboardImagePayload,
        ClipboardIsSupportedPayload, ClipboardSupportedPayload, ClipboardTextPayload,
        DiagnosticsBundleCollectPayload, DiagnosticsBundleCollectResultPayload,
        DiagnosticsBundleRedactPayload, DiagnosticsBundleRedactResultPayload,
        DiagnosticsBundleRedactionEvidencePayload, DiagnosticsBundleRedactionPolicyPayload,
        DiagnosticsBundleSourceKind, DiagnosticsBundleSourceSummaryPayload,
        DiagnosticsBundleSupportedPayload, DiagnosticsBundleWritePayload,
        DiagnosticsBundleWriteResultPayload, DialogConfirmPayload, DialogConfirmResultPayload,
        DialogFileFilterPayload, DialogLevelPayload, DialogMessagePayload,
        DialogOpenDirectoryPayload, DialogOpenFilePayload, DialogOpenResultPayload,
        DialogSaveFilePayload, DialogSaveResultPayload, DisplayCaptureActorKind,
        DisplayCaptureActorPayload, DisplayCaptureEventPayload, DisplayCaptureEventPhase,
        DisplayCaptureGrantKind, DisplayCaptureGrantPayload, DisplayCaptureImagePayload,
        DisplayCaptureMetadataPayload, DisplayCaptureRegionPayload, DisplayCaptureRequestPayload,
        DisplayCaptureResultPayload, DisplayCaptureSource, DisplayCaptureSupportedPayload,
        DisplayCaptureTargetPayload, DistributionParityEventPayload, DistributionParityEventPhase,
        DistributionParityEvidenceKind, DistributionParityEvidencePayload,
        DistributionParitySupportedPayload, DistributionParityVerifyPayload,
        DistributionParityVerifyResultPayload, EgressPolicyActorKind, EgressPolicyActorPayload,
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
        ExtensionPackageUpdateResultPayload, HostProtocolEnvelope, HostProtocolError,
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
        NotificationActionEventPayload, NotificationActionPayload, NotificationClickEventPayload,
        NotificationPermissionPayload, NotificationPermissionStatePayload,
        NotificationResourcePayload, NotificationShowPayload, NotificationSupportedPayload,
        RealtimeMediaDeviceKind, RealtimeMediaDeviceStateEventPayload,
        RealtimeMediaDeviceStatePayload, RealtimeMediaInterruptionEventPayload,
        RealtimeMediaInterruptionReason, RealtimeMediaPermissionState,
        RealtimeMediaPermissionStateEventPayload, RealtimeMediaSessionIdentityPayload,
        RealtimeMediaSessionInterruptPayload, RealtimeMediaSessionSelectDevicePayload,
        RealtimeMediaSessionState, RealtimeMediaSessionStateEventPayload,
        RealtimeMediaSessionSupportedPayload, RendererResumeDeniedPayload,
        RendererResumeDeniedReason, RendererResumePayload, RendererResumedPayload,
        ResidentLifecycleBackgroundAvailability, ResidentLifecycleDisablePayload,
        ResidentLifecycleEnablePayload, ResidentLifecycleEventPayload, ResidentLifecycleEventPhase,
        ResidentLifecyclePolicyPayload, ResidentLifecycleProcessPolicy,
        ResidentLifecycleStatePayload, ResidentLifecycleSupportedPayload,
        ResidentLifecycleWindowPolicy, ResumeTicket, ScreenBoundsPayload, ScreenDisplayPayload,
        ScreenDisplaysChangedEventPayload, ScreenDisplaysResultPayload, ScreenIsSupportedPayload,
        ScreenPointPayload, ScreenSupportedPayload, ShellOpenExternalPayload, ShellOpenPathPayload,
        ShellShowItemInFolderPayload, ShellTrashItemPayload, TransactionalFileMutationActorKind,
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
        TrayResourcePayload, TraySupportedPayload, WindowCreatePayload, WindowCreateResponse,
        WindowDestroyPayload, WindowTitleBarStyle, WindowTrafficLights, WorkspaceIndexActorKind,
        WorkspaceIndexActorPayload, WorkspaceIndexClosePayload, WorkspaceIndexCloseResultPayload,
        WorkspaceIndexEventPayload, WorkspaceIndexEventPhase, WorkspaceIndexIgnoreRulePayload,
        WorkspaceIndexOpenPayload, WorkspaceIndexOpenResultPayload, WorkspaceIndexRefreshPayload,
        WorkspaceIndexRefreshResultPayload, WorkspaceIndexScopePayload, WorkspaceIndexState,
        WorkspaceIndexSupportedPayload, ACTIVATION_REGISTRY_UNSUPPORTED_REASON,
        CLIPBOARD_UNSUPPORTED_REASON, DEFAULT_MAX_BACKFILL_EVENTS, DEFAULT_RECONNECT_WINDOW_MS,
        DIAGNOSTICS_BUNDLE_UNSUPPORTED_REASON, DISPLAY_CAPTURE_UNSUPPORTED_REASON,
        DISTRIBUTION_PARITY_UNSUPPORTED_REASON, EGRESS_POLICY_UNSUPPORTED_REASON,
        EXECUTION_SANDBOX_UNSUPPORTED_REASON, EXTENSION_CONFIG_UNSUPPORTED_REASON,
        EXTENSION_PACKAGE_UNSUPPORTED_REASON, HOST_PROTOCOL_ERROR_SPECS, JOB_UNSUPPORTED_REASON,
        LOCAL_TOOL_RUNTIME_UNSUPPORTED_REASON, NOTIFICATION_UNSUPPORTED_REASON, PROTOCOL_VERSION,
        REALTIME_MEDIA_SESSION_UNSUPPORTED_REASON, RESIDENT_LIFECYCLE_UNSUPPORTED_REASON,
        TRANSACTIONAL_FILE_MUTATION_UNSUPPORTED_REASON, TRANSIENT_WINDOW_ROLE_UNSUPPORTED_REASON,
        TRAY_UNSUPPORTED_REASON, WORKSPACE_INDEX_UNSUPPORTED_REASON,
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
    fn host_protocol_envelopes_reject_control_identity_fields() {
        for source in [
            r#"{"kind":"request","id":"request-1","method":"host.ping","timestamp":1710000000000,"traceId":"trace\nforged"}"#,
            r#"{"kind":"request","id":"request-1","method":"host.ping","timestamp":1710000000000,"traceId":"trace-1","windowId":"main\nforged"}"#,
            r#"{"kind":"request","id":"request-1","method":"host.ping","timestamp":1710000000000,"traceId":"trace-1","originToken":"origin\nforged"}"#,
            r#"{"kind":"response","id":"request-1","timestamp":1710000000000,"traceId":"trace\u0000forged"}"#,
        ] {
            let error = serde_json::from_str::<HostProtocolEnvelope>(source)
                .expect_err("identity controls should be rejected");
            assert!(error
                .to_string()
                .contains("must not contain ASCII control characters"));
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
    fn window_create_payload_accepts_macos_polish_fields() {
        let payload = serde_json::from_str::<WindowCreatePayload>(
            r#"{"title":"Polished","width":320,"height":240,"titleBarStyle":"hiddenInset","vibrancy":"windowBackground","trafficLights":{"x":12,"y":13}}"#,
        )
        .expect("macOS window polish payload should decode");

        assert_eq!(payload.title(), Some("Polished"));
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
        let event =
            DisplayCaptureEventPayload::new(1710000000001, DisplayCaptureEventPhase::Captured);
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
            r#"{"type":"display-capture-event","timestamp":1710000000001,"phase":"captured"}"#
        );
        assert_eq!(
            serde_json::to_string(&supported).expect("support payload should encode"),
            r#"{"supported":false,"reason":"host-adapter-unimplemented"}"#
        );
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
        let event = TransientWindowRoleEventPayload::new(
            1710000000001,
            TransientWindowRoleEventPhase::Opened,
        );
        let supported = TransientWindowRoleSupportedPayload::unsupported(
            TRANSIENT_WINDOW_ROLE_UNSUPPORTED_REASON,
        );

        assert_eq!(
            serde_json::to_string(&request).expect("request payload should encode"),
            r#"{"actor":{"kind":"workspace","id":"workspace-1"},"roleId":"palette-1","policy":{"role":"palette","focus":"take-focus","dismissal":"escape","zOrder":"floating","placement":{"kind":"point","point":{"x":20.0,"y":40.0}},"restoration":"restore-focus"},"traceId":"trace-transient-window-role"}"#
        );
        assert_eq!(
            serde_json::to_string(&event).expect("event payload should encode"),
            r#"{"type":"transient-window-role-event","timestamp":1710000000001,"phase":"opened"}"#
        );
        assert_eq!(
            serde_json::to_string(&supported).expect("support payload should encode"),
            r#"{"supported":false,"reason":"host-adapter-unimplemented"}"#
        );
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
        let event = ActivationRegistryEventPayload::new(
            1710000000000,
            ActivationRegistryEventPhase::Routed,
            "palette",
            ActivationRegistrySource::GlobalShortcut,
            actor,
            permission_context,
        );
        let supported =
            ActivationRegistrySupportedPayload::unsupported(ACTIVATION_REGISTRY_UNSUPPORTED_REASON);

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
            r#"{"supported":false,"reason":"host-adapter-unimplemented"}"#
        );
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
        let supported =
            ResidentLifecycleSupportedPayload::unsupported(RESIDENT_LIFECYCLE_UNSUPPORTED_REASON);

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
            r#"{"supported":false,"reason":"host-adapter-unimplemented"}"#
        );
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
        let event = DistributionParityEventPayload::new(
            1710000000000,
            DistributionParityEventPhase::Verified,
            "extension-1",
            Some("1.0.0".to_string()),
            None,
        );
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
            None,
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
