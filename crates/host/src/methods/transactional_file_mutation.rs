#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{
    HostProtocolError, TransactionalFileMutationActorPayload,
    TransactionalFileMutationCommitPayload, TransactionalFileMutationPreparePayload,
    TransactionalFileMutationRollbackPayload, TransactionalFileMutationSupportedPayload,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{to_value, Value};

pub(crate) fn prepare(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<TransactionalFileMutationPreparePayload>(
        payload,
        host_protocol::TRANSACTIONAL_FILE_MUTATION_PREPARE_METHOD,
    )?;
    validate_prepare(
        &input,
        host_protocol::TRANSACTIONAL_FILE_MUTATION_PREPARE_METHOD,
    )?;
    Err(unsupported(
        host_protocol::TRANSACTIONAL_FILE_MUTATION_PREPARE_METHOD,
    ))
}

pub(crate) fn commit(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<TransactionalFileMutationCommitPayload>(
        payload,
        host_protocol::TRANSACTIONAL_FILE_MUTATION_COMMIT_METHOD,
    )?;
    validate_commit(
        &input,
        host_protocol::TRANSACTIONAL_FILE_MUTATION_COMMIT_METHOD,
    )?;
    Err(unsupported(
        host_protocol::TRANSACTIONAL_FILE_MUTATION_COMMIT_METHOD,
    ))
}

pub(crate) fn rollback(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<TransactionalFileMutationRollbackPayload>(
        payload,
        host_protocol::TRANSACTIONAL_FILE_MUTATION_ROLLBACK_METHOD,
    )?;
    validate_rollback(
        &input,
        host_protocol::TRANSACTIONAL_FILE_MUTATION_ROLLBACK_METHOD,
    )?;
    Err(unsupported(
        host_protocol::TRANSACTIONAL_FILE_MUTATION_ROLLBACK_METHOD,
    ))
}

pub(crate) fn is_supported() -> Result<Option<Value>, HostProtocolError> {
    encode_payload(
        TransactionalFileMutationSupportedPayload::unsupported(
            host_protocol::TRANSACTIONAL_FILE_MUTATION_UNSUPPORTED_REASON,
        ),
        host_protocol::TRANSACTIONAL_FILE_MUTATION_IS_SUPPORTED_METHOD,
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
            format!("failed to encode transactional file mutation payload: {error}"),
            operation,
        )
    })
}

fn validate_prepare(
    input: &TransactionalFileMutationPreparePayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_actor(input.actor(), operation)?;
    validate_canonical_absolute_path("path", input.path(), operation)?;
    if let Some(expected_source_hash) = input.expected_source_hash() {
        validate_non_empty("expectedSourceHash", expected_source_hash, operation)?;
    }
    if let Some(mutation_id) = input.mutation_id() {
        validate_non_empty("mutationId", mutation_id, operation)?;
    }
    if let Some(trace_id) = input.trace_id() {
        validate_non_empty("traceId", trace_id, operation)?;
    }
    Ok(())
}

fn validate_commit(
    input: &TransactionalFileMutationCommitPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_actor(input.actor(), operation)?;
    validate_non_empty("mutationId", input.mutation_id(), operation)?;
    if let Some(expected_source_hash) = input.expected_source_hash() {
        validate_non_empty("expectedSourceHash", expected_source_hash, operation)?;
    }
    if let Some(trace_id) = input.trace_id() {
        validate_non_empty("traceId", trace_id, operation)?;
    }
    Ok(())
}

fn validate_rollback(
    input: &TransactionalFileMutationRollbackPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_actor(input.actor(), operation)?;
    validate_non_empty("mutationId", input.mutation_id(), operation)?;
    if let Some(trace_id) = input.trace_id() {
        validate_non_empty("traceId", trace_id, operation)?;
    }
    Ok(())
}

fn validate_actor(
    actor: &TransactionalFileMutationActorPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_identifier("actor.id", actor.id(), operation)
}

fn validate_canonical_absolute_path(
    field: &str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_printable_non_empty(field, value, operation)?;
    if !is_absolute_path(value) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be an absolute path",
            operation,
        ));
    }
    if path_has_dot_segment(value) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not include dot path segments",
            operation,
        ));
    }
    Ok(())
}

fn is_absolute_path(value: &str) -> bool {
    value.starts_with('/')
        || (value.len() >= 3
            && value.as_bytes()[1] == b':'
            && matches!(value.as_bytes()[2], b'/' | b'\\')
            && value.as_bytes()[0].is_ascii_alphabetic())
}

fn path_has_dot_segment(value: &str) -> bool {
    value
        .split(['/', '\\'])
        .any(|segment| matches!(segment, "." | ".."))
}

fn validate_identifier(
    field: &str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_non_empty(field, value, operation)?;
    if !value
        .chars()
        .all(|value| value.is_ascii_alphanumeric() || matches!(value, '.' | '_' | '-'))
    {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must contain only letters, numbers, dot, underscore, or dash",
            operation,
        ));
    }
    Ok(())
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

fn unsupported(operation: &'static str) -> HostProtocolError {
    HostProtocolError::unsupported(
        host_protocol::TRANSACTIONAL_FILE_MUTATION_UNSUPPORTED_REASON,
        operation,
    )
}

#[cfg(test)]
mod tests {
    use super::{commit, is_supported, prepare, rollback};
    use host_protocol::HostProtocolError;
    use serde_json::json;

    #[test]
    fn prepare_decodes_valid_payload_then_returns_typed_unsupported() {
        let error = prepare(Some(valid_prepare_payload())).expect_err("host should be unsupported");

        assert_eq!(
            error,
            HostProtocolError::unsupported(
                host_protocol::TRANSACTIONAL_FILE_MUTATION_UNSUPPORTED_REASON,
                host_protocol::TRANSACTIONAL_FILE_MUTATION_PREPARE_METHOD,
            )
        );
    }

    #[test]
    fn prepare_rejects_relative_path_before_unsupported() {
        let mut payload = valid_prepare_payload();
        payload["path"] = json!("workspace/app/src/main.ts");
        let error = prepare(Some(payload)).expect_err("relative path must fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "path",
                "must be an absolute path",
                host_protocol::TRANSACTIONAL_FILE_MUTATION_PREPARE_METHOD,
            )
        );
    }

    #[test]
    fn prepare_rejects_dot_segment_path_before_unsupported() {
        let mut payload = valid_prepare_payload();
        payload["path"] = json!("/workspace/app/../secret.ts");
        let error = prepare(Some(payload)).expect_err("dot-segment path must fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "path",
                "must not include dot path segments",
                host_protocol::TRANSACTIONAL_FILE_MUTATION_PREPARE_METHOD,
            )
        );
    }

    #[test]
    fn prepare_rejects_unc_path_before_unsupported() {
        let mut payload = valid_prepare_payload();
        payload["path"] = json!("\\\\server\\share\\file.txt");
        let error = prepare(Some(payload)).expect_err("unc path must fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "path",
                "must be an absolute path",
                host_protocol::TRANSACTIONAL_FILE_MUTATION_PREPARE_METHOD,
            )
        );
    }

    #[test]
    fn prepare_rejects_invalid_actor_before_unsupported() {
        let mut payload = valid_prepare_payload();
        payload["actor"]["id"] = json!("workspace/1");
        let error = prepare(Some(payload)).expect_err("invalid actor id must fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "actor.id",
                "must contain only letters, numbers, dot, underscore, or dash",
                host_protocol::TRANSACTIONAL_FILE_MUTATION_PREPARE_METHOD,
            )
        );
    }

    #[test]
    fn commit_rejects_empty_mutation_id_before_unsupported() {
        let error = commit(Some(json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "mutationId": ""
        })))
        .expect_err("empty mutation id must fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "mutationId",
                "must be non-empty",
                host_protocol::TRANSACTIONAL_FILE_MUTATION_COMMIT_METHOD,
            )
        );
    }

    #[test]
    fn rollback_decodes_valid_payload_then_returns_typed_unsupported() {
        let error = rollback(Some(json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "mutationId": "file-mutation-1",
            "traceId": "trace-rollback"
        })))
        .expect_err("host should be unsupported");

        assert_eq!(
            error,
            HostProtocolError::unsupported(
                host_protocol::TRANSACTIONAL_FILE_MUTATION_UNSUPPORTED_REASON,
                host_protocol::TRANSACTIONAL_FILE_MUTATION_ROLLBACK_METHOD,
            )
        );
    }

    #[test]
    fn is_supported_returns_typed_unsupported_status() {
        let payload = is_supported().expect("support payload should encode");

        assert_eq!(
            payload,
            Some(json!({
                "supported": false,
                "reason": host_protocol::TRANSACTIONAL_FILE_MUTATION_UNSUPPORTED_REASON
            }))
        );
    }

    fn valid_prepare_payload() -> serde_json::Value {
        json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "path": "/workspace/app/src/main.ts",
            "replacementBytes": [110, 101, 120, 116, 10],
            "expectedSourceHash": "fnv1a-source",
            "mutationId": "file-mutation-1",
            "traceId": "trace-prepare"
        })
    }
}
