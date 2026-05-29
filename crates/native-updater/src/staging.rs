use serde::{Deserialize, Serialize};
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

pub const STALE_NOTARIZATION_MS: u64 = 30 * 24 * 60 * 60 * 1_000;

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
    fs::copy(&prepared.paths.staged_bundle, &commit_temp).map_err(|error| {
        let _ = fs::remove_file(&commit_temp);
        io_error("copy-staged-bundle-to-commit-temp", &commit_temp, error)
    })?;
    preserve_replacement_permissions(&prepared.paths.current_bundle, &commit_temp).inspect_err(
        |_| {
            let _ = fs::remove_file(&commit_temp);
        },
    )?;
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

pub(crate) fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()
}

pub(crate) fn io_error(
    operation: &'static str,
    path: &Path,
    error: std::io::Error,
) -> InstallStagingError {
    InstallStagingError::Io {
        operation,
        path: path.to_path_buf(),
        message: error.to_string(),
    }
}

pub(crate) fn commit_temp_path(prepared: &PreparedInstall) -> PathBuf {
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
