# Issue 89 Work

## Issue And Branch

- Issue: #89 — Rollback metadata and restart integration after install staging.
- Branch: `issue-89-install-staging`.
- Base before work: `6fcccf8` (`Add updater channel routing policy (#264)`).

## Tasks Completed

- Added native updater install-staging types: `InstallPlan`, `InstallPaths`, `PreparedInstall`, `RollbackMetadata`, `RestartBreadcrumb`, `PreparingRestart`, and `InstallStagingError`.
- Added `stage_install` to reject truncated, size-mismatched, and digest-mismatched bytes before writing commit bytes.
- Added rollback metadata writing under the temp staging directory.
- Added `commit_staged_install` as the commit-point rename from staged bundle to current bundle.
- Added stale notarization validation as a typed `UpdateStaleNotarization` value.
- Added restart deadline helpers and breadcrumb persistence for forced restart recovery.
- Added `sha2` as a direct dependency and documented it in `crates/native-updater/README.md`.

## Tests Added

- `truncated_download_aborts_and_leaves_current_bundle_intact`
- `stage_install_writes_verified_bundle_and_rollback_metadata_before_commit`
- `commit_staged_install_moves_verified_bundle_to_current_path`
- `stale_unstapled_notarization_returns_typed_value`
- `restart_ack_after_deadline_writes_recovery_breadcrumb`

## Deviations From Design

None. Full OS restart, platform stapler invocation, and host event transport remain deferred until the updater host method exists.

## Discovered Issues

None.

## Verification Commands Run During Work

- `cargo fmt --check -p native-updater` — passed.
- `cargo test -p native-updater` — passed, 18 tests.
- `cargo clippy -p native-updater --all-targets -- -D warnings` — passed.
- `cargo check --workspace` — passed.

## Handoff

Implementation in place. Continue to `/verify`.
