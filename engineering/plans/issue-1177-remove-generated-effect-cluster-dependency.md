# Issue #1177: Remove Generated @effect/cluster Dependency

## Current state

`packages/create-orika/src/index.ts` always pins `effect`, rewrites first-party
workspace dependencies, and adds optional dependencies for selected scaffold features.

The `includeCluster` option still adds `@effect/cluster`, even though the repo's cluster
prototype and ADR use `effect/unstable/cluster` from the main `effect` package. Generated
apps therefore learn a package boundary the framework does not want to support.

## Architecture

Generated apps should depend on `effect` only for cluster APIs. `includeCluster` should
not add any dependency beyond the existing `effect` pin. Templates may still mention
`effect/unstable/cluster` as the future cluster import path, but generated manifests must
not include `@effect/cluster`.

Keep the `includeCluster` option for now because the CLI and template UX still uses it as
a feature selector/stub marker. This issue only removes the incorrect package dependency.

## Files

- `packages/create-orika/src/index.ts`
  - Remove the `@effect/cluster` dependency insertion from the `includeCluster` branch.
- `packages/create-orika/src/index.test.ts`
  - Update optional dependency coverage so `includeCluster` asserts `effect` remains
    pinned and `@effect/cluster` is absent.
  - Add a generated cluster manifest regression assertion for the canonical
    `effect/unstable/cluster` dependency boundary.
- `engineering/roadmap/layer-first-issue-order.md`
  - Mark #1177 implemented.
- `engineering/learnings/2026-05-12-remove-generated-effect-cluster-dependency.md`
  - Capture the dependency-boundary lesson after verification.

## Tests

- `bun test packages/create-orika/src/index.test.ts`
- `bun run --filter create-orika typecheck`
- `bun run check`
- `bun run typecheck`
- `bun test`
- `bun run lint`
- `bun run lint:types`
- `bun run format:check`
- `bun run desktop check --api --write`
- `bun run desktop check --api`

## Thin wrappers / follow-ups

Remove now:

- The generated `@effect/cluster` dependency. It is a false package boundary over the
  canonical `effect/unstable/cluster` module.

Keep as tracked follow-up:

- #1164 removes the remaining raw create-CLI argument pre-pass. It exists beside
  `effect/unstable/cli` and should be retired when the CLI parsing behavior can be
  represented directly with Effect CLI primitives.
