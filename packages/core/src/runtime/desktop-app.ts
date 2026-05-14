import { Config, Context, Data, Effect, Layer, Option, Schema, type Scope } from "effect"
import type * as FileSystemRuntime from "effect/FileSystem"
import type * as PathRuntime from "effect/Path"
import type * as StdioRuntime from "effect/Stdio"
import type * as TerminalRuntime from "effect/Terminal"
import {
  ClusterWorkflowEngine,
  RunnerHealth,
  Runners,
  Sharding,
  ShardingConfig,
  SqlMessageStorage,
  SqlRunnerStorage
} from "effect/unstable/cluster"
import { Rpc, RpcGroup, RpcServer } from "effect/unstable/rpc"
import type { ChildProcessSpawner as ChildProcessSpawnerRuntime } from "effect/unstable/process"
import { Reactivity } from "effect/unstable/reactivity"
import type { SqlClient } from "effect/unstable/sql/SqlClient"
import type { SqlError } from "effect/unstable/sql/SqlError"
import { WorkflowEngine } from "effect/unstable/workflow"

import { rpcCapability } from "@effect-desktop/bridge"

import { DesktopLoggerLayer } from "./logger.js"
import {
  NormalizedCapability as NormalizedCapabilitySchema,
  PermissionRegistry,
  capabilityCovers,
  makePermissionRegistry
} from "./permission-registry.js"
import { PermissionInterceptor, makePermissionInterceptorLayer } from "./permission-interceptor.js"
import type { NormalizedCapability } from "./permission-registry.js"
import {
  ProviderCapability,
  ProviderRegistryError,
  makeProviderRegistry,
  type Provider
} from "./provider-registry.js"
import { ResourceRegistryLive } from "./resources.js"
import {
  DesktopRpcRegistry,
  DesktopRpcRegistryLive,
  type DesktopRpcRegistration,
  type DesktopRpcRegistrationGroup
} from "./desktop-rpc-registry.js"
import {
  DesktopWindowRegistry,
  DesktopWindowRegistryLive,
  isSafeWindowId,
  type DesktopWindowRegistration
} from "./desktop-window-registry.js"
import { EffectTelemetryRuntimeLive, Telemetry, makeTelemetry } from "./telemetry.js"

export interface WindowSpec {
  readonly title: string
  readonly width?: number
  readonly height?: number
  readonly renderer?: string
}

export type DesktopRpcsLayer<E = never, RIn = never> = Layer.Layer<
  never,
  E,
  RIn | DesktopRpcRegistry
>

export type DesktopWindowsLayer<RIn = never> = Layer.Layer<
  never,
  never,
  RIn | DesktopWindowRegistry
>

export interface DesktopConfig<RIn = never, E = never> {
  readonly id: string
  readonly windows: DesktopWindowsLayer<RIn>
  readonly providers?: DesktopProviderSelection
  readonly rpcs?: DesktopRpcsLayer<E, RIn>
  readonly permissions?: ReadonlyArray<NormalizedCapability>
  readonly workflows?: ReadonlyArray<DesktopWorkflowLayer<RIn, E>>
}

export interface DesktopMakeConfig<RIn = never, E = never> {
  readonly id?: string
  readonly windows: DesktopWindowsLayer<RIn>
  readonly providers?: DesktopProviderSelection
  readonly rpcs?: DesktopRpcsLayer<E, RIn>
  readonly permissions?: ReadonlyArray<NormalizedCapability>
  readonly workflows?: ReadonlyArray<DesktopWorkflowLayer<RIn, E>>
}

export type DesktopWorkflowLayer<RIn = never, E = never> = Layer.Layer<
  never,
  E,
  RIn | WorkflowEngine.WorkflowEngine
>

export type DesktopWorkflowEngineLayer<RIn = never, E = never> = Layer.Layer<
  WorkflowEngine.WorkflowEngine,
  E,
  RIn
>

export interface DesktopAppDescriptor<RIn = never, E = never> extends DesktopConfig<RIn, E> {
  readonly _tag: "DesktopAppDescriptor"
  readonly rpcs: DesktopRpcsLayer<E, RIn>
  readonly windowRegistrations: ReadonlyArray<DesktopWindowRegistration>
  readonly permissions: ReadonlyArray<NormalizedCapability>
  readonly workflows: ReadonlyArray<DesktopWorkflowLayer<RIn, E>>
}

export interface DesktopRpcGroupDescriptor {
  readonly _tag: "DesktopRpcGroup"
  readonly group: DesktopRpcRegistrationGroup
}

export interface DesktopAppManifest {
  readonly _tag: "DesktopAppManifest"
  readonly id: string
  readonly windows: Readonly<Record<string, WindowSpec>>
  readonly rpcGroups: ReadonlyArray<DesktopRpcGroupDescriptor>
}

export type DesktopManifestSource<RIn = never, E = never> = Pick<
  DesktopConfig<RIn, E>,
  "id" | "windows" | "rpcs"
>

export type DesktopRuntimeProviderId = "bun" | "node" | "test" | (string & {})

export interface DesktopProviderSelection {
  readonly runtime?: DesktopRuntimeProviderId | undefined
}

export interface DesktopRuntimeSelectedProviders {
  readonly runtime: DesktopRuntimeProviderId
}

export class ProviderFact extends Schema.Class<ProviderFact>("ProviderFact")({
  id: Schema.String,
  kind: Schema.Literal("runtime"),
  capabilities: Schema.Array(Schema.String)
}) {}

export class LayerFailurePayload extends Schema.Class<LayerFailurePayload>("LayerFailurePayload")({
  appId: Schema.String,
  reason: Schema.Literals(["missing-provider", "missing-requirement"]),
  requirement: Schema.String,
  providerPath: Schema.Array(Schema.String),
  message: Schema.String,
  provider: Schema.optional(Schema.String)
}) {}

export class LayerGraphNodeSnapshot extends Schema.Class<LayerGraphNodeSnapshot>(
  "LayerGraphNodeSnapshot"
)({
  id: Schema.String,
  kind: Schema.Literals([
    "provider",
    "core-service",
    "rpc-layer",
    "workflow",
    "app-service",
    "runtime-service"
  ]),
  label: Schema.String,
  provides: Schema.Array(Schema.String),
  requires: Schema.Array(Schema.String)
}) {}

export class LayerGraphSnapshot extends Schema.Class<LayerGraphSnapshot>("LayerGraphSnapshot")({
  appId: Schema.String,
  providers: Schema.Struct({ runtime: Schema.String }),
  nodes: Schema.Array(LayerGraphNodeSnapshot),
  providerFacts: Schema.Array(ProviderFact),
  failures: Schema.Array(LayerFailurePayload)
}) {}

export type DesktopRuntimeGraphNodeKind =
  | "provider"
  | "core-service"
  | "rpc-layer"
  | "workflow"
  | "app-service"
  | "runtime-service"

export interface DesktopRuntimeGraphNode {
  readonly id: string
  readonly kind: DesktopRuntimeGraphNodeKind
  readonly label: string
  readonly provides: readonly string[]
  readonly requires: readonly string[]
}

export interface DesktopRuntimeGraph {
  readonly _tag: "DesktopRuntimeGraph"
  readonly appId: string
  readonly providers: DesktopRuntimeSelectedProviders
  readonly providerBudgets: readonly DesktopProviderBudget[]
  readonly nodes: readonly DesktopRuntimeGraphNode[]
  readonly providerFacts: readonly ProviderFact[]
  readonly failures: readonly LayerFailurePayload[]
}

export interface DesktopRuntimeApi {
  readonly appId: string
  readonly providers: DesktopRuntimeSelectedProviders
  readonly providerBudgets: readonly DesktopProviderBudget[]
  readonly graph: DesktopRuntimeGraph
}

export type DesktopRuntimeProviderServices =
  | FileSystemRuntime.FileSystem
  | PathRuntime.Path
  | TerminalRuntime.Terminal
  | StdioRuntime.Stdio
  | ChildProcessSpawnerRuntime.ChildProcessSpawner

export type DesktopRuntimeServices = DesktopApp | DesktopRuntime | DesktopRuntimeProviderServices

export interface DesktopProviderBudget {
  readonly id: DesktopRuntimeProviderId
  readonly kind: "runtime"
  readonly package: string
  readonly importPath: string
  readonly startupBudgetMs: number
  readonly bundleBudgetKb: number
}

export class DesktopConfigError extends Data.TaggedError("DesktopConfigError")<{
  readonly appId: string
  readonly reason:
    | "missing-permission"
    | "missing-provider"
    | "invalid-config"
    | "duplicate-rpc"
    | "duplicate-window-id"
  readonly message: string
  readonly contract?: string
  readonly method?: string
  readonly permission?: string
  readonly provider?: string
  readonly windowId?: string
}> {}

const NormalizedCapabilityKinds = new Set<NormalizedCapability["kind"]>([
  "filesystem.read",
  "filesystem.write",
  "filesystem.delete",
  "process.spawn",
  "pty.spawn",
  "network.connect",
  "secrets.read",
  "secrets.write",
  "safeStorage.read",
  "safeStorage.write",
  "native.invoke"
])

export interface DesktopAppApi {
  readonly appId: string
  readonly windows: Readonly<Record<string, WindowSpec>>
  readonly windowRegistrations: ReadonlyArray<DesktopWindowRegistration>
  readonly rpcRegistrations: ReadonlyArray<DesktopRpcRegistration<any, any>>
}

export class DesktopApp extends Context.Service<DesktopApp, DesktopAppApi>()("DesktopApp") {}

export class DesktopRuntime extends Context.Service<DesktopRuntime, DesktopRuntimeApi>()(
  "DesktopRuntime"
) {}

const TelemetryLive: Layer.Layer<Telemetry, never, never> = Layer.effect(Telemetry)(
  makeTelemetry().pipe(Effect.orDie)
)

export const WorkflowEngineMemory: DesktopWorkflowEngineLayer = WorkflowEngine.layerMemory

export const WorkflowEngineDurable: DesktopWorkflowEngineLayer<SqlClient, SqlError> =
  ClusterWorkflowEngine.layer.pipe(
    Layer.provideMerge(Sharding.layer),
    Layer.provide(Runners.layerNoop),
    Layer.provideMerge(SqlMessageStorage.layer),
    Layer.provide(SqlRunnerStorage.layer),
    Layer.provide(RunnerHealth.layerNoop),
    Layer.provide(ShardingConfig.layer())
  )

const coreServicesLayer: Layer.Layer<never, Config.ConfigError, never> = Layer.mergeAll(
  ResourceRegistryLive,
  Layer.provideMerge(EffectTelemetryRuntimeLive, TelemetryLive),
  Reactivity.layer,
  DesktopLoggerLayer,
  WorkflowEngineMemory
)

const CoreServiceGraphNodes = Object.freeze([
  graphNode("core:resources", "core-service", "ResourceRegistry", ["ResourceRegistry"], []),
  graphNode("core:telemetry", "core-service", "Telemetry", ["Telemetry"], []),
  graphNode("core:permissions", "core-service", "PermissionRegistry", ["PermissionRegistry"], []),
  graphNode("core:reactivity", "core-service", "Reactivity", ["Reactivity"], []),
  graphNode("core:logger", "core-service", "DesktopLogger", ["DesktopLogger"], []),
  graphNode("core:workflow", "core-service", "WorkflowEngine", ["WorkflowEngine"], [])
])

const RuntimeProviderServiceNames = Object.freeze([
  "FileSystem",
  "Path",
  "Terminal",
  "Stdio",
  "ChildProcessSpawner"
])

const RuntimeProviderCapabilities = Object.freeze(
  RuntimeProviderServiceNames.map(
    (name) =>
      new ProviderCapability({
        name,
        description: `Provides Effect ${name} service for desktop runtime programs`
      })
  )
)

interface RuntimeProviderDescriptor extends Provider<"runtime", DesktopRuntimeProviderId> {
  readonly id: DesktopRuntimeProviderId
  readonly node: DesktopRuntimeGraphNode
  readonly budget: DesktopProviderBudget
  readonly layer: Effect.Effect<
    Layer.Layer<DesktopRuntimeProviderServices, Config.ConfigError, never>,
    never,
    never
  >
}

const RuntimeProviders = [
  Object.freeze({
    kind: "runtime" as const,
    id: "bun" as const,
    capabilities: RuntimeProviderCapabilities,
    budget: providerBudget("bun", "@effect/platform-bun", "@effect-desktop/core/providers/bun"),
    layer: Effect.promise(() =>
      import("../providers/bun.js").then((module) => module.BunRuntimeProviderLayer)
    ),
    node: graphNode(
      "provider:runtime:bun",
      "provider",
      "Bun runtime provider",
      RuntimeProviderServiceNames,
      []
    )
  }),
  Object.freeze({
    kind: "runtime" as const,
    id: "node" as const,
    capabilities: RuntimeProviderCapabilities,
    budget: providerBudget("node", "@effect/platform-node", "@effect-desktop/core/providers/node"),
    layer: Effect.promise(() =>
      import("../providers/node.js").then((module) => module.NodeRuntimeProviderLayer)
    ),
    node: graphNode(
      "provider:runtime:node",
      "provider",
      "Node runtime provider",
      RuntimeProviderServiceNames,
      []
    )
  }),
  Object.freeze({
    kind: "runtime" as const,
    id: "test" as const,
    capabilities: RuntimeProviderCapabilities,
    budget: providerBudget("test", "@effect-desktop/core", "@effect-desktop/core/providers/test"),
    layer: Effect.promise(() =>
      import("../providers/test.js").then((module) => module.TestRuntimeProviderLayer)
    ),
    node: graphNode(
      "provider:runtime:test",
      "provider",
      "Test runtime provider",
      RuntimeProviderServiceNames,
      []
    )
  })
] as const satisfies readonly RuntimeProviderDescriptor[]

const RuntimeProviderRegistry = makeProviderRegistry(RuntimeProviders)

export const make = <RIn = never, E = never>(
  config: DesktopMakeConfig<RIn, E>
): DesktopAppDescriptor<RIn, E> => {
  const windowRegistrations = snapshotWindowRegistrationsSync(config.windows)
  failOnDuplicateWindowIds(config.id ?? "app", windowRegistrations)
  return Object.freeze({
    _tag: "DesktopAppDescriptor" as const,
    id: config.id ?? "app",
    windows: config.windows,
    windowRegistrations,
    rpcs: (config.rpcs ?? (Layer.empty as DesktopRpcsLayer<E, RIn>)) as DesktopRpcsLayer<E, RIn>,
    permissions: freezeArray(config.permissions),
    workflows: freezeArray(config.workflows),
    ...(config.providers === undefined ? {} : { providers: freezeObject(config.providers) })
  })
}

export const manifest = <RIn = never, E = never>(
  config: DesktopManifestSource<RIn, E>
): DesktopAppManifest => {
  const registrations = snapshotRegistrationsSync(config.rpcs)
  const windowRegistrations = snapshotWindowRegistrationsSync(config.windows)
  return Object.freeze({
    _tag: "DesktopAppManifest" as const,
    id: config.id,
    windows: projectWindowRecord(windowRegistrations),
    rpcGroups: Object.freeze(
      registrations.map((registration) =>
        Object.freeze({
          _tag: "DesktopRpcGroup" as const,
          group: registration.group
        })
      )
    )
  })
}

/**
 * Registers an RPC group + handler layer with the surrounding `DesktopRpcRegistry`.
 * Compose multiple registrations with `Layer.mergeAll(...)` and pass the result
 * as `rpcs:` to `Desktop.make`.
 *
 * The resulting layer's environment is `DesktopRpcRegistry` only — the handler's
 * own service requirements (`R`) are stored as data in the registration and
 * re-applied at `bindRegistration` time inside the runtime spine. The R
 * requirement is therefore not propagated through this layer's type.
 *
 * **Sync-only constraint.** The body of this layer is `Effect.sync` (it only
 * calls `registry.register(...)`). `Desktop.manifest(...)` runs the user's
 * `rpcs` layer synchronously (`Effect.runSync` inside `snapshotRegistrationsSync`)
 * to extract registrations without making the manifest API async. Any layer
 * composed into `rpcs` that requires async work to BUILD (e.g. `Layer.scoped`
 * around an `Effect.promise`) will crash `manifest()` with `DesktopRpcRegistryAsyncBuildError`.
 *
 * Compose async work INSIDE the handler bodies, not in the layer construction:
 *
 * ```ts
 * // OK — async work inside handler:
 * Desktop.rpc(NotesRpcs, NotesRpcs.toLayer({
 *   "Notes.list": () => Effect.tryPromise(() => fetchNotes())
 * }))
 *
 * // CRASH — async layer construction:
 * Desktop.rpc(NotesRpcs, NotesRpcs.toLayer(
 *   Effect.tryPromise(() => loadHandlerSetup())
 * ))
 * ```
 */
export const rpc = <Rpcs extends Rpc.Any, E, R>(
  group: RpcGroup.RpcGroup<Rpcs>,
  handlers: Layer.Layer<Rpc.ToHandler<Rpcs>, E, R>
): Layer.Layer<never, never, DesktopRpcRegistry> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const registry = yield* DesktopRpcRegistry
      yield* registry.register({ group, handlers })
    })
  )

/**
 * Registers a window with the surrounding `DesktopWindowRegistry`.
 * Compose multiple windows with `Layer.mergeAll(...)` and pass the result
 * as `windows:` to `Desktop.make`.
 *
 * The optional `services` Layer is built INSIDE the per-window scope at open
 * time, so any resource it acquires (a `Settings` store, a watcher, a stream
 * subscription) is released when the OS window closes. This is the framework's
 * typed answer to today's `ownerScope: "window-main"` string handshake — the
 * window's scope is owned by the framework, not stringly bound by the renderer.
 *
 * The services layer's `R` requirement (e.g. `Settings`) is type-erased into
 * the registry and re-applied at open time inside the runtime spine — same
 * pattern as `Desktop.rpc`'s handler layer.
 *
 * **Reserved ids.** `__proto__`, `constructor`, `prototype`, and the empty
 * string are rejected synchronously at construction (a `TypeError` from the
 * call site, not a deferred boot failure).
 */
export const desktopWindow = <RIn = never>(
  id: string,
  spec: WindowSpec,
  services?: Layer.Layer<never, never, RIn | Scope.Scope>
): Layer.Layer<never, never, RIn | DesktopWindowRegistry> => {
  if (!isSafeWindowId(id)) {
    throw new TypeError(
      `Desktop.window: window id ${JSON.stringify(id)} is reserved (cannot be empty, "__proto__", "constructor", or "prototype")`
    )
  }
  return Layer.effectDiscard(
    Effect.gen(function* () {
      const registry = yield* DesktopWindowRegistry
      yield* registry.register({
        id,
        spec,
        // Type-erased — RIn is satisfied by the surrounding runtime context
        // when openDeclaredWindows builds this layer inside the per-window scope.
        services: services as Layer.Layer<never, any, any> | undefined
      })
    })
  )
}

/**
 * Thrown by `Desktop.manifest(...)` when the user's `rpcs` layer requires
 * asynchronous work to build. The framework runs `rpcs` synchronously to
 * extract the registry snapshot; async layer construction is the one user
 * mistake the registry-extraction path cannot recover from.
 */
export class DesktopRpcRegistryAsyncBuildError extends Data.TaggedError(
  "DesktopRpcRegistryAsyncBuildError"
)<{
  readonly message: string
  readonly cause: unknown
}> {}

/**
 * Thrown by `Desktop.make(...)` / `Desktop.manifest(...)` when the user's
 * `windows` layer requires asynchronous work to build. Mirrors
 * `DesktopRpcRegistryAsyncBuildError`. The fix is to compose async work
 * inside the per-window `services` layer, not in the `Desktop.window`
 * registration itself.
 */
export class DesktopWindowRegistryAsyncBuildError extends Data.TaggedError(
  "DesktopWindowRegistryAsyncBuildError"
)<{
  readonly message: string
  readonly cause: unknown
}> {}

const snapshotWindowRegistrationsSync = <RIn>(
  windows: DesktopWindowsLayer<RIn>
): ReadonlyArray<DesktopWindowRegistration> => {
  // Cast invariant: every Desktop.window(...) layer body is Effect.sync that
  // only calls registry.register(...). Composing with DesktopWindowRegistryLive
  // (also Effect.sync) makes the entire build sync. The user's RIn type
  // parameter is erased here because it describes what the per-window services
  // layer needs at OPEN time (Phase 2), not what registration needs.
  const composed = Layer.provideMerge(
    windows as unknown as Layer.Layer<never, never, DesktopWindowRegistry>,
    DesktopWindowRegistryLive
  )
  try {
    return Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(composed)
          const registry = Context.get(context, DesktopWindowRegistry)
          return yield* registry.snapshot
        })
      )
    )
  } catch (cause) {
    throw new DesktopWindowRegistryAsyncBuildError({
      message:
        "Desktop.make(...) / Desktop.manifest(...) requires the windows layer to build " +
        "synchronously. A layer composed into Desktop.make({ windows }) requires async work " +
        "to construct (e.g. Layer.scoped(Effect.promise(...))) — move async work inside each " +
        "window's `services` layer (which is built inside the per-window scope at open time) " +
        "instead. See `Desktop.window` for the sync-only constraint on registration.",
      cause
    })
  }
}

const projectWindowRecord = (
  registrations: ReadonlyArray<DesktopWindowRegistration>
): Readonly<Record<string, WindowSpec>> =>
  Object.freeze(
    Object.fromEntries(
      registrations.map((registration) => [
        registration.id,
        Object.freeze({ ...registration.spec })
      ])
    )
  )

const findDuplicateWindowId = (
  registrations: ReadonlyArray<DesktopWindowRegistration>
): string | undefined => {
  const seen = new Set<string>()
  for (const { id } of registrations) {
    if (seen.has(id)) return id
    seen.add(id)
  }
  return undefined
}

const duplicateWindowError = (appId: string, id: string): DesktopConfigError =>
  new DesktopConfigError({
    appId,
    reason: "duplicate-window-id",
    message: `Window id ${JSON.stringify(id)} is registered more than once. Each Desktop.window(id, ...) call must use a distinct id.`,
    windowId: id
  })

const failOnDuplicateWindowIds = (
  appId: string,
  registrations: ReadonlyArray<DesktopWindowRegistration>
): void => {
  const dup = findDuplicateWindowId(registrations)
  if (dup !== undefined) throw duplicateWindowError(appId, dup)
}

const checkWindowRegistrations = (
  appId: string,
  registrations: ReadonlyArray<DesktopWindowRegistration>
): Effect.Effect<void, DesktopConfigError, never> => {
  const dup = findDuplicateWindowId(registrations)
  return dup === undefined ? Effect.void : Effect.fail(duplicateWindowError(appId, dup))
}

/**
 * Builds the user's `rpcs` layer against an isolated `DesktopRpcRegistry` and
 * returns the resulting registrations. The user's layer is built only for its
 * registration side effect; handler bodies are not invoked here.
 */
const buildRegistrations = <RIn, E>(
  rpcs: DesktopConfig<RIn, E>["rpcs"]
): Effect.Effect<ReadonlyArray<DesktopRpcRegistration<any, any>>, never, never> =>
  Effect.sync(() => snapshotRegistrationsSync(rpcs))

/**
 * Synchronous registry snapshot. The `Desktop.rpc(...)` constructor produces a
 * layer whose only side effect is calling `registry.register(...)` via
 * `Effect.sync`. Composed with `DesktopRpcRegistryLive` (also sync) the whole
 * build runs without async work, so `Effect.runSync` is safe and lets
 * `Desktop.manifest(...)` stay synchronous for renderer adapters.
 */
const snapshotRegistrationsSync = <RIn, E>(
  rpcs: DesktopConfig<RIn, E>["rpcs"]
): ReadonlyArray<DesktopRpcRegistration<any, any>> => {
  if (rpcs === undefined) return []
  // Cast invariant: every Desktop.rpc(...) layer body is Effect.sync that only
  // calls registry.register(...). Composing with DesktopRpcRegistryLive (also
  // Effect.sync) makes the entire build sync. The user's RIn/E type parameters
  // are erased here because they describe handler-execution requirements, not
  // registration-time requirements; handler R is reapplied per-registration in
  // bindRegistration. The DesktopRpcRegistryAsyncBuildError catch below
  // converts the runtime crash into a typed framework error if the invariant
  // is ever violated.
  const composed = Layer.provideMerge(
    rpcs as unknown as Layer.Layer<never, never, DesktopRpcRegistry>,
    DesktopRpcRegistryLive
  )
  try {
    return Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(composed)
          const registry = Context.get(context, DesktopRpcRegistry)
          return yield* registry.snapshot
        })
      )
    )
  } catch (cause) {
    throw new DesktopRpcRegistryAsyncBuildError({
      message:
        "Desktop.manifest(...) requires the rpcs layer to build synchronously. " +
        "A layer composed into Desktop.make({ rpcs }) requires async work to construct " +
        "(e.g. Layer.scoped(Effect.promise(...))) — move async work inside handler bodies " +
        "(e.g. Effect.tryPromise inside RpcGroup.toLayer({ ... })) instead. " +
        "See `Desktop.rpc` for the sync-only constraint.",
      cause
    })
  }
}

export const app = <RIn = never, E = never>(
  config: DesktopConfig<RIn, E>
): Layer.Layer<
  DesktopApp,
  DesktopConfigError | E,
  Exclude<RIn, DesktopRuntimeProviderServices | DesktopRpcRegistry | DesktopWindowRegistry>
> =>
  runtime(config) as Layer.Layer<
    DesktopApp,
    DesktopConfigError | E,
    Exclude<RIn, DesktopRuntimeProviderServices | DesktopRpcRegistry | DesktopWindowRegistry>
  >

export const runtime = <RIn = never, E = never>(
  config: DesktopConfig<RIn, E>
): Layer.Layer<
  DesktopRuntimeServices,
  DesktopConfigError | E,
  Exclude<RIn, DesktopRuntimeProviderServices | DesktopRpcRegistry | DesktopWindowRegistry>
> =>
  buildSpine(config) as Layer.Layer<
    DesktopRuntimeServices,
    DesktopConfigError | E,
    Exclude<RIn, DesktopRuntimeProviderServices | DesktopRpcRegistry | DesktopWindowRegistry>
  >

export const DesktopRuntimeLive = runtime

export const runtimeGraph = <RIn, E>(
  config: DesktopConfig<RIn, E>
): Effect.Effect<DesktopRuntimeGraph, DesktopConfigError, never> =>
  Effect.gen(function* () {
    const provider = yield* resolveRuntimeProvider(config)
    const registrations = yield* buildRegistrations(config.rpcs)
    return makeRuntimeGraph(config, provider, registrations)
  })

export const runtimeGraphSnapshot = <RIn, E>(
  config: DesktopConfig<RIn, E>
): Effect.Effect<LayerGraphSnapshot, never, never> =>
  Effect.match(runtimeGraph(config), {
    onFailure: (error) =>
      new LayerGraphSnapshot({
        appId: config.id,
        providers: selectedProviders(config.providers),
        nodes: [],
        providerFacts: [],
        failures: [layerFailureFromConfigError(config.id, error)]
      }),
    onSuccess: layerGraphSnapshotFromGraph
  })

export const layerGraphSnapshotFromGraph = (graph: DesktopRuntimeGraph): LayerGraphSnapshot =>
  new LayerGraphSnapshot({
    appId: graph.appId,
    providers: graph.providers,
    nodes: graph.nodes.map(
      (node) =>
        new LayerGraphNodeSnapshot({
          id: node.id,
          kind: node.kind,
          label: node.label,
          provides: [...node.provides],
          requires: [...node.requires]
        })
    ),
    providerFacts: graph.providerFacts.map(
      (fact) =>
        new ProviderFact({
          id: fact.id,
          kind: fact.kind,
          capabilities: [...fact.capabilities]
        })
    ),
    failures: graph.failures.map(
      (failure) =>
        new LayerFailurePayload({
          appId: failure.appId,
          reason: failure.reason,
          requirement: failure.requirement,
          providerPath: [...failure.providerPath],
          message: failure.message,
          ...(failure.provider === undefined ? {} : { provider: failure.provider })
        })
    )
  })

const makeRuntimeGraph = <RIn, E>(
  config: DesktopConfig<RIn, E>,
  provider: RuntimeProviderDescriptor,
  registrations: ReadonlyArray<DesktopRpcRegistration<any, any>>
): DesktopRuntimeGraph => {
  const selected = Object.freeze({
    runtime: provider.id
  } satisfies DesktopRuntimeSelectedProviders)
  const nodes: DesktopRuntimeGraphNode[] = [
    provider.node,
    ...CoreServiceGraphNodes,
    ...registrations.map((registration, index) =>
      graphNode(
        `rpc-layer:${index}`,
        "rpc-layer",
        `RPC layer ${Array.from(registration.group.requests.keys()).join(", ")}`,
        Array.from(registration.group.requests.keys()),
        ["RpcServer.Protocol"]
      )
    ),
    ...(config.workflows ?? []).map((_, index) =>
      graphNode(
        `workflow:${index}`,
        "workflow",
        `Workflow layer ${index + 1}`,
        [],
        ["WorkflowEngine"]
      )
    ),
    graphNode("service:DesktopApp", "app-service", "DesktopApp", ["DesktopApp"], []),
    graphNode("service:DesktopRuntime", "runtime-service", "DesktopRuntime", ["DesktopRuntime"], [])
  ]

  return Object.freeze({
    _tag: "DesktopRuntimeGraph" as const,
    appId: config.id,
    providers: selected,
    providerBudgets: Object.freeze([provider.budget]),
    nodes: Object.freeze(nodes),
    providerFacts: Object.freeze([
      new ProviderFact({
        id: provider.id,
        kind: "runtime",
        capabilities: [...RuntimeProviderServiceNames]
      })
    ]),
    failures: Object.freeze([])
  })
}

export const launch = (
  layer: Layer.Layer<DesktopApp, DesktopConfigError, never>
): Effect.Effect<never, DesktopConfigError, never> => Layer.launch(layer)

const checkPermissions = <RIn, E>(
  config: DesktopConfig<RIn, E>,
  registrations: ReadonlyArray<DesktopRpcRegistration<any, any>>
): Effect.Effect<void, DesktopConfigError, never> => {
  const declared = config.permissions ?? []
  const seenRpcTags = new Set<string>()

  for (const registration of registrations) {
    for (const [tag, rpc] of registration.group.requests.entries()) {
      if (seenRpcTags.has(tag)) {
        return Effect.fail(
          new DesktopConfigError({
            appId: config.id,
            reason: "duplicate-rpc",
            message: `RPC method "${tag}" is provided more than once`,
            method: tag
          })
        )
      }
      seenRpcTags.add(tag)

      const required = rpcCapability(rpc)
      if (Option.isNone(required) || required.value.kind === "none") {
        continue
      }

      const requiredCapability = decodeRpcCapability(required.value, config.id, tag)
      if (Effect.isEffect(requiredCapability)) {
        return requiredCapability
      }

      const covered = declared.some((cap) => capabilityCovers(cap, requiredCapability))
      if (!covered) {
        return Effect.fail(
          new DesktopConfigError({
            appId: config.id,
            reason: "missing-permission",
            message: `RPC method "${tag}" requires capability "${requiredCapability.kind}" but it is not declared in config.permissions`,
            method: tag,
            permission: requiredCapability.kind
          })
        )
      }
    }
  }

  return Effect.void
}

const decodeRpcCapability = (
  value: Readonly<{ readonly kind: string }>,
  appId: string,
  method: string
): NormalizedCapability | Effect.Effect<never, DesktopConfigError, never> => {
  const decoded = Schema.decodeUnknownOption(NormalizedCapabilitySchema)(value)
  if (Option.isSome(decoded)) {
    return decoded.value
  }
  if (NormalizedCapabilityKinds.has(value.kind as NormalizedCapability["kind"])) {
    return Effect.fail(
      new DesktopConfigError({
        appId,
        reason: "invalid-config",
        message: `RPC method "${method}" declares capability "${value.kind}" without the required scoped capability fields`,
        method,
        permission: value.kind
      })
    )
  }
  return Effect.fail(
    new DesktopConfigError({
      appId,
      reason: "missing-permission",
      message: `RPC method "${method}" requires unknown capability "${value.kind}" and it cannot be matched against config.permissions`,
      method,
      permission: value.kind
    })
  )
}

const buildSpine = <RIn, E>(
  config: DesktopConfig<RIn, E>
): Layer.Layer<
  DesktopRuntimeServices,
  E | DesktopConfigError,
  Exclude<RIn, DesktopRuntimeProviderServices>
> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const provider = yield* resolveRuntimeProvider(config)
      const registrations = yield* buildRegistrations(config.rpcs)
      const windowRegistrations = snapshotWindowRegistrationsSync(config.windows)
      yield* checkWindowRegistrations(config.id, windowRegistrations)
      yield* checkPermissions(config, registrations)
      const graph = makeRuntimeGraph(config, provider, registrations)
      const workflowLayers = config.workflows ?? []
      const rpcLayers = registrations.map((registration) => bindRegistration(registration))

      const workflowLayer = mergeLayerArray(workflowLayers)
      const rpcLayer = mergeLayerArray(rpcLayers)
      const runtimeBase = Layer.mergeAll(
        providerLayerFor({ runtime: provider.id }),
        coreServicesLayer,
        makePermissionServicesLayer(config)
      ) as Layer.Layer<DesktopRuntimeProviderServices, Config.ConfigError, never>

      const desktopAppLayer: Layer.Layer<DesktopApp, never, never> = Layer.effect(DesktopApp)(
        Effect.succeed({
          appId: config.id,
          windows: projectWindowRecord(windowRegistrations),
          windowRegistrations,
          rpcRegistrations: registrations
        })
      )

      const desktopRuntimeLayer: Layer.Layer<DesktopRuntime, never, never> = Layer.succeed(
        DesktopRuntime
      )(
        Object.freeze({
          appId: config.id,
          providers: graph.providers,
          providerBudgets: graph.providerBudgets,
          graph
        } satisfies DesktopRuntimeApi)
      )

      const dependentLayer = Layer.mergeAll(
        workflowLayer,
        rpcLayer,
        desktopAppLayer,
        desktopRuntimeLayer
      ) as Layer.Layer<DesktopApp | DesktopRuntime, E, RIn | DesktopRuntimeProviderServices>

      return Layer.provideMerge(dependentLayer, runtimeBase) as Layer.Layer<
        DesktopRuntimeServices,
        E | DesktopConfigError,
        Exclude<RIn, DesktopRuntimeProviderServices>
      >
    })
  )

const resolveRuntimeProvider = <RIn, E>(
  config: DesktopConfig<RIn, E>
): Effect.Effect<RuntimeProviderDescriptor, DesktopConfigError, never> => {
  const provider = selectedProviders(config.providers).runtime
  return RuntimeProviderRegistry.pipe(
    Effect.flatMap((registry) => registry.get("runtime", provider)),
    Effect.mapError((error) => providerRegistryErrorToConfigError(config.id, error))
  )
}

export const providerLayerFor = (
  choice: DesktopRuntimeSelectedProviders
): Layer.Layer<DesktopRuntimeProviderServices, Config.ConfigError | DesktopConfigError, never> =>
  Layer.unwrap(
    RuntimeProviderRegistry.pipe(
      Effect.flatMap((registry) => registry.get("runtime", choice.runtime)),
      Effect.mapError((error) => providerRegistryErrorToConfigError("provider-loader", error)),
      Effect.flatMap((provider) => provider.layer)
    )
  )

const providerRegistryErrorToConfigError = (
  appId: string,
  error: ProviderRegistryError
): DesktopConfigError =>
  new DesktopConfigError({
    appId,
    reason: error.reason === "missing-provider" ? "missing-provider" : "invalid-config",
    message: error.message,
    provider: error.provider
  })

const makePermissionServicesLayer = <RIn, E>(
  config: DesktopConfig<RIn, E>
): Layer.Layer<PermissionRegistry | PermissionInterceptor, never, never> => {
  const registryLayer = Layer.effect(
    PermissionRegistry,
    Effect.gen(function* () {
      const registry = yield* makePermissionRegistry()
      yield* Effect.forEach(
        config.permissions ?? [],
        (capability) =>
          registry
            .declare(capability, {
              source: `Desktop.app:${config.id}`,
              effect: "allow"
            })
            .pipe(Effect.orDie),
        { discard: true }
      )
      return registry
    })
  )

  return Layer.provideMerge(makePermissionInterceptorLayer(), registryLayer)
}

const selectedProviders = (
  selection: DesktopProviderSelection | undefined
): DesktopRuntimeSelectedProviders =>
  Object.freeze({
    runtime: selection?.runtime ?? "bun"
  })

const layerFailureFromConfigError = (
  appId: string,
  error: DesktopConfigError
): LayerFailurePayload =>
  new LayerFailurePayload({
    appId,
    reason: error.reason === "missing-provider" ? "missing-provider" : "missing-requirement",
    requirement:
      error.reason === "missing-provider"
        ? "DesktopRuntimeProviderServices"
        : (error.permission ?? error.method ?? error.contract ?? "DesktopRuntime"),
    providerPath: error.provider === undefined ? [] : [`provider:runtime:${error.provider}`],
    message: error.message,
    ...(error.provider === undefined ? {} : { provider: error.provider })
  })

const mergeLayerArray = <E, R>(
  layers: ReadonlyArray<Layer.Layer<never, E, R>>
): Layer.Layer<never, E, R> =>
  layers.reduce<Layer.Layer<never, E, R>>(
    (acc, layer) => Layer.merge(acc, layer),
    Layer.empty as Layer.Layer<never, E, R>
  )

const bindRegistration = (
  registration: DesktopRpcRegistration<any, any>
): Layer.Layer<never, unknown, unknown> =>
  Layer.provide(
    RpcServer.layer(
      // Cast invariant: DesktopRpcRegistration.group widens its Rpc-union to
      // RpcGroup.Any so the registry can hold heterogeneous groups together.
      // RpcServer.layer accepts any RpcGroup; widening to Rpc.Any here keeps
      // its type parameter satisfiable without losing runtime behavior.
      (registration.group as RpcGroup.RpcGroup<Rpc.Any>).middleware(PermissionInterceptor)
    ),
    // Cast invariant: handlers' Rpc.ToHandler<Rpcs> output context is widened
    // to `any` so it satisfies whatever RpcServer.layer needs from its Rpcs
    // type parameter. The handler layer's R requirement is preserved as
    // Layer.provide's environment requirement and bubbles up through the spine.
    registration.handlers as Layer.Layer<unknown, unknown, unknown>
    // Cast invariant: Layer.provide of an unknown-typed handler returns
    // Layer<never, unknown, unknown>; we restate it here so the binder's
    // return type is callable without forcing every caller to thread the
    // specific Rpc union — bindRegistration is the type-erasure boundary.
  ) as Layer.Layer<never, unknown, unknown>

const freezeArray = <A>(values: ReadonlyArray<A> | undefined): ReadonlyArray<A> =>
  Object.freeze([...(values ?? [])])

const freezeObject = <A extends object>(value: A): A => Object.freeze({ ...value }) as A

function graphNode(
  id: string,
  kind: DesktopRuntimeGraphNodeKind,
  label: string,
  provides: readonly string[],
  requires: readonly string[]
): DesktopRuntimeGraphNode {
  return Object.freeze({
    id,
    kind,
    label,
    provides: Object.freeze([...provides]),
    requires: Object.freeze([...requires])
  })
}

function providerBudget(
  id: DesktopRuntimeProviderId,
  packageName: string,
  importPath: string
): DesktopProviderBudget {
  return Object.freeze({
    id,
    kind: "runtime" as const,
    package: packageName,
    importPath,
    startupBudgetMs: 25,
    bundleBudgetKb: 64
  })
}
