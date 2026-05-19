#![allow(clippy::result_large_err)]
// Host method boundaries return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{CookieStoreSupportedPayload, HostProtocolError};
use serde_json::Value;

const UNSUPPORTED_REASON: &str = "host-cookie-store-unavailable";

pub(crate) fn get(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let payload = require_payload(payload, host_protocol::COOKIE_STORE_GET_METHOD)?;
    validate_profile_handle(&payload, host_protocol::COOKIE_STORE_GET_METHOD)?;
    validate_url(&payload, host_protocol::COOKIE_STORE_GET_METHOD)?;
    validate_optional_non_empty(&payload, "name", host_protocol::COOKIE_STORE_GET_METHOD)?;
    validate_optional_non_empty(&payload, "traceId", host_protocol::COOKIE_STORE_GET_METHOD)?;
    Err(unsupported(host_protocol::COOKIE_STORE_GET_METHOD))
}

pub(crate) fn set(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let payload = require_payload(payload, host_protocol::COOKIE_STORE_SET_METHOD)?;
    validate_profile_handle(&payload, host_protocol::COOKIE_STORE_SET_METHOD)?;
    validate_url(&payload, host_protocol::COOKIE_STORE_SET_METHOD)?;
    validate_cookie(&payload, host_protocol::COOKIE_STORE_SET_METHOD)?;
    validate_optional_non_empty(&payload, "traceId", host_protocol::COOKIE_STORE_SET_METHOD)?;
    Err(unsupported(host_protocol::COOKIE_STORE_SET_METHOD))
}

pub(crate) fn remove(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let payload = require_payload(payload, host_protocol::COOKIE_STORE_REMOVE_METHOD)?;
    validate_profile_handle(&payload, host_protocol::COOKIE_STORE_REMOVE_METHOD)?;
    validate_url(&payload, host_protocol::COOKIE_STORE_REMOVE_METHOD)?;
    validate_non_empty(&payload, "name", host_protocol::COOKIE_STORE_REMOVE_METHOD)?;
    validate_optional_non_empty(
        &payload,
        "traceId",
        host_protocol::COOKIE_STORE_REMOVE_METHOD,
    )?;
    Err(unsupported(host_protocol::COOKIE_STORE_REMOVE_METHOD))
}

pub(crate) fn is_supported(_payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    serde_json::to_value(CookieStoreSupportedPayload::unsupported(UNSUPPORTED_REASON))
        .map(Some)
        .map_err(|error| {
            HostProtocolError::internal(
                format!("failed to encode cookie store support: {error}"),
                host_protocol::COOKIE_STORE_IS_SUPPORTED_METHOD,
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

fn validate_cookie(payload: &Value, operation: &'static str) -> Result<(), HostProtocolError> {
    let cookie = payload
        .get("cookie")
        .ok_or_else(|| HostProtocolError::invalid_argument("cookie", "is required", operation))?;
    let Some(cookie) = cookie.as_object() else {
        return Err(HostProtocolError::invalid_argument(
            "cookie",
            "must be an object",
            operation,
        ));
    };
    validate_object_string(cookie.get("name"), "cookie.name", operation)?;
    validate_object_string(cookie.get("value"), "cookie.value", operation)?;
    validate_object_string(cookie.get("domain"), "cookie.domain", operation)?;
    let path = validate_object_string(cookie.get("path"), "cookie.path", operation)?;
    if !path.starts_with('/') {
        return Err(HostProtocolError::invalid_argument(
            "cookie.path",
            "must start with /",
            operation,
        ));
    }
    validate_optional_bool(cookie.get("secure"), "cookie.secure", operation)?;
    validate_optional_bool(cookie.get("httpOnly"), "cookie.httpOnly", operation)?;
    if let Some(same_site) = cookie.get("sameSite") {
        match same_site.as_str() {
            Some("lax" | "strict" | "none") => {}
            Some(_) | None => {
                return Err(HostProtocolError::invalid_argument(
                    "cookie.sameSite",
                    "must be lax, strict, or none",
                    operation,
                ))
            }
        }
    }
    if let Some(expires_at) = cookie.get("expiresAt") {
        if !expires_at.is_f64() && !expires_at.is_i64() && !expires_at.is_u64() {
            return Err(HostProtocolError::invalid_argument(
                "cookie.expiresAt",
                "must be a number",
                operation,
            ));
        }
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

fn validate_optional_bool(
    value: Option<&Value>,
    field: &'static str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if value.is_some_and(|value| !value.is_boolean()) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be a boolean",
            operation,
        ));
    }
    Ok(())
}

fn validate_object_string<'a>(
    value: Option<&'a Value>,
    field: &'static str,
    operation: &'static str,
) -> Result<&'a str, HostProtocolError> {
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
    Ok(value)
}

fn unsupported(operation: &'static str) -> HostProtocolError {
    HostProtocolError::unsupported(UNSUPPORTED_REASON, operation)
}

#[cfg(test)]
mod tests {
    use super::{get, is_supported, remove, set};
    use serde_json::json;

    #[test]
    fn cookie_store_methods_validate_then_report_unsupported() {
        let profile = profile();
        let get_error = get(Some(json!({
            "profile": profile,
            "url": "https://example.test/account"
        })))
        .expect_err("host adapter is not implemented yet");
        assert_eq!(get_error.tag(), "Unsupported");

        let set_error = set(Some(json!({
            "profile": profile,
            "url": "https://example.test/account",
            "cookie": cookie()
        })))
        .expect_err("host adapter is not implemented yet");
        assert_eq!(set_error.tag(), "Unsupported");

        let remove_error = remove(Some(json!({
            "profile": profile,
            "url": "https://example.test/account",
            "name": "token"
        })))
        .expect_err("host adapter is not implemented yet");
        assert_eq!(remove_error.tag(), "Unsupported");
    }

    #[test]
    fn cookie_store_methods_reject_invalid_payloads_before_unsupported() {
        let bad_url = get(Some(json!({
            "profile": profile(),
            "url": "file:///tmp/cookie"
        })))
        .expect_err("non-http url should fail");
        assert_eq!(bad_url.tag(), "InvalidArgument");

        let bad_profile = get(Some(json!({
            "profile": {
                "kind": "webview",
                "id": "session-profile:workspace-1",
                "generation": 0,
                "ownerScope": "workspace:1",
                "state": "open"
            },
            "url": "https://example.test/account"
        })))
        .expect_err("wrong profile kind should fail");
        assert_eq!(bad_profile.tag(), "InvalidArgument");

        let bad_cookie = set(Some(json!({
            "profile": profile(),
            "url": "https://example.test/account",
            "cookie": {
                "name": "token",
                "value": "secret",
                "domain": "example.test",
                "path": "relative"
            }
        })))
        .expect_err("relative cookie path should fail");
        assert_eq!(bad_cookie.tag(), "InvalidArgument");
    }

    #[test]
    fn cookie_store_support_reports_unavailable_host_adapter() {
        let response = is_supported(None)
            .expect("support should encode")
            .expect("support should return a payload");

        assert_eq!(
            response,
            json!({
                "supported": false,
                "reason": "host-cookie-store-unavailable"
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

    fn cookie() -> serde_json::Value {
        json!({
            "name": "token",
            "value": "secret",
            "domain": "example.test",
            "path": "/",
            "secure": true,
            "httpOnly": true,
            "sameSite": "lax"
        })
    }
}
