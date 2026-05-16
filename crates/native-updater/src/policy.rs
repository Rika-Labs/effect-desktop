use crate::audit::{audit_event, audit_reason, UpdateAuditRow};
use crate::manifest::{UpdateChannel, UpdatePlatform, VerifiedManifest};
use semver::Version;

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
