#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{
    AttachmentIntakeDisposePayload, AttachmentIntakeIngestPayload, AttachmentIntakeInspectPayload,
    AttachmentIntakeSupportedPayload, HostProtocolError,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{to_value, Value};

pub(crate) fn ingest(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<AttachmentIntakeIngestPayload>(
        payload,
        host_protocol::ATTACHMENT_INTAKE_INGEST_METHOD,
    )?;
    validate_ingest(&input, host_protocol::ATTACHMENT_INTAKE_INGEST_METHOD)?;
    Err(unsupported(host_protocol::ATTACHMENT_INTAKE_INGEST_METHOD))
}

pub(crate) fn inspect(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<AttachmentIntakeInspectPayload>(
        payload,
        host_protocol::ATTACHMENT_INTAKE_INSPECT_METHOD,
    )?;
    validate_identity(
        input.intake_id(),
        input.trace_id(),
        host_protocol::ATTACHMENT_INTAKE_INSPECT_METHOD,
    )?;
    Err(unsupported(host_protocol::ATTACHMENT_INTAKE_INSPECT_METHOD))
}

pub(crate) fn dispose(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<AttachmentIntakeDisposePayload>(
        payload,
        host_protocol::ATTACHMENT_INTAKE_DISPOSE_METHOD,
    )?;
    validate_identity(
        input.intake_id(),
        input.trace_id(),
        host_protocol::ATTACHMENT_INTAKE_DISPOSE_METHOD,
    )?;
    Err(unsupported(host_protocol::ATTACHMENT_INTAKE_DISPOSE_METHOD))
}

pub(crate) fn is_supported() -> Result<Option<Value>, HostProtocolError> {
    encode_payload(
        AttachmentIntakeSupportedPayload::unsupported(
            host_protocol::ATTACHMENT_INTAKE_UNSUPPORTED_REASON,
        ),
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

fn unsupported(operation: &'static str) -> HostProtocolError {
    HostProtocolError::unsupported(
        host_protocol::ATTACHMENT_INTAKE_UNSUPPORTED_REASON,
        operation,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use host_protocol::HostProtocolError;
    use serde_json::json;

    #[test]
    fn ingest_validates_before_returning_unsupported() {
        let error = ingest(Some(valid_ingest())).expect_err("host adapter is not implemented");

        assert!(matches!(error, HostProtocolError::Unsupported { .. }));
    }

    #[test]
    fn ingest_rejects_policy_limit_violations_before_unsupported() {
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
    fn ingest_rejects_disallowed_mime_before_unsupported() {
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
    fn is_supported_reports_unimplemented_adapter() {
        let payload = is_supported()
            .expect("support query should encode")
            .expect("support query returns payload");

        assert_eq!(
            payload,
            json!({
                "supported": false,
                "reason": host_protocol::ATTACHMENT_INTAKE_UNSUPPORTED_REASON
            })
        );
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
