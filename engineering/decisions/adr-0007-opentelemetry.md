# ADR-0007: Adopt @effect/opentelemetry and delete bespoke Telemetry service (T06)

## Status

Accepted

## Context

`packages/core/src/runtime/telemetry.ts` rolls a custom span and metric model. Effect v4 ships `effect/unstable/observability` for abstractions and `@effect/opentelemetry` for concrete OTel exporters. Every RPC call, repository query, and workflow activity already produces spans through Effect's `Tracer` automatically; the bespoke service forces re-instrumentation at every call-site and re-derives cardinality, exporter, and shutdown semantics OTel has already settled.

Devtools panels currently consume bespoke event streams. Any external observability tool (Jaeger, Grafana, Honeycomb) cannot plug into the bespoke format. The bespoke service runs parallel to Effect's `Tracer` and `Metric`, which means the framework carries two telemetry stacks: one from the upstream Effect primitives and one from the bespoke service.

## Decision

Delete the bespoke Telemetry service. Wire `@effect/opentelemetry` exporters directly to Effect's `Tracer` and `Metric` at the runtime spine.

- Span data comes from Effect's `Tracer` — no manual `startSpan` calls needed at RPC, SQL, or workflow sites.
- Framework-specific cross-process metrics (RPC latency, window count, fiber count, queue depth) are defined as `Metric.histogram`, `Metric.gauge`, and `Metric.counter` values in core and flow through the same OTel pipeline.
- Devtools panels are rewritten to consume OTel data — either via an in-process OTel processor or the standard exporter output — instead of bespoke event streams (see also [ADR-0008](adr-0008-eventlog.md) and the devtools adoption plan).
- The OTel exporter is configured at the spine via `EFFECT_DESKTOP_TELEMETRY_ENDPOINT` or `desktop.config.ts` (T10 Logger/Config adoption).
- In dev mode the exporter defaults to a pretty logger sink; in production it targets the configured OTel endpoint.

Cross-links: [ADR-0002](adr-0002-rpc-effect-unstable-rpc.md) (RPC calls produce spans automatically), [ADR-0009](adr-0009-workflow.md) (workflow activities produce spans), [ADR-0011](adr-0011-logger-config-console.md) (Logger/Config/Console adoption where this ADR's sink is configured).

## Alternatives considered

**Keep bespoke**: carries two parallel telemetry stacks forever; no external tool can plug in; devtools must maintain bespoke format. Rejected.

**Use a third-party OTel SDK directly** (opentelemetry-js): loses the Effect `Tracer` integration — spans are not automatically correlated with fibers or interruption. Rejected.

**Emit metrics only, no spans**: loses call-graph tracing for RPC and SQL; debugging cross-process latency requires spans. Rejected.

## Consequences

**Positive**

- Spans are automatic — RPC, SQL, and workflow code requires no manual instrumentation.
- External observability tools plug into the standard OTel endpoint with no framework changes.
- Devtools and external tools see the same data via the same pipeline.

**Negative**

- `@effect/opentelemetry` has a dependency chain (opentelemetry-sdk-\*); adds bundle weight to the runtime.
- Devtools panel rewrites are required to consume OTel data streams rather than bespoke event streams.

**Neutral**

- Cross-process span propagation (renderer → host → runtime) uses the trace IDs already carried in the host protocol envelope (T01/T05). Propagation wiring is a separate follow-on ticket.

## Validation

An RPC call produces a span through Effect's `Tracer`; the span reaches the configured OTel exporter; a framework metric (RPC latency histogram) appears in the same pipeline. Devtools panels render data sourced from the OTel processor. `bun run typecheck` and `bun test` pass with `runtime/telemetry.ts` deleted.

## Migration notes

1. Delete `packages/core/src/runtime/telemetry.ts`.
2. Add `@effect/opentelemetry` to `packages/core`.
3. Wire `TracerProvider` and `MeterProvider` layers at the runtime spine.
4. Define framework metric values (`RpcLatency`, `WindowCount`, `FiberCount`, `QueueDepth`) in core.
5. Rewrite devtools panels to consume the OTel processor (coordinate with T07 EventLog devtools wiring).
