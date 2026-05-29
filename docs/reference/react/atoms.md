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
} from "@orika/react"
```

## When to use atoms

For state that:

- Multiple components observe with selective subscription.
- Derives from other state through computation.
- Is shared across the renderer but not handler-side.

For RPC-shaped state, prefer `useDesktopQuery` / `useMutation` / `useDesktopStream`.

## Provider

`ReactDesktop.from(...).DesktopRoot` and the lower-level `DesktopProvider` both install `DesktopAtomRegistryContext.Provider` (the upstream `RegistryContext.Provider` from `@effect/atom-react`) bound to a per-runtime `AtomRegistry`. Mount one of those at the root and every `useAtom*` hook below it reads from the same registry. `DesktopAtomRegistryProvider` (the upstream `RegistryProvider`) is a separate component — reach for it only when wiring a custom registry outside the provider tree.

## Example

```tsx
import { Atom, useAtom, useAtomValue } from "@orika/react"

const counter = Atom.make(0)

function Counter() {
  const [count, setCount] = useAtom(counter)
  return <button onClick={() => setCount((value) => value + 1)}>{count}</button>
}

function CounterDisplay() {
  const count = useAtomValue(counter)
  return <span>{count}</span>
}
```

## Effect reactivity

`AsyncResult` and `Atom` re-export from `effect/unstable/reactivity` — useful for typing your own atoms and for narrowing query/mutation/stream state by hand.

## Related

- Reference: upstream [`@effect/atom-react`](https://github.com/Effect-TS/effect/tree/main/packages/atom-react) docs
- Source: re-exports in [`packages/react/src/index.ts`](../../../packages/react/src/index.ts)
