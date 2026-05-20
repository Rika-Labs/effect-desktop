# Milestone 15: Secrets

Tracks `engineering/SPEC.md` §24.15 and GitHub issue #5. Format follows the repo
milestone convention and includes the §28.4 completion report.

## Goal

Provide a privileged runtime path for persistent secrets, redact secret-shaped
fields at current human-visible emission boundaries, and migrate legacy
plaintext Settings credentials into Secrets.

## Non-goals

Per §24.15:

- do not expand public API beyond the milestone;
- do not introduce product-specific concepts;
- do not skip tests because later milestones will add tests;
- do not solve cross-platform polish before the primitive is validated.

Specifically deferred from this phase: Phase 16 capability lifecycle and approval
broker, Phase 19 devtools panels for browsing secrets, cross-machine secret sync,
hardware-backed attestation, and platform-specific libsecret/keychain polish.

## Required files

- `packages/core/src/runtime/secrets.ts` and
  `packages/core/src/runtime/secrets.test.ts`.
- `packages/bridge/src/redaction.ts` and
  `packages/bridge/src/redaction.test.ts`.
- `packages/core/src/runtime/secrets-migration.ts` and
  `packages/core/src/runtime/secrets-migration.test.ts`.
- `packages/test/src/index.ts` and `packages/test/src/index.test.ts` for the
  reusable memory secrets safe-storage adapter.
- Learning records for issues #12, #13, and #14.

## Public APIs

`@orika/core` exports:

- `Secrets` / `SecretsLayer` / `makeSecrets` for namespaced secret
  `set/get/delete/list`.
- `SecretBytes` as Effect `Redacted.Redacted<Uint8Array>` values with explicit
  `unsafeSecretBytes` access and `wipeSecretBytes` cleanup.
- `SecretsSafeStorage` / `makeSecretsSafeStorageLayer` as the core-owned port
  that native SafeStorage or tests can implement without creating a package
  cycle.
- `runSecretsMigration` for first-launch plaintext Settings migration.
- `RedactionFilter` and `redact` re-exported from the bridge.

`@orika/test` exports `makeMemorySecretsSafeStorage` for deterministic
Secrets tests.

## Acceptance criteria

From §24.15:

- [x] `set/get/delete` works.
- [x] renderer cannot direct access the core `Secrets` backing store; callers
      use a runtime API gated by `secrets.read` / `secrets.write`, and native
      SafeStorage remains a separate port/adapter surface.
- [x] audit is emitted without secret values.

## Appendix C verification rows

```txt
Requirement: C.38 Secret access is audited.
Test file: packages/core/src/runtime/secrets.test.ts
Command: bun test packages/core/src/runtime/secrets.test.ts
Result: pass locally before PR #219 and covered by CI.
Notes: Tests assert successful set/get audit rows contain namespace, key,
outcome, and trace id, and never contain the secret value.
```

```txt
Requirement: C.55 Secret redaction.
Test file: packages/bridge/src/redaction.test.ts,
packages/bridge/src/handlers.test.ts, packages/native/src/index.test.ts
Command: bun test
Result: pass locally before PR #220 and covered by CI.
Notes: Current real emission boundaries are bridge failure responses/state and
CrashReporter breadcrumbs. Devtools and production checker sinks are still later
phase surfaces, so the shared primitive is exported for those packages when they
become real.
```

## Validation commands

```bash
bun install --frozen-lockfile
bun run check
bun run typecheck
bun run lint
bun run lint:types
bun run format:check
bun test
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo check --workspace
cargo test --workspace
```

Specialized Phase 15 evidence:

- `packages/core/src/runtime/secrets.test.ts` covers namespace-scoped
  set/get/delete/list, validation before storage calls, permission denial before
  storage calls, unavailable platform storage, value-free audit rows, and typed
  audit failures.
- `packages/bridge/src/redaction.test.ts` covers nested records, allowlists,
  arrays, cycles, unchanged object identity, and byte arrays.
- `packages/core/src/runtime/secrets-migration.test.ts` covers first-run
  migration, second-run no-op, retry after write failure, flag behavior, legacy
  row deletion, and audit payloads without secret values.
- `packages/test/src/index.test.ts` covers `makeMemorySecretsSafeStorage` as a
  reusable mock Secrets backing store.
- CI validated the Phase 15 implementation PRs #219, #220, and #221 on
  Blacksmith Ubuntu, Windows, and macOS runners before merge.

## Completion report

```txt
Milestone: Phase 15 - Secrets
Files changed: core Secrets service and migration; bridge redaction primitive;
CrashReporter/bridge emission redaction wiring; test package memory secrets
adapter; Phase 15 learning records.
Public APIs added: @orika/core Secrets, SecretBytes helpers,
SecretsSafeStorage port/layer helpers, runSecretsMigration, RedactionFilter
re-export; @orika/test makeMemorySecretsSafeStorage.
Tests added: Secrets runtime tests; redaction filter and emission-boundary tests;
legacy secrets migration tests; memory secrets mock tests.
Validation commands run: bun install --frozen-lockfile; bun run check; bun run
typecheck; bun run lint; bun run lint:types; bun run format:check; bun test;
cargo fmt --check; cargo clippy --workspace --all-targets -- -D warnings; cargo
check --workspace; cargo test --workspace.
Validation results: all pass locally on the phase-close branch; Phase 15
implementation PRs #219 through #221 were green in Blacksmith CI before merge.
Known limitations: host platform SafeStorage adapter remains the native package
port surface from Phase 8; future devtools/config production-checker sinks must
wire the existing RedactionFilter when those packages are implemented.
Follow-up items: Phase 16 adds full capability lifecycle, approval broker,
security checker, CSP weakening acknowledgement, and origin authentication.
```

## Completion notes

Phase 15 shipped as three implementation PRs plus this closure PR:

- #219 added the core `Secrets` facade with a core-owned SafeStorage port,
  namespace permissions, typed errors, redacted values, and audit rows.
- #220 added the shared redaction primitive and wired current bridge and
  CrashReporter emission boundaries.
- #221 added the first-launch legacy Settings migration with read-back
  verification, value-free audit, plaintext deletion, and a completion flag.

The durable lesson from the phase is that secrets are a dependency-direction and
observability problem, not just a storage problem. Runtime policy stays in core,
native/platform behavior sits behind a port, every access is an Effect value with
typed failures, and human-visible emission boundaries share one redaction
primitive.
