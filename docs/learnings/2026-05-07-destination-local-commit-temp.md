# Destination-Local Commit Temp

## Observation

The first install-staging implementation treated the verified staged bundle as the file to atomically rename into place. Review exposed that this complected verification staging with the final commit point: a staged file may live on a different filesystem, while the final replace must be destination-local and preserve the existing executable metadata.

## Evidence

- PR: https://github.com/Rika-Labs/effect-desktop/pull/277
- Issue: https://github.com/Rika-Labs/effect-desktop/issues/89
- Review finding: `std::fs::rename` does not replace an existing destination on Windows.
- Address findings: guard restart deadline overflow, preserve truncation errors when cleanup fails, handle cross-filesystem commit, and preserve execute bits when replacing a Unix bundle.
- Fix commits: `023f41d`, `e019ea9`, `f89bf1a`, `419dade`.
- Verification:
  - `cargo test -p native-updater` passed with 21 tests.
  - `cargo clippy -p native-updater --all-targets -- -D warnings` passed locally.
  - `cargo check --workspace` passed locally.
  - Blacksmith CI passed on `blacksmith-2vcpu-ubuntu-2404`, `blacksmith-2vcpu-windows-2025`, and `blacksmith-6vcpu-macos-latest`.

## General principle

For install/update flows, separate the verification staging file from the commit file. Verification staging may optimize for cleanup and isolation; the commit file must be created in the destination directory and replaced with platform-specific atomic semantics while preserving executable metadata that the launcher depends on.

## Trigger condition

Apply this when code moves downloaded, generated, or migrated bytes from a temporary path into a durable current path, especially when the temp path may be on another filesystem, the current path may already exist, or the replacement must remain executable after restart.

## Limits / counterexamples

Do not add a destination-local commit temp for pure in-place metadata writes that already use a single filesystem-owned journal or database transaction. The extra temp file is for file replacement where the filesystem boundary and platform replace semantics are part of correctness.

## Codification target

- docs/learnings

## Proposed amendment or issue

No new issue. The learning is recorded here and the PR tests now cover replacing an existing current bundle, cleanup masking of typed install failures, and preserving Unix execute bits across staging and commit.
