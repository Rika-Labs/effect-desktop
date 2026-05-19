#![allow(clippy::result_large_err)]
// Host method boundaries return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{HostProtocolError, WebRequestSupportedPayload};
use serde_json::Value;

const UNSUPPORTED_REASON: &str = "host-web-request-unavailable";

pub(crate) fn on_before_request(
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = require_payload(payload, host_protocol::WEB_REQUEST_ON_BEFORE_REQUEST_METHOD)?;
    validate_profile_handle(
        &payload,
        host_protocol::WEB_REQUEST_ON_BEFORE_REQUEST_METHOD,
    )?;
    validate_url_pattern(
        &payload,
        "urlPattern",
        host_protocol::WEB_REQUEST_ON_BEFORE_REQUEST_METHOD,
    )?;
    validate_before_request_action(&payload)?;
    validate_optional_non_empty(
        &payload,
        "ownerScope",
        host_protocol::WEB_REQUEST_ON_BEFORE_REQUEST_METHOD,
    )?;
    validate_optional_non_empty(
        &payload,
        "traceId",
        host_protocol::WEB_REQUEST_ON_BEFORE_REQUEST_METHOD,
    )?;
    Err(unsupported(
        host_protocol::WEB_REQUEST_ON_BEFORE_REQUEST_METHOD,
    ))
}

pub(crate) fn on_headers_received(
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = require_payload(
        payload,
        host_protocol::WEB_REQUEST_ON_HEADERS_RECEIVED_METHOD,
    )?;
    validate_profile_handle(
        &payload,
        host_protocol::WEB_REQUEST_ON_HEADERS_RECEIVED_METHOD,
    )?;
    validate_url_pattern(
        &payload,
        "urlPattern",
        host_protocol::WEB_REQUEST_ON_HEADERS_RECEIVED_METHOD,
    )?;
    validate_response_headers(&payload)?;
    validate_optional_non_empty(
        &payload,
        "ownerScope",
        host_protocol::WEB_REQUEST_ON_HEADERS_RECEIVED_METHOD,
    )?;
    validate_optional_non_empty(
        &payload,
        "traceId",
        host_protocol::WEB_REQUEST_ON_HEADERS_RECEIVED_METHOD,
    )?;
    Err(unsupported(
        host_protocol::WEB_REQUEST_ON_HEADERS_RECEIVED_METHOD,
    ))
}

pub(crate) fn remove_listener(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let payload = require_payload(payload, host_protocol::WEB_REQUEST_REMOVE_LISTENER_METHOD)?;
    validate_interceptor_handle(&payload, host_protocol::WEB_REQUEST_REMOVE_LISTENER_METHOD)?;
    validate_optional_non_empty(
        &payload,
        "traceId",
        host_protocol::WEB_REQUEST_REMOVE_LISTENER_METHOD,
    )?;
    Err(unsupported(
        host_protocol::WEB_REQUEST_REMOVE_LISTENER_METHOD,
    ))
}

pub(crate) fn is_supported(_payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    serde_json::to_value(WebRequestSupportedPayload::unsupported(UNSUPPORTED_REASON))
        .map(Some)
        .map_err(|error| {
            HostProtocolError::internal(
                format!("failed to encode web request support: {error}"),
                host_protocol::WEB_REQUEST_IS_SUPPORTED_METHOD,
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

fn validate_interceptor_handle(
    payload: &Value,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let interceptor = payload.get("interceptor").ok_or_else(|| {
        HostProtocolError::invalid_argument("interceptor", "is required", operation)
    })?;
    let Some(interceptor) = interceptor.as_object() else {
        return Err(HostProtocolError::invalid_argument(
            "interceptor",
            "must be an object",
            operation,
        ));
    };
    if interceptor.get("kind").and_then(Value::as_str) != Some("web-request-interceptor") {
        return Err(HostProtocolError::invalid_argument(
            "interceptor.kind",
            "must be web-request-interceptor",
            operation,
        ));
    }
    validate_object_string(interceptor.get("id"), "interceptor.id", operation)?;
    validate_object_string(
        interceptor.get("ownerScope"),
        "interceptor.ownerScope",
        operation,
    )?;
    validate_object_string(interceptor.get("state"), "interceptor.state", operation)?;
    if interceptor.get("state").and_then(Value::as_str) != Some("open") {
        return Err(HostProtocolError::invalid_argument(
            "interceptor.state",
            "must be open",
            operation,
        ));
    }
    if !interceptor.get("generation").is_some_and(Value::is_u64) {
        return Err(HostProtocolError::invalid_argument(
            "interceptor.generation",
            "must be an unsigned integer",
            operation,
        ));
    }
    Ok(())
}

fn validate_before_request_action(payload: &Value) -> Result<(), HostProtocolError> {
    let operation = host_protocol::WEB_REQUEST_ON_BEFORE_REQUEST_METHOD;
    let action = validate_object_string(payload.get("action"), "action", operation)?;
    if !matches!(action, "allow" | "block" | "redirect") {
        return Err(HostProtocolError::invalid_argument(
            "action",
            "must be allow, block, or redirect",
            operation,
        ));
    }
    let redirect_url = payload.get("redirectUrl").and_then(Value::as_str);
    if action == "redirect" && redirect_url.is_none() {
        return Err(HostProtocolError::invalid_argument(
            "redirectUrl",
            "is required when redirecting a request",
            operation,
        ));
    }
    if action != "redirect" && payload.get("redirectUrl").is_some() {
        return Err(HostProtocolError::invalid_argument(
            "redirectUrl",
            "is only valid when redirecting a request",
            operation,
        ));
    }
    if let Some(redirect_url) = redirect_url {
        if !is_absolute_http_url(redirect_url) {
            return Err(HostProtocolError::invalid_argument(
                "redirectUrl",
                "must be an absolute HTTP(S) URL",
                operation,
            ));
        }
    }
    Ok(())
}

fn validate_response_headers(payload: &Value) -> Result<(), HostProtocolError> {
    let operation = host_protocol::WEB_REQUEST_ON_HEADERS_RECEIVED_METHOD;
    let headers = payload.get("responseHeaders").ok_or_else(|| {
        HostProtocolError::invalid_argument("responseHeaders", "is required", operation)
    })?;
    let Some(headers) = headers.as_array() else {
        return Err(HostProtocolError::invalid_argument(
            "responseHeaders",
            "must be an array",
            operation,
        ));
    };
    for (index, header) in headers.iter().enumerate() {
        let Some(header) = header.as_object() else {
            return Err(HostProtocolError::invalid_argument(
                format!("responseHeaders[{index}]"),
                "must be an object",
                operation,
            ));
        };
        let name = validate_object_string(
            header.get("name"),
            format!("responseHeaders[{index}].name"),
            operation,
        )?;
        if !is_header_name(name) {
            return Err(HostProtocolError::invalid_argument(
                format!("responseHeaders[{index}].name"),
                "must be an HTTP header token",
                operation,
            ));
        }
        if !header.get("value").is_some_and(Value::is_string) {
            return Err(HostProtocolError::invalid_argument(
                format!("responseHeaders[{index}].value"),
                "must be a string",
                operation,
            ));
        }
    }
    Ok(())
}

fn validate_url_pattern(
    payload: &Value,
    field: &'static str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let pattern = validate_object_string(payload.get(field), field, operation)?;
    let Some((scheme, rest)) = pattern.split_once("://") else {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must include a supported URL scheme",
            operation,
        ));
    };
    if !matches!(scheme, "*" | "app" | "http" | "https") || rest.chars().any(char::is_whitespace) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must use app, http, https, or wildcard scheme without whitespace",
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

fn is_absolute_http_url(value: &str) -> bool {
    let Some((scheme, rest)) = value.split_once("://") else {
        return false;
    };
    matches!(scheme, "http" | "https") && !rest.is_empty() && !rest.chars().any(char::is_whitespace)
}

fn is_header_name(value: &str) -> bool {
    value.bytes().all(|byte| {
        byte.is_ascii_alphanumeric()
            || matches!(
                byte,
                b'!' | b'#'
                    | b'$'
                    | b'%'
                    | b'&'
                    | b'\''
                    | b'*'
                    | b'+'
                    | b'-'
                    | b'.'
                    | b'^'
                    | b'_'
                    | b'`'
                    | b'|'
                    | b'~'
            )
    })
}

fn unsupported(operation: &'static str) -> HostProtocolError {
    HostProtocolError::unsupported(UNSUPPORTED_REASON, operation)
}

#[cfg(test)]
mod tests {
    use super::{is_supported, on_before_request, on_headers_received, remove_listener};
    use serde_json::json;

    #[test]
    fn web_request_methods_validate_then_report_unsupported() {
        for error in [
            on_before_request(Some(json!({
                "profile": profile(),
                "urlPattern": "https://example.test/*",
                "action": "block"
            })))
            .expect_err("host adapter is not implemented yet"),
            on_headers_received(Some(json!({
                "profile": profile(),
                "urlPattern": "https://example.test/*",
                "responseHeaders": [{ "name": "x-audit", "value": "1" }]
            })))
            .expect_err("host adapter is not implemented yet"),
            remove_listener(Some(json!({
                "interceptor": interceptor()
            })))
            .expect_err("host adapter is not implemented yet"),
        ] {
            assert_eq!(error.tag(), "Unsupported");
        }
    }

    #[test]
    fn web_request_methods_reject_invalid_payloads_before_unsupported() {
        let missing_redirect = on_before_request(Some(json!({
            "profile": profile(),
            "urlPattern": "https://example.test/*",
            "action": "redirect"
        })))
        .expect_err("redirect requires a URL");
        assert_eq!(missing_redirect.tag(), "InvalidArgument");

        let invalid_header = on_headers_received(Some(json!({
            "profile": profile(),
            "urlPattern": "https://example.test/*",
            "responseHeaders": [{ "name": "bad header", "value": "1" }]
        })))
        .expect_err("invalid header name should fail");
        assert_eq!(invalid_header.tag(), "InvalidArgument");

        let invalid_interceptor = remove_listener(Some(json!({
            "interceptor": {
                "kind": "download",
                "id": "download:1",
                "generation": 0,
                "ownerScope": "workspace:1",
                "state": "open"
            }
        })))
        .expect_err("wrong handle kind should fail");
        assert_eq!(invalid_interceptor.tag(), "InvalidArgument");
    }

    #[test]
    fn web_request_support_reports_unavailable_host_adapter() {
        let response = is_supported(None)
            .expect("support should encode")
            .expect("support should return a payload");

        assert_eq!(
            response,
            json!({
                "supported": false,
                "reason": "host-web-request-unavailable"
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

    fn interceptor() -> serde_json::Value {
        json!({
            "kind": "web-request-interceptor",
            "id": "web-request-interceptor:1",
            "generation": 0,
            "ownerScope": "workspace:1",
            "state": "open"
        })
    }
}
