# Effect Capability Map

This reference exists so agents stop guessing. For every unfamiliar Effect API, search and read the local submodule before coding.

## Grounding Commands

Use these from the repo root:

```bash
rg -n "ThingName" vendor/effect/LLMS.md vendor/effect/ai-docs/src vendor/effect/packages
find vendor/effect/packages/effect/src/unstable -maxdepth 3 -type f | sort
find vendor/effect/packages -mindepth 1 -maxdepth 3 -name package.json -print | sort
```

Use Context7 `/effect-ts/effect` only when the local submodule lacks the needed docs or when you need official current docs beyond this checkout.

## High-Value Local Files

- Root guidance: `vendor/effect/LLMS.md`
- Basics: `vendor/effect/ai-docs/src/01_effect/01_basics/*.ts`
- Services/layers: `vendor/effect/ai-docs/src/01_effect/02_services/*.ts`
- Errors: `vendor/effect/ai-docs/src/01_effect/03_errors/*.ts`
- Resources/scopes: `vendor/effect/ai-docs/src/01_effect/04_resources/*.ts`
- Running programs: `vendor/effect/ai-docs/src/01_effect/05_running/*.ts`
- PubSub: `vendor/effect/ai-docs/src/01_effect/06_pubsub/*.ts`
- Streams: `vendor/effect/ai-docs/src/02_stream/*.ts`
- ManagedRuntime: `vendor/effect/ai-docs/src/03_integration/10_managed-runtime.ts`
- Request batching: `vendor/effect/ai-docs/src/05_batching/10_request-resolver.ts`
- Schedules: `vendor/effect/ai-docs/src/06_schedule/10_schedules.ts`
- Observability: `vendor/effect/ai-docs/src/08_observability/*.ts`
- Testing: `vendor/effect/ai-docs/src/09_testing/*.ts`
- HttpClient: `vendor/effect/ai-docs/src/50_http-client/10_basics.ts`
- HttpApi: `vendor/effect/ai-docs/src/51_http-server/10_basics.ts`
- Child processes: `vendor/effect/ai-docs/src/60_child-process/10_working-with-child-processes.ts`
- CLI: `vendor/effect/ai-docs/src/70_cli/10_basics.ts`
- AI: `vendor/effect/ai-docs/src/71_ai/*.ts`
- Cluster: `vendor/effect/ai-docs/src/80_cluster/10_entities.ts`

## Core Package Areas

- `vendor/effect/packages/effect/src`: core runtime and standard library.
- `vendor/effect/packages/effect/src/unstable`: unstable modules for higher-level framework surfaces.
- `vendor/effect/packages/platform-bun/src`: Bun runtime services.
- `vendor/effect/packages/platform-node/src`: Node runtime services, HTTP, workers, cluster adapters.
- `vendor/effect/packages/platform-node-shared/src`: shared Node platform primitives.
- `vendor/effect/packages/platform-browser/src`: browser services, workers, IndexedDB, HTTP.
- `vendor/effect/packages/opentelemetry/src`: OpenTelemetry integration.
- `vendor/effect/packages/vitest/src`: Effect-aware Vitest integration.

## Installed Upstream Package Families

- `ai/anthropic`, `ai/openai`, `ai/openai-compat`, `ai/openrouter`
- `atom/react`, `atom/solid`, `atom/vue`
- `effect`
- `opentelemetry`
- `platform-browser`, `platform-bun`, `platform-node`, `platform-node-shared`
- `sql/clickhouse`, `sql/d1`, `sql/libsql`, `sql/mssql`, `sql/mysql2`, `sql/pg`, `sql/pglite`, `sql/sqlite-bun`, `sql/sqlite-do`, `sql/sqlite-node`, `sql/sqlite-react-native`, `sql/sqlite-wasm`
- `tools/ai-codegen`, `tools/ai-docgen`, `tools/bundle`, `tools/openapi-generator`, `tools/oxc`, `tools/utils`
- `vitest`

## Unstable Module Index

Read these before using or wrapping the corresponding domain:

- AI: `vendor/effect/packages/effect/src/unstable/ai`
- CLI: `vendor/effect/packages/effect/src/unstable/cli`
- Cluster: `vendor/effect/packages/effect/src/unstable/cluster`
- Devtools: `vendor/effect/packages/effect/src/unstable/devtools`
- Encoding: `vendor/effect/packages/effect/src/unstable/encoding`
- Event log: `vendor/effect/packages/effect/src/unstable/eventlog`
- HTTP: `vendor/effect/packages/effect/src/unstable/http`
- HTTP API: `vendor/effect/packages/effect/src/unstable/httpapi`
- Observability: `vendor/effect/packages/effect/src/unstable/observability`
- Persistence: `vendor/effect/packages/effect/src/unstable/persistence`
- Process: `vendor/effect/packages/effect/src/unstable/process`
- Reactivity: `vendor/effect/packages/effect/src/unstable/reactivity`
- RPC: `vendor/effect/packages/effect/src/unstable/rpc`
- Schema model helpers: `vendor/effect/packages/effect/src/unstable/schema`
- Socket: `vendor/effect/packages/effect/src/unstable/socket`
- SQL: `vendor/effect/packages/effect/src/unstable/sql`
- Workers: `vendor/effect/packages/effect/src/unstable/workers`
- Workflow: `vendor/effect/packages/effect/src/unstable/workflow`

## Cluster Notes

Cluster source includes:

- `Entity`, `EntityProxy`, `EntityProxyServer`, `EntityResource`, `EntityType`
- `ClusterSchema`, `ClusterError`, `ClusterMetrics`, `ClusterCron`
- `Sharding`, `ShardingConfig`, `ShardId`, `ShardingRegistrationEvent`
- `Runner`, `Runners`, `RunnerServer`, `RunnerHealth`, `RunnerStorage`
- `Message`, `MessageStorage`, `SqlMessageStorage`, `SqlRunnerStorage`
- `SocketRunner`, `HttpRunner`, `SingleRunner`, `TestRunner`
- `MachineId`, `Snowflake`, `Envelope`, `Reply`, address/id modules
- Platform adapters: `NodeClusterSocket`, `NodeClusterHttp`, `BunClusterSocket`, `BunClusterHttp`

Use cluster for addressable stateful entities, sharding, persistence of messages, runner coordination, passivation, or distributed execution. Use `TestRunner.layer` for local tests.

## Workflow Notes

Workflow source includes:

- `Activity`
- `Workflow`
- `WorkflowEngine`
- `WorkflowProxy`
- `WorkflowProxyServer`
- `DurableClock`
- `DurableDeferred`

Use workflow when work must survive process restart, crash, app relaunch, OS sleep, or durable timers. Use ordinary Effect services, fibers, queues, and schedules for local transient orchestration.

## Common Design Questions

1. Is this just a renamed Effect primitive?
   Export or document the primitive instead.

2. Is this desktop-specific policy over an Effect primitive?
   Put the policy in one deep module and keep the primitive reachable.

3. Is this a resource?
   Use `Scope`, `Effect.acquireRelease`, scoped layers, `Resource`, `Pool`, `RcRef`, `RcMap`, or `LayerMap`.

4. Is this a stream or event feed?
   Use `Stream`, `PubSub`, `Queue`, `SubscriptionRef`, `Channel`, or platform stream adapters.

5. Is this retry, polling, or timeout behavior?
   Use `Schedule`, `Effect.retry`, `Effect.repeat`, `Duration`, and explicit idempotency policy.

6. Is this cross-boundary data?
   Use `Schema.Class` or tagged schema errors at the boundary.

7. Is this long-lived application wiring?
   Use layers, `Layer.launch`, runtime entrypoints, or `ManagedRuntime`.

8. Is this distributed state or durable orchestration?
   Check cluster, workflow, persistence, eventlog, and SQL before inventing storage/timer/runner code.

9. Is this test setup?
   Provide test layers, `@effect/vitest`, `TestClock`, `HttpApiTest`, `RpcTest`, and `TestRunner.layer`.

## Review Failure Modes

- Custom event emitter where `Stream` or `PubSub` would preserve cancellation and backpressure.
- Singleton runtime where a layer or `ManagedRuntime` would make dependencies explicit.
- Promise-returning API in an effectful package where `Effect.Effect<A, E, R>` should be public.
- Stringly-typed errors where tagged errors or schema errors should drive recovery.
- Manual retry loops where `Schedule` should encode policy.
- Host resource acquired without a `Scope` or finalizer.
- Tests using sleeps instead of `TestClock`.
- Bridge payloads decoded with casts instead of schemas.
- Durable orchestration implemented with ad-hoc SQL rows instead of workflow/eventlog/persistence primitives.
- Distributed state implemented with local maps where cluster entities are the intended model.
