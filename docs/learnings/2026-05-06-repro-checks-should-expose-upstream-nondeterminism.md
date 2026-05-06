# Repro Checks Should Expose Upstream Nondeterminism

## Observation

The reproducibility check could be implemented without fixing native-host byte instability first. Running the real playground `.app` path then proved the mechanism by finding nondeterministic host bytes and reporting the exact affected files and offsets.

## Evidence

- Issue #65 required `desktop check --repro` to run build/package twice and diff staged plus packaged artifacts.
- PR #254 added `packages/cli/src/reproducible-build-check.ts`, the CLI dispatcher, JSON/text reports, and CI-visible repro regression tests.
- Local validation passed: `bun install --frozen-lockfile`, `bun run check`, `bun run typecheck`, `bun run lint`, `bun run lint:types`, `bun run format:check`, `bun test`, `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo check --workspace`, `cargo test --workspace`.
- The real command `bun packages/cli/src/bin.ts check --repro --config apps/playground/desktop.config.ts --artifact app` failed as designed: `build-layout/native/host` differed at byte offset `10500525`, with the packaged executable copies and derived checksum metadata differing afterward.
- Follow-up issue #255 captures making the native host itself byte-reproducible.

## General principle

A reproducibility gate should report raw byte differences before it tries to normalize them. Normalization belongs in the artifact producer once the checker has named the unstable file and offset.

## Trigger condition

Apply this when adding a supply-chain or release gate whose first run may expose nondeterminism in an upstream build step.

## Limits / counterexamples

Do not use this to justify a permanently failing required CI check. If the real artifact is known nondeterministic, gate the checker with deterministic regression fixtures first and file the producer fix separately.

## Codification target

- docs/learnings
- follow-up issue

## Proposed amendment or issue

Use #255 to make the native host build byte-reproducible so `desktop check --repro` can later run against the real packaged artifact as a required CI command instead of only the repro regression fixture.
