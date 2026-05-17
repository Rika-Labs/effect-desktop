#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{
    HostProtocolError, ScopedAccessGrantActorPayload, ScopedAccessGrantGrantPayload,
    ScopedAccessGrantResolvePayload, ScopedAccessGrantRevokePayload,
    ScopedAccessGrantSupportedPayload,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{to_value, Value};

const WINDOWS_ABSOLUTE_PREFIX_INDEX: usize = 2;

pub(crate) fn grant(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<ScopedAccessGrantGrantPayload>(
        payload,
        host_protocol::SCOPED_ACCESS_GRANT_GRANT_METHOD,
    )?;
    validate_grant(&input, host_protocol::SCOPED_ACCESS_GRANT_GRANT_METHOD)?;
    Err(unsupported(host_protocol::SCOPED_ACCESS_GRANT_GRANT_METHOD))
}

pub(crate) fn resolve(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<ScopedAccessGrantResolvePayload>(
        payload,
        host_protocol::SCOPED_ACCESS_GRANT_RESOLVE_METHOD,
    )?;
    validate_resolve(&input, host_protocol::SCOPED_ACCESS_GRANT_RESOLVE_METHOD)?;
    Err(unsupported(
        host_protocol::SCOPED_ACCESS_GRANT_RESOLVE_METHOD,
    ))
}

pub(crate) fn revoke(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<ScopedAccessGrantRevokePayload>(
        payload,
        host_protocol::SCOPED_ACCESS_GRANT_REVOKE_METHOD,
    )?;
    validate_revoke(&input, host_protocol::SCOPED_ACCESS_GRANT_REVOKE_METHOD)?;
    Err(unsupported(
        host_protocol::SCOPED_ACCESS_GRANT_REVOKE_METHOD,
    ))
}

pub(crate) fn is_supported() -> Result<Option<Value>, HostProtocolError> {
    encode_payload(
        ScopedAccessGrantSupportedPayload::unsupported(
            host_protocol::SCOPED_ACCESS_GRANT_UNSUPPORTED_REASON,
        ),
        host_protocol::SCOPED_ACCESS_GRANT_IS_SUPPORTED_METHOD,
    )
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

fn encode_payload<T: Serialize>(
    payload: T,
    operation: &'static str,
) -> Result<Option<Value>, HostProtocolError> {
    to_value(payload).map(Some).map_err(|error| {
        HostProtocolError::internal(
            format!("failed to encode scoped access grant payload: {error}"),
            operation,
        )
    })
}

fn validate_grant(
    input: &ScopedAccessGrantGrantPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_actor(input.actor(), operation)?;
    validate_printable_non_empty("scope.path", input.scope().path(), operation)?;
    validate_absolute_path("scope.path", input.scope().path(), operation)?;
    validate_no_dot_segments("scope.path", input.scope().path(), operation)?;
    if let Some(grant_id) = input.grant_id() {
        validate_non_empty("grantId", grant_id, operation)?;
    }
    if let Some(trace_id) = input.trace_id() {
        validate_non_empty("traceId", trace_id, operation)?;
    }
    Ok(())
}

fn validate_resolve(
    input: &ScopedAccessGrantResolvePayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_non_empty("grantId", input.grant_id(), operation)?;
    if let Some(trace_id) = input.trace_id() {
        validate_non_empty("traceId", trace_id, operation)?;
    }
    Ok(())
}

fn validate_revoke(
    input: &ScopedAccessGrantRevokePayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_non_empty("grantId", input.grant_id(), operation)?;
    if let Some(trace_id) = input.trace_id() {
        validate_non_empty("traceId", trace_id, operation)?;
    }
    Ok(())
}

fn validate_actor(
    actor: &ScopedAccessGrantActorPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_printable_non_empty("actor.id", actor.id(), operation)
}

fn validate_non_empty(
    field: &str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_no_nul(field, value, operation)?;
    if value.trim().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be non-empty",
            operation,
        ));
    }
    Ok(())
}

fn validate_printable_non_empty(
    field: &str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_non_empty(field, value, operation)?;
    if value.chars().any(char::is_control) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not include control characters",
            operation,
        ));
    }
    Ok(())
}

fn validate_no_nul(
    field: &str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if value.contains('\0') {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not contain NUL",
            operation,
        ));
    }
    Ok(())
}

fn validate_absolute_path(
    field: &str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if value.starts_with('/') || value.starts_with("\\\\") || has_windows_absolute_prefix(value) {
        return Ok(());
    }
    Err(HostProtocolError::invalid_argument(
        field,
        "must be an absolute path",
        operation,
    ))
}

fn validate_no_dot_segments(
    field: &str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if value
        .replace('\\', "/")
        .split('/')
        .any(|segment| segment == "." || segment == "..")
    {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not include dot path segments",
            operation,
        ));
    }
    Ok(())
}

fn has_windows_absolute_prefix(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() > WINDOWS_ABSOLUTE_PREFIX_INDEX
        && bytes[1] == b':'
        && bytes[2].is_ascii()
        && (bytes[2] == b'\\' || bytes[2] == b'/')
        && bytes[0].is_ascii_alphabetic()
}

fn unsupported(operation: &'static str) -> HostProtocolError {
    HostProtocolError::unsupported(
        host_protocol::SCOPED_ACCESS_GRANT_UNSUPPORTED_REASON,
        operation,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use host_protocol::HostProtocolError;
    use serde_json::json;

    #[test]
    fn grant_validates_before_returning_unsupported() {
        let valid = json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "scope": { "path": "/workspace/app", "kind": "directory", "access": "read-write" },
            "grantId": "grant-1",
            "traceId": "trace-1"
        });

        let error = grant(Some(valid)).expect_err("host adapter is not implemented");

        assert!(matches!(error, HostProtocolError::Unsupported { .. }));
    }

    #[test]
    fn grant_rejects_control_byte_path_before_unsupported() {
        let invalid = json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "scope": { "path": "/workspace/\napp", "kind": "directory", "access": "read" }
        });

        let error = grant(Some(invalid)).expect_err("invalid input should fail");

        assert!(matches!(error, HostProtocolError::InvalidArgument { .. }));
    }

    #[test]
    fn grant_rejects_relative_and_dot_segment_paths_before_unsupported() {
        for path in ["relative/path", "/workspace/../app"] {
            let invalid = json!({
                "actor": { "kind": "workspace", "id": "workspace-1" },
                "scope": { "path": path, "kind": "directory", "access": "read" }
            });

            let error = grant(Some(invalid)).expect_err("invalid input should fail");

            assert!(matches!(error, HostProtocolError::InvalidArgument { .. }));
        }
    }

    #[test]
    fn is_supported_reports_unimplemented_adapter() {
        let payload = is_supported()
            .expect("support query should encode")
            .expect("support query returns payload");

        assert_eq!(
            payload,
            json!({
                "supported": false,
                "reason": host_protocol::SCOPED_ACCESS_GRANT_UNSUPPORTED_REASON
            })
        );
    }
}
