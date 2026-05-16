use crate::manifest::UpdateChannel;
use crate::policy::{UpdateCheckError, VersionSource};

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

pub(crate) fn audit_event(error: &UpdateCheckError) -> UpdateAuditEvent {
    match error {
        UpdateCheckError::FeedUrlTemplateInvalid { .. } => UpdateAuditEvent::FeedUrlTemplateInvalid,
        UpdateCheckError::VersionInvalid { .. } => UpdateAuditEvent::InvalidVersion,
        UpdateCheckError::AppIdMismatch { .. } => UpdateAuditEvent::AppIdMismatch,
        UpdateCheckError::WrongChannel { .. } => UpdateAuditEvent::WrongChannel,
        UpdateCheckError::BelowMinVersion { .. } => UpdateAuditEvent::BelowMinVersion,
        UpdateCheckError::DowngradeRefused { .. } => UpdateAuditEvent::DowngradeRefused,
    }
}

pub(crate) fn audit_reason(error: &UpdateCheckError) -> String {
    match error {
        UpdateCheckError::FeedUrlTemplateInvalid {
            missing_placeholder,
            ..
        } => format!("feed URL template is missing {missing_placeholder}"),
        UpdateCheckError::VersionInvalid { value, source, .. } => {
            let source = match source {
                VersionSource::Installed => "Installed",
                VersionSource::Manifest => "Manifest",
                VersionSource::MinVersion => "MinVersion",
                VersionSource::MaxVersion => "MaxVersion",
            };
            format!("{source} version {value} is not valid semver")
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
