# Issue #1219: Narrow the native public root export

## Decision

Make `@orika/native` a stable native service barrel, move schema-coded payload
contracts to `@orika/native/contracts`, keep the protocol adapter intentionally
reachable through `@orika/native/protocol`, and leave implementation-only modules
unexported from package exports.

## Problem

What is true now: `packages/native/src/index.ts` wildcard-exports every service module, every
contract module, workflow helpers, app event routing, HTTP server internals, and protocol helpers.
Because service modules also wildcard-export their contract files, the package root becomes the
compatibility contract for low-level schemas and implementation layout.

What must remain true: app and framework code can import stable native service tags, client ports,
live layers, RPC groups, bridge-client layer constructors, service-layer constructors, unsupported
clients, public typed service errors, and ergonomic service API types from the package root.

What should be true: schema classes and payload/result/event contracts are imported from
`@orika/native/contracts`; protocol-specific bridge helpers are imported from
`@orika/native/protocol`; implementation helpers such as app event routing, app HTTP
server, crash-report workflow, and updater workflow are not externally exported package paths.

## Files to change

- `packages/native/package.json` — add explicit `./contracts` and `./protocol` package exports.
- `packages/native/src/index.ts` — replace wildcard exports with named stable service exports.
- `packages/native/src/contracts/index.ts` — add the aggregate contract subpath barrel.
- `packages/native/src/index.test.ts` — add package-surface regression tests and move contract
  schema imports to the contracts subpath.
- `packages/test/src/native.ts` and renderer packages/templates — move native contract type
  imports to `@orika/native/contracts`.
- `api/snapshots/@orika__native.snapshot.json` — record the intentional root surface
  reduction.
- `engineering/roadmap/layer-first-issue-order.md` — record completion progress for #1205, #1178, and
  #1219.
- `engineering/plans/issue-1219-narrow-native-public-root-export.md` — record scope and verification.

## Test-first plan

1. Add failing tests that import `@orika/native` and assert contract-only symbols such as
   `WindowCreateInput`, implementation-only symbols such as `AppEventRouter`, and workflow symbols
   such as `UpdaterWorkflow` are absent from the root.
2. Add failing tests that import `@orika/native/contracts` and prove representative
   contracts such as `WindowCreateInput`, `ClipboardText`, and `DialogOpenResult` resolve.
3. Add failing tests that package-export resolution rejects implementation-only subpaths such as
   `@orika/native/app-http-server`.
4. Add package exports for `./contracts` and `./protocol`.
5. Replace the root wildcard barrel with explicit named exports for stable native services.
6. Move package consumers that need schema payload/result/event types to the contracts subpath.
7. Refresh the native API snapshot after typecheck identifies the exact intentional root changes.

## Review criteria

- The root remains ergonomic for service usage and test-layer construction.
- Contract schemas are available through one stable contracts subpath rather than leaked by root
  wildcard exports.
- Protocol remains explicit because bridge/runtime code legitimately depends on it.
- No native service behavior changes.
- Any snapshot churn outside `@orika/native` is investigated before commit.

## Risks

- Some current consumers import contract types from the root. Updating first-party consumers is
  part of the compatibility-boundary change; external callers will need the same import migration.
- Service source files may continue to re-export contracts for direct source-level tests. The
  package contract is governed by `package.json#exports` and `src/index.ts`.
- The issue example lists only a subset of today’s native services. The implementation should keep
  all spec-listed native services on the root, not silently drop services.

## Verification

- `bun test packages/native/src/index.test.ts`
- `bun test packages/test/src/index.test.ts packages/react/src/index.test.ts templates/basic-react-tailwind/src/template.test.ts`
- `bun packages/cli/src/bin.ts check --api`
- `bun run typecheck`
- `bun run lint`
- `bun run lint:types`
- `bun run format:check`
- `bun test`
