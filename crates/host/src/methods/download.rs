#![allow(clippy::result_large_err)]
// Host method boundaries return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{DownloadSupportedPayload, HostProtocolError};
use serde_json::Value;

const UNSUPPORTED_REASON: &str = "host-download-unavailable";

pub(crate) fn start(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let payload = require_payload(payload, host_protocol::DOWNLOAD_START_METHOD)?;
    validate_profile_handle(&payload, host_protocol::DOWNLOAD_START_METHOD)?;
    validate_url(&payload, host_protocol::DOWNLOAD_START_METHOD)?;
    validate_optional_destination(&payload, host_protocol::DOWNLOAD_START_METHOD)?;
    validate_optional_non_empty(&payload, "ownerScope", host_protocol::DOWNLOAD_START_METHOD)?;
    validate_optional_non_empty(&payload, "traceId", host_protocol::DOWNLOAD_START_METHOD)?;
    Err(unsupported(host_protocol::DOWNLOAD_START_METHOD))
}

pub(crate) fn pause(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    validate_download_payload(payload, host_protocol::DOWNLOAD_PAUSE_METHOD)?;
    Err(unsupported(host_protocol::DOWNLOAD_PAUSE_METHOD))
}

pub(crate) fn resume(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    validate_download_payload(payload, host_protocol::DOWNLOAD_RESUME_METHOD)?;
    Err(unsupported(host_protocol::DOWNLOAD_RESUME_METHOD))
}

pub(crate) fn cancel(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    validate_download_payload(payload, host_protocol::DOWNLOAD_CANCEL_METHOD)?;
    Err(unsupported(host_protocol::DOWNLOAD_CANCEL_METHOD))
}

pub(crate) fn list(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let payload = require_payload(payload, host_protocol::DOWNLOAD_LIST_METHOD)?;
    if payload.get("profile").is_some() {
        validate_profile_handle(&payload, host_protocol::DOWNLOAD_LIST_METHOD)?;
    }
    validate_optional_non_empty(&payload, "traceId", host_protocol::DOWNLOAD_LIST_METHOD)?;
    Err(unsupported(host_protocol::DOWNLOAD_LIST_METHOD))
}

pub(crate) fn is_supported(_payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    serde_json::to_value(DownloadSupportedPayload::unsupported(UNSUPPORTED_REASON))
        .map(Some)
        .map_err(|error| {
            HostProtocolError::internal(
                format!("failed to encode download support: {error}"),
                host_protocol::DOWNLOAD_IS_SUPPORTED_METHOD,
            )
        })
}

fn validate_download_payload(
    payload: Option<Value>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let payload = require_payload(payload, operation)?;
    validate_download_handle(&payload, operation)?;
    validate_optional_non_empty(&payload, "traceId", operation)
}

fn require_payload(
    payload: Option<Value>,
    operation: &'static str,
) -> Result<Value, HostProtocolError> {
    payload.ok_or_else(|| HostProtocolError::invalid_argument("payload", "is required", operation))
}

fn validate_profile_handle(
    payload: &Value,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let profile = payload
        .get("profile")
        .ok_or_else(|| HostProtocolError::invalid_argument("profile", "is required", operation))?;
    let Some(profile) = profile.as_object() else {
        return Err(HostProtocolError::invalid_argument(
            "profile",
            "must be an object",
            operation,
        ));
    };
    validate_resource(profile, "session-profile", "profile", operation)
}

fn validate_download_handle(
    payload: &Value,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let download = payload
        .get("download")
        .ok_or_else(|| HostProtocolError::invalid_argument("download", "is required", operation))?;
    let Some(download) = download.as_object() else {
        return Err(HostProtocolError::invalid_argument(
            "download",
            "must be an object",
            operation,
        ));
    };
    validate_resource(download, "download", "download", operation)
}

fn validate_resource(
    resource: &serde_json::Map<String, Value>,
    kind: &'static str,
    field: &'static str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let kind_field = format!("{field}.kind");
    if resource.get("kind").and_then(Value::as_str) != Some(kind) {
        return Err(HostProtocolError::invalid_argument(
            kind_field,
            format!("must be {kind}"),
            operation,
        ));
    }
    validate_object_string(resource.get("id"), format!("{field}.id"), operation)?;
    validate_object_string(
        resource.get("ownerScope"),
        format!("{field}.ownerScope"),
        operation,
    )?;
    validate_object_string(resource.get("state"), format!("{field}.state"), operation)?;
    if resource.get("state").and_then(Value::as_str) != Some("open") {
        return Err(HostProtocolError::invalid_argument(
            format!("{field}.state"),
            "must be open",
            operation,
        ));
    }
    if !resource.get("generation").is_some_and(Value::is_u64) {
        return Err(HostProtocolError::invalid_argument(
            format!("{field}.generation"),
            "must be an unsigned integer",
            operation,
        ));
    }
    Ok(())
}

fn validate_url(payload: &Value, operation: &'static str) -> Result<(), HostProtocolError> {
    let url = validate_object_string(payload.get("url"), "url", operation)?;
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(HostProtocolError::invalid_argument(
            "url",
            "must be an absolute HTTP(S) URL",
            operation,
        ));
    }
    Ok(())
}

fn validate_optional_destination(
    payload: &Value,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let Some(destination) = payload.get("destination") else {
        return Ok(());
    };
    let destination = destination.as_str().ok_or_else(|| {
        HostProtocolError::invalid_argument("destination", "must be a string", operation)
    })?;
    if destination.trim().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "destination",
            "must be non-empty",
            operation,
        ));
    }
    if destination
        .split(['/', '\\'])
        .any(|segment| segment == "..")
    {
        return Err(HostProtocolError::invalid_argument(
            "destination",
            "must not contain parent traversal segments",
            operation,
        ));
    }
    Ok(())
}

fn validate_optional_non_empty(
    payload: &Value,
    field: &'static str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if payload.get(field).is_some() {
        validate_object_string(payload.get(field), field, operation)?;
    }
    Ok(())
}

fn validate_object_string<'a>(
    value: Option<&'a Value>,
    field: impl Into<String>,
    operation: &'static str,
) -> Result<&'a str, HostProtocolError> {
    let field = field.into();
    let value = value.and_then(Value::as_str).ok_or_else(|| {
        HostProtocolError::invalid_argument(&field, "must be a string", operation)
    })?;
    if value.trim().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be non-empty",
            operation,
        ));
    }
    Ok(value)
}

fn unsupported(operation: &'static str) -> HostProtocolError {
    HostProtocolError::unsupported(UNSUPPORTED_REASON, operation)
}

#[cfg(test)]
mod tests {
    use super::{cancel, is_supported, list, pause, resume, start};
    use serde_json::json;

    #[test]
    fn download_methods_validate_then_report_unsupported() {
        for error in [
            start(Some(json!({
                "profile": profile(),
                "url": "https://example.test/file.zip"
            })))
            .expect_err("host adapter is not implemented yet"),
            pause(Some(json!({ "download": download() })))
                .expect_err("host adapter is not implemented yet"),
            resume(Some(json!({ "download": download() })))
                .expect_err("host adapter is not implemented yet"),
            cancel(Some(json!({ "download": download() })))
                .expect_err("host adapter is not implemented yet"),
            list(Some(json!({ "profile": profile() })))
                .expect_err("host adapter is not implemented yet"),
        ] {
            assert_eq!(error.tag(), "Unsupported");
        }
    }

    #[test]
    fn download_methods_reject_invalid_payloads_before_unsupported() {
        let bad_url = start(Some(json!({
            "profile": profile(),
            "url": "file:///tmp/file.zip"
        })))
        .expect_err("non-http url should fail");
        assert_eq!(bad_url.tag(), "InvalidArgument");

        let bad_destination = start(Some(json!({
            "profile": profile(),
            "url": "https://example.test/file.zip",
            "destination": "../file.zip"
        })))
        .expect_err("parent traversal should fail");
        assert_eq!(bad_destination.tag(), "InvalidArgument");

        let wrong_handle = pause(Some(json!({
            "download": {
                "kind": "session-profile",
                "id": "download:1",
                "generation": 0,
                "ownerScope": "workspace:1",
                "state": "open"
            }
        })))
        .expect_err("wrong handle kind should fail");
        assert_eq!(wrong_handle.tag(), "InvalidArgument");
    }

    #[test]
    fn download_support_reports_unavailable_host_adapter() {
        let response = is_supported(None)
            .expect("support should encode")
            .expect("support should return a payload");

        assert_eq!(
            response,
            json!({
                "supported": false,
                "reason": "host-download-unavailable"
            })
        );
    }

    fn profile() -> serde_json::Value {
        json!({
            "kind": "session-profile",
            "id": "session-profile:workspace-1",
            "generation": 0,
            "ownerScope": "workspace:1",
            "state": "open"
        })
    }

    fn download() -> serde_json::Value {
        json!({
            "kind": "download",
            "id": "download:1",
            "generation": 0,
            "ownerScope": "workspace:1",
            "state": "open"
        })
    }
}
