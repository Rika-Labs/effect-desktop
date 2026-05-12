---
name: effect
description: Ground, write, and review Effect Desktop TypeScript against Effect v4 beta and the local Effect submodule. Use for any effectful code, services, layers, schemas, streams, resources, retries, RPC, HTTP APIs, cluster, workflow, persistence, SQL, workers, AI, platform adapters, observability, tests, or public abstraction where Codex must use existing Effect primitives before creating Effect Desktop framework code.
---

# Effect

## Decision

Use Effect as the substrate. Effect Desktop should feel like an extension of the Effect framework, not a competing abstraction set.

Every effectful design must answer two questions before code is written:

1. Which Effect primitive already owns this concept?
2. What desktop-specific complexity remains after using that primitive?

If the answer to the second question is "nothing", do not add framework code. Use Effect directly, write documentation, or expose the primitive.

## Source Of Truth

Use this order when grounding:

1. `docs/SPEC.md` and repo `AGENTS.md` for Effect Desktop rules.
2. `vendor/effect/LLMS.md` for upstream Effect guidance.
3. `vendor/effect/ai-docs/src/**` for curated upstream examples.
4. `vendor/effect/packages/**` for exact beta implementation and exported names.
5. Context7 library `/effect-ts/effect` only when local source is insufficient or you need current official documentation outside the submodule.

Do not rely on memory for Effect beta APIs. Do not rely on `node_modules` for Effect API shape in this repo. The submodule is the grounded source.

## Repo Baseline

Follow `docs/SPEC.md` section 4.4.1:

- Import Effect symbols from `effect`; never import `@effect/schema`.
- Use `Effect.Effect<A, E, R>` in public type signatures. Include `R = never` when no services are required.
- Use `Effect.gen(function* () { ... yield* effect })`; never use the v3 `$` adapter form.
- Define schema classes with `class T extends Schema.Class<T>("T")({...}) {}`.
- Define services with `class X extends Effect.Service<X>()("X", { effect: Effect.gen(...) }) {}` when the service has a default layer.
- Use `Context.Tag(...)` for ad-hoc shapes.
- Compose layers with `Layer.provide`, `Layer.provideMerge`, `Layer.succeed`, and `Layer.effect`.
- Treat `Stream.Stream<A, E, R>` as a first-class runtime contract.

If upstream examples use a different service style, adapt to this repo baseline or propose a spec update. Do not silently switch local convention.

## Grounding Workflow

1. Identify the Effect domain: service, schema, resource, stream, RPC, HTTP API, cluster, workflow, persistence, SQL, workers, AI, CLI, observability, test, or platform adapter.
2. Search the submodule first:
   - `vendor/effect/LLMS.md`
   - `vendor/effect/ai-docs/src/<domain>`
   - `vendor/effect/packages/effect/src/unstable/<domain>`
   - `vendor/effect/packages/<runtime-or-integration>`
3. Read the exact source or example before implementing.
4. Check this repo for existing package conventions and spec requirements.
5. Only then design the Effect Desktop abstraction.

## Primitive Map

Use these before inventing framework code.

### Core Effects

- Use `Effect.gen` for local sequencing.
- Use `Effect.fn("name")` for reusable functions that return effects; it improves traces and stack evidence.
- Use `Effect.try`, `Effect.tryPromise`, callback constructors, or platform modules at imperative boundaries.
- Use `Effect.scoped`, `Scope`, and scoped layers when acquisition and release matter.
- Use `Effect.provide` for final program wiring; avoid hidden global runtime state.

### Services And Layers

- Use `Effect.Service` for service classes with default layers.
- Use `Context.Tag` for ad-hoc interfaces and externally supplied dependencies.
- Use `Layer.effect`, `Layer.succeed`, `Layer.provide`, `Layer.provideMerge`, and `Layer.mergeAll` for composition.
- Use `Layer.unwrap` when a layer depends on runtime config or an effectful decision.
- Use `LayerMap` for keyed dynamic resources such as tenant pools, window resources, app sessions, or per-project contexts.
- Use `ManagedRuntime` when non-Effect code must run Effect programs from framework hooks, handlers, or callbacks.

### Schemas And Typed Data

- Use `Schema.Class` for public boundary models.
- Use schema-tagged errors or `Data.TaggedError` for expected failures.
- Use `Schema.decodeUnknown(schema)(value)` at boundaries; reserve promise decoders for imperative edges.
- Use `Brand`, `Option`, `Result`, `DateTime`, `Duration`, `Chunk`, `HashMap`, and `HashSet` instead of ad-hoc encodings.
- Treat encoded shape, field presence, defaults, and error tags as compatibility surface.

### Failure And Recovery

- Keep expected failures in the error channel.
- Use tagged errors and `Effect.catchTag` / `Effect.catchTags` for recovery.
- Use `Cause` and `Exit` when preserving defect, interruption, and typed failure evidence matters.
- Do not convert defects into expected domain errors unless the boundary requires it and the conversion is logged or encoded.
- Errors crossing process, bridge, RPC, or persistence boundaries need schema-backed shape.

### Resources And Lifecycle

- Use `Scope`, `Effect.acquireRelease`, scoped layers, finalizers, `Resource`, `Pool`, `RcRef`, `RcMap`, `Cache`, and `ScopedCache`.
- Every handle, process, watcher, socket, window resource, connection, stream, subscription, and background fiber needs an owner.
- Acquisition must have a matching release path.
- Prefer layer-managed lifetimes for app services and scope-managed lifetimes for operation-local resources.

### State And Concurrency

- Use `Ref` for simple mutable state.
- Use `SynchronizedRef` when updates are effectful or require serialized mutation.
- Use `SubscriptionRef` for state with subscribers.
- Use `Deferred` and `Latch` for coordination.
- Use `Queue` for producer/consumer work.
- Use `PubSub` for fan-out events.
- Use `Semaphore` for concurrency limits.
- Use `Fiber`, `FiberSet`, and `FiberMap` for supervised background work.
- Do not use event emitters, mutable globals, or raw promise registries where these primitives fit.

### Streams

- Use `Stream` for finite or infinite pull-based sequences.
- Use `Stream.fromIterable`, `Stream.fromEffectSchedule`, `Stream.paginate`, `Stream.fromAsyncIterable`, `Stream.fromEventListener`, and `Stream.callback` before writing custom adapters.
- Use platform adapters such as `NodeStream` or Bun/browser stream modules when applicable.
- Preserve backpressure. Do not convert streams to arrays unless the data is known bounded.
- Use `Sink` and `Channel` for advanced transforms, codecs, and pipelines.
- Use `effect/unstable/encoding` modules such as `Ndjson`, `Msgpack`, and `Sse` for structured stream protocols.

### Scheduling, Retry, Polling, And Time

- Use `Schedule` for retry, repeat, polling, exponential backoff, jitter, caps, and recurrence.
- Use `Effect.retry` and `Effect.repeat`; do not write manual retry loops.
- Make idempotency explicit before retrying operations with side effects.
- Use `Duration` and `DateTime` types where precision and units matter.
- Use `TestClock` for tests. Do not test time with real sleeps unless the behavior is inherently live.

### HTTP, RPC, And Protocol Surfaces

- Use `effect/unstable/http` for HTTP client/server primitives.
- Use `effect/unstable/httpapi` for schema-first HTTP APIs, typed clients, middleware, security, tests, OpenAPI, Scalar, and Swagger.
- Use `effect/unstable/rpc` for schema-backed RPC definitions, clients, servers, middleware, serialization, and worker/RPC tests.
- Use `HttpApi` or `RpcGroup` as source-of-truth definitions when generating bridge surfaces.
- Use schema-derived clients instead of handwritten protocol clients when possible.
- Keep raw protocol evidence available for debugging, but do not make transport details the primary user model.

### Cluster

- Use `effect/unstable/cluster` for distributed stateful services:
  `Entity`, `EntityProxy`, `EntityProxyServer`, `ClusterSchema`, `ClusterWorkflowEngine`, `Sharding`, `Runner`, `Runners`, `RunnerStorage`, `MessageStorage`, `SqlMessageStorage`, `SqlRunnerStorage`, `TestRunner`, `SingleRunner`, `SocketRunner`, `HttpRunner`, `ClusterCron`, and cluster metrics/error modules.
- Use `Entity.make` with RPC definitions for stateful entities.
- Use entity `client` APIs for typed access.
- Use `ClusterSchema.Persisted` annotations when messages require persistence.
- Use `TestRunner.layer` for local tests and development without network communication.
- Use platform adapters such as `NodeClusterSocket`, `NodeClusterHttp`, `BunClusterSocket`, and `BunClusterHttp` only after reading their submodule source.
- Use cluster when you need addressable stateful entities, sharding, durable message storage, runner coordination, passivation, or distributed execution. Do not use it for ordinary local services.

### Workflow

- Use `effect/unstable/workflow` for durable workflows:
  `Workflow`, `Activity`, `WorkflowEngine`, `WorkflowProxy`, `WorkflowProxyServer`, `DurableClock`, and `DurableDeferred`.
- Use workflow when the process may restart, work is long-running, state must be recoverable, activities need durable boundaries, or timers/deferred coordination must survive process lifetime.
- Use ordinary `Effect`, `Schedule`, `Queue`, or `FiberSet` for local transient orchestration.
- Do not hand-roll durable orchestration with ad-hoc tables, timers, and polling before reading the workflow and eventlog/persistence modules.
- For desktop workflows, define what must survive app restart, OS sleep, crash, cancellation, and upgrade before choosing workflow.

### Persistence, Event Log, SQL, And Reactivity

- Use `effect/unstable/persistence` for key-value stores, persistable values, persisted cache, persisted queue, rate limiting, and Redis-backed persistence.
- Use `effect/unstable/eventlog` for event journals, remote event logs, sessions, encryption, and SQL-backed event log servers.
- Use `effect/unstable/sql` and the package adapters under `vendor/effect/packages/sql/**` for SQL clients, migrations, resolvers, schemas, streams, and statements.
- Use `effect/unstable/reactivity` and atom packages for reactive data, Atom HTTP/RPC integration, hydration, and UI bindings.
- Prefer these modules before adding custom cache, queue, journal, migration, query, or reactive state systems.

### Workers, Processes, Sockets, And Platform

- Use `effect/unstable/workers` for worker definitions, worker runners, worker errors, and transferable data.
- Use `effect/unstable/process` for child process spawning and process modeling.
- Use `effect/unstable/socket` for socket protocols.
- Use `@effect/platform-bun`, `@effect/platform-node`, and `@effect/platform-browser` adapters for runtime-specific services.
- In Effect Desktop, Rust owns host capability; TypeScript owns application semantics and Effect service composition.

### CLI

- Use `effect/unstable/cli` for commands, flags, arguments, prompts, completions, help output, and CLI errors.
- Do not hand-roll argument parsing in `packages/cli` unless a repo-specific constraint requires it.

### AI

- Use `effect/unstable/ai` for provider-agnostic language models, embeddings, prompts, responses, tools, toolkits, telemetry, chat, tokenizer, MCP schema/server, and response ID tracking.
- Use package providers under `vendor/effect/packages/ai/**` for Anthropic, OpenAI, OpenAI-compatible, and OpenRouter integrations.
- Use schemas for structured outputs and tools.
- Treat AI calls as effectful I/O: config, redaction, timeouts, retries, spans, metrics, and typed errors are required.

### Observability

- Use structured logs, log annotations, spans, metrics, and current span access.
- Use `@effect/opentelemetry` when integrating with OpenTelemetry SDKs.
- Use `effect/unstable/observability` OTLP modules for lightweight tracing, logs, metrics, resources, serialization, and Prometheus metrics where appropriate.
- Attach spans around bridge calls, host calls, retries, resource acquisition, permission checks, process work, cluster messages, workflow activities, and long-running operations.

### Testing

- Use `@effect/vitest` and `it.effect` for Effect tests.
- Use test layers for services.
- Use `TestClock` for time.
- Use `TestRunner.layer` for cluster code.
- Use `HttpApiTest` and `RpcTest` for protocol surfaces.
- Provide user-facing test layers when the public abstraction would otherwise require desktop host, network, database, or permission state.

## Effect Desktop Abstraction Rules

- Add an abstraction only when it hides desktop-specific complexity or stabilizes a policy over Effect primitives.
- Keep the underlying Effect primitive visible or reachable for advanced users.
- Public APIs should return `Effect.Effect<A, E, R>` unless they are explicit imperative boundary helpers.
- Promise APIs belong at framework integration edges, not in the core effectful package surface.
- Every bridge boundary must validate input and output with Schema.
- Every public failure mode must be typed, tagged, documented, and testable.
- Every resource-owning API must encode lifetime through scope, layer, stream, or explicit release.
- Every long-running API must define cancellation, interruption, retry, timeout, and observability behavior.
- Every package-level API should have one obvious start point and no shallow manager wrappers.

## Review Checklist

- Did we read the relevant submodule files?
- Is the API a real desktop extension of Effect, or a renamed Effect primitive?
- Which service/layer owns dependencies?
- Which schema owns boundary validation?
- Which typed errors are recoverable?
- Which scope owns cleanup?
- Which schedule owns retry/polling?
- Which stream/queue/pubsub primitive owns backpressure or fan-out?
- Which runtime/platform adapter owns host integration?
- Which test layer proves user code can run offline?
- Which spans/logs/metrics will explain this under incident pressure?

## References

Read [references/effect-capability-map.md](references/effect-capability-map.md) when planning or reviewing an Effect-heavy change.
