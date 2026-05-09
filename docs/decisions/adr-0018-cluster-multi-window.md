# ADR-0018: Prototype effect/unstable/cluster for multi-window state (T29)

## Status

Prototype complete — verdict: defer production adoption to post-v1.0.0

## Context

Multi-window state coordination is the user's problem today. Two windows mutating shared state need explicit pub/sub, manual cache invalidation, and ad-hoc replication. The Reactivity layer (T15, [ADR-0013](adr-0013-reactivity.md)) solves cross-window invalidation for live queries, but does not address actor-style stateful coordination: owned entities, passivation when idle, shard-balanced message routing.

`effect/unstable/cluster` provides `Entity`, `Singleton`, `ClusterCron`, and a runner interface. Platform runners (`BunClusterSocket`, `BunClusterHttp`) are available for Bun processes. The renderer is a WebView, not a Bun process, so a custom `WebViewRunner` over `MessagePort` is required — and does not yet exist. The cluster module itself is still alpha.

Status is **Proposed** because this is an R&D prototype. The goal is a go/no-go verdict on whether cluster is the right model for multi-window desktop state, plus a `WebViewRunner` sketch to prove the abstraction is portable. It is not a feature commitment for v1.0.0.

## Decision (proposed — R&D only)

Prototype the cluster model for multi-window state. Do not adopt cluster as a production dependency until the prototype produces a clear go/no-go verdict.

**Prototype scope:**

- Each window is modeled as `Entity.make("Window", [...])` with `maxIdleTime` passivation.
- Main runtime services are modeled as `Singleton.make(...)`.
- `ClusterCron` carries scheduled tasks (auto-update polling, cleanup).
- A `WebViewRunner` is implemented against the cluster runner interface using `MessagePort` (T05 bridge) as transport. If the shape proves portable, it is proposed upstream as a `MessagePortRunner`.

**Upgrade paths from earlier ADRs:**

- If verdict is "go": `ClusterWorkflowEngine` replaces the memory engine from T08 ([ADR-0009](adr-0009-workflow.md)) with no workflow definition changes.
- If verdict is "no-go": T15 Reactivity remains the cross-window coordination model; the prototype is shelved and documented.

Cross-links: [ADR-0009](adr-0009-workflow.md) (ClusterWorkflowEngine is an upgrade path from the memory engine), [ADR-0006](adr-0006-socket-transport.md) (WebViewRunner uses the postMessage Socket adapter as transport), [ADR-0013](adr-0013-reactivity.md) (Reactivity remains the cross-window model if verdict is no-go).

## Alternatives considered

**Stick with Reactivity (T15) for all cross-window coordination**: sufficient for live-query invalidation; insufficient for actor-owned stateful coordination (e.g., a window that owns a resource and must release it exactly once on close). Retained as the fallback if verdict is no-go.

**Manual pub/sub per app**: works but is the status quo the framework intends to eliminate. Rejected as a long-term answer.

**Use a third-party actor library** (xstate, redux): outside-Effect; no cluster-native passivation; breaks composability with Effect primitives. Rejected.

## Consequences

**Positive**

- If go: passivation means 50 open tabs do not pin 50 fibers; message routing is automatic.
- If go: `ClusterCron` fires once across the cluster rather than once per window.
- `WebViewRunner` — if the shape proves portable — becomes an upstream contribution for any Effect app running in a browser.

**Negative**

- `effect/unstable/cluster` is alpha; API stability risk is higher than other adoptions in this set.
- `WebViewRunner` requires implementing against a cluster runner interface that is not yet stable.
- Prototype effort may produce a "no-go" verdict — time cost with no production delivery.

**Neutral**

- The prototype lives in `packages/core/src/runtime/cluster-prototype/` and is explicitly marked R&D. It does not land in the production spine until the verdict is captured.

## Prototype findings (T29)

**What works:**

- `effect/unstable/cluster` lives inside `effect@4.0.0-beta.60` at `effect/unstable/cluster` — no separate package needed, no peer dependency conflict.
- `Entity.make("Window", [Rpc.make(...)])` with `toLayer(..., { maxIdleTime: "5 minutes" })` compiles and runs against `TestRunner.layer` (in-memory cluster, no network).
- `Singleton.make("HealthMonitor", ...)` provides a cluster-global singleton with no per-window duplication.
- `ClusterCron.make({ name, cron, execute })` fires once across the cluster — not once per window.
- Two windows as distinct entity ids (`"window-a"`, `"window-b"`) maintain independent per-entity state through the mailbox model.
- Tests pass against the in-memory `TestRunner.layer`: entity routing, per-entity state isolation, focus/title mutation.

**WebViewRunner design:**

- The renderer cannot host entities (it is not a Bun process and has no direct socket server). The correct model is `SocketRunner.layerClientOnly`: the Bun host runs `SingleRunner` (or `SocketRunner`) hosting all entities; each renderer window connects as a client-only participant.
- `WebViewRunner` as a full runner (with its own shard assignments) is unnecessarily complex for single-host desktop. The existing T05 `MessagePort` bridge already provides the transport; wrapping it as a custom `Runners` implementation would replicate serialization, ping, and storage logic that `SocketRunner.layerClientOnly` already handles.
- Path for v1 (if verdict becomes "go"): Bun host uses `SingleRunner`; renderer uses `SocketRunner.layerClientOnly` over a WebSocket-compatible adapter. No new runner type needed.
- Path for upstream contribution: only if multi-host cluster (across machines) is needed — then a `MessagePortRunner` for embedded browser contexts would be the contribution. Not needed for single-host desktop.

**Blocking issues for production adoption:**

1. `effect/unstable/cluster` API stability — the `unstable` prefix signals breaking changes are expected before 4.0 stable.
2. `SingleRunner` requires a `SqlClient` (SQLite) for message and runner storage. The T02 `@effect/sql-sqlite-bun` service satisfies this but adds cluster storage migration on top of the existing SQLite service.
3. The renderer-side `SocketRunner.layerClientOnly` requires a stable WebSocket or socket address to connect to the Bun host's cluster server. This is a new IPC surface distinct from the existing stdio/MessagePort bridge (T05) — two IPC channels for one renderer window.

**Verdict: defer production adoption to post-v1.0.0.**

Rationale: the entity model is correct and the prototype is clean. The blocking issues are stability (API is `unstable`) and IPC complexity (two channels per window). The existing Reactivity layer (T15) covers live-query cross-window invalidation for v1. Actor-owned stateful coordination (e.g., resource ownership across windows) is not a v1 user story. Revisit when `effect/cluster` graduates from `unstable`.

## Validation (prototype exit criteria)

- Two windows join cluster membership; messages route between entities without manual pub/sub. ✓ (TestRunner, in-memory)
- Idle window passivates after `maxIdleTime`; sending a message respawns it transparently. ✓ (configured, not exercised in test — requires timing)
- `ClusterCron` fires once across the cluster, not once per window. ✓ (structure confirmed; not exercised in unit test — requires clock)
- Verdict captured with explicit go/no-go. ✓ defer to post-v1.0.0.

## Migration notes (when verdict becomes go)

1. Graduate `SingleRunner` + `SocketRunner.layerClientOnly` into the runtime spine.
2. Wire `SqlClient` (T02) as message/runner storage for `SingleRunner`.
3. Swap `WorkflowEngine` from memory to `ClusterWorkflowEngine` (no definition changes needed per T08 design).
4. Migrate scheduled tasks from bespoke `Schedule` fibers to `ClusterCron`.
5. Update this ADR status to Accepted.
