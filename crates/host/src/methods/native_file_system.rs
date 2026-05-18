#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{
    HostProtocolError, NativeFileSystemOpenPayload, NativeFileSystemStatPayload,
    NativeFileSystemStopWatchingPayload, NativeFileSystemSupportedPayload,
    NativeFileSystemWatchPayload,
};
use serde::de::DeserializeOwned;
use serde_json::Value;

pub(crate) fn open(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    reject_null_fields(
        payload.as_ref(),
        &["mode", "handleId"],
        host_protocol::NATIVE_FILE_SYSTEM_OPEN_METHOD,
    )?;
    let input = decode_payload::<NativeFileSystemOpenPayload>(
        payload,
        host_protocol::NATIVE_FILE_SYSTEM_OPEN_METHOD,
    )?;
    validate_path(
        input.path().path(),
        host_protocol::NATIVE_FILE_SYSTEM_OPEN_METHOD,
    )?;
    validate_optional_id(
        input.handle_id(),
        "handleId",
        host_protocol::NATIVE_FILE_SYSTEM_OPEN_METHOD,
    )?;
    Err(unsupported(host_protocol::NATIVE_FILE_SYSTEM_OPEN_METHOD))
}

pub(crate) fn stat(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<NativeFileSystemStatPayload>(
        payload,
        host_protocol::NATIVE_FILE_SYSTEM_STAT_METHOD,
    )?;
    validate_path(
        input.path().path(),
        host_protocol::NATIVE_FILE_SYSTEM_STAT_METHOD,
    )?;
    Err(unsupported(host_protocol::NATIVE_FILE_SYSTEM_STAT_METHOD))
}

pub(crate) fn watch(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    reject_null_fields(
        payload.as_ref(),
        &["recursive", "watchId", "ownerScope"],
        host_protocol::NATIVE_FILE_SYSTEM_WATCH_METHOD,
    )?;
    let input = decode_payload::<NativeFileSystemWatchPayload>(
        payload,
        host_protocol::NATIVE_FILE_SYSTEM_WATCH_METHOD,
    )?;
    validate_path(
        input.path().path(),
        host_protocol::NATIVE_FILE_SYSTEM_WATCH_METHOD,
    )?;
    validate_optional_id(
        input.watch_id(),
        "watchId",
        host_protocol::NATIVE_FILE_SYSTEM_WATCH_METHOD,
    )?;
    validate_optional_id(
        input.owner_scope(),
        "ownerScope",
        host_protocol::NATIVE_FILE_SYSTEM_WATCH_METHOD,
    )?;
    Err(unsupported(host_protocol::NATIVE_FILE_SYSTEM_WATCH_METHOD))
}

pub(crate) fn stop_watching(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<NativeFileSystemStopWatchingPayload>(
        payload,
        host_protocol::NATIVE_FILE_SYSTEM_STOP_WATCHING_METHOD,
    )?;
    validate_id(
        input.watch_id(),
        "watchId",
        host_protocol::NATIVE_FILE_SYSTEM_STOP_WATCHING_METHOD,
    )?;
    Err(unsupported(
        host_protocol::NATIVE_FILE_SYSTEM_STOP_WATCHING_METHOD,
    ))
}

pub(crate) fn is_supported() -> Result<Option<Value>, HostProtocolError> {
    serde_json::to_value(NativeFileSystemSupportedPayload::unsupported(
        host_protocol::NATIVE_FILE_SYSTEM_UNSUPPORTED_REASON,
    ))
    .map(Some)
    .map_err(|error| {
        HostProtocolError::internal(
            "NativeFileSystem.isSupported serialization failed",
            error.to_string(),
        )
    })
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

fn reject_null_fields(
    payload: Option<&Value>,
    fields: &[&'static str],
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    for &field in fields {
        if matches!(
            payload
                .and_then(Value::as_object)
                .and_then(|object| object.get(field)),
            Some(Value::Null)
        ) {
            return Err(HostProtocolError::invalid_argument(
                field,
                "must be omitted instead of null",
                operation,
            ));
        }
    }
    Ok(())
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

fn validate_optional_id(
    value: Option<&str>,
    field: &'static str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    match value {
        Some(value) => validate_id(value, field, operation),
        None => Ok(()),
    }
}

fn validate_id(
    value: &str,
    field: &'static str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if value.is_empty() {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be non-empty",
            operation,
        ));
    }
    if value.contains('\0') {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not contain NUL bytes",
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
        host_protocol::NATIVE_FILE_SYSTEM_UNSUPPORTED_REASON,
        operation,
    )
}

#[cfg(test)]
mod tests {
    use super::{is_supported, open, stat, stop_watching, watch};
    use host_protocol::HostProtocolError;
    use serde_json::json;

    #[test]
    fn native_file_system_requests_decode_before_unsupported() {
        assert_eq!(
            open(Some(json!({
                "path": { "path": "/tmp/report.txt" },
                "mode": "read"
            })))
            .expect_err("open"),
            HostProtocolError::unsupported(
                host_protocol::NATIVE_FILE_SYSTEM_UNSUPPORTED_REASON,
                host_protocol::NATIVE_FILE_SYSTEM_OPEN_METHOD,
            )
        );
        assert_eq!(
            stat(Some(json!({ "path": { "path": "/tmp/report.txt" } }))).expect_err("stat"),
            HostProtocolError::unsupported(
                host_protocol::NATIVE_FILE_SYSTEM_UNSUPPORTED_REASON,
                host_protocol::NATIVE_FILE_SYSTEM_STAT_METHOD,
            )
        );
        assert_eq!(
            watch(Some(json!({
                "path": { "path": "/tmp" },
                "recursive": true,
                "watchId": "watch-1",
                "ownerScope": "workspace:workspace-1"
            })))
            .expect_err("watch"),
            HostProtocolError::unsupported(
                host_protocol::NATIVE_FILE_SYSTEM_UNSUPPORTED_REASON,
                host_protocol::NATIVE_FILE_SYSTEM_WATCH_METHOD,
            )
        );
        assert_eq!(
            stop_watching(Some(json!({ "watchId": "watch-1" }))).expect_err("stop"),
            HostProtocolError::unsupported(
                host_protocol::NATIVE_FILE_SYSTEM_UNSUPPORTED_REASON,
                host_protocol::NATIVE_FILE_SYSTEM_STOP_WATCHING_METHOD,
            )
        );
    }

    #[test]
    fn native_file_system_requests_reject_invalid_input_before_unsupported() {
        assert_eq!(
            open(Some(json!({ "path": { "path": "relative.txt" } })))
                .expect_err("relative path")
                .tag(),
            "InvalidArgument"
        );
        assert_eq!(
            stat(Some(json!({ "path": { "path": "/tmp/bad\u{0}path" } })))
                .expect_err("nul path")
                .tag(),
            "InvalidArgument"
        );
        assert_eq!(
            watch(Some(json!({ "path": { "path": "/tmp" }, "watchId": "" })))
                .expect_err("blank watch id")
                .tag(),
            "InvalidArgument"
        );
        assert_eq!(
            stop_watching(Some(json!({ "watchId": "" })))
                .expect_err("blank stop watch id")
                .tag(),
            "InvalidArgument"
        );
        assert_eq!(
            open(Some(
                json!({ "path": { "path": "/tmp/report.txt" }, "handleId": null })
            ))
            .expect_err("null handle id")
            .tag(),
            "InvalidArgument"
        );
        assert_eq!(
            watch(Some(
                json!({ "path": { "path": "/tmp" }, "recursive": null })
            ))
            .expect_err("null recursive")
            .tag(),
            "InvalidArgument"
        );
        assert_eq!(
            watch(Some(
                json!({ "path": { "path": "/tmp" }, "ownerScope": null })
            ))
            .expect_err("null owner scope")
            .tag(),
            "InvalidArgument"
        );
    }

    #[test]
    fn native_file_system_is_supported_reports_fail_closed_adapter() {
        let payload = is_supported()
            .expect("support payload should encode")
            .expect("support payload should be present");

        assert_eq!(
            payload,
            json!({
                "supported": false,
                "reason": host_protocol::NATIVE_FILE_SYSTEM_UNSUPPORTED_REASON
            })
        );
    }
}
