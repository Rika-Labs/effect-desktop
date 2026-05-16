## Changes

- Added typed `isSupported(method)` guard contracts to `Screen`, `PowerMonitor`, and `SystemAppearance`.
- Added service/client support mappings so app-facing services return booleans while bridge clients send typed host envelopes.
- Made unsupported clients report `supported: false` without invoking or subscribing to guarded operations.
- Added native tests for service delegation, bridge envelopes, and unsupported guard behavior across the three primitives.
- Added production-checker regression coverage for guarded partial OS-state contracts.
- Updated the public API snapshot for the new native exports.

## Verification

- `bun test packages/native/src/index.test.ts packages/config/src/index.test.ts`
- `bun packages/cli/src/bin.ts check --api`
- `bun run typecheck`
- `bun run lint`
- `bunx prettier --check <changed files>`
- `bun run check`
- `bun run lint:types`
- `bun test`

## Known Local Drift

- `bun run format:check` fails on pre-existing `.devin/config.local.json`; changed-file Prettier passed.

Handoff: `/pr`
