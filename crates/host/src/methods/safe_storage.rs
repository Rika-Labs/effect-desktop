#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{HostProtocolError, SafeStorageKeyPayload, SafeStorageSetPayload};
use serde_json::Value;

pub(crate) fn set(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let payload = decode_set_payload(payload)?;
    validate_key(payload.key(), host_protocol::SAFE_STORAGE_SET_METHOD)?;

    Err(unsupported(host_protocol::SAFE_STORAGE_SET_METHOD))
}

pub(crate) fn get(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let payload = decode_key_payload(payload, host_protocol::SAFE_STORAGE_GET_METHOD)?;
    validate_key(payload.key(), host_protocol::SAFE_STORAGE_GET_METHOD)?;

    Err(unsupported(host_protocol::SAFE_STORAGE_GET_METHOD))
}

pub(crate) fn delete(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let payload = decode_key_payload(payload, host_protocol::SAFE_STORAGE_DELETE_METHOD)?;
    validate_key(payload.key(), host_protocol::SAFE_STORAGE_DELETE_METHOD)?;

    Err(unsupported(host_protocol::SAFE_STORAGE_DELETE_METHOD))
}

pub(crate) fn list(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    validate_void_payload(payload, host_protocol::SAFE_STORAGE_LIST_METHOD)?;

    Err(unsupported(host_protocol::SAFE_STORAGE_LIST_METHOD))
}

fn decode_set_payload(payload: Option<Value>) -> Result<SafeStorageSetPayload, HostProtocolError> {
    let payload = required_payload(payload, host_protocol::SAFE_STORAGE_SET_METHOD)?;
    serde_json::from_value::<SafeStorageSetPayload>(payload).map_err(|error| {
        HostProtocolError::invalid_argument(
            "payload",
            error.to_string(),
            host_protocol::SAFE_STORAGE_SET_METHOD,
        )
    })
}

fn decode_key_payload(
    payload: Option<Value>,
    operation: &'static str,
) -> Result<SafeStorageKeyPayload, HostProtocolError> {
    let payload = required_payload(payload, operation)?;
    serde_json::from_value::<SafeStorageKeyPayload>(payload).map_err(|error| {
        HostProtocolError::invalid_argument("payload", error.to_string(), operation)
    })
}

fn validate_key(key: &str, operation: &'static str) -> Result<(), HostProtocolError> {
    if key.is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "key",
            "must not be empty",
            operation,
        ));
    }
    if key.bytes().any(|byte| matches!(byte, 0x00..=0x1f | 0x7f)) {
        return Err(HostProtocolError::invalid_argument(
            "key",
            "must not include control characters",
            operation,
        ));
    }
    Ok(())
}

fn validate_void_payload(
    payload: Option<Value>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    match payload {
        None | Some(Value::Null) => Ok(()),
        Some(_) => Err(HostProtocolError::invalid_argument(
            "payload",
            "must be omitted or null",
            operation,
        )),
    }
}

fn required_payload(payload: Option<Value>, operation: &str) -> Result<Value, HostProtocolError> {
    payload.ok_or_else(|| HostProtocolError::invalid_argument("payload", "is required", operation))
}

fn unsupported(operation: &'static str) -> HostProtocolError {
    HostProtocolError::unsupported(host_protocol::SAFE_STORAGE_UNSUPPORTED_REASON, operation)
}

#[cfg(test)]
mod tests {
    use super::{decode_key_payload, decode_set_payload, list, validate_key};
    use host_protocol::HostProtocolError;
    use serde_json::json;

    #[test]
    fn set_payload_validates_shape_without_exposing_secret_value() {
        let payload =
            decode_set_payload(Some(json!({ "key": "token", "value": "AAE=" }))).expect("payload");
        assert_eq!(payload.key(), "token");
        assert_eq!(payload.value(), "AAE=");

        let error = validate_key("", host_protocol::SAFE_STORAGE_SET_METHOD)
            .expect_err("empty key should fail");
        assert!(!format!("{error:?}").contains("AAE="));
    }

    #[test]
    fn set_payload_rejects_excess_fields_before_unsupported() {
        assert!(decode_set_payload(Some(json!({
            "key": "token",
            "value": "AAE=",
            "unexpected": true
        })))
        .is_err());
    }

    #[test]
    fn key_payload_rejects_invalid_shape_and_keys() {
        assert!(decode_key_payload(
            Some(json!({ "key": "token", "unexpected": true })),
            host_protocol::SAFE_STORAGE_GET_METHOD,
        )
        .is_err());
        assert!(validate_key("bad\nkey", host_protocol::SAFE_STORAGE_GET_METHOD).is_err());
    }

    #[test]
    fn list_accepts_void_payload_then_fails_closed() {
        let error = list(Some(json!(null))).expect_err("list should be unsupported");
        assert!(matches!(error, HostProtocolError::Unsupported { .. }));
    }

    #[test]
    fn list_rejects_non_void_payload_before_unsupported() {
        let error = list(Some(json!({}))).expect_err("object payload should reject");
        assert!(matches!(error, HostProtocolError::InvalidArgument { .. }));
    }
}
