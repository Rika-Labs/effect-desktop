#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{HostProtocolError, RecentDocumentsAddPayload};
use serde::de::DeserializeOwned;
use serde_json::Value;

pub(crate) fn add(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<RecentDocumentsAddPayload>(
        payload,
        host_protocol::RECENT_DOCUMENTS_ADD_METHOD,
    )?;
    validate_path(
        input.path().path(),
        host_protocol::RECENT_DOCUMENTS_ADD_METHOD,
    )?;
    Err(unsupported(host_protocol::RECENT_DOCUMENTS_ADD_METHOD))
}

pub(crate) fn clear(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    reject_payload(payload, host_protocol::RECENT_DOCUMENTS_CLEAR_METHOD)?;
    Err(unsupported(host_protocol::RECENT_DOCUMENTS_CLEAR_METHOD))
}

pub(crate) fn list(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    reject_payload(payload, host_protocol::RECENT_DOCUMENTS_LIST_METHOD)?;
    Err(unsupported(host_protocol::RECENT_DOCUMENTS_LIST_METHOD))
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

fn reject_payload(
    payload: Option<Value>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    match payload {
        None | Some(Value::Null) => Ok(()),
        Some(Value::Object(object)) if object.is_empty() => Ok(()),
        Some(_) => Err(HostProtocolError::invalid_argument(
            "payload",
            "must be omitted",
            operation,
        )),
    }
}

fn validate_path(path: &str, operation: &'static str) -> Result<(), HostProtocolError> {
    if path.is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "path",
            "must be non-empty",
            operation,
        ));
    }
    if path.contains('\0') {
        return Err(HostProtocolError::invalid_argument(
            "path",
            "must not contain NUL bytes",
            operation,
        ));
    }
    if !(path.starts_with('/') || is_windows_absolute_path(path) || path.starts_with("\\\\")) {
        return Err(HostProtocolError::invalid_argument(
            "path",
            "must be an absolute path",
            operation,
        ));
    }
    Ok(())
}

fn is_windows_absolute_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'/' | b'\\')
}

fn unsupported(operation: &'static str) -> HostProtocolError {
    HostProtocolError::unsupported(
        host_protocol::RECENT_DOCUMENTS_UNSUPPORTED_REASON,
        operation,
    )
}

#[cfg(test)]
mod tests {
    use super::{add, clear, list};
    use host_protocol::HostProtocolError;
    use serde_json::json;

    #[test]
    fn recent_document_requests_decode_before_unsupported() {
        assert_eq!(
            add(Some(json!({ "path": { "path": "/tmp/report.txt" } }))).expect_err("add"),
            HostProtocolError::unsupported(
                host_protocol::RECENT_DOCUMENTS_UNSUPPORTED_REASON,
                host_protocol::RECENT_DOCUMENTS_ADD_METHOD,
            )
        );
        assert_eq!(
            clear(None).expect_err("clear"),
            HostProtocolError::unsupported(
                host_protocol::RECENT_DOCUMENTS_UNSUPPORTED_REASON,
                host_protocol::RECENT_DOCUMENTS_CLEAR_METHOD,
            )
        );
        assert_eq!(
            list(None).expect_err("list"),
            HostProtocolError::unsupported(
                host_protocol::RECENT_DOCUMENTS_UNSUPPORTED_REASON,
                host_protocol::RECENT_DOCUMENTS_LIST_METHOD,
            )
        );
    }

    #[test]
    fn recent_document_requests_reject_invalid_inputs_before_unsupported() {
        assert_eq!(
            add(Some(json!({ "path": { "path": "relative.txt" } })))
                .expect_err("relative path")
                .tag(),
            "InvalidArgument"
        );
        assert_eq!(
            add(Some(json!({ "path": { "path": "/tmp/bad\u{0}path" } })))
                .expect_err("nul path")
                .tag(),
            "InvalidArgument"
        );
        assert_eq!(
            clear(Some(json!({ "unexpected": true }))).expect_err("payload"),
            HostProtocolError::invalid_argument(
                "payload",
                "must be omitted",
                host_protocol::RECENT_DOCUMENTS_CLEAR_METHOD,
            )
        );
    }
}
