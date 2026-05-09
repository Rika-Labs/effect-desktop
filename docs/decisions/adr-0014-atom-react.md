# ADR-0014: Adopt @effect-atom/atom-react for renderer state and hooks (T16)

## Status

Accepted

## Context

`packages/react/src/index.ts` ships hand-rolled hooks (`useDesktop`, `useDesktopStream`, `useResource`, `usePermission`) that manage state with `useState` plus manual `Effect.runPromiseExit`. Each renderer page reimplements its own discriminated-union state machine (`idle | loading | success | failure`), and there is no shared invalidation mechanism.

`@effect-atom/atom-react` (note: the package name is `@effect-atom/atom-react`, not `@effect/atom-react`) ships atom-based reactive state with Effect/Stream/Layer integration: `Atom.runtime(layer).atom(effect)` for service-injected atoms, `useAtomValue`, `useAtom`, `useAtomSet`, `useAtomSuspense`, and `Result.builder.onInitial / onFailure / onSuccess` for typed render. These primitives replace every hand-rolled state machine with a single shared shape.

The v4 peer dependency status must be verified when this ticket is picked up. If only v3 is published, the hook surface is hand-authored over `ManagedRuntime` and swapped to the upstream package once v4 ships. This is the only gating risk.

Cross-dependency: T15 Reactivity wiring ([ADR-0013](adr-0013-reactivity.md)) must land before T16 so `useRpcQuery` invalidation works.

## Decision

Add `@effect-atom/atom-react` to `packages/react`. Replace the hand-rolled hooks with atom-based equivalents.

- `DesktopProvider` mounts `Atom.runtime(MainLayer)` plus `RegistryProvider` so atoms resolve services from the renderer's `MainLayer` (T20 spine).
- Hook surface narrows to:
  - `useRpcQuery(rpc, input)` — returns `Result<S, E>` backed by an atom over `Reactivity.stream` (T15).
  - `useRpcMutation(rpc)` — returns `{ invoke, state, reset }` backed by an atom plus `Reactivity.invalidate` (T15).
  - `useStream`, `useSubscribable`, `useEffect` — general patterns.
  - `useTheme`, `useNetwork`, `usePower`, `useDisplays` — wrap native subscribables.
- Re-export `useAtom`, `useAtomValue`, `useAtomSet`, `useAtomSuspense`, `Result`, and `RegistryProvider` from `packages/react` so applications do not depend on `@effect-atom/atom-react` directly.
- The hand-rolled hooks in `packages/react/src/index.ts` are deleted in the same change.

Cross-links: [ADR-0013](adr-0013-reactivity.md) (Reactivity.stream backing useRpcQuery), [ADR-0002](adr-0002-rpc-effect-unstable-rpc.md) (RpcClient consumed by useRpcQuery atoms).

## Alternatives considered

**Keep hand-rolled hooks**: each new page re-derives the same state machine; no shared invalidation; no `Result` typing. The surface grows without a shared shape. Rejected.

**Adopt Jotai or Zustand**: outside-Effect state libraries; no `Atom.runtime(layer)` integration with Effect services; no automatic fiber cancellation on unmount. Rejected.

**Use `ManagedRuntime` directly**: correct but verbose; every component manages its own runtime lifecycle. The atom abstraction handles this. Hand-author over `ManagedRuntime` only as a fallback if the v4 peer dep is unmet.

## Consequences

**Positive**

- `Result.onInitial / onFailure / onSuccess` gives typed render in every hook; no discriminated-union boilerplate per page.
- `useRpcQuery` invalidation is automatic via T15 Reactivity — a mutation in one component refetches all subscribed components without explicit wiring.
- Re-exporting from `packages/react` insulates applications from the upstream package name or version changes.

**Negative**

- v4 peer dep risk: if `@effect-atom/atom-react` has not published a v4-compatible release, the team must hand-author the hook surface and accept a migration when the package ships. This adds a one-time rewrite cost.
- Deleting the hand-rolled hooks is a breaking change for any application code that imported them directly.

**Neutral**

- Applications that imported `useDesktop` or `useDesktopStream` must migrate to `useRpcQuery` and `useRpcMutation`. The migration is mechanical.

## Validation

A renderer page rendering `useRpcQuery` shows `Result.onInitial` then `onSuccess` without manual state; a `useRpcMutation` invoke from another component triggers refetch via Reactivity without explicit wiring. `bun run typecheck` passes end-to-end on `packages/react`.

## Migration notes

1. Verify `@effect-atom/atom-react` v4 peer dep before adding the dependency.
2. Add `@effect-atom/atom-react` to `packages/react`.
3. Rewrite `DesktopProvider` to mount `Atom.runtime(MainLayer)` and `RegistryProvider`.
4. Implement `useRpcQuery`, `useRpcMutation`, `useStream`, `useSubscribable`, `useEffect`, and native subscribable wrappers.
5. Re-export `useAtom*`, `Result`, and `RegistryProvider` from `packages/react`.
6. Delete hand-rolled hooks.
7. Update renderer templates to use the new hook surface.
