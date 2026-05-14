# Narrow core root export

## Planned

Issue #1178 asked for `@effect-desktop/core` to stop behaving like a dump of every runtime
module. The stable root needed to keep app construction, public service contracts, schemas,
typed errors, and the `Desktop` facade, while low-level runtime plumbing moved to explicit
runtime subpaths.

## Shipped

The root barrel no longer exports framed transport helpers, socket adapters, renderer RPC client
internals, RPC descriptor internals, telemetry provider wiring, framework metrics, window runtime
helpers, or workflow implementations. `packages/core/package.json` now exposes
`@effect-desktop/core/runtime/*`, and internal callers that needed renderer or framed transport
types now import those modules through the explicit subpath.

Regression tests now assert that `FrameDecoder`, `encodeFrame`, `layerStdioSocket`,
`makeDesktopRendererRpcRuntime`, and `describeRpcs` are absent from the root while
`@effect-desktop/core/runtime/transport` remains available. The public API snapshot records the
intentional root-surface reduction. The API writer also normalized pre-existing native
method-name snapshot order drift so `check --api` stays clean.

## Verification

- `bun test packages/core/src/index.test.ts`
- `bun test packages/core/src/index.test.ts packages/react/src/index.test.ts packages/solid/src/index.test.ts packages/vue/src/index.test.ts tests/repo-shape.test.ts`
- `bun packages/cli/src/bin.ts check --api`
- `bun run typecheck`
- `bun run lint`
- `bun run lint:types`
- `bun run format:check`
- `bun test`

## Lesson

Root barrels need contract tests, not only API snapshots. Snapshots show that the surface changed,
but a focused import test states the product rule: app code gets stable SDK concepts from the root,
and advanced runtime coupling must be visible in the import path.
