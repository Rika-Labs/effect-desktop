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
  type Provider as RegistryProvider,
  type ProviderKind
} from "./provider-registry.js"
import { ResourceRegistryLive } from "./resources.js"
import {
  DesktopRpcRegistry,
  DesktopRpcRegistryLive,
  type AnyDesktopRpcRegistration,
  type DesktopRpcRegistrationGroup
} from "./desktop-rpc-registry.js"
import {
  DesktopNativeRegistry,
  DesktopNativeRegistryLive,
  type AnyDesktopNativeRegistration
} from "./desktop-native-registry.js"
import {
  DesktopPermissionRegistry,
  DesktopPermissionRegistryLive
} from "./desktop-permission-registry.js"
import {
  DesktopWorkflowRegistry,
  DesktopWorkflowRegistryLive,
  type AnyDesktopWorkflowRegistration,
  type DesktopWorkflowRegistration
} from "./desktop-workflow-registry.js"
import {
  DesktopWindowRegistry,
  DesktopWindowRegistryLive,
  isSafeWindowId,
  type DesktopWindowRegistration
} from "./desktop-window-registry.js"
import { ResourceOwner, makeAppResourceOwner } from "./resource-owner.js"
import type { ResourceOwnerInvalidArgumentError } from "./resource-owner.js"
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

export type DesktopPermissionsLayer<RIn = never> = Layer.Layer<
  never,
  never,
  RIn | DesktopPermissionRegistry
>

export type DesktopProvidersLayer<RIn = never> = Layer.Layer<
  never,
  never,
  RIn | DesktopProviderRegistry
>

export type DesktopNativeLayer = Layer.Layer<never, never, DesktopNativeRegistry>

export type DesktopWorkflowsLayer<RIn = never, E = never> = Layer.Layer<
  never,
  E,
  RIn | DesktopWorkflowRegistry
>

export interface DesktopConfig<RIn = never, E = never> {
  readonly id: string
  readonly windows: DesktopWindowsLayer<RIn>
  readonly providers?: DesktopProvidersLayer<RIn>
  readonly native?: DesktopNativeLayer
  readonly rpcs?: DesktopRpcsLayer<E, RIn>
  readonly permissions?: DesktopPermissionsLayer<RIn>
  readonly workflows?: DesktopWorkflowsLayer<RIn, E>
}

export interface DesktopMakeConfig<RIn = never, E = never> {
  readonly id?: string
  readonly windows: DesktopWindowsLayer<RIn>
  readonly providers?: DesktopProvidersLayer<RIn>
  readonly native?: DesktopNativeLayer
  readonly rpcs?: DesktopRpcsLayer<E, RIn>
  readonly permissions?: DesktopPermissionsLayer<RIn>
  readonly workflows?: DesktopWorkflowsLayer<RIn, E>
}

export type DesktopWorkflowLayer<RIn = never, E = never> = DesktopWorkflowRegistration<E, RIn>

export type DesktopWorkflowEngineLayer<RIn = never, E = never> = Layer.Layer<
  WorkflowEngine.WorkflowEngine,
  E,
  RIn
>

export interface DesktopAppDescriptor<RIn = never, E = never> extends DesktopConfig<RIn, E> {
  readonly _tag: "DesktopAppDescriptor"
  readonly native: DesktopNativeLayer
  readonly rpcs: DesktopRpcsLayer<E, RIn>
  readonly permissions: DesktopPermissionsLayer<RIn>
  readonly workflows: DesktopWorkflowsLayer<RIn, E>
  readonly windowRegistrations: ReadonlyArray<DesktopWindowRegistration>
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
  "id" | "windows" | "native" | "rpcs"
>

export type DesktopRuntimeProviderId = "bun" | "node" | "test" | (string & {})
export type DesktopWebViewProviderId = "system" | "chrome" | (string & {})
export type DesktopWebViewHostEngine = "system" | "chrome" | (string & {})

export interface DesktopRuntimeSelectedProviders {
  readonly runtime: DesktopRuntimeProviderId
  readonly webview: DesktopWebViewProviderId
}

export class ProviderFact extends Schema.Class<ProviderFact>("ProviderFact")({
  id: Schema.String,
  kind: Schema.Literals(["runtime", "webview"]),
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
    "native-surface",
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
  providers: Schema.Struct({ runtime: Schema.String, webview: Schema.String }),
  nodes: Schema.Array(LayerGraphNodeSnapshot),
  providerFacts: Schema.Array(ProviderFact),
  failures: Schema.Array(LayerFailurePayload)
}) {}

export type DesktopRuntimeGraphNodeKind =
  | "provider"
  | "core-service"
  | "native-surface"
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

interface SelectedProviderDescriptors {
  readonly runtime: DesktopRuntimeProviderDescriptor
  readonly webview: DesktopWebViewProviderDescriptor
}

export type DesktopRuntimeProviderServices =
  | FileSystemRuntime.FileSystem
  | PathRuntime.Path
  | TerminalRuntime.Terminal
  | StdioRuntime.Stdio
  | ChildProcessSpawnerRuntime.ChildProcessSpawner

export type DesktopRuntimeServices =
  | DesktopApp
  | DesktopRuntime
  | DesktopRuntimeProviderServices
  | ResourceOwner

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
  readonly providerKind?: ProviderKind
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
  readonly rpcRegistrations: ReadonlyArray<AnyDesktopRpcRegistration>
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

const WebViewProviderCapabilities = Object.freeze(["WindowWebView", "AppProtocol"])

const RuntimeProviderCapabilities = Object.freeze(
  RuntimeProviderServiceNames.map(
    (name) =>
      new ProviderCapability({
        name,
        description: `Provides Effect ${name} service for desktop runtime programs`
      })
  )
)

export interface DesktopRuntimeProviderDescriptor extends RegistryProvider<
  "runtime",
  DesktopRuntimeProviderId
> {
  readonly id: DesktopRuntimeProviderId
  readonly node: DesktopRuntimeGraphNode
  readonly budget: DesktopProviderBudget
  readonly layer: Effect.Effect<
    Layer.Layer<DesktopRuntimeProviderServices, Config.ConfigError, never>,
    never,
    never
  >
}

export interface DesktopRuntimeProviderOptions {
  readonly id: DesktopRuntimeProviderId
  readonly layer: Layer.Layer<DesktopRuntimeProviderServices, Config.ConfigError, never>
  readonly budget: DesktopProviderBudget
  readonly capabilities?: readonly ProviderCapability[]
  readonly node?: DesktopRuntimeGraphNode
}

export interface DesktopWebViewProviderDescriptor extends RegistryProvider<
  "webview",
  DesktopWebViewProviderId
> {
  readonly id: DesktopWebViewProviderId
  readonly hostEngine: DesktopWebViewHostEngine
  readonly node: DesktopRuntimeGraphNode
}

export interface DesktopWebViewProviderOptions {
  readonly id: DesktopWebViewProviderId
  readonly hostEngine: DesktopWebViewHostEngine
  readonly capabilities: readonly (ProviderCapability | string)[]
  readonly node?: DesktopRuntimeGraphNode
}

export type DesktopProviderDescriptor =
  | DesktopRuntimeProviderDescriptor
  | DesktopWebViewProviderDescriptor

interface DesktopProviderRegistryApi {
  readonly register: (descriptor: DesktopProviderDescriptor) => Effect.Effect<void>
  readonly snapshot: Effect.Effect<ReadonlyArray<DesktopProviderDescriptor>>
}

export class DesktopProviderRegistry extends Context.Service<
  DesktopProviderRegistry,
  DesktopProviderRegistryApi
>()("@effect-desktop/core/DesktopProviderRegistry") {}

const makeDesktopProviderRegistry = (): DesktopProviderRegistryApi => {
  const entries: DesktopProviderDescriptor[] = []
  return {
    register: (descriptor) =>
      Effect.sync(() => {
        entries.push(descriptor)
      }),
    snapshot: Effect.sync(() => Object.freeze([...entries]))
  }
}

const DesktopProviderRegistryLive: Layer.Layer<DesktopProviderRegistry> = Layer.effect(
  DesktopProviderRegistry,
  Effect.sync(makeDesktopProviderRegistry)
)

const runtimeProvider = (
  options: DesktopRuntimeProviderOptions
): DesktopRuntimeProviderDescriptor =>
  Object.freeze({
    kind: "runtime" as const,
    id: options.id,
    capabilities: Object.freeze([...(options.capabilities ?? RuntimeProviderCapabilities)]),
    budget: Object.freeze({ ...options.budget }),
    layer: Effect.succeed(options.layer),
    node:
      options.node ??
      graphNode(
        `provider:runtime:${options.id}`,
        "provider",
        `${providerLabel(options.id)} runtime provider`,
        RuntimeProviderServiceNames,
        []
      )
  })

const lazyRuntimeProvider = (options: {
  readonly id: DesktopRuntimeProviderId
  readonly budget: DesktopProviderBudget
  readonly layer: Effect.Effect<
    Layer.Layer<DesktopRuntimeProviderServices, Config.ConfigError, never>,
    never,
    never
  >
  readonly label: string
}): DesktopRuntimeProviderDescriptor =>
  Object.freeze({
    kind: "runtime" as const,
    id: options.id,
    capabilities: RuntimeProviderCapabilities,
    budget: options.budget,
    layer: options.layer,
    node: graphNode(
      `provider:runtime:${options.id}`,
      "provider",
      options.label,
      RuntimeProviderServiceNames,
      []
    )
  })

const webviewProvider = (
  options: DesktopWebViewProviderOptions
): DesktopWebViewProviderDescriptor => {
  const capabilities = options.capabilities.map((capability) =>
    typeof capability === "string"
      ? new ProviderCapability({
          name: capability,
          description: `Provides ${capability} through the ${options.id} WebView provider`
        })
      : capability
  )
  return Object.freeze({
    kind: "webview" as const,
    id: options.id,
    hostEngine: options.hostEngine,
    capabilities: Object.freeze(capabilities),
    node:
      options.node ??
      graphNode(
        `provider:webview:${options.id}`,
        "provider",
        `${providerLabel(options.id)} WebView provider`,
        capabilities.map((capability) => capability.name),
        []
      )
  })
}

const RuntimeProviders = [
  lazyRuntimeProvider({
    id: "bun" as const,
    budget: providerBudget("bun", "@effect/platform-bun", "@effect-desktop/core/providers/bun"),
    layer: Effect.promise(() =>
      import("../providers/bun.js").then((module) => module.BunRuntimeProviderLayer)
    ),
    label: "Bun runtime provider"
  }),
  lazyRuntimeProvider({
    id: "node" as const,
    budget: providerBudget("node", "@effect/platform-node", "@effect-desktop/core/providers/node"),
    layer: Effect.promise(() =>
      import("../providers/node.js").then((module) => module.NodeRuntimeProviderLayer)
    ),
    label: "Node runtime provider"
  }),
  lazyRuntimeProvider({
    id: "test" as const,
    budget: providerBudget("test", "@effect-desktop/core", "@effect-desktop/core/providers/test"),
    layer: Effect.promise(() =>
      import("../providers/test.js").then((module) => module.TestRuntimeProviderLayer)
    ),
    label: "Test runtime provider"
  })
] as const satisfies readonly DesktopRuntimeProviderDescriptor[]

const WebViewProviders = [
  Object.freeze({
    kind: "webview" as const,
    id: "system" as const,
    hostEngine: "system" as const,
    capabilities: WebViewProviderCapabilities.map(
      (name) =>
        new ProviderCapability({
          name,
          description: `Provides ${name} through the operating system WebView runtime`
        })
    ),
    node: graphNode(
      "provider:webview:system",
      "provider",
      "System WebView provider",
      WebViewProviderCapabilities,
      []
    )
  }),
  Object.freeze({
    kind: "webview" as const,
    id: "chrome" as const,
    hostEngine: "chrome" as const,
    capabilities: [
      ...WebViewProviderCapabilities.map(
        (name) =>
          new ProviderCapability({
            name,
            description: `Provides ${name} through bundled Chromium/CEF`
          })
      ),
      new ProviderCapability({
        name: "BundledChromium",
        description: "Provides a packaged Chromium runtime instead of an installed browser"
      })
    ],
    node: graphNode(
      "provider:webview:chrome",
      "provider",
      "Bundled Chrome WebView provider",
      [...WebViewProviderCapabilities, "BundledChromium"],
      []
    )
  })
] as const satisfies readonly DesktopWebViewProviderDescriptor[]

export const Provider = Object.freeze({
  runtime: runtimeProvider,
  webview: webviewProvider,
  Runtime: Object.freeze({
    bun: RuntimeProviders[0],
    node: RuntimeProviders[1],
    test: RuntimeProviders[2]
  }),
  WebView: Object.freeze({
    system: WebViewProviders[0],
    chrome: WebViewProviders[1]
  })
})

export const provider = <RIn = never>(
  descriptor: DesktopProviderDescriptor
): Layer.Layer<never, never, RIn | DesktopProviderRegistry> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const registry = yield* DesktopProviderRegistry
      yield* registry.register(descriptor)
    })
  )

export const native = (...layers: readonly DesktopNativeLayer[]): DesktopNativeLayer =>
  mergeLayerArray(layers.map((layer) => Layer.fresh(layer)))

const DefaultProviders = Object.freeze({
  runtime: Provider.Runtime.bun,
  webview: Provider.WebView.system
})

const providerLabel = (id: string): string => `${id.slice(0, 1).toUpperCase()}${id.slice(1)}`

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
    native: config.native ?? (Layer.empty as DesktopNativeLayer),
    rpcs: config.rpcs ?? (Layer.empty as DesktopRpcsLayer<E, RIn>),
    permissions: config.permissions ?? (Layer.empty as DesktopPermissionsLayer<RIn>),
    workflows: config.workflows ?? (Layer.empty as DesktopWorkflowsLayer<RIn, E>),
    ...(config.providers === undefined ? {} : { providers: config.providers })
  })
}

export const manifest = <RIn = never, E = never>(
  config: DesktopManifestSource<RIn, E>
): DesktopAppManifest => {
  const registrations = [
    ...snapshotRegistrationsSync(config.rpcs),
    ...nativeRpcRegistrationsSync(snapshotNativeRegistrationsSync(config.native))
  ]
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
      yield* registry.register({
        group,
        handlers: handlers as unknown as Layer.Layer<unknown, unknown, unknown>
      })
    })
  )

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
        services: services as unknown as Layer.Layer<never, unknown, unknown> | undefined
      })
    })
  )
}

export const permission = <RIn = never>(
  capability: NormalizedCapability
): Layer.Layer<never, never, RIn | DesktopPermissionRegistry> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const registry = yield* DesktopPermissionRegistry
      yield* registry.register(capability)
    })
  )

export const permissions = <RIn = never>(
  ...layers: readonly DesktopPermissionsLayer<RIn>[]
): DesktopPermissionsLayer<RIn> => mergeLayerArray(layers)

export const workflow = <RIn = never, E = never>(
  layer: DesktopWorkflowLayer<RIn, E>
): Layer.Layer<never, never, DesktopWorkflowRegistry> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const registry = yield* DesktopWorkflowRegistry
      yield* registry.register(layer as unknown as AnyDesktopWorkflowRegistration)
    })
  )

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

export class DesktopWindowRegistryAsyncBuildError extends Data.TaggedError(
  "DesktopWindowRegistryAsyncBuildError"
)<{
  readonly message: string
  readonly cause: unknown
}> {}

export class DesktopPermissionRegistryAsyncBuildError extends Data.TaggedError(
  "DesktopPermissionRegistryAsyncBuildError"
)<{
  readonly message: string
  readonly cause: unknown
}> {}

export class DesktopWorkflowRegistryAsyncBuildError extends Data.TaggedError(
  "DesktopWorkflowRegistryAsyncBuildError"
)<{
  readonly message: string
  readonly cause: unknown
}> {}

export class DesktopProviderRegistryAsyncBuildError extends Data.TaggedError(
  "DesktopProviderRegistryAsyncBuildError"
)<{
  readonly message: string
  readonly cause: unknown
}> {}

export class DesktopNativeRegistryAsyncBuildError extends Data.TaggedError(
  "DesktopNativeRegistryAsyncBuildError"
)<{
  readonly message: string
  readonly cause: unknown
}> {}

const snapshotWindowRegistrationsSync = <RIn>(
  windows: DesktopWindowsLayer<RIn>
): ReadonlyArray<DesktopWindowRegistration> => {
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
): Effect.Effect<ReadonlyArray<AnyDesktopRpcRegistration>, never, never> =>
  Effect.sync(() => snapshotRegistrationsSync(rpcs))

const buildNativeRegistrations = <RIn, E>(
  nativeLayer: DesktopConfig<RIn, E>["native"]
): Effect.Effect<ReadonlyArray<AnyDesktopNativeRegistration>, never, never> =>
  Effect.sync(() => snapshotNativeRegistrationsSync(nativeLayer))

const buildPermissions = <RIn>(
  permissions: DesktopConfig<RIn, never>["permissions"]
): Effect.Effect<ReadonlyArray<NormalizedCapability>, never, never> =>
  Effect.sync(() => snapshotPermissionsSync(permissions))

const buildWorkflows = <RIn, E>(
  workflows: DesktopConfig<RIn, E>["workflows"]
): Effect.Effect<ReadonlyArray<AnyDesktopWorkflowRegistration>, never, never> =>
  Effect.sync(() => snapshotWorkflowsSync(workflows))

const buildProviders = <RIn, E>(
  config: DesktopConfig<RIn, E>
): Effect.Effect<SelectedProviderDescriptors, DesktopConfigError, never> =>
  Effect.sync(() => snapshotProvidersSync(config.providers)).pipe(
    Effect.flatMap((providers) => selectProviderDescriptors(config.id, providers))
  )

/**
 * Synchronous registry snapshot. The `Desktop.rpc(...)` constructor produces a
 * layer whose only side effect is calling `registry.register(...)` via
 * `Effect.sync`. Composed with `DesktopRpcRegistryLive` (also sync) the whole
 * build runs without async work, so `Effect.runSync` is safe and lets
 * `Desktop.manifest(...)` stay synchronous for renderer adapters.
 */
const snapshotRegistrationsSync = <RIn, E>(
  rpcs: DesktopConfig<RIn, E>["rpcs"]
): ReadonlyArray<AnyDesktopRpcRegistration> => {
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

const snapshotNativeRegistrationsSync = (
  nativeLayer: DesktopNativeLayer | undefined
): ReadonlyArray<AnyDesktopNativeRegistration> => {
  if (nativeLayer === undefined) return []
  const composed = Layer.provideMerge(nativeLayer, DesktopNativeRegistryLive)
  try {
    return Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(composed)
          const registry = Context.get(context, DesktopNativeRegistry)
          return yield* registry.snapshot
        })
      )
    )
  } catch (cause) {
    throw new DesktopNativeRegistryAsyncBuildError({
      message:
        "Desktop.make(...) / Desktop.manifest(...) requires the native layer to build " +
        "synchronously. A layer composed into Desktop.make({ native }) requires async work " +
        "to construct (e.g. Layer.scoped(Effect.promise(...))) — register native surfaces " +
        "through Desktop.native(...) and keep async work inside native handlers instead.",
      cause
    })
  }
}

const nativeRpcRegistrationsSync = (
  registrations: ReadonlyArray<AnyDesktopNativeRegistration>
): ReadonlyArray<AnyDesktopRpcRegistration> =>
  snapshotRegistrationsSync(mergeNativeServerLayers(registrations))

const mergeNativeServerLayers = (
  registrations: ReadonlyArray<AnyDesktopNativeRegistration>
): DesktopRpcsLayer<unknown, unknown> =>
  mergeLayerArray(registrations.map((registration) => registration.serverLayer))

const snapshotPermissionsSync = <RIn>(
  permissions: DesktopConfig<RIn, never>["permissions"]
): ReadonlyArray<NormalizedCapability> => {
  if (permissions === undefined) return []
  const composed = Layer.provideMerge(
    permissions as unknown as Layer.Layer<never, never, DesktopPermissionRegistry>,
    DesktopPermissionRegistryLive
  )
  try {
    return Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(composed)
          const registry = Context.get(context, DesktopPermissionRegistry)
          return yield* registry.snapshot
        })
      )
    )
  } catch (cause) {
    throw new DesktopPermissionRegistryAsyncBuildError({
      message:
        "Desktop.make(...) requires the permissions layer to build synchronously. " +
        "A layer composed into Desktop.make({ permissions }) requires async work to construct " +
        "(e.g. Layer.scoped(Effect.promise(...))) — pass capabilities through `Desktop.permission(...)` " +
        "and keep async policy work inside runtime services instead.",
      cause
    })
  }
}

const snapshotWorkflowsSync = <RIn, E>(
  workflows: DesktopConfig<RIn, E>["workflows"]
): ReadonlyArray<DesktopWorkflowRegistration<E, RIn>> => {
  if (workflows === undefined) return []
  const composed = Layer.provideMerge(
    workflows as unknown as Layer.Layer<never, never, DesktopWorkflowRegistry>,
    DesktopWorkflowRegistryLive
  )
  try {
    return Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(composed)
          const registry = Context.get(context, DesktopWorkflowRegistry)
          return yield* registry.snapshot
        })
      )
    ) as ReadonlyArray<DesktopWorkflowRegistration<E, RIn>>
  } catch (cause) {
    throw new DesktopWorkflowRegistryAsyncBuildError({
      message:
        "Desktop.make(...) requires the workflows layer to build synchronously. " +
        "A layer composed into Desktop.make({ workflows }) requires async work to construct " +
        "(e.g. Layer.scoped(Effect.promise(...))) — pass workflow layers through `Desktop.workflow(...)` " +
        "and keep async work inside workflow effects instead.",
      cause
    })
  }
}

const snapshotProvidersSync = <RIn>(
  providers: DesktopProvidersLayer<RIn> | undefined
): ReadonlyArray<DesktopProviderDescriptor> => {
  if (providers === undefined) return []
  const composed = Layer.provideMerge(
    providers as Layer.Layer<never, never, DesktopProviderRegistry>,
    DesktopProviderRegistryLive
  )
  try {
    return Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(composed)
          const registry = Context.get(context, DesktopProviderRegistry)
          return yield* registry.snapshot
        })
      )
    )
  } catch (cause) {
    throw new DesktopProviderRegistryAsyncBuildError({
      message:
        "Desktop.make(...) requires the providers layer to build synchronously. " +
        "A layer composed into Desktop.make({ providers }) requires async work to construct " +
        "(e.g. Layer.scoped(Effect.promise(...))) — pass provider descriptors through `Desktop.provider(...)` " +
        "and keep async work inside provider layers instead.",
      cause
    })
  }
}

export const app = <RIn = never, E = never>(
  config: DesktopConfig<RIn, E>
): Layer.Layer<
  DesktopApp,
  DesktopConfigError | E,
  Exclude<
    RIn,
    | DesktopRuntimeProviderServices
    | DesktopNativeRegistry
    | DesktopRpcRegistry
    | DesktopWindowRegistry
    | DesktopPermissionRegistry
    | DesktopWorkflowRegistry
    | ResourceOwner
  >
> =>
  runtime(config) as Layer.Layer<
    DesktopApp,
    DesktopConfigError | E,
    Exclude<
      RIn,
      | DesktopRuntimeProviderServices
      | DesktopNativeRegistry
      | DesktopRpcRegistry
      | DesktopWindowRegistry
      | DesktopPermissionRegistry
      | DesktopWorkflowRegistry
      | ResourceOwner
    >
  >

export const runtime = <RIn = never, E = never>(
  config: DesktopConfig<RIn, E>
): Layer.Layer<
  DesktopRuntimeServices,
  DesktopConfigError | E,
  Exclude<
    RIn,
    | DesktopRuntimeProviderServices
    | DesktopNativeRegistry
    | DesktopRpcRegistry
    | DesktopWindowRegistry
    | DesktopPermissionRegistry
    | DesktopWorkflowRegistry
    | ResourceOwner
  >
> =>
  buildSpine(config) as Layer.Layer<
    DesktopRuntimeServices,
    DesktopConfigError | E,
    Exclude<
      RIn,
      | DesktopRuntimeProviderServices
      | DesktopNativeRegistry
      | DesktopRpcRegistry
      | DesktopWindowRegistry
      | DesktopPermissionRegistry
      | DesktopWorkflowRegistry
      | ResourceOwner
    >
  >

export const DesktopRuntimeLive = runtime

export const runtimeGraph = <RIn, E>(
  config: DesktopConfig<RIn, E>
): Effect.Effect<DesktopRuntimeGraph, DesktopConfigError, never> =>
  Effect.gen(function* () {
    const providers = yield* buildProviders(config)
    const appRegistrations = yield* buildRegistrations(config.rpcs)
    const nativeRegistrations = yield* buildNativeRegistrations(config.native)
    const registrations = [
      ...appRegistrations,
      ...nativeRpcRegistrationsSync(nativeRegistrations)
    ] as const
    const workflows = yield* buildWorkflows(config.workflows)
    yield* checkNativeRegistrations(config.id, nativeRegistrations)
    yield* checkDuplicateRpcRegistrations(config, registrations)
    return makeRuntimeGraph(
      config,
      providers.runtime,
      providers.webview,
      nativeRegistrations,
      registrations,
      workflows
    )
  })

export const runtimeGraphSnapshot = <RIn, E>(
  config: DesktopConfig<RIn, E>
): Effect.Effect<LayerGraphSnapshot, never, never> =>
  Effect.match(runtimeGraph(config), {
    onFailure: (error) =>
      new LayerGraphSnapshot({
        appId: config.id,
        providers: selectedProviderIdsFromLayer(
          config.providers as DesktopProvidersLayer | undefined
        ),
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
  provider: DesktopRuntimeProviderDescriptor,
  webviewProvider: DesktopWebViewProviderDescriptor,
  nativeRegistrations: ReadonlyArray<AnyDesktopNativeRegistration>,
  registrations: ReadonlyArray<AnyDesktopRpcRegistration>,
  workflows: ReadonlyArray<AnyDesktopWorkflowRegistration>
): DesktopRuntimeGraph => {
  const selected = Object.freeze({
    runtime: provider.id,
    webview: webviewProvider.id
  } satisfies DesktopRuntimeSelectedProviders)
  const nodes: DesktopRuntimeGraphNode[] = [
    provider.node,
    webviewProvider.node,
    ...CoreServiceGraphNodes,
    ...nativeRegistrations.map((registration) =>
      graphNode(
        `native:${registration.tag}`,
        "native-surface",
        `${registration.tag} native surface`,
        registration.schemaDocs.map((doc) => doc.tag),
        ["DesktopNativeRegistry", "DesktopRpcRegistry"]
      )
    ),
    ...registrations.map((registration, index) =>
      graphNode(
        `rpc-layer:${index}`,
        "rpc-layer",
        `RPC layer ${Array.from(registration.group.requests.keys()).join(", ")}`,
        Array.from(registration.group.requests.keys()),
        ["RpcServer.Protocol"]
      )
    ),
    ...workflows.map((_, index) =>
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
      }),
      new ProviderFact({
        id: webviewProvider.id,
        kind: "webview",
        capabilities: webviewProvider.capabilities.map((capability) => capability.name)
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
  registrations: ReadonlyArray<AnyDesktopRpcRegistration>,
  declared: ReadonlyArray<NormalizedCapability>
): Effect.Effect<void, DesktopConfigError, never> => {
  for (const registration of registrations) {
    for (const [tag, rpc] of registration.group.requests.entries()) {
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
            message: `RPC method "${tag}" requires capability "${requiredCapability.kind}" but it is not declared with Desktop.permission(...)`,
            method: tag,
            permission: requiredCapability.kind
          })
        )
      }
    }
  }

  return Effect.void
}

const checkDuplicateRpcRegistrations = <RIn, E>(
  config: DesktopConfig<RIn, E>,
  registrations: ReadonlyArray<AnyDesktopRpcRegistration>
): Effect.Effect<void, DesktopConfigError, never> =>
  Effect.suspend(() => {
    const seenRpcTags = new Set<string>()

    for (const registration of registrations) {
      for (const tag of registration.group.requests.keys()) {
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
      }
    }

    return Effect.void
  })

const checkNativeRegistrations = (
  appId: string,
  registrations: ReadonlyArray<AnyDesktopNativeRegistration>
): Effect.Effect<void, DesktopConfigError, never> =>
  Effect.suspend(() => {
    const seenTags = new Set<string>()

    for (const registration of registrations) {
      if (seenTags.has(registration.tag)) {
        return Effect.fail(
          new DesktopConfigError({
            appId,
            reason: "invalid-config",
            message: `Native surface "${registration.tag}" is registered more than once`,
            contract: registration.tag
          })
        )
      }
      seenTags.add(registration.tag)
    }

    return Effect.void
  })

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
      message: `RPC method "${method}" requires unknown capability "${value.kind}" and it cannot be matched against Desktop.permission(...) declarations`,
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
  Exclude<RIn, DesktopRuntimeProviderServices | ResourceOwner>
> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const providers = yield* buildProviders(config)
      const appRegistrations = yield* buildRegistrations(config.rpcs)
      const nativeRegistrations = yield* buildNativeRegistrations(config.native)
      const nativeRpcRegistrations = nativeRpcRegistrationsSync(nativeRegistrations)
      const registrations = [...appRegistrations, ...nativeRpcRegistrations]
      const permissions = yield* buildPermissions(config.permissions)
      const workflowLayers = yield* buildWorkflows(config.workflows)
      const windowRegistrations = snapshotWindowRegistrationsSync(config.windows)
      yield* checkWindowRegistrations(config.id, windowRegistrations)
      yield* checkNativeRegistrations(config.id, nativeRegistrations)
      yield* checkDuplicateRpcRegistrations(config, registrations)
      yield* checkPermissions(config, appRegistrations, permissions)
      const graph = makeRuntimeGraph(
        config,
        providers.runtime,
        providers.webview,
        nativeRegistrations,
        registrations,
        workflowLayers
      )
      const rpcLayers = registrations.map((registration) => bindRegistration(registration))

      const workflowLayer = mergeLayerArray(workflowLayers)
      const rpcLayer = mergeLayerArray(rpcLayers)
      const runtimeProviderLayer = yield* providers.runtime.layer
      const runtimeBase = Layer.mergeAll(
        runtimeProviderLayer,
        coreServicesLayer,
        makePermissionServicesLayer(config, permissions),
        makeAppResourceOwnerLayer(config.id)
      ) as Layer.Layer<
        DesktopRuntimeProviderServices | ResourceOwner,
        Config.ConfigError | DesktopConfigError,
        never
      >

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
      ) as Layer.Layer<
        DesktopApp | DesktopRuntime,
        E,
        RIn | DesktopRuntimeProviderServices | ResourceOwner
      >

      return Layer.provideMerge(dependentLayer, runtimeBase) as Layer.Layer<
        DesktopRuntimeServices,
        E | DesktopConfigError,
        Exclude<RIn, DesktopRuntimeProviderServices | ResourceOwner>
      >
    })
  )

export const providerLayerFor = (
  choice: Pick<DesktopRuntimeSelectedProviders, "runtime">
): Layer.Layer<DesktopRuntimeProviderServices, Config.ConfigError | DesktopConfigError, never> =>
  Layer.unwrap(
    resolveBuiltinRuntimeProvider(choice.runtime).pipe(Effect.flatMap((provider) => provider.layer))
  )

const selectProviderDescriptors = (
  appId: string,
  descriptors: ReadonlyArray<DesktopProviderDescriptor>
): Effect.Effect<SelectedProviderDescriptors, DesktopConfigError, never> => {
  let runtimeProvider: DesktopRuntimeProviderDescriptor | undefined
  let webviewProviderDescriptor: DesktopWebViewProviderDescriptor | undefined

  for (const descriptor of descriptors) {
    if (descriptor.kind === "runtime") {
      if (runtimeProvider !== undefined) {
        return duplicateProviderSelection(appId, "runtime", runtimeProvider.id, descriptor.id)
      }
      runtimeProvider = descriptor
      continue
    }

    if (webviewProviderDescriptor !== undefined) {
      return duplicateProviderSelection(
        appId,
        "webview",
        webviewProviderDescriptor.id,
        descriptor.id
      )
    }
    webviewProviderDescriptor = descriptor
  }

  return Effect.succeed({
    runtime: runtimeProvider ?? DefaultProviders.runtime,
    webview: webviewProviderDescriptor ?? DefaultProviders.webview
  })
}

const duplicateProviderSelection = (
  appId: string,
  kind: "runtime" | "webview",
  first: string,
  second: string
): Effect.Effect<never, DesktopConfigError, never> =>
  Effect.fail(
    new DesktopConfigError({
      appId,
      reason: "invalid-config",
      message: `Desktop.provider(...) selected more than one ${kind} provider (${first}, ${second})`,
      provider: second,
      providerKind: kind
    })
  )

const selectedProviderIdsFromLayer = (
  providers: DesktopProvidersLayer<unknown> | undefined
): DesktopRuntimeSelectedProviders => {
  const descriptors = snapshotProvidersSync(providers)
  let runtimeProvider: DesktopRuntimeProviderId = "bun"
  let webviewProviderDescriptor: DesktopWebViewProviderId = "system"

  for (const descriptor of descriptors) {
    if (descriptor.kind === "runtime") {
      runtimeProvider = descriptor.id
    } else {
      webviewProviderDescriptor = descriptor.id
    }
  }

  return Object.freeze({
    runtime: runtimeProvider,
    webview: webviewProviderDescriptor
  })
}

const resolveBuiltinRuntimeProvider = (
  provider: DesktopRuntimeProviderId
): Effect.Effect<DesktopRuntimeProviderDescriptor, DesktopConfigError, never> => {
  const descriptor = RuntimeProviders.find((candidate) => candidate.id === provider)
  if (descriptor !== undefined) {
    return Effect.succeed(descriptor)
  }
  return Effect.fail(
    providerRegistryErrorToConfigError(
      "provider-loader",
      new ProviderRegistryError({
        reason: "missing-provider",
        kind: "runtime",
        provider,
        message: `Runtime provider "${provider}" is not available`
      })
    )
  )
}

const providerRegistryErrorToConfigError = (
  appId: string,
  error: ProviderRegistryError
): DesktopConfigError =>
  new DesktopConfigError({
    appId,
    reason: error.reason === "missing-provider" ? "missing-provider" : "invalid-config",
    message: error.message,
    provider: error.provider,
    providerKind: error.kind
  })

const makePermissionServicesLayer = <RIn, E>(
  config: DesktopConfig<RIn, E>,
  permissions: ReadonlyArray<NormalizedCapability>
): Layer.Layer<PermissionRegistry | PermissionInterceptor, never, never> => {
  const registryLayer = Layer.effect(
    PermissionRegistry,
    Effect.gen(function* () {
      const registry = yield* makePermissionRegistry()
      yield* Effect.forEach(
        permissions,
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

const makeAppResourceOwnerLayer = (
  appId: string
): Layer.Layer<ResourceOwner, DesktopConfigError, never> =>
  Layer.effect(
    ResourceOwner,
    makeAppResourceOwner(appId).pipe(
      Effect.mapError((error) => resourceOwnerErrorToConfigError(appId, error))
    )
  )

const resourceOwnerErrorToConfigError = (
  appId: string,
  error: ResourceOwnerInvalidArgumentError
): DesktopConfigError =>
  new DesktopConfigError({
    appId,
    reason: "invalid-config",
    message: `Desktop app id is not a valid resource owner id: ${error.message}`
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
        ? error.providerKind === "webview"
          ? "DesktopWebViewProvider"
          : "DesktopRuntimeProviderServices"
        : (error.permission ?? error.method ?? error.contract ?? "DesktopRuntime"),
    providerPath:
      error.provider === undefined
        ? []
        : [`provider:${error.providerKind ?? "runtime"}:${error.provider}`],
    message: error.message,
    ...(error.provider === undefined ? {} : { provider: error.provider })
  })

const mergeLayerArray = <E, R>(
  layers: ReadonlyArray<Layer.Layer<never, E, R>>
): Layer.Layer<never, E, R> => {
  const [firstLayer, ...remainingLayers] = layers
  return firstLayer === undefined
    ? (Layer.empty as Layer.Layer<never, E, R>)
    : Layer.mergeAll(firstLayer, ...remainingLayers)
}

const bindRegistration = (
  registration: AnyDesktopRpcRegistration
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
    registration.handlers
    // Cast invariant: Layer.provide of an unknown-typed handler returns
    // Layer<never, unknown, unknown>; we restate it here so the binder's
    // return type is callable without forcing every caller to thread the
    // specific Rpc union — bindRegistration is the type-erasure boundary.
  )

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
