# ADR-0013: Wire effect/unstable/reactivity and migrate switch statements to Match (T15)

## Status

Accepted

## Context

The framework has no live-query layer. Renderer pages hand-roll discriminated-union state machines (`idle | loading | success | failure`) and trigger manual refetch after each mutation. A mutation in window A has no mechanism to invalidate a live query in window B without explicit pub/sub wiring at each call-site.

`effect/unstable/reactivity` ships:

- `Reactivity.invalidate(keys)` — declare that one or more keys have changed.
- `Reactivity.mutation(effect, keys)` — run an effect and automatically invalidate keys afterward.
- `Reactivity.stream(effect, keys)` — re-emit when any of the named keys are invalidated.

Combined with `EventLog.groupReactivity` from T07 ([ADR-0008](adr-0008-eventlog.md)), repository mutations automatically invalidate matching live queries, solving cross-window reactive UI structurally — one `EventLog.publish` cascades to all subscribed windows.

Separately, framework code is full of `switch (state._tag)` exhaustive matches. `effect/Match` provides `Match.value(state).pipe(Match.tag("Loading", ...), ...)` — first-class pattern matching that integrates with Effect's type system.

T15 lands after T02 (SQL repos) and T07 (EventLog) are in place because it needs to observe what those layers write.

## Decision

Add a `Reactivity` layer to the runtime spine. Migrate switch-statement pattern matching to `effect/Match`.

**Reactivity wiring:**

- `Reactivity` is provided at the spine level; it is available to all RPC handlers and repo mutation handlers.
- Repo mutation handlers (T02 outputs) wrap writes in `Reactivity.mutation([...keys])`.
- Query Effects are exposed via `Reactivity.stream(effect, keys)` for renderer consumption.
- EventLog `groupReactivity` configuration maps audit event tags to reactivity keys; `EventLog.publish` triggers invalidation automatically.
- The renderer consumes `Reactivity.stream` outputs via `useRpcQuery` atoms ([ADR-0014](adr-0014-atom-react.md)).

**Match migration:**

- A codemod-style migration replaces every `switch (state._tag)` in framework code and templates with `Match.value(state).pipe(Match.tag("Loading", ...), ...)`.
- The migration is scoped to framework code and templates; application code is not touched.

Cross-links: [ADR-0008](adr-0008-eventlog.md) (groupReactivity connects to the EventLog bus), [ADR-0014](adr-0014-atom-react.md) (renderer atoms consume Reactivity.stream outputs).

## Alternatives considered

**Manual refetch after mutation**: requires explicit wiring at every mutation call-site; cross-window cases require additional pub/sub infrastructure. Rejected.

**WebSockets for cross-window state**: adds a second transport; crosses process boundaries unnecessarily for same-host windows. Rejected.

**Keep switch statements**: `effect/Match` adds no behavior but eliminates exhaustiveness blind spots that compilers miss in complex unions. The codemod is low-risk and bounded. Adopted.

## Consequences

**Positive**

- Cross-window reactive invalidation is structural — one `EventLog.publish` or `Reactivity.mutation` write propagates to all subscribed windows without explicit fan-out code.
- `Match.tag` exhaustiveness is checked by the type system; a missing branch is a compile error.

**Negative**

- `effect/unstable/reactivity` is beta; key invalidation semantics may shift.
- The Match codemod is mechanical but touches many files; review is required to avoid false positives.

**Neutral**

- T15 is the last Track B item to land in Layer 0; it must wait on T02 and T07. The ordering is enforced by the layer dependency.

## Validation

A `Reactivity` layer is present in the spine; every repo mutation handler announces invalidation keys via `Reactivity.mutation`; a mutation in window A causes a live query in window B to re-emit, observed end-to-end. No `switch (state._tag)` remains in framework or templates; `bun run typecheck` passes across renderer, bridge, and runtime packages.

## Migration notes

1. Add `effect/unstable/reactivity` to `packages/core`.
2. Provide `Reactivity` at the spine (after T02 and T07 land).
3. Wrap all repo mutation handlers with `Reactivity.mutation([...keys])`.
4. Expose all live queries as `Reactivity.stream(effect, keys)`.
5. Configure EventLog `groupReactivity` mapping.
6. Run switch-statement codemod across framework code and templates.
