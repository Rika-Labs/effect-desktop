#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{
    AttachmentIntakeDisposePayload, AttachmentIntakeEventPayload, AttachmentIntakeIngestPayload,
    AttachmentIntakeIngestResultPayload, AttachmentIntakeInspectPayload,
    AttachmentIntakeInspectResultPayload, AttachmentIntakeItemPayload, AttachmentIntakeState,
    AttachmentIntakeSupportedPayload, HostProtocolEnvelope, HostProtocolError,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{to_value, Value};
use std::{
    collections::HashMap,
    sync::{mpsc::Sender, LazyLock, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

static INTAKES: LazyLock<Mutex<HashMap<String, StoredIntake>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Clone)]
struct StoredIntake {
    items: Vec<AttachmentIntakeItemPayload>,
    staged_bytes: Vec<Vec<u8>>,
    expires_at: u64,
    state: AttachmentIntakeState,
}

#[cfg(test)]
pub(crate) fn ingest(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    ingest_with_event_sender(payload, None)
}

pub(crate) fn ingest_with_event_sender(
    payload: Option<Value>,
    event_sender: Option<Sender<HostProtocolEnvelope>>,
) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<AttachmentIntakeIngestPayload>(
        payload,
        host_protocol::ATTACHMENT_INTAKE_INGEST_METHOD,
    )?;
    validate_ingest(&input, host_protocol::ATTACHMENT_INTAKE_INGEST_METHOD)?;
    let intake_id = input
        .intake_id()
        .map(str::to_string)
        .unwrap_or_else(|| format!("attachment-intake-{}", Uuid::now_v7()));
    let expires_at = timestamp_millis().saturating_add(input.policy().lifetime_millis());
    let staged = materialize_items(input.items());
    let items = staged
        .iter()
        .map(|item| item.metadata.clone())
        .collect::<Vec<_>>();
    let staged_bytes = staged
        .into_iter()
        .map(|item| item.bytes)
        .collect::<Vec<_>>();
    let item_count = items.len() as u64;

    let mut intakes = INTAKES.lock().map_err(|_| {
        HostProtocolError::internal(
            "attachment intake registry lock poisoned",
            host_protocol::ATTACHMENT_INTAKE_INGEST_METHOD,
        )
    })?;
    intakes.insert(
        intake_id.clone(),
        StoredIntake {
            items: items.clone(),
            staged_bytes,
            expires_at,
            state: AttachmentIntakeState::Ingested,
        },
    );
    drop(intakes);

    send_event(
        event_sender,
        AttachmentIntakeEventPayload::ingested(timestamp_millis(), intake_id.clone(), item_count),
    );
    encode_payload(
        AttachmentIntakeIngestResultPayload::ingested(intake_id, items, expires_at),
        host_protocol::ATTACHMENT_INTAKE_INGEST_METHOD,
    )
}

#[cfg(test)]
pub(crate) fn inspect(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    inspect_with_event_sender(payload, None)
}

pub(crate) fn inspect_with_event_sender(
    payload: Option<Value>,
    event_sender: Option<Sender<HostProtocolEnvelope>>,
) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<AttachmentIntakeInspectPayload>(
        payload,
        host_protocol::ATTACHMENT_INTAKE_INSPECT_METHOD,
    )?;
    validate_identity(
        input.intake_id(),
        input.trace_id(),
        host_protocol::ATTACHMENT_INTAKE_INSPECT_METHOD,
    )?;
    let mut intakes = INTAKES.lock().map_err(|_| {
        HostProtocolError::internal(
            "attachment intake registry lock poisoned",
            host_protocol::ATTACHMENT_INTAKE_INSPECT_METHOD,
        )
    })?;
    let Some(stored) = intakes.get(input.intake_id()) else {
        return Err(HostProtocolError::not_found(
            format!("AttachmentIntake:{}", input.intake_id()),
            host_protocol::ATTACHMENT_INTAKE_INSPECT_METHOD,
        ));
    };
    if timestamp_millis() >= stored.expires_at {
        intakes.remove(input.intake_id());
        drop(intakes);
        send_event(
            event_sender,
            AttachmentIntakeEventPayload::failed(
                timestamp_millis(),
                input.intake_id().to_string(),
                "invalid-input",
                "attachment intake lifetime has expired",
            ),
        );
        return Err(HostProtocolError::invalid_argument(
            "intakeId",
            "attachment intake lifetime has expired",
            host_protocol::ATTACHMENT_INTAKE_INSPECT_METHOD,
        ));
    }
    debug_assert_eq!(stored.staged_bytes.len(), stored.items.len());
    encode_payload(
        AttachmentIntakeInspectResultPayload::new(
            input.intake_id().to_string(),
            stored.items.clone(),
            stored.state,
            stored.expires_at,
        ),
        host_protocol::ATTACHMENT_INTAKE_INSPECT_METHOD,
    )
}

#[cfg(test)]
pub(crate) fn dispose(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    dispose_with_event_sender(payload, None)
}

pub(crate) fn dispose_with_event_sender(
    payload: Option<Value>,
    event_sender: Option<Sender<HostProtocolEnvelope>>,
) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<AttachmentIntakeDisposePayload>(
        payload,
        host_protocol::ATTACHMENT_INTAKE_DISPOSE_METHOD,
    )?;
    validate_identity(
        input.intake_id(),
        input.trace_id(),
        host_protocol::ATTACHMENT_INTAKE_DISPOSE_METHOD,
    )?;
    let mut intakes = INTAKES.lock().map_err(|_| {
        HostProtocolError::internal(
            "attachment intake registry lock poisoned",
            host_protocol::ATTACHMENT_INTAKE_DISPOSE_METHOD,
        )
    })?;
    let disposed = intakes.remove(input.intake_id()).is_some();
    drop(intakes);
    send_event(
        event_sender,
        AttachmentIntakeEventPayload::disposed(timestamp_millis(), input.intake_id().to_string()),
    );
    encode_payload(
        host_protocol::AttachmentIntakeDisposeResultPayload::new(
            input.intake_id().to_string(),
            disposed,
        ),
        host_protocol::ATTACHMENT_INTAKE_DISPOSE_METHOD,
    )
}

pub(crate) fn is_supported() -> Result<Option<Value>, HostProtocolError> {
    encode_payload(
        AttachmentIntakeSupportedPayload::supported(),
        host_protocol::ATTACHMENT_INTAKE_IS_SUPPORTED_METHOD,
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
            format!("failed to encode attachment intake payload: {error}"),
            operation,
        )
    })
}

fn validate_ingest(
    input: &AttachmentIntakeIngestPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_printable_non_empty("actor.id", input.actor().id(), operation)?;
    validate_positive("policy.maxItems", input.policy().max_items(), operation)?;
    validate_positive(
        "policy.maxBytesPerItem",
        input.policy().max_bytes_per_item(),
        operation,
    )?;
    validate_positive(
        "policy.maxTotalBytes",
        input.policy().max_total_bytes(),
        operation,
    )?;
    validate_positive(
        "policy.lifetimeMillis",
        input.policy().lifetime_millis(),
        operation,
    )?;
    if input.policy().allowed_mime_types().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "policy.allowedMimeTypes",
            "must include at least one MIME type",
            operation,
        ));
    }
    for mime_type in input.policy().allowed_mime_types() {
        validate_non_empty("policy.allowedMimeTypes", mime_type, operation)?;
    }
    if input.items().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "items",
            "must include at least one item",
            operation,
        ));
    }
    if input.items().len() as u64 > input.policy().max_items() {
        return Err(HostProtocolError::invalid_argument(
            "items",
            "exceeds policy maxItems",
            operation,
        ));
    }
    let mut total_bytes = 0_u64;
    for item in input.items() {
        if let Some(item_id) = item.item_id() {
            validate_non_empty("items.itemId", item_id, operation)?;
        }
        if let Some(name) = item.name() {
            validate_printable_non_empty("items.name", name, operation)?;
        }
        validate_non_empty("items.mimeType", item.mime_type(), operation)?;
        if !is_allowed_mime(input.policy().allowed_mime_types(), item.mime_type()) {
            return Err(HostProtocolError::invalid_argument(
                "items.mimeType",
                "is not allowed by policy",
                operation,
            ));
        }
        let bytes = item.bytes().len() as u64;
        if bytes > input.policy().max_bytes_per_item() {
            return Err(HostProtocolError::invalid_argument(
                "items.bytes",
                "exceeds policy maxBytesPerItem",
                operation,
            ));
        }
        total_bytes = total_bytes.saturating_add(bytes);
        if total_bytes > input.policy().max_total_bytes() {
            return Err(HostProtocolError::invalid_argument(
                "items",
                "exceeds policy maxTotalBytes",
                operation,
            ));
        }
    }
    if let Some(intake_id) = input.intake_id() {
        validate_non_empty("intakeId", intake_id, operation)?;
    }
    if let Some(trace_id) = input.trace_id() {
        validate_non_empty("traceId", trace_id, operation)?;
    }
    Ok(())
}

fn validate_identity(
    intake_id: &str,
    trace_id: Option<&str>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_non_empty("intakeId", intake_id, operation)?;
    if let Some(trace_id) = trace_id {
        validate_non_empty("traceId", trace_id, operation)?;
    }
    Ok(())
}

fn validate_positive(
    field: &str,
    value: u64,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if value == 0 {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be greater than zero",
            operation,
        ));
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

fn is_allowed_mime(allowed: &[String], mime_type: &str) -> bool {
    allowed.iter().any(|entry| {
        entry == mime_type
            || entry
                .strip_suffix("/*")
                .is_some_and(|prefix| mime_type.starts_with(&format!("{prefix}/")))
    })
}

struct StagedItem {
    metadata: AttachmentIntakeItemPayload,
    bytes: Vec<u8>,
}

fn materialize_items(items: &[host_protocol::AttachmentIntakeItemInputPayload]) -> Vec<StagedItem> {
    items
        .iter()
        .map(|item| {
            let item_id = item
                .item_id()
                .map(str::to_string)
                .unwrap_or_else(|| format!("attachment-item-{}", Uuid::now_v7()));
            let bytes = item.bytes().to_vec();
            StagedItem {
                metadata: AttachmentIntakeItemPayload::new(
                    item_id,
                    item.name().map(str::to_string),
                    item.mime_type().to_string(),
                    item.source(),
                    bytes.len() as u64,
                ),
                bytes,
            }
        })
        .collect()
}

fn send_event(sender: Option<Sender<HostProtocolEnvelope>>, payload: AttachmentIntakeEventPayload) {
    let Some(sender) = sender else {
        return;
    };
    let Ok(payload) = to_value(payload) else {
        return;
    };
    let _ = sender.send(HostProtocolEnvelope::Event {
        method: host_protocol::ATTACHMENT_INTAKE_EVENT.to_string(),
        timestamp: timestamp_millis(),
        trace_id: format!("attachment-intake-event-{}", Uuid::now_v7()),
        window_id: None,
        payload: Some(payload),
    });
}

fn timestamp_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use host_protocol::{HostProtocolEnvelope, HostProtocolError};
    use serde_json::json;
    use std::sync::mpsc::channel;
    use std::sync::{LazyLock, Mutex};

    static TEST_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

    #[test]
    fn ingest_inspect_dispose_stage_metadata_and_emit_events() {
        let _guard = TEST_LOCK.lock().expect("test lock");
        clear_intakes();
        let (sender, receiver) = channel();

        let ingested = ingest_with_event_sender(Some(valid_ingest()), Some(sender.clone()))
            .expect("ingest should succeed")
            .expect("ingest should return payload");
        assert_eq!(ingested["intakeId"], json!("intake-1"));
        assert_eq!(ingested["state"], json!("ingested"));
        assert_eq!(ingested["items"][0]["sizeBytes"], json!(2));

        let inspect_payload = json!({ "intakeId": "intake-1", "traceId": "trace-2" });
        let inspected = inspect(Some(inspect_payload))
            .expect("inspect should succeed")
            .expect("inspect should return payload");
        assert_eq!(inspected["items"][0]["name"], json!("note.txt"));
        assert_eq!(inspected["state"], json!("ingested"));

        let dispose_payload = json!({ "intakeId": "intake-1", "traceId": "trace-3" });
        let disposed = dispose_with_event_sender(Some(dispose_payload), Some(sender))
            .expect("dispose should succeed")
            .expect("dispose should return payload");
        assert_eq!(
            disposed,
            json!({ "intakeId": "intake-1", "disposed": true })
        );
        let disposed_again = dispose(Some(
            json!({ "intakeId": "intake-1", "traceId": "trace-4" }),
        ))
        .expect("second dispose should succeed")
        .expect("second dispose should return payload");
        assert_eq!(
            disposed_again,
            json!({ "intakeId": "intake-1", "disposed": false })
        );

        let first = receiver.recv().expect("ingest event should be emitted");
        assert_event(first, "ingested", "intake-1");
        let second = receiver.recv().expect("dispose event should be emitted");
        assert_event(second, "disposed", "intake-1");
    }

    #[test]
    fn ingest_decodes_bridge_base64_bytes_before_staging_metadata() {
        let _guard = TEST_LOCK.lock().expect("test lock");
        clear_intakes();

        let ingested = ingest(Some(json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "policy": {
                "allowedMimeTypes": ["text/plain"],
                "maxItems": 1,
                "maxBytesPerItem": 16,
                "maxTotalBytes": 16,
                "lifetimeMillis": 60000
            },
            "items": [
                {
                    "itemId": "item-base64",
                    "name": "note.txt",
                    "mimeType": "text/plain",
                    "source": "provided-by-caller",
                    "bytes": "aGk="
                }
            ],
            "intakeId": "intake-base64",
            "traceId": "trace-base64"
        })))
        .expect("base64 bridge bytes should ingest")
        .expect("ingest should return payload");

        assert_eq!(ingested["intakeId"], json!("intake-base64"));
        assert_eq!(ingested["items"][0]["sizeBytes"], json!(2));
    }

    #[test]
    fn ingest_rejects_policy_limit_violations_before_host_side_effects() {
        let _guard = TEST_LOCK.lock().expect("test lock");
        clear_intakes();
        let invalid = json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "policy": {
                "allowedMimeTypes": ["text/plain"],
                "maxItems": 1,
                "maxBytesPerItem": 1,
                "maxTotalBytes": 1,
                "lifetimeMillis": 60000
            },
            "items": [
                {
                    "mimeType": "text/plain",
                    "source": "provided-by-caller",
                    "bytes": [1, 2]
                }
            ]
        });

        let error = ingest(Some(invalid)).expect_err("invalid input should fail");

        assert!(matches!(error, HostProtocolError::InvalidArgument { .. }));
    }

    #[test]
    fn ingest_rejects_disallowed_mime_before_host_side_effects() {
        let _guard = TEST_LOCK.lock().expect("test lock");
        clear_intakes();
        let invalid = json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "policy": {
                "allowedMimeTypes": ["image/png"],
                "maxItems": 1,
                "maxBytesPerItem": 16,
                "maxTotalBytes": 16,
                "lifetimeMillis": 60000
            },
            "items": [
                {
                    "mimeType": "text/plain",
                    "source": "provided-by-caller",
                    "bytes": [104, 105]
                }
            ]
        });

        let error = ingest(Some(invalid)).expect_err("invalid input should fail");

        assert!(matches!(error, HostProtocolError::InvalidArgument { .. }));
    }

    #[test]
    fn inspect_rejects_expired_intake_and_emits_failure() {
        let _guard = TEST_LOCK.lock().expect("test lock");
        clear_intakes();
        let (sender, receiver) = channel();

        ingest(Some(valid_ingest())).expect("ingest should succeed");
        INTAKES
            .lock()
            .expect("intake registry lock")
            .get_mut("intake-1")
            .expect("intake should be stored")
            .expires_at = 0;

        let error = inspect_with_event_sender(
            Some(json!({ "intakeId": "intake-1", "traceId": "trace-expired" })),
            Some(sender),
        )
        .expect_err("expired intake should fail");

        assert!(matches!(error, HostProtocolError::InvalidArgument { .. }));
        let event = receiver.recv().expect("failure event should be emitted");
        assert_event(event, "failed", "intake-1");
    }

    #[test]
    fn is_supported_reports_host_backed_adapter() {
        let _guard = TEST_LOCK.lock().expect("test lock");
        let payload = is_supported()
            .expect("support query should encode")
            .expect("support query returns payload");

        assert_eq!(payload, json!({ "supported": true }));
    }

    fn clear_intakes() {
        INTAKES.lock().expect("intake registry lock").clear();
    }

    fn assert_event(event: HostProtocolEnvelope, phase: &str, intake_id: &str) {
        let HostProtocolEnvelope::Event {
            method, payload, ..
        } = event
        else {
            panic!("expected event frame");
        };
        assert_eq!(method, host_protocol::ATTACHMENT_INTAKE_EVENT);
        let payload = payload.expect("event should include payload");
        assert_eq!(payload["phase"], json!(phase));
        assert_eq!(payload["intakeId"], json!(intake_id));
    }

    fn valid_ingest() -> Value {
        json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "policy": {
                "allowedMimeTypes": ["text/plain"],
                "maxItems": 1,
                "maxBytesPerItem": 16,
                "maxTotalBytes": 16,
                "lifetimeMillis": 60000
            },
            "items": [
                {
                    "itemId": "item-1",
                    "name": "note.txt",
                    "mimeType": "text/plain",
                    "source": "provided-by-caller",
                    "bytes": [104, 105]
                }
            ],
            "intakeId": "intake-1",
            "traceId": "trace-1"
        })
    }
}
