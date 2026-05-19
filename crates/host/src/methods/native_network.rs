#![allow(clippy::result_large_err)]
// Host method boundaries return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{HostProtocolError, NativeNetworkSupportedPayload};
use serde_json::Value;

const UNSUPPORTED_REASON: &str = "host-native-network-unavailable";

pub(crate) fn fetch(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let payload = require_payload(payload, host_protocol::NATIVE_NETWORK_FETCH_METHOD)?;
    validate_http_url(&payload, "url", host_protocol::NATIVE_NETWORK_FETCH_METHOD)?;
    let method = validate_http_method(&payload, host_protocol::NATIVE_NETWORK_FETCH_METHOD)?;
    if method == "GET" && payload.get("body").is_some() {
        return Err(HostProtocolError::invalid_argument(
            "body",
            "must be omitted for GET requests",
            host_protocol::NATIVE_NETWORK_FETCH_METHOD,
        ));
    }
    validate_headers(&payload, host_protocol::NATIVE_NETWORK_FETCH_METHOD)?;
    validate_optional_string(&payload, "body", host_protocol::NATIVE_NETWORK_FETCH_METHOD)?;
    validate_optional_non_empty(
        &payload,
        "ownerScope",
        host_protocol::NATIVE_NETWORK_FETCH_METHOD,
    )?;
    validate_optional_non_empty(
        &payload,
        "traceId",
        host_protocol::NATIVE_NETWORK_FETCH_METHOD,
    )?;
    Err(unsupported(host_protocol::NATIVE_NETWORK_FETCH_METHOD))
}

pub(crate) fn upload(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let payload = require_payload(payload, host_protocol::NATIVE_NETWORK_UPLOAD_METHOD)?;
    validate_http_url(&payload, "url", host_protocol::NATIVE_NETWORK_UPLOAD_METHOD)?;
    if let Some(method) = payload.get("method").and_then(Value::as_str) {
        if !matches!(method, "POST" | "PUT" | "PATCH") {
            return Err(HostProtocolError::invalid_argument(
                "method",
                "must be POST, PUT, or PATCH",
                host_protocol::NATIVE_NETWORK_UPLOAD_METHOD,
            ));
        }
    }
    validate_headers(&payload, host_protocol::NATIVE_NETWORK_UPLOAD_METHOD)?;
    validate_object_string(
        payload.get("body"),
        "body",
        host_protocol::NATIVE_NETWORK_UPLOAD_METHOD,
    )?;
    validate_optional_non_empty(
        &payload,
        "fileName",
        host_protocol::NATIVE_NETWORK_UPLOAD_METHOD,
    )?;
    validate_optional_non_empty(
        &payload,
        "ownerScope",
        host_protocol::NATIVE_NETWORK_UPLOAD_METHOD,
    )?;
    validate_optional_non_empty(
        &payload,
        "traceId",
        host_protocol::NATIVE_NETWORK_UPLOAD_METHOD,
    )?;
    Err(unsupported(host_protocol::NATIVE_NETWORK_UPLOAD_METHOD))
}

pub(crate) fn connect_web_socket(
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = require_payload(
        payload,
        host_protocol::NATIVE_NETWORK_CONNECT_WEB_SOCKET_METHOD,
    )?;
    validate_websocket_url(
        &payload,
        "url",
        host_protocol::NATIVE_NETWORK_CONNECT_WEB_SOCKET_METHOD,
    )?;
    if let Some(protocols) = payload.get("protocols") {
        let Some(protocols) = protocols.as_array() else {
            return Err(HostProtocolError::invalid_argument(
                "protocols",
                "must be an array",
                host_protocol::NATIVE_NETWORK_CONNECT_WEB_SOCKET_METHOD,
            ));
        };
        for (index, protocol) in protocols.iter().enumerate() {
            validate_object_string(
                Some(protocol),
                format!("protocols[{index}]"),
                host_protocol::NATIVE_NETWORK_CONNECT_WEB_SOCKET_METHOD,
            )?;
        }
    }
    validate_optional_non_empty(
        &payload,
        "ownerScope",
        host_protocol::NATIVE_NETWORK_CONNECT_WEB_SOCKET_METHOD,
    )?;
    validate_optional_non_empty(
        &payload,
        "traceId",
        host_protocol::NATIVE_NETWORK_CONNECT_WEB_SOCKET_METHOD,
    )?;
    Err(unsupported(
        host_protocol::NATIVE_NETWORK_CONNECT_WEB_SOCKET_METHOD,
    ))
}

pub(crate) fn close_web_socket(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let payload = require_payload(
        payload,
        host_protocol::NATIVE_NETWORK_CLOSE_WEB_SOCKET_METHOD,
    )?;
    validate_socket_handle(
        &payload,
        host_protocol::NATIVE_NETWORK_CLOSE_WEB_SOCKET_METHOD,
    )?;
    validate_optional_non_empty(
        &payload,
        "traceId",
        host_protocol::NATIVE_NETWORK_CLOSE_WEB_SOCKET_METHOD,
    )?;
    Err(unsupported(
        host_protocol::NATIVE_NETWORK_CLOSE_WEB_SOCKET_METHOD,
    ))
}

pub(crate) fn localhost_url(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let payload = require_payload(payload, host_protocol::NATIVE_NETWORK_LOCALHOST_URL_METHOD)?;
    if !payload
        .get("port")
        .and_then(Value::as_u64)
        .is_some_and(|port| (1..=65_535).contains(&port))
    {
        return Err(HostProtocolError::invalid_argument(
            "port",
            "must be an integer from 1 to 65535",
            host_protocol::NATIVE_NETWORK_LOCALHOST_URL_METHOD,
        ));
    }
    if let Some(path) = payload.get("path").and_then(Value::as_str) {
        if !is_safe_localhost_path(path) {
            return Err(HostProtocolError::invalid_argument(
                "path",
                "must be an absolute path without traversal or whitespace",
                host_protocol::NATIVE_NETWORK_LOCALHOST_URL_METHOD,
            ));
        }
    }
    if payload.get("secure").is_some() && !payload.get("secure").is_some_and(Value::is_boolean) {
        return Err(HostProtocolError::invalid_argument(
            "secure",
            "must be a boolean",
            host_protocol::NATIVE_NETWORK_LOCALHOST_URL_METHOD,
        ));
    }
    validate_optional_non_empty(
        &payload,
        "traceId",
        host_protocol::NATIVE_NETWORK_LOCALHOST_URL_METHOD,
    )?;
    Err(unsupported(
        host_protocol::NATIVE_NETWORK_LOCALHOST_URL_METHOD,
    ))
}

pub(crate) fn is_supported(_payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    serde_json::to_value(NativeNetworkSupportedPayload::unsupported(
        UNSUPPORTED_REASON,
    ))
    .map(Some)
    .map_err(|error| {
        HostProtocolError::internal(
            format!("failed to encode native network support: {error}"),
            host_protocol::NATIVE_NETWORK_IS_SUPPORTED_METHOD,
        )
    })
}

fn require_payload(
    payload: Option<Value>,
    operation: &'static str,
) -> Result<Value, HostProtocolError> {
    payload.ok_or_else(|| HostProtocolError::invalid_argument("payload", "is required", operation))
}

fn validate_http_url(
    payload: &Value,
    field: &'static str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let url = validate_object_string(payload.get(field), field, operation)?;
    if !has_scheme(url, &["http", "https"]) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be an absolute HTTP(S) URL",
            operation,
        ));
    }
    Ok(())
}

fn validate_websocket_url(
    payload: &Value,
    field: &'static str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let url = validate_object_string(payload.get(field), field, operation)?;
    if !has_scheme(url, &["ws", "wss"]) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be an absolute WS(S) URL",
            operation,
        ));
    }
    Ok(())
}

fn validate_http_method<'a>(
    payload: &'a Value,
    operation: &'static str,
) -> Result<&'a str, HostProtocolError> {
    let method = validate_object_string(payload.get("method"), "method", operation)?;
    if !matches!(method, "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD") {
        return Err(HostProtocolError::invalid_argument(
            "method",
            "must be a supported HTTP method",
            operation,
        ));
    }
    Ok(method)
}

fn validate_headers(payload: &Value, operation: &'static str) -> Result<(), HostProtocolError> {
    if let Some(headers) = payload.get("headers") {
        let Some(headers) = headers.as_array() else {
            return Err(HostProtocolError::invalid_argument(
                "headers",
                "must be an array",
                operation,
            ));
        };
        for (index, header) in headers.iter().enumerate() {
            let Some(header) = header.as_object() else {
                return Err(HostProtocolError::invalid_argument(
                    format!("headers[{index}]"),
                    "must be an object",
                    operation,
                ));
            };
            let name = validate_object_string(
                header.get("name"),
                format!("headers[{index}].name"),
                operation,
            )?;
            if !is_header_name(name) {
                return Err(HostProtocolError::invalid_argument(
                    format!("headers[{index}].name"),
                    "must be an HTTP header token",
                    operation,
                ));
            }
            if !header.get("value").is_some_and(Value::is_string) {
                return Err(HostProtocolError::invalid_argument(
                    format!("headers[{index}].value"),
                    "must be a string",
                    operation,
                ));
            }
        }
    }
    Ok(())
}

fn validate_socket_handle(
    payload: &Value,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let socket = payload
        .get("socket")
        .ok_or_else(|| HostProtocolError::invalid_argument("socket", "is required", operation))?;
    let Some(socket) = socket.as_object() else {
        return Err(HostProtocolError::invalid_argument(
            "socket",
            "must be an object",
            operation,
        ));
    };
    if socket.get("kind").and_then(Value::as_str) != Some("native-network-websocket") {
        return Err(HostProtocolError::invalid_argument(
            "socket.kind",
            "must be native-network-websocket",
            operation,
        ));
    }
    validate_object_string(socket.get("id"), "socket.id", operation)?;
    validate_object_string(socket.get("ownerScope"), "socket.ownerScope", operation)?;
    validate_object_string(socket.get("state"), "socket.state", operation)?;
    if socket.get("state").and_then(Value::as_str) != Some("open") {
        return Err(HostProtocolError::invalid_argument(
            "socket.state",
            "must be open",
            operation,
        ));
    }
    if !socket.get("generation").is_some_and(Value::is_u64) {
        return Err(HostProtocolError::invalid_argument(
            "socket.generation",
            "must be an unsigned integer",
            operation,
        ));
    }
    Ok(())
}

fn validate_optional_string(
    payload: &Value,
    field: &'static str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if payload.get(field).is_some() && !payload.get(field).is_some_and(Value::is_string) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be a string",
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

fn has_scheme(value: &str, schemes: &[&str]) -> bool {
    let Some((scheme, rest)) = value.split_once("://") else {
        return false;
    };
    schemes.contains(&scheme) && !rest.is_empty() && !rest.chars().any(char::is_whitespace)
}

fn is_safe_localhost_path(path: &str) -> bool {
    path.starts_with('/')
        && !path.chars().any(char::is_whitespace)
        && !path.split('/').any(|segment| segment == "..")
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
    use super::{close_web_socket, connect_web_socket, fetch, is_supported, localhost_url, upload};
    use serde_json::json;

    #[test]
    fn native_network_methods_validate_then_report_unsupported() {
        for error in [
            fetch(Some(json!({
                "url": "https://example.test/data.json",
                "method": "GET"
            })))
            .expect_err("host adapter is not implemented yet"),
            upload(Some(json!({
                "url": "https://example.test/upload",
                "body": "payload"
            })))
            .expect_err("host adapter is not implemented yet"),
            connect_web_socket(Some(json!({
                "url": "wss://example.test/socket",
                "protocols": ["events"]
            })))
            .expect_err("host adapter is not implemented yet"),
            close_web_socket(Some(json!({
                "socket": socket()
            })))
            .expect_err("host adapter is not implemented yet"),
            localhost_url(Some(json!({
                "port": 3010,
                "path": "/health"
            })))
            .expect_err("host adapter is not implemented yet"),
        ] {
            assert_eq!(error.tag(), "Unsupported");
        }
    }

    #[test]
    fn native_network_methods_reject_invalid_payloads_before_unsupported() {
        let fetch_with_body = fetch(Some(json!({
            "url": "https://example.test/data.json",
            "method": "GET",
            "body": "payload"
        })))
        .expect_err("GET bodies should fail");
        assert_eq!(fetch_with_body.tag(), "InvalidArgument");

        let upload_without_body = upload(Some(json!({
            "url": "https://example.test/upload"
        })))
        .expect_err("upload body is required");
        assert_eq!(upload_without_body.tag(), "InvalidArgument");

        let invalid_socket_url = connect_web_socket(Some(json!({
            "url": "https://example.test/socket"
        })))
        .expect_err("websocket URL requires ws or wss");
        assert_eq!(invalid_socket_url.tag(), "InvalidArgument");

        let invalid_path = localhost_url(Some(json!({
            "port": 3010,
            "path": "/../secret"
        })))
        .expect_err("localhost path rejects traversal");
        assert_eq!(invalid_path.tag(), "InvalidArgument");
    }

    #[test]
    fn native_network_support_reports_unavailable_host_adapter() {
        let response = is_supported(None)
            .expect("support should encode")
            .expect("support should return a payload");

        assert_eq!(
            response,
            json!({
                "supported": false,
                "reason": "host-native-network-unavailable"
            })
        );
    }

    fn socket() -> serde_json::Value {
        json!({
            "kind": "native-network-websocket",
            "id": "native-network-websocket:1",
            "generation": 0,
            "ownerScope": "workspace:1",
            "state": "open"
        })
    }
}
