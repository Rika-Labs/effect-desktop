#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{
    HostProtocolError, UpdaterCheckPayload, UpdaterDownloadPayload, UpdaterInstallPayload,
    UpdaterStatusPayload, UpdaterStatusState,
};
use native_updater::{
    stage_install, verify_manifest, InstallPaths, InstallPlan, InstallStagingError,
    PreparedInstall, TrustAnchor, UpdateArtifact, UpdateManifestError, UpdatePlatform,
    VerifiedManifest,
};
use serde::de::DeserializeOwned;
use serde_json::Value;
use std::{
    fs,
    path::PathBuf,
    sync::{LazyLock, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

const UPDATER_DOWNLOAD_LOCAL_FILE_REASON: &str = "signed-manifest-file-artifact-only";
const UPDATER_STAGING_DIR_NAME: &str = "effect-desktop-updater";

static UPDATER_STATE: LazyLock<Mutex<UpdaterState>> =
    LazyLock::new(|| Mutex::new(UpdaterState::default()));

#[derive(Clone, Debug)]
struct UpdaterState {
    status: UpdaterStatusPayload,
    verified_update: Option<VerifiedUpdate>,
    staged_install: Option<PreparedInstall>,
}

impl Default for UpdaterState {
    fn default() -> Self {
        Self {
            status: idle_status(None),
            verified_update: None,
            staged_install: None,
        }
    }
}

#[derive(Clone, Debug)]
struct VerifiedUpdate {
    current_version: Option<String>,
    manifest: VerifiedManifest,
}

pub(crate) fn check(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input =
        decode_payload::<UpdaterCheckPayload>(payload, host_protocol::UPDATER_CHECK_METHOD)?;
    validate_optional_version(
        "currentVersion",
        input.current_version(),
        host_protocol::UPDATER_CHECK_METHOD,
    )?;
    if input.manifest_json().is_some() || input.trust_anchors().is_some() {
        return check_signed_manifest(&input);
    }
    Err(unsupported(host_protocol::UPDATER_CHECK_METHOD))
}

pub(crate) fn download(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input =
        decode_payload::<UpdaterDownloadPayload>(payload, host_protocol::UPDATER_DOWNLOAD_METHOD)?;
    validate_optional_version(
        "version",
        input.version(),
        host_protocol::UPDATER_DOWNLOAD_METHOD,
    )?;
    download_verified_artifact(&input)
}

pub(crate) fn install(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    let input =
        decode_payload::<UpdaterInstallPayload>(payload, host_protocol::UPDATER_INSTALL_METHOD)?;
    validate_optional_version(
        "version",
        input.version(),
        host_protocol::UPDATER_INSTALL_METHOD,
    )?;
    Err(unsupported(host_protocol::UPDATER_INSTALL_METHOD))
}

pub(crate) fn install_and_restart(
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    let input = decode_payload::<UpdaterInstallPayload>(
        payload,
        host_protocol::UPDATER_INSTALL_AND_RESTART_METHOD,
    )?;
    validate_optional_version(
        "version",
        input.version(),
        host_protocol::UPDATER_INSTALL_AND_RESTART_METHOD,
    )?;
    Err(unsupported(
        host_protocol::UPDATER_INSTALL_AND_RESTART_METHOD,
    ))
}

pub(crate) fn get_status(payload: Option<Value>) -> Result<Option<Value>, HostProtocolError> {
    reject_unexpected_payload(payload, host_protocol::UPDATER_GET_STATUS_METHOD)?;
    let status = UPDATER_STATE
        .lock()
        .map_err(|_| {
            HostProtocolError::internal(
                "updater state lock was poisoned",
                host_protocol::UPDATER_GET_STATUS_METHOD,
            )
        })?
        .status
        .clone();
    serde_json::to_value(status).map(Some).map_err(|error| {
        HostProtocolError::internal(error.to_string(), host_protocol::UPDATER_GET_STATUS_METHOD)
    })
}

pub(crate) fn ready_for_restart(
    payload: Option<Value>,
) -> Result<Option<Value>, HostProtocolError> {
    reject_unexpected_payload(payload, host_protocol::UPDATER_READY_FOR_RESTART_METHOD)?;
    Err(unsupported(host_protocol::UPDATER_READY_FOR_RESTART_METHOD))
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

fn validate_optional_version(
    field: &'static str,
    value: Option<&str>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let Some(value) = value else {
        return Ok(());
    };
    if value.is_empty() {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must be non-empty",
            operation,
        ));
    }
    if value.chars().any(char::is_control) {
        return Err(HostProtocolError::invalid_argument(
            field,
            "must not include control characters",
            operation,
        ));
    }
    Ok(())
}

fn check_signed_manifest(input: &UpdaterCheckPayload) -> Result<Option<Value>, HostProtocolError> {
    let manifest_json = input.manifest_json().ok_or_else(|| {
        HostProtocolError::invalid_argument(
            "manifestJson",
            "is required when trustAnchors is provided",
            host_protocol::UPDATER_CHECK_METHOD,
        )
    })?;
    if manifest_json.trim().is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "manifestJson",
            "must be non-empty",
            host_protocol::UPDATER_CHECK_METHOD,
        ));
    }
    let trust_anchors = input.trust_anchors().ok_or_else(|| {
        HostProtocolError::invalid_argument(
            "trustAnchors",
            "is required when manifestJson is provided",
            host_protocol::UPDATER_CHECK_METHOD,
        )
    })?;
    if trust_anchors.is_empty() {
        return Err(HostProtocolError::invalid_argument(
            "trustAnchors",
            "must include at least one trust anchor",
            host_protocol::UPDATER_CHECK_METHOD,
        ));
    }

    let trust_anchors = trust_anchors
        .iter()
        .map(|anchor| {
            if anchor.public_key().trim().is_empty() {
                return Err(HostProtocolError::invalid_argument(
                    "trustAnchors.publicKey",
                    "must be non-empty",
                    host_protocol::UPDATER_CHECK_METHOD,
                ));
            }
            Ok(TrustAnchor {
                key_version: anchor.key_version(),
                public_key: anchor.public_key().to_string(),
            })
        })
        .collect::<Result<Vec<_>, _>>()?;

    let verified = match verify_manifest(manifest_json, &trust_anchors) {
        Ok(verified) => verified,
        Err(error) => {
            let status_message = manifest_status_message(&error);
            let mapped = map_manifest_error(error, manifest_json);
            record_status(UpdaterStatusPayload::new(
                UpdaterStatusState::Error,
                None,
                None,
                Some(status_message),
            ))?;
            return Err(mapped);
        }
    };
    let current_version = input.current_version();
    let payload = if current_version == Some(verified.version.as_str()) {
        record_status(idle_status(Some(
            "signed manifest verified for current version".to_string(),
        )))?;
        host_protocol::UpdaterCheckResultPayload::unavailable(
            Some(verified.version),
            Some("signed manifest verified for current version".to_string()),
        )
    } else {
        record_state(
            UpdaterStatusPayload::new(
                UpdaterStatusState::UpdateAvailable,
                Some(verified.version.clone()),
                None,
                Some("signed manifest verified".to_string()),
            ),
            Some(VerifiedUpdate {
                current_version: current_version.map(str::to_string),
                manifest: verified.clone(),
            }),
            None,
            host_protocol::UPDATER_CHECK_METHOD,
        )?;
        host_protocol::UpdaterCheckResultPayload::available(
            verified.version,
            Some("signed manifest verified".to_string()),
        )
    };

    serde_json::to_value(payload).map(Some).map_err(|error| {
        HostProtocolError::internal(error.to_string(), host_protocol::UPDATER_CHECK_METHOD)
    })
}

fn download_verified_artifact(
    input: &UpdaterDownloadPayload,
) -> Result<Option<Value>, HostProtocolError> {
    let verified = {
        let state = UPDATER_STATE.lock().map_err(|_| {
            HostProtocolError::internal(
                "updater state lock was poisoned",
                host_protocol::UPDATER_DOWNLOAD_METHOD,
            )
        })?;
        let verified = state.verified_update.clone().ok_or_else(|| {
            invalid_state(
                "no verified update",
                "download update artifact",
                host_protocol::UPDATER_DOWNLOAD_METHOD,
            )
        })?;
        if let Some(version) = input.version() {
            if version != verified.manifest.version {
                return Err(HostProtocolError::not_found(
                    format!("update version {version}"),
                    host_protocol::UPDATER_DOWNLOAD_METHOD,
                ));
            }
        }
        verified
    };

    let artifact = select_current_platform_artifact(&verified.manifest)?;
    let artifact_path = artifact_file_path(&artifact.url)?;
    {
        let mut state = UPDATER_STATE.lock().map_err(|_| {
            HostProtocolError::internal(
                "updater state lock was poisoned",
                host_protocol::UPDATER_DOWNLOAD_METHOD,
            )
        })?;
        state.status = UpdaterStatusPayload::new(
            UpdaterStatusState::Downloading,
            Some(verified.manifest.version.clone()),
            Some(0.0),
            Some("staging signed manifest artifact".to_string()),
        );
        state.staged_install = None;
    }
    let bytes = match fs::read(&artifact_path) {
        Ok(bytes) => bytes,
        Err(error) => {
            let message = format!(
                "failed to read update artifact {}: {error}",
                artifact_path.display()
            );
            let mapped = map_artifact_read_error(&artifact_path, error);
            record_download_error(message)?;
            return Err(mapped);
        }
    };
    let plan = InstallPlan {
        prior_version: verified
            .current_version
            .clone()
            .unwrap_or_else(|| "unknown".to_string()),
        target_version: verified.manifest.version.clone(),
        expected_bytes: artifact.size_bytes,
        expected_sha256: artifact.sha256.clone(),
    };
    let paths = updater_install_paths(&verified.manifest.version);
    let staged_at = unix_millis(host_protocol::UPDATER_DOWNLOAD_METHOD)?;
    let prepared = match stage_install(&plan, &paths, &bytes, staged_at) {
        Ok(prepared) => prepared,
        Err(error) => {
            let message = staging_status_message(&error);
            let mapped = map_staging_error(
                error,
                verified.manifest.key_version,
                host_protocol::UPDATER_DOWNLOAD_METHOD,
            );
            record_download_error(message)?;
            return Err(mapped);
        }
    };
    let status = UpdaterStatusPayload::new(
        UpdaterStatusState::Downloaded,
        Some(verified.manifest.version),
        Some(1.0),
        Some("signed artifact staged".to_string()),
    );
    {
        let mut state = UPDATER_STATE.lock().map_err(|_| {
            HostProtocolError::internal(
                "updater state lock was poisoned",
                host_protocol::UPDATER_DOWNLOAD_METHOD,
            )
        })?;
        state.status = status.clone();
        state.staged_install = Some(prepared);
    }

    serde_json::to_value(status).map(Some).map_err(|error| {
        HostProtocolError::internal(error.to_string(), host_protocol::UPDATER_DOWNLOAD_METHOD)
    })
}

fn record_status(status: UpdaterStatusPayload) -> Result<(), HostProtocolError> {
    record_state(status, None, None, host_protocol::UPDATER_CHECK_METHOD)
}

fn record_state(
    status: UpdaterStatusPayload,
    verified_update: Option<VerifiedUpdate>,
    staged_install: Option<PreparedInstall>,
    operation: &'static str,
) -> Result<(), HostProtocolError> {
    let mut state = UPDATER_STATE
        .lock()
        .map_err(|_| HostProtocolError::internal("updater state lock was poisoned", operation))?;
    state.status = status;
    state.verified_update = verified_update;
    state.staged_install = staged_install;
    Ok(())
}

fn idle_status(message: Option<String>) -> UpdaterStatusPayload {
    UpdaterStatusPayload::new(UpdaterStatusState::Idle, None, None, message)
}

fn record_download_error(message: String) -> Result<(), HostProtocolError> {
    let mut state = UPDATER_STATE.lock().map_err(|_| {
        HostProtocolError::internal(
            "updater state lock was poisoned",
            host_protocol::UPDATER_DOWNLOAD_METHOD,
        )
    })?;
    state.status = UpdaterStatusPayload::new(UpdaterStatusState::Error, None, None, Some(message));
    state.staged_install = None;
    Ok(())
}

fn select_current_platform_artifact(
    manifest: &VerifiedManifest,
) -> Result<UpdateArtifact, HostProtocolError> {
    let platform = current_update_platform()?;
    manifest
        .artifacts
        .iter()
        .find(|artifact| artifact.platform == platform)
        .cloned()
        .ok_or_else(|| {
            HostProtocolError::not_found(
                "update artifact for current platform",
                host_protocol::UPDATER_DOWNLOAD_METHOD,
            )
        })
}

fn current_update_platform() -> Result<UpdatePlatform, HostProtocolError> {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        Ok(UpdatePlatform::MacosArm64)
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        Ok(UpdatePlatform::MacosX64)
    }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        Ok(UpdatePlatform::WindowsX64)
    }
    #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
    {
        Ok(UpdatePlatform::WindowsArm64)
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        Ok(UpdatePlatform::LinuxX64)
    }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        Ok(UpdatePlatform::LinuxArm64)
    }
    #[cfg(not(any(
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "windows", target_arch = "x86_64"),
        all(target_os = "windows", target_arch = "aarch64"),
        all(target_os = "linux", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "aarch64")
    )))]
    {
        Err(HostProtocolError::unsupported(
            UPDATER_DOWNLOAD_LOCAL_FILE_REASON,
            host_protocol::UPDATER_DOWNLOAD_METHOD,
        ))
    }
}

fn artifact_file_path(url: &str) -> Result<PathBuf, HostProtocolError> {
    if url.chars().any(char::is_control) {
        return Err(HostProtocolError::invalid_argument(
            "artifact.url",
            "must not include control characters",
            host_protocol::UPDATER_DOWNLOAD_METHOD,
        ));
    }
    let Some(path) = url.strip_prefix("file://") else {
        return Err(HostProtocolError::unsupported(
            UPDATER_DOWNLOAD_LOCAL_FILE_REASON,
            host_protocol::UPDATER_DOWNLOAD_METHOD,
        ));
    };
    if path.is_empty() || !path.starts_with('/') {
        return Err(HostProtocolError::invalid_argument(
            "artifact.url",
            "must be an absolute file URL",
            host_protocol::UPDATER_DOWNLOAD_METHOD,
        ));
    }
    Ok(PathBuf::from(path))
}

fn updater_install_paths(version: &str) -> InstallPaths {
    let root = std::env::temp_dir()
        .join(UPDATER_STAGING_DIR_NAME)
        .join(version);
    InstallPaths {
        current_bundle: root.join("current").join("bundle"),
        temp_dir: root.join("staging"),
        staged_bundle: root.join("staging").join("bundle"),
        rollback_metadata: root.join("staging").join("rollback.json"),
        recovery_breadcrumb: root.join("state").join("restart-breadcrumb.json"),
    }
}

fn unix_millis(operation: &'static str) -> Result<u64, HostProtocolError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .map_err(|error| HostProtocolError::internal(error.to_string(), operation))
}

fn map_artifact_read_error(path: &std::path::Path, error: std::io::Error) -> HostProtocolError {
    match error.kind() {
        std::io::ErrorKind::NotFound => HostProtocolError::not_found(
            path.display().to_string(),
            host_protocol::UPDATER_DOWNLOAD_METHOD,
        ),
        _ => HostProtocolError::internal(
            format!("failed to read update artifact {}: {error}", path.display()),
            host_protocol::UPDATER_DOWNLOAD_METHOD,
        ),
    }
}

fn staging_status_message(error: &InstallStagingError) -> String {
    match error {
        InstallStagingError::UpdateDownloadTruncated {
            downloaded_bytes,
            expected_bytes,
        } => {
            format!("update artifact truncated: downloaded {downloaded_bytes} of {expected_bytes} bytes")
        }
        InstallStagingError::ArtifactSizeMismatch {
            downloaded_bytes,
            expected_bytes,
        } => format!(
            "update artifact size mismatch: downloaded {downloaded_bytes} bytes, expected {expected_bytes}"
        ),
        InstallStagingError::ArtifactDigestMismatch { .. } => {
            "update artifact digest does not match signed manifest".to_string()
        }
        InstallStagingError::UpdateStaleNotarization { .. } => {
            "update artifact notarization is stale".to_string()
        }
        InstallStagingError::RestartDeadlineExceeded { .. } => {
            "update restart deadline exceeded".to_string()
        }
        InstallStagingError::Io {
            operation, message, ..
        } => format!("update staging failed during {operation}: {message}"),
    }
}

fn map_staging_error(
    error: InstallStagingError,
    key_version: u32,
    operation: &'static str,
) -> HostProtocolError {
    match error {
        InstallStagingError::UpdateDownloadTruncated {
            downloaded_bytes,
            expected_bytes,
        } => HostProtocolError::UpdateDownloadTruncated {
            message: format!(
                "update artifact truncated: downloaded {downloaded_bytes} of {expected_bytes} bytes"
            ),
            operation: operation.to_string(),
            platform: None,
            code: None,
            cause: None,
            recoverable: HostProtocolError::recoverable_default("UpdateDownloadTruncated")
                .expect("known tag"),
            remediation: None,
            docs_url: None,
            downloaded_bytes,
            expected_bytes,
        },
        InstallStagingError::ArtifactDigestMismatch { .. } => {
            HostProtocolError::update_signature_invalid(
                "artifact",
                key_version,
                "update artifact digest does not match signed manifest",
                operation,
            )
        }
        InstallStagingError::ArtifactSizeMismatch {
            downloaded_bytes,
            expected_bytes,
        } => HostProtocolError::invalid_argument(
            "artifact.sizeBytes",
            format!(
                "update artifact size mismatch: downloaded {downloaded_bytes} bytes, expected {expected_bytes}"
            ),
            operation,
        ),
        InstallStagingError::UpdateStaleNotarization {
            notarized_at_unix_ms,
        } => HostProtocolError::UpdateStaleNotarization {
            notarized_at: notarized_at_unix_ms.to_string(),
            message: "update artifact notarization is stale".to_string(),
            operation: operation.to_string(),
            platform: None,
            code: None,
            cause: None,
            recoverable: HostProtocolError::recoverable_default("UpdateStaleNotarization")
                .expect("known tag"),
            remediation: None,
            docs_url: None,
        },
        InstallStagingError::RestartDeadlineExceeded { .. } | InstallStagingError::Io { .. } => {
            HostProtocolError::internal(staging_status_message(&error), operation)
        }
    }
}

fn invalid_state(current: &str, attempted: &str, operation: &'static str) -> HostProtocolError {
    HostProtocolError::InvalidState {
        message: format!("cannot {attempted} while updater is {current}"),
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

fn manifest_status_message(error: &UpdateManifestError) -> String {
    match error {
        UpdateManifestError::SignatureMissing | UpdateManifestError::SignatureInvalid => {
            "update manifest signature is invalid".to_string()
        }
        UpdateManifestError::NoTrustedKey { .. } => {
            "update manifest key is not trusted".to_string()
        }
        UpdateManifestError::JsonInvalid { message }
        | UpdateManifestError::ManifestShapeInvalid { message } => message.clone(),
        UpdateManifestError::PublicKeyInvalid {
            key_version,
            message,
        } => format!("keyVersion {key_version}: {message}"),
    }
}

fn map_manifest_error(error: UpdateManifestError, manifest_json: &str) -> HostProtocolError {
    match error {
        UpdateManifestError::SignatureMissing | UpdateManifestError::SignatureInvalid => {
            HostProtocolError::update_signature_invalid(
                "manifest",
                manifest_key_version(manifest_json).unwrap_or_default(),
                "update manifest signature is invalid",
                host_protocol::UPDATER_CHECK_METHOD,
            )
        }
        UpdateManifestError::NoTrustedKey { key_version } => {
            HostProtocolError::update_signature_invalid(
                "manifest",
                key_version,
                "update manifest key is not trusted",
                host_protocol::UPDATER_CHECK_METHOD,
            )
        }
        UpdateManifestError::JsonInvalid { message }
        | UpdateManifestError::ManifestShapeInvalid { message } => {
            HostProtocolError::invalid_argument(
                "manifestJson",
                message,
                host_protocol::UPDATER_CHECK_METHOD,
            )
        }
        UpdateManifestError::PublicKeyInvalid {
            key_version,
            message,
        } => HostProtocolError::invalid_argument(
            "trustAnchors.publicKey",
            format!("keyVersion {key_version}: {message}"),
            host_protocol::UPDATER_CHECK_METHOD,
        ),
    }
}

fn manifest_key_version(manifest_json: &str) -> Option<u32> {
    serde_json::from_str::<Value>(manifest_json)
        .ok()?
        .get("keyVersion")?
        .as_u64()
        .and_then(|value| u32::try_from(value).ok())
}

fn unsupported(operation: &'static str) -> HostProtocolError {
    HostProtocolError::unsupported(host_protocol::UPDATER_UNSUPPORTED_REASON, operation)
}

#[cfg(test)]
mod tests {
    use super::{check, download, get_status, install, install_and_restart, ready_for_restart};
    use base64::{engine::general_purpose::STANDARD, Engine};
    use ed25519_dalek::{Signer, SigningKey};
    use host_protocol::HostProtocolError;
    use serde_json::{json, Value};
    use sha2::{Digest, Sha256};
    use std::{
        fs,
        path::{Path, PathBuf},
        sync::{LazyLock, Mutex, MutexGuard},
    };

    static UPDATER_TEST_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

    #[test]
    fn updater_requests_decode_before_unsupported() {
        let _guard = updater_test_guard();
        reset_status();
        assert_eq!(
            check(Some(json!({ "currentVersion": "1.0.0" }))).expect_err("check"),
            HostProtocolError::unsupported(
                host_protocol::UPDATER_UNSUPPORTED_REASON,
                host_protocol::UPDATER_CHECK_METHOD,
            )
        );
        assert_eq!(
            download(Some(json!({ "version": "1.1.0" }))).expect_err("download"),
            HostProtocolError::InvalidState {
                message: "cannot download update artifact while updater is no verified update"
                    .to_string(),
                operation: host_protocol::UPDATER_DOWNLOAD_METHOD.to_string(),
                platform: None,
                code: None,
                cause: None,
                recoverable: HostProtocolError::recoverable_default("InvalidState")
                    .expect("known tag"),
                remediation: None,
                docs_url: None,
                current: "no verified update".to_string(),
                attempted: "download update artifact".to_string(),
            }
        );
        assert_eq!(
            install(Some(json!({ "version": "1.1.0" }))).expect_err("install"),
            HostProtocolError::unsupported(
                host_protocol::UPDATER_UNSUPPORTED_REASON,
                host_protocol::UPDATER_INSTALL_METHOD,
            )
        );
        assert_eq!(
            install_and_restart(Some(json!({ "version": "1.1.0" })))
                .expect_err("install and restart"),
            HostProtocolError::unsupported(
                host_protocol::UPDATER_UNSUPPORTED_REASON,
                host_protocol::UPDATER_INSTALL_AND_RESTART_METHOD,
            )
        );
        assert_eq!(
            get_status(None).expect("get status"),
            Some(json!({
                "state": "idle"
            }))
        );
        assert_eq!(
            ready_for_restart(None).expect_err("ready for restart"),
            HostProtocolError::unsupported(
                host_protocol::UPDATER_UNSUPPORTED_REASON,
                host_protocol::UPDATER_READY_FOR_RESTART_METHOD,
            )
        );
    }

    #[test]
    fn updater_rejects_malformed_payloads_before_unsupported() {
        let _guard = updater_test_guard();
        reset_status();
        assert_eq!(
            check(Some(json!({ "currentVersion": "bad\nversion" }))).expect_err("version"),
            HostProtocolError::invalid_argument(
                "currentVersion",
                "must not include control characters",
                host_protocol::UPDATER_CHECK_METHOD,
            )
        );
        assert_eq!(
            install(Some(json!({ "version": "" }))).expect_err("version"),
            HostProtocolError::invalid_argument(
                "version",
                "must be non-empty",
                host_protocol::UPDATER_INSTALL_METHOD,
            )
        );
        assert_eq!(
            get_status(Some(json!({}))).expect_err("payload"),
            HostProtocolError::invalid_argument(
                "payload",
                "must be omitted",
                host_protocol::UPDATER_GET_STATUS_METHOD,
            )
        );
    }

    #[test]
    fn updater_check_verifies_signed_manifest_when_trust_anchor_is_provided() {
        let _guard = updater_test_guard();
        reset_status();
        let signed = signed_manifest(7, "1.2.3");
        let payload = json!({
            "currentVersion": "1.0.0",
            "manifestJson": signed.json,
            "trustAnchors": [{
                "keyVersion": 7,
                "publicKey": signed.public_key
            }]
        });

        let response = check(Some(payload)).expect("signed manifest check should succeed");

        assert_eq!(
            response,
            Some(json!({
                "available": true,
                "version": "1.2.3",
                "notes": "signed manifest verified"
            }))
        );
        assert_eq!(
            get_status(None).expect("status should reflect available update"),
            Some(json!({
                "state": "update-available",
                "version": "1.2.3",
                "message": "signed manifest verified"
            }))
        );
    }

    #[test]
    fn updater_check_maps_bad_manifest_signature_to_terminal_error() {
        let _guard = updater_test_guard();
        reset_status();
        let signed = signed_manifest(7, "1.2.3");
        let payload = json!({
            "currentVersion": "1.0.0",
            "manifestJson": signed.json.replace("1.2.3", "1.2.4"),
            "trustAnchors": [{
                "keyVersion": 7,
                "publicKey": signed.public_key
            }]
        });

        assert_eq!(
            check(Some(payload)).expect_err("tampered manifest should fail"),
            HostProtocolError::update_signature_invalid(
                "manifest",
                7,
                "update manifest signature is invalid",
                host_protocol::UPDATER_CHECK_METHOD,
            )
        );
        assert_eq!(
            get_status(None).expect("status should record terminal signature failure"),
            Some(json!({
                "state": "error",
                "message": "update manifest signature is invalid"
            }))
        );
    }

    #[test]
    fn updater_check_records_current_version_as_idle_status() {
        let _guard = updater_test_guard();
        reset_status();
        let signed = signed_manifest(7, "1.2.3");
        let payload = json!({
            "currentVersion": "1.2.3",
            "manifestJson": signed.json,
            "trustAnchors": [{
                "keyVersion": 7,
                "publicKey": signed.public_key
            }]
        });

        let response = check(Some(payload)).expect("signed current manifest check should succeed");

        assert_eq!(
            response,
            Some(json!({
                "available": false,
                "version": "1.2.3",
                "notes": "signed manifest verified for current version"
            }))
        );
        assert_eq!(
            get_status(None).expect("status should remain idle for current version"),
            Some(json!({
                "state": "idle",
                "message": "signed manifest verified for current version"
            }))
        );
    }

    #[test]
    fn updater_check_requires_manifest_and_trust_anchor_together() {
        let _guard = updater_test_guard();
        reset_status();
        assert_eq!(
            check(Some(json!({ "manifestJson": "{}" }))).expect_err("missing trust anchors"),
            HostProtocolError::invalid_argument(
                "trustAnchors",
                "is required when manifestJson is provided",
                host_protocol::UPDATER_CHECK_METHOD,
            )
        );
        assert_eq!(
            check(Some(json!({ "trustAnchors": [] }))).expect_err("missing manifest"),
            HostProtocolError::invalid_argument(
                "manifestJson",
                "is required when trustAnchors is provided",
                host_protocol::UPDATER_CHECK_METHOD,
            )
        );
    }

    #[test]
    fn updater_download_stages_verified_file_artifact() {
        let _guard = updater_test_guard();
        reset_status();
        let version = "8.7.6";
        cleanup_staged_version(version);
        let root = test_temp_dir("download-stages");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("test root should be created");
        let artifact_path = root.join("artifact.bin");
        let artifact_bytes = b"verified-bundle";
        fs::write(&artifact_path, artifact_bytes).expect("artifact should be written");
        let signed =
            signed_manifest_with_artifact(7, version, &file_url(&artifact_path), artifact_bytes);

        check(Some(json!({
            "currentVersion": "1.0.0",
            "manifestJson": signed.json,
            "trustAnchors": [{
                "keyVersion": 7,
                "publicKey": signed.public_key
            }]
        })))
        .expect("signed manifest check should succeed");
        let response =
            download(Some(json!({ "version": version }))).expect("download should stage");

        assert_eq!(
            response,
            Some(json!({
                "state": "downloaded",
                "version": version,
                "progress": 1.0,
                "message": "signed artifact staged"
            }))
        );
        assert_eq!(
            get_status(None).expect("status should reflect staged download"),
            response
        );
        let paths = super::updater_install_paths(version);
        assert_eq!(
            fs::read(&paths.staged_bundle).expect("staged bundle should be written"),
            artifact_bytes
        );
        assert!(
            paths.rollback_metadata.exists(),
            "rollback metadata should be written"
        );

        cleanup_staged_version(version);
        let _ = fs::remove_dir_all(root);
        reset_status();
    }

    #[test]
    fn updater_download_rejects_non_file_artifact_url() {
        let _guard = updater_test_guard();
        reset_status();
        let signed = signed_manifest(7, "1.2.3");
        check(Some(json!({
            "currentVersion": "1.0.0",
            "manifestJson": signed.json,
            "trustAnchors": [{
                "keyVersion": 7,
                "publicKey": signed.public_key
            }]
        })))
        .expect("signed manifest check should succeed");

        assert_eq!(
            download(Some(json!({ "version": "1.2.3" }))).expect_err("download"),
            HostProtocolError::unsupported(
                super::UPDATER_DOWNLOAD_LOCAL_FILE_REASON,
                host_protocol::UPDATER_DOWNLOAD_METHOD,
            )
        );
        reset_status();
    }

    #[test]
    fn updater_download_rejects_artifact_digest_mismatch_as_signature_failure() {
        let _guard = updater_test_guard();
        reset_status();
        let version = "8.7.5";
        cleanup_staged_version(version);
        let root = test_temp_dir("download-digest");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("test root should be created");
        let artifact_path = root.join("artifact.bin");
        fs::write(&artifact_path, b"actual-bundle").expect("artifact should be written");
        let signed =
            signed_manifest_with_artifact(7, version, &file_url(&artifact_path), b"signed-bundle");
        check(Some(json!({
            "currentVersion": "1.0.0",
            "manifestJson": signed.json,
            "trustAnchors": [{
                "keyVersion": 7,
                "publicKey": signed.public_key
            }]
        })))
        .expect("signed manifest check should succeed");

        assert_eq!(
            download(Some(json!({ "version": version }))).expect_err("download"),
            HostProtocolError::update_signature_invalid(
                "artifact",
                7,
                "update artifact digest does not match signed manifest",
                host_protocol::UPDATER_DOWNLOAD_METHOD,
            )
        );
        assert_eq!(
            get_status(None).expect("status should record digest failure"),
            Some(json!({
                "state": "error",
                "message": "update artifact digest does not match signed manifest"
            }))
        );

        cleanup_staged_version(version);
        let _ = fs::remove_dir_all(root);
        reset_status();
    }

    struct SignedManifest {
        json: String,
        public_key: String,
    }

    fn signed_manifest(key_version: u32, version: &str) -> SignedManifest {
        signed_manifest_with_artifact(
            key_version,
            version,
            "https://updates.example.invalid/app.dmg",
            &[0, 0, 0, 0],
        )
    }

    fn signed_manifest_with_artifact(
        key_version: u32,
        version: &str,
        artifact_url: &str,
        artifact_bytes: &[u8],
    ) -> SignedManifest {
        let mut unsigned = json!({
            "schemaVersion": 1,
            "appId": "dev.effect-desktop.inspector",
            "version": version,
            "channel": "stable",
            "keyVersion": key_version,
            "publishedAt": "2026-05-06T00:00:00.000Z",
            "artifacts": [{
                "platform": current_platform(),
                "kind": "dmg",
                "url": artifact_url,
                "sizeBytes": artifact_bytes.len(),
                "sha256": sha256_hex(artifact_bytes),
                "signature": "ed25519:artifact"
            }],
            "signature": "ed25519:placeholder"
        });
        let canonical = native_updater::canonical_manifest_bytes(&unsigned.to_string())
            .expect("manifest should canonicalize");
        let signing_key = SigningKey::from_bytes(&[7_u8; 32]);
        let signature = format!(
            "ed25519:{}",
            STANDARD.encode(signing_key.sign(canonical.as_bytes()).to_bytes())
        );
        let public_key = format!(
            "ed25519:{}",
            STANDARD.encode(signing_key.verifying_key().as_bytes())
        );
        let object = unsigned
            .as_object_mut()
            .expect("signed manifest should be a JSON object");
        object.insert("signature".to_string(), Value::String(signature));
        SignedManifest {
            json: unsigned.to_string(),
            public_key,
        }
    }

    fn reset_status() {
        super::record_status(super::idle_status(None)).expect("status reset should succeed");
    }

    fn current_platform() -> &'static str {
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        {
            "macos-arm64"
        }
        #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
        {
            "macos-x64"
        }
        #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
        {
            "windows-x64"
        }
        #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
        {
            "windows-arm64"
        }
        #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
        {
            "linux-x64"
        }
        #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
        {
            "linux-arm64"
        }
    }

    fn sha256_hex(bytes: &[u8]) -> String {
        let digest = Sha256::digest(bytes);
        digest
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    }

    fn file_url(path: &Path) -> String {
        format!("file://{}", path.display())
    }

    fn test_temp_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "effect-desktop-updater-{name}-{}",
            std::process::id()
        ))
    }

    fn cleanup_staged_version(version: &str) {
        let paths = super::updater_install_paths(version);
        if let Some(root) = paths.temp_dir.parent() {
            let _ = fs::remove_dir_all(root);
        }
    }

    fn updater_test_guard() -> MutexGuard<'static, ()> {
        UPDATER_TEST_LOCK
            .lock()
            .expect("updater test lock should not be poisoned")
    }
}
