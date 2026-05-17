#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{
    HostProtocolError, LocalToolRuntimeActorPayload, LocalToolRuntimeHealthPayload,
    LocalToolRuntimeRegisterPayload, LocalToolRuntimeRunPayload, LocalToolRuntimeStopPayload,
    LocalToolRuntimeSupportedPayload,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{to_value, Value};

pub(crate) fn register(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<LocalToolRuntimeRegisterPayload>(
        payload,
        host_protocol::LOCAL_TOOL_RUNTIME_REGISTER_METHOD,
    )?;
    validate_register(&input, host_protocol::LOCAL_TOOL_RUNTIME_REGISTER_METHOD)?;
    Err(unsupported(
        host_protocol::LOCAL_TOOL_RUNTIME_REGISTER_METHOD,
    ))
}

pub(crate) fn run(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<LocalToolRuntimeRunPayload>(
        payload,
        host_protocol::LOCAL_TOOL_RUNTIME_RUN_METHOD,
    )?;
    validate_run(&input, host_protocol::LOCAL_TOOL_RUNTIME_RUN_METHOD)?;
    Err(unsupported(host_protocol::LOCAL_TOOL_RUNTIME_RUN_METHOD))
}

pub(crate) fn stop(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<LocalToolRuntimeStopPayload>(
        payload,
        host_protocol::LOCAL_TOOL_RUNTIME_STOP_METHOD,
    )?;
    validate_stop(&input, host_protocol::LOCAL_TOOL_RUNTIME_STOP_METHOD)?;
    Err(unsupported(host_protocol::LOCAL_TOOL_RUNTIME_STOP_METHOD))
}

pub(crate) fn health(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<LocalToolRuntimeHealthPayload>(
        payload,
        host_protocol::LOCAL_TOOL_RUNTIME_HEALTH_METHOD,
    )?;
    validate_health(&input, host_protocol::LOCAL_TOOL_RUNTIME_HEALTH_METHOD)?;
    Err(unsupported(host_protocol::LOCAL_TOOL_RUNTIME_HEALTH_METHOD))
}

pub(crate) fn is_supported() -> Result<Option<Value>, HostProtocolError> {
    encode_payload(
        LocalToolRuntimeSupportedPayload::unsupported(
            host_protocol::LOCAL_TOOL_RUNTIME_UNSUPPORTED_REASON,
        ),
        host_protocol::LOCAL_TOOL_RUNTIME_IS_SUPPORTED_METHOD,
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
            format!("failed to encode local tool runtime payload: {error}"),
            operation,
        )
    })
}

fn validate_register(
    input: &LocalToolRuntimeRegisterPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_actor(input.actor(), operation)?;
    validate_identifier("manifest.toolId", input.manifest().tool_id(), operation)?;
    validate_version("manifest.version", input.manifest().version(), operation)?;
    if input.manifest().commands().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "manifest.commands",
            "must not be empty",
            operation,
        ));
    }
    if input.manifest().permissions().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "manifest.permissions",
            "must not be empty",
            operation,
        ));
    }
    if input.manifest().policy().cwd().roots().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "manifest.policy.cwd.roots",
            "must not be empty",
            operation,
        ));
    }
    for root in input.manifest().policy().cwd().roots() {
        validate_printable_non_empty("manifest.policy.cwd.roots", root, operation)?;
    }
    for entry in input.manifest().policy().environment().variables() {
        validate_printable_non_empty("manifest.policy.environment.name", entry.name(), operation)?;
        validate_no_nul(
            "manifest.policy.environment.value",
            entry.value(),
            operation,
        )?;
    }
    for root in input.manifest().policy().filesystem().read_roots() {
        validate_printable_non_empty("manifest.policy.filesystem.readRoots", root, operation)?;
    }
    for root in input.manifest().policy().filesystem().write_roots() {
        validate_printable_non_empty("manifest.policy.filesystem.writeRoots", root, operation)?;
    }
    for host in input.manifest().policy().network().hosts() {
        validate_printable_non_empty("manifest.policy.network.hosts", host, operation)?;
    }
    validate_budget(
        "manifest.policy.budgets.cpuMillis",
        input.manifest().policy().budgets().cpu_millis(),
        operation,
    )?;
    validate_budget(
        "manifest.policy.budgets.memoryBytes",
        input.manifest().policy().budgets().memory_bytes(),
        operation,
    )?;
    validate_budget(
        "manifest.policy.budgets.wallClockMillis",
        input.manifest().policy().budgets().wall_clock_millis(),
        operation,
    )?;
    validate_budget(
        "manifest.policy.budgets.stdoutBytes",
        input.manifest().policy().budgets().stdout_bytes(),
        operation,
    )?;
    validate_budget(
        "manifest.policy.budgets.stderrBytes",
        input.manifest().policy().budgets().stderr_bytes(),
        operation,
    )?;

    let mut command_ids = Vec::new();
    for command in input.manifest().commands() {
        validate_identifier(
            "manifest.commands.commandId",
            command.command_id(),
            operation,
        )?;
        validate_printable_non_empty(
            "manifest.commands.executable",
            command.executable(),
            operation,
        )?;
        validate_no_shell_metacharacter(
            "manifest.commands.executable",
            command.executable(),
            operation,
        )?;
        if command_ids.iter().any(|id| id == command.command_id()) {
            return Err(HostProtocolError::invalid_argument(
                "manifest.commands",
                "must have unique commandIds",
                operation,
            ));
        }
        command_ids.push(command.command_id().to_string());
        for arg in command.default_args() {
            validate_no_nul("manifest.commands.defaultArgs", arg, operation)?;
        }
        for entry in command.environment() {
            validate_printable_non_empty(
                "manifest.commands.environment.name",
                entry.name(),
                operation,
            )?;
            validate_no_nul(
                "manifest.commands.environment.value",
                entry.value(),
                operation,
            )?;
        }
        if let Some(cwd) = command.cwd() {
            validate_printable_non_empty("manifest.commands.cwd", cwd, operation)?;
        }
        if let Some(timeout) = command.timeout_millis() {
            validate_budget("manifest.commands.timeoutMillis", timeout, operation)?;
        }
    }
    if let Some(health) = input.manifest().health() {
        if !command_ids.iter().any(|id| id == health.command_id()) {
            return Err(HostProtocolError::invalid_argument(
                "manifest.health.commandId",
                "must reference a manifest command",
                operation,
            ));
        }
        validate_budget(
            "manifest.health.intervalMillis",
            health.interval_millis(),
            operation,
        )?;
        validate_budget(
            "manifest.health.timeoutMillis",
            health.timeout_millis(),
            operation,
        )?;
    }
    if let Some(runtime_id) = input.runtime_id() {
        validate_non_empty("runtimeId", runtime_id, operation)?;
    }
    if let Some(trace_id) = input.trace_id() {
        validate_non_empty("traceId", trace_id, operation)?;
    }
    Ok(())
}

fn validate_run(
    input: &LocalToolRuntimeRunPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_non_empty("runtimeId", input.runtime_id(), operation)?;
    validate_identifier("commandId", input.command_id(), operation)?;
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

fn validate_stop(
    input: &LocalToolRuntimeStopPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_non_empty("runtimeId", input.runtime_id(), operation)?;
    if let Some(trace_id) = input.trace_id() {
        validate_non_empty("traceId", trace_id, operation)?;
    }
    Ok(())
}

fn validate_health(
    input: &LocalToolRuntimeHealthPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_non_empty("runtimeId", input.runtime_id(), operation)?;
    if let Some(trace_id) = input.trace_id() {
        validate_non_empty("traceId", trace_id, operation)?;
    }
    Ok(())
}

fn validate_actor(
    actor: &LocalToolRuntimeActorPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_printable_non_empty("actor.id", actor.id(), operation)
}

fn validate_version(
    field: &str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if !valid_semver(value) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be SemVer",
            operation,
        ));
    }
    Ok(())
}

fn valid_semver(value: &str) -> bool {
    let mut build_split = value.splitn(2, '+');
    let release = build_split.next().unwrap_or_default();
    let build = build_split.next();
    if build.is_some_and(|value| !valid_build_metadata(value)) {
        return false;
    }
    let mut prerelease_split = release.splitn(2, '-');
    let core = prerelease_split.next().unwrap_or_default();
    let prerelease = prerelease_split.next();
    valid_semver_core(core) && prerelease.is_none_or(valid_prerelease)
}

fn valid_semver_core(core: &str) -> bool {
    let parts: Vec<&str> = core.split('.').collect();
    parts.len() == 3 && parts.iter().all(|part| valid_semver_number(part))
}

fn valid_semver_number(part: &str) -> bool {
    if part.is_empty() || !part.chars().all(|value| value.is_ascii_digit()) {
        return false;
    }
    part == "0" || !part.starts_with('0')
}

fn valid_prerelease(value: &str) -> bool {
    valid_dot_identifiers(value, |identifier| {
        valid_semver_identifier(identifier)
            && (!is_numeric(identifier) || valid_semver_number(identifier))
    })
}

fn valid_build_metadata(value: &str) -> bool {
    valid_dot_identifiers(value, valid_semver_identifier)
}

fn valid_dot_identifiers(value: &str, is_valid: impl Fn(&str) -> bool) -> bool {
    !value.is_empty() && value.split('.').all(is_valid)
}

fn valid_semver_identifier(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
}

fn is_numeric(value: &str) -> bool {
    value.chars().all(|character| character.is_ascii_digit())
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

fn unsupported(operation: &'static str) -> HostProtocolError {
    HostProtocolError::unsupported(
        host_protocol::LOCAL_TOOL_RUNTIME_UNSUPPORTED_REASON,
        operation,
    )
}

#[cfg(test)]
mod tests {
    use super::{health, is_supported, register, run, stop};
    use host_protocol::HostProtocolError;
    use serde_json::json;

    #[test]
    fn register_decodes_valid_payload_then_returns_typed_unsupported() {
        let error =
            register(Some(valid_register_payload())).expect_err("host should be unsupported");

        assert_eq!(
            error,
            HostProtocolError::unsupported(
                host_protocol::LOCAL_TOOL_RUNTIME_UNSUPPORTED_REASON,
                host_protocol::LOCAL_TOOL_RUNTIME_REGISTER_METHOD,
            )
        );
    }

    #[test]
    fn register_rejects_malformed_semver_before_unsupported() {
        let mut payload = valid_register_payload();
        payload["manifest"]["version"] = json!("1.0.0-");
        let error = register(Some(payload)).expect_err("invalid SemVer must fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "manifest.version",
                "must be SemVer",
                host_protocol::LOCAL_TOOL_RUNTIME_REGISTER_METHOD,
            )
        );
    }

    #[test]
    fn register_rejects_shell_metacharacters_before_unsupported() {
        let mut payload = valid_register_payload();
        payload["manifest"]["commands"][0]["executable"] = json!("/usr/bin/node;rm");
        let error = register(Some(payload)).expect_err("invalid executable must fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "manifest.commands.executable",
                "contains shell metacharacters",
                host_protocol::LOCAL_TOOL_RUNTIME_REGISTER_METHOD,
            )
        );
    }

    #[test]
    fn register_rejects_unknown_health_command_before_unsupported() {
        let mut payload = valid_register_payload();
        payload["manifest"]["health"]["commandId"] = json!("missing");
        let error = register(Some(payload)).expect_err("invalid health command must fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "manifest.health.commandId",
                "must reference a manifest command",
                host_protocol::LOCAL_TOOL_RUNTIME_REGISTER_METHOD,
            )
        );
    }

    #[test]
    fn run_rejects_invalid_command_id_before_unsupported() {
        let error = run(Some(json!({
            "runtimeId": "runtime-1",
            "commandId": "../escape"
        })))
        .expect_err("invalid command id must fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "commandId",
                "must contain only letters, numbers, dot, underscore, or dash",
                host_protocol::LOCAL_TOOL_RUNTIME_RUN_METHOD,
            )
        );
    }

    #[test]
    fn stop_and_health_decode_valid_payloads_then_return_typed_unsupported() {
        let stop_error = stop(Some(json!({ "runtimeId": "runtime-1" })))
            .expect_err("host should be unsupported");
        let health_error = health(Some(json!({ "runtimeId": "runtime-1" })))
            .expect_err("host should be unsupported");

        assert_eq!(
            stop_error,
            HostProtocolError::unsupported(
                host_protocol::LOCAL_TOOL_RUNTIME_UNSUPPORTED_REASON,
                host_protocol::LOCAL_TOOL_RUNTIME_STOP_METHOD,
            )
        );
        assert_eq!(
            health_error,
            HostProtocolError::unsupported(
                host_protocol::LOCAL_TOOL_RUNTIME_UNSUPPORTED_REASON,
                host_protocol::LOCAL_TOOL_RUNTIME_HEALTH_METHOD,
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
                "reason": host_protocol::LOCAL_TOOL_RUNTIME_UNSUPPORTED_REASON
            }))
        );
    }

    fn valid_register_payload() -> serde_json::Value {
        json!({
            "actor": { "kind": "extension", "id": "extension-1" },
            "manifest": {
                "toolId": "tool-1",
                "name": "Tool One",
                "version": "1.0.0",
                "commands": [
                    {
                        "commandId": "node-version",
                        "executable": "/usr/bin/node",
                        "defaultArgs": ["--version"],
                        "cwd": "/tmp/app",
                        "timeoutMillis": 1000
                    }
                ],
                "permissions": [
                    {
                        "kind": "process.spawn",
                        "commands": ["/usr/bin/node"],
                        "cwd": ["/tmp/app"],
                        "environment": "none",
                        "shell": false,
                        "audit": "always"
                    }
                ],
                "policy": {
                    "cwd": { "roots": ["/tmp/app"] },
                    "environment": { "variables": [] },
                    "filesystem": { "readRoots": ["/tmp/app"] },
                    "network": { "hosts": [] },
                    "budgets": {
                        "cpuMillis": 500,
                        "memoryBytes": 67108864,
                        "wallClockMillis": 1000,
                        "stdoutBytes": 1024,
                        "stderrBytes": 1024
                    },
                    "stdio": { "stdout": "capture", "stderr": "capture" },
                    "cleanup": {
                        "killProcessTree": true,
                        "removeWorkingDirectory": true
                    }
                },
                "health": {
                    "commandId": "node-version",
                    "intervalMillis": 10000,
                    "timeoutMillis": 1000
                }
            },
            "runtimeId": "runtime-1",
            "traceId": "trace-local-tool-runtime"
        })
    }
}
