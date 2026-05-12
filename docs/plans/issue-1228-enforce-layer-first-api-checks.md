# Issue #1228: Enforce Layer-first API checks

## Decision

Add a first-class `desktop check --layer-first` gate and wire it into the root `bun run check` script so CI fails when new source introduces Layer-first contract violations outside explicit edge allowlists.

## Problem

What is true now: the Layer-first contract is documented, but violations still depend on reviewer memory. Existing code also has intentional composition edges and adapter boundaries that use `Effect.run*`, runtime globals, or Promise-shaped interop.

What must remain true: this issue must not refactor every existing violation, replace oxlint, or ban `Effect.run*` in tests.

What should be true: new hidden runtime shortcuts fail mechanically, while existing and intentional edge files are visible debt in one allowlist.

## Files to change

- `packages/cli/src/layer-first-check.ts` — scanner, allowlist data, report/error formatting, and typed check API.
- `packages/cli/src/layer-first-check.test.ts` — failing and allowed examples for `Effect.run*`, runtime globals, Promise public APIs, and non-schema boundary classes.
- `packages/cli/src/index.ts` — expose `runLayerFirstCheck` and add `desktop check --layer-first`.
- `package.json` — run `bun packages/cli/src/bin.ts check --layer-first` from the root `check` script after `turbo check`.
- `docs/roadmap/layer-first-issue-order.md` — mark #1228 progress once implemented.

## Enforcement model

- Scan authored TypeScript/TSX under `packages`, `apps`, `templates`, and `scripts`.
- Exclude tests, generated output, vendored source, and declaration/build output.
- Fail for forbidden `Effect.run*` calls outside allowlisted edge files.
- Fail for direct runtime globals outside allowlisted edge files: `process.env`, `Date.now`, `Math.random`, `crypto.randomUUID`, `globalThis.crypto.randomUUID`, and `Bun.env`.
- Audit public API snapshots and package root source files for public Promise signatures outside explicit symbol allowlists.
- Fail for exported public boundary classes whose names end in `Input`, `Output`, `Payload`, `Event`, `Result`, `Options`, or `Config` unless they extend `Schema.Class` or are explicitly allowlisted.

## Test-first plan

1. Add tests that build temporary workspace fixtures and prove the check fails for:
   - hidden `Effect.runPromise`;
   - direct `process.env`;
   - an exported public function returning `Promise`;
   - an exported public `UserInput` class that does not extend `Schema.Class`.
2. Add tests that prove allowed composition edges and test files pass.
3. Implement the scanner and CLI mode.
4. Wire the root check gate and run the focused tests before broad validation.

## Risks

- A naive scanner can block valid adapter code. Keep the first pass scoped to file-level and symbol-level allowlists so existing debt is visible without turning this issue into a migration.
- Public API signatures contain some intentional Promise interop in renderer adapters and low-level host adapters. The check should name those exceptions explicitly instead of pretending they are compliant.

## Verification

- `bun test packages/cli/src/layer-first-check.test.ts`
- `bun test packages/cli/src/index.test.ts -t "desktop check"`
- `bun packages/cli/src/bin.ts check --layer-first`
- `bun run check`
- `bun run typecheck`
- `bun run lint`
- `bun run lint:types`
- `bun run format:check`
