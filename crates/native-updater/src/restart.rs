use crate::staging::{io_error, InstallPaths, InstallStagingError};
use serde::{Deserialize, Serialize};
use std::fs;

pub const RESTART_DEADLINE_MS: u64 = 5_000;

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
