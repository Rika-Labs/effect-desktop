#![allow(clippy::result_large_err)]

use host_protocol::{
    FocusedApplicationContextActorPayload, FocusedApplicationContextSnapshotPayload,
    FocusedApplicationContextStopWatchingPayload, FocusedApplicationContextSupportedPayload,
    FocusedApplicationContextWatchPayload, HostProtocolError,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{to_value, Value};

pub(crate) fn snapshot(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<FocusedApplicationContextSnapshotPayload>(
        payload,
        host_protocol::FOCUSED_APPLICATION_CONTEXT_SNAPSHOT_METHOD,
    )?;
    validate_actor(
        input.actor(),
        host_protocol::FOCUSED_APPLICATION_CONTEXT_SNAPSHOT_METHOD,
    )?;
    validate_trace_id(
        input.trace_id(),
        host_protocol::FOCUSED_APPLICATION_CONTEXT_SNAPSHOT_METHOD,
    )?;
    Err(unsupported(
        host_protocol::FOCUSED_APPLICATION_CONTEXT_SNAPSHOT_METHOD,
    ))
}

pub(crate) fn watch(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<FocusedApplicationContextWatchPayload>(
        payload,
        host_protocol::FOCUSED_APPLICATION_CONTEXT_WATCH_METHOD,
    )?;
    validate_actor(
        input.actor(),
        host_protocol::FOCUSED_APPLICATION_CONTEXT_WATCH_METHOD,
    )?;
    if let Some(watch_id) = input.watch_id() {
        validate_non_empty(
            "watchId",
            watch_id,
            host_protocol::FOCUSED_APPLICATION_CONTEXT_WATCH_METHOD,
        )?;
    }
    if let Some(owner_scope) = input.owner_scope() {
        validate_non_empty(
            "ownerScope",
            owner_scope,
            host_protocol::FOCUSED_APPLICATION_CONTEXT_WATCH_METHOD,
        )?;
    }
    validate_trace_id(
        input.trace_id(),
        host_protocol::FOCUSED_APPLICATION_CONTEXT_WATCH_METHOD,
    )?;
    Err(unsupported(
        host_protocol::FOCUSED_APPLICATION_CONTEXT_WATCH_METHOD,
    ))
}

pub(crate) fn stop_watching(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<FocusedApplicationContextStopWatchingPayload>(
        payload,
        host_protocol::FOCUSED_APPLICATION_CONTEXT_STOP_WATCHING_METHOD,
    )?;
    validate_actor(
        input.actor(),
        host_protocol::FOCUSED_APPLICATION_CONTEXT_STOP_WATCHING_METHOD,
    )?;
    validate_non_empty(
        "watchId",
        input.watch_id(),
        host_protocol::FOCUSED_APPLICATION_CONTEXT_STOP_WATCHING_METHOD,
    )?;
    validate_trace_id(
        input.trace_id(),
        host_protocol::FOCUSED_APPLICATION_CONTEXT_STOP_WATCHING_METHOD,
    )?;
    Err(unsupported(
        host_protocol::FOCUSED_APPLICATION_CONTEXT_STOP_WATCHING_METHOD,
    ))
}

pub(crate) fn is_supported() -> Result<Option<Value>, HostProtocolError> {
    encode_payload(
        FocusedApplicationContextSupportedPayload::unsupported(
            host_protocol::FOCUSED_APPLICATION_CONTEXT_UNSUPPORTED_REASON,
        ),
        host_protocol::FOCUSED_APPLICATION_CONTEXT_IS_SUPPORTED_METHOD,
    )
}

fn decode_payload<T: DeserializeOwned>(
    payload: Option<Value>,
    operation: &'static str,
) -> Result<T, HostProtocolError> {
    let payload = payload
        .ok_or_else(|| HostProtocolError::invalid_argument("payload", "is required", operation))?;
    serde_json::from_value(payload).map_err(|error| {
        HostProtocolError::invalid_argument("payload", error.to_string(), operation)
    })
}

fn encode_payload<T: Serialize>(
    payload: T,
    operation: &'static str,
) -> Result<Option<Value>, HostProtocolError> {
    to_value(payload).map(Some).map_err(|error| {
        HostProtocolError::internal(
            format!("failed to encode focused application context payload: {error}"),
            operation,
        )
    })
}

fn validate_actor(
    actor: &FocusedApplicationContextActorPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_printable_non_empty("actor.id", actor.id(), operation)
}

fn validate_trace_id(
    trace_id: Option<&str>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if let Some(trace_id) = trace_id {
        validate_non_empty("traceId", trace_id, operation)?;
    }
    Ok(())
}

fn validate_non_empty(
    field: &str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_no_nul(field, value, operation)?;
    if value.trim().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be non-empty",
            operation,
        ));
    }
    Ok(())
}

fn validate_printable_non_empty(
    field: &str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_non_empty(field, value, operation)?;
    if value.chars().any(char::is_control) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not include control characters",
            operation,
        ));
    }
    Ok(())
}

fn validate_no_nul(
    field: &str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if value.contains('\0') {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not contain NUL",
            operation,
        ));
    }
    Ok(())
}

fn unsupported(operation: &'static str) -> HostProtocolError {
    HostProtocolError::unsupported(
        host_protocol::FOCUSED_APPLICATION_CONTEXT_UNSUPPORTED_REASON,
        operation,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use host_protocol::{
        FocusedApplicationContextEventPayload, FocusedApplicationContextEventPhase,
        FocusedApplicationContextSnapshotResultPayload,
        FocusedApplicationContextStopWatchingResultPayload,
        FocusedApplicationContextWatchResultPayload, FocusedApplicationMetadataPayload,
        HostProtocolError,
    };
    use serde_json::json;

    #[test]
    fn snapshot_validates_before_returning_unsupported() {
        let error = snapshot(Some(valid_snapshot())).expect_err("host adapter is not implemented");

        assert!(matches!(error, HostProtocolError::Unsupported { .. }));
    }

    #[test]
    fn snapshot_rejects_control_byte_actor_before_unsupported() {
        let invalid = json!({
            "actor": { "kind": "workspace", "id": "workspace\n1" }
        });

        let error = snapshot(Some(invalid)).expect_err("invalid input should fail");

        assert!(matches!(error, HostProtocolError::InvalidArgument { .. }));
    }

    #[test]
    fn watch_rejects_blank_owner_scope_before_unsupported() {
        let invalid = json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "watchId": "watch-1",
            "ownerScope": " "
        });

        let error = watch(Some(invalid)).expect_err("invalid input should fail");

        assert!(matches!(error, HostProtocolError::InvalidArgument { .. }));
    }

    #[test]
    fn stop_watching_rejects_blank_watch_id_before_unsupported() {
        let invalid = json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "watchId": " "
        });

        let error = stop_watching(Some(invalid)).expect_err("invalid input should fail");

        assert!(matches!(error, HostProtocolError::InvalidArgument { .. }));
    }

    #[test]
    fn is_supported_reports_unimplemented_adapter() {
        let payload = is_supported()
            .expect("support query should encode")
            .expect("support query returns payload");

        assert_eq!(
            payload,
            json!({
                "supported": false,
                "reason": host_protocol::FOCUSED_APPLICATION_CONTEXT_UNSUPPORTED_REASON
            })
        );
    }

    #[test]
    fn protocol_result_and_event_payloads_encode_camel_case_contracts() {
        let snapshot = serde_json::to_value(FocusedApplicationContextSnapshotResultPayload::new(
            FocusedApplicationMetadataPayload::new("app-1"),
            100,
        ))
        .expect("snapshot should encode");
        let watch = serde_json::to_value(FocusedApplicationContextWatchResultPayload::new(
            "watch-1", true,
        ))
        .expect("watch should encode");
        let stopped = serde_json::to_value(
            FocusedApplicationContextStopWatchingResultPayload::new("watch-1", true),
        )
        .expect("stop result should encode");
        let event = serde_json::to_value(FocusedApplicationContextEventPayload::new(
            100,
            FocusedApplicationContextEventPhase::WatchStarted,
        ))
        .expect("event should encode");

        assert_eq!(snapshot["application"]["applicationId"], json!("app-1"));
        assert_eq!(snapshot["observedAt"], json!(100));
        assert_eq!(watch["watchId"], json!("watch-1"));
        assert_eq!(stopped["stopped"], json!(true));
        assert_eq!(event["type"], json!("focused-application-context-event"));
        assert_eq!(event["phase"], json!("watch-started"));
    }

    fn valid_snapshot() -> Value {
        json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "traceId": "trace-1"
        })
    }
}
