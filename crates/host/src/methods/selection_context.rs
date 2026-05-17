#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{
    HostProtocolError, SelectionContextActorPayload, SelectionContextReadDocumentPayload,
    SelectionContextReadSelectionPayload, SelectionContextStopWatchingPayload,
    SelectionContextSupportedPayload, SelectionContextWatchFocusPayload,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{to_value, Value};

pub(crate) fn read_selection(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<SelectionContextReadSelectionPayload>(
        payload,
        host_protocol::SELECTION_CONTEXT_READ_SELECTION_METHOD,
    )?;
    validate_actor(
        input.actor(),
        host_protocol::SELECTION_CONTEXT_READ_SELECTION_METHOD,
    )?;
    validate_trace_id(
        input.trace_id(),
        host_protocol::SELECTION_CONTEXT_READ_SELECTION_METHOD,
    )?;
    Err(unsupported(
        host_protocol::SELECTION_CONTEXT_READ_SELECTION_METHOD,
    ))
}

pub(crate) fn read_document(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<SelectionContextReadDocumentPayload>(
        payload,
        host_protocol::SELECTION_CONTEXT_READ_DOCUMENT_METHOD,
    )?;
    validate_actor(
        input.actor(),
        host_protocol::SELECTION_CONTEXT_READ_DOCUMENT_METHOD,
    )?;
    validate_trace_id(
        input.trace_id(),
        host_protocol::SELECTION_CONTEXT_READ_DOCUMENT_METHOD,
    )?;
    Err(unsupported(
        host_protocol::SELECTION_CONTEXT_READ_DOCUMENT_METHOD,
    ))
}

pub(crate) fn watch_focus(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<SelectionContextWatchFocusPayload>(
        payload,
        host_protocol::SELECTION_CONTEXT_WATCH_FOCUS_METHOD,
    )?;
    validate_actor(
        input.actor(),
        host_protocol::SELECTION_CONTEXT_WATCH_FOCUS_METHOD,
    )?;
    if let Some(watch_id) = input.watch_id() {
        validate_non_empty(
            "watchId",
            watch_id,
            host_protocol::SELECTION_CONTEXT_WATCH_FOCUS_METHOD,
        )?;
    }
    if let Some(owner_scope) = input.owner_scope() {
        validate_non_empty(
            "ownerScope",
            owner_scope,
            host_protocol::SELECTION_CONTEXT_WATCH_FOCUS_METHOD,
        )?;
    }
    validate_trace_id(
        input.trace_id(),
        host_protocol::SELECTION_CONTEXT_WATCH_FOCUS_METHOD,
    )?;
    Err(unsupported(
        host_protocol::SELECTION_CONTEXT_WATCH_FOCUS_METHOD,
    ))
}

pub(crate) fn stop_watching(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<SelectionContextStopWatchingPayload>(
        payload,
        host_protocol::SELECTION_CONTEXT_STOP_WATCHING_METHOD,
    )?;
    validate_actor(
        input.actor(),
        host_protocol::SELECTION_CONTEXT_STOP_WATCHING_METHOD,
    )?;
    validate_non_empty(
        "watchId",
        input.watch_id(),
        host_protocol::SELECTION_CONTEXT_STOP_WATCHING_METHOD,
    )?;
    validate_trace_id(
        input.trace_id(),
        host_protocol::SELECTION_CONTEXT_STOP_WATCHING_METHOD,
    )?;
    Err(unsupported(
        host_protocol::SELECTION_CONTEXT_STOP_WATCHING_METHOD,
    ))
}

pub(crate) fn is_supported() -> Result<Option<Value>, HostProtocolError> {
    encode_payload(
        SelectionContextSupportedPayload::unsupported(
            host_protocol::SELECTION_CONTEXT_UNSUPPORTED_REASON,
        ),
        host_protocol::SELECTION_CONTEXT_IS_SUPPORTED_METHOD,
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
            format!("failed to encode selection context payload: {error}"),
            operation,
        )
    })
}

fn validate_actor(
    actor: &SelectionContextActorPayload,
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
        host_protocol::SELECTION_CONTEXT_UNSUPPORTED_REASON,
        operation,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use host_protocol::{
        HostProtocolError, SelectionContextAccess, SelectionContextDocumentKind,
        SelectionContextDocumentMetadataPayload, SelectionContextEventPayload,
        SelectionContextEventPhase, SelectionContextReadSelectionResultPayload,
        SelectionContextSelectionMetadataPayload, SelectionContextStopWatchingResultPayload,
        SelectionContextWatchFocusResultPayload,
    };
    use serde_json::json;

    #[test]
    fn read_selection_validates_before_returning_unsupported() {
        let error = read_selection(Some(valid_read_selection()))
            .expect_err("host adapter is not implemented");

        assert!(matches!(error, HostProtocolError::Unsupported { .. }));
    }

    #[test]
    fn read_selection_rejects_control_byte_actor_before_unsupported() {
        let invalid = json!({
            "actor": { "kind": "workspace", "id": "workspace\n1" },
            "access": "metadata"
        });

        let error = read_selection(Some(invalid)).expect_err("invalid input should fail");

        assert!(matches!(error, HostProtocolError::InvalidArgument { .. }));
    }

    #[test]
    fn watch_focus_rejects_blank_owner_scope_before_unsupported() {
        let invalid = json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "watchId": "watch-1",
            "ownerScope": " ",
            "access": "metadata"
        });

        let error = watch_focus(Some(invalid)).expect_err("invalid input should fail");

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
                "reason": host_protocol::SELECTION_CONTEXT_UNSUPPORTED_REASON
            })
        );
    }

    #[test]
    fn protocol_result_and_event_payloads_encode_camel_case_contracts() {
        let selection = SelectionContextSelectionMetadataPayload::new(
            Some("editor".to_string()),
            Some("text/plain".to_string()),
            12,
            Some("hash-12".to_string()),
        );
        let read_selection = serde_json::to_value(SelectionContextReadSelectionResultPayload::new(
            selection.clone(),
            Some("selected text".to_string()),
        ))
        .expect("selection result should encode");
        let watch = serde_json::to_value(SelectionContextWatchFocusResultPayload::new(
            "watch-1",
            true,
            SelectionContextAccess::Metadata,
        ))
        .expect("watch result should encode");
        let stopped = serde_json::to_value(SelectionContextStopWatchingResultPayload::new(
            "watch-1", true,
        ))
        .expect("stop result should encode");
        let document = SelectionContextDocumentMetadataPayload::new(
            "document-1",
            SelectionContextDocumentKind::EditorBuffer,
        );
        let event = serde_json::to_value(SelectionContextEventPayload::new(
            100,
            SelectionContextEventPhase::WatchStarted,
        ))
        .expect("event should encode");

        assert_eq!(read_selection["metadata"]["characterCount"], json!(12));
        assert_eq!(watch["watchId"], json!("watch-1"));
        assert_eq!(watch["access"], json!("metadata"));
        assert_eq!(stopped["stopped"], json!(true));
        assert_eq!(
            serde_json::to_value(document).expect("document should encode")["kind"],
            json!("editor-buffer")
        );
        assert_eq!(event["type"], json!("selection-context-event"));
        assert_eq!(event["phase"], json!("watch-started"));
    }

    fn valid_read_selection() -> Value {
        json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "access": "metadata",
            "traceId": "trace-1"
        })
    }
}
