# Issue #1178: Narrow the core public root export

## Decision

Keep `@orika/core` as the stable app-construction and service-contract barrel, and move low-level runtime plumbing behind explicit `@orika/core/runtime/*` subpaths.

## Problem

What is true now: `packages/core/src/index.ts` wildcard-exports nearly every runtime module, including framed transport, stdio/postMessage socket adapters, renderer RPC client helpers, RPC descriptor internals, telemetry OpenTelemetry wiring, framework metrics, window supervisor state, and workflow implementations.

What must remain true: existing intended public SDK imports such as `Desktop`, capability metadata helpers, resource/service contracts, permissions, filesystem/process/worker/SQLite/settings/secrets services, public errors, and documented runtime service APIs must remain available.

What should be true: users can import stable SDK concepts from `@orika/core`, while advanced or implementation-coupled runtime modules require explicit `@orika/core/runtime/<module>` imports.

## Files to change

- `packages/core/package.json` — expose runtime subpaths explicitly with `./runtime/*`.
- `packages/core/src/index.ts` — remove root wildcard exports for low-level runtime plumbing.
- `packages/core/src/index.test.ts` — add regression coverage that root omits low-level plumbing and runtime subpaths resolve.
- `packages/vite/src/stdio-bridge.ts` — import framed transport helpers from the explicit runtime subpath.
- `api/snapshots/@orika__core.snapshot.json` — update the intentional public API snapshot.
- `api/snapshots/@orika__native.snapshot.json` — accept existing generated method-order drift surfaced by the API writer so the API gate stays clean.
- `engineering/plans/issue-1178-narrow-core-public-root-export.md` — record scope and verification.

## Test-first plan

1. Add a failing core barrel test that asserts `FrameDecoder`, `encodeFrame`, `layerStdioSocket`, `makeDesktopRendererRpcRuntime`, and `describeRpcs` are absent from the root.
2. Add a failing subpath test that imports `@orika/core/runtime/transport` and proves `FrameDecoder`/`encodeFrame` still resolve for advanced callers.
3. Add the `./runtime/*` export pattern in `packages/core/package.json`.
4. Remove low-level wildcard exports from `packages/core/src/index.ts`, keeping stable service contracts on the root.
5. Update internal imports that used root-only low-level symbols to use explicit runtime subpaths.
6. Refresh the core API snapshot after the tests and typecheck identify the exact intentional public surface change.

## Review criteria

- Root imports stay stable for primary app code: `Desktop`, app construction helpers, bridge RPC metadata helpers, resource/service contracts, public schemas, and public typed errors.
- Runtime plumbing remains reachable only through explicit subpaths.
- The change does not redesign transport, renderer RPC, telemetry, or workflow internals.
- Snapshot churn is explained by named removals from the root, not by unrelated signature drift.

## Risks

- The root barrel still exposes many runtime services because those are current public service contracts. This issue should not silently remove documented service APIs without a separate compatibility decision.
- Export patterns make advanced coupling possible by design. The improvement is that such coupling becomes explicit in import paths and visible in review.
- Browser-facing packages must continue to use `@orika/core/renderer` and must not import host-only runtime subpaths.

## Verification

- `bun test packages/core/src/index.test.ts`
- `bun test tests/repo-shape.test.ts`
- `bun packages/cli/src/bin.ts check --api`
- `bun run typecheck`
- `bun run lint`
- `bun run lint:types`
- `bun run format:check`
- `bun test`
