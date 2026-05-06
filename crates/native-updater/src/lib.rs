use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, VerifyingKey};
use semver::Version;
use serde::Deserialize;
use serde_json::Value;

pub const TRUST_WINDOW: u32 = 2;

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

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
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
        let seed = [7_u8; 32];
        let signing_key = SigningKey::from_bytes(&seed);
        let public_key = format!(
            "ed25519:{}",
            STANDARD.encode(signing_key.verifying_key().as_bytes())
        );
        let unsigned = json!({
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
        });
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
}
