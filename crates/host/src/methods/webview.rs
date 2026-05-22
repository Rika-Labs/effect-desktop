#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use crate::window::{
    WebViewCreateRequest, WebViewExposedApi, WebViewHandleRequest, WebViewIsolationPolicy,
    WebViewLoadRouteRequest, WebViewLoadUrlRequest, WebViewNavigationDecision,
    WebViewNavigationPolicy, WebViewSetNavigationPolicyRequest, WebViewSetZoomRequest,
    WindowMethodHandler,
};
use host_protocol::HostProtocolError;
use host_protocol::SessionProfileResourcePayload;
use serde_json::{Map, Value};

const ALLOWED_CREATE_FIELDS: &[&str] = &["window", "url", "originPolicy", "profile", "isolation"];
const ALLOWED_HANDLE_FIELDS: &[&str] = &["webview"];
const ALLOWED_LOAD_ROUTE_FIELDS: &[&str] = &["webview", "route"];
const ALLOWED_LOAD_URL_FIELDS: &[&str] = &["webview", "url"];
const ALLOWED_POLICY_FIELDS: &[&str] = &["webview", "policy"];
const ALLOWED_SET_ZOOM_FIELDS: &[&str] = &["webview", "zoom"];
const ALLOWED_ORIGIN_POLICY_FIELDS: &[&str] = &["allowedOrigins", "onDisallowed"];
const ALLOWED_ISOLATION_FIELDS: &[&str] = &["exposedApis"];
const ALLOWED_EXPOSED_API_FIELDS: &[&str] = &["name", "methods"];
const ALLOWED_WEBVIEW_HANDLE_FIELDS: &[&str] = &["kind", "id", "generation", "ownerScope", "state"];
const ALLOWED_WINDOW_HANDLE_FIELDS: &[&str] = &["kind", "id", "generation", "ownerScope", "state"];
const ALLOWED_SESSION_PROFILE_HANDLE_FIELDS: &[&str] =
    &["kind", "id", "generation", "ownerScope", "state"];

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
    validate_session_profile_field(&payload, host_protocol::WEBVIEW_CREATE_METHOD)?;
    validate_isolation_field(&payload, host_protocol::WEBVIEW_CREATE_METHOD)?;
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

pub(crate) fn print(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = validate_handle_payload(payload, host_protocol::WEBVIEW_PRINT_METHOD)?;
    handler.print_webview(decode_webview_handle(
        &payload,
        host_protocol::WEBVIEW_PRINT_METHOD,
    )?)?;

    Ok(None)
}

pub(crate) fn set_zoom(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = required_object(payload, host_protocol::WEBVIEW_SET_ZOOM_METHOD)?;
    validate_allowed_fields(
        &payload,
        ALLOWED_SET_ZOOM_FIELDS,
        host_protocol::WEBVIEW_SET_ZOOM_METHOD,
    )?;
    validate_webview_handle_field(&payload, host_protocol::WEBVIEW_SET_ZOOM_METHOD)?;
    let zoom = validate_zoom_field(&payload, host_protocol::WEBVIEW_SET_ZOOM_METHOD)?;
    handler.set_webview_zoom(WebViewSetZoomRequest::new(
        decode_webview_handle(&payload, host_protocol::WEBVIEW_SET_ZOOM_METHOD)?,
        zoom,
    ))?;

    Ok(None)
}

pub(crate) fn open_devtools(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = validate_handle_payload(payload, host_protocol::WEBVIEW_OPEN_DEVTOOLS_METHOD)?;
    handler.open_webview_devtools(decode_webview_handle(
        &payload,
        host_protocol::WEBVIEW_OPEN_DEVTOOLS_METHOD,
    )?)?;

    Ok(None)
}

pub(crate) fn close_devtools(
    handler: &dyn WindowMethodHandler,
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = validate_handle_payload(payload, host_protocol::WEBVIEW_CLOSE_DEVTOOLS_METHOD)?;
    handler.close_webview_devtools(decode_webview_handle(
        &payload,
        host_protocol::WEBVIEW_CLOSE_DEVTOOLS_METHOD,
    )?)?;

    Ok(None)
}

pub(crate) fn set_navigation_policy(
    handler: &dyn WindowMethodHandler,
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
    handler.set_webview_navigation_policy(WebViewSetNavigationPolicyRequest::new(
        decode_webview_handle(
            &payload,
            host_protocol::WEBVIEW_SET_NAVIGATION_POLICY_METHOD,
        )?,
        decode_policy(
            &payload,
            "policy",
            host_protocol::WEBVIEW_SET_NAVIGATION_POLICY_METHOD,
        )?,
    ))?;

    Ok(None)
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
        decode_session_profile(payload, host_protocol::WEBVIEW_CREATE_METHOD)?,
        decode_isolation(payload, host_protocol::WEBVIEW_CREATE_METHOD)?,
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

fn decode_session_profile(
    payload: &Map<String, Value>,
    operation: &'static str,
) -> Result<Option<SessionProfileResourcePayload>, HostProtocolError> {
    let Some(profile) = payload.get("profile") else {
        return Ok(None);
    };
    serde_json::from_value(profile.clone())
        .map(Some)
        .map_err(|error| {
            HostProtocolError::invalid_argument(
                "profile",
                format!("invalid session profile handle: {error}"),
                operation,
            )
        })
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

fn decode_isolation(
    payload: &Map<String, Value>,
    operation: &'static str,
) -> Result<Option<WebViewIsolationPolicy>, HostProtocolError> {
    let Some(isolation) = payload.get("isolation").and_then(Value::as_object) else {
        return Ok(None);
    };
    let apis = isolation
        .get("exposedApis")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            HostProtocolError::invalid_argument(
                "isolation.exposedApis",
                "must be an array",
                operation,
            )
        })?
        .iter()
        .enumerate()
        .map(|(index, value)| {
            let api = value.as_object().ok_or_else(|| {
                HostProtocolError::invalid_argument(
                    format!("isolation.exposedApis[{index}]"),
                    "must be an object",
                    operation,
                )
            })?;
            let methods = api
                .get("methods")
                .and_then(Value::as_array)
                .ok_or_else(|| {
                    HostProtocolError::invalid_argument(
                        format!("isolation.exposedApis[{index}].methods"),
                        "must be an array",
                        operation,
                    )
                })?
                .iter()
                .map(|method| {
                    method.as_str().map(ToOwned::to_owned).ok_or_else(|| {
                        HostProtocolError::invalid_argument(
                            format!("isolation.exposedApis[{index}].methods"),
                            "must contain only strings",
                            operation,
                        )
                    })
                })
                .collect::<Result<Vec<_>, _>>()?;
            Ok(WebViewExposedApi::new(
                required_string(api, "name", operation)?.to_string(),
                methods,
            ))
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Some(WebViewIsolationPolicy::new(apis)))
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

fn validate_zoom_field(
    payload: &Map<String, Value>,
    operation: &'static str,
) -> Result<f64, HostProtocolError> {
    let Some(zoom) = payload.get("zoom").and_then(Value::as_f64) else {
        return Err(HostProtocolError::invalid_argument(
            "zoom",
            "must be a number",
            operation,
        ));
    };
    if !zoom.is_finite() || zoom <= 0.0 {
        return Err(HostProtocolError::invalid_argument(
            "zoom",
            "must be a finite number greater than 0",
            operation,
        ));
    }
    Ok(zoom)
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

fn validate_session_profile_field(
    payload: &Map<String, Value>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let Some(profile) = payload.get("profile") else {
        return Ok(());
    };
    let handle = profile.as_object().ok_or_else(|| {
        HostProtocolError::invalid_argument("profile", "must be an object", operation)
    })?;
    validate_allowed_fields(handle, ALLOWED_SESSION_PROFILE_HANDLE_FIELDS, operation)?;

    let kind = handle.get("kind").and_then(Value::as_str).ok_or_else(|| {
        HostProtocolError::invalid_argument("profile.kind", "must be a string", operation)
    })?;
    if kind != "session-profile" {
        return Err(HostProtocolError::invalid_argument(
            "profile.kind",
            "must be session-profile",
            operation,
        ));
    }

    validate_printable_object_string(handle, "id", "profile.id", operation)?;
    validate_u64_field(handle, "generation", "profile.generation", operation)?;
    validate_printable_object_string(handle, "ownerScope", "profile.ownerScope", operation)?;

    let state = handle.get("state").and_then(Value::as_str).ok_or_else(|| {
        HostProtocolError::invalid_argument("profile.state", "must be a string", operation)
    })?;
    if state != "open" {
        return Err(HostProtocolError::invalid_argument(
            "profile.state",
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

fn validate_isolation_field(
    payload: &Map<String, Value>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let Some(isolation) = payload.get("isolation") else {
        return Ok(());
    };
    let isolation = isolation.as_object().ok_or_else(|| {
        HostProtocolError::invalid_argument("isolation", "must be an object", operation)
    })?;
    validate_allowed_fields(isolation, ALLOWED_ISOLATION_FIELDS, operation)?;
    let apis = isolation
        .get("exposedApis")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            HostProtocolError::invalid_argument(
                "isolation.exposedApis",
                "must be an array",
                operation,
            )
        })?;
    if apis.is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "isolation.exposedApis",
            "must not be empty",
            operation,
        ));
    }
    for (index, api) in apis.iter().enumerate() {
        let api = api.as_object().ok_or_else(|| {
            HostProtocolError::invalid_argument(
                format!("isolation.exposedApis[{index}]"),
                "must be an object",
                operation,
            )
        })?;
        validate_allowed_fields(api, ALLOWED_EXPOSED_API_FIELDS, operation)?;
        validate_js_api_name(api, "name", "isolation.exposedApis.name", operation)?;
        let methods = api
            .get("methods")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                HostProtocolError::invalid_argument(
                    format!("isolation.exposedApis[{index}].methods"),
                    "must be an array",
                    operation,
                )
            })?;
        if methods.is_empty() {
            return Err(HostProtocolError::invalid_argument(
                format!("isolation.exposedApis[{index}].methods"),
                "must not be empty",
                operation,
            ));
        }
        for method in methods {
            let Some(method) = method.as_str() else {
                return Err(HostProtocolError::invalid_argument(
                    format!("isolation.exposedApis[{index}].methods"),
                    "must contain only strings",
                    operation,
                ));
            };
            validate_js_identifier(
                method,
                format!("isolation.exposedApis[{index}].methods"),
                operation,
            )?;
        }
    }
    Ok(())
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
    if !is_valid_url_scheme(scheme) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must use a valid URL scheme",
            operation,
        ));
    }
    let authority = authority_from_absolute_url_rest(rest).ok_or_else(|| {
        HostProtocolError::invalid_argument(field, "must include a URL authority", operation)
    })?;
    if !authority_has_host(authority) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must include a URL host",
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

fn is_valid_url_scheme(scheme: &str) -> bool {
    let mut bytes = scheme.bytes();
    bytes.next().is_some_and(|byte| byte.is_ascii_alphabetic())
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'-' | b'.'))
}

fn authority_from_absolute_url_rest(rest: &str) -> Option<&str> {
    rest.split(['/', '?', '#'])
        .next()
        .filter(|authority| !authority.is_empty())
}

fn authority_has_host(authority: &str) -> bool {
    let host_port = authority
        .rsplit_once('@')
        .map_or(authority, |(_, host)| host);
    if host_port.starts_with('[') {
        return host_port.contains(']');
    }

    host_port
        .split_once(':')
        .map_or(!host_port.is_empty(), |(host, _)| !host.is_empty())
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
    if !authority_has_host(rest) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must include a host",
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

fn validate_js_api_name(
    payload: &Map<String, Value>,
    field: &'static str,
    error_field: &'static str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let value = payload.get(field).and_then(Value::as_str).ok_or_else(|| {
        HostProtocolError::invalid_argument(error_field, "must be a string", operation)
    })?;
    validate_printable_value(error_field, value, operation)?;
    validate_js_identifier(value, error_field, operation)
}

fn validate_js_identifier(
    value: &str,
    field: impl Into<String>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let field = field.into();
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not be empty",
            operation,
        ));
    };
    if !(first == '_' || first == '$' || first.is_ascii_alphabetic()) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be a JavaScript identifier",
            operation,
        ));
    }
    if !chars.all(|char| char == '_' || char == '$' || char.is_ascii_alphanumeric()) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be a JavaScript identifier",
            operation,
        ));
    }
    Ok(())
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
