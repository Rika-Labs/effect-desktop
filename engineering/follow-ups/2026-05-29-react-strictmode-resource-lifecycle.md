# Follow-up: React StrictMode resource lifecycle (provider/desktop)

Status: KNOWN, not yet fixed (no DOM/StrictMode test harness in this repo to verify a fix).

Two real but dev-only (React 19 StrictMode) defects surfaced by the source audit:

1. `packages/react/src/provider.tsx` — the AtomRegistry + ManagedRuntime are created in `useMemo`
   and disposed in a `useEffect([...])` cleanup. StrictMode runs effect setup -> cleanup -> setup
   without recomputing `useMemo`, so the second setup reuses the already-disposed registry, and any
   descendant `useAtomValue` throws "registry is disposed". Production (non-StrictMode) is unaffected.

2. `packages/react/src/desktop.tsx` — `makeReactDesktopRuntime` is built in `useMemo`, which forks a
   scoped `transport.run` subscription. React may discard a memoized value without running the
   `[runtime]` cleanup effect (StrictMode double-invoke, or any dropped memo), leaking the discarded
   runtime's transport subscription fiber.

Correct fix shape (both): do not acquire resources in `useMemo`. Acquire in a `useRef`/`useState`
lazy-init bound to the same dependency key and dispose exactly the created instance in the matching
`useEffect` cleanup, disposing any superseded/orphaned instance.

Why deferred: these are core renderer-runtime lifecycle changes. The package test suite uses
`renderToStaticMarkup` (SSR) which neither runs effects nor performs StrictMode double-invocation,
so a fix cannot be regression-tested here without adding a DOM test environment
(happy-dom/@testing-library/react). Fixing core lifecycle blind risks regressing every React app.
Resolve together with introducing a DOM test harness.
