use super::*;
use crate::manifest::canonical_json;
use crate::staging::{commit_temp_path, sha256_hex};
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signer, SigningKey};
use serde_json::{json, Value};
use std::{fs, path::PathBuf};

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

    assert_eq!(verified.app_id, "dev.effect-desktop.inspector");
    assert_eq!(verified.version, "1.2.3");
    assert_eq!(verified.key_version, 5);
}

#[test]
fn manifest_validation_rejects_empty_app_id_invalid_version_and_bad_timestamp() {
    for (field, manifest) in [
        (
            "appId",
            json!({
                "schemaVersion": 1,
                "appId": "",
                "version": "1.2.3",
                "channel": "stable",
                "keyVersion": 5,
                "publishedAt": "2026-05-06T00:00:00.000Z",
                "artifacts": [artifact()]
            }),
        ),
        (
            "version",
            json!({
                "schemaVersion": 1,
                "appId": "dev.effect-desktop.inspector",
                "version": "not-a-version",
                "channel": "stable",
                "keyVersion": 5,
                "publishedAt": "2026-05-06T00:00:00.000Z",
                "artifacts": [artifact()]
            }),
        ),
        (
            "publishedAt",
            json!({
                "schemaVersion": 1,
                "appId": "dev.effect-desktop.inspector",
                "version": "1.2.3",
                "channel": "stable",
                "keyVersion": 5,
                "publishedAt": "not-a-date",
                "artifacts": [artifact()]
            }),
        ),
    ] {
        let signed = sign_value(manifest);

        let error = verify_manifest(
            &signed.json,
            &[TrustAnchor {
                key_version: 5,
                public_key: signed.public_key,
            }],
        )
        .expect_err("invalid signed field must fail");

        match error {
            UpdateManifestError::ManifestShapeInvalid { message } => {
                assert!(
                    message.contains(field),
                    "expected {field} error, got: {message}"
                );
            }
            other => panic!("expected ManifestShapeInvalid, got {other:?}"),
        }
    }
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
        "appId": "dev.effect-desktop.inspector"
    })
    .to_string();

    assert_eq!(
        canonical_manifest_bytes(&signed.json).expect("canonical signed"),
        canonical_manifest_bytes(&reordered).expect("canonical reordered")
    );
}

#[test]
fn rejects_tampered_manifest_and_key_outside_rotation_window() {
    let signed = signed_manifest(5, "1.2.3");
    let tampered = signed
        .json
        .replace("\"version\":\"1.2.3\"", "\"version\":\"9.9.9\"");

    let tampered_error = verify_manifest(
        &tampered,
        &[TrustAnchor {
            key_version: 5,
            public_key: signed.public_key.clone(),
        }],
    )
    .expect_err("tampered manifest must fail");
    assert_eq!(tampered_error, UpdateManifestError::SignatureInvalid);

    let old_key_error = verify_manifest(
        &signed.json,
        &[TrustAnchor {
            key_version: 2,
            public_key: signed.public_key,
        }],
    )
    .expect_err("old key must fail");
    assert_eq!(
        old_key_error,
        UpdateManifestError::NoTrustedKey { key_version: 5 }
    );
}

#[test]
fn unknown_signed_shape_fails_closed() {
    let signed = sign_value(json!({
        "schemaVersion": 1,
        "appId": "dev.effect-desktop.inspector",
        "version": "1.2.3",
        "channel": "stable",
        "keyVersion": 5,
        "publishedAt": "2026-05-06T00:00:00.000Z",
        "critical": true,
        "artifacts": [artifact()]
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
fn stable_policy_rejects_beta_manifest_with_audit_row() {
    let manifest = verified_manifest("1.2.3", UpdateChannel::Beta, false, None);
    let policy = update_policy(UpdateChannel::Stable, "1.0.0", None);

    let rejection =
        evaluate_update(&policy, &manifest).expect_err("stable clients must reject beta manifests");

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
fn policy_rejects_wrong_app_min_version_and_same_version() {
    let policy = update_policy(UpdateChannel::Stable, "1.2.0", Some("1.2.0"));

    let mut wrong_app = verified_manifest("1.3.0", UpdateChannel::Stable, false, None);
    wrong_app.app_id = "dev.effect-desktop.other".to_string();
    assert_eq!(
        evaluate_update(&policy, &wrong_app)
            .expect_err("wrong appId must fail closed")
            .audit
            .event,
        UpdateAuditEvent::AppIdMismatch
    );

    let below_floor = verified_manifest("1.1.9", UpdateChannel::Stable, false, None);
    assert_eq!(
        evaluate_update(&policy, &below_floor)
            .expect_err("manifest below minVersion must fail closed")
            .audit
            .event,
        UpdateAuditEvent::BelowMinVersion
    );

    let equal_version = verified_manifest("1.2.0", UpdateChannel::Stable, false, None);
    assert_eq!(
        evaluate_update(&policy, &equal_version)
            .expect_err("same-version update must fail closed")
            .audit
            .event,
        UpdateAuditEvent::DowngradeRefused
    );
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
fn feed_url_template_requires_platform_and_channel_placeholders() {
    assert_eq!(
        resolve_feed_url(
            "https://updates.example.invalid/{channel}.json",
            &UpdatePlatform::MacosArm64,
            &UpdateChannel::Stable,
        )
        .expect_err("template without platform placeholder must fail"),
        UpdateCheckError::FeedUrlTemplateInvalid {
            template: "https://updates.example.invalid/{channel}.json".to_string(),
            missing_placeholder: "{platform}"
        }
    );

    assert_eq!(
        resolve_feed_url(
            "https://updates.example.invalid/{platform}/stable.json",
            &UpdatePlatform::MacosArm64,
            &UpdateChannel::Stable,
        )
        .expect_err("template without channel placeholder must fail"),
        UpdateCheckError::FeedUrlTemplateInvalid {
            template: "https://updates.example.invalid/{platform}/stable.json".to_string(),
            missing_placeholder: "{channel}"
        }
    );

    assert_eq!(
        resolve_feed_url(
            "https://updates.example.invalid/{platform}/{channel}.json",
            &UpdatePlatform::MacosArm64,
            &UpdateChannel::Stable,
        )
        .expect("template with both placeholders must resolve"),
        "https://updates.example.invalid/macos-arm64/stable.json"
    );
}

#[test]
fn stage_install_rejects_truncated_download_before_touching_filesystem() {
    let root = test_root("truncated-download");
    let paths = install_paths(&root);
    fs::create_dir_all(root.join("current")).expect("current dir");
    fs::write(&paths.current_bundle, b"prior").expect("prior bundle");
    let plan = install_plan(b"new-bundle");

    let error =
        stage_install(&plan, &paths, b"new", 1_000).expect_err("truncated downloads must abort");

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
fn stage_and_commit_verified_bundle_preserving_rollback_metadata() {
    let root = test_root("stage-commit-install");
    let paths = install_paths(&root);
    fs::create_dir_all(root.join("current")).expect("current dir");
    fs::write(&paths.current_bundle, b"prior").expect("prior bundle");
    let plan = install_plan(b"new-bundle");

    let prepared =
        stage_install(&plan, &paths, b"new-bundle", 1_000).expect("verified bytes should stage");

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

    commit_staged_install(&prepared).expect("commit should replace current bundle");

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

    let prepared =
        stage_install(&plan, &paths, b"new-bundle", 1_000).expect("verified bytes should stage");

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

    let error =
        ready_for_restart(&paths, &preparing, late).expect_err("late acknowledgement must fail");

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
    sign_value(json!({
        "schemaVersion": 1,
        "appId": "dev.effect-desktop.inspector",
        "version": version,
        "channel": "stable",
        "keyVersion": key_version,
        "publishedAt": "2026-05-06T00:00:00.000Z",
        "artifacts": [artifact()]
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

fn artifact() -> Value {
    json!({
        "platform": "macos-arm64",
        "kind": "dmg",
        "url": "https://updates.example.invalid/app.dmg",
        "sizeBytes": 4,
        "sha256": "0".repeat(64),
        "signature": "ed25519:artifact"
    })
}

fn update_policy(
    channel: UpdateChannel,
    installed_version: &str,
    min_version: Option<&str>,
) -> UpdatePolicy {
    UpdatePolicy {
        app_id: "dev.effect-desktop.inspector".to_string(),
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
        app_id: "dev.effect-desktop.inspector".to_string(),
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
