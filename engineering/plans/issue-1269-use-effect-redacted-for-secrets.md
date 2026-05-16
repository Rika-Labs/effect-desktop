# Issue #1269: Use Effect Redacted for Secrets and Redaction Boundaries

## Objective

Replace Effect Desktop's local secret/redaction sentinels with Effect `Redacted` values. Effect should own redacted formatting, equality, and unsafe access; Effect Desktop should keep only desktop-specific policy: byte copying, optional byte wiping, key/namespace validation, safe-storage transport, audit, permission checks, and bridge emission redaction.

## Pre-change Shape

- `packages/core/src/runtime/secrets.ts` exports a custom `SecretValue` class with private bytes, `unsafeBytes()`, `dispose()`, and redacted string/JSON/inspect formatting.
- `packages/native/src/safe-storage.ts` exports a second `SecretValue` class with the same behavior.
- `packages/bridge/src/redaction.ts` owns a local `"[REDACTED]"` sentinel and exposes it as `RedactionFilter.redactedValue`.
- Test helpers and memory safe-storage adapters copy bytes through `SecretValue.unsafeBytes()`.
- Safe-storage host protocol payloads already encode raw `Uint8Array` values and should not change.

## Target Shape

- Public secret payloads use `Redacted.Redacted<Uint8Array>`.
- Add narrow bridge-level helpers only for durable byte policy:
  - copy bytes on construction
  - copy bytes on unsafe extraction
  - fill the underlying byte array before `Redacted.wipeUnsafe`
- Core and native `SecretsApi` / `SafeStorageClientApi` accept and return `Redacted.Redacted<Uint8Array>`.
- Remove the duplicate `SecretValue` classes from core and native.
- Keep host protocol schemas as `Uint8Array`; bridge clients unwrap/wrap at the service boundary.
- Replace the local redaction sentinel with an Effect `Redacted` value so the canonical marker is no longer hand-rolled.
- Add a JSON/materialized redaction path for bridge, crash, and other protocol emission boundaries that must stay schema-compatible plain JSON.

## Architecture Debt Sweep

Remove now:

- The core `SecretValue` class.
- The native `SecretValue` class.
- The bridge-local `"[REDACTED]"` sentinel as the canonical redaction marker.

Keep:

- A small helper module for secret byte copy/wipe policy, because `Redacted.make(bytes)` intentionally preserves the provided reference and desktop safe-storage boundaries need copy semantics.
- `RedactionFilter`, because it owns bridge/devtools/audit emission policy: matching field names, allowlists, cycle handling, map handling, and JSON-safe replacement before values cross diagnostic boundaries.
- `RedactionFilter.redactForJson`, because Effect `Redacted` values implement `toJSON` and are rejected by the host-frame JSON validator; protocol emission must materialize redacted leaves to strings after redaction.

No follow-up issue is expected for this touched area unless implementation uncovers another independent redaction wrapper.

## Verification

- Focused:
  - `bun test packages/bridge/src/redaction.test.ts packages/core/src/runtime/secrets.test.ts packages/native/src/index.test.ts packages/test/src/index.test.ts`
  - `rg -n "class SecretValue|\\[REDACTED\\]|unsafeBytes\\(|SecretValue\\." packages apps templates tests docs api/snapshots`
- API:
  - `bun packages/cli/src/bin.ts check --api --write`
- Full before push:
  - `bun run format:check`
  - `git diff --check`
  - `bun run typecheck`
  - `bun run lint`
  - `bun run lint:types`
  - `bun run check`
  - `bun test`
  - `bun run build`
  - `bun packages/cli/src/bin.ts check --api`
  - `cargo fmt --check`
  - `cargo check --workspace`
  - `cargo test --workspace`
  - `cargo clippy --workspace --all-targets -- -D warnings`

## Out of Scope

- Changing safe-storage host protocol wire payloads.
- Showing raw secrets in privileged devtools.
- Replacing the whole bridge redaction walker with a data-classification system.
