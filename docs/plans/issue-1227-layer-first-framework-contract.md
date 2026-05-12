# Issue #1227: Codify the Layer-first framework contract

## Decision

Codify the Layer-first contract as a reviewable public contract, then prove one existing native capability can be supplied by live, client, and deterministic test layers without changing the user-level program.

## Problem

What is true now: the Layer-first thesis exists across `README.md`, `AGENTS.md`, package READMEs, and existing service code, but there is no single checklist engineers can apply to a new public capability.

What must remain true: `docs/SPEC.md` remains normative, scope stays limited to #1227, and this ticket must not refactor every existing runtime service.

What should be true: a contributor can review a new effectful public API against one contract, and tests prove the substitution model with a real capability.

## Files to change

- `docs/architecture/layer-first-contract.md` — new canonical contract and review checklist.
- `README.md` — link the canonical contract from the framework thesis.
- `AGENTS.md` — point implementation agents at the canonical checklist.
- `packages/test/src/index.test.ts` — prove `Screen` runs through live, client/RPC, and test layers with the same program.
- `packages/test/README.md` — document the test-layer side of the example.

## Test-first plan

1. Add a failing documentation/shape test that requires the canonical contract file and key checklist terms.
2. Add a failing `Screen` substitution test that defines one `program: Effect.Effect<_, _, Screen>` and runs it through:
   - `ScreenLive` plus an explicit `ScreenClient` layer;
   - `ScreenLive` plus `makeScreenBridgeClientLayer(...)`;
   - `TestScreen.layer(...)`.
3. Implement the docs and any minimal exports or README updates needed for the tests to pass.

## Review criteria

- The contract uses Effect services, `Layer`, `Schema.Class`, stable tagged errors, and typed `Effect.Effect<A, E, R>` return values as the default public capability shape.
- Promise-returning APIs and concrete globals are only allowed at explicit integration edges.
- Live, Client, and Test layers satisfy the same service requirement; user code does not branch by provider.
- The example stays narrow: one existing capability proves the model; broad service refactors remain out of scope.
- The docs do not invent a second source of truth over `docs/SPEC.md`; they extract a checklist from it.

## Risks

- Existing services still use older `Context.Service` declarations in places. This plan codifies the target contract for new public effectful APIs without forcing a repo-wide migration in #1227.
- Native host adapters are not fully implemented for every capability. The proof should use explicit layers and deterministic fixtures, not a real OS host.

## Verification

- `bun test tests/layer-first-contract.test.ts`
- `bun test packages/test/src/index.test.ts`
- `bun run typecheck`
- `bun run lint`
- `bun run lint:types`
- `bun run format:check`
