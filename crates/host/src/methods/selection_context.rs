#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{HostProtocolError, SelectionContextSupportedPayload};
use serde::Serialize;
use serde_json::{to_value, Value};

pub(crate) fn is_supported() -> Result<Option<Value>, HostProtocolError> {
    encode_payload(
        SelectionContextSupportedPayload::unsupported(
            host_protocol::SELECTION_CONTEXT_UNSUPPORTED_REASON,
        ),
        host_protocol::SELECTION_CONTEXT_IS_SUPPORTED_METHOD,
    )
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

#[cfg(test)]
mod tests {
    use super::*;
    use host_protocol::{
        SelectionContextAccess, SelectionContextDocumentKind,
        SelectionContextDocumentMetadataPayload, SelectionContextEventPayload,
        SelectionContextEventPhase, SelectionContextReadSelectionResultPayload,
        SelectionContextSelectionMetadataPayload, SelectionContextStopWatchingResultPayload,
        SelectionContextWatchFocusResultPayload,
    };
    use serde_json::json;

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
}
