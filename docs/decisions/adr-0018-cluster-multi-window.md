# ADR-0018: Prototype effect/unstable/cluster for multi-window state (T29)

## Status

Proposed

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

## Validation (prototype exit criteria)

- Two windows join cluster membership; messages route between entities without manual pub/sub.
- Idle window passivates after `maxIdleTime`; sending a message respawns it transparently.
- `ClusterCron` fires once across the cluster, not once per window.
- Verdict captured in `docs/runs/` with explicit go/no-go and the runner upstreaming decision.

## Migration notes (if verdict is go)

1. Graduate `WebViewRunner` from prototype to production and propose upstream.
2. Add cluster membership to the runtime spine.
3. Swap `WorkflowEngine` from memory to `ClusterWorkflowEngine` (no definition changes needed per T08 design).
4. Migrate scheduled tasks from bespoke `Schedule` fibers to `ClusterCron`.
5. Update this ADR status to Accepted.
