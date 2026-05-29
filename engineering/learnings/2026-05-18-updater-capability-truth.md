---
date: 2026-05-18
issue: 1331
area: native-updater
---

# Updater Capability Truth

The Updater TypeScript surface existed before the Rust host adapter. That made the generated native parity matrix report `Updater.*` calls as supported even though the host router had no executable `Updater.*` methods.

The correction is to make support metadata match executable behavior. `Updater.*` now reports `host-adapter-unimplemented` across macOS, Windows, and Linux, the generated docs and CLI parity snapshot carry that same status, and runtime update docs no longer claim signed-manifest verification or install/restart behavior exists.

Architecture-debt sweep: inspected `Updater`, `UpdateWorkflow`, capability metadata, generated parity, updater docs, and the Rust host/protocol search results. No wrapper was removed. Debt remains: #1331 still needs the real signed manifest, artifact staging, install, restart, and Rust host adapter. This patch prevents unsupported updater functionality from being advertised while that work remains open.

Verification:

- `bun scripts/generate-native-parity-matrix.ts`
- `bun test packages/native/src/updater-workflow.test.ts`
- `bun test packages/native/src/capabilities.test.ts`
- `bun test packages/native/src/parity-matrix.test.ts`
- `bun test packages/native/src/index.test.ts -t Updater`
- `git diff --check`

Limitations: repo-wide and package-level `bun run typecheck` are blocked by existing Effect lint diagnostics outside this patch, including pre-existing diagnostics in core and broad native test files. Focused tests and generated parity checks cover the changed behavior.
