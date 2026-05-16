# Issue 88 Work

## Issue And Branch

- Issue: #88 — Channel routing (stable / beta / canary) and minVersion floor.
- Branch: `issue-88-channel-routing`.
- Base before work: `f0ecbfe` (`add signed update manifests (#263)`).

## Tasks Completed

- Added `UpdatePolicy`, `UpdateDecision`, `UpdateCheckError`, `UpdatePolicyRejection`, and `UpdateAuditRow` to `crates/native-updater`.
- Added `resolve_feed_url` for required `{platform}` and `{channel}` feed templates.
- Extended `VerifiedManifest` to preserve signed rollback, `minVersion`, and `maxVersion` metadata.
- Added `evaluate_update` to reject wrong-channel manifests, versions below configured or manifest floors, and downgrades unless the signed rollback window applies.
- Added `semver` as a direct dependency and documented the dependency in `crates/native-updater/README.md`.

## Tests Added

- `stable_policy_rejects_beta_manifest_with_wrong_channel`
- `canary_policy_accepts_canary_manifest_and_resolves_feed_url`
- `min_version_floor_rejects_old_manifest_version`
- `manifest_min_version_is_also_enforced`
- `installed_or_equal_version_is_rejected_without_rollback_window`
- `rollback_pack_is_accepted_when_installed_version_exceeds_max_version`
- `feed_url_template_must_include_platform_and_channel_placeholders`

## Deviations From Design

None. Clippy required boxing `UpdatePolicyRejection` at the `Result` boundary to avoid a large error variant; the rejection remains a typed value.

## Discovered Issues

None.

## Verification Commands Run During Work

- `cargo fmt --check -p native-updater` — passed.
- `cargo test -p native-updater` — passed, 12 tests.
- `cargo clippy -p native-updater --all-targets -- -D warnings` — passed.
- `cargo check -p native-updater` — passed.
- `cargo check --workspace` — passed.
- `cargo test --workspace` — passed.

## Handoff

Implementation in place. Continue to `/verify`.
