#![allow(clippy::result_large_err)]
// Host method adapters return the canonical HostProtocolError enum from the
// wire contract. Boxing that error here would obscure the protocol surface.

use host_protocol::{
    HostProtocolError, UpdaterCheckPayload, UpdaterDownloadPayload, UpdaterInstallPayload,
};
use native_updater::{verify_manifest, TrustAnchor, UpdateManifestError};
use serde::de::DeserializeOwned;
use serde_json::Value;

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
    Err(unsupported(host_protocol::UPDATER_DOWNLOAD_METHOD))
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
    Err(unsupported(host_protocol::UPDATER_GET_STATUS_METHOD))
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

    let verified = verify_manifest(manifest_json, &trust_anchors)
        .map_err(|error| map_manifest_error(error, manifest_json))?;
    let current_version = input.current_version();
    let payload = if current_version == Some(verified.version.as_str()) {
        host_protocol::UpdaterCheckResultPayload::unavailable(
            Some(verified.version),
            Some("signed manifest verified for current version".to_string()),
        )
    } else {
        host_protocol::UpdaterCheckResultPayload::available(
            verified.version,
            Some("signed manifest verified".to_string()),
        )
    };

    serde_json::to_value(payload).map(Some).map_err(|error| {
        HostProtocolError::internal(error.to_string(), host_protocol::UPDATER_CHECK_METHOD)
    })
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

    #[test]
    fn updater_requests_decode_before_unsupported() {
        assert_eq!(
            check(Some(json!({ "currentVersion": "1.0.0" }))).expect_err("check"),
            HostProtocolError::unsupported(
                host_protocol::UPDATER_UNSUPPORTED_REASON,
                host_protocol::UPDATER_CHECK_METHOD,
            )
        );
        assert_eq!(
            download(Some(json!({ "version": "1.1.0" }))).expect_err("download"),
            HostProtocolError::unsupported(
                host_protocol::UPDATER_UNSUPPORTED_REASON,
                host_protocol::UPDATER_DOWNLOAD_METHOD,
            )
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
            get_status(None).expect_err("get status"),
            HostProtocolError::unsupported(
                host_protocol::UPDATER_UNSUPPORTED_REASON,
                host_protocol::UPDATER_GET_STATUS_METHOD,
            )
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
    }

    #[test]
    fn updater_check_maps_bad_manifest_signature_to_terminal_error() {
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
    }

    #[test]
    fn updater_check_requires_manifest_and_trust_anchor_together() {
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

    struct SignedManifest {
        json: String,
        public_key: String,
    }

    fn signed_manifest(key_version: u32, version: &str) -> SignedManifest {
        let mut unsigned = json!({
            "schemaVersion": 1,
            "appId": "dev.effect-desktop.inspector",
            "version": version,
            "channel": "stable",
            "keyVersion": key_version,
            "publishedAt": "2026-05-06T00:00:00.000Z",
            "artifacts": [{
                "platform": "macos-arm64",
                "kind": "dmg",
                "url": "https://updates.example.invalid/app.dmg",
                "sizeBytes": 4,
                "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
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
}
