#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{
    ExecutionSandboxActorPayload, ExecutionSandboxCreatePayload, ExecutionSandboxDestroyPayload,
    ExecutionSandboxRunPayload, ExecutionSandboxSupportedPayload, HostProtocolError,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{to_value, Value};

pub(crate) fn create(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<ExecutionSandboxCreatePayload>(
        payload,
        host_protocol::EXECUTION_SANDBOX_CREATE_METHOD,
    )?;
    validate_create(&input, host_protocol::EXECUTION_SANDBOX_CREATE_METHOD)?;
    Err(unsupported(host_protocol::EXECUTION_SANDBOX_CREATE_METHOD))
}

pub(crate) fn run(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<ExecutionSandboxRunPayload>(
        payload,
        host_protocol::EXECUTION_SANDBOX_RUN_METHOD,
    )?;
    validate_run(&input, host_protocol::EXECUTION_SANDBOX_RUN_METHOD)?;
    Err(unsupported(host_protocol::EXECUTION_SANDBOX_RUN_METHOD))
}

pub(crate) fn destroy(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<ExecutionSandboxDestroyPayload>(
        payload,
        host_protocol::EXECUTION_SANDBOX_DESTROY_METHOD,
    )?;
    validate_destroy(&input, host_protocol::EXECUTION_SANDBOX_DESTROY_METHOD)?;
    Err(unsupported(host_protocol::EXECUTION_SANDBOX_DESTROY_METHOD))
}

pub(crate) fn is_supported() -> Result<Option<Value>, HostProtocolError> {
    encode_payload(
        ExecutionSandboxSupportedPayload::unsupported(
            host_protocol::EXECUTION_SANDBOX_UNSUPPORTED_REASON,
        ),
        host_protocol::EXECUTION_SANDBOX_IS_SUPPORTED_METHOD,
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
            format!("failed to encode execution sandbox payload: {error}"),
            operation,
        )
    })
}

fn validate_create(
    input: &ExecutionSandboxCreatePayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_actor(input.actor(), operation)?;
    validate_sandbox_path("policy.cwd", input.policy().cwd(), operation)?;
    if let Some(sandbox_id) = input.sandbox_id() {
        validate_non_empty("sandboxId", sandbox_id, operation)?;
    }
    if let Some(trace_id) = input.trace_id() {
        validate_non_empty("traceId", trace_id, operation)?;
    }
    for entry in input.policy().environment() {
        validate_printable_non_empty("policy.environment.name", entry.name(), operation)?;
        validate_no_nul("policy.environment.value", entry.value(), operation)?;
    }
    for root in input.policy().filesystem().read_roots() {
        validate_sandbox_path("policy.filesystem.readRoots", root, operation)?;
    }
    for root in input.policy().filesystem().write_roots() {
        validate_sandbox_path("policy.filesystem.writeRoots", root, operation)?;
    }
    for host in input.policy().network().hosts() {
        validate_printable_non_empty("policy.network.hosts", host, operation)?;
    }
    validate_budget(
        "policy.budgets.cpuMillis",
        input.policy().budgets().cpu_millis(),
        operation,
    )?;
    validate_budget(
        "policy.budgets.memoryBytes",
        input.policy().budgets().memory_bytes(),
        operation,
    )?;
    validate_budget(
        "policy.budgets.wallClockMillis",
        input.policy().budgets().wall_clock_millis(),
        operation,
    )?;
    validate_budget(
        "policy.budgets.stdoutBytes",
        input.policy().budgets().stdout_bytes(),
        operation,
    )?;
    validate_budget(
        "policy.budgets.stderrBytes",
        input.policy().budgets().stderr_bytes(),
        operation,
    )?;
    Ok(())
}

fn validate_run(
    input: &ExecutionSandboxRunPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_non_empty("sandboxId", input.sandbox_id(), operation)?;
    validate_printable_non_empty("command", input.command(), operation)?;
    validate_no_shell_metacharacter("command", input.command(), operation)?;
    for arg in input.args() {
        validate_no_nul("args", arg, operation)?;
    }
    if let Some(run_id) = input.run_id() {
        validate_non_empty("runId", run_id, operation)?;
    }
    if let Some(trace_id) = input.trace_id() {
        validate_non_empty("traceId", trace_id, operation)?;
    }
    Ok(())
}

fn validate_destroy(
    input: &ExecutionSandboxDestroyPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_non_empty("sandboxId", input.sandbox_id(), operation)?;
    if let Some(trace_id) = input.trace_id() {
        validate_non_empty("traceId", trace_id, operation)?;
    }
    Ok(())
}

fn validate_actor(
    actor: &ExecutionSandboxActorPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_printable_non_empty("actor.id", actor.id(), operation)
}

fn validate_budget(
    field: &str,
    value: u64,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if value == 0 {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be greater than zero",
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

fn validate_no_shell_metacharacter(
    field: &str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if value.contains("$(") || value.chars().any(is_shell_metacharacter) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "contains shell metacharacters",
            operation,
        ));
    }
    Ok(())
}

fn is_shell_metacharacter(value: char) -> bool {
    matches!(value, ';' | '|' | '&' | '>' | '<' | '`' | '\n')
}

fn validate_sandbox_path(
    field: &str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_printable_non_empty(field, value, operation)?;
    if !is_safe_absolute_path(value) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be an absolute path without dot segments",
            operation,
        ));
    }
    Ok(())
}

fn is_safe_absolute_path(value: &str) -> bool {
    if value.starts_with('/') {
        return !has_dot_segment(value.split('/'));
    }

    if is_windows_drive_absolute_path(value) || is_windows_unc_absolute_path(value) {
        return !has_dot_segment(value.split(['/', '\\']));
    }

    false
}

fn is_windows_drive_absolute_path(value: &str) -> bool {
    let mut chars = value.chars();
    matches!(
        (chars.next(), chars.next(), chars.next()),
        (Some(letter), Some(':'), Some('/') | Some('\\')) if letter.is_ascii_alphabetic()
    )
}

fn is_windows_unc_absolute_path(value: &str) -> bool {
    let Some(rest) = value.strip_prefix("\\\\") else {
        return false;
    };
    let mut parts = rest.split(['/', '\\']).filter(|part| !part.is_empty());
    parts.next().is_some() && parts.next().is_some()
}

fn has_dot_segment<'a>(segments: impl Iterator<Item = &'a str>) -> bool {
    segments
        .into_iter()
        .any(|segment| segment == "." || segment == "..")
}

fn unsupported(operation: &'static str) -> HostProtocolError {
    HostProtocolError::unsupported(
        host_protocol::EXECUTION_SANDBOX_UNSUPPORTED_REASON,
        operation,
    )
}

#[cfg(test)]
mod tests {
    use super::{create, destroy, is_supported, run};
    use host_protocol::HostProtocolError;
    use serde_json::json;

    #[test]
    fn create_decodes_valid_payload_then_returns_typed_unsupported() {
        let error = create(Some(valid_create_payload())).expect_err("host should be unsupported");

        assert_eq!(
            error,
            HostProtocolError::unsupported(
                host_protocol::EXECUTION_SANDBOX_UNSUPPORTED_REASON,
                host_protocol::EXECUTION_SANDBOX_CREATE_METHOD
            )
        );
    }

    #[test]
    fn create_rejects_invalid_payload_before_unsupported() {
        let error = create(Some(json!({
            "actor": { "kind": "extension", "id": "extension-1" },
            "policy": {
                "cwd": "/tmp/app",
                "budgets": {
                    "cpuMillis": 0,
                    "memoryBytes": 67108864,
                    "wallClockMillis": 1000,
                    "stdoutBytes": 1024,
                    "stderrBytes": 1024
                },
                "cleanup": {
                    "killProcessTree": true,
                    "removeWorkingDirectory": true
                }
            }
        })))
        .expect_err("invalid payload should fail before unsupported");

        assert!(
            matches!(error, HostProtocolError::InvalidArgument { field, .. } if field == "policy.budgets.cpuMillis")
        );
    }

    #[test]
    fn create_rejects_relative_cwd_before_unsupported() {
        let mut payload = valid_create_payload();
        payload["policy"]["cwd"] = json!("tmp/app");

        let error = create(Some(payload)).expect_err("relative cwd should fail before unsupported");

        assert!(
            matches!(error, HostProtocolError::InvalidArgument { field, .. } if field == "policy.cwd")
        );
    }

    #[test]
    fn create_rejects_traversing_filesystem_root_before_unsupported() {
        let mut payload = valid_create_payload();
        payload["policy"]["filesystem"]["readRoots"] = json!(["/tmp/../secret"]);

        let error =
            create(Some(payload)).expect_err("traversing root should fail before unsupported");

        assert!(
            matches!(error, HostProtocolError::InvalidArgument { field, .. } if field == "policy.filesystem.readRoots")
        );
    }

    #[test]
    fn run_rejects_empty_command_before_unsupported() {
        let error = run(Some(json!({
            "sandboxId": "sandbox-1",
            "command": ""
        })))
        .expect_err("invalid payload should fail before unsupported");

        assert!(
            matches!(error, HostProtocolError::InvalidArgument { field, .. } if field == "command")
        );
    }

    #[test]
    fn run_decodes_valid_payload_then_returns_typed_unsupported() {
        let error = run(Some(json!({
            "sandboxId": "sandbox-1",
            "command": "/usr/bin/node",
            "args": ["--version"],
            "runId": "run-1",
            "traceId": "trace-run"
        })))
        .expect_err("host should be unsupported");

        assert_eq!(
            error,
            HostProtocolError::unsupported(
                host_protocol::EXECUTION_SANDBOX_UNSUPPORTED_REASON,
                host_protocol::EXECUTION_SANDBOX_RUN_METHOD
            )
        );
    }

    #[test]
    fn run_rejects_shell_metacharacters_before_unsupported() {
        let error = run(Some(json!({
            "sandboxId": "sandbox-1",
            "command": "node;rm"
        })))
        .expect_err("invalid payload should fail before unsupported");

        assert!(
            matches!(error, HostProtocolError::InvalidArgument { field, .. } if field == "command")
        );
    }

    #[test]
    fn destroy_rejects_empty_sandbox_id_before_unsupported() {
        let error = destroy(Some(json!({ "sandboxId": "" })))
            .expect_err("invalid payload should fail before unsupported");

        assert!(
            matches!(error, HostProtocolError::InvalidArgument { field, .. } if field == "sandboxId")
        );
    }

    #[test]
    fn destroy_decodes_valid_payload_then_returns_typed_unsupported() {
        let error = destroy(Some(json!({
            "sandboxId": "sandbox-1",
            "traceId": "trace-destroy"
        })))
        .expect_err("host should be unsupported");

        assert_eq!(
            error,
            HostProtocolError::unsupported(
                host_protocol::EXECUTION_SANDBOX_UNSUPPORTED_REASON,
                host_protocol::EXECUTION_SANDBOX_DESTROY_METHOD
            )
        );
    }

    #[test]
    fn is_supported_returns_false_with_reason() {
        let response = is_supported().expect("support query should encode");

        assert_eq!(
            response,
            Some(json!({
                "supported": false,
                "reason": "host-adapter-unimplemented"
            }))
        );
    }

    fn valid_create_payload() -> serde_json::Value {
        json!({
            "actor": { "kind": "extension", "id": "extension-1" },
            "policy": {
                "cwd": "/tmp/app",
                "environment": [{ "name": "PATH", "value": "/usr/bin" }],
                "filesystem": {
                    "readRoots": ["/tmp/app"],
                    "writeRoots": ["/tmp/app/out"]
                },
                "network": {
                    "hosts": ["api.example.test"]
                },
                "budgets": {
                    "cpuMillis": 500,
                    "memoryBytes": 67108864,
                    "wallClockMillis": 1000,
                    "stdoutBytes": 1024,
                    "stderrBytes": 1024
                },
                "cleanup": {
                    "killProcessTree": true,
                    "removeWorkingDirectory": true
                }
            },
            "sandboxId": "sandbox-1",
            "traceId": "trace-sandbox"
        })
    }
}
