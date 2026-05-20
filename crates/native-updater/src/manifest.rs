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
    pub artifacts: Vec<UpdateArtifact>,
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
            validate_signed_fields(&manifest)?;
            return Ok(VerifiedManifest {
                app_id: manifest.app_id,
                version: manifest.version,
                channel: manifest.channel,
                key_version: manifest.key_version,
                rollback: manifest.rollback.unwrap_or(false),
                min_version: manifest.min_version,
                max_version: manifest.max_version,
                artifacts: manifest.artifacts,
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

fn validate_signed_fields(manifest: &UpdateManifest) -> Result<(), UpdateManifestError> {
    if manifest.app_id.trim().is_empty() {
        return Err(UpdateManifestError::ManifestShapeInvalid {
            message: "manifest appId must be non-empty".to_string(),
        });
    }
    validate_published_at("publishedAt", &manifest.published_at)?;
    parse_signed_version("version", &manifest.version)?;
    validate_signed_version_opt("minVersion", manifest.min_version.as_deref())?;
    validate_signed_version_opt("maxVersion", manifest.max_version.as_deref())?;
    Ok(())
}

fn parse_signed_version(field_name: &'static str, value: &str) -> Result<(), UpdateManifestError> {
    Version::parse(value)
        .map(|_| ())
        .map_err(|error| UpdateManifestError::ManifestShapeInvalid {
            message: format!("{field_name} must be a valid semantic version: {error}"),
        })
}

fn validate_signed_version_opt(
    field_name: &'static str,
    value: Option<&str>,
) -> Result<(), UpdateManifestError> {
    let Some(value) = value else {
        return Ok(());
    };
    if value.trim().is_empty() {
        return Err(UpdateManifestError::ManifestShapeInvalid {
            message: format!("{field_name} must be non-empty"),
        });
    }
    parse_signed_version(field_name, value)
}

fn validate_published_at(field_name: &'static str, value: &str) -> Result<(), UpdateManifestError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(UpdateManifestError::ManifestShapeInvalid {
            message: format!("{field_name} must be non-empty"),
        });
    }

    let mut parts = value.split('T');
    let date = parts
        .next()
        .ok_or_else(|| UpdateManifestError::ManifestShapeInvalid {
            message: format!("{field_name} must be RFC3339 date-time"),
        })?;
    let time_with_zone = parts
        .next()
        .ok_or_else(|| UpdateManifestError::ManifestShapeInvalid {
            message: format!("{field_name} must be RFC3339 date-time"),
        })?;
    if parts.next().is_some() {
        return Err(UpdateManifestError::ManifestShapeInvalid {
            message: format!("{field_name} must be RFC3339 date-time"),
        });
    }

    let mut date_parts = date.split('-');
    let year = date_parts
        .next()
        .ok_or_else(|| UpdateManifestError::ManifestShapeInvalid {
            message: format!("{field_name} must be RFC3339 date-time"),
        })?;
    let month = date_parts
        .next()
        .ok_or_else(|| UpdateManifestError::ManifestShapeInvalid {
            message: format!("{field_name} must be RFC3339 date-time"),
        })?;
    let day = date_parts
        .next()
        .ok_or_else(|| UpdateManifestError::ManifestShapeInvalid {
            message: format!("{field_name} must be RFC3339 date-time"),
        })?;
    if date_parts.next().is_some() {
        return Err(UpdateManifestError::ManifestShapeInvalid {
            message: format!("{field_name} must be RFC3339 date-time"),
        });
    }
    let year = year
        .parse::<u32>()
        .map_err(|_| UpdateManifestError::ManifestShapeInvalid {
            message: format!("{field_name} must be RFC3339 date-time"),
        })?;
    let month = month
        .parse::<u32>()
        .map_err(|_| UpdateManifestError::ManifestShapeInvalid {
            message: format!("{field_name} must be RFC3339 date-time"),
        })?;
    let day = day
        .parse::<u32>()
        .map_err(|_| UpdateManifestError::ManifestShapeInvalid {
            message: format!("{field_name} must be RFC3339 date-time"),
        })?;

    if month == 0 || month > 12 {
        return Err(UpdateManifestError::ManifestShapeInvalid {
            message: format!("{field_name} must be valid date-time"),
        });
    }

    let max_days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            let leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
            if leap {
                29
            } else {
                28
            }
        }
        _ => unreachable!(),
    };
    if day == 0 || day > max_days {
        return Err(UpdateManifestError::ManifestShapeInvalid {
            message: format!("{field_name} must be valid date-time"),
        });
    }

    if year < 1 {
        return Err(UpdateManifestError::ManifestShapeInvalid {
            message: format!("{field_name} must be RFC3339 date-time"),
        });
    }

    let (time, zone) = split_time_and_zone(time_with_zone)?;
    let mut time_parts = time.split(':');
    let hour = time_parts
        .next()
        .ok_or_else(|| UpdateManifestError::ManifestShapeInvalid {
            message: format!("{field_name} must be RFC3339 date-time"),
        })?;
    let minute = time_parts
        .next()
        .ok_or_else(|| UpdateManifestError::ManifestShapeInvalid {
            message: format!("{field_name} must be RFC3339 date-time"),
        })?;
    let second = time_parts
        .next()
        .ok_or_else(|| UpdateManifestError::ManifestShapeInvalid {
            message: format!("{field_name} must be RFC3339 date-time"),
        })?;
    if time_parts.next().is_some() {
        return Err(UpdateManifestError::ManifestShapeInvalid {
            message: format!("{field_name} must be RFC3339 date-time"),
        });
    }

    let hour = hour
        .parse::<u32>()
        .map_err(|_| UpdateManifestError::ManifestShapeInvalid {
            message: format!("{field_name} must be RFC3339 date-time"),
        })?;
    let minute = minute
        .parse::<u32>()
        .map_err(|_| UpdateManifestError::ManifestShapeInvalid {
            message: format!("{field_name} must be RFC3339 date-time"),
        })?;
    let (second, fraction) = match second.split_once('.') {
        Some((whole, fraction)) => (whole, Some(fraction)),
        None => (second, None),
    };
    if let Some(fraction) = fraction {
        if second.is_empty() {
            return Err(UpdateManifestError::ManifestShapeInvalid {
                message: format!("{field_name} must be RFC3339 date-time"),
            });
        }
        if fraction.is_empty() {
            return Err(UpdateManifestError::ManifestShapeInvalid {
                message: format!("{field_name} must be RFC3339 date-time"),
            });
        }
        if fraction.parse::<u32>().is_err() {
            return Err(UpdateManifestError::ManifestShapeInvalid {
                message: format!("{field_name} must be RFC3339 date-time"),
            });
        }
    }
    let second = second
        .parse::<u32>()
        .map_err(|_| UpdateManifestError::ManifestShapeInvalid {
            message: format!("{field_name} must be RFC3339 date-time"),
        })?;
    if hour > 23 || minute > 59 || second > 59 {
        return Err(UpdateManifestError::ManifestShapeInvalid {
            message: format!("{field_name} must be valid date-time"),
        });
    }

    validate_timezone(zone)?;
    Ok(())
}

fn split_time_and_zone(value: &str) -> Result<(&str, &str), UpdateManifestError> {
    if let Some(value) = value.strip_suffix('Z') {
        return Ok((value, "Z"));
    }

    let Some(index) = value.rfind(['+', '-']) else {
        return Err(UpdateManifestError::ManifestShapeInvalid {
            message: "publishedAt must be RFC3339 date-time".to_string(),
        });
    };
    let (time, zone) = value.split_at(index);
    if zone.len() != 6 {
        return Err(UpdateManifestError::ManifestShapeInvalid {
            message: "publishedAt must be RFC3339 date-time".to_string(),
        });
    }

    Ok((time, zone))
}

fn validate_timezone(value: &str) -> Result<(), UpdateManifestError> {
    if value == "Z" {
        return Ok(());
    }
    let bytes = value.as_bytes();
    if bytes.len() != 6 {
        return Err(UpdateManifestError::ManifestShapeInvalid {
            message: "publishedAt must be RFC3339 date-time".to_string(),
        });
    }
    if bytes[0] != b'+' && bytes[0] != b'-' {
        return Err(UpdateManifestError::ManifestShapeInvalid {
            message: "publishedAt must be RFC3339 date-time".to_string(),
        });
    }
    if bytes[3] != b':' {
        return Err(UpdateManifestError::ManifestShapeInvalid {
            message: "publishedAt must be RFC3339 date-time".to_string(),
        });
    }

    let hour = std::str::from_utf8(&bytes[1..3])
        .ok()
        .and_then(|value| value.parse::<u32>().ok())
        .ok_or_else(|| UpdateManifestError::ManifestShapeInvalid {
            message: "publishedAt must be RFC3339 date-time".to_string(),
        })?;
    let minute = std::str::from_utf8(&bytes[4..6])
        .ok()
        .and_then(|value| value.parse::<u32>().ok())
        .ok_or_else(|| UpdateManifestError::ManifestShapeInvalid {
            message: "publishedAt must be RFC3339 date-time".to_string(),
        })?;

    if hour > 23 || minute > 59 {
        return Err(UpdateManifestError::ManifestShapeInvalid {
            message: "publishedAt must be valid date-time".to_string(),
        });
    }
    Ok(())
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

pub(crate) fn canonical_json(value: &Value) -> String {
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

impl UpdateChannel {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            UpdateChannel::Stable => "stable",
            UpdateChannel::Beta => "beta",
            UpdateChannel::Canary => "canary",
        }
    }
}

impl UpdatePlatform {
    pub(crate) fn as_str(&self) -> &'static str {
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
