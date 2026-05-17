#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{
    HostProtocolError, WorkspaceIndexActorPayload, WorkspaceIndexClosePayload,
    WorkspaceIndexRefreshPayload, WorkspaceIndexScopePayload, WorkspaceIndexSupportedPayload,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{to_value, Value};

pub(crate) fn open(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<host_protocol::WorkspaceIndexOpenPayload>(
        payload,
        host_protocol::WORKSPACE_INDEX_OPEN_METHOD,
    )?;
    validate_open(&input, host_protocol::WORKSPACE_INDEX_OPEN_METHOD)?;
    Err(unsupported(host_protocol::WORKSPACE_INDEX_OPEN_METHOD))
}

pub(crate) fn refresh(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<WorkspaceIndexRefreshPayload>(
        payload,
        host_protocol::WORKSPACE_INDEX_REFRESH_METHOD,
    )?;
    validate_refresh(&input, host_protocol::WORKSPACE_INDEX_REFRESH_METHOD)?;
    Err(unsupported(host_protocol::WORKSPACE_INDEX_REFRESH_METHOD))
}

pub(crate) fn close(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<WorkspaceIndexClosePayload>(
        payload,
        host_protocol::WORKSPACE_INDEX_CLOSE_METHOD,
    )?;
    validate_close(&input, host_protocol::WORKSPACE_INDEX_CLOSE_METHOD)?;
    Err(unsupported(host_protocol::WORKSPACE_INDEX_CLOSE_METHOD))
}

pub(crate) fn is_supported() -> Result<Option<Value>, HostProtocolError> {
    encode_payload(
        WorkspaceIndexSupportedPayload::unsupported(
            host_protocol::WORKSPACE_INDEX_UNSUPPORTED_REASON,
        ),
        host_protocol::WORKSPACE_INDEX_IS_SUPPORTED_METHOD,
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
            format!("failed to encode workspace index payload: {error}"),
            operation,
        )
    })
}

fn validate_open(
    input: &host_protocol::WorkspaceIndexOpenPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_actor(input.actor(), operation)?;
    validate_scope(input.scope(), operation)?;
    if let Some(index_id) = input.index_id() {
        validate_non_empty("indexId", index_id, operation)?;
    }
    if let Some(trace_id) = input.trace_id() {
        validate_non_empty("traceId", trace_id, operation)?;
    }
    Ok(())
}

fn validate_refresh(
    input: &WorkspaceIndexRefreshPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_non_empty("indexId", input.index_id(), operation)?;
    for changed_path in input.changed_paths() {
        validate_canonical_absolute_path("changedPaths", changed_path, operation)?;
    }
    if let Some(trace_id) = input.trace_id() {
        validate_non_empty("traceId", trace_id, operation)?;
    }
    Ok(())
}

fn validate_close(
    input: &WorkspaceIndexClosePayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_non_empty("indexId", input.index_id(), operation)?;
    if let Some(trace_id) = input.trace_id() {
        validate_non_empty("traceId", trace_id, operation)?;
    }
    Ok(())
}

fn validate_actor(
    actor: &WorkspaceIndexActorPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_identifier("actor.id", actor.id(), operation)
}

fn validate_scope(
    scope: &WorkspaceIndexScopePayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_canonical_absolute_path("scope.root", scope.root(), operation)?;
    if scope.grants().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "scope.grants",
            "must not be empty",
            operation,
        ));
    }
    if filesystem_read_grants_have_dot_segments(scope.grants()) {
        return Err(HostProtocolError::invalid_argument(
            "scope.grants",
            "filesystem.read roots must not include dot path segments",
            operation,
        ));
    }
    if !scope
        .grants()
        .iter()
        .any(|grant| grant_covers_root(grant, scope.root()))
    {
        return Err(HostProtocolError::invalid_argument(
            "scope.grants",
            "must include filesystem.read for scope.root",
            operation,
        ));
    }
    for rule in scope.ignore_rules() {
        validate_ignore_rule(rule.pattern(), operation)?;
    }
    Ok(())
}

fn grant_covers_root(grant: &Value, root: &str) -> bool {
    if grant.get("kind").and_then(Value::as_str) != Some("filesystem.read") {
        return false;
    }
    let Some(roots) = grant.get("roots").and_then(Value::as_array) else {
        return false;
    };
    roots
        .iter()
        .filter_map(Value::as_str)
        .any(|grant_root| path_contains(grant_root, root))
}

fn filesystem_read_grants_have_dot_segments(grants: &[Value]) -> bool {
    grants.iter().any(|grant| {
        grant.get("kind").and_then(Value::as_str) == Some("filesystem.read")
            && grant
                .get("roots")
                .and_then(Value::as_array)
                .is_some_and(|roots| {
                    roots
                        .iter()
                        .filter_map(Value::as_str)
                        .any(path_has_dot_segment)
                })
    })
}

fn path_contains(parent: &str, child: &str) -> bool {
    if path_has_dot_segment(parent) || path_has_dot_segment(child) {
        return false;
    }
    let parent = trim_trailing_separators(parent);
    let child = trim_trailing_separators(child);
    if parent == "/" {
        return child.starts_with('/');
    }
    child == parent
        || child
            .strip_prefix(parent)
            .is_some_and(|suffix| suffix.starts_with('/') || suffix.starts_with('\\'))
}

fn trim_trailing_separators(value: &str) -> &str {
    if value == "/" {
        return value;
    }
    value.trim_end_matches(['/', '\\'])
}

fn validate_ignore_rule(pattern: &str, operation: &'static str) -> Result<(), HostProtocolError> {
    validate_non_empty("scope.ignoreRules.pattern", pattern, operation)?;
    if is_absolute_path(pattern)
        || pattern.starts_with("../")
        || pattern == ".."
        || pattern.contains("/../")
        || pattern.contains("\\..\\")
        || pattern.contains("://")
    {
        return Err(HostProtocolError::invalid_argument(
            "scope.ignoreRules.pattern",
            "must be a relative ignore pattern",
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
    validate_printable_non_empty(field, value, operation)?;
    if !is_absolute_path(value) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be an absolute path",
            operation,
        ));
    }
    Ok(())
}

fn validate_canonical_absolute_path(
    field: &str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_absolute_path(field, value, operation)?;
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
        || value.starts_with("\\\\")
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
    HostProtocolError::unsupported(host_protocol::WORKSPACE_INDEX_UNSUPPORTED_REASON, operation)
}

#[cfg(test)]
mod tests {
    use super::{close, is_supported, open, refresh};
    use host_protocol::HostProtocolError;
    use serde_json::json;

    #[test]
    fn open_decodes_valid_payload_then_returns_typed_unsupported() {
        let error = open(Some(valid_open_payload())).expect_err("host should be unsupported");

        assert_eq!(
            error,
            HostProtocolError::unsupported(
                host_protocol::WORKSPACE_INDEX_UNSUPPORTED_REASON,
                host_protocol::WORKSPACE_INDEX_OPEN_METHOD,
            )
        );
    }

    #[test]
    fn open_rejects_relative_root_before_unsupported() {
        let mut payload = valid_open_payload();
        payload["scope"]["root"] = json!("workspace/app");
        let error = open(Some(payload)).expect_err("relative root must fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "scope.root",
                "must be an absolute path",
                host_protocol::WORKSPACE_INDEX_OPEN_METHOD,
            )
        );
    }

    #[test]
    fn open_rejects_dot_segment_root_before_unsupported() {
        let mut payload = valid_open_payload();
        payload["scope"]["root"] = json!("/workspace/app/../secret");
        let error = open(Some(payload)).expect_err("dot-segment root must fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "scope.root",
                "must not include dot path segments",
                host_protocol::WORKSPACE_INDEX_OPEN_METHOD,
            )
        );
    }

    #[test]
    fn open_rejects_missing_filesystem_read_grant_before_unsupported() {
        let mut payload = valid_open_payload();
        payload["scope"]["grants"] = json!([
            {
                "kind": "process.spawn",
                "commands": ["/bin/ls"],
                "audit": "always"
            }
        ]);
        let error = open(Some(payload)).expect_err("missing filesystem grant must fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "scope.grants",
                "must include filesystem.read for scope.root",
                host_protocol::WORKSPACE_INDEX_OPEN_METHOD,
            )
        );
    }

    #[test]
    fn open_rejects_dot_segment_grant_root_before_unsupported() {
        let mut payload = valid_open_payload();
        payload["scope"]["grants"][0]["roots"] = json!(["/workspace/app/.."]);
        let error = open(Some(payload)).expect_err("dot-segment grant root must fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "scope.grants",
                "filesystem.read roots must not include dot path segments",
                host_protocol::WORKSPACE_INDEX_OPEN_METHOD,
            )
        );
    }

    #[test]
    fn open_rejects_absolute_ignore_rule_before_unsupported() {
        let mut payload = valid_open_payload();
        payload["scope"]["ignoreRules"][0]["pattern"] = json!("/tmp/**");
        let error = open(Some(payload)).expect_err("absolute ignore rule must fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "scope.ignoreRules.pattern",
                "must be a relative ignore pattern",
                host_protocol::WORKSPACE_INDEX_OPEN_METHOD,
            )
        );
    }

    #[test]
    fn refresh_rejects_empty_index_id_before_unsupported() {
        let error = refresh(Some(json!({
            "indexId": "",
            "changedPaths": ["/workspace/app/src/main.ts"]
        })))
        .expect_err("empty index id must fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "indexId",
                "must be non-empty",
                host_protocol::WORKSPACE_INDEX_REFRESH_METHOD,
            )
        );
    }

    #[test]
    fn refresh_rejects_relative_changed_path_before_unsupported() {
        let error = refresh(Some(json!({
            "indexId": "workspace-index-1",
            "changedPaths": ["src/main.ts"]
        })))
        .expect_err("relative changed path must fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "changedPaths",
                "must be an absolute path",
                host_protocol::WORKSPACE_INDEX_REFRESH_METHOD,
            )
        );
    }

    #[test]
    fn refresh_rejects_dot_segment_changed_path_before_unsupported() {
        let error = refresh(Some(json!({
            "indexId": "workspace-index-1",
            "changedPaths": ["/workspace/app/../secret.ts"]
        })))
        .expect_err("dot-segment changed path must fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "changedPaths",
                "must not include dot path segments",
                host_protocol::WORKSPACE_INDEX_REFRESH_METHOD,
            )
        );
    }

    #[test]
    fn close_decodes_valid_payload_then_returns_typed_unsupported() {
        let error = close(Some(json!({ "indexId": "workspace-index-1" })))
            .expect_err("host should be unsupported");

        assert_eq!(
            error,
            HostProtocolError::unsupported(
                host_protocol::WORKSPACE_INDEX_UNSUPPORTED_REASON,
                host_protocol::WORKSPACE_INDEX_CLOSE_METHOD,
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
                "reason": host_protocol::WORKSPACE_INDEX_UNSUPPORTED_REASON
            }))
        );
    }

    fn valid_open_payload() -> serde_json::Value {
        json!({
            "actor": { "kind": "workspace", "id": "workspace-1" },
            "scope": {
                "root": "/workspace/app",
                "ignoreRules": [
                    { "pattern": "node_modules/**", "reason": "dependencies" }
                ],
                "grants": [
                    {
                        "kind": "filesystem.read",
                        "roots": ["/workspace"],
                        "audit": "always"
                    }
                ],
                "watch": true
            },
            "indexId": "workspace-index-1",
            "traceId": "trace-workspace-index"
        })
    }
}
