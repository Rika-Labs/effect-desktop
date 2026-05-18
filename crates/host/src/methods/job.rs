#![allow(clippy::result_large_err)]

use host_protocol::{
    HostProtocolError, JobControlPayload, JobEventPayload, JobEventPhase, JobGetPayload,
    JobHandlePayload, JobProgressPayload, JobProgressReportPayload, JobSnapshotPayload,
    JobStartPayload, JobState, JobSupportedPayload,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{to_value, Value};
use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use uuid::Uuid;

const STORE_ENV: &str = "EFFECT_DESKTOP_JOB_STORE";
const STORE_DIR: &str = "effect-desktop";
const STORE_ROOT: &str = "jobs";
const STORE_FILE: &str = "jobs.json";
const STORE_UNAVAILABLE_REASON: &str = "job-store-unavailable";
const OWNER_SCOPE: &str = "native-job";

static STORE_LOCK: Mutex<()> = Mutex::new(());

#[cfg(test)]
pub(crate) static JOB_ENV_LOCK: Mutex<()> = Mutex::new(());

pub(crate) type EventfulResponse = Result<(Option<Value>, Option<Value>), HostProtocolError>;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct JobStore {
    #[serde(default)]
    jobs: BTreeMap<String, JobRecord>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct JobRecord {
    id: String,
    name: String,
    state: JobState,
    generation: u64,
    started_at: u64,
    updated_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    progress: Option<JobProgressPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl JobRecord {
    fn snapshot(&self) -> JobSnapshotPayload {
        JobSnapshotPayload::new(
            JobHandlePayload::new(&self.id, self.generation, OWNER_SCOPE, self.state.clone()),
            &self.name,
            self.state.clone(),
            self.started_at,
            self.updated_at,
            self.progress.clone(),
            self.reason.clone(),
        )
    }
}

pub(crate) fn start_with_event(payload: Option<Value>, timestamp: u64) -> EventfulResponse {
    let input = decode_payload::<JobStartPayload>(payload, host_protocol::JOB_START_METHOD)?;
    validate_start(&input, host_protocol::JOB_START_METHOD)?;
    let snapshot = mutate_store(host_protocol::JOB_START_METHOD, |store| {
        let id = input
            .job_id()
            .map(str::to_string)
            .unwrap_or_else(|| format!("job-{}", Uuid::new_v4()));
        if store.jobs.contains_key(&id) {
            return Err(already_exists(&id, host_protocol::JOB_START_METHOD));
        }
        let record = JobRecord {
            id: id.clone(),
            name: input.name().to_string(),
            state: JobState::Running,
            generation: 0,
            started_at: timestamp,
            updated_at: timestamp,
            progress: None,
            reason: None,
        };
        let snapshot = record.snapshot();
        store.jobs.insert(id, record);
        Ok(snapshot)
    })?;
    response_with_event(
        snapshot,
        JobEventPhase::Started,
        timestamp,
        host_protocol::JOB_START_METHOD,
    )
}

pub(crate) fn pause_with_event(payload: Option<Value>, timestamp: u64) -> EventfulResponse {
    control_with_event(
        payload,
        JobState::Paused,
        JobEventPhase::Paused,
        timestamp,
        host_protocol::JOB_PAUSE_METHOD,
    )
}

pub(crate) fn resume_with_event(payload: Option<Value>, timestamp: u64) -> EventfulResponse {
    control_with_event(
        payload,
        JobState::Running,
        JobEventPhase::Resumed,
        timestamp,
        host_protocol::JOB_RESUME_METHOD,
    )
}

pub(crate) fn retry_with_event(payload: Option<Value>, timestamp: u64) -> EventfulResponse {
    control_with_event(
        payload,
        JobState::Running,
        JobEventPhase::Retried,
        timestamp,
        host_protocol::JOB_RETRY_METHOD,
    )
}

pub(crate) fn interrupt_with_event(payload: Option<Value>, timestamp: u64) -> EventfulResponse {
    control_with_event(
        payload,
        JobState::Interrupted,
        JobEventPhase::Interrupted,
        timestamp,
        host_protocol::JOB_INTERRUPT_METHOD,
    )
}

pub(crate) fn succeed_with_event(payload: Option<Value>, timestamp: u64) -> EventfulResponse {
    control_with_event(
        payload,
        JobState::Succeeded,
        JobEventPhase::Succeeded,
        timestamp,
        host_protocol::JOB_SUCCEED_METHOD,
    )
}

pub(crate) fn fail_with_event(payload: Option<Value>, timestamp: u64) -> EventfulResponse {
    control_with_event(
        payload,
        JobState::Failed,
        JobEventPhase::Failed,
        timestamp,
        host_protocol::JOB_FAIL_METHOD,
    )
}

pub(crate) fn report_progress_with_event(
    payload: Option<Value>,
    timestamp: u64,
) -> EventfulResponse {
    let input = decode_payload::<JobProgressReportPayload>(
        payload,
        host_protocol::JOB_REPORT_PROGRESS_METHOD,
    )?;
    validate_progress(&input, host_protocol::JOB_REPORT_PROGRESS_METHOD)?;
    let snapshot = mutate_store(host_protocol::JOB_REPORT_PROGRESS_METHOD, |store| {
        let record = job_mut(
            store,
            input.job_id(),
            host_protocol::JOB_REPORT_PROGRESS_METHOD,
        )?;
        reject_terminal(
            &record.state,
            "progress",
            host_protocol::JOB_REPORT_PROGRESS_METHOD,
        )?;
        record.generation += 1;
        record.updated_at = timestamp;
        record.progress = Some(JobProgressPayload::new(
            input.completed(),
            input.total(),
            input.message().map(str::to_string),
            timestamp,
        ));
        Ok(record.snapshot())
    })?;
    response_with_event(
        snapshot,
        JobEventPhase::Progress,
        timestamp,
        host_protocol::JOB_REPORT_PROGRESS_METHOD,
    )
}

pub(crate) fn get(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<JobGetPayload>(payload, host_protocol::JOB_GET_METHOD)?;
    validate_get(&input, host_protocol::JOB_GET_METHOD)?;
    let snapshot = read_store(host_protocol::JOB_GET_METHOD)?
        .jobs
        .get(input.job_id())
        .ok_or_else(|| {
            HostProtocolError::invalid_argument(
                "jobId",
                format!("job not found: {}", input.job_id()),
                host_protocol::JOB_GET_METHOD,
            )
        })?
        .snapshot();
    encode_payload(snapshot, host_protocol::JOB_GET_METHOD)
}

pub(crate) fn is_supported() -> Result<Option<Value>, HostProtocolError> {
    let supported = match store_file(host_protocol::JOB_IS_SUPPORTED_METHOD)
        .and_then(|path| ensure_store_file(&path, host_protocol::JOB_IS_SUPPORTED_METHOD))
    {
        Ok(()) => JobSupportedPayload::supported(),
        Err(_) => JobSupportedPayload::unsupported(STORE_UNAVAILABLE_REASON),
    };
    encode_payload(supported, host_protocol::JOB_IS_SUPPORTED_METHOD)
}

fn control_with_event(
    payload: Option<Value>,
    state: JobState,
    phase: JobEventPhase,
    timestamp: u64,
    operation: &'static str,
) -> EventfulResponse {
    let input = decode_payload::<JobControlPayload>(payload, operation)?;
    validate_control(&input, operation)?;
    let snapshot = mutate_store(operation, |store| {
        let record = job_mut(store, input.job_id(), operation)?;
        reject_terminal(&record.state, state_name(&state), operation)?;
        record.generation += 1;
        record.state = state.clone();
        record.updated_at = timestamp;
        record.reason = input.reason().map(str::to_string);
        Ok(record.snapshot())
    })?;
    response_with_event(snapshot, phase, timestamp, operation)
}

fn response_with_event(
    snapshot: JobSnapshotPayload,
    phase: JobEventPhase,
    timestamp: u64,
    operation: &'static str,
) -> Result<(Option<Value>, Option<Value>), HostProtocolError> {
    let event = JobEventPayload::new(timestamp, phase, snapshot.clone());
    Ok((
        encode_payload(snapshot, operation)?,
        encode_payload(event, host_protocol::JOB_EVENT)?,
    ))
}

fn read_store(operation: &'static str) -> Result<JobStore, HostProtocolError> {
    let _guard = STORE_LOCK
        .lock()
        .map_err(|_| HostProtocolError::internal("job store lock poisoned", operation))?;
    let path = store_file(operation)?;
    ensure_store_file(&path, operation)?;
    read_store_unlocked(&path, operation)
}

fn mutate_store<F>(operation: &'static str, f: F) -> Result<JobSnapshotPayload, HostProtocolError>
where
    F: FnOnce(&mut JobStore) -> Result<JobSnapshotPayload, HostProtocolError>,
{
    let _guard = STORE_LOCK
        .lock()
        .map_err(|_| HostProtocolError::internal("job store lock poisoned", operation))?;
    let path = store_file(operation)?;
    ensure_store_file(&path, operation)?;
    let mut store = read_store_unlocked(&path, operation)?;
    let snapshot = f(&mut store)?;
    write_store_unlocked(&path, &store, operation)?;
    Ok(snapshot)
}

fn read_store_unlocked(
    path: &PathBuf,
    operation: &'static str,
) -> Result<JobStore, HostProtocolError> {
    let bytes = fs::read(path).map_err(|error| {
        HostProtocolError::internal(format!("failed to read job store: {error}"), operation)
    })?;
    if bytes.is_empty() {
        return Ok(JobStore::default());
    }
    serde_json::from_slice(&bytes).map_err(|error| {
        HostProtocolError::internal(format!("failed to decode job store: {error}"), operation)
    })
}

fn write_store_unlocked(
    path: &Path,
    store: &JobStore,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let bytes = serde_json::to_vec_pretty(store).map_err(|error| {
        HostProtocolError::internal(format!("failed to encode job store: {error}"), operation)
    })?;
    let temp_path = temp_store_path(path);
    fs::write(&temp_path, bytes).map_err(|error| {
        HostProtocolError::internal(format!("failed to write job store: {error}"), operation)
    })?;
    fs::rename(&temp_path, path).map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        HostProtocolError::internal(format!("failed to replace job store: {error}"), operation)
    })
}

fn temp_store_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(STORE_FILE);
    path.with_file_name(format!("{file_name}.{}.tmp", Uuid::new_v4()))
}

fn ensure_store_file(path: &PathBuf, operation: &'static str) -> Result<(), HostProtocolError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            HostProtocolError::unsupported(
                format!("{STORE_UNAVAILABLE_REASON}: {error}"),
                operation,
            )
        })?;
    }
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map(|_| ())
        .map_err(|error| {
            HostProtocolError::unsupported(
                format!("{STORE_UNAVAILABLE_REASON}: {error}"),
                operation,
            )
        })
}

fn store_file(operation: &'static str) -> Result<PathBuf, HostProtocolError> {
    if let Some(path) = std::env::var_os(STORE_ENV).map(PathBuf::from) {
        return Ok(path);
    }
    default_store_root()
        .map(|root| root.join(STORE_FILE))
        .ok_or_else(|| HostProtocolError::unsupported(STORE_UNAVAILABLE_REASON, operation))
}

#[cfg(target_os = "macos")]
fn default_store_root() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from).map(|home| {
        home.join("Library")
            .join("Application Support")
            .join(STORE_DIR)
            .join(STORE_ROOT)
    })
}

#[cfg(target_os = "windows")]
fn default_store_root() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA")
        .or_else(|| std::env::var_os("APPDATA"))
        .map(PathBuf::from)
        .map(|data| data.join(STORE_DIR).join(STORE_ROOT))
}

#[cfg(target_os = "linux")]
fn default_store_root() -> Option<PathBuf> {
    std::env::var_os("XDG_STATE_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME")
                .map(PathBuf::from)
                .map(|home| home.join(".local").join("state"))
        })
        .map(|state| state.join(STORE_DIR).join(STORE_ROOT))
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn default_store_root() -> Option<PathBuf> {
    None
}

fn job_mut<'a>(
    store: &'a mut JobStore,
    job_id: &str,
    operation: &'static str,
) -> Result<&'a mut JobRecord, HostProtocolError> {
    store.jobs.get_mut(job_id).ok_or_else(|| {
        HostProtocolError::invalid_argument("jobId", format!("job not found: {job_id}"), operation)
    })
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
        HostProtocolError::internal(format!("failed to encode job payload: {error}"), operation)
    })
}

fn validate_start(
    input: &JobStartPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if let Some(job_id) = input.job_id() {
        validate_non_empty("jobId", job_id, operation)?;
    }
    validate_non_empty("name", input.name(), operation)?;
    if let Some(trace_id) = input.trace_id() {
        validate_non_empty("traceId", trace_id, operation)?;
    }
    Ok(())
}

fn validate_control(
    input: &JobControlPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_non_empty("jobId", input.job_id(), operation)?;
    if let Some(reason) = input.reason() {
        validate_no_control("reason", reason, operation)?;
    }
    if let Some(trace_id) = input.trace_id() {
        validate_non_empty("traceId", trace_id, operation)?;
    }
    Ok(())
}

fn validate_progress(
    input: &JobProgressReportPayload,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    validate_non_empty("jobId", input.job_id(), operation)?;
    if !input.completed().is_finite() || input.completed() < 0.0 {
        return Err(HostProtocolError::invalid_argument(
            "completed",
            "must be a finite non-negative number",
            operation,
        ));
    }
    if let Some(total) = input.total() {
        if !total.is_finite() || total <= 0.0 {
            return Err(HostProtocolError::invalid_argument(
                "total",
                "must be a positive finite number",
                operation,
            ));
        }
        if input.completed() > total {
            return Err(HostProtocolError::invalid_argument(
                "completed",
                "must not exceed total",
                operation,
            ));
        }
    }
    if let Some(message) = input.message() {
        validate_no_control("message", message, operation)?;
    }
    if let Some(trace_id) = input.trace_id() {
        validate_non_empty("traceId", trace_id, operation)?;
    }
    Ok(())
}

fn validate_get(input: &JobGetPayload, operation: &'static str) -> Result<(), HostProtocolError> {
    validate_non_empty("jobId", input.job_id(), operation)?;
    if let Some(trace_id) = input.trace_id() {
        validate_non_empty("traceId", trace_id, operation)?;
    }
    Ok(())
}

fn validate_non_empty(
    field: &str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if value.trim().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be non-empty",
            operation,
        ));
    }
    validate_no_control(field, value, operation)
}

fn validate_no_control(
    field: &str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if value.chars().any(char::is_control) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not contain control characters",
            operation,
        ));
    }
    Ok(())
}

fn already_exists(resource: &str, operation: &'static str) -> HostProtocolError {
    HostProtocolError::AlreadyExists {
        resource: resource.to_string(),
        message: format!("resource already exists: {resource}"),
        operation: operation.to_string(),
        platform: None,
        code: None,
        cause: None,
        recoverable: HostProtocolError::recoverable_default("AlreadyExists").expect("known tag"),
        remediation: None,
        docs_url: None,
    }
}

fn invalid_state(current: &str, attempted: &str, operation: &'static str) -> HostProtocolError {
    HostProtocolError::InvalidState {
        current: current.to_string(),
        attempted: attempted.to_string(),
        message: format!("invalid state transition from {current} to {attempted}"),
        operation: operation.to_string(),
        platform: None,
        code: None,
        cause: None,
        recoverable: HostProtocolError::recoverable_default("InvalidState").expect("known tag"),
        remediation: None,
        docs_url: None,
    }
}

fn reject_terminal(
    current: &JobState,
    attempted: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if is_terminal(current) {
        return Err(invalid_state(state_name(current), attempted, operation));
    }
    Ok(())
}

fn is_terminal(state: &JobState) -> bool {
    matches!(
        state,
        JobState::Interrupted | JobState::Succeeded | JobState::Failed
    )
}

fn state_name(state: &JobState) -> &'static str {
    match state {
        JobState::Running => "running",
        JobState::Paused => "paused",
        JobState::Interrupted => "interrupted",
        JobState::Succeeded => "succeeded",
        JobState::Failed => "failed",
    }
}
