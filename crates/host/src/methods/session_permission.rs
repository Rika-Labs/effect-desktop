#![allow(clippy::result_large_err)]
// Host method boundaries return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{HostProtocolError, SessionPermissionSupportedPayload};
use serde_json::Value;

const UNSUPPORTED_REASON: &str = "host-session-permission-unavailable";
const PERMISSION_KINDS: &[&str] = &[
    "camera",
    "microphone",
    "notifications",
    "geolocation",
    "clipboard-read",
    "clipboard-write",
    "display-capture",
];

pub(crate) fn request(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let payload = require_payload(payload, host_protocol::SESSION_PERMISSION_REQUEST_METHOD)?;
    validate_profile_handle(&payload, host_protocol::SESSION_PERMISSION_REQUEST_METHOD)?;
    validate_kind(&payload, host_protocol::SESSION_PERMISSION_REQUEST_METHOD)?;
    validate_origin(&payload, host_protocol::SESSION_PERMISSION_REQUEST_METHOD)?;
    validate_optional_non_empty(
        &payload,
        "requestId",
        host_protocol::SESSION_PERMISSION_REQUEST_METHOD,
    )?;
    validate_optional_non_empty(
        &payload,
        "traceId",
        host_protocol::SESSION_PERMISSION_REQUEST_METHOD,
    )?;
    Err(unsupported(
        host_protocol::SESSION_PERMISSION_REQUEST_METHOD,
    ))
}

pub(crate) fn decide(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let payload = require_payload(payload, host_protocol::SESSION_PERMISSION_DECIDE_METHOD)?;
    validate_profile_handle(&payload, host_protocol::SESSION_PERMISSION_DECIDE_METHOD)?;
    validate_non_empty(
        &payload,
        "requestId",
        host_protocol::SESSION_PERMISSION_DECIDE_METHOD,
    )?;
    validate_kind(&payload, host_protocol::SESSION_PERMISSION_DECIDE_METHOD)?;
    validate_origin(&payload, host_protocol::SESSION_PERMISSION_DECIDE_METHOD)?;
    validate_decision(&payload, host_protocol::SESSION_PERMISSION_DECIDE_METHOD)?;
    validate_optional_non_empty(
        &payload,
        "traceId",
        host_protocol::SESSION_PERMISSION_DECIDE_METHOD,
    )?;
    Err(unsupported(host_protocol::SESSION_PERMISSION_DECIDE_METHOD))
}

pub(crate) fn list_decisions(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let payload = require_payload(
        payload,
        host_protocol::SESSION_PERMISSION_LIST_DECISIONS_METHOD,
    )?;
    validate_profile_handle(
        &payload,
        host_protocol::SESSION_PERMISSION_LIST_DECISIONS_METHOD,
    )?;
    validate_optional_kind(
        &payload,
        host_protocol::SESSION_PERMISSION_LIST_DECISIONS_METHOD,
    )?;
    validate_optional_origin(
        &payload,
        host_protocol::SESSION_PERMISSION_LIST_DECISIONS_METHOD,
    )?;
    validate_optional_non_empty(
        &payload,
        "traceId",
        host_protocol::SESSION_PERMISSION_LIST_DECISIONS_METHOD,
    )?;
    Err(unsupported(
        host_protocol::SESSION_PERMISSION_LIST_DECISIONS_METHOD,
    ))
}

pub(crate) fn is_supported(_payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    serde_json::to_value(SessionPermissionSupportedPayload::unsupported(
        UNSUPPORTED_REASON,
    ))
    .map(Some)
    .map_err(|error| {
        HostProtocolError::internal(
            format!("failed to encode session permission support: {error}"),
            host_protocol::SESSION_PERMISSION_IS_SUPPORTED_METHOD,
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
    if profile.get("kind").and_then(Value::as_str) != Some("session-profile") {
        return Err(HostProtocolError::invalid_argument(
            "profile.kind",
            "must be session-profile",
            operation,
        ));
    }
    validate_object_string(profile.get("id"), "profile.id", operation)?;
    validate_object_string(profile.get("ownerScope"), "profile.ownerScope", operation)?;
    validate_object_string(profile.get("state"), "profile.state", operation)?;
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

fn validate_kind(payload: &Value, operation: &'static str) -> Result<(), HostProtocolError> {
    let kind = validate_object_string(payload.get("kind"), "kind", operation)?;
    if !PERMISSION_KINDS.contains(&kind) {
        return Err(HostProtocolError::invalid_argument(
            "kind",
            "must be a known session permission kind",
            operation,
        ));
    }
    Ok(())
}

fn validate_optional_kind(
    payload: &Value,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if payload.get("kind").is_some() {
        validate_kind(payload, operation)?;
    }
    Ok(())
}

fn validate_origin(payload: &Value, operation: &'static str) -> Result<(), HostProtocolError> {
    let origin = validate_object_string(payload.get("origin"), "origin", operation)?;
    if !is_allowed_origin(origin) {
        return Err(HostProtocolError::invalid_argument(
            "origin",
            "must be an app, http, or https origin",
            operation,
        ));
    }
    Ok(())
}

fn validate_optional_origin(
    payload: &Value,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if payload.get("origin").is_some() {
        validate_origin(payload, operation)?;
    }
    Ok(())
}

fn is_allowed_origin(origin: &str) -> bool {
    let Some((scheme, rest)) = origin.split_once("://") else {
        return false;
    };
    matches!(scheme, "app" | "http" | "https")
        && !rest.is_empty()
        && !rest.contains('/')
        && !rest.contains('?')
        && !rest.contains('#')
        && !rest.chars().any(char::is_whitespace)
}

fn validate_decision(payload: &Value, operation: &'static str) -> Result<(), HostProtocolError> {
    match payload.get("decision").and_then(Value::as_str) {
        Some("grant" | "deny") => Ok(()),
        Some(_) | None => Err(HostProtocolError::invalid_argument(
            "decision",
            "must be grant or deny",
            operation,
        )),
    }
}

fn validate_non_empty(
    payload: &Value,
    field: &'static str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_object_string(payload.get(field), field, operation).map(|_| ())
}

fn validate_optional_non_empty(
    payload: &Value,
    field: &'static str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if payload.get(field).is_some() {
        validate_non_empty(payload, field, operation)?;
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
    use super::{decide, is_supported, list_decisions, request};
    use serde_json::json;

    #[test]
    fn session_permission_methods_validate_then_report_unsupported() {
        let request_error = request(Some(json!({
            "profile": profile(),
            "kind": "camera",
            "origin": "https://example.test"
        })))
        .expect_err("host adapter is not implemented yet");
        assert_eq!(request_error.tag(), "Unsupported");

        let decide_error = decide(Some(json!({
            "profile": profile(),
            "requestId": "permission-request-1",
            "kind": "microphone",
            "origin": "app://localhost",
            "decision": "grant"
        })))
        .expect_err("host adapter is not implemented yet");
        assert_eq!(decide_error.tag(), "Unsupported");

        let list_error = list_decisions(Some(json!({
            "profile": profile(),
            "kind": "notifications"
        })))
        .expect_err("host adapter is not implemented yet");
        assert_eq!(list_error.tag(), "Unsupported");
    }

    #[test]
    fn session_permission_methods_reject_invalid_payloads_before_unsupported() {
        let unknown_kind = request(Some(json!({
            "profile": profile(),
            "kind": "midi",
            "origin": "https://example.test"
        })))
        .expect_err("unknown kind should fail");
        assert_eq!(unknown_kind.tag(), "InvalidArgument");

        let path_origin = request(Some(json!({
            "profile": profile(),
            "kind": "camera",
            "origin": "https://example.test/path"
        })))
        .expect_err("non-origin URL should fail");
        assert_eq!(path_origin.tag(), "InvalidArgument");

        let bad_decision = decide(Some(json!({
            "profile": profile(),
            "requestId": "permission-request-1",
            "kind": "camera",
            "origin": "https://example.test",
            "decision": "maybe"
        })))
        .expect_err("unknown decision should fail");
        assert_eq!(bad_decision.tag(), "InvalidArgument");
    }

    #[test]
    fn session_permission_support_reports_unavailable_host_adapter() {
        let response = is_supported(None)
            .expect("support should encode")
            .expect("support should return a payload");

        assert_eq!(
            response,
            json!({
                "supported": false,
                "reason": "host-session-permission-unavailable"
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
}
