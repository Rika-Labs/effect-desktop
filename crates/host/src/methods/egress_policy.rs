#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{
    EgressPolicyActorPayload, EgressPolicyDecisionPayload, EgressPolicyDecisionResultPayload,
    EgressPolicyDestinationPayload, EgressPolicyOutcome, EgressPolicyRecordPayload,
    EgressPolicyRecordResultPayload, EgressPolicyRuleEffect, EgressPolicyRulePayload,
    EgressPolicySupportedPayload, HostProtocolError,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{to_value, Value};
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use uuid::Uuid;

#[cfg(unix)]
use std::os::fd::AsRawFd;

#[cfg(windows)]
use std::os::windows::io::AsRawHandle;
#[cfg(windows)]
use windows_sys::Win32::Foundation::HANDLE;
#[cfg(windows)]
use windows_sys::Win32::Storage::FileSystem::{LockFileEx, UnlockFileEx, LOCKFILE_EXCLUSIVE_LOCK};
#[cfg(windows)]
use windows_sys::Win32::System::IO::OVERLAPPED;

const DEFAULT_DENY_RULE_ID: &str = "default-deny";
const DECISION_LOG_ENV: &str = "EFFECT_DESKTOP_EGRESS_POLICY_LOG";
const DECISION_LOG_DIR: &str = "effect-desktop";
const DECISION_LOG_FILE: &str = "effect-desktop-egress-policy-decisions.jsonl";
const DECISION_LOG_UNAVAILABLE_REASON: &str = "egress-decision-log-unavailable";
const ISSUED_DECISION_LIMIT: usize = 4096;
const ISSUED_DECISION_TTL: Duration = Duration::from_secs(300);

#[derive(Clone)]
struct IssuedDecision {
    decision_id: String,
    decision: EgressPolicyDecisionResultPayload,
    expires_at: Instant,
}

static ISSUED_DECISIONS: OnceLock<Mutex<HashMap<String, IssuedDecision>>> = OnceLock::new();

#[cfg(test)]
pub(crate) static EGRESS_POLICY_ENV_LOCK: Mutex<()> = Mutex::new(());

pub(crate) fn decide(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<EgressPolicyDecisionPayload>(
        payload,
        host_protocol::EGRESS_POLICY_DECIDE_METHOD,
    )?;
    validate_decision(&input, host_protocol::EGRESS_POLICY_DECIDE_METHOD)?;
    let rule = default_deny_rule();
    let outcome = EgressPolicyOutcome::Denied;
    let reason = rule
        .reason()
        .map(str::to_string)
        .unwrap_or_else(|| "egress denied".to_string());
    let decision = EgressPolicyDecisionResultPayload::new(
        format!("egress-decision-{}", Uuid::new_v4()),
        outcome,
        input.actor().clone(),
        input.destination().clone(),
        rule,
        reason,
    );
    remember_issued_decision(&decision, host_protocol::EGRESS_POLICY_DECIDE_METHOD)?;

    encode_payload(decision, host_protocol::EGRESS_POLICY_DECIDE_METHOD)
}

pub(crate) fn record_with_event(
    payload: Option<Value>,
    timestamp: u64,
) -> Result<(Option<Value>, Option<Value>), HostProtocolError> {
    let log_path = decision_log_path(host_protocol::EGRESS_POLICY_RECORD_METHOD)?;
    record_with_log_path_and_timestamp(payload, &log_path, timestamp)
}

#[cfg(test)]
fn record_with_log_path(
    payload: Option<Value>,
    log_path: &Path,
) -> Result<Option<Value>, HostProtocolError> {
    record_with_log_path_and_timestamp(payload, log_path, 0).map(|(response, _)| response)
}

fn record_with_log_path_and_timestamp(
    payload: Option<Value>,
    log_path: &Path,
    timestamp: u64,
) -> Result<(Option<Value>, Option<Value>), HostProtocolError> {
    let input = decode_payload::<EgressPolicyRecordPayload>(
        payload,
        host_protocol::EGRESS_POLICY_RECORD_METHOD,
    )?;
    validate_record(&input, host_protocol::EGRESS_POLICY_RECORD_METHOD)?;
    let claimed = claim_issued_decision(&input, host_protocol::EGRESS_POLICY_RECORD_METHOD)?;
    let recorded_event = host_protocol::EgressPolicyDecisionRecordedEventPayload::new(
        timestamp,
        claimed.decision.clone(),
    );
    if let Err(error) = append_decision_record(
        &recorded_event,
        log_path,
        host_protocol::EGRESS_POLICY_RECORD_METHOD,
    ) {
        restore_issued_decision(claimed, host_protocol::EGRESS_POLICY_RECORD_METHOD)?;
        return Err(error);
    }

    let response = encode_payload(
        EgressPolicyRecordResultPayload::recorded(input.decision_id()),
        host_protocol::EGRESS_POLICY_RECORD_METHOD,
    )?;
    let event = encode_payload(recorded_event, host_protocol::EGRESS_POLICY_RECORD_METHOD)?;
    Ok((response, event))
}

pub(crate) fn is_supported() -> Result<Option<Value>, HostProtocolError> {
    let supported = match decision_log_path(host_protocol::EGRESS_POLICY_IS_SUPPORTED_METHOD) {
        Ok(log_path) => match ensure_decision_log_available(
            &log_path,
            host_protocol::EGRESS_POLICY_IS_SUPPORTED_METHOD,
        ) {
            Ok(()) => EgressPolicySupportedPayload::available(),
            Err(_) => EgressPolicySupportedPayload::unsupported(DECISION_LOG_UNAVAILABLE_REASON),
        },
        Err(_) => EgressPolicySupportedPayload::unsupported(
            host_protocol::EGRESS_POLICY_UNSUPPORTED_REASON,
        ),
    };
    encode_payload(supported, host_protocol::EGRESS_POLICY_IS_SUPPORTED_METHOD)
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
            format!("failed to encode egress policy payload: {error}"),
            operation,
        )
    })
}

fn validate_decision(
    input: &EgressPolicyDecisionPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_actor(input.actor(), operation)?;
    validate_destination(input.destination(), operation)?;
    if let Some(trace_id) = input.trace_id() {
        validate_non_empty("traceId", trace_id, operation)?;
    }
    Ok(())
}

fn validate_record(
    input: &EgressPolicyRecordPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_non_empty("decisionId", input.decision_id(), operation)?;
    validate_actor(input.actor(), operation)?;
    validate_destination(input.destination(), operation)?;
    if let Some(trace_id) = input.trace_id() {
        validate_non_empty("traceId", trace_id, operation)?;
    }
    Ok(())
}

fn remember_issued_decision(
    decision: &EgressPolicyDecisionResultPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let mut issued = issued_decisions(operation)?;
    prune_expired_issued_decisions(&mut issued, Instant::now());
    if issued.len() >= ISSUED_DECISION_LIMIT {
        return Err(HostProtocolError::internal(
            "egress decision registry is full",
            operation,
        ));
    }
    issued.insert(
        decision.decision_id().to_string(),
        IssuedDecision {
            decision_id: decision.decision_id().to_string(),
            decision: decision.clone(),
            expires_at: Instant::now() + ISSUED_DECISION_TTL,
        },
    );
    Ok(())
}

fn claim_issued_decision(
    input: &EgressPolicyRecordPayload,
    operation: &'static str,
) -> Result<IssuedDecision, HostProtocolError> {
    let mut issued = issued_decisions(operation)?;
    prune_expired_issued_decisions(&mut issued, Instant::now());
    let Some(decision) = issued.get(input.decision_id()).cloned() else {
        return Err(HostProtocolError::invalid_argument(
            "decisionId",
            "must reference an issued egress decision",
            operation,
        ));
    };
    if decision.decision.actor() != input.actor() {
        return Err(HostProtocolError::invalid_argument(
            "actor",
            "must match issued egress decision actor",
            operation,
        ));
    }
    if decision.decision.destination() != input.destination() {
        return Err(HostProtocolError::invalid_argument(
            "destination",
            "must match issued egress decision destination",
            operation,
        ));
    }
    issued.remove(input.decision_id()).ok_or_else(|| {
        HostProtocolError::invalid_argument(
            "decisionId",
            "must reference an issued egress decision",
            operation,
        )
    })
}

fn restore_issued_decision(
    mut decision: IssuedDecision,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    decision.expires_at = Instant::now() + ISSUED_DECISION_TTL;
    let mut issued = issued_decisions(operation)?;
    let decision_id = decision.decision_id.clone();
    issued.insert(decision_id, decision);
    Ok(())
}

fn issued_decisions(
    operation: &'static str,
) -> Result<std::sync::MutexGuard<'static, HashMap<String, IssuedDecision>>, HostProtocolError> {
    ISSUED_DECISIONS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| {
            HostProtocolError::internal("egress decision registry lock poisoned", operation)
        })
}

fn prune_expired_issued_decisions(issued: &mut HashMap<String, IssuedDecision>, now: Instant) {
    issued.retain(|_, decision| decision.expires_at > now);
}

fn validate_actor(
    actor: &EgressPolicyActorPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_printable_non_empty("actor.id", actor.id(), operation)
}

fn validate_destination(
    destination: &EgressPolicyDestinationPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_printable_non_empty("destination.host", destination.host(), operation)?;
    if destination.port() == Some(0) {
        return Err(HostProtocolError::invalid_argument(
            "destination.port",
            "must be between 1 and 65535",
            operation,
        ));
    }
    if let Some(path) = destination.path() {
        validate_no_nul("destination.path", path, operation)?;
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

fn default_deny_rule() -> EgressPolicyRulePayload {
    EgressPolicyRulePayload::new(
        DEFAULT_DENY_RULE_ID,
        EgressPolicyRuleEffect::Deny,
        vec!["*".to_string()],
        Vec::new(),
        Vec::new(),
        Some("no matching egress allow rule".to_string()),
    )
}

fn append_decision_record(
    input: &host_protocol::EgressPolicyDecisionRecordedEventPayload,
    log_path: &Path,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    ensure_log_parent(log_path, operation)?;
    let mut record = serde_json::to_vec(input).map_err(|error| {
        HostProtocolError::internal(
            format!("failed to encode egress decision record: {error}"),
            operation,
        )
    })?;
    record.push(b'\n');

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
        .map_err(|error| {
            HostProtocolError::internal(
                format!("failed to open egress decision log: {error}"),
                operation,
            )
        })?;

    let _lock = lock_file_exclusive(&file, operation)?;
    file.write_all(&record).map_err(|error| {
        HostProtocolError::internal(
            format!("failed to write egress decision record: {error}"),
            operation,
        )
    })?;
    file.sync_data().map_err(|error| {
        HostProtocolError::internal(
            format!("failed to sync egress decision record: {error}"),
            operation,
        )
    })
}

fn ensure_decision_log_available(
    log_path: &Path,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    ensure_log_parent(log_path, operation)?;
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
        .map_err(|error| {
            HostProtocolError::internal(
                format!("failed to open egress decision log: {error}"),
                operation,
            )
        })?;
    let _lock = lock_file_exclusive(&file, operation)?;
    file.sync_data().map_err(|error| {
        HostProtocolError::internal(
            format!("failed to sync egress decision log: {error}"),
            operation,
        )
    })
}

fn ensure_log_parent(log_path: &Path, operation: &'static str) -> Result<(), HostProtocolError> {
    if let Some(parent) = log_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            HostProtocolError::internal(
                format!("failed to create egress decision log directory: {error}"),
                operation,
            )
        })?;
    }
    Ok(())
}

#[cfg(unix)]
struct FileLockGuard {
    fd: std::os::fd::RawFd,
}

#[cfg(unix)]
fn lock_file_exclusive(
    file: &File,
    operation: &'static str,
) -> Result<FileLockGuard, HostProtocolError> {
    let status = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) };
    if status == 0 {
        return Ok(FileLockGuard {
            fd: file.as_raw_fd(),
        });
    }

    Err(HostProtocolError::internal(
        format!(
            "failed to lock egress decision log: {}",
            std::io::Error::last_os_error()
        ),
        operation,
    ))
}

#[cfg(unix)]
impl Drop for FileLockGuard {
    fn drop(&mut self) {
        let _ = unsafe { libc::flock(self.fd, libc::LOCK_UN) };
    }
}

#[cfg(windows)]
struct FileLockGuard {
    handle: HANDLE,
    overlapped: OVERLAPPED,
}

#[cfg(windows)]
fn lock_file_exclusive(
    file: &File,
    operation: &'static str,
) -> Result<FileLockGuard, HostProtocolError> {
    let mut overlapped = unsafe { std::mem::zeroed::<OVERLAPPED>() };
    let handle = file.as_raw_handle() as HANDLE;
    let status = unsafe {
        LockFileEx(
            handle,
            LOCKFILE_EXCLUSIVE_LOCK,
            0,
            u32::MAX,
            u32::MAX,
            &mut overlapped,
        )
    };
    if status != 0 {
        return Ok(FileLockGuard { handle, overlapped });
    }

    Err(HostProtocolError::internal(
        format!(
            "failed to lock egress decision log: {}",
            std::io::Error::last_os_error()
        ),
        operation,
    ))
}

#[cfg(windows)]
impl Drop for FileLockGuard {
    fn drop(&mut self) {
        let _ = unsafe { UnlockFileEx(self.handle, 0, u32::MAX, u32::MAX, &mut self.overlapped) };
    }
}

fn decision_log_path(operation: &'static str) -> Result<PathBuf, HostProtocolError> {
    if let Some(path) = std::env::var_os(DECISION_LOG_ENV).map(PathBuf::from) {
        return Ok(path);
    }
    default_decision_log_path().ok_or_else(|| {
        HostProtocolError::unsupported(host_protocol::EGRESS_POLICY_UNSUPPORTED_REASON, operation)
    })
}

#[cfg(target_os = "macos")]
fn default_decision_log_path() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from).map(|home| {
        home.join("Library")
            .join("Application Support")
            .join(DECISION_LOG_DIR)
            .join(DECISION_LOG_FILE)
    })
}

#[cfg(target_os = "windows")]
fn default_decision_log_path() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA")
        .or_else(|| std::env::var_os("APPDATA"))
        .map(PathBuf::from)
        .map(|data| data.join(DECISION_LOG_DIR).join(DECISION_LOG_FILE))
}

#[cfg(target_os = "linux")]
fn default_decision_log_path() -> Option<PathBuf> {
    std::env::var_os("XDG_STATE_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME")
                .map(PathBuf::from)
                .map(|home| home.join(".local").join("state"))
        })
        .map(|state| state.join(DECISION_LOG_DIR).join(DECISION_LOG_FILE))
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn default_decision_log_path() -> Option<PathBuf> {
    None
}

#[cfg(test)]
mod tests {
    use super::{decide, is_supported, record_with_log_path};
    use host_protocol::HostProtocolError;
    use serde_json::json;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn decide_returns_default_deny_without_trusted_host_rules() {
        let response = decide(Some(json!({
            "actor": { "kind": "extension", "id": "extension-1" },
            "destination": {
                "protocol": "https",
                "host": "api.example.test",
                "port": 443
            },
            "traceId": "trace-egress"
        })))
        .expect("decision should succeed");

        let response = response.expect("decision response should be encoded");
        let decision_id = response
            .get("decisionId")
            .and_then(serde_json::Value::as_str)
            .expect("decision id should be present");
        assert!(decision_id.starts_with("egress-decision-"));
        assert_ne!(decision_id, "trace-egress");
        assert_eq!(
            response,
            json!({
                "decisionId": decision_id,
                "outcome": "denied",
                "actor": { "kind": "extension", "id": "extension-1" },
                "destination": {
                    "protocol": "https",
                    "host": "api.example.test",
                    "port": 443
                },
                "rule": {
                    "id": "default-deny",
                    "effect": "deny",
                    "hosts": ["*"],
                    "reason": "no matching egress allow rule"
                },
                "reason": "no matching egress allow rule"
            })
        );
    }

    #[test]
    fn decide_mints_unique_ids_even_for_repeated_trace_ids() {
        let first = decision_id(
            decide(Some(decision_payload(
                "api.example.test",
                "trace-collision",
            )))
            .expect("first decision should succeed"),
        );
        let second = decision_id(
            decide(Some(decision_payload(
                "api.example.test",
                "trace-collision",
            )))
            .expect("second decision should succeed"),
        );

        assert_ne!(first, second);
    }

    #[test]
    fn decide_rejects_caller_supplied_rules() {
        let error = decide(Some(json!({
            "actor": { "kind": "extension", "id": "extension-1" },
            "destination": {
                "protocol": "https",
                "host": "api.example.test"
            },
            "rules": [
                {
                    "id": "allow-api",
                    "effect": "allow",
                    "hosts": ["api.example.test"]
                }
            ]
        })))
        .expect_err("caller supplied rules should fail closed");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "payload",
                "unknown field `rules`, expected one of `actor`, `destination`, `traceId`",
                host_protocol::EGRESS_POLICY_DECIDE_METHOD,
            )
        );
    }

    #[test]
    fn decide_returns_default_deny() {
        let response = decide(Some(json!({
            "actor": { "kind": "extension", "id": "extension-1" },
            "destination": {
                "protocol": "https",
                "host": "blocked.example.test"
            }
        })))
        .expect("decision should succeed");

        let response = response.expect("decision response should be encoded");
        let decision_id = response
            .get("decisionId")
            .and_then(serde_json::Value::as_str)
            .expect("decision id should be present");
        assert!(decision_id.starts_with("egress-decision-"));
        assert_eq!(
            response,
            json!({
                "decisionId": decision_id,
                "outcome": "denied",
                "actor": { "kind": "extension", "id": "extension-1" },
                "destination": {
                    "protocol": "https",
                    "host": "blocked.example.test"
                },
                "rule": {
                    "id": "default-deny",
                    "effect": "deny",
                    "hosts": ["*"],
                    "reason": "no matching egress allow rule"
                },
                "reason": "no matching egress allow rule"
            })
        );
    }

    #[test]
    fn decide_rejects_invalid_payload_before_policy_evaluation() {
        let error = decide(Some(json!({
            "actor": { "kind": "extension", "id": "extension-1" },
            "destination": {
                "protocol": "https",
                "host": ""
            }
        })))
        .expect_err("empty host should fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "destination.host",
                "must be non-empty",
                host_protocol::EGRESS_POLICY_DECIDE_METHOD,
            )
        );
    }

    #[test]
    fn decide_rejects_control_characters_in_printable_fields() {
        let error = decide(Some(json!({
            "actor": { "kind": "extension", "id": "extension-1" },
            "destination": {
                "protocol": "https",
                "host": "api.example.test\n"
            }
        })))
        .expect_err("control characters should fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "destination.host",
                "must not include control characters",
                host_protocol::EGRESS_POLICY_DECIDE_METHOD,
            )
        );
    }

    #[test]
    fn decide_rejects_zero_ports_before_policy_evaluation() {
        let error = decide(Some(json!({
            "actor": { "kind": "extension", "id": "extension-1" },
            "destination": {
                "protocol": "https",
                "host": "api.example.test",
                "port": 0
            }
        })))
        .expect_err("zero port should fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "destination.port",
                "must be between 1 and 65535",
                host_protocol::EGRESS_POLICY_DECIDE_METHOD,
            )
        );
    }

    #[test]
    fn record_persists_decoded_decisions_to_host_log() {
        let dir = unique_temp_dir("record");
        fs::create_dir_all(&dir).expect("temp dir should be created");
        let log_path = dir.join("egress-policy.jsonl");
        let decision_id = issue_decision("trace-record-issue");

        let response = record_with_log_path(Some(record_payload(&decision_id)), &log_path)
            .expect("record should succeed");

        assert_eq!(
            response,
            Some(json!({
                "decisionId": decision_id,
                "recorded": true
            }))
        );

        let log = fs::read_to_string(&log_path).expect("decision log should be written");
        let records = log.lines().collect::<Vec<_>>();
        assert_eq!(records.len(), 1);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(records[0])
                .expect("record should be valid json"),
            recorded_event(&decision_id, 0)
        );

        fs::remove_dir_all(dir).expect("temp dir should be removed");
    }

    #[test]
    fn record_rejects_mismatched_actor_destination() {
        let dir = unique_temp_dir("record-mismatch");
        fs::create_dir_all(&dir).expect("temp dir should be created");
        let log_path = dir.join("egress-policy.jsonl");
        let decision_id = issue_decision("trace-record-mismatch");

        let error = record_with_log_path(
            Some(json!({
                "decisionId": decision_id,
                "actor": { "kind": "extension", "id": "extension-2" },
                "destination": {
                    "protocol": "https",
                    "host": "api.example.test",
                    "port": 443
                }
            })),
            &log_path,
        )
        .expect_err("mismatched actor should fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "actor",
                "must match issued egress decision actor",
                host_protocol::EGRESS_POLICY_RECORD_METHOD,
            )
        );
        assert!(!log_path.exists());

        fs::remove_dir_all(dir).expect("temp dir should be removed");
    }

    #[test]
    fn record_rejects_replayed_decision_ids() {
        let dir = unique_temp_dir("replay");
        fs::create_dir_all(&dir).expect("temp dir should be created");
        let log_path = dir.join("egress-policy.jsonl");
        let decision_id = issue_decision("trace-replay");

        record_with_log_path(Some(record_payload(&decision_id)), &log_path)
            .expect("first record should succeed");
        let error = record_with_log_path(Some(record_payload(&decision_id)), &log_path)
            .expect_err("replayed decision id should fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "decisionId",
                "must reference an issued egress decision",
                host_protocol::EGRESS_POLICY_RECORD_METHOD,
            )
        );

        fs::remove_dir_all(dir).expect("temp dir should be removed");
    }

    #[test]
    fn record_rejects_unknown_decision_ids() {
        let dir = unique_temp_dir("unknown-id");
        fs::create_dir_all(&dir).expect("temp dir should be created");
        let log_path = dir.join("egress-policy.jsonl");

        let error = record_with_log_path(Some(record_payload("decision-unknown")), &log_path)
            .expect_err("unknown decision id should fail");

        assert_eq!(
            error,
            HostProtocolError::invalid_argument(
                "decisionId",
                "must reference an issued egress decision",
                host_protocol::EGRESS_POLICY_RECORD_METHOD,
            )
        );
        assert!(!log_path.exists());

        fs::remove_dir_all(dir).expect("temp dir should be removed");
    }

    #[test]
    fn record_reports_host_log_failures_as_typed_errors() {
        let root = unique_temp_dir("log-failure");
        fs::create_dir_all(&root).expect("temp dir should be created");
        let file_parent = root.join("not-a-directory");
        fs::write(&file_parent, b"not a directory").expect("parent file should be written");
        let log_path = file_parent.join("egress-policy.jsonl");
        let decision_id = issue_decision("trace-log-failure");

        let error = record_with_log_path(Some(record_payload(&decision_id)), &log_path)
            .expect_err("host log failure should be typed");

        assert_eq!(error.tag(), "Internal");

        fs::remove_dir_all(root).expect("temp dir should be removed");
    }

    #[test]
    fn is_supported_reports_available_when_decision_log_is_writable() {
        let _guard = super::EGRESS_POLICY_ENV_LOCK
            .lock()
            .expect("env lock should not be poisoned");
        let dir = unique_temp_dir("supported");
        fs::create_dir_all(&dir).expect("temp dir should be created");
        let log_path = dir.join("egress-policy.jsonl");
        let previous = std::env::var_os(super::DECISION_LOG_ENV);
        std::env::set_var(super::DECISION_LOG_ENV, &log_path);

        let response = is_supported().expect("support probe should encode");

        restore_log_env(previous);
        assert_eq!(response, Some(json!({ "supported": true })));
        assert!(log_path.exists());
        fs::remove_dir_all(dir).expect("temp dir should be removed");
    }

    #[test]
    fn is_supported_reports_unavailable_when_decision_log_cannot_open() {
        let _guard = super::EGRESS_POLICY_ENV_LOCK
            .lock()
            .expect("env lock should not be poisoned");
        let dir = unique_temp_dir("unsupported-log");
        fs::create_dir_all(&dir).expect("temp dir should be created");
        let file_parent = dir.join("not-a-directory");
        fs::write(&file_parent, b"not a directory").expect("parent file should be written");
        let previous = std::env::var_os(super::DECISION_LOG_ENV);
        std::env::set_var(
            super::DECISION_LOG_ENV,
            file_parent.join("egress-policy.jsonl"),
        );

        let response = is_supported().expect("support probe should encode");

        restore_log_env(previous);
        assert_eq!(
            response,
            Some(json!({
                "supported": false,
                "reason": "egress-decision-log-unavailable"
            }))
        );
        fs::remove_dir_all(dir).expect("temp dir should be removed");
    }

    fn record_payload(decision_id: &str) -> serde_json::Value {
        json!({
            "decisionId": decision_id,
            "actor": { "kind": "extension", "id": "extension-1" },
            "destination": {
                "protocol": "https",
                "host": "api.example.test",
                "port": 443
            },
            "traceId": "trace-record"
        })
    }

    fn recorded_event(decision_id: &str, timestamp: u64) -> serde_json::Value {
        json!({
            "type": "decision-recorded",
            "timestamp": timestamp,
            "decision": default_deny_decision(decision_id)
        })
    }

    fn default_deny_decision(decision_id: &str) -> serde_json::Value {
        json!({
            "decisionId": decision_id,
            "outcome": "denied",
            "actor": { "kind": "extension", "id": "extension-1" },
            "destination": {
                "protocol": "https",
                "host": "api.example.test",
                "port": 443
            },
            "rule": {
                "id": "default-deny",
                "effect": "deny",
                "hosts": ["*"],
                "reason": "no matching egress allow rule"
            },
            "reason": "no matching egress allow rule"
        })
    }

    fn issue_decision(trace_id: &str) -> String {
        decision_id(
            decide(Some(decision_payload("api.example.test", trace_id)))
                .expect("decision should be issued"),
        )
    }

    fn decision_payload(host: &str, trace_id: &str) -> serde_json::Value {
        json!({
            "actor": { "kind": "extension", "id": "extension-1" },
            "destination": {
                "protocol": "https",
                "host": host,
                "port": 443
            },
            "traceId": trace_id
        })
    }

    fn decision_id(response: Option<serde_json::Value>) -> String {
        response
            .expect("decision response should be encoded")
            .get("decisionId")
            .and_then(serde_json::Value::as_str)
            .expect("decision id should be present")
            .to_string()
    }

    fn unique_temp_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time should be after epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("effect-desktop-egress-policy-{nanos}-{name}"))
    }

    fn restore_log_env(previous: Option<std::ffi::OsString>) {
        match previous {
            Some(path) => std::env::set_var(super::DECISION_LOG_ENV, path),
            None => std::env::remove_var(super::DECISION_LOG_ENV),
        }
    }
}
