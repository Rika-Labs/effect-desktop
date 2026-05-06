# Issue 87 Work: Update Manifest Format and Signature Verification

## Issue and branch

- Issue: #87, <https://github.com/Rika-Labs/effect-desktop/issues/87>
- Branch: `issue-87-update-manifest`
- Base: `f5d6d11 add macOS notarization pipeline (#258)`

## Tasks completed

- Added `packages/cli/src/update-manifest.ts` as the publish-side `UpdateManifest` module.
- Wired `desktop publish --config <path> [--platform <target>] [--json]` through `runCli`.
- Added canonical JSON encoding for every manifest field except top-level `signature`.
- Added Ed25519 artifact signatures and manifest signatures using an explicit `update.privateKeyEnv` PEM key.
- Added byte-stability verification before writing `dist/desktop/update-manifest.json`.
- Replaced the `crates/native-updater` Phase 0 stub with typed manifest parsing and strict Ed25519 verification.
- Added bounded trust-anchor rotation: clients accept keys in `manifest.keyVersion - 2..=manifest.keyVersion`.
- Added a `crates/native-updater/README.md` dependency note for `ed25519-dalek`, `base64`, `serde`, and `serde_json`.
- Updated `packages/cli/README.md`.

## Tests added

- `desktop publish writes a byte-stable Ed25519-signed update manifest`
- `desktop publish canonical bytes ignore object insertion order`
- `desktop publish rejects tampered manifest signatures through canonical bytes`
- `desktop publish rejects stale package metadata before signing the manifest`
- `desktop publish signs macOS app directory artifacts with deterministic directory digests`
- `native-updater::verifies_manifest_signed_by_current_key`
- `native-updater::canonical_bytes_are_stable_for_reordered_fields`
- `native-updater::rejects_tampered_manifest_field`
- `native-updater::rejects_key_outside_rotation_window`
- `native-updater::rejects_unknown_schema_version`

## Deviations from design

The issue text says manifests are signed with `update.publicKey`; the implementation uses `update.publicKey` as the public trust anchor and `update.privateKeyEnv` as the publish-only private signing key input. Signing with a public key is cryptographically impossible; this keeps the config contract explicit.

## Discovered issues

None.

## Verification commands run during work

- `bun run typecheck` — passed.
- `bun test packages/cli/src/index.test.ts -t 'desktop publish'` — passed, 5 tests, 16 assertions.
- `cargo test -p native-updater` — passed, 5 tests.
- `bun run lint` — passed.
- `bun run lint:types` — passed.
- `cargo fmt --check` — passed.
- `bun run format:check` — passed.
- Full validation gate passed:
  - `bun install --frozen-lockfile`
  - `bun run check`
  - `bun run typecheck`
  - `bun run lint`
  - `bun run lint:types`
  - `bun run format:check`
  - `bun test` — 569 tests passed.
  - `cargo fmt --check`
  - `cargo clippy --workspace --all-targets -- -D warnings`
  - `cargo check --workspace`
  - `cargo test --workspace`

## Handoff

Implementation in place. Continue to `/verify`.
