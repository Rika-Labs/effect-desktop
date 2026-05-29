# React renderer StrictMode/lifecycle findings (fifth sweep, 2026-05-29)

The fifth sweep found a systemic class of renderer-lifecycle bugs: resources are
acquired in `useMemo` (render phase) but released in `useEffect` cleanup, so React
StrictMode's dev-default cleanup→setup cycle (which preserves `useMemo`) leaves a
tombstoned resource that is never rebuilt. Two root causes, both partly fixed.

## Fixed in this session

- **Scoped-operation hooks** (`useDesktopAction`/`useDesktopQuery` in hooks/desktop.ts,
  `useEffectResult`/`useSubscribable` in hooks/stream.ts, `useMutation` in mutation.ts,
  the current-window mutations): the shared root cause was
  `makeFrameworkScopedOperation.dispose()` being irreversible. Fixed by re-arming
  `disposed` on the next run (commit bfa6efaf81, renderer-stream.ts) — a StrictMode
  remount's next run revives the operation; a real unmount never reuses it.
- **endpoints.ts** `stableEndpointInputDependency` Map/Set/bigint/circular bug
  (commit 1da9a83bd7).
- **native.ts render loop** (`useTheme`/`usePower`/`useDisplays`/`useThemeMode`): the
  factory was called in the render body, producing a fresh Stream/Effect each render
  and (via useDesktopStream's setState(running())) an infinite re-render loop on mount
  — a production bug, not just StrictMode. Fixed by computing the factory result once
  via a `useState` initializer. NOTE: verified by typecheck/lint/inspection + the
  compute-once pattern matching endpoints.ts; a render-count regression test needs the
  DOM harness below.

## Still open — need a DOM/component test harness

These touch the most critical React file (provider) or depend on React commit timing,
so they should be fixed AND verified with a real harness, not shipped blind.

### 1. (HIGH) DesktopProvider / ReactDesktop.DesktopRoot dispose the runtime+registry and never rebuild

`provider.tsx:108-128` (and the identical pattern in `desktop.tsx:118-128`) create the
AtomRegistry + ManagedRuntime in `useMemo`, dispose them in a `useEffect` cleanup, and
never recreate. Under StrictMode the cleanup disposes them (AtomRegistry.dispose and
ManagedRuntime.disposeEffect are irreversible — in the effect library, not ours), then
the remount reuses the same disposed instances. Children's `useSyncExternalStore`
re-subscribe throws "registry is disposed"; effects die with "ManagedRuntime disposed".
The whole provider subtree is broken under the dev-default StrictMode.

Fix shape: hold baseContext in a ref, (re)build it in the disposal effect's setup body
when missing, and null the ref in cleanup so the remount rebuilds a fresh
runtime+registry. Derive the context value from the ref. Mirror in desktop.tsx.

### 2. (MEDIUM) usePermissionApproval.resolvePromise reads a stale snapshot.pending closure

`permission-approval.ts:128-158` keys the `resolvePromise` useCallback on
`[snapshot.pending]`, so a push-then-resolve in the same tick (before React commits the
push) finds nothing and returns `Exit.void` — a dropped resolution reported as success.
Fix: read pending through a ref (`pendingRef.current = snapshot.pending` each render),
look up via the ref, drop `[snapshot.pending]` from deps; or return a typed not-pending
signal instead of Exit.void.

### 3. (MEDIUM) useDesktopResource disposes the caller's resource during the StrictMode cycle

`hooks/desktop.ts:229-256` disposes the (caller-owned, non-re-acquirable) resource in the
effect cleanup; StrictMode's simulated unmount disposes it for real while the hook still
reports status "active". Fix: gate the actual dispose (not just the post-dispose setState)
to a real unmount, or make the hook own acquisition so the remount re-acquires.

## Lower confidence

- useDesktopStream chunk write is not generation-guarded and interrupt is fire-and-forget,
  so a superseded stream's in-flight emit can append after the new stream's running() reset
  (narrow window). Add an `active` flag gating setChunk/onExit in the effect.
- current-window status classification: an unavailable host surfaces "failure" vs
  "unavailable" depending on whether a currentWindow prop was passed (classification keyed
  on the error's `current` string).

## Recommendation: add a DOM test harness

The repo has no component-test harness (all React tests use renderToStaticMarkup, which
never runs effects), so none of the StrictMode/lifecycle bugs above can be caught by the
current suite. Add `@happy-dom/global-registrator` + `@testing-library/react` as
`@orika/react` devDeps and a bunfig `[test] preload` that registers the DOM globals, then
test the fixes by rendering under `<React.StrictMode>` and asserting no
"registry is disposed", hooks reach success (not stuck "running"), and native hooks
subscribe exactly once. IMPORTANT: generate the `bun.lock` update with the repo-pinned
Bun (1.3.13, per packageManager) so CI's `bun install --frozen-lockfile` accepts it.
