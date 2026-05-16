---
title: Atoms (React)
description: Effect atom integration for fine-grained reactive state.
kind: reference
audience: app-developers
effect_version: 4
---

# Atoms

Re-exports from `@effect/atom-react` — fine-grained reactive primitives integrated with the desktop runtime.

## Imports

```ts
import {
  DesktopAtomRegistryContext,
  DesktopAtomRegistryProvider,
  useAtom,
  useAtomValue,
  useAtomSet,
  useAtomSuspense,
  useAtomMount,
  useAtomRefresh,
  useAtomSubscribe,
  useAtomInitialValues,
  AsyncResult,
  Atom
} from "@effect-desktop/react"
```

## When to use atoms

For state that:

- Multiple components observe with selective subscription.
- Derives from other state through computation.
- Is shared across the renderer but not handler-side.

For RPC-shaped state, prefer `useQuery` / `useMutation` / `useStream`.

## Provider

Wrap your app in `DesktopAtomRegistryProvider` (or rely on `ReactDesktop.from(...).createRoot(...)` which sets it up).

## Effect reactivity

`AsyncResult` and `Atom` re-export from `effect/unstable/reactivity` — useful for typing your own atoms.

## Related

- Reference: upstream [`@effect/atom-react`](https://github.com/Effect-TS/effect/tree/main/packages/atom-react) docs
- Source: re-exports in [`packages/react/src/index.ts`](../../../packages/react/src/index.ts)
