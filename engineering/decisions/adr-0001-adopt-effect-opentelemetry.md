# ADR-0001: Adopt @effect/opentelemetry for the framework telemetry pipeline

## Status

Accepted

## Context

`packages/core/src/runtime/telemetry.ts` implemented a hand-rolled span accumulator, counter, histogram, and ring-buffer store. Effect v4 ships `Metric.*` as first-class observability primitives, and `@effect/opentelemetry` provides production OTel exporters that bridge Effect's `Tracer` and `Metric` to the standard OpenTelemetry wire format. Carrying the bespoke service forces every call-site to re-derive span and metric semantics that OTel has already standardised, and makes integration with any external observability backend (Datadog, Prometheus, Jaeger) require custom adapters.

## Decision

Add `@effect/opentelemetry@4.0.0-beta.60` (the version matching `effect@4.0.0-beta.60`) to `packages/core`. Provide two new modules:

- `runtime/framework-metrics.ts` — canonical `Metric.histogram` / `Metric.gauge` / `Metric.counter` / `Metric.frequency` definitions for RPC latency, active windows, active fibers, queue depth, and cache hit rate. These emit through Effect's Metric system and are automatically bridged to OTel by `@effect/opentelemetry`.
- `runtime/telemetry-otel.ts` — `makeOtelLayer`, a factory that returns a `Layer.Layer<Resource.Resource>` by composing `NodeSdk.layer` from `@effect/opentelemetry`. Hosts provide their own `SpanExporter` and `MetricReader`; the layer wires them into Effect's `Tracer` and registers the metric producer, all with proper shutdown.

The existing `runtime/telemetry.ts` (in-process ring buffer consumed by devtools panels) is retained until the full devtools rebuild in T24 replaces it with a pure OTel-backed data source.

## Alternatives considered

- **Delete `telemetry.ts` immediately**: The devtools panels (`diagnostics-panels.ts`, `performance-overlay.ts`) and their 627-line test file are structurally coupled to the bespoke service. Deleting it in this ticket would require a full devtools rewrite scoped to T24.
- **Use `WebSdk.layer` instead of `NodeSdk.layer`**: `NodeSdk.layer` requires `@opentelemetry/sdk-trace-node` which works in Bun's Node-compatible runtime. `WebSdk.layer` targets browser contexts. The runtime host is Node/Bun, so `NodeSdk` is correct.
- **Provide a `ConsoleSpanExporter` default**: Keeping the exporter optional and caller-supplied makes the layer environment-agnostic. Defaulting to console would produce output noise in test environments.

## Consequences

- OTel peer deps added to `packages/core`: `@effect/opentelemetry`, `@opentelemetry/api`, `@opentelemetry/resources`, `@opentelemetry/sdk-logs`, `@opentelemetry/sdk-metrics`, `@opentelemetry/sdk-trace-base`, `@opentelemetry/sdk-trace-node`, `@opentelemetry/sdk-trace-web`. Total 8 packages.
- Framework metrics use Effect's `Metric.*` API and are visible to any OTel-compatible backend without custom adapters.
- The host runtime configures the exporter. The framework provides the metric definitions and the wiring layer; it does not own the backend.
- `runtime/telemetry.ts` deletion is deferred to T24.

## Validation

`bun run check && bun run typecheck && bun run lint && bun run format:check && bun test` all pass clean after this change. The 742 test suite covers the existing telemetry behaviour; no regressions.

## Migration notes

Hosts that want OTel export compose `makeOtelLayer({ serviceName, spanExporter, metricReader })` into their runtime `Layer`. Hosts that only need the devtools panels keep `Layer.succeed(Telemetry)(telemetry)` unchanged until T24.
