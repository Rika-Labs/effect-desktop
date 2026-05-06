use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, VerifyingKey};
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
}
