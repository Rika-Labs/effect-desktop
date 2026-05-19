#![allow(clippy::result_large_err)]
// Host method boundaries return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{HostProtocolError, NetworkAuthSupportedPayload};
use serde_json::Value;

const UNSUPPORTED_REASON: &str = "host-network-auth-unavailable";

pub(crate) fn set_proxy(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let payload = require_payload(payload, host_protocol::NETWORK_AUTH_SET_PROXY_METHOD)?;
    validate_profile_handle(&payload, host_protocol::NETWORK_AUTH_SET_PROXY_METHOD)?;
    validate_proxy(&payload, host_protocol::NETWORK_AUTH_SET_PROXY_METHOD)?;
    validate_optional_non_empty(
        &payload,
        "traceId",
        host_protocol::NETWORK_AUTH_SET_PROXY_METHOD,
    )?;
    Err(unsupported(host_protocol::NETWORK_AUTH_SET_PROXY_METHOD))
}

pub(crate) fn handle_auth(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let payload = require_payload(payload, host_protocol::NETWORK_AUTH_HANDLE_AUTH_METHOD)?;
    validate_profile_handle(&payload, host_protocol::NETWORK_AUTH_HANDLE_AUTH_METHOD)?;
    validate_non_empty(
        &payload,
        "requestId",
        host_protocol::NETWORK_AUTH_HANDLE_AUTH_METHOD,
    )?;
    validate_origin(&payload, host_protocol::NETWORK_AUTH_HANDLE_AUTH_METHOD)?;
    validate_decision(&payload, host_protocol::NETWORK_AUTH_HANDLE_AUTH_METHOD)?;
    validate_auth_credentials(&payload, host_protocol::NETWORK_AUTH_HANDLE_AUTH_METHOD)?;
    validate_optional_non_empty(
        &payload,
        "traceId",
        host_protocol::NETWORK_AUTH_HANDLE_AUTH_METHOD,
    )?;
    Err(unsupported(host_protocol::NETWORK_AUTH_HANDLE_AUTH_METHOD))
}

pub(crate) fn handle_certificate(
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let payload = require_payload(
        payload,
        host_protocol::NETWORK_AUTH_HANDLE_CERTIFICATE_METHOD,
    )?;
    validate_profile_handle(
        &payload,
        host_protocol::NETWORK_AUTH_HANDLE_CERTIFICATE_METHOD,
    )?;
    validate_non_empty(
        &payload,
        "requestId",
        host_protocol::NETWORK_AUTH_HANDLE_CERTIFICATE_METHOD,
    )?;
    validate_origin(
        &payload,
        host_protocol::NETWORK_AUTH_HANDLE_CERTIFICATE_METHOD,
    )?;
    validate_fingerprint(
        &payload,
        host_protocol::NETWORK_AUTH_HANDLE_CERTIFICATE_METHOD,
    )?;
    validate_decision(
        &payload,
        host_protocol::NETWORK_AUTH_HANDLE_CERTIFICATE_METHOD,
    )?;
    validate_optional_non_empty(
        &payload,
        "traceId",
        host_protocol::NETWORK_AUTH_HANDLE_CERTIFICATE_METHOD,
    )?;
    Err(unsupported(
        host_protocol::NETWORK_AUTH_HANDLE_CERTIFICATE_METHOD,
    ))
}

pub(crate) fn is_supported(_payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    serde_json::to_value(NetworkAuthSupportedPayload::unsupported(UNSUPPORTED_REASON))
        .map(Some)
        .map_err(|error| {
            HostProtocolError::internal(
                format!("failed to encode network auth support: {error}"),
                host_protocol::NETWORK_AUTH_IS_SUPPORTED_METHOD,
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

fn validate_proxy(payload: &Value, operation: &'static str) -> Result<(), HostProtocolError> {
    let mode = validate_object_string(payload.get("mode"), "mode", operation)?;
    if !matches!(mode, "direct" | "system" | "fixed") {
        return Err(HostProtocolError::invalid_argument(
            "mode",
            "must be direct, system, or fixed",
            operation,
        ));
    }
    let server = payload.get("server").and_then(Value::as_str);
    if mode == "fixed" && server.is_none() {
        return Err(HostProtocolError::invalid_argument(
            "server",
            "is required for fixed proxy",
            operation,
        ));
    }
    if mode != "fixed" && payload.get("server").is_some() {
        return Err(HostProtocolError::invalid_argument(
            "server",
            "is only valid for fixed proxy",
            operation,
        ));
    }
    if let Some(server) = server {
        if !is_proxy_server(server) {
            return Err(HostProtocolError::invalid_argument(
                "server",
                "must be an http, https, or socks5 proxy origin",
                operation,
            ));
        }
    }
    if let Some(bypass) = payload.get("bypass") {
        let Some(bypass) = bypass.as_array() else {
            return Err(HostProtocolError::invalid_argument(
                "bypass",
                "must be an array",
                operation,
            ));
        };
        for (index, value) in bypass.iter().enumerate() {
            validate_object_string(Some(value), format!("bypass[{index}]"), operation)?;
        }
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

fn validate_decision(payload: &Value, operation: &'static str) -> Result<(), HostProtocolError> {
    match payload.get("decision").and_then(Value::as_str) {
        Some("allow" | "deny") => Ok(()),
        Some(_) | None => Err(HostProtocolError::invalid_argument(
            "decision",
            "must be allow or deny",
            operation,
        )),
    }
}

fn validate_auth_credentials(
    payload: &Value,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let decision = payload.get("decision").and_then(Value::as_str);
    let has_username = payload.get("username").is_some();
    let has_password = payload.get("password").is_some();
    if decision == Some("allow") && !(has_username && has_password) {
        return Err(HostProtocolError::invalid_argument(
            "credentials",
            "are required when allowing HTTP auth",
            operation,
        ));
    }
    if decision == Some("deny") && (has_username || has_password) {
        return Err(HostProtocolError::invalid_argument(
            "credentials",
            "must be omitted when denying HTTP auth",
            operation,
        ));
    }
    if has_username {
        validate_non_empty(payload, "username", operation)?;
    }
    if payload.get("password").is_some() && !payload.get("password").is_some_and(Value::is_string) {
        return Err(HostProtocolError::invalid_argument(
            "password",
            "must be a string",
            operation,
        ));
    }
    Ok(())
}

fn validate_fingerprint(payload: &Value, operation: &'static str) -> Result<(), HostProtocolError> {
    let fingerprint = validate_object_string(
        payload.get("fingerprintSha256"),
        "fingerprintSha256",
        operation,
    )?;
    let Some(hex) = fingerprint.strip_prefix("sha256:") else {
        return Err(HostProtocolError::invalid_argument(
            "fingerprintSha256",
            "must start with sha256:",
            operation,
        ));
    };
    if hex.len() != 64 || !hex.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return Err(HostProtocolError::invalid_argument(
            "fingerprintSha256",
            "must contain 64 hex characters after sha256:",
            operation,
        ));
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

fn is_proxy_server(server: &str) -> bool {
    let Some((scheme, rest)) = server.split_once("://") else {
        return false;
    };
    matches!(scheme, "http" | "https" | "socks5")
        && !rest.is_empty()
        && !rest.contains('/')
        && !rest.contains('?')
        && !rest.contains('#')
        && !rest.chars().any(char::is_whitespace)
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
    use super::{handle_auth, handle_certificate, is_supported, set_proxy};
    use serde_json::json;

    #[test]
    fn network_auth_methods_validate_then_report_unsupported() {
        for error in [
            set_proxy(Some(json!({
                "profile": profile(),
                "mode": "fixed",
                "server": "http://proxy.example.test:8080"
            })))
            .expect_err("host adapter is not implemented yet"),
            handle_auth(Some(json!({
                "profile": profile(),
                "requestId": "auth-request-1",
                "origin": "https://example.test",
                "decision": "allow",
                "username": "user",
                "password": "secret"
            })))
            .expect_err("host adapter is not implemented yet"),
            handle_certificate(Some(json!({
                "profile": profile(),
                "requestId": "cert-request-1",
                "origin": "https://example.test",
                "fingerprintSha256": fingerprint(),
                "decision": "allow"
            })))
            .expect_err("host adapter is not implemented yet"),
        ] {
            assert_eq!(error.tag(), "Unsupported");
        }
    }

    #[test]
    fn network_auth_methods_reject_invalid_payloads_before_unsupported() {
        let missing_proxy = set_proxy(Some(json!({
            "profile": profile(),
            "mode": "fixed"
        })))
        .expect_err("fixed proxy requires a server");
        assert_eq!(missing_proxy.tag(), "InvalidArgument");

        let auth_without_credentials = handle_auth(Some(json!({
            "profile": profile(),
            "requestId": "auth-request-1",
            "origin": "https://example.test",
            "decision": "allow"
        })))
        .expect_err("allow requires credentials");
        assert_eq!(auth_without_credentials.tag(), "InvalidArgument");

        let invalid_certificate = handle_certificate(Some(json!({
            "profile": profile(),
            "requestId": "cert-request-1",
            "origin": "https://example.test",
            "fingerprintSha256": "sha256:nothex",
            "decision": "deny"
        })))
        .expect_err("invalid fingerprint should fail");
        assert_eq!(invalid_certificate.tag(), "InvalidArgument");
    }

    #[test]
    fn network_auth_support_reports_unavailable_host_adapter() {
        let response = is_supported(None)
            .expect("support should encode")
            .expect("support should return a payload");

        assert_eq!(
            response,
            json!({
                "supported": false,
                "reason": "host-network-auth-unavailable"
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

    fn fingerprint() -> &'static str {
        "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    }
}
