# Signed Manifests Bind Metadata To Payloads

## Observation

The first publish implementation signed artifact payloads but copied `sizeBytes` and `sha256` from package metadata without recomputing them. That allowed a signed update manifest to describe different bytes than the artifact signature covered.

## Evidence

- Review comment on PR #263: <https://github.com/Rika-Labs/effect-desktop/pull/263>
- Fixed in `packages/cli/src/update-manifest.ts` by recomputing size and SHA-256 from the artifact payload before signing.
- Added `desktop publish rejects stale package metadata before signing the manifest`.
- Added directory-aware `.app` hashing so macOS app bundles use the same deterministic digest shape as packaging.
- Added `native-updater::rejects_unknown_schema_version` so older clients fail closed on unknown manifest schemas.
- PR CI passed on `blacksmith-2vcpu-ubuntu-2404`, `blacksmith-2vcpu-windows-2025`, and `blacksmith-6vcpu-macos-latest`.

## General principle

When a signed manifest contains metadata about an artifact, the signer must derive that metadata from the exact payload being signed and reject any mismatch before producing the manifest signature.

## Trigger condition

Apply this when release tooling signs a manifest that includes artifact size, digest, version, platform, schema, or URL metadata.

## Limits / counterexamples

Do not recompute expensive payload data multiple times after the manifest is signed; compute once before signing and carry the result forward as immutable data. If a later phase introduces remote artifact publishing, the same rule applies at the upload boundary.

## Codification target

- test fixture

## Proposed amendment or issue

Keep the stale-metadata publish test, the `.app` directory publish test, and the unknown-schema verifier test as the guards. No AGENTS.md amendment is needed because the repo already requires explicit failure modes and no silent trust fallbacks.
