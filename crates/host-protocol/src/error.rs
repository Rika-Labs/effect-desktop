use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct HostProtocolErrorSpec {
    pub tag: &'static str,
    pub recoverable: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HostProtocolPlatform {
    Macos,
    Windows,
    Linux,
}

pub const HOST_PROTOCOL_ERROR_SPECS: &[HostProtocolErrorSpec] = &[
    HostProtocolErrorSpec {
        tag: "FileNotFound",
        recoverable: false,
    },
    HostProtocolErrorSpec {
        tag: "PermissionDenied",
        recoverable: false,
    },
    HostProtocolErrorSpec {
        tag: "Timeout",
        recoverable: true,
    },
    HostProtocolErrorSpec {
        tag: "Cancelled",
        recoverable: true,
    },
    HostProtocolErrorSpec {
        tag: "Unsupported",
        recoverable: false,
    },
    HostProtocolErrorSpec {
        tag: "InvalidArgument",
        recoverable: false,
    },
    HostProtocolErrorSpec {
        tag: "ResourceBusy",
        recoverable: true,
    },
    HostProtocolErrorSpec {
        tag: "DiskFull",
        recoverable: true,
    },
    HostProtocolErrorSpec {
        tag: "RateLimited",
        recoverable: true,
    },
    HostProtocolErrorSpec {
        tag: "FrameTooLarge",
        recoverable: false,
    },
    HostProtocolErrorSpec {
        tag: "OriginInvalid",
        recoverable: false,
    },
    HostProtocolErrorSpec {
        tag: "StaleHandle",
        recoverable: false,
    },
    HostProtocolErrorSpec {
        tag: "CrossScopeHandle",
        recoverable: false,
    },
    HostProtocolErrorSpec {
        tag: "BackpressureOverflow",
        recoverable: true,
    },
    HostProtocolErrorSpec {
        tag: "RendererDisconnected",
        recoverable: true,
    },
    HostProtocolErrorSpec {
        tag: "RuntimeRestarted",
        recoverable: true,
    },
    HostProtocolErrorSpec {
        tag: "RuntimeUnavailable",
        recoverable: true,
    },
    HostProtocolErrorSpec {
        tag: "HostUnavailable",
        recoverable: true,
    },
    HostProtocolErrorSpec {
        tag: "MethodNotFound",
        recoverable: false,
    },
    HostProtocolErrorSpec {
        tag: "InvalidOutput",
        recoverable: false,
    },
    HostProtocolErrorSpec {
        tag: "PermissionRevoked",
        recoverable: false,
    },
    HostProtocolErrorSpec {
        tag: "StreamClosed",
        recoverable: false,
    },
    HostProtocolErrorSpec {
        tag: "BinaryDecodeError",
        recoverable: false,
    },
    HostProtocolErrorSpec {
        tag: "ReconnectBackfillExhausted",
        recoverable: false,
    },
    HostProtocolErrorSpec {
        tag: "PanicInNativeCode",
        recoverable: false,
    },
    HostProtocolErrorSpec {
        tag: "NetworkError",
        recoverable: true,
    },
    HostProtocolErrorSpec {
        tag: "NotFound",
        recoverable: false,
    },
    HostProtocolErrorSpec {
        tag: "AlreadyExists",
        recoverable: false,
    },
    HostProtocolErrorSpec {
        tag: "InvalidState",
        recoverable: false,
    },
    HostProtocolErrorSpec {
        tag: "SymlinkEscapesRoot",
        recoverable: false,
    },
    HostProtocolErrorSpec {
        tag: "EventLogFull",
        recoverable: true,
    },
    HostProtocolErrorSpec {
        tag: "UpdateDowngradeRefused",
        recoverable: false,
    },
    HostProtocolErrorSpec {
        tag: "UpdateDownloadTruncated",
        recoverable: true,
    },
    HostProtocolErrorSpec {
        tag: "UpdateStaleNotarization",
        recoverable: false,
    },
    HostProtocolErrorSpec {
        tag: "UpdateSignatureInvalid",
        recoverable: false,
    },
    HostProtocolErrorSpec {
        tag: "SettingsMigrationFailed",
        recoverable: false,
    },
    HostProtocolErrorSpec {
        tag: "SettingsRecoveredFromBackup",
        recoverable: true,
    },
    HostProtocolErrorSpec {
        tag: "EventLogSegmentCorrupt",
        recoverable: false,
    },
    HostProtocolErrorSpec {
        tag: "PtyForceKillTimeout",
        recoverable: false,
    },
    HostProtocolErrorSpec {
        tag: "Internal",
        recoverable: false,
    },
];

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "tag", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum HostProtocolError {
    FileNotFound {
        path: String,
        message: String,
        operation: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        platform: Option<HostProtocolPlatform>,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cause: Option<Value>,
        recoverable: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        remediation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        docs_url: Option<String>,
    },
    PermissionDenied {
        capability: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        resource: Option<String>,
        message: String,
        operation: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        platform: Option<HostProtocolPlatform>,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cause: Option<Value>,
        recoverable: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        remediation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        docs_url: Option<String>,
    },
    Timeout {
        timeout_ms: u64,
        message: String,
        operation: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        platform: Option<HostProtocolPlatform>,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cause: Option<Value>,
        recoverable: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        remediation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        docs_url: Option<String>,
    },
    Cancelled {
        source: String,
        message: String,
        operation: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        platform: Option<HostProtocolPlatform>,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cause: Option<Value>,
        recoverable: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        remediation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        docs_url: Option<String>,
    },
    Unsupported {
        reason: String,
        message: String,
        operation: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        platform: Option<HostProtocolPlatform>,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cause: Option<Value>,
        recoverable: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        remediation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        docs_url: Option<String>,
    },
    InvalidArgument {
        field: String,
        reason: String,
        message: String,
        operation: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        platform: Option<HostProtocolPlatform>,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cause: Option<Value>,
        recoverable: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        remediation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        docs_url: Option<String>,
    },
    ResourceBusy {
        resource: String,
        message: String,
        operation: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        platform: Option<HostProtocolPlatform>,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cause: Option<Value>,
        recoverable: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        remediation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        docs_url: Option<String>,
    },
    DiskFull {
        path: String,
        free_bytes: u64,
        message: String,
        operation: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        platform: Option<HostProtocolPlatform>,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cause: Option<Value>,
        recoverable: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        remediation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        docs_url: Option<String>,
    },
    RateLimited {
        retry_after_ms: u64,
        message: String,
        operation: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        platform: Option<HostProtocolPlatform>,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cause: Option<Value>,
        recoverable: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        remediation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        docs_url: Option<String>,
    },
    FrameTooLarge {
        size_bytes: u64,
        limit_bytes: u64,
        message: String,
        operation: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        platform: Option<HostProtocolPlatform>,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cause: Option<Value>,
        recoverable: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        remediation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        docs_url: Option<String>,
    },
    OriginInvalid {
        message: String,
        operation: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        platform: Option<HostProtocolPlatform>,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cause: Option<Value>,
        recoverable: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        remediation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        docs_url: Option<String>,
    },
    StaleHandle {
        kind: String,
        id: String,
        expected_generation: u32,
        actual_generation: u32,
        message: String,
        operation: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        platform: Option<HostProtocolPlatform>,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cause: Option<Value>,
        recoverable: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        remediation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        docs_url: Option<String>,
    },
    CrossScopeHandle {
        kind: String,
        id: String,
        owner_scope: String,
        attempted_scope: String,
        message: String,
        operation: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        platform: Option<HostProtocolPlatform>,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cause: Option<Value>,
        recoverable: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        remediation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        docs_url: Option<String>,
    },
    BackpressureOverflow {
        policy: String,
        lost_frames: u64,
        message: String,
        operation: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        platform: Option<HostProtocolPlatform>,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cause: Option<Value>,
        recoverable: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        remediation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        docs_url: Option<String>,
    },
    RendererDisconnected {
        duration_ms: u64,
        message: String,
        operation: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        platform: Option<HostProtocolPlatform>,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cause: Option<Value>,
        recoverable: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        remediation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        docs_url: Option<String>,
    },
    RuntimeRestarted {
        message: String,
        operation: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        platform: Option<HostProtocolPlatform>,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cause: Option<Value>,
        recoverable: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        remediation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        docs_url: Option<String>,
    },
    RuntimeUnavailable {
        retry_after_ms: u64,
        message: String,
        operation: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        platform: Option<HostProtocolPlatform>,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cause: Option<Value>,
        recoverable: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        remediation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        docs_url: Option<String>,
    },
    HostUnavailable {
        message: String,
        operation: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        platform: Option<HostProtocolPlatform>,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cause: Option<Value>,
        recoverable: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        remediation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        docs_url: Option<String>,
    },
    MethodNotFound {
        method: String,
        message: String,
        operation: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        platform: Option<HostProtocolPlatform>,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cause: Option<Value>,
        recoverable: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        remediation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        docs_url: Option<String>,
    },
    InvalidOutput {
        method: String,
        reason: String,
        message: String,
        operation: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        platform: Option<HostProtocolPlatform>,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cause: Option<Value>,
        recoverable: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        remediation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        docs_url: Option<String>,
    },
    PermissionRevoked {
        capability: String,
        revoked_at: u64,
        message: String,
        operation: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        platform: Option<HostProtocolPlatform>,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cause: Option<Value>,
        recoverable: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        remediation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        docs_url: Option<String>,
    },
    StreamClosed {
        stream_id: String,
        message: String,
        operation: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        platform: Option<HostProtocolPlatform>,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cause: Option<Value>,
        recoverable: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        remediation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        docs_url: Option<String>,
    },
    BinaryDecodeError {
        reason: String,
        message: String,
        operation: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        platform: Option<HostProtocolPlatform>,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cause: Option<Value>,
        recoverable: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        remediation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        docs_url: Option<String>,
    },
    ReconnectBackfillExhausted {
        stream_id: String,
        message: String,
        operation: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        platform: Option<HostProtocolPlatform>,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cause: Option<Value>,
        recoverable: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        remediation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        docs_url: Option<String>,
    },
    PanicInNativeCode {
        #[serde(skip_serializing_if = "Option::is_none")]
        backtrace: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        location: Option<String>,
        message: String,
        operation: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        platform: Option<HostProtocolPlatform>,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cause: Option<Value>,
        recoverable: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        remediation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        docs_url: Option<String>,
    },
    NetworkError {
        kind: String,
        message: String,
        operation: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        platform: Option<HostProtocolPlatform>,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cause: Option<Value>,
        recoverable: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        remediation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        docs_url: Option<String>,
    },
    NotFound {
        resource: String,
        message: String,
        operation: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        platform: Option<HostProtocolPlatform>,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cause: Option<Value>,
        recoverable: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        remediation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        docs_url: Option<String>,
    },
    AlreadyExists {
        resource: String,
        message: String,
        operation: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        platform: Option<HostProtocolPlatform>,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cause: Option<Value>,
        recoverable: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        remediation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        docs_url: Option<String>,
    },
    InvalidState {
        current: String,
        attempted: String,
        message: String,
        operation: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        platform: Option<HostProtocolPlatform>,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cause: Option<Value>,
        recoverable: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        remediation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        docs_url: Option<String>,
    },
    SymlinkEscapesRoot {
        requested: String,
        resolved: String,
        capability_roots: Vec<String>,
        message: String,
        operation: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        platform: Option<HostProtocolPlatform>,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cause: Option<Value>,
        recoverable: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        remediation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        docs_url: Option<String>,
    },
    EventLogFull {
        free_bytes: u64,
        message: String,
        operation: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        platform: Option<HostProtocolPlatform>,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cause: Option<Value>,
        recoverable: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        remediation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        docs_url: Option<String>,
    },
    UpdateDowngradeRefused {
        installed_version: String,
        manifest_version: String,
        message: String,
        operation: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        platform: Option<HostProtocolPlatform>,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cause: Option<Value>,
        recoverable: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        remediation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        docs_url: Option<String>,
    },
    UpdateDownloadTruncated {
        downloaded_bytes: u64,
        expected_bytes: u64,
        message: String,
        operation: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        platform: Option<HostProtocolPlatform>,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cause: Option<Value>,
        recoverable: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        remediation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        docs_url: Option<String>,
    },
    UpdateStaleNotarization {
        notarized_at: String,
        message: String,
        operation: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        platform: Option<HostProtocolPlatform>,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cause: Option<Value>,
        recoverable: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        remediation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        docs_url: Option<String>,
    },
    UpdateSignatureInvalid {
        artifact: String,
        key_version: u32,
        message: String,
        operation: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        platform: Option<HostProtocolPlatform>,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cause: Option<Value>,
        recoverable: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        remediation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        docs_url: Option<String>,
    },
    SettingsMigrationFailed {
        schema_version: u32,
        cause: String,
        message: String,
        operation: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        platform: Option<HostProtocolPlatform>,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        recoverable: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        remediation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        docs_url: Option<String>,
    },
    SettingsRecoveredFromBackup {
        backup_path: String,
        message: String,
        operation: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        platform: Option<HostProtocolPlatform>,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cause: Option<Value>,
        recoverable: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        remediation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        docs_url: Option<String>,
    },
    EventLogSegmentCorrupt {
        segment_path: String,
        message: String,
        operation: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        platform: Option<HostProtocolPlatform>,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cause: Option<Value>,
        recoverable: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        remediation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        docs_url: Option<String>,
    },
    PtyForceKillTimeout {
        pty_id: String,
        message: String,
        operation: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        platform: Option<HostProtocolPlatform>,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cause: Option<Value>,
        recoverable: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        remediation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        docs_url: Option<String>,
    },
    Internal {
        message: String,
        operation: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        platform: Option<HostProtocolPlatform>,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cause: Option<Value>,
        recoverable: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        remediation: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        docs_url: Option<String>,
    },
}

impl HostProtocolError {
    pub fn tag(&self) -> &'static str {
        match self {
            Self::FileNotFound { .. } => "FileNotFound",
            Self::PermissionDenied { .. } => "PermissionDenied",
            Self::Timeout { .. } => "Timeout",
            Self::Cancelled { .. } => "Cancelled",
            Self::Unsupported { .. } => "Unsupported",
            Self::InvalidArgument { .. } => "InvalidArgument",
            Self::ResourceBusy { .. } => "ResourceBusy",
            Self::DiskFull { .. } => "DiskFull",
            Self::RateLimited { .. } => "RateLimited",
            Self::FrameTooLarge { .. } => "FrameTooLarge",
            Self::OriginInvalid { .. } => "OriginInvalid",
            Self::StaleHandle { .. } => "StaleHandle",
            Self::CrossScopeHandle { .. } => "CrossScopeHandle",
            Self::BackpressureOverflow { .. } => "BackpressureOverflow",
            Self::RendererDisconnected { .. } => "RendererDisconnected",
            Self::RuntimeRestarted { .. } => "RuntimeRestarted",
            Self::RuntimeUnavailable { .. } => "RuntimeUnavailable",
            Self::HostUnavailable { .. } => "HostUnavailable",
            Self::MethodNotFound { .. } => "MethodNotFound",
            Self::InvalidOutput { .. } => "InvalidOutput",
            Self::PermissionRevoked { .. } => "PermissionRevoked",
            Self::StreamClosed { .. } => "StreamClosed",
            Self::BinaryDecodeError { .. } => "BinaryDecodeError",
            Self::ReconnectBackfillExhausted { .. } => "ReconnectBackfillExhausted",
            Self::PanicInNativeCode { .. } => "PanicInNativeCode",
            Self::NetworkError { .. } => "NetworkError",
            Self::NotFound { .. } => "NotFound",
            Self::AlreadyExists { .. } => "AlreadyExists",
            Self::InvalidState { .. } => "InvalidState",
            Self::SymlinkEscapesRoot { .. } => "SymlinkEscapesRoot",
            Self::EventLogFull { .. } => "EventLogFull",
            Self::UpdateDowngradeRefused { .. } => "UpdateDowngradeRefused",
            Self::UpdateDownloadTruncated { .. } => "UpdateDownloadTruncated",
            Self::UpdateStaleNotarization { .. } => "UpdateStaleNotarization",
            Self::UpdateSignatureInvalid { .. } => "UpdateSignatureInvalid",
            Self::SettingsMigrationFailed { .. } => "SettingsMigrationFailed",
            Self::SettingsRecoveredFromBackup { .. } => "SettingsRecoveredFromBackup",
            Self::EventLogSegmentCorrupt { .. } => "EventLogSegmentCorrupt",
            Self::PtyForceKillTimeout { .. } => "PtyForceKillTimeout",
            Self::Internal { .. } => "Internal",
        }
    }

    pub fn recoverable(&self) -> bool {
        match self {
            Self::FileNotFound { recoverable, .. } => *recoverable,
            Self::PermissionDenied { recoverable, .. } => *recoverable,
            Self::Timeout { recoverable, .. } => *recoverable,
            Self::Cancelled { recoverable, .. } => *recoverable,
            Self::Unsupported { recoverable, .. } => *recoverable,
            Self::InvalidArgument { recoverable, .. } => *recoverable,
            Self::ResourceBusy { recoverable, .. } => *recoverable,
            Self::DiskFull { recoverable, .. } => *recoverable,
            Self::RateLimited { recoverable, .. } => *recoverable,
            Self::FrameTooLarge { recoverable, .. } => *recoverable,
            Self::OriginInvalid { recoverable, .. } => *recoverable,
            Self::StaleHandle { recoverable, .. } => *recoverable,
            Self::CrossScopeHandle { recoverable, .. } => *recoverable,
            Self::BackpressureOverflow { recoverable, .. } => *recoverable,
            Self::RendererDisconnected { recoverable, .. } => *recoverable,
            Self::RuntimeRestarted { recoverable, .. } => *recoverable,
            Self::RuntimeUnavailable { recoverable, .. } => *recoverable,
            Self::HostUnavailable { recoverable, .. } => *recoverable,
            Self::MethodNotFound { recoverable, .. } => *recoverable,
            Self::InvalidOutput { recoverable, .. } => *recoverable,
            Self::PermissionRevoked { recoverable, .. } => *recoverable,
            Self::StreamClosed { recoverable, .. } => *recoverable,
            Self::BinaryDecodeError { recoverable, .. } => *recoverable,
            Self::ReconnectBackfillExhausted { recoverable, .. } => *recoverable,
            Self::PanicInNativeCode { recoverable, .. } => *recoverable,
            Self::NetworkError { recoverable, .. } => *recoverable,
            Self::NotFound { recoverable, .. } => *recoverable,
            Self::AlreadyExists { recoverable, .. } => *recoverable,
            Self::InvalidState { recoverable, .. } => *recoverable,
            Self::SymlinkEscapesRoot { recoverable, .. } => *recoverable,
            Self::EventLogFull { recoverable, .. } => *recoverable,
            Self::UpdateDowngradeRefused { recoverable, .. } => *recoverable,
            Self::UpdateDownloadTruncated { recoverable, .. } => *recoverable,
            Self::UpdateStaleNotarization { recoverable, .. } => *recoverable,
            Self::UpdateSignatureInvalid { recoverable, .. } => *recoverable,
            Self::SettingsMigrationFailed { recoverable, .. } => *recoverable,
            Self::SettingsRecoveredFromBackup { recoverable, .. } => *recoverable,
            Self::EventLogSegmentCorrupt { recoverable, .. } => *recoverable,
            Self::PtyForceKillTimeout { recoverable, .. } => *recoverable,
            Self::Internal { recoverable, .. } => *recoverable,
        }
    }

    pub fn recoverable_default(tag: &str) -> Option<bool> {
        HOST_PROTOCOL_ERROR_SPECS
            .iter()
            .find(|spec| spec.tag == tag)
            .map(|spec| spec.recoverable)
    }

    pub fn invalid_argument(
        field: impl Into<String>,
        reason: impl Into<String>,
        operation: impl Into<String>,
    ) -> Self {
        let field = field.into();
        let reason = reason.into();
        Self::InvalidArgument {
            message: format!("invalid argument {field}: {reason}"),
            operation: operation.into(),
            platform: None,
            code: None,
            cause: None,
            recoverable: Self::recoverable_default("InvalidArgument").expect("known tag"),
            remediation: None,
            docs_url: None,
            field,
            reason,
        }
    }

    pub fn unsupported(reason: impl Into<String>, operation: impl Into<String>) -> Self {
        let reason = reason.into();
        let operation = operation.into();
        Self::Unsupported {
            message: format!("unsupported operation {operation}: {reason}"),
            operation,
            platform: None,
            code: None,
            cause: None,
            recoverable: Self::recoverable_default("Unsupported").expect("known tag"),
            remediation: None,
            docs_url: None,
            reason,
        }
    }

    pub fn update_signature_invalid(
        artifact: impl Into<String>,
        key_version: u32,
        message: impl Into<String>,
        operation: impl Into<String>,
    ) -> Self {
        Self::UpdateSignatureInvalid {
            artifact: artifact.into(),
            key_version,
            message: message.into(),
            operation: operation.into(),
            platform: None,
            code: None,
            cause: None,
            recoverable: Self::recoverable_default("UpdateSignatureInvalid").expect("known tag"),
            remediation: None,
            docs_url: None,
        }
    }

    pub fn internal(message: impl Into<String>, operation: impl Into<String>) -> Self {
        Self::Internal {
            message: message.into(),
            operation: operation.into(),
            platform: None,
            code: None,
            cause: None,
            recoverable: Self::recoverable_default("Internal").expect("known tag"),
            remediation: None,
            docs_url: None,
        }
    }

    pub fn host_unavailable(operation: impl Into<String>) -> Self {
        Self::HostUnavailable {
            message: "host is unavailable".to_string(),
            operation: operation.into(),
            platform: None,
            code: None,
            cause: None,
            recoverable: Self::recoverable_default("HostUnavailable").expect("known tag"),
            remediation: None,
            docs_url: None,
        }
    }

    pub fn method_not_found(method: impl Into<String>) -> Self {
        let method = method.into();
        Self::MethodNotFound {
            message: format!("host method not found: {method}"),
            operation: method.clone(),
            platform: None,
            code: None,
            cause: None,
            recoverable: Self::recoverable_default("MethodNotFound").expect("known tag"),
            remediation: None,
            docs_url: None,
            method,
        }
    }

    pub fn invalid_output(method: impl Into<String>, reason: impl Into<String>) -> Self {
        let method = method.into();
        let reason = reason.into();
        Self::InvalidOutput {
            message: format!("invalid output from {method}: {reason}"),
            operation: method.clone(),
            platform: None,
            code: None,
            cause: None,
            recoverable: Self::recoverable_default("InvalidOutput").expect("known tag"),
            remediation: None,
            docs_url: None,
            method,
            reason,
        }
    }

    pub fn not_found(resource: impl Into<String>, operation: impl Into<String>) -> Self {
        let resource = resource.into();
        Self::NotFound {
            message: format!("resource not found: {resource}"),
            operation: operation.into(),
            platform: None,
            code: None,
            cause: None,
            recoverable: Self::recoverable_default("NotFound").expect("known tag"),
            remediation: None,
            docs_url: None,
            resource,
        }
    }
}
