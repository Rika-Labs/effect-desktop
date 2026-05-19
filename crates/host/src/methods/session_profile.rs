#![allow(clippy::result_large_err)]
// Host method boundaries return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{HostProtocolError, SessionProfileSupportedPayload};
use serde_json::Value;

const UNSUPPORTED_REASON: &str = "host-session-profile-routing-unavailable";

pub(crate) fn from_partition(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let payload = require_payload(
        payload,
        host_protocol::SESSION_PROFILE_FROM_PARTITION_METHOD,
    )?;
    validate_non_empty_string(
        &payload,
        "partition",
        host_protocol::SESSION_PROFILE_FROM_PARTITION_METHOD,
    )?;
    if payload.get("ownerScope").is_some() {
        validate_non_empty_string(
            &payload,
            "ownerScope",
            host_protocol::SESSION_PROFILE_FROM_PARTITION_METHOD,
        )?;
    }
    if payload.get("traceId").is_some() {
        validate_non_empty_string(
            &payload,
            "traceId",
            host_protocol::SESSION_PROFILE_FROM_PARTITION_METHOD,
        )?;
    }
    Err(unsupported(
        host_protocol::SESSION_PROFILE_FROM_PARTITION_METHOD,
    ))
}

pub(crate) fn destroy(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let payload = require_payload(payload, host_protocol::SESSION_PROFILE_DESTROY_METHOD)?;
    validate_profile_handle(&payload, host_protocol::SESSION_PROFILE_DESTROY_METHOD)?;
    if payload.get("traceId").is_some() {
        validate_non_empty_string(
            &payload,
            "traceId",
            host_protocol::SESSION_PROFILE_DESTROY_METHOD,
        )?;
    }
    Err(unsupported(host_protocol::SESSION_PROFILE_DESTROY_METHOD))
}

pub(crate) fn list(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    if let Some(payload) = payload {
        let Some(object) = payload.as_object() else {
            return Err(HostProtocolError::invalid_argument(
                "payload",
                "must be an object",
                host_protocol::SESSION_PROFILE_LIST_METHOD,
            ));
        };
        if !object.is_empty() {
            return Err(HostProtocolError::invalid_argument(
                "payload",
                "must be empty",
                host_protocol::SESSION_PROFILE_LIST_METHOD,
            ));
        }
    }
    Err(unsupported(host_protocol::SESSION_PROFILE_LIST_METHOD))
}

pub(crate) fn is_supported(_payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    serde_json::to_value(SessionProfileSupportedPayload::unsupported(
        UNSUPPORTED_REASON,
    ))
    .map(Some)
    .map_err(|error| {
        HostProtocolError::internal(
            format!("failed to encode session profile support: {error}"),
            host_protocol::SESSION_PROFILE_IS_SUPPORTED_METHOD,
        )
    })
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
    let kind = profile.get("kind").and_then(Value::as_str).ok_or_else(|| {
        HostProtocolError::invalid_argument("profile.kind", "must be a string", operation)
    })?;
    if kind != "session-profile" {
        return Err(HostProtocolError::invalid_argument(
            "profile.kind",
            "must be session-profile",
            operation,
        ));
    }
    validate_profile_string(profile.get("id"), "profile.id", operation)?;
    validate_profile_string(profile.get("ownerScope"), "profile.ownerScope", operation)?;
    validate_profile_string(profile.get("state"), "profile.state", operation)?;
    if profile.get("state").and_then(Value::as_str) != Some("open") {
        return Err(HostProtocolError::invalid_argument(
            "profile.state",
            "must be open",
            operation,
        ));
    }
    if !profile.get("generation").is_some_and(Value::is_u64) {
        return Err(HostProtocolError::invalid_argument(
            "profile.generation",
            "must be an unsigned integer",
            operation,
        ));
    }
    Ok(())
}

fn validate_non_empty_string(
    payload: &Value,
    field: &'static str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_profile_string(payload.get(field), field, operation)
}

fn validate_profile_string(
    value: Option<&Value>,
    field: &'static str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let value = value
        .and_then(Value::as_str)
        .ok_or_else(|| HostProtocolError::invalid_argument(field, "must be a string", operation))?;
    if value.trim().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be non-empty",
            operation,
        ));
    }
    Ok(())
}

fn unsupported(operation: &'static str) -> HostProtocolError {
    HostProtocolError::unsupported(UNSUPPORTED_REASON, operation)
}

#[cfg(test)]
mod tests {
    use super::{destroy, from_partition, is_supported, list};
    use serde_json::json;

    #[test]
    fn session_profile_methods_validate_then_report_unsupported() {
        let create_error = from_partition(Some(json!({
            "partition": "workspace-1",
            "ownerScope": "workspace:1"
        })))
        .expect_err("host adapter is not implemented yet");
        assert_eq!(create_error.tag(), "Unsupported");

        let destroy_error = destroy(Some(json!({
            "profile": {
                "kind": "session-profile",
                "id": "session-profile:workspace-1",
                "generation": 0,
                "ownerScope": "workspace:1",
                "state": "open"
            }
        })))
        .expect_err("host adapter is not implemented yet");
        assert_eq!(destroy_error.tag(), "Unsupported");

        let list_error = list(None).expect_err("host adapter is not implemented yet");
        assert_eq!(list_error.tag(), "Unsupported");
    }

    #[test]
    fn session_profile_methods_reject_invalid_payloads_before_unsupported() {
        let create_error = from_partition(Some(json!({ "partition": "" })))
            .expect_err("empty partition should fail");
        assert_eq!(create_error.tag(), "InvalidArgument");

        let destroy_error = destroy(Some(json!({
            "profile": {
                "kind": "webview",
                "id": "session-profile:workspace-1",
                "generation": 0,
                "ownerScope": "workspace:1",
                "state": "open"
            }
        })))
        .expect_err("wrong resource kind should fail");
        assert_eq!(destroy_error.tag(), "InvalidArgument");

        let list_error = list(Some(json!({ "extra": true })))
            .expect_err("list payload must be empty when present");
        assert_eq!(list_error.tag(), "InvalidArgument");
    }

    #[test]
    fn session_profile_support_reports_unavailable_host_adapter() {
        let response = is_supported(None)
            .expect("support should encode")
            .expect("support should return a payload");

        assert_eq!(
            response,
            json!({
                "supported": false,
                "reason": "host-session-profile-routing-unavailable"
            })
        );
    }
}
