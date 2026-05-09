use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, VerifyingKey};
use semver::Version;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
#[cfg(unix)]
use std::io::ErrorKind;
#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;
use std::{
    fs,
    path::{Path, PathBuf},
};
#[cfg(windows)]
use windows_sys::Win32::Storage::FileSystem::{
    MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
};

pub const TRUST_WINDOW: u32 = 2;
pub const RESTART_DEADLINE_MS: u64 = 5_000;
pub const STALE_NOTARIZATION_MS: u64 = 30 * 24 * 60 * 60 * 1_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrustAnchor {
    pub key_version: u32,
    pub public_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedManifest {
    pub app_id: String,
    pub version: String,
    pub channel: UpdateChannel,
    pub key_version: u32,
    pub rollback: bool,
    pub min_version: Option<String>,
    pub max_version: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdatePolicy {
    pub app_id: String,
    pub channel: UpdateChannel,
    pub platform: UpdatePlatform,
    pub installed_version: String,
    pub min_version: Option<String>,
    pub feed_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateDecision {
    pub feed_url: String,
    pub version: String,
    pub channel: UpdateChannel,
    pub rollback: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdatePolicyRejection {
    pub error: UpdateCheckError,
    pub audit: UpdateAuditRow,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateAuditRow {
    pub event: UpdateAuditEvent,
    pub configured_channel: UpdateChannel,
    pub manifest_channel: Option<UpdateChannel>,
    pub installed_version: String,
    pub manifest_version: Option<String>,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpdateAuditEvent {
    AppIdMismatch,
    WrongChannel,
    BelowMinVersion,
    DowngradeRefused,
    InvalidVersion,
    FeedUrlTemplateInvalid,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpdateCheckError {
    FeedUrlTemplateInvalid {
        template: String,
        missing_placeholder: &'static str,
    },
    VersionInvalid {
        value: String,
        source: VersionSource,
        message: String,
    },
    AppIdMismatch {
        expected: String,
        actual: String,
    },
    WrongChannel {
        expected: UpdateChannel,
        actual: UpdateChannel,
    },
    BelowMinVersion {
        min_version: String,
        manifest_version: String,
    },
    DowngradeRefused {
        installed_version: String,
        manifest_version: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VersionSource {
    Installed,
    Manifest,
    MinVersion,
    MaxVersion,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstallPlan {
    pub prior_version: String,
    pub target_version: String,
    pub expected_bytes: u64,
    pub expected_sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstallPaths {
    pub current_bundle: PathBuf,
    pub temp_dir: PathBuf,
    pub staged_bundle: PathBuf,
    pub rollback_metadata: PathBuf,
    pub recovery_breadcrumb: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedInstall {
    pub plan: InstallPlan,
    pub paths: InstallPaths,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RollbackMetadata {
    pub prior_version: String,
    pub target_version: String,
    pub staged_at_unix_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RestartBreadcrumb {
    pub target_version: String,
    pub deadline_unix_ms: u64,
    pub observed_unix_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparingRestart {
    pub target_version: String,
    pub deadline_unix_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RestartReadiness {
    Ready { acknowledged_unix_ms: u64 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InstallStagingError {
    UpdateDownloadTruncated {
        downloaded_bytes: u64,
        expected_bytes: u64,
    },
    ArtifactSizeMismatch {
        downloaded_bytes: u64,
        expected_bytes: u64,
    },
    ArtifactDigestMismatch {
        expected_sha256: String,
        actual_sha256: String,
    },
    UpdateStaleNotarization {
        notarized_at_unix_ms: u64,
    },
    RestartDeadlineExceeded {
        deadline_unix_ms: u64,
        observed_unix_ms: u64,
    },
    Io {
        operation: &'static str,
        path: PathBuf,
        message: String,
    },
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateManifest {
    pub schema_version: u32,
    pub app_id: String,
    pub version: String,
    pub channel: UpdateChannel,
    pub key_version: u32,
    pub published_at: String,
    pub rollback: Option<bool>,
    pub min_version: Option<String>,
    pub max_version: Option<String>,
    pub artifacts: Vec<UpdateArtifact>,
    pub signature: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateArtifact {
    pub platform: UpdatePlatform,
    pub kind: UpdateArtifactKind,
    pub url: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub signature: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum UpdateChannel {
    Stable,
    Beta,
    Canary,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum UpdatePlatform {
    MacosArm64,
    MacosX64,
    WindowsX64,
    LinuxX64,
    WindowsArm64,
    LinuxArm64,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum UpdateArtifactKind {
    App,
    Dmg,
    Zip,
    Msi,
    Appimage,
    Deb,
    Rpm,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpdateManifestError {
    JsonInvalid { message: String },
    ManifestShapeInvalid { message: String },
    SignatureMissing,
    SignatureInvalid,
    PublicKeyInvalid { key_version: u32, message: String },
    NoTrustedKey { key_version: u32 },
}

pub fn resolve_feed_url(
    template: &str,
    platform: &UpdatePlatform,
    channel: &UpdateChannel,
) -> Result<String, UpdateCheckError> {
    if !template.contains("{platform}") {
        return Err(UpdateCheckError::FeedUrlTemplateInvalid {
            template: template.to_string(),
            missing_placeholder: "{platform}",
        });
    }
    if !template.contains("{channel}") {
        return Err(UpdateCheckError::FeedUrlTemplateInvalid {
            template: template.to_string(),
            missing_placeholder: "{channel}",
        });
    }
    Ok(template
        .replace("{platform}", platform.as_str())
        .replace("{channel}", channel.as_str()))
}

pub fn evaluate_update(
    policy: &UpdatePolicy,
    manifest: &VerifiedManifest,
) -> Result<UpdateDecision, Box<UpdatePolicyRejection>> {
    let feed_url = resolve_feed_url(&policy.feed_url, &policy.platform, &policy.channel)
        .map_err(|error| rejection(policy, manifest, error))?;

    if manifest.app_id != policy.app_id {
        return Err(rejection(
            policy,
            manifest,
            UpdateCheckError::AppIdMismatch {
                expected: policy.app_id.clone(),
                actual: manifest.app_id.clone(),
            },
        ));
    }

    if manifest.channel != policy.channel {
        return Err(rejection(
            policy,
            manifest,
            UpdateCheckError::WrongChannel {
                expected: policy.channel.clone(),
                actual: manifest.channel.clone(),
            },
        ));
    }

    let installed_version = parse_version(&policy.installed_version, VersionSource::Installed)
        .map_err(|error| rejection(policy, manifest, error))?;
    let manifest_version = parse_version(&manifest.version, VersionSource::Manifest)
        .map_err(|error| rejection(policy, manifest, error))?;

    for min_version in [policy.min_version.as_ref(), manifest.min_version.as_ref()]
        .into_iter()
        .flatten()
    {
        let parsed_min_version = parse_version(min_version, VersionSource::MinVersion)
            .map_err(|error| rejection(policy, manifest, error))?;
        if manifest_version < parsed_min_version {
            return Err(rejection(
                policy,
                manifest,
                UpdateCheckError::BelowMinVersion {
                    min_version: min_version.clone(),
                    manifest_version: manifest.version.clone(),
                },
            ));
        }
    }

    if manifest_version <= installed_version
        && !rollback_allowed(policy, manifest, &installed_version)?
    {
        return Err(rejection(
            policy,
            manifest,
            UpdateCheckError::DowngradeRefused {
                installed_version: policy.installed_version.clone(),
                manifest_version: manifest.version.clone(),
            },
        ));
    }

    Ok(UpdateDecision {
        feed_url,
        version: manifest.version.clone(),
        channel: manifest.channel.clone(),
        rollback: manifest.rollback,
    })
}

pub fn stage_install(
    plan: &InstallPlan,
    paths: &InstallPaths,
    downloaded: &[u8],
    staged_at_unix_ms: u64,
) -> Result<PreparedInstall, InstallStagingError> {
    let downloaded_bytes =
        u64::try_from(downloaded.len()).map_err(|error| InstallStagingError::Io {
            operation: "measure-download",
            path: paths.staged_bundle.clone(),
            message: error.to_string(),
        })?;
    if downloaded_bytes < plan.expected_bytes {
        return Err(InstallStagingError::UpdateDownloadTruncated {
            downloaded_bytes,
            expected_bytes: plan.expected_bytes,
        });
    }
    if downloaded_bytes != plan.expected_bytes {
        return Err(InstallStagingError::ArtifactSizeMismatch {
            downloaded_bytes,
            expected_bytes: plan.expected_bytes,
        });
    }

    let actual_sha256 = sha256_hex(downloaded);
    if actual_sha256 != plan.expected_sha256 {
        return Err(InstallStagingError::ArtifactDigestMismatch {
            expected_sha256: plan.expected_sha256.clone(),
            actual_sha256,
        });
    }

    cleanup_stale_temp_dir(paths)?;
    fs::create_dir_all(&paths.temp_dir)
        .map_err(|error| io_error("create-temp-dir", &paths.temp_dir, error))?;
    fs::write(&paths.staged_bundle, downloaded)
        .map_err(|error| io_error("write-staged-bundle", &paths.staged_bundle, error))?;
    preserve_replacement_permissions(&paths.current_bundle, &paths.staged_bundle)?;
    let rollback = RollbackMetadata {
        prior_version: plan.prior_version.clone(),
        target_version: plan.target_version.clone(),
        staged_at_unix_ms,
    };
    let rollback_json =
        serde_json::to_vec_pretty(&rollback).map_err(|error| InstallStagingError::Io {
            operation: "encode-rollback-metadata",
            path: paths.rollback_metadata.clone(),
            message: error.to_string(),
        })?;
    fs::write(&paths.rollback_metadata, rollback_json)
        .map_err(|error| io_error("write-rollback-metadata", &paths.rollback_metadata, error))?;

    Ok(PreparedInstall {
        plan: plan.clone(),
        paths: paths.clone(),
    })
}

pub fn commit_staged_install(prepared: &PreparedInstall) -> Result<(), InstallStagingError> {
    if let Some(parent) = prepared.paths.current_bundle.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| io_error("create-current-parent", parent, error))?;
    }
    let commit_temp = commit_temp_path(prepared);
    fs::copy(&prepared.paths.staged_bundle, &commit_temp)
        .map_err(|error| io_error("copy-staged-bundle-to-commit-temp", &commit_temp, error))?;
    preserve_replacement_permissions(&prepared.paths.current_bundle, &commit_temp)?;
    atomic_replace(&commit_temp, &prepared.paths.current_bundle).map_err(|error| {
        let _ = fs::remove_file(&commit_temp);
        io_error(
            "commit-staged-bundle",
            &prepared.paths.current_bundle,
            error,
        )
    })
}

pub fn cleanup_stale_temp_dir(paths: &InstallPaths) -> Result<(), InstallStagingError> {
    if !paths.temp_dir.exists() {
        return Ok(());
    }
    fs::remove_dir_all(&paths.temp_dir)
        .map_err(|error| io_error("cleanup-temp-dir", &paths.temp_dir, error))
}

pub fn validate_notarization(
    stapled: bool,
    notarized_at_unix_ms: u64,
    now_unix_ms: u64,
) -> Result<(), InstallStagingError> {
    if !stapled && now_unix_ms.saturating_sub(notarized_at_unix_ms) > STALE_NOTARIZATION_MS {
        return Err(InstallStagingError::UpdateStaleNotarization {
            notarized_at_unix_ms,
        });
    }
    Ok(())
}

pub fn prepare_restart(target_version: &str, now_unix_ms: u64) -> PreparingRestart {
    PreparingRestart {
        target_version: target_version.to_string(),
        deadline_unix_ms: now_unix_ms.saturating_add(RESTART_DEADLINE_MS),
    }
}

pub fn ready_for_restart(
    paths: &InstallPaths,
    preparing: &PreparingRestart,
    acknowledged_unix_ms: u64,
) -> Result<RestartReadiness, InstallStagingError> {
    if acknowledged_unix_ms > preparing.deadline_unix_ms {
        record_restart_breadcrumb(paths, preparing, acknowledged_unix_ms)?;
        return Err(InstallStagingError::RestartDeadlineExceeded {
            deadline_unix_ms: preparing.deadline_unix_ms,
            observed_unix_ms: acknowledged_unix_ms,
        });
    }
    Ok(RestartReadiness::Ready {
        acknowledged_unix_ms,
    })
}

pub fn record_restart_breadcrumb(
    paths: &InstallPaths,
    preparing: &PreparingRestart,
    observed_unix_ms: u64,
) -> Result<RestartBreadcrumb, InstallStagingError> {
    let breadcrumb = RestartBreadcrumb {
        target_version: preparing.target_version.clone(),
        deadline_unix_ms: preparing.deadline_unix_ms,
        observed_unix_ms,
    };
    let encoded =
        serde_json::to_vec_pretty(&breadcrumb).map_err(|error| InstallStagingError::Io {
            operation: "encode-restart-breadcrumb",
            path: paths.recovery_breadcrumb.clone(),
            message: error.to_string(),
        })?;
    if let Some(parent) = paths.recovery_breadcrumb.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| io_error("create-breadcrumb-parent", parent, error))?;
    }
    fs::write(&paths.recovery_breadcrumb, encoded).map_err(|error| {
        io_error(
            "write-restart-breadcrumb",
            &paths.recovery_breadcrumb,
            error,
        )
    })?;
    Ok(breadcrumb)
}

pub fn verify_manifest(
    manifest_json: &str,
    trust_anchors: &[TrustAnchor],
) -> Result<VerifiedManifest, UpdateManifestError> {
    let value = parse_value(manifest_json)?;
    let manifest: UpdateManifest = serde_json::from_value(value.clone()).map_err(|error| {
        UpdateManifestError::ManifestShapeInvalid {
            message: error.to_string(),
        }
    })?;
    if manifest.schema_version != 1 {
        return Err(UpdateManifestError::ManifestShapeInvalid {
            message: format!(
                "unsupported update manifest schemaVersion {}",
                manifest.schema_version
            ),
        });
    }
    let signature = decode_prefixed_base64(&manifest.signature, "ed25519:")
        .map_err(|_| UpdateManifestError::SignatureInvalid)?;
    let signature_bytes: [u8; 64] = signature
        .try_into()
        .map_err(|_| UpdateManifestError::SignatureInvalid)?;
    let signature = Signature::from_bytes(&signature_bytes);
    let canonical = canonical_manifest_bytes_from_value(&value)?;
    let lower_bound = manifest.key_version.saturating_sub(TRUST_WINDOW);
    let mut saw_trusted_window = false;

    for anchor in trust_anchors.iter().filter(|anchor| {
        anchor.key_version >= lower_bound && anchor.key_version <= manifest.key_version
    }) {
        saw_trusted_window = true;
        let public_key =
            decode_prefixed_base64(&anchor.public_key, "ed25519:").map_err(|message| {
                UpdateManifestError::PublicKeyInvalid {
                    key_version: anchor.key_version,
                    message,
                }
            })?;
        let public_key_bytes: [u8; 32] =
            public_key
                .try_into()
                .map_err(|_| UpdateManifestError::PublicKeyInvalid {
                    key_version: anchor.key_version,
                    message: "Ed25519 public key must be 32 bytes".to_string(),
                })?;
        let verifying_key = VerifyingKey::from_bytes(&public_key_bytes).map_err(|error| {
            UpdateManifestError::PublicKeyInvalid {
                key_version: anchor.key_version,
                message: error.to_string(),
            }
        })?;
        if verifying_key
            .verify_strict(canonical.as_bytes(), &signature)
            .is_ok()
        {
            return Ok(VerifiedManifest {
                app_id: manifest.app_id,
                version: manifest.version,
                channel: manifest.channel,
                key_version: manifest.key_version,
                rollback: manifest.rollback.unwrap_or(false),
                min_version: manifest.min_version,
                max_version: manifest.max_version,
            });
        }
    }

    if saw_trusted_window {
        Err(UpdateManifestError::SignatureInvalid)
    } else {
        Err(UpdateManifestError::NoTrustedKey {
            key_version: manifest.key_version,
        })
    }
}

pub fn canonical_manifest_bytes(manifest_json: &str) -> Result<String, UpdateManifestError> {
    let value = parse_value(manifest_json)?;
    canonical_manifest_bytes_from_value(&value)
}

fn parse_value(manifest_json: &str) -> Result<Value, UpdateManifestError> {
    serde_json::from_str(manifest_json).map_err(|error| UpdateManifestError::JsonInvalid {
        message: error.to_string(),
    })
}

fn canonical_manifest_bytes_from_value(value: &Value) -> Result<String, UpdateManifestError> {
    let mut unsigned = value.clone();
    let object =
        unsigned
            .as_object_mut()
            .ok_or_else(|| UpdateManifestError::ManifestShapeInvalid {
                message: "manifest must be a JSON object".to_string(),
            })?;
    if object.remove("signature").is_none() {
        return Err(UpdateManifestError::SignatureMissing);
    }
    Ok(canonical_json(&unsigned))
}

fn canonical_json(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::String(value) => {
            serde_json::to_string(value).expect("string serialization cannot fail")
        }
        Value::Array(values) => {
            let entries = values.iter().map(canonical_json).collect::<Vec<_>>();
            format!("[{}]", entries.join(","))
        }
        Value::Object(values) => {
            let mut entries = values.iter().collect::<Vec<_>>();
            entries.sort_by(|(left, _), (right, _)| left.cmp(right));
            let fields = entries
                .into_iter()
                .map(|(key, value)| {
                    format!(
                        "{}:{}",
                        serde_json::to_string(key).expect("string serialization cannot fail"),
                        canonical_json(value)
                    )
                })
                .collect::<Vec<_>>();
            format!("{{{}}}", fields.join(","))
        }
    }
}

fn decode_prefixed_base64(value: &str, prefix: &str) -> Result<Vec<u8>, String> {
    let encoded = value
        .strip_prefix(prefix)
        .ok_or_else(|| format!("value must start with {prefix}"))?;
    STANDARD.decode(encoded).map_err(|error| error.to_string())
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()
}

fn io_error(operation: &'static str, path: &Path, error: std::io::Error) -> InstallStagingError {
    InstallStagingError::Io {
        operation,
        path: path.to_path_buf(),
        message: error.to_string(),
    }
}

fn commit_temp_path(prepared: &PreparedInstall) -> PathBuf {
    let file_name = prepared
        .paths
        .current_bundle
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("bundle");
    prepared.paths.current_bundle.with_file_name(format!(
        ".{file_name}.commit-{}",
        prepared.plan.target_version
    ))
}

#[cfg(unix)]
fn preserve_replacement_permissions(
    existing: &Path,
    replacement: &Path,
) -> Result<(), InstallStagingError> {
    match fs::metadata(existing) {
        Ok(metadata) => fs::set_permissions(replacement, metadata.permissions())
            .map_err(|error| io_error("preserve-replacement-permissions", replacement, error)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(io_error("read-current-permissions", existing, error)),
    }
}

#[cfg(not(unix))]
fn preserve_replacement_permissions(
    _existing: &Path,
    _replacement: &Path,
) -> Result<(), InstallStagingError> {
    Ok(())
}

#[cfg(not(windows))]
fn atomic_replace(source: &Path, destination: &Path) -> Result<(), std::io::Error> {
    fs::rename(source, destination)
}

#[cfg(windows)]
fn atomic_replace(source: &Path, destination: &Path) -> Result<(), std::io::Error> {
    let source = wide_path(source);
    let destination = wide_path(destination);
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(windows)]
fn wide_path(path: &Path) -> Vec<u16> {
    path.as_os_str().encode_wide().chain([0]).collect()
}

fn rollback_allowed(
    policy: &UpdatePolicy,
    manifest: &VerifiedManifest,
    installed_version: &Version,
) -> Result<bool, Box<UpdatePolicyRejection>> {
    if !manifest.rollback {
        return Ok(false);
    }
    let Some(max_version) = &manifest.max_version else {
        return Ok(false);
    };
    let max_version = parse_version(max_version, VersionSource::MaxVersion)
        .map_err(|error| rejection(policy, manifest, error))?;
    Ok(installed_version > &max_version)
}

fn parse_version(value: &str, source: VersionSource) -> Result<Version, UpdateCheckError> {
    Version::parse(value).map_err(|error| UpdateCheckError::VersionInvalid {
        value: value.to_string(),
        source,
        message: error.to_string(),
    })
}

fn rejection(
    policy: &UpdatePolicy,
    manifest: &VerifiedManifest,
    error: UpdateCheckError,
) -> Box<UpdatePolicyRejection> {
    Box::new(UpdatePolicyRejection {
        audit: UpdateAuditRow {
            event: audit_event(&error),
            configured_channel: policy.channel.clone(),
            manifest_channel: Some(manifest.channel.clone()),
            installed_version: policy.installed_version.clone(),
            manifest_version: Some(manifest.version.clone()),
            reason: audit_reason(&error),
        },
        error,
    })
}

fn audit_event(error: &UpdateCheckError) -> UpdateAuditEvent {
    match error {
        UpdateCheckError::FeedUrlTemplateInvalid { .. } => UpdateAuditEvent::FeedUrlTemplateInvalid,
        UpdateCheckError::VersionInvalid { .. } => UpdateAuditEvent::InvalidVersion,
        UpdateCheckError::AppIdMismatch { .. } => UpdateAuditEvent::AppIdMismatch,
        UpdateCheckError::WrongChannel { .. } => UpdateAuditEvent::WrongChannel,
        UpdateCheckError::BelowMinVersion { .. } => UpdateAuditEvent::BelowMinVersion,
        UpdateCheckError::DowngradeRefused { .. } => UpdateAuditEvent::DowngradeRefused,
    }
}

fn audit_reason(error: &UpdateCheckError) -> String {
    match error {
        UpdateCheckError::FeedUrlTemplateInvalid {
            missing_placeholder,
            ..
        } => format!("feed URL template is missing {missing_placeholder}"),
        UpdateCheckError::VersionInvalid { value, source, .. } => {
            format!("{source:?} version {value} is not valid semver")
        }
        UpdateCheckError::AppIdMismatch { expected, actual } => {
            format!("manifest appId {actual} does not match configured appId {expected}")
        }
        UpdateCheckError::WrongChannel { expected, actual } => {
            format!(
                "manifest channel {} does not match configured channel {}",
                actual.as_str(),
                expected.as_str()
            )
        }
        UpdateCheckError::BelowMinVersion {
            min_version,
            manifest_version,
        } => format!("manifest version {manifest_version} is below minVersion {min_version}"),
        UpdateCheckError::DowngradeRefused {
            installed_version,
            manifest_version,
        } => {
            format!("manifest version {manifest_version} is not newer than installed version {installed_version}")
        }
    }
}

impl UpdateChannel {
    fn as_str(&self) -> &'static str {
        match self {
            UpdateChannel::Stable => "stable",
            UpdateChannel::Beta => "beta",
            UpdateChannel::Canary => "canary",
        }
    }
}

impl UpdatePlatform {
    fn as_str(&self) -> &'static str {
        match self {
            UpdatePlatform::MacosArm64 => "macos-arm64",
            UpdatePlatform::MacosX64 => "macos-x64",
            UpdatePlatform::WindowsX64 => "windows-x64",
            UpdatePlatform::LinuxX64 => "linux-x64",
            UpdatePlatform::WindowsArm64 => "windows-arm64",
            UpdatePlatform::LinuxArm64 => "linux-arm64",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine};
    use ed25519_dalek::{Signer, SigningKey};
    use serde_json::json;

    #[test]
    fn verifies_manifest_signed_by_current_key() {
        let signed = signed_manifest(5, "1.2.3");

        let verified = verify_manifest(
            &signed.json,
            &[TrustAnchor {
                key_version: 5,
                public_key: signed.public_key,
            }],
        )
        .expect("manifest should verify");

        assert_eq!(verified.app_id, "dev.effect-desktop.playground");
        assert_eq!(verified.version, "1.2.3");
        assert_eq!(verified.key_version, 5);
    }

    #[test]
    fn canonical_bytes_are_stable_for_reordered_fields() {
        let signed = signed_manifest(5, "1.2.3");
        let reordered = json!({
            "signature": signed.signature,
            "version": "1.2.3",
            "schemaVersion": 1,
            "publishedAt": "2026-05-06T00:00:00.000Z",
            "keyVersion": 5,
            "channel": "stable",
            "artifacts": [{
                "signature": "ed25519:artifact",
                "sha256": "0".repeat(64),
                "sizeBytes": 4,
                "url": "https://updates.example.invalid/app.dmg",
                "kind": "dmg",
                "platform": "macos-arm64"
            }],
            "appId": "dev.effect-desktop.playground"
        })
        .to_string();

        assert_eq!(
            canonical_manifest_bytes(&signed.json).expect("canonical signed"),
            canonical_manifest_bytes(&reordered).expect("canonical reordered")
        );
    }

    #[test]
    fn rejects_tampered_manifest_field() {
        let signed = signed_manifest(5, "1.2.3");
        let tampered = signed
            .json
            .replace("\"version\":\"1.2.3\"", "\"version\":\"9.9.9\"");

        let error = verify_manifest(
            &tampered,
            &[TrustAnchor {
                key_version: 5,
                public_key: signed.public_key,
            }],
        )
        .expect_err("tampered manifest must fail");

        assert_eq!(error, UpdateManifestError::SignatureInvalid);
    }

    #[test]
    fn rejects_key_outside_rotation_window() {
        let signed = signed_manifest(5, "1.2.3");

        let error = verify_manifest(
            &signed.json,
            &[TrustAnchor {
                key_version: 2,
                public_key: signed.public_key,
            }],
        )
        .expect_err("old key must fail");

        assert_eq!(error, UpdateManifestError::NoTrustedKey { key_version: 5 });
    }

    #[test]
    fn rejects_unknown_top_level_signed_field() {
        let signed = sign_value(json!({
            "schemaVersion": 1,
            "appId": "dev.effect-desktop.playground",
            "version": "1.2.3",
            "channel": "stable",
            "keyVersion": 5,
            "publishedAt": "2026-05-06T00:00:00.000Z",
            "critical": true,
            "artifacts": [{
                "platform": "macos-arm64",
                "kind": "dmg",
                "url": "https://updates.example.invalid/app.dmg",
                "sizeBytes": 4,
                "sha256": "0".repeat(64),
                "signature": "ed25519:artifact"
            }]
        }));

        let error = verify_manifest(
            &signed.json,
            &[TrustAnchor {
                key_version: 5,
                public_key: signed.public_key,
            }],
        )
        .expect_err("manifest with unknown top-level field must fail closed");

        match error {
            UpdateManifestError::ManifestShapeInvalid { message } => {
                assert!(
                    message.contains("critical"),
                    "expected unknown-field error to mention `critical`, got: {message}"
                );
            }
            other => panic!("expected ManifestShapeInvalid, got {other:?}"),
        }
    }

    #[test]
    fn rejects_unknown_artifact_field() {
        let signed = sign_value(json!({
            "schemaVersion": 1,
            "appId": "dev.effect-desktop.playground",
            "version": "1.2.3",
            "channel": "stable",
            "keyVersion": 5,
            "publishedAt": "2026-05-06T00:00:00.000Z",
            "artifacts": [{
                "platform": "macos-arm64",
                "kind": "dmg",
                "url": "https://updates.example.invalid/app.dmg",
                "sizeBytes": 4,
                "sha256": "0".repeat(64),
                "signature": "ed25519:artifact",
                "priority": "high"
            }]
        }));

        let error = verify_manifest(
            &signed.json,
            &[TrustAnchor {
                key_version: 5,
                public_key: signed.public_key,
            }],
        )
        .expect_err("manifest with unknown artifact field must fail closed");

        match error {
            UpdateManifestError::ManifestShapeInvalid { message } => {
                assert!(
                    message.contains("priority"),
                    "expected unknown-field error to mention `priority`, got: {message}"
                );
            }
            other => panic!("expected ManifestShapeInvalid, got {other:?}"),
        }
    }

    #[test]
    fn rejects_unknown_schema_version() {
        let signed = signed_manifest_with_schema(2, 5, "1.2.3");

        let error = verify_manifest(
            &signed.json,
            &[TrustAnchor {
                key_version: 5,
                public_key: signed.public_key,
            }],
        )
        .expect_err("unknown schema must fail closed");

        assert_eq!(
            error,
            UpdateManifestError::ManifestShapeInvalid {
                message: "unsupported update manifest schemaVersion 2".to_string()
            }
        );
    }

    #[test]
    fn stable_policy_rejects_beta_manifest_with_wrong_channel() {
        let manifest = verified_manifest("1.2.3", UpdateChannel::Beta, false, None);
        let policy = update_policy(UpdateChannel::Stable, "1.0.0", None);

        let rejection = evaluate_update(&policy, &manifest)
            .expect_err("stable clients must reject beta manifests");

        assert_eq!(
            rejection.error,
            UpdateCheckError::WrongChannel {
                expected: UpdateChannel::Stable,
                actual: UpdateChannel::Beta
            }
        );
        assert_eq!(rejection.audit.event, UpdateAuditEvent::WrongChannel);
    }

    #[test]
    fn policy_rejects_manifest_for_a_different_app_id() {
        let mut manifest = verified_manifest("1.2.3", UpdateChannel::Stable, false, None);
        manifest.app_id = "dev.effect-desktop.other".to_string();
        let policy = update_policy(UpdateChannel::Stable, "1.0.0", None);

        let rejection =
            evaluate_update(&policy, &manifest).expect_err("wrong appId must fail closed");

        assert_eq!(
            rejection.error,
            UpdateCheckError::AppIdMismatch {
                expected: "dev.effect-desktop.playground".to_string(),
                actual: "dev.effect-desktop.other".to_string()
            }
        );
        assert_eq!(rejection.audit.event, UpdateAuditEvent::AppIdMismatch);
    }

    #[test]
    fn canary_policy_accepts_canary_manifest_and_resolves_feed_url() {
        let manifest = verified_manifest("1.2.3", UpdateChannel::Canary, false, None);
        let policy = update_policy(UpdateChannel::Canary, "1.0.0", None);

        let decision = evaluate_update(&policy, &manifest)
            .expect("canary clients should accept canary manifests");

        assert_eq!(decision.version, "1.2.3");
        assert_eq!(decision.channel, UpdateChannel::Canary);
        assert_eq!(
            decision.feed_url,
            "https://updates.example.invalid/macos-arm64/canary.json"
        );
    }

    #[test]
    fn min_version_floor_rejects_old_manifest_version() {
        let manifest = verified_manifest("1.1.9", UpdateChannel::Stable, false, None);
        let policy = update_policy(UpdateChannel::Stable, "1.0.0", Some("1.2.0"));

        let rejection = evaluate_update(&policy, &manifest)
            .expect_err("manifest below minVersion must fail closed");

        assert_eq!(
            rejection.error,
            UpdateCheckError::BelowMinVersion {
                min_version: "1.2.0".to_string(),
                manifest_version: "1.1.9".to_string()
            }
        );
        assert_eq!(rejection.audit.event, UpdateAuditEvent::BelowMinVersion);
    }

    #[test]
    fn manifest_min_version_is_also_enforced() {
        let mut manifest = verified_manifest("1.1.9", UpdateChannel::Stable, false, None);
        manifest.min_version = Some("1.2.0".to_string());
        let policy = update_policy(UpdateChannel::Stable, "1.0.0", None);

        let rejection = evaluate_update(&policy, &manifest)
            .expect_err("manifest minVersion must also be a floor");

        assert_eq!(
            rejection.error,
            UpdateCheckError::BelowMinVersion {
                min_version: "1.2.0".to_string(),
                manifest_version: "1.1.9".to_string()
            }
        );
    }

    #[test]
    fn installed_or_equal_version_is_rejected_without_rollback_window() {
        let manifest = verified_manifest("1.2.0", UpdateChannel::Stable, false, None);
        let policy = update_policy(UpdateChannel::Stable, "1.2.0", None);

        let rejection =
            evaluate_update(&policy, &manifest).expect_err("same-version update must fail closed");

        assert_eq!(
            rejection.error,
            UpdateCheckError::DowngradeRefused {
                installed_version: "1.2.0".to_string(),
                manifest_version: "1.2.0".to_string()
            }
        );
        assert_eq!(rejection.audit.event, UpdateAuditEvent::DowngradeRefused);
    }

    #[test]
    fn rollback_pack_is_accepted_when_installed_version_exceeds_max_version() {
        let manifest = verified_manifest("1.2.0", UpdateChannel::Stable, true, Some("1.3.0"));
        let policy = update_policy(UpdateChannel::Stable, "1.3.1", None);

        let decision = evaluate_update(&policy, &manifest)
            .expect("rollback packs apply only above their maxVersion window");

        assert_eq!(decision.version, "1.2.0");
        assert!(decision.rollback);
    }

    #[test]
    fn feed_url_template_must_include_platform_and_channel_placeholders() {
        let error = resolve_feed_url(
            "https://updates.example.invalid/{platform}/stable.json",
            &UpdatePlatform::MacosArm64,
            &UpdateChannel::Stable,
        )
        .expect_err("template without channel placeholder must fail");

        assert_eq!(
            error,
            UpdateCheckError::FeedUrlTemplateInvalid {
                template: "https://updates.example.invalid/{platform}/stable.json".to_string(),
                missing_placeholder: "{channel}"
            }
        );
    }

    #[test]
    fn feed_url_template_without_platform_placeholder_is_rejected() {
        let error = resolve_feed_url(
            "https://updates.example.invalid/{channel}.json",
            &UpdatePlatform::MacosArm64,
            &UpdateChannel::Stable,
        )
        .expect_err("template without platform placeholder must fail");

        assert_eq!(
            error,
            UpdateCheckError::FeedUrlTemplateInvalid {
                template: "https://updates.example.invalid/{channel}.json".to_string(),
                missing_placeholder: "{platform}"
            }
        );
    }

    #[test]
    fn feed_url_template_without_any_placeholder_is_rejected() {
        let error = resolve_feed_url(
            "https://updates.example.invalid/stable.json",
            &UpdatePlatform::MacosArm64,
            &UpdateChannel::Stable,
        )
        .expect_err("template without placeholders must fail");

        assert_eq!(
            error,
            UpdateCheckError::FeedUrlTemplateInvalid {
                template: "https://updates.example.invalid/stable.json".to_string(),
                missing_placeholder: "{platform}"
            }
        );
    }

    #[test]
    fn feed_url_template_with_both_placeholders_resolves() {
        let resolved = resolve_feed_url(
            "https://updates.example.invalid/{platform}/{channel}.json",
            &UpdatePlatform::MacosArm64,
            &UpdateChannel::Stable,
        )
        .expect("template with both placeholders must resolve");

        assert_eq!(
            resolved,
            "https://updates.example.invalid/macos-arm64/stable.json"
        );
    }

    #[test]
    fn truncated_download_aborts_and_leaves_current_bundle_intact() {
        let root = test_root("truncated-download");
        let paths = install_paths(&root);
        fs::create_dir_all(root.join("current")).expect("current dir");
        fs::write(&paths.current_bundle, b"prior").expect("prior bundle");
        let plan = install_plan(b"new-bundle");

        let error = stage_install(&plan, &paths, b"new", 1_000)
            .expect_err("truncated downloads must abort");

        assert_eq!(
            error,
            InstallStagingError::UpdateDownloadTruncated {
                downloaded_bytes: 3,
                expected_bytes: 10
            }
        );
        assert_eq!(
            fs::read(&paths.current_bundle).expect("prior bundle still readable"),
            b"prior"
        );
        assert!(!paths.temp_dir.exists());
        remove_test_root(root);
    }

    #[test]
    fn stage_install_writes_verified_bundle_and_rollback_metadata_before_commit() {
        let root = test_root("stage-install");
        let paths = install_paths(&root);
        fs::create_dir_all(root.join("current")).expect("current dir");
        fs::write(&paths.current_bundle, b"prior").expect("prior bundle");
        let plan = install_plan(b"new-bundle");

        let prepared = stage_install(&plan, &paths, b"new-bundle", 1_000)
            .expect("verified bytes should stage");

        assert_eq!(prepared.plan.target_version, "1.1.0");
        assert_eq!(
            fs::read(&paths.current_bundle).expect("prior bundle still readable"),
            b"prior"
        );
        assert_eq!(
            fs::read(&paths.staged_bundle).expect("staged bundle"),
            b"new-bundle"
        );
        let rollback: RollbackMetadata =
            serde_json::from_slice(&fs::read(&paths.rollback_metadata).expect("rollback metadata"))
                .expect("rollback metadata json");
        assert_eq!(rollback.prior_version, "1.0.0");
        assert_eq!(rollback.target_version, "1.1.0");
        remove_test_root(root);
    }

    #[test]
    fn commit_staged_install_moves_verified_bundle_to_current_path() {
        let root = test_root("commit-install");
        let paths = install_paths(&root);
        fs::create_dir_all(root.join("current")).expect("current dir");
        fs::write(&paths.current_bundle, b"prior").expect("prior bundle");
        let plan = install_plan(b"new-bundle");
        let prepared = stage_install(&plan, &paths, b"new-bundle", 1_000)
            .expect("verified bytes should stage");

        commit_staged_install(&prepared).expect("commit should rename staged bundle");

        assert_eq!(
            fs::read(&paths.current_bundle).expect("current bundle"),
            b"new-bundle"
        );
        assert!(!commit_temp_path(&prepared).exists());
        remove_test_root(root);
    }

    #[cfg(unix)]
    #[test]
    fn staged_and_committed_bundle_preserve_existing_execute_bits() {
        use std::os::unix::fs::PermissionsExt;

        let root = test_root("commit-install-permissions");
        let paths = install_paths(&root);
        fs::create_dir_all(root.join("current")).expect("current dir");
        fs::write(&paths.current_bundle, b"prior").expect("prior bundle");
        fs::set_permissions(&paths.current_bundle, fs::Permissions::from_mode(0o755))
            .expect("current bundle mode");
        let plan = install_plan(b"new-bundle");

        let prepared = stage_install(&plan, &paths, b"new-bundle", 1_000)
            .expect("verified bytes should stage");

        assert_eq!(
            fs::metadata(&paths.staged_bundle)
                .expect("staged metadata")
                .permissions()
                .mode()
                & 0o777,
            0o755
        );

        commit_staged_install(&prepared).expect("commit should replace current bundle");

        assert_eq!(
            fs::metadata(&paths.current_bundle)
                .expect("current metadata")
                .permissions()
                .mode()
                & 0o777,
            0o755
        );
        remove_test_root(root);
    }

    #[test]
    fn truncated_download_error_is_not_masked_by_stale_temp_cleanup_failure() {
        let root = test_root("truncated-cleanup-failure");
        let paths = install_paths(&root);
        fs::create_dir_all(&root).expect("root dir");
        fs::write(&paths.temp_dir, b"not a directory").expect("stale temp file");
        let plan = install_plan(b"new-bundle");

        let error = stage_install(&plan, &paths, b"new", 1_000)
            .expect_err("truncation must remain the returned failure");

        assert_eq!(
            error,
            InstallStagingError::UpdateDownloadTruncated {
                downloaded_bytes: 3,
                expected_bytes: 10
            }
        );
        remove_test_root(root);
    }

    #[test]
    fn stale_unstapled_notarization_returns_typed_value() {
        let error = validate_notarization(false, 1_000, 1_000 + STALE_NOTARIZATION_MS + 1)
            .expect_err("old unstapled bundles require confirmation");

        assert_eq!(
            error,
            InstallStagingError::UpdateStaleNotarization {
                notarized_at_unix_ms: 1_000
            }
        );
        validate_notarization(true, 1_000, 1_000 + STALE_NOTARIZATION_MS + 1)
            .expect("stapled bundles are not stale warnings");
    }

    #[test]
    fn restart_ack_after_deadline_writes_recovery_breadcrumb() {
        let root = test_root("restart-breadcrumb");
        let paths = install_paths(&root);
        let preparing = prepare_restart("1.1.0", 1_000);
        let late = preparing.deadline_unix_ms + 1;

        let error = ready_for_restart(&paths, &preparing, late)
            .expect_err("late readiness acknowledgement must fail");

        assert_eq!(
            error,
            InstallStagingError::RestartDeadlineExceeded {
                deadline_unix_ms: 6_000,
                observed_unix_ms: 6_001
            }
        );
        let breadcrumb: RestartBreadcrumb =
            serde_json::from_slice(&fs::read(&paths.recovery_breadcrumb).expect("breadcrumb"))
                .expect("breadcrumb json");
        assert_eq!(breadcrumb.target_version, "1.1.0");
        assert!(paths.recovery_breadcrumb.exists());
        remove_test_root(root);
    }

    #[test]
    fn restart_deadline_saturates_instead_of_wrapping() {
        let preparing = prepare_restart("1.1.0", u64::MAX - 1);

        assert_eq!(preparing.deadline_unix_ms, u64::MAX);
    }

    struct SignedManifest {
        json: String,
        signature: String,
        public_key: String,
    }

    fn signed_manifest(key_version: u32, version: &str) -> SignedManifest {
        signed_manifest_with_schema(1, key_version, version)
    }

    fn signed_manifest_with_schema(
        schema_version: u32,
        key_version: u32,
        version: &str,
    ) -> SignedManifest {
        sign_value(json!({
            "schemaVersion": schema_version,
            "appId": "dev.effect-desktop.playground",
            "version": version,
            "channel": "stable",
            "keyVersion": key_version,
            "publishedAt": "2026-05-06T00:00:00.000Z",
            "artifacts": [{
                "platform": "macos-arm64",
                "kind": "dmg",
                "url": "https://updates.example.invalid/app.dmg",
                "sizeBytes": 4,
                "sha256": "0".repeat(64),
                "signature": "ed25519:artifact"
            }]
        }))
    }

    fn sign_value(unsigned: Value) -> SignedManifest {
        let seed = [7_u8; 32];
        let signing_key = SigningKey::from_bytes(&seed);
        let public_key = format!(
            "ed25519:{}",
            STANDARD.encode(signing_key.verifying_key().as_bytes())
        );
        let canonical = canonical_json(&unsigned);
        let signature = format!(
            "ed25519:{}",
            STANDARD.encode(signing_key.sign(canonical.as_bytes()).to_bytes())
        );
        let mut signed = unsigned.as_object().expect("manifest object").clone();
        signed.insert("signature".to_string(), Value::String(signature.clone()));
        SignedManifest {
            json: Value::Object(signed).to_string(),
            signature,
            public_key,
        }
    }

    fn update_policy(
        channel: UpdateChannel,
        installed_version: &str,
        min_version: Option<&str>,
    ) -> UpdatePolicy {
        UpdatePolicy {
            app_id: "dev.effect-desktop.playground".to_string(),
            channel,
            platform: UpdatePlatform::MacosArm64,
            installed_version: installed_version.to_string(),
            min_version: min_version.map(str::to_string),
            feed_url: "https://updates.example.invalid/{platform}/{channel}.json".to_string(),
        }
    }

    fn verified_manifest(
        version: &str,
        channel: UpdateChannel,
        rollback: bool,
        max_version: Option<&str>,
    ) -> VerifiedManifest {
        VerifiedManifest {
            app_id: "dev.effect-desktop.playground".to_string(),
            version: version.to_string(),
            channel,
            key_version: 5,
            rollback,
            min_version: None,
            max_version: max_version.map(str::to_string),
        }
    }

    fn install_plan(bytes: &[u8]) -> InstallPlan {
        InstallPlan {
            prior_version: "1.0.0".to_string(),
            target_version: "1.1.0".to_string(),
            expected_bytes: u64::try_from(bytes.len()).expect("test bytes length fits u64"),
            expected_sha256: sha256_hex(bytes),
        }
    }

    fn install_paths(root: &std::path::Path) -> InstallPaths {
        InstallPaths {
            current_bundle: root.join("current").join("bundle.bin"),
            temp_dir: root.join("staging"),
            staged_bundle: root.join("staging").join("bundle.bin"),
            rollback_metadata: root.join("staging").join("rollback.json"),
            recovery_breadcrumb: root.join("state").join("restart-breadcrumb.json"),
        }
    }

    fn test_root(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "effect-desktop-native-updater-{name}-{}-{nanos}",
            std::process::id()
        ))
    }

    fn remove_test_root(root: PathBuf) {
        if root.exists() {
            fs::remove_dir_all(root).expect("remove test root");
        }
    }
}
