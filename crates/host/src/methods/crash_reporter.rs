#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{
    CrashReporterBreadcrumbPayload, CrashReporterFlushPayload, CrashReporterGetReportsPayload,
    CrashReporterReportPayload, CrashReporterStartPayload, HostProtocolError,
};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, to_value, Value};
use std::{
    fs,
    path::PathBuf,
    sync::{LazyLock, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

const CRASH_REPORTER_DIR_ENV: &str = "EFFECT_DESKTOP_CRASH_REPORT_DIR";
const CRASH_REPORTER_DIR_NAME: &str = "effect-desktop-crash-reports";
const CRASH_REPORTER_MAX_REPORTS: usize = 20;

static CRASH_REPORTER_STATE: LazyLock<Mutex<CrashReporterState>> =
    LazyLock::new(|| Mutex::new(CrashReporterState::default()));
#[cfg(test)]
static CRASH_REPORTER_TEST_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

#[cfg(test)]
pub(crate) struct CrashReporterTestEnv {
    previous_dir: Option<std::ffi::OsString>,
    pub(crate) dir: PathBuf,
    _guard: std::sync::MutexGuard<'static, ()>,
}

#[cfg(test)]
impl CrashReporterTestEnv {
    pub(crate) fn new(name: &str) -> Self {
        let guard = CRASH_REPORTER_TEST_LOCK
            .lock()
            .expect("crash reporter test lock should lock");
        let previous_dir = std::env::var_os(CRASH_REPORTER_DIR_ENV);
        let dir = std::env::temp_dir().join(format!(
            "effect-desktop-crash-reporter-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::env::set_var(CRASH_REPORTER_DIR_ENV, &dir);
        *CRASH_REPORTER_STATE
            .lock()
            .expect("crash reporter state should lock") = Default::default();
        Self {
            previous_dir,
            dir,
            _guard: guard,
        }
    }
}

#[cfg(test)]
impl Drop for CrashReporterTestEnv {
    fn drop(&mut self) {
        *CRASH_REPORTER_STATE
            .lock()
            .expect("crash reporter state should lock") = Default::default();
        match &self.previous_dir {
            Some(value) => std::env::set_var(CRASH_REPORTER_DIR_ENV, value),
            None => std::env::remove_var(CRASH_REPORTER_DIR_ENV),
        }
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

#[derive(Default)]
struct CrashReporterState {
    started: bool,
    breadcrumbs: Vec<BreadcrumbRecord>,
    reports: Vec<CrashReporterReportPayload>,
    next_report_index: u64,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BreadcrumbRecord {
    category: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    details: Option<Value>,
    timestamp: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BreadcrumbReportArtifact {
    kind: String,
    report_id: String,
    created_at: u64,
    uploaded: bool,
    breadcrumbs: Vec<BreadcrumbRecord>,
}

pub(crate) fn start(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    reject_null_field(
        payload.as_ref(),
        "enabled",
        host_protocol::CRASH_REPORTER_START_METHOD,
    )?;
    let _input = decode_payload::<CrashReporterStartPayload>(
        payload,
        host_protocol::CRASH_REPORTER_START_METHOD,
    )?;
    let enabled = _input.enabled().unwrap_or(true);
    ensure_report_dir(host_protocol::CRASH_REPORTER_START_METHOD)?;
    let mut state = CRASH_REPORTER_STATE.lock().map_err(|_| {
        host_failure(
            "crash reporter state lock poisoned",
            host_protocol::CRASH_REPORTER_START_METHOD,
        )
    })?;
    state.started = enabled;
    state.breadcrumbs.clear();
    Ok(None)
}

pub(crate) fn record_breadcrumb(
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    reject_null_field(
        payload.as_ref(),
        "timestamp",
        host_protocol::CRASH_REPORTER_RECORD_BREADCRUMB_METHOD,
    )?;
    let input = decode_payload::<CrashReporterBreadcrumbPayload>(
        payload,
        host_protocol::CRASH_REPORTER_RECORD_BREADCRUMB_METHOD,
    )?;
    validate_category(
        input.category(),
        host_protocol::CRASH_REPORTER_RECORD_BREADCRUMB_METHOD,
    )?;
    let mut state = CRASH_REPORTER_STATE.lock().map_err(|_| {
        host_failure(
            "crash reporter state lock poisoned",
            host_protocol::CRASH_REPORTER_RECORD_BREADCRUMB_METHOD,
        )
    })?;
    if !state.started {
        return Err(invalid_state(
            "stopped",
            "record-breadcrumb",
            host_protocol::CRASH_REPORTER_RECORD_BREADCRUMB_METHOD,
        ));
    }
    state.breadcrumbs.push(BreadcrumbRecord {
        category: input.category().to_string(),
        message: input.message().to_string(),
        details: input.details().cloned(),
        timestamp: breadcrumb_timestamp(&input)?,
    });
    Ok(None)
}

pub(crate) fn flush(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    reject_unexpected_payload(payload, host_protocol::CRASH_REPORTER_FLUSH_METHOD)?;
    let mut state = CRASH_REPORTER_STATE.lock().map_err(|_| {
        host_failure(
            "crash reporter state lock poisoned",
            host_protocol::CRASH_REPORTER_FLUSH_METHOD,
        )
    })?;
    if !state.started {
        return Err(invalid_state(
            "stopped",
            "flush",
            host_protocol::CRASH_REPORTER_FLUSH_METHOD,
        ));
    }
    let flushed = state.breadcrumbs.len() as u64;
    if flushed > 0 {
        let report = write_breadcrumb_report(&mut state)?;
        state.reports.push(report);
    }
    encode_payload(
        CrashReporterFlushPayload::new(flushed),
        host_protocol::CRASH_REPORTER_FLUSH_METHOD,
    )
}

pub(crate) fn get_reports(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    reject_unexpected_payload(payload, host_protocol::CRASH_REPORTER_GET_REPORTS_METHOD)?;
    let reports = reports_snapshot(host_protocol::CRASH_REPORTER_GET_REPORTS_METHOD)?;
    encode_payload(
        CrashReporterGetReportsPayload::new(reports),
        host_protocol::CRASH_REPORTER_GET_REPORTS_METHOD,
    )
}

pub(crate) fn diagnostics_reports() -> Result<Vec<CrashReporterReportPayload>, HostProtocolError> {
    reports_snapshot(host_protocol::DIAGNOSTICS_BUNDLE_COLLECT_METHOD)
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
        host_failure(
            format!("failed to encode crash reporter payload: {error}"),
            operation,
        )
    })
}

fn reject_unexpected_payload(
    payload: Option<Value>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    match payload {
        None | Some(Value::Null) => Ok(()),
        Some(_) => Err(HostProtocolError::invalid_argument(
            "payload",
            "must be omitted",
            operation,
        )),
    }
}

fn reject_null_field(
    payload: Option<&Value>,
    field: &'static str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if matches!(
        payload
            .and_then(Value::as_object)
            .and_then(|object| object.get(field)),
        Some(Value::Null)
    ) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be omitted instead of null",
            operation,
        ));
    }
    Ok(())
}

fn validate_category(category: &str, operation: &'static str) -> Result<(), HostProtocolError> {
    if category.is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "category",
            "must be non-empty",
            operation,
        ));
    }
    if category.chars().any(is_ascii_control_or_del) {
        return Err(HostProtocolError::invalid_argument(
            "category",
            "must not include ASCII control characters",
            operation,
        ));
    }
    Ok(())
}

fn is_ascii_control_or_del(character: char) -> bool {
    matches!(character, '\u{0000}'..='\u{001f}' | '\u{007f}')
}

fn breadcrumb_timestamp(input: &CrashReporterBreadcrumbPayload) -> Result<u64, HostProtocolError> {
    match input.timestamp() {
        Some(timestamp) if timestamp.is_finite() && timestamp >= 0.0 => Ok(timestamp as u64),
        Some(_) => Err(HostProtocolError::invalid_argument(
            "timestamp",
            "must be a non-negative finite number",
            host_protocol::CRASH_REPORTER_RECORD_BREADCRUMB_METHOD,
        )),
        None => timestamp_millis(host_protocol::CRASH_REPORTER_RECORD_BREADCRUMB_METHOD),
    }
}

fn write_breadcrumb_report(
    state: &mut CrashReporterState,
) -> Result<CrashReporterReportPayload, HostProtocolError> {
    let created_at = timestamp_millis(host_protocol::CRASH_REPORTER_FLUSH_METHOD)?;
    state.next_report_index += 1;
    let report_id = format!("breadcrumb-{created_at}-{}", state.next_report_index);
    let dir = ensure_report_dir(host_protocol::CRASH_REPORTER_FLUSH_METHOD)?;
    let artifact_path = dir.join(format!("{report_id}.json"));
    let body = json!({
        "kind": "breadcrumb-report",
        "reportId": report_id,
        "createdAt": created_at,
        "uploaded": false,
        "breadcrumbs": state.breadcrumbs,
    });
    let bytes = serde_json::to_vec_pretty(&body).map_err(|error| {
        host_failure(
            format!("failed to encode crash reporter artifact: {error}"),
            host_protocol::CRASH_REPORTER_FLUSH_METHOD,
        )
    })?;
    write_report_bytes(&artifact_path, &bytes)?;
    prune_report_artifacts(host_protocol::CRASH_REPORTER_FLUSH_METHOD)?;
    state.breadcrumbs.clear();
    Ok(CrashReporterReportPayload::new(
        report_id,
        artifact_path.display().to_string(),
        created_at,
        bytes.len() as u64,
        false,
    ))
}

fn reports_snapshot(
    operation: &'static str,
) -> Result<Vec<CrashReporterReportPayload>, HostProtocolError> {
    let reports = discover_report_artifacts(operation)?;
    CRASH_REPORTER_STATE
        .lock()
        .map_err(|_| host_failure("crash reporter state lock poisoned", operation))
        .map(|mut state| {
            state.reports = reports;
            state.reports.clone()
        })
}

fn write_report_bytes(path: &PathBuf, bytes: &[u8]) -> Result<(), HostProtocolError> {
    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, bytes).map_err(|error| {
        host_failure(
            format!("failed to write crash reporter artifact: {error}"),
            host_protocol::CRASH_REPORTER_FLUSH_METHOD,
        )
    })?;
    fs::rename(&temp_path, path).map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        host_failure(
            format!("failed to publish crash reporter artifact: {error}"),
            host_protocol::CRASH_REPORTER_FLUSH_METHOD,
        )
    })
}

fn discover_report_artifacts(
    operation: &'static str,
) -> Result<Vec<CrashReporterReportPayload>, HostProtocolError> {
    let dir = report_dir();
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(host_failure(
                format!("failed to read crash reporter directory: {error}"),
                operation,
            ));
        }
    };
    let mut reports = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| {
            host_failure(
                format!("failed to read crash reporter directory entry: {error}"),
                operation,
            )
        })?;
        let path = entry.path();
        if !is_breadcrumb_artifact_path(&path) {
            continue;
        }
        let file_type = entry.file_type().map_err(|error| {
            host_failure(
                format!("failed to inspect crash reporter artifact: {error}"),
                operation,
            )
        })?;
        if !file_type.is_file() {
            continue;
        }
        let metadata = entry.metadata().map_err(|error| {
            host_failure(
                format!("failed to stat crash reporter artifact: {error}"),
                operation,
            )
        })?;
        let bytes = fs::read(&path).map_err(|error| {
            host_failure(
                format!("failed to read crash reporter artifact: {error}"),
                operation,
            )
        })?;
        let artifact =
            serde_json::from_slice::<BreadcrumbReportArtifact>(&bytes).map_err(|error| {
                host_failure(
                    format!("failed to decode crash reporter artifact: {error}"),
                    operation,
                )
            })?;
        validate_artifact(&artifact, operation)?;
        reports.push(CrashReporterReportPayload::new(
            artifact.report_id,
            path.display().to_string(),
            artifact.created_at,
            metadata.len(),
            artifact.uploaded,
        ));
    }
    reports.sort_by(|left, right| {
        left.created_at()
            .cmp(&right.created_at())
            .then_with(|| left.report_id().cmp(right.report_id()))
    });
    Ok(reports)
}

fn prune_report_artifacts(operation: &'static str) -> Result<(), HostProtocolError> {
    let dir = report_dir();
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(host_failure(
                format!("failed to read crash reporter directory for retention: {error}"),
                operation,
            ));
        }
    };
    let mut reports = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| {
            host_failure(
                format!("failed to read crash reporter retention entry: {error}"),
                operation,
            )
        })?;
        let path = entry.path();
        if !is_breadcrumb_artifact_path(&path) {
            continue;
        }
        let file_type = entry.file_type().map_err(|error| {
            host_failure(
                format!("failed to inspect crash reporter retention artifact: {error}"),
                operation,
            )
        })?;
        if !file_type.is_file() {
            continue;
        }
        let metadata = entry.metadata().map_err(|error| {
            host_failure(
                format!("failed to stat crash reporter retention artifact: {error}"),
                operation,
            )
        })?;
        let modified_at = metadata
            .modified()
            .ok()
            .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or(0);
        reports.push((modified_at, path));
    }
    if reports.len() <= CRASH_REPORTER_MAX_REPORTS {
        return Ok(());
    }
    reports.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
    let remove_count = reports.len() - CRASH_REPORTER_MAX_REPORTS;
    for (_, path) in reports.into_iter().take(remove_count) {
        fs::remove_file(&path).map_err(|error| {
            host_failure(
                format!("failed to remove old crash reporter artifact: {error}"),
                operation,
            )
        })?;
    }
    Ok(())
}

fn is_breadcrumb_artifact_path(path: &std::path::Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| {
            name.starts_with("breadcrumb-") && name.ends_with(".json") && !name.ends_with(".tmp")
        })
}

fn validate_artifact(
    artifact: &BreadcrumbReportArtifact,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if artifact.kind != "breadcrumb-report" {
        return Err(host_failure(
            "crash reporter artifact has unexpected kind",
            operation,
        ));
    }
    if artifact.report_id.is_empty() {
        return Err(host_failure(
            "crash reporter artifact reportId is empty",
            operation,
        ));
    }
    if artifact.report_id.chars().any(is_ascii_control_or_del) {
        return Err(host_failure(
            "crash reporter artifact reportId contains control characters",
            operation,
        ));
    }
    if artifact.breadcrumbs.is_empty() {
        return Err(host_failure(
            "crash reporter artifact has no breadcrumbs",
            operation,
        ));
    }
    Ok(())
}

fn ensure_report_dir(operation: &'static str) -> Result<PathBuf, HostProtocolError> {
    let dir = report_dir();
    fs::create_dir_all(&dir).map_err(|error| {
        host_failure(
            format!("failed to create crash reporter directory: {error}"),
            operation,
        )
    })?;
    Ok(dir)
}

fn report_dir() -> PathBuf {
    if let Some(path) = std::env::var_os(CRASH_REPORTER_DIR_ENV) {
        return PathBuf::from(path);
    }
    std::env::temp_dir().join(CRASH_REPORTER_DIR_NAME)
}

fn timestamp_millis(operation: &'static str) -> Result<u64, HostProtocolError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .map_err(|error| {
            host_failure(
                format!("system time is before Unix epoch: {error}"),
                operation,
            )
        })
}

fn invalid_state(current: &str, attempted: &str, operation: &'static str) -> HostProtocolError {
    HostProtocolError::InvalidState {
        message: format!("cannot {attempted} while crash reporter is {current}"),
        operation: operation.to_string(),
        platform: None,
        code: None,
        cause: None,
        recoverable: HostProtocolError::recoverable_default("InvalidState").expect("known tag"),
        remediation: None,
        docs_url: None,
        current: current.to_string(),
        attempted: attempted.to_string(),
    }
}

fn host_failure(message: impl Into<String>, operation: &'static str) -> HostProtocolError {
    HostProtocolError::internal(message, operation)
}

#[cfg(test)]
mod tests {
    use super::{
        diagnostics_reports, flush, get_reports, record_breadcrumb, start, CrashReporterTestEnv,
        CRASH_REPORTER_MAX_REPORTS, CRASH_REPORTER_STATE,
    };
    use host_protocol::HostProtocolError;
    use serde_json::json;

    #[test]
    fn crash_reporter_flushes_breadcrumb_artifacts() {
        let env = CrashReporterTestEnv::new("flushes-breadcrumbs");
        assert_eq!(
            start(Some(json!({ "enabled": true }))).expect("start"),
            None
        );
        assert_eq!(
            record_breadcrumb(Some(json!({
                "category": "startup",
                "message": "renderer ready",
                "details": { "windowId": "window-1" },
                "timestamp": 1710000000000.0
            })))
            .expect("breadcrumb"),
            None
        );
        assert_eq!(flush(None).expect("flush"), Some(json!({ "flushed": 1 })));
        let reports = get_reports(None)
            .expect("get reports")
            .expect("reports payload");
        let report_path = reports["reports"][0]["artifactPath"]
            .as_str()
            .expect("artifact path should be a string");
        assert!(report_path.starts_with(&env.dir.display().to_string()));
        assert!(std::path::Path::new(report_path).is_file());
        assert_eq!(diagnostics_reports().expect("diagnostics reports").len(), 1);
    }

    #[test]
    fn crash_reporter_discovers_breadcrumb_artifacts_after_state_reset() {
        let env = CrashReporterTestEnv::new("discovers-breadcrumbs");
        start(Some(json!({ "enabled": true }))).expect("start");
        record_breadcrumb(Some(json!({
            "category": "startup",
            "message": "renderer ready",
            "timestamp": 1710000000000.0
        })))
        .expect("breadcrumb");
        flush(None).expect("flush");

        *CRASH_REPORTER_STATE
            .lock()
            .expect("crash reporter state should lock") = Default::default();

        let reports = get_reports(None)
            .expect("get reports")
            .expect("reports payload");
        assert_eq!(
            reports["reports"].as_array().expect("reports array").len(),
            1
        );
        let report_path = reports["reports"][0]["artifactPath"]
            .as_str()
            .expect("artifact path should be a string");
        assert!(report_path.starts_with(&env.dir.display().to_string()));
        assert_eq!(diagnostics_reports().expect("diagnostics reports").len(), 1);
    }

    #[test]
    fn crash_reporter_prunes_old_breadcrumb_artifacts() {
        let env = CrashReporterTestEnv::new("prunes-old-artifacts");
        start(Some(json!({ "enabled": true }))).expect("start");
        for index in 0..(CRASH_REPORTER_MAX_REPORTS + 3) {
            record_breadcrumb(Some(json!({
                "category": "retention",
                "message": format!("breadcrumb {index}"),
                "timestamp": 1710000000000.0 + index as f64
            })))
            .expect("breadcrumb");
            flush(None).expect("flush");
        }

        let reports = get_reports(None)
            .expect("get reports")
            .expect("reports payload");
        assert_eq!(
            reports["reports"].as_array().expect("reports array").len(),
            CRASH_REPORTER_MAX_REPORTS
        );
        let artifact_count = std::fs::read_dir(&env.dir)
            .expect("report dir should be readable")
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .path()
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with("breadcrumb-") && name.ends_with(".json"))
            })
            .count();
        assert_eq!(artifact_count, CRASH_REPORTER_MAX_REPORTS);
    }

    #[test]
    fn crash_reporter_rejects_malformed_host_artifacts() {
        let env = CrashReporterTestEnv::new("rejects-malformed-artifact");
        std::fs::create_dir_all(&env.dir).expect("report dir");
        std::fs::write(env.dir.join("breadcrumb-1710000000000-1.json"), b"{")
            .expect("malformed artifact");

        assert_eq!(
            get_reports(None)
                .expect_err("malformed artifact should fail discovery")
                .tag(),
            "Internal"
        );
    }

    #[test]
    fn crash_reporter_rejects_record_and_flush_before_start() {
        let _env = CrashReporterTestEnv::new("not-started");
        assert_eq!(
            record_breadcrumb(Some(json!({ "category": "startup", "message": "ready" })))
                .expect_err("breadcrumb")
                .tag(),
            "InvalidState"
        );
        assert_eq!(flush(None).expect_err("flush").tag(), "InvalidState");
    }

    #[test]
    fn crash_reporter_start_disabled_stops_collection() {
        let _env = CrashReporterTestEnv::new("disabled");
        start(Some(json!({ "enabled": false }))).expect("start disabled");

        assert_eq!(
            record_breadcrumb(Some(json!({ "category": "startup", "message": "ready" })))
                .expect_err("breadcrumb")
                .tag(),
            "InvalidState"
        );
    }

    #[test]
    fn crash_reporter_rejects_malformed_payloads_before_state_changes() {
        let _env = CrashReporterTestEnv::new("malformed-payloads");
        assert_eq!(
            record_breadcrumb(Some(
                json!({ "category": "bad\ncategory", "message": "bad" })
            ))
            .expect_err("category"),
            HostProtocolError::invalid_argument(
                "category",
                "must not include ASCII control characters",
                host_protocol::CRASH_REPORTER_RECORD_BREADCRUMB_METHOD,
            )
        );
        assert_eq!(
            flush(Some(json!({}))).expect_err("payload"),
            HostProtocolError::invalid_argument(
                "payload",
                "must be omitted",
                host_protocol::CRASH_REPORTER_FLUSH_METHOD,
            )
        );
        assert_eq!(
            get_reports(Some(json!({}))).expect_err("payload"),
            HostProtocolError::invalid_argument(
                "payload",
                "must be omitted",
                host_protocol::CRASH_REPORTER_GET_REPORTS_METHOD,
            )
        );
    }

    #[test]
    fn crash_reporter_matches_typescript_optional_and_category_shape() {
        let _env = CrashReporterTestEnv::new("typescript-shape");
        assert_eq!(
            start(Some(json!({ "enabled": null }))).expect_err("enabled"),
            HostProtocolError::invalid_argument(
                "enabled",
                "must be omitted instead of null",
                host_protocol::CRASH_REPORTER_START_METHOD,
            )
        );
        assert_eq!(
            record_breadcrumb(Some(json!({
                "category": "startup",
                "message": "renderer ready",
                "timestamp": null
            })))
            .expect_err("timestamp"),
            HostProtocolError::invalid_argument(
                "timestamp",
                "must be omitted instead of null",
                host_protocol::CRASH_REPORTER_RECORD_BREADCRUMB_METHOD,
            )
        );
        assert_eq!(
            record_breadcrumb(Some(
                json!({ "category": "ok\u{0080}", "message": "valid" })
            ))
            .expect_err("breadcrumb")
            .tag(),
            "InvalidState"
        );
    }
}
