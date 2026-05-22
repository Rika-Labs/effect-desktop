#![allow(clippy::result_large_err)]

use host_protocol::{
    DistributionParityEventPayload, DistributionParityEvidenceKind,
    DistributionParitySupportedPayload, DistributionParityVerifyPayload,
    DistributionParityVerifyResultPayload, HostProtocolError,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{to_string, to_value, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

const SHA256_PREFIX: &str = "sha256:";

pub(crate) type EventfulResponse = (Option<Value>, Option<Value>, Option<HostProtocolError>);

pub(crate) fn verify_with_event(payload: Option<Value>, timestamp: u64) -> EventfulResponse {
    let operation = host_protocol::DISTRIBUTION_PARITY_VERIFY_METHOD;
    let input = match decode_payload::<DistributionParityVerifyPayload>(payload, operation) {
        Ok(input) => input,
        Err(error) => {
            return (
                None,
                failure_event(timestamp, None, &error).ok().flatten(),
                Some(error),
            );
        }
    };

    match validate_verify(&input).and_then(|()| {
        encode_payload(
            DistributionParityVerifyResultPayload::new(
                input.package_id(),
                input.version(),
                input.capabilities().len() as u64,
                input.evidence().len() as u64,
            ),
            operation,
        )
    }) {
        Ok(payload) => (
            payload,
            success_event(timestamp, &input).ok().flatten(),
            None,
        ),
        Err(error) => (
            None,
            failure_event(timestamp, Some(&input), &error)
                .ok()
                .flatten(),
            Some(error),
        ),
    }
}

pub(crate) fn is_supported() -> Result<Option<Value>, HostProtocolError> {
    encode_payload(
        DistributionParitySupportedPayload::supported(),
        host_protocol::DISTRIBUTION_PARITY_IS_SUPPORTED_METHOD,
    )
}

fn validate_verify(input: &DistributionParityVerifyPayload) -> Result<(), HostProtocolError> {
    let operation = host_protocol::DISTRIBUTION_PARITY_VERIFY_METHOD;
    validate_identity("packageId", input.package_id(), operation)?;
    validate_identity("version", input.version(), operation)?;
    if input.capabilities().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "capabilities",
            "must contain at least one capability",
            operation,
        ));
    }
    if input.evidence().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "evidence",
            "must contain parity evidence",
            operation,
        ));
    }

    let expected = canonical_capabilities(input.capabilities(), operation)?;
    let mut kinds = BTreeSet::new();
    for evidence in input.evidence() {
        validate_identity("evidence.id", evidence.id(), operation)?;
        validate_identity("evidence.path", evidence.path(), operation)?;
        let file_capabilities =
            validate_evidence_file(evidence.path(), evidence.sha256(), operation)?;
        if canonical_capabilities(evidence.capabilities(), operation)? != expected {
            return Err(HostProtocolError::invalid_argument(
                "evidence.capabilities",
                format!(
                    "{} does not match the distribution capability contract",
                    evidence.id()
                ),
                operation,
            ));
        }
        if canonical_capabilities(&file_capabilities, operation)? != expected {
            return Err(HostProtocolError::invalid_argument(
                "evidence.path",
                format!(
                    "{} file capabilities do not match the distribution capability contract",
                    evidence.id()
                ),
                operation,
            ));
        }
        kinds.insert(evidence.kind().clone());
    }

    for required in [
        DistributionParityEvidenceKind::PackageArtifact,
        DistributionParityEvidenceKind::PluginRegistration,
        DistributionParityEvidenceKind::Template,
        DistributionParityEvidenceKind::Docs,
    ] {
        if !kinds.contains(&required) {
            return Err(HostProtocolError::invalid_argument(
                "evidence",
                format!("missing {required:?} evidence"),
                operation,
            ));
        }
    }
    Ok(())
}

fn success_event(
    timestamp: u64,
    input: &DistributionParityVerifyPayload,
) -> Result<Option<Value>, HostProtocolError> {
    encode_payload(
        DistributionParityEventPayload::verified(timestamp, input.package_id(), input.version()),
        host_protocol::DISTRIBUTION_PARITY_EVENT,
    )
}

fn failure_event(
    timestamp: u64,
    input: Option<&DistributionParityVerifyPayload>,
    error: &HostProtocolError,
) -> Result<Option<Value>, HostProtocolError> {
    let Some(input) = input else {
        return Ok(None);
    };
    encode_payload(
        DistributionParityEventPayload::failed(
            timestamp,
            input.package_id(),
            input.version(),
            format!("{error:?}"),
        ),
        host_protocol::DISTRIBUTION_PARITY_EVENT,
    )
}

fn validate_evidence_file(
    path: &str,
    sha256: Option<&str>,
    operation: &'static str,
) -> Result<Vec<Value>, HostProtocolError> {
    let evidence_path = Path::new(path);
    let bytes = fs::read(evidence_path).map_err(|error| {
        HostProtocolError::invalid_argument(
            "evidence.path",
            format!("failed to read {}: {error}", evidence_path.display()),
            operation,
        )
    })?;
    if bytes.is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "evidence.path",
            "must point at non-empty JSON evidence",
            operation,
        ));
    }
    if let Some(expected) = sha256 {
        validate_sha256_digest("evidence.sha256", expected, operation)?;
        let actual = digest_bytes(&bytes);
        if actual != expected {
            return Err(HostProtocolError::invalid_argument(
                "evidence.sha256",
                format!("digest mismatch for {}", evidence_path.display()),
                operation,
            ));
        }
    }
    let evidence = serde_json::from_slice::<Value>(&bytes).map_err(|error| {
        HostProtocolError::invalid_argument(
            "evidence.path",
            format!(
                "failed to decode JSON evidence {}: {error}",
                evidence_path.display()
            ),
            operation,
        )
    })?;
    let capabilities = evidence
        .get("capabilities")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            HostProtocolError::invalid_argument(
                "evidence.path",
                format!(
                    "{} must contain a capabilities array",
                    evidence_path.display()
                ),
                operation,
            )
        })?;
    if capabilities.is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "evidence.path",
            format!("{} capabilities must be non-empty", evidence_path.display()),
            operation,
        ));
    }
    Ok(capabilities.clone())
}

fn validate_sha256_digest(
    field: &'static str,
    value: &str,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let digest = value.strip_prefix(SHA256_PREFIX).ok_or_else(|| {
        HostProtocolError::invalid_argument(field, "must be a sha256 digest", operation)
    })?;
    if digest.len() == 64 && digest.chars().all(|value| value.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(HostProtocolError::invalid_argument(
            field,
            "must be a sha256 digest",
            operation,
        ))
    }
}

fn digest_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format_digest(hasher.finalize().as_slice())
}

fn format_digest(bytes: &[u8]) -> String {
    let mut output = String::from(SHA256_PREFIX);
    for byte in bytes {
        output.push_str(&format!("{byte:02x}"));
    }
    output
}

fn canonical_capabilities(
    capabilities: &[Value],
    operation: &'static str,
) -> Result<Vec<String>, HostProtocolError> {
    let mut values = Vec::with_capacity(capabilities.len());
    for capability in capabilities {
        values.push(canonical_json(capability).map_err(|error| {
            HostProtocolError::invalid_argument("capabilities", error.to_string(), operation)
        })?);
    }
    values.sort();
    Ok(values)
}

fn canonical_json(value: &Value) -> Result<String, serde_json::Error> {
    match value {
        Value::Array(entries) => {
            let mut encoded = Vec::with_capacity(entries.len());
            for entry in entries {
                encoded.push(canonical_json(entry)?);
            }
            Ok(format!("[{}]", encoded.join(",")))
        }
        Value::Object(entries) => {
            let mut encoded = Vec::with_capacity(entries.len());
            for (key, entry) in entries {
                encoded.push((key, canonical_json(entry)?));
            }
            encoded.sort_by(|(left, _), (right, _)| left.cmp(right));
            Ok(format!(
                "{{{}}}",
                encoded
                    .into_iter()
                    .map(|(key, entry)| to_string(key)
                        .map(|encoded_key| { format!("{encoded_key}:{entry}") }))
                    .collect::<Result<Vec<_>, _>>()?
                    .join(",")
            ))
        }
        _ => to_string(value),
    }
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
            format!("failed to encode distribution parity payload: {error}"),
            operation,
        )
    })
}

fn validate_identity(
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
    if value.chars().any(char::is_control) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not contain control characters",
            operation,
        ));
    }
    Ok(())
}
