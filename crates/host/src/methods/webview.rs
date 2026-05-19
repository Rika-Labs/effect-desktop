#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use crate::window::{
    WebViewCreateRequest, WebViewHandleRequest, WebViewLoadRouteRequest, WebViewLoadUrlRequest,
    WebViewNavigationDecision, WebViewNavigationPolicy, WindowMethodHandler,
};
use host_protocol::HostProtocolError;
use serde_json::{Map, Value};

const ALLOWED_CREATE_FIELDS: &[&str] = &["window", "url", "originPolicy"];
const ALLOWED_HANDLE_FIELDS: &[&str] = &["webview"];
const ALLOWED_LOAD_ROUTE_FIELDS: &[&str] = &["webview", "route"];
const ALLOWED_LOAD_URL_FIELDS: &[&str] = &["webview", "url"];
const ALLOWED_POLICY_FIELDS: &[&str] = &["webview", "policy"];
const ALLOWED_CAPABILITY_FIELDS: &[&str] = &["name", "platform", "mode"];
const ALLOWED_ORIGIN_POLICY_FIELDS: &[&str] = &["allowedOrigins", "onDisallowed"];
const ALLOWED_WEBVIEW_HANDLE_FIELDS: &[&str] = &["kind", "id", "generation", "ownerScope", "state"];
const ALLOWED_WINDOW_HANDLE_FIELDS: &[&str] = &["kind", "id", "generation", "ownerScope", "state"];

pub(crate) fn create(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = required_object(payload, host_protocol::WEBVIEW_CREATE_METHOD)?;
    validate_allowed_fields(
        &payload,
        ALLOWED_CREATE_FIELDS,
        host_protocol::WEBVIEW_CREATE_METHOD,
    )?;
    validate_window_handle_field(&payload, host_protocol::WEBVIEW_CREATE_METHOD)?;
    validate_url_field(&payload, "url", host_protocol::WEBVIEW_CREATE_METHOD)?;
    validate_policy_field(
        &payload,
        "originPolicy",
        host_protocol::WEBVIEW_CREATE_METHOD,
    )?;
    let request = decode_create_request(&payload)?;
    let response = handler.create_webview(request)?;

    Ok(Some(response.into_json()))
}

pub(crate) fn load_route(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = required_object(payload, host_protocol::WEBVIEW_LOAD_ROUTE_METHOD)?;
    validate_allowed_fields(
        &payload,
        ALLOWED_LOAD_ROUTE_FIELDS,
        host_protocol::WEBVIEW_LOAD_ROUTE_METHOD,
    )?;
    validate_webview_handle_field(&payload, host_protocol::WEBVIEW_LOAD_ROUTE_METHOD)?;
    validate_route_field(&payload, "route", host_protocol::WEBVIEW_LOAD_ROUTE_METHOD)?;
    handler.load_webview_route(WebViewLoadRouteRequest::new(
        decode_webview_handle(&payload, host_protocol::WEBVIEW_LOAD_ROUTE_METHOD)?,
        required_string(&payload, "route", host_protocol::WEBVIEW_LOAD_ROUTE_METHOD)?.to_string(),
    ))?;

    Ok(None)
}

pub(crate) fn load_url(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = required_object(payload, host_protocol::WEBVIEW_LOAD_URL_METHOD)?;
    validate_allowed_fields(
        &payload,
        ALLOWED_LOAD_URL_FIELDS,
        host_protocol::WEBVIEW_LOAD_URL_METHOD,
    )?;
    validate_webview_handle_field(&payload, host_protocol::WEBVIEW_LOAD_URL_METHOD)?;
    validate_url_field(&payload, "url", host_protocol::WEBVIEW_LOAD_URL_METHOD)?;
    handler.load_webview_url(WebViewLoadUrlRequest::new(
        decode_webview_handle(&payload, host_protocol::WEBVIEW_LOAD_URL_METHOD)?,
        required_string(&payload, "url", host_protocol::WEBVIEW_LOAD_URL_METHOD)?.to_string(),
    ))?;

    Ok(None)
}

pub(crate) fn reload(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = validate_handle_payload(payload, host_protocol::WEBVIEW_RELOAD_METHOD)?;
    handler.reload_webview(decode_webview_handle(
        &payload,
        host_protocol::WEBVIEW_RELOAD_METHOD,
    )?)?;

    Ok(None)
}

pub(crate) fn stop(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = validate_handle_payload(payload, host_protocol::WEBVIEW_STOP_METHOD)?;
    handler.stop_webview(decode_webview_handle(
        &payload,
        host_protocol::WEBVIEW_STOP_METHOD,
    )?)?;

    Ok(None)
}

pub(crate) fn go_back(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = validate_handle_payload(payload, host_protocol::WEBVIEW_GO_BACK_METHOD)?;
    handler.go_back_webview(decode_webview_handle(
        &payload,
        host_protocol::WEBVIEW_GO_BACK_METHOD,
    )?)?;

    Ok(None)
}

pub(crate) fn go_forward(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = validate_handle_payload(payload, host_protocol::WEBVIEW_GO_FORWARD_METHOD)?;
    handler.go_forward_webview(decode_webview_handle(
        &payload,
        host_protocol::WEBVIEW_GO_FORWARD_METHOD,
    )?)?;

    Ok(None)
}

pub(crate) fn get_navigation_state(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload =
        validate_handle_payload(payload, host_protocol::WEBVIEW_GET_NAVIGATION_STATE_METHOD)?;
    let response = handler.get_webview_navigation_state(decode_webview_handle(
        &payload,
        host_protocol::WEBVIEW_GET_NAVIGATION_STATE_METHOD,
    )?)?;

    Ok(Some(response.into_json()))
}

pub(crate) fn capture_screenshot(
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    validate_handle_payload(payload, host_protocol::WEBVIEW_CAPTURE_SCREENSHOT_METHOD)?;

    Err(unsupported(
        host_protocol::WEBVIEW_CAPTURE_SCREENSHOT_METHOD,
    ))
}

pub(crate) fn set_navigation_policy(
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = required_object(payload, host_protocol::WEBVIEW_SET_NAVIGATION_POLICY_METHOD)?;
    validate_allowed_fields(
        &payload,
        ALLOWED_POLICY_FIELDS,
        host_protocol::WEBVIEW_SET_NAVIGATION_POLICY_METHOD,
    )?;
    validate_webview_handle_field(
        &payload,
        host_protocol::WEBVIEW_SET_NAVIGATION_POLICY_METHOD,
    )?;
    validate_policy_field(
        &payload,
        "policy",
        host_protocol::WEBVIEW_SET_NAVIGATION_POLICY_METHOD,
    )?;

    Err(unsupported(
        host_protocol::WEBVIEW_SET_NAVIGATION_POLICY_METHOD,
    ))
}

pub(crate) fn capability(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let payload = required_object(payload, host_protocol::WEBVIEW_CAPABILITY_METHOD)?;
    validate_allowed_fields(
        &payload,
        ALLOWED_CAPABILITY_FIELDS,
        host_protocol::WEBVIEW_CAPABILITY_METHOD,
    )?;
    validate_capability_payload(&payload)?;

    Err(unsupported(host_protocol::WEBVIEW_CAPABILITY_METHOD))
}

pub(crate) fn destroy(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = validate_handle_payload(payload, host_protocol::WEBVIEW_DESTROY_METHOD)?;
    handler.destroy_webview(decode_webview_handle(
        &payload,
        host_protocol::WEBVIEW_DESTROY_METHOD,
    )?)?;

    Ok(None)
}

fn validate_handle_payload(
    payload: Option<Value>,
    operation: &'static str,
) -> Result<Map<String, Value>, HostProtocolError> {
    let payload = required_object(payload, operation)?;
    validate_allowed_fields(&payload, ALLOWED_HANDLE_FIELDS, operation)?;
    validate_webview_handle_field(&payload, operation)?;
    Ok(payload)
}

fn decode_create_request(
    payload: &Map<String, Value>,
) -> Result<WebViewCreateRequest, HostProtocolError> {
    Ok(WebViewCreateRequest::new(
        decode_window_id(payload, host_protocol::WEBVIEW_CREATE_METHOD)?,
        required_string(payload, "url", host_protocol::WEBVIEW_CREATE_METHOD)?.to_string(),
        decode_policy(
            payload,
            "originPolicy",
            host_protocol::WEBVIEW_CREATE_METHOD,
        )?,
    ))
}

fn decode_window_id(
    payload: &Map<String, Value>,
    operation: &'static str,
) -> Result<String, HostProtocolError> {
    let handle = payload
        .get("window")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            HostProtocolError::invalid_argument("window", "must be an object", operation)
        })?;
    Ok(required_string(handle, "id", operation)?.to_string())
}

fn decode_webview_handle(
    payload: &Map<String, Value>,
    operation: &'static str,
) -> Result<WebViewHandleRequest, HostProtocolError> {
    let handle = payload
        .get("webview")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            HostProtocolError::invalid_argument("webview", "must be an object", operation)
        })?;
    Ok(WebViewHandleRequest::new(
        required_string(handle, "id", operation)?.to_string(),
        handle
            .get("generation")
            .and_then(Value::as_u64)
            .ok_or_else(|| {
                HostProtocolError::invalid_argument(
                    "webview.generation",
                    "must be an integer",
                    operation,
                )
            })?,
        required_string(handle, "ownerScope", operation)?.to_string(),
    ))
}

fn decode_policy(
    payload: &Map<String, Value>,
    field: &'static str,
    operation: &'static str,
) -> Result<WebViewNavigationPolicy, HostProtocolError> {
    let policy = payload
        .get(field)
        .and_then(Value::as_object)
        .ok_or_else(|| {
            HostProtocolError::invalid_argument(field, "must be an object", operation)
        })?;
    let origins = policy
        .get("allowedOrigins")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            HostProtocolError::invalid_argument(
                format!("{field}.allowedOrigins"),
                "must be an array",
                operation,
            )
        })?
        .iter()
        .map(|value| {
            value.as_str().map(ToOwned::to_owned).ok_or_else(|| {
                HostProtocolError::invalid_argument(
                    format!("{field}.allowedOrigins"),
                    "must contain only strings",
                    operation,
                )
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let on_disallowed = match required_string(policy, "onDisallowed", operation)? {
        "block" => WebViewNavigationDecision::Block,
        "openExternal" => WebViewNavigationDecision::OpenExternal,
        other => {
            return Err(HostProtocolError::invalid_argument(
                format!("{field}.onDisallowed"),
                format!("must be block or openExternal, got {other}"),
                operation,
            ));
        }
    };
    Ok(WebViewNavigationPolicy::new(origins, on_disallowed))
}

fn required_string<'a>(
    payload: &'a Map<String, Value>,
    field: &'static str,
    operation: &'static str,
) -> Result<&'a str, HostProtocolError> {
    payload
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| HostProtocolError::invalid_argument(field, "must be a string", operation))
}

fn validate_window_handle_field(
    payload: &Map<String, Value>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let handle = payload
        .get("window")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            HostProtocolError::invalid_argument("window", "must be an object", operation)
        })?;
    validate_allowed_fields(handle, ALLOWED_WINDOW_HANDLE_FIELDS, operation)?;

    let kind = handle.get("kind").and_then(Value::as_str).ok_or_else(|| {
        HostProtocolError::invalid_argument("window.kind", "must be a string", operation)
    })?;
    if kind != "window" {
        return Err(HostProtocolError::invalid_argument(
            "window.kind",
            "must be window",
            operation,
        ));
    }

    validate_printable_object_string(handle, "id", "window.id", operation)?;
    validate_u64_field(handle, "generation", "window.generation", operation)?;
    validate_printable_object_string(handle, "ownerScope", "window.ownerScope", operation)?;

    let state = handle.get("state").and_then(Value::as_str).ok_or_else(|| {
        HostProtocolError::invalid_argument("window.state", "must be a string", operation)
    })?;
    if state != "open" {
        return Err(HostProtocolError::invalid_argument(
            "window.state",
            "must be open",
            operation,
        ));
    }

    Ok(())
}

fn validate_webview_handle_field(
    payload: &Map<String, Value>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let handle = payload
        .get("webview")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            HostProtocolError::invalid_argument("webview", "must be an object", operation)
        })?;
    validate_allowed_fields(handle, ALLOWED_WEBVIEW_HANDLE_FIELDS, operation)?;

    let kind = handle.get("kind").and_then(Value::as_str).ok_or_else(|| {
        HostProtocolError::invalid_argument("webview.kind", "must be a string", operation)
    })?;
    if kind != "webview" {
        return Err(HostProtocolError::invalid_argument(
            "webview.kind",
            "must be webview",
            operation,
        ));
    }

    validate_printable_object_string(handle, "id", "webview.id", operation)?;
    validate_u64_field(handle, "generation", "webview.generation", operation)?;
    validate_printable_object_string(handle, "ownerScope", "webview.ownerScope", operation)?;

    let state = handle.get("state").and_then(Value::as_str).ok_or_else(|| {
        HostProtocolError::invalid_argument("webview.state", "must be a string", operation)
    })?;
    if state != "open" {
        return Err(HostProtocolError::invalid_argument(
            "webview.state",
            "must be open",
            operation,
        ));
    }

    Ok(())
}

fn validate_policy_field(
    payload: &Map<String, Value>,
    field: &'static str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let policy = payload
        .get(field)
        .and_then(Value::as_object)
        .ok_or_else(|| {
            HostProtocolError::invalid_argument(field, "must be an object", operation)
        })?;
    validate_allowed_fields(policy, ALLOWED_ORIGIN_POLICY_FIELDS, operation)?;

    let origins = policy
        .get("allowedOrigins")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            HostProtocolError::invalid_argument(
                format!("{field}.allowedOrigins"),
                "must be an array",
                operation,
            )
        })?;
    if origins.is_empty() {
        return Err(HostProtocolError::invalid_argument(
            format!("{field}.allowedOrigins"),
            "must not be empty",
            operation,
        ));
    }
    for origin in origins {
        let origin = origin.as_str().ok_or_else(|| {
            HostProtocolError::invalid_argument(
                format!("{field}.allowedOrigins"),
                "must contain strings",
                operation,
            )
        })?;
        validate_origin(origin, &format!("{field}.allowedOrigins"), operation)?;
    }

    let on_disallowed = policy
        .get("onDisallowed")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            HostProtocolError::invalid_argument(
                format!("{field}.onDisallowed"),
                "must be a string",
                operation,
            )
        })?;
    if !matches!(on_disallowed, "block" | "openExternal") {
        return Err(HostProtocolError::invalid_argument(
            format!("{field}.onDisallowed"),
            "must be block or openExternal",
            operation,
        ));
    }

    Ok(())
}

fn validate_capability_payload(payload: &Map<String, Value>) -> Result<(), HostProtocolError> {
    let name = payload.get("name").and_then(Value::as_str).ok_or_else(|| {
        HostProtocolError::invalid_argument(
            "name",
            "must be a string",
            host_protocol::WEBVIEW_CAPABILITY_METHOD,
        )
    })?;
    if !matches!(
        name,
        "print"
            | "popup blocking"
            | "autofill"
            | "devtools open"
            | "getUserMedia"
            | "service workers in app:"
            | "PDF embedded viewer"
    ) {
        return Err(HostProtocolError::invalid_argument(
            "name",
            "must be a known WebView capability",
            host_protocol::WEBVIEW_CAPABILITY_METHOD,
        ));
    }

    validate_optional_enum_field(
        payload,
        "platform",
        &["macos", "windows", "linux"],
        host_protocol::WEBVIEW_CAPABILITY_METHOD,
    )?;
    validate_optional_enum_field(
        payload,
        "mode",
        &["dev", "prod"],
        host_protocol::WEBVIEW_CAPABILITY_METHOD,
    )
}

fn validate_url_field(
    payload: &Map<String, Value>,
    field: &'static str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let value = payload
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| HostProtocolError::invalid_argument(field, "must be a string", operation))?;
    validate_url(value, field, operation)
}

fn validate_url(
    value: &str,
    field: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_printable_value(field, value, operation)?;

    let Some((scheme, rest)) = value.split_once("://") else {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be an absolute URL",
            operation,
        ));
    };
    if scheme.is_empty() || rest.is_empty() {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be an absolute URL",
            operation,
        ));
    }
    if !scheme
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'-' | b'.'))
    {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must use a valid URL scheme",
            operation,
        ));
    }

    let lowercase_scheme = scheme.to_ascii_lowercase();
    if matches!(
        lowercase_scheme.as_str(),
        "javascript" | "data" | "vbscript" | "blob" | "file"
    ) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not use a blocked URL scheme",
            operation,
        ));
    }

    Ok(())
}

fn validate_route_field(
    payload: &Map<String, Value>,
    field: &'static str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let route = payload
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| HostProtocolError::invalid_argument(field, "must be a string", operation))?;
    validate_printable_value(field, route, operation)?;
    if !route.starts_with('/') {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must start with /",
            operation,
        ));
    }
    if route.contains('?') || route.contains('#') {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not include query or fragment",
            operation,
        ));
    }
    if route.split('/').any(|segment| segment == "..") {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not traverse parent segments",
            operation,
        ));
    }
    Ok(())
}

fn validate_origin(
    value: &str,
    field: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_printable_value(field, value, operation)?;
    let Some((scheme, rest)) = value.split_once("://") else {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be an origin",
            operation,
        ));
    };
    if !matches!(scheme, "app" | "http" | "https") || rest.is_empty() {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must use app, http, or https origin",
            operation,
        ));
    }
    if rest.contains(['/', '?', '#']) || rest.chars().any(char::is_whitespace) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not include path, query, fragment, or whitespace",
            operation,
        ));
    }
    Ok(())
}

fn validate_optional_enum_field(
    payload: &Map<String, Value>,
    field: &'static str,
    allowed: &[&str],
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    match payload.get(field) {
        None => Ok(()),
        Some(Value::String(value)) if allowed.contains(&value.as_str()) => Ok(()),
        Some(_) => Err(HostProtocolError::invalid_argument(
            field,
            format!("must be one of {}", allowed.join(", ")),
            operation,
        )),
    }
}

fn validate_printable_object_string(
    payload: &Map<String, Value>,
    field: &'static str,
    error_field: &'static str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let value = payload.get(field).and_then(Value::as_str).ok_or_else(|| {
        HostProtocolError::invalid_argument(error_field, "must be a string", operation)
    })?;
    validate_printable_value(error_field, value, operation)
}

fn validate_printable_value(
    field: &str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if value.is_empty() {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not be empty",
            operation,
        ));
    }
    if value.bytes().any(|byte| matches!(byte, 0x00..=0x1f | 0x7f)) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not include control characters",
            operation,
        ));
    }
    Ok(())
}

fn validate_u64_field(
    payload: &Map<String, Value>,
    field: &'static str,
    error_field: &'static str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if payload.get(field).and_then(Value::as_u64).is_none() {
        return Err(HostProtocolError::invalid_argument(
            error_field,
            "must be a non-negative integer",
            operation,
        ));
    }
    Ok(())
}

fn validate_allowed_fields(
    payload: &Map<String, Value>,
    allowed: &[&str],
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    for key in payload.keys() {
        if !allowed.contains(&key.as_str()) {
            return Err(HostProtocolError::invalid_argument(
                key.clone(),
                "is not a supported field",
                operation,
            ));
        }
    }
    Ok(())
}

fn required_object(
    payload: Option<Value>,
    operation: &'static str,
) -> Result<Map<String, Value>, HostProtocolError> {
    match payload {
        Some(Value::Object(object)) => Ok(object),
        Some(_) => Err(HostProtocolError::invalid_argument(
            "payload",
            "must be an object",
            operation,
        )),
        None => Err(HostProtocolError::invalid_argument(
            "payload",
            "is required",
            operation,
        )),
    }
}

fn unsupported(operation: &'static str) -> HostProtocolError {
    HostProtocolError::unsupported(host_protocol::WEBVIEW_UNSUPPORTED_REASON, operation)
}

#[cfg(test)]
mod tests {
    use super::{capability, set_navigation_policy};
    use host_protocol::HostProtocolError;
    use serde_json::json;

    fn webview_handle() -> serde_json::Value {
        json!({
            "kind": "webview",
            "id": "webview-1",
            "generation": 0,
            "ownerScope": "window:window-1",
            "state": "open"
        })
    }

    #[test]
    fn set_navigation_policy_validates_policy_then_fails_closed() {
        let error = set_navigation_policy(Some(json!({
            "webview": webview_handle(),
            "policy": {
                "allowedOrigins": ["app://localhost", "https://example.com"],
                "onDisallowed": "openExternal"
            }
        })))
        .expect_err("set navigation policy should be unsupported");

        assert!(matches!(error, HostProtocolError::Unsupported { .. }));
    }

    #[test]
    fn capability_rejects_unknown_names_before_unsupported() {
        let error = capability(Some(json!({ "name": "unknown" })))
            .expect_err("unknown capability should fail");

        assert!(matches!(error, HostProtocolError::InvalidArgument { .. }));
    }
}
