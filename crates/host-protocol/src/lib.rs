//! Host-runtime protocol wire types.

use serde::{de, Deserialize, Deserializer, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum HostProtocolEnvelope {
    Request {
        id: String,
        method: String,
        timestamp: u64,
        trace_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        window_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        origin_token: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        payload: Option<Value>,
    },
    Response {
        id: String,
        timestamp: u64,
        trace_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        payload: Option<Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<HostProtocolError>,
    },
    Event {
        method: String,
        timestamp: u64,
        trace_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        window_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        payload: Option<Value>,
    },
    Stream {
        #[serde(skip_serializing_if = "Option::is_none")]
        id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        resource_id: Option<String>,
        timestamp: u64,
        trace_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        payload: Option<Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<HostProtocolError>,
    },
    Cancel {
        #[serde(skip_serializing_if = "Option::is_none")]
        id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        resource_id: Option<String>,
        timestamp: u64,
        trace_id: String,
    },
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

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
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
                trace_id,
                window_id,
                origin_token,
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
                trace_id,
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
                trace_id,
                window_id,
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
                    trace_id,
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
                    trace_id,
                })
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "tag", rename_all_fields = "camelCase")]
pub enum HostProtocolError {
    FileNotFound {
        path: String,
    },
    PermissionDenied {
        capability: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        resource: Option<String>,
    },
    Timeout {
        timeout_ms: u64,
    },
    Cancelled {
        source: String,
    },
    Unsupported {
        reason: String,
    },
    InvalidArgument {
        field: String,
        reason: String,
    },
    ResourceBusy {
        resource: String,
    },
    DiskFull {
        path: String,
        free_bytes: u64,
    },
    RateLimited {
        retry_after_ms: u64,
    },
    FrameTooLarge {
        size_bytes: u64,
        limit_bytes: u64,
    },
    OriginInvalid,
    StaleHandle {
        kind: String,
        id: String,
        expected_generation: u32,
        actual_generation: u32,
    },
    CrossScopeHandle {
        kind: String,
        id: String,
        owner_scope: String,
        attempted_scope: String,
    },
    BackpressureOverflow {
        policy: String,
        lost_frames: u64,
    },
    RendererDisconnected {
        duration_ms: u64,
    },
    RuntimeRestarted,
    RuntimeUnavailable {
        retry_after_ms: u64,
    },
    HostUnavailable,
    MethodNotFound {
        method: String,
    },
    InvalidOutput {
        method: String,
        reason: String,
    },
    PermissionRevoked {
        capability: String,
        revoked_at: u64,
    },
    StreamClosed {
        stream_id: String,
    },
    BinaryDecodeError {
        reason: String,
    },
    ReconnectBackfillExhausted {
        stream_id: String,
    },
    PanicInNativeCode {
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        backtrace: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        location: Option<String>,
    },
    NetworkError {
        kind: String,
        message: String,
    },
    NotFound {
        resource: String,
    },
    AlreadyExists {
        resource: String,
    },
    InvalidState {
        current: String,
        attempted: String,
    },
    SymlinkEscapesRoot {
        requested: String,
        resolved: String,
        capability_roots: Vec<String>,
    },
    EventLogFull {
        free_bytes: u64,
    },
    UpdateDowngradeRefused {
        installed_version: String,
        manifest_version: String,
    },
    UpdateDownloadTruncated {
        downloaded_bytes: u64,
        expected_bytes: u64,
    },
    UpdateStaleNotarization {
        notarized_at: String,
    },
    SettingsMigrationFailed {
        schema_version: u32,
        cause: String,
    },
    SettingsRecoveredFromBackup {
        backup_path: String,
    },
    EventLogSegmentCorrupt {
        segment_path: String,
    },
    PtyForceKillTimeout {
        pty_id: String,
    },
    Internal {
        message: String,
    },
}

#[cfg(test)]
mod tests {
    use super::{HostProtocolEnvelope, HostProtocolError};
    use std::{fs, path::PathBuf};

    const FIXTURE_NAMES: &[&str] = &[
        "request.json",
        "response.json",
        "event.json",
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
