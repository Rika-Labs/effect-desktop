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

import { rpcCapability } from "@orika/bridge"

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
import { ResourceOwner, makeAppResourceOwner } from "./resource-owner.js"
import type { ResourceOwnerInvalidArgumentError } from "./resource-owner.js"
import { EffectTelemetryRuntimeLive, Telemetry, makeTelemetry } from "./telemetry.js"
import type { DesktopRpcContractLaw, DesktopRpcSchemaDoc } from "./desktop-rpc-surface.js"
import type {
  AnyDesktopRpcRegistration,
  DesktopAppManifest,
  DesktopRpcsLayer,
  TypedDesktopRpcRegistrationGroup
} from "./renderer-types.js"
export type {
  AnyDesktopRpcRegistration,
  DesktopAppManifest,
  DesktopRpcGroupDescriptor,
  DesktopRpcRegistration,
  DesktopRpcRegistrationGroup,
  DesktopRpcsLayer,
  TypedDesktopRpcRegistrationGroup
} from "./renderer-types.js"

export interface WindowSpec {
  readonly title: string
  readonly width?: number
  readonly height?: number
  readonly renderer?: string
}

export interface DesktopWindowRegistration<RIn = unknown> {
  readonly _tag: "DesktopWindowRegistration"
  readonly id: string
  readonly spec: WindowSpec
  readonly services: Layer.Layer<never, never, RIn | Scope.Scope> | undefined
}

const RESERVED_WINDOW_IDS: ReadonlySet<string> = Object.freeze(
  new Set(["__proto__", "constructor", "prototype"])
)

export const isSafeWindowId = (id: string): boolean => id.length > 0 && !RESERVED_WINDOW_IDS.has(id)

export type DesktopWindowsLayer<RIn = never> = ReadonlyArray<DesktopWindowRegistration<RIn>>

export type DesktopPermissionsLayer = ReadonlyArray<NormalizedCapability>

export type DesktopProvidersLayer = ReadonlyArray<DesktopProviderDescriptor>

export interface DesktopNativeRegistration<E = unknown, ServerR = unknown, HandlerR = unknown> {
  readonly tag: string
  readonly serverLayer: DesktopRpcsLayer<E, ServerR, HandlerR>
  readonly schemaDocs: readonly DesktopRpcSchemaDoc[]
  readonly contractLaws: readonly DesktopRpcContractLaw[]
}

export type AnyDesktopNativeRegistration<
  E = unknown,
  ServerR = unknown,
  HandlerR = unknown
> = DesktopNativeRegistration<E, ServerR, HandlerR>

export type DesktopNativeLayer<E = unknown, ServerR = unknown, HandlerR = unknown> = ReadonlyArray<
  DesktopNativeRegistration<E, ServerR, HandlerR>
>

export interface DesktopNativeSurfaceSelection<E = unknown, ServerR = unknown, HandlerR = unknown> {
  readonly _tag: "NativeSurfaceSelection"
  readonly surfaces: readonly DesktopNativeRegistration<E, ServerR, HandlerR>[]
}

export type DesktopNativeDeclaration<E = unknown, ServerR = unknown, HandlerR = unknown> =
  | DesktopNativeLayer<E, ServerR, HandlerR>
  | DesktopNativeSurfaceSelection<E, ServerR, HandlerR>

type DesktopNativeDeclarationError<Declaration> =
  Declaration extends DesktopNativeDeclaration<infer E, unknown, unknown> ? E : never

type DesktopNativeDeclarationServerR<Declaration> =
  Declaration extends DesktopNativeDeclaration<unknown, infer ServerR, unknown> ? ServerR : never

type DesktopNativeDeclarationHandlerR<Declaration> =
  Declaration extends DesktopNativeDeclaration<unknown, unknown, infer HandlerR> ? HandlerR : never

export type DesktopWorkflowRegistration<E = unknown, R = unknown> = Layer.Layer<
  never,
  E,
  R | WorkflowEngine.WorkflowEngine
>

export type AnyDesktopWorkflowRegistration = DesktopWorkflowRegistration<unknown, unknown>

export type DesktopWorkflowsLayer<RIn = never, E = never> = ReadonlyArray<
  DesktopWorkflowRegistration<E, RIn>
>

type PermissionedDesktopRpcs<Rpcs extends Rpc.Any> = Rpc.AddMiddleware<
  Rpcs,
  typeof PermissionInterceptor
>
export type DesktopRpcServerRequirements<Rpcs extends Rpc.Any> =
  | RpcServer.Protocol
  | Rpc.Middleware<Rpcs>
  | Rpc.ServicesServer<Rpcs>

export type DesktopRpcBoundServerRequirements<Rpcs extends Rpc.Any, R> =
  | R
  | DesktopRpcServerRequirements<PermissionedDesktopRpcs<Rpcs>>
  | Exclude<Rpc.ToHandler<PermissionedDesktopRpcs<Rpcs>>, Rpc.ToHandler<Rpcs>>

export interface DesktopConfig<RIn = never, E = never, RpcHandlerR = unknown> {
  readonly id: string
  readonly windows: DesktopWindowsLayer<RIn>
  readonly providers?: DesktopProvidersLayer
  readonly native?: DesktopNativeLayer<E, RIn, RpcHandlerR>
  readonly rpcs?: DesktopRpcsLayer<E, RIn, RpcHandlerR>
  readonly permissions?: DesktopPermissionsLayer
  readonly workflows?: DesktopWorkflowsLayer<RIn, E>
}

export interface DesktopMakeConfig<RIn = never, E = never, RpcHandlerR = unknown> {
  readonly id?: string
  readonly windows: DesktopWindowsLayer<RIn>
  readonly providers?: DesktopProvidersLayer
  readonly native?: DesktopNativeLayer<E, RIn, RpcHandlerR>
  readonly rpcs?: DesktopRpcsLayer<E, RIn, RpcHandlerR>
  readonly permissions?: DesktopPermissionsLayer
  readonly workflows?: DesktopWorkflowsLayer<RIn, E>
}

export type DesktopWorkflowLayer<RIn = never, E = never> = DesktopWorkflowRegistration<E, RIn>

export type DesktopWorkflowEngineLayer<RIn = never, E = never> = Layer.Layer<
  WorkflowEngine.WorkflowEngine,
  E,
  RIn
>

export interface DesktopAppDescriptor<
  RIn = never,
  E = never,
  RpcHandlerR = unknown
> extends DesktopConfig<RIn, E, RpcHandlerR> {
  readonly _tag: "DesktopAppDescriptor"
  readonly native: DesktopNativeLayer<E, RIn, RpcHandlerR>
  readonly rpcs: DesktopRpcsLayer<E, RIn, RpcHandlerR>
  readonly permissions: DesktopPermissionsLayer
  readonly workflows: DesktopWorkflowsLayer<RIn, E>
  readonly windowRegistrations: ReadonlyArray<DesktopWindowRegistration<RIn>>
}

interface DesktopNativeSelectionSnapshot<E, ServerR, HandlerR> {
  readonly registrations: ReadonlyArray<DesktopNativeRegistration<E, ServerR, HandlerR>>
  readonly permissions: ReadonlyArray<NormalizedCapability>
}

export type DesktopManifestSource<RIn = never, E = never, RpcHandlerR = unknown> = Pick<
  DesktopConfig<RIn, E, RpcHandlerR>,
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

type DesktopRuntimeProvidedServices =
  | DesktopRuntimeServices
  | PermissionRegistry
  | PermissionInterceptor

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
  readonly cause?: unknown
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

export class DesktopApp extends Context.Service<DesktopApp, DesktopAppApi>()(
  "@orika/core/runtime/desktop-app/DesktopApp"
) {}

export class DesktopRuntime extends Context.Service<DesktopRuntime, DesktopRuntimeApi>()(
  "@orika/core/runtime/desktop-app/DesktopRuntime"
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

// A malformed runtime configuration cannot be recovered from at startup, so the
// `Config.ConfigError` channel on the core services is converted to a defect
// rather than leaked into the public runtime error type.
const coreServicesLayer = Layer.mergeAll(
  ResourceRegistryLive,
  Layer.provideMerge(EffectTelemetryRuntimeLive, TelemetryLive),
  Reactivity.layer,
  DesktopLoggerLayer,
  WorkflowEngineMemory
).pipe(Layer.orDie)

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
    DesktopConfigError,
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
    DesktopConfigError,
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
    budget: providerBudget("bun", "@effect/platform-bun", "@orika/core/providers/bun"),
    layer: Effect.tryPromise({
      try: () => import("../providers/bun.js").then((mod) => mod.BunRuntimeProviderLayer),
      catch: (cause) => runtimeProviderLoadError("bun", cause)
    }),
    label: "Bun runtime provider"
  }),
  lazyRuntimeProvider({
    id: "node" as const,
    budget: providerBudget("node", "@effect/platform-node", "@orika/core/providers/node"),
    layer: Effect.tryPromise({
      try: () => import("../providers/node.js").then((mod) => mod.NodeRuntimeProviderLayer),
      catch: (cause) => runtimeProviderLoadError("node", cause)
    }),
    label: "Node runtime provider"
  }),
  lazyRuntimeProvider({
    id: "test" as const,
    budget: providerBudget("test", "@orika/core", "@orika/core/providers/test"),
    layer: Effect.tryPromise({
      try: () => import("../providers/test.js").then((mod) => mod.TestRuntimeProviderLayer),
      catch: (cause) => runtimeProviderLoadError("test", cause)
    }),
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

export const provider = (descriptor: DesktopProviderDescriptor): DesktopProvidersLayer =>
  Object.freeze([descriptor])

export const providers = (...layers: readonly DesktopProvidersLayer[]): DesktopProvidersLayer =>
  Object.freeze(layers.flat())

export const native = <
  const Declarations extends readonly DesktopNativeDeclaration<unknown, unknown, unknown>[]
>(
  ...declarations: Declarations
): DesktopNativeLayer<
  DesktopNativeDeclarationError<Declarations[number]>,
  DesktopNativeDeclarationServerR<Declarations[number]>,
  DesktopNativeDeclarationHandlerR<Declarations[number]>
> =>
  // The runtime flattening preserves the exact registrations passed in by each
  // declaration; TypeScript widens the variadic union to unknown when `flatMap`
  // crosses the layer/selection union, so keep that proof at this constructor.
  Object.freeze(
    declarations.flatMap((declaration) =>
      isDesktopNativeLayer(declaration) ? declaration : declaration.surfaces
    )
  ) as DesktopNativeLayer<
    DesktopNativeDeclarationError<Declarations[number]>,
    DesktopNativeDeclarationServerR<Declarations[number]>,
    DesktopNativeDeclarationHandlerR<Declarations[number]>
  >

const isDesktopNativeLayer = <E, ServerR, HandlerR>(
  declaration: DesktopNativeDeclaration<E, ServerR, HandlerR>
): declaration is DesktopNativeLayer<E, ServerR, HandlerR> => Array.isArray(declaration)

const DefaultProviders = Object.freeze({
  runtime: Provider.Runtime.bun,
  webview: Provider.WebView.system
})

const providerLabel = (id: string): string => `${id.slice(0, 1).toUpperCase()}${id.slice(1)}`

export const make = <RIn = never, E = never, RpcHandlerR = unknown>(
  config: DesktopMakeConfig<RIn, E, RpcHandlerR>
): DesktopAppDescriptor<RIn, E, RpcHandlerR> => {
  const windowRegistrations = config.windows
  failOnDuplicateWindowIds(config.id ?? "app", windowRegistrations)
  return Object.freeze({
    _tag: "DesktopAppDescriptor" as const,
    id: config.id ?? "app",
    windows: config.windows,
    windowRegistrations,
    native: config.native ?? Object.freeze([]),
    rpcs: config.rpcs ?? Object.freeze([]),
    permissions: config.permissions ?? Object.freeze([]),
    workflows: config.workflows ?? Object.freeze([]),
    ...(config.providers === undefined ? {} : { providers: config.providers })
  })
}

export const manifest = <RIn = never, E = never, RpcHandlerR = unknown>(
  config: DesktopManifestSource<RIn, E, RpcHandlerR>
): DesktopAppManifest => {
  const registrations = [...(config.rpcs ?? []), ...nativeRpcRegistrationsSync(config.native ?? [])]
  const windowRegistrations = config.windows
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

export const rpc = <Rpcs extends Rpc.Any, E, R>(
  group: RpcGroup.RpcGroup<Rpcs>,
  handlers: Layer.Layer<Rpc.ToHandler<Rpcs>, E, R>
): DesktopRpcsLayer<E, DesktopRpcBoundServerRequirements<Rpcs, R>, R, Rpc.ToHandler<Rpcs>> =>
  Object.freeze([
    Object.freeze({
      _tag: "DesktopRpcRegistration" as const,
      group: group as TypedDesktopRpcRegistrationGroup<Rpcs>,
      handlers,
      serverLayer: bindRpcGroup(group, handlers)
    })
  ])

export const rpcs = <E = never, RIn = never>(
  ...layers: readonly DesktopRpcsLayer<E, RIn>[]
): DesktopRpcsLayer<E, RIn> => Object.freeze(layers.flat())

export const desktopWindow = <RIn = never>(
  id: string,
  spec: WindowSpec,
  services?: Layer.Layer<never, never, RIn | Scope.Scope>
): DesktopWindowsLayer<RIn> => {
  if (!isSafeWindowId(id)) {
    throw new TypeError(
      `Desktop.window: window id ${JSON.stringify(id)} is reserved (cannot be empty, "__proto__", "constructor", or "prototype")`
    )
  }
  return Object.freeze([
    Object.freeze({
      _tag: "DesktopWindowRegistration" as const,
      id,
      spec: Object.freeze({ ...spec }),
      services
    })
  ])
}

export const windows = <RIn = never>(
  ...layers: readonly DesktopWindowsLayer<RIn>[]
): DesktopWindowsLayer<RIn> => Object.freeze(layers.flat())

export const permission = (capability: NormalizedCapability): DesktopPermissionsLayer =>
  Object.freeze([capability])

export const permissions = (
  ...layers: readonly DesktopPermissionsLayer[]
): DesktopPermissionsLayer => {
  const seen = new Set<string>()
  const deduped: NormalizedCapability[] = []
  for (const capability of layers.flat()) {
    const key = JSON.stringify(capability)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    deduped.push(capability)
  }
  return Object.freeze(deduped)
}

export const workflow = <RIn = never, E = never>(
  layer: DesktopWorkflowLayer<RIn, E>
): DesktopWorkflowsLayer<RIn, E> => Object.freeze([layer])

export const workflows = <RIn = never, E = never>(
  ...layers: readonly DesktopWorkflowsLayer<RIn, E>[]
): DesktopWorkflowsLayer<RIn, E> => Object.freeze(layers.flat())

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

const buildRegistrations = <RIn, E, RpcHandlerR>(
  rpcs: DesktopConfig<RIn, E, RpcHandlerR>["rpcs"]
): Effect.Effect<ReadonlyArray<AnyDesktopRpcRegistration<E, RIn, RpcHandlerR>>, never, never> =>
  Effect.succeed(rpcs ?? [])

const buildNativeSelection = <RIn, E, RpcHandlerR>(
  nativeLayer: DesktopConfig<RIn, E, RpcHandlerR>["native"]
): Effect.Effect<DesktopNativeSelectionSnapshot<E, RIn, RpcHandlerR>, never, never> =>
  Effect.succeed({
    registrations: nativeLayer ?? [],
    permissions: Object.freeze([])
  })

const buildPermissions = <RIn>(
  permissions: DesktopConfig<RIn, never>["permissions"]
): Effect.Effect<ReadonlyArray<NormalizedCapability>, never, never> =>
  Effect.succeed(permissions ?? [])

const buildWorkflows = <RIn, E>(
  workflows: DesktopConfig<RIn, E>["workflows"]
): Effect.Effect<ReadonlyArray<DesktopWorkflowRegistration<E, RIn>>, never, never> =>
  Effect.succeed(workflows ?? [])

const buildProviders = <RIn, E, RpcHandlerR>(
  config: DesktopConfig<RIn, E, RpcHandlerR>
): Effect.Effect<SelectedProviderDescriptors, DesktopConfigError, never> =>
  selectProviderDescriptors(config.id, config.providers ?? [])

const nativeRpcRegistrationsSync = <E, ServerR, HandlerR>(
  registrations: ReadonlyArray<DesktopNativeRegistration<E, ServerR, HandlerR>>
): ReadonlyArray<AnyDesktopRpcRegistration<E, ServerR, HandlerR>> =>
  Object.freeze(registrations.flatMap((registration) => registration.serverLayer))

export const layer = <RIn = never, E = never, RpcHandlerR = unknown>(
  descriptor: DesktopAppDescriptor<RIn, E, RpcHandlerR>
): Layer.Layer<
  DesktopRuntimeServices,
  DesktopConfigError | E,
  Exclude<RIn, DesktopRuntimeProvidedServices>
> => runtime(descriptor)

export const runtime = <RIn = never, E = never, RpcHandlerR = unknown>(
  config: DesktopConfig<RIn, E, RpcHandlerR>
): Layer.Layer<
  DesktopRuntimeServices,
  DesktopConfigError | E,
  Exclude<RIn, DesktopRuntimeProvidedServices>
> => buildSpine(config)

export const DesktopRuntimeLive = runtime

export const runtimeGraph = <RIn, E, RpcHandlerR>(
  config: DesktopConfig<RIn, E, RpcHandlerR>
): Effect.Effect<DesktopRuntimeGraph, DesktopConfigError, never> =>
  Effect.gen(function* () {
    const providers = yield* buildProviders(config)
    const appRegistrations = yield* buildRegistrations(config.rpcs)
    const nativeSelection = yield* buildNativeSelection(config.native)
    const nativeRegistrations = nativeSelection.registrations
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

export const runtimeGraphSnapshot = <RIn, E, RpcHandlerR>(
  config: DesktopConfig<RIn, E, RpcHandlerR>
): Effect.Effect<LayerGraphSnapshot, never, never> =>
  Effect.match(runtimeGraph(config), {
    onFailure: (error) =>
      new LayerGraphSnapshot({
        appId: config.id,
        providers: selectedProviderIdsFromLayer(config.providers),
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
  config: DesktopConfig<RIn, E, unknown>,
  provider: DesktopRuntimeProviderDescriptor,
  webviewProvider: DesktopWebViewProviderDescriptor,
  nativeRegistrations: ReadonlyArray<AnyDesktopNativeRegistration>,
  registrations: ReadonlyArray<AnyDesktopRpcRegistration<unknown, unknown, unknown>>,
  workflows: ReadonlyArray<unknown>
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
        ["RpcServer.Protocol"]
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
  config: DesktopConfig<RIn, E, unknown>,
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

const checkDuplicateRpcRegistrations = <RIn, E, RpcHandlerR>(
  config: DesktopConfig<RIn, E, RpcHandlerR>,
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

const buildSpine = <RIn, E, RpcHandlerR>(
  config: DesktopConfig<RIn, E, RpcHandlerR>
): Layer.Layer<
  DesktopRuntimeServices,
  DesktopConfigError | E,
  Exclude<RIn, DesktopRuntimeProvidedServices>
> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const providers = yield* buildProviders(config)
      const appRegistrations = yield* buildRegistrations(config.rpcs)
      const nativeSelection = yield* buildNativeSelection(config.native)
      const nativeRegistrations = nativeSelection.registrations
      const nativeRpcRegistrations = nativeRpcRegistrationsSync(nativeRegistrations)
      const registrations: ReadonlyArray<AnyDesktopRpcRegistration<E, RIn, RpcHandlerR>> = [
        ...appRegistrations,
        ...nativeRpcRegistrations
      ]
      const explicitPermissions = yield* buildPermissions(config.permissions)
      const permissions = [...nativeSelection.permissions, ...explicitPermissions]
      const workflowLayers = yield* buildWorkflows(config.workflows)
      const windowRegistrations = config.windows
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

      const workflowLayer: Layer.Layer<never, E, RIn> = mergeLayerArray(workflowLayers).pipe(
        Layer.provide(coreServicesLayer)
      )
      const rpcLayer = mergeLayerArray(rpcLayers)
      const runtimeProviderLayer = (yield* providers.runtime.layer).pipe(Layer.orDie)
      const runtimeBase = Layer.mergeAll(
        runtimeProviderLayer,
        makePermissionServicesLayer(config, permissions),
        makeAppResourceOwnerLayer(config.id)
      )

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

      const desktopContextLayer = Layer.merge(desktopAppLayer, desktopRuntimeLayer)
      const runtimeProvidedLayer = Layer.merge(runtimeBase, desktopContextLayer)
      const dependentLayer = Layer.mergeAll(workflowLayer, rpcLayer)

      return Layer.provideMerge(dependentLayer, runtimeProvidedLayer)
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
  providers: DesktopProvidersLayer | undefined
): DesktopRuntimeSelectedProviders => {
  const descriptors = providers ?? []
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

const makePermissionServicesLayer = <RIn, E, RpcHandlerR>(
  config: DesktopConfig<RIn, E, RpcHandlerR>,
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
              source: `Desktop.layer:${config.id}`,
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
  return firstLayer === undefined ? Layer.empty : Layer.mergeAll(firstLayer, ...remainingLayers)
}

const bindRpcGroup = <Rpcs extends Rpc.Any, E, R>(
  group: RpcGroup.RpcGroup<Rpcs>,
  handlers: Layer.Layer<Rpc.ToHandler<Rpcs>, E, R>
): Layer.Layer<never, E, DesktopRpcBoundServerRequirements<Rpcs, R>> =>
  Layer.provide(RpcServer.layer(group.middleware(PermissionInterceptor)), handlers)

const bindRegistration = <E, R>(
  registration: AnyDesktopRpcRegistration<E, R, unknown>
): Layer.Layer<never, E, R> => registration.serverLayer

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

function runtimeProviderLoadError(
  provider: DesktopRuntimeProviderId,
  cause: unknown
): DesktopConfigError {
  return new DesktopConfigError({
    appId: "provider-loader",
    reason: "missing-provider",
    provider,
    providerKind: "runtime",
    message: `Runtime provider "${provider}" failed to load`,
    cause
  })
}
