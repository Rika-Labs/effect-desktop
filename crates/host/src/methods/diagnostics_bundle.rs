#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{
    DiagnosticsBundleCollectPayload, DiagnosticsBundleCollectResultPayload,
    DiagnosticsBundleRedactPayload, DiagnosticsBundleRedactResultPayload,
    DiagnosticsBundleRedactionEvidencePayload, DiagnosticsBundleRedactionPolicyPayload,
    DiagnosticsBundleSourceKind, DiagnosticsBundleSourceSummaryPayload,
    DiagnosticsBundleSupportedPayload, DiagnosticsBundleWritePayload,
    DiagnosticsBundleWriteResultPayload, HostProtocolError,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, to_value, Map, Value};
use std::{
    collections::{BTreeMap, HashMap},
    fs,
    path::Path,
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

const REDACTION_POLICY_ID: &str = "host-secret-patterns";
const REDACTED_VALUE: &str = "<redacted:redacted>";

static BUNDLES: OnceLock<Mutex<HashMap<String, BundleRecord>>> = OnceLock::new();

pub(crate) fn collect(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<DiagnosticsBundleCollectPayload>(
        payload,
        host_protocol::DIAGNOSTICS_BUNDLE_COLLECT_METHOD,
    )?;
    if let Some(bundle_id) = input.bundle_id() {
        validate_non_empty(
            "bundleId",
            bundle_id,
            host_protocol::DIAGNOSTICS_BUNDLE_COLLECT_METHOD,
        )?;
    }
    if let Some(trace_id) = input.trace_id() {
        validate_non_empty(
            "traceId",
            trace_id,
            host_protocol::DIAGNOSTICS_BUNDLE_COLLECT_METHOD,
        )?;
    }

    let collected_at = timestamp_millis()?;
    let bundle_id = input
        .bundle_id()
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| format!("diagnostics-{collected_at}"));
    let sources = if input.sources().is_empty() {
        default_sources()
    } else {
        input.sources().to_vec()
    };
    let summaries = sources
        .iter()
        .copied()
        .map(|source| source_summary(source, Vec::new()))
        .collect::<Vec<_>>();
    let artifacts = sources
        .iter()
        .copied()
        .map(|source| {
            (
                source_key(source),
                collect_artifact(source, collected_at, input.trace_id()),
            )
        })
        .collect::<BTreeMap<_, _>>();

    let record = BundleRecord {
        bundle_id: bundle_id.clone(),
        collected_at,
        sources: summaries.clone(),
        artifacts,
    };
    bundles()
        .lock()
        .map_err(|_| {
            host_failure(
                "diagnostics bundle store lock poisoned",
                host_protocol::DIAGNOSTICS_BUNDLE_COLLECT_METHOD,
            )
        })?
        .insert(bundle_id.clone(), record);

    encode_payload(
        DiagnosticsBundleCollectResultPayload::new(bundle_id, collected_at, summaries),
        host_protocol::DIAGNOSTICS_BUNDLE_COLLECT_METHOD,
    )
}

pub(crate) fn redact(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<DiagnosticsBundleRedactPayload>(
        payload,
        host_protocol::DIAGNOSTICS_BUNDLE_REDACT_METHOD,
    )?;
    validate_non_empty(
        "bundleId",
        input.bundle_id(),
        host_protocol::DIAGNOSTICS_BUNDLE_REDACT_METHOD,
    )?;

    let redacted = redact_value(input.payload().clone());
    let policy = redaction_policy(redacted.evidence);
    let mut store = bundles().lock().map_err(|_| {
        host_failure(
            "diagnostics bundle store lock poisoned",
            host_protocol::DIAGNOSTICS_BUNDLE_REDACT_METHOD,
        )
    })?;
    let Some(record) = store.get_mut(input.bundle_id()) else {
        return Err(invalid_state(
            "missing",
            "redact",
            host_protocol::DIAGNOSTICS_BUNDLE_REDACT_METHOD,
        ));
    };
    upsert_summary(record, input.source(), policy.clone());
    record
        .artifacts
        .insert(source_key(input.source()), redacted.value.clone());

    encode_payload(
        DiagnosticsBundleRedactResultPayload::new(
            input.bundle_id(),
            input.source(),
            redacted.value,
            policy,
        ),
        host_protocol::DIAGNOSTICS_BUNDLE_REDACT_METHOD,
    )
}

pub(crate) fn write(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<DiagnosticsBundleWritePayload>(
        payload,
        host_protocol::DIAGNOSTICS_BUNDLE_WRITE_METHOD,
    )?;
    validate_non_empty(
        "bundleId",
        input.bundle_id(),
        host_protocol::DIAGNOSTICS_BUNDLE_WRITE_METHOD,
    )?;
    validate_non_empty(
        "destinationPath",
        input.destination_path(),
        host_protocol::DIAGNOSTICS_BUNDLE_WRITE_METHOD,
    )?;
    if let Some(trace_id) = input.trace_id() {
        validate_non_empty(
            "traceId",
            trace_id,
            host_protocol::DIAGNOSTICS_BUNDLE_WRITE_METHOD,
        )?;
    }

    let record = bundles()
        .lock()
        .map_err(|_| {
            host_failure(
                "diagnostics bundle store lock poisoned",
                host_protocol::DIAGNOSTICS_BUNDLE_WRITE_METHOD,
            )
        })?
        .get(input.bundle_id())
        .cloned()
        .ok_or_else(|| {
            invalid_state(
                "missing",
                "write",
                host_protocol::DIAGNOSTICS_BUNDLE_WRITE_METHOD,
            )
        })?;
    let body = serde_json::to_vec_pretty(&record).map_err(|error| {
        host_failure(
            format!("failed to encode diagnostics bundle: {error}"),
            host_protocol::DIAGNOSTICS_BUNDLE_WRITE_METHOD,
        )
    })?;
    let destination = Path::new(input.destination_path());
    if let Some(parent) = destination
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent).map_err(|error| {
            host_failure(
                format!("failed to create diagnostics bundle directory: {error}"),
                host_protocol::DIAGNOSTICS_BUNDLE_WRITE_METHOD,
            )
        })?;
    }
    fs::write(destination, &body).map_err(|error| {
        host_failure(
            format!("failed to write diagnostics bundle: {error}"),
            host_protocol::DIAGNOSTICS_BUNDLE_WRITE_METHOD,
        )
    })?;

    encode_payload(
        DiagnosticsBundleWriteResultPayload::new(
            input.bundle_id(),
            input.destination_path(),
            u64::try_from(body.len()).unwrap_or(u64::MAX),
            record.sources,
        ),
        host_protocol::DIAGNOSTICS_BUNDLE_WRITE_METHOD,
    )
}

pub(crate) fn is_supported() -> Result<Option<Value>, HostProtocolError> {
    encode_payload(
        DiagnosticsBundleSupportedPayload::available(),
        host_protocol::DIAGNOSTICS_BUNDLE_IS_SUPPORTED_METHOD,
    )
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BundleRecord {
    bundle_id: String,
    collected_at: u64,
    sources: Vec<DiagnosticsBundleSourceSummaryPayload>,
    artifacts: BTreeMap<String, Value>,
}

struct RedactedValue {
    value: Value,
    evidence: Vec<DiagnosticsBundleRedactionEvidencePayload>,
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
            format!("failed to encode diagnostics bundle payload: {error}"),
            operation,
        )
    })
}

fn validate_non_empty(
    field: &str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    if value.is_empty() {
        Err(HostProtocolError::invalid_argument(
            field,
            "must not be empty",
            operation,
        ))
    } else if value.as_bytes().contains(&0) {
        Err(HostProtocolError::invalid_argument(
            field,
            "must not include NUL bytes",
            operation,
        ))
    } else {
        Ok(())
    }
}

fn bundles() -> &'static Mutex<HashMap<String, BundleRecord>> {
    BUNDLES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn default_sources() -> Vec<DiagnosticsBundleSourceKind> {
    vec![
        DiagnosticsBundleSourceKind::Logs,
        DiagnosticsBundleSourceKind::Traces,
        DiagnosticsBundleSourceKind::CrashReports,
        DiagnosticsBundleSourceKind::HostState,
        DiagnosticsBundleSourceKind::ExtensionHealth,
        DiagnosticsBundleSourceKind::AuditEvents,
    ]
}

fn collect_artifact(
    source: DiagnosticsBundleSourceKind,
    collected_at: u64,
    trace_id: Option<&str>,
) -> Value {
    match source {
        DiagnosticsBundleSourceKind::HostState => json!({
            "source": source_key(source),
            "collectedAt": collected_at,
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "protocolVersion": host_protocol::PROTOCOL_VERSION
        }),
        _ => json!({
            "source": source_key(source),
            "collectedAt": collected_at,
            "traceIdPresent": trace_id.is_some(),
            "status": "metadata-only"
        }),
    }
}

fn source_summary(
    source: DiagnosticsBundleSourceKind,
    evidence: Vec<DiagnosticsBundleRedactionEvidencePayload>,
) -> DiagnosticsBundleSourceSummaryPayload {
    DiagnosticsBundleSourceSummaryPayload::new(source, 1, redaction_policy(evidence))
}

fn redaction_policy(
    evidence: Vec<DiagnosticsBundleRedactionEvidencePayload>,
) -> DiagnosticsBundleRedactionPolicyPayload {
    DiagnosticsBundleRedactionPolicyPayload::new(REDACTION_POLICY_ID, evidence)
}

fn upsert_summary(
    record: &mut BundleRecord,
    source: DiagnosticsBundleSourceKind,
    policy: DiagnosticsBundleRedactionPolicyPayload,
) {
    record.sources.retain(|summary| summary.source() != source);
    record
        .sources
        .push(DiagnosticsBundleSourceSummaryPayload::new(
            source, 1, policy,
        ));
}

fn redact_value(value: Value) -> RedactedValue {
    let mut evidence = Vec::new();
    let value = redact_value_at(value, "$", false, &mut evidence);
    RedactedValue { value, evidence }
}

fn redact_value_at(
    value: Value,
    path: &str,
    key_is_secret: bool,
    evidence: &mut Vec<DiagnosticsBundleRedactionEvidencePayload>,
) -> Value {
    match value {
        Value::Object(entries) => Value::Object(redact_object(entries, path, evidence)),
        Value::Array(entries) => Value::Array(
            entries
                .into_iter()
                .enumerate()
                .map(|(index, value)| {
                    redact_value_at(value, &format!("{path}[{index}]"), key_is_secret, evidence)
                })
                .collect(),
        ),
        Value::String(value) if key_is_secret || value == "secret" => {
            evidence.push(DiagnosticsBundleRedactionEvidencePayload::new(
                "<redacted-path>",
                "secret-pattern",
            ));
            Value::String(REDACTED_VALUE.to_string())
        }
        other => other,
    }
}

fn redact_object(
    entries: Map<String, Value>,
    path: &str,
    evidence: &mut Vec<DiagnosticsBundleRedactionEvidencePayload>,
) -> Map<String, Value> {
    entries
        .into_iter()
        .map(|(key, value)| {
            let next_path = format!("{path}.<redacted-key>");
            let redacted = redact_value_at(value, &next_path, is_secret_key(&key), evidence);
            (key, redacted)
        })
        .collect()
}

fn is_secret_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    [
        "token",
        "secret",
        "password",
        "apikey",
        "api_key",
        "authorization",
    ]
    .iter()
    .any(|needle| key.contains(needle))
}

fn source_key(source: DiagnosticsBundleSourceKind) -> String {
    match source {
        DiagnosticsBundleSourceKind::Logs => "logs",
        DiagnosticsBundleSourceKind::Traces => "traces",
        DiagnosticsBundleSourceKind::CrashReports => "crash-reports",
        DiagnosticsBundleSourceKind::HostState => "host-state",
        DiagnosticsBundleSourceKind::ExtensionHealth => "extension-health",
        DiagnosticsBundleSourceKind::AuditEvents => "audit-events",
    }
    .to_string()
}

fn timestamp_millis() -> Result<u64, HostProtocolError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| {
            host_failure(
                format!("system time before Unix epoch: {error}"),
                host_protocol::DIAGNOSTICS_BUNDLE_COLLECT_METHOD,
            )
        })?
        .as_millis()
        .try_into()
        .map_err(|_| {
            host_failure(
                "timestamp milliseconds overflowed u64",
                host_protocol::DIAGNOSTICS_BUNDLE_COLLECT_METHOD,
            )
        })
}

fn invalid_state(
    current: impl Into<String>,
    attempted: impl Into<String>,
    operation: impl Into<String>,
) -> HostProtocolError {
    let current = current.into();
    let attempted = attempted.into();
    HostProtocolError::InvalidState {
        message: format!("invalid diagnostics bundle state {current} for {attempted}"),
        operation: operation.into(),
        platform: None,
        code: None,
        cause: None,
        recoverable: HostProtocolError::recoverable_default("InvalidState").expect("known tag"),
        remediation: None,
        docs_url: None,
        current,
        attempted,
    }
}

fn host_failure(message: impl Into<String>, operation: impl Into<String>) -> HostProtocolError {
    HostProtocolError::internal(message, operation)
}

#[cfg(test)]
mod tests {
    use super::{collect, is_supported, redact, write};
    use serde_json::{json, Value};
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn collect_returns_a_diagnostics_bundle_summary() {
        let value = collect(Some(json!({
            "bundleId": "bundle-rust-collect",
            "sources": ["logs", "audit-events"],
            "traceId": "trace-1"
        })))
        .expect("collect should succeed")
        .expect("collect should return payload");

        assert_eq!(value["bundleId"], "bundle-rust-collect");
        assert_eq!(value["artifactCount"], 2);
        assert_eq!(value["sources"][0]["source"], "logs");
    }

    #[test]
    fn redact_rejects_missing_bundle_before_mutating_state() {
        let error = redact(Some(json!({
            "bundleId": "missing-bundle",
            "source": "logs",
            "payload": { "token": "secret" }
        })))
        .expect_err("missing bundle should reject");

        assert_eq!(error.tag(), "InvalidState");
    }

    #[test]
    fn redact_returns_redacted_payload_and_policy_evidence() {
        collect(Some(
            json!({ "bundleId": "bundle-rust-redact", "sources": ["logs"] }),
        ))
        .expect("collect should succeed");

        let value = redact(Some(json!({
            "bundleId": "bundle-rust-redact",
            "source": "logs",
            "payload": { "token": "secret", "safe": "ok" }
        })))
        .expect("redact should succeed")
        .expect("redact should return payload");

        assert_eq!(value["payload"]["token"], "<redacted:redacted>");
        assert_eq!(value["payload"]["safe"], "ok");
        assert_eq!(
            value["redactionPolicy"]["evidence"][0]["reason"],
            "secret-pattern"
        );
    }

    #[test]
    fn write_persists_collected_bundle_to_disk() {
        let bundle_id = "bundle-rust-write";
        collect(Some(
            json!({ "bundleId": bundle_id, "sources": ["host-state"] }),
        ))
        .expect("collect should succeed");
        let path = temp_path("diagnostics-bundle.json");

        let value = write(Some(json!({
            "bundleId": bundle_id,
            "destinationPath": path.to_string_lossy()
        })))
        .expect("write should succeed")
        .expect("write should return payload");

        assert_eq!(value["bundleId"], bundle_id);
        assert!(value["bytesWritten"].as_u64().expect("bytes") > 0);
        let body = fs::read_to_string(path).expect("bundle file should exist");
        let parsed: Value = serde_json::from_str(&body).expect("bundle should be JSON");
        assert_eq!(parsed["bundleId"], bundle_id);
    }

    #[test]
    fn write_rejects_missing_bundle() {
        let error = write(Some(json!({
            "bundleId": "missing-write-bundle",
            "destinationPath": temp_path("missing.json").to_string_lossy()
        })))
        .expect_err("missing bundle should reject");

        assert_eq!(error.tag(), "InvalidState");
    }

    #[test]
    fn collect_rejects_nul_bundle_id() {
        let error = collect(Some(json!({
            "bundleId": "bundle\u{0000}1"
        })))
        .expect_err("NUL bundle id should reject");

        assert_eq!(error.tag(), "InvalidArgument");
    }

    #[test]
    fn collect_rejects_unknown_source() {
        let error = collect(Some(json!({
            "sources": ["missing"]
        })))
        .expect_err("unknown sources should reject");

        assert_eq!(error.tag(), "InvalidArgument");
    }

    #[test]
    fn redact_rejects_empty_bundle_id() {
        let error = redact(Some(json!({
            "bundleId": "",
            "source": "logs",
            "payload": { "token": "secret" }
        })))
        .expect_err("empty bundle id should reject");

        assert_eq!(error.tag(), "InvalidArgument");
    }

    #[test]
    fn write_rejects_nul_destination_path() {
        let error = write(Some(json!({
            "bundleId": "bundle-1",
            "destinationPath": "/tmp/diagnostics\u{0000}.zip"
        })))
        .expect_err("NUL path should reject");

        assert_eq!(error.tag(), "InvalidArgument");
    }

    #[test]
    fn is_supported_reports_host_exporter_support() {
        let value = is_supported()
            .expect("support check should succeed")
            .expect("support check should return payload");

        assert_eq!(value, json!({ "supported": true }));
    }

    fn temp_path(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time should be after epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("effect-desktop-{nanos}-{name}"))
    }
}
