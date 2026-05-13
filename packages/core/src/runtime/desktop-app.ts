import { Config, Context, Data, Effect, Layer, Option, Schema } from "effect"
import type * as FileSystemRuntime from "effect/FileSystem"
import type * as PathRuntime from "effect/Path"
import type * as StdioRuntime from "effect/Stdio"
import type * as TerminalRuntime from "effect/Terminal"
import { Rpc, RpcGroup, RpcServer } from "effect/unstable/rpc"
import type { ChildProcessSpawner as ChildProcessSpawnerRuntime } from "effect/unstable/process"
import { Reactivity } from "effect/unstable/reactivity"
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
import { ResourceRegistryLive } from "./resources.js"
import { servedRpcGroup, servedRpcGroupProperties } from "./rpc-group-metadata.js"
import { Telemetry, makeTelemetry } from "./telemetry.js"

export interface WindowSpec {
  readonly title: string
  readonly width?: number
  readonly height?: number
  readonly renderer?: string
}

export interface DesktopConfig<RIn = never, E = never> {
  readonly id: string
  readonly windows: Readonly<Record<string, WindowSpec>>
  readonly providers?: DesktopProviderSelection
  readonly rpcs?: ReadonlyArray<AnyDesktopRpcLayer<E, RIn>>
  readonly permissions?: ReadonlyArray<NormalizedCapability>
  readonly workflows?: ReadonlyArray<DesktopWorkflowLayer<RIn, E>>
}

export interface DesktopMakeConfig<RIn = never, E = never> {
  readonly id?: string
  readonly windows: Readonly<Record<string, WindowSpec>>
  readonly providers?: DesktopProviderSelection
  readonly rpcs?: ReadonlyArray<AnyDesktopRpcLayer<E, RIn>>
  readonly permissions?: ReadonlyArray<NormalizedCapability>
  readonly workflows?: ReadonlyArray<DesktopWorkflowLayer<RIn, E>>
}

export type DesktopWorkflowLayer<RIn = never, E = never> = Layer.Layer<
  never,
  E,
  RIn | WorkflowEngine.WorkflowEngine
>

export interface DesktopAppDescriptor<RIn = never, E = never> extends DesktopConfig<RIn, E> {
  readonly _tag: "DesktopAppDescriptor"
  readonly rpcs: ReadonlyArray<AnyDesktopRpcLayer<E, RIn>>
  readonly permissions: ReadonlyArray<NormalizedCapability>
  readonly workflows: ReadonlyArray<DesktopWorkflowLayer<RIn, E>>
}

export interface DesktopRpcGroupDescriptor {
  readonly _tag: "DesktopRpcGroup"
  readonly group: RpcGroup.Any & { readonly requests: ReadonlyMap<string, Rpc.Any> }
}

export interface DesktopAppManifest {
  readonly _tag: "DesktopAppManifest"
  readonly id: string
  readonly windows: Readonly<Record<string, WindowSpec>>
  readonly rpcGroups: ReadonlyArray<DesktopRpcGroupDescriptor>
}

export interface DesktopRpcLayer<Rpcs extends Rpc.Any = Rpc.Any, E = never, R = never> {
  readonly _tag: "DesktopRpcsLayer"
  readonly group: RpcGroup.RpcGroup<Rpcs>
  readonly layer: Layer.Layer<Rpc.ToHandler<Rpcs>, E, R>
}

export interface AnyDesktopRpcLayer<E = unknown, R = unknown> {
  readonly _tag: "DesktopRpcsLayer"
  readonly group: RpcGroup.Any & { readonly requests: ReadonlyMap<string, Rpc.Any> }
  readonly layer: Layer.Layer<any, E, R>
}

export type DesktopManifestSource = Pick<DesktopConfig<any, any>, "id" | "windows" | "rpcs">

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
  readonly reason: "missing-permission" | "missing-provider" | "invalid-config" | "duplicate-rpc"
  readonly message: string
  readonly contract?: string
  readonly method?: string
  readonly permission?: string
  readonly provider?: string
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
  readonly rpcLayers: ReadonlyArray<AnyDesktopRpcLayer<any, any>>
}

export class DesktopApp extends Context.Service<DesktopApp, DesktopAppApi>()("DesktopApp") {}

export class DesktopRuntime extends Context.Service<DesktopRuntime, DesktopRuntimeApi>()(
  "DesktopRuntime"
) {}

const TelemetryLive: Layer.Layer<Telemetry, never, never> = Layer.effect(Telemetry)(
  makeTelemetry().pipe(Effect.orDie)
)

const coreServicesLayer: Layer.Layer<never, Config.ConfigError, never> = Layer.mergeAll(
  ResourceRegistryLive,
  TelemetryLive,
  Reactivity.layer,
  DesktopLoggerLayer,
  WorkflowEngine.layerMemory
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

interface RuntimeProviderDescriptor {
  readonly id: DesktopRuntimeProviderId
  readonly node: DesktopRuntimeGraphNode
  readonly budget: DesktopProviderBudget
}

const RuntimeProviders = Object.freeze({
  bun: Object.freeze({
    id: "bun" as const,
    budget: providerBudget("bun", "@effect/platform-bun", "@effect-desktop/core/providers/bun"),
    node: graphNode(
      "provider:runtime:bun",
      "provider",
      "Bun runtime provider",
      RuntimeProviderServiceNames,
      []
    )
  }),
  node: Object.freeze({
    id: "node" as const,
    budget: providerBudget(
      "node",
      "@effect/platform-node",
      "@effect-desktop/core/providers/node"
    ),
    node: graphNode(
      "provider:runtime:node",
      "provider",
      "Node runtime provider",
      RuntimeProviderServiceNames,
      []
    )
  }),
  test: Object.freeze({
    id: "test" as const,
    budget: providerBudget("test", "@effect-desktop/core", "@effect-desktop/core/providers/test"),
    node: graphNode(
      "provider:runtime:test",
      "provider",
      "Test runtime provider",
      RuntimeProviderServiceNames,
      []
    )
  })
}) satisfies Record<"bun" | "node" | "test", RuntimeProviderDescriptor>

export const make = <RIn = never, E = never>(
  config: DesktopMakeConfig<RIn, E>
): DesktopAppDescriptor<RIn, E> =>
  Object.freeze({
    _tag: "DesktopAppDescriptor" as const,
    id: config.id ?? "app",
    windows: freezeWindows(config.windows),
    rpcs: freezeArray(config.rpcs),
    permissions: freezeArray(config.permissions),
    workflows: freezeArray(config.workflows),
    ...(config.providers === undefined ? {} : { providers: freezeObject(config.providers) })
  })

export const manifest = (config: DesktopManifestSource): DesktopAppManifest =>
  Object.freeze({
    _tag: "DesktopAppManifest" as const,
    id: config.id,
    windows: config.windows,
    rpcGroups: Object.freeze(
      (config.rpcs ?? []).map((rpcLayer) => {
        const servedGroup = servedRpcGroup(rpcLayer)
        return Object.freeze({
          _tag: "DesktopRpcGroup" as const,
          group: rpcLayer.group,
          ...servedRpcGroupProperties(rpcLayer.group, servedGroup)
        })
      })
    )
  })

export const Rpcs = Object.freeze({
  layer: <Rpcs extends Rpc.Any, E, R>(
    group: RpcGroup.RpcGroup<Rpcs>,
    layer: Layer.Layer<Rpc.ToHandler<Rpcs>, E, R>
  ): DesktopRpcLayer<Rpcs, E, R> =>
    Object.freeze({
      _tag: "DesktopRpcsLayer" as const,
      group,
      layer
    })
})

export const app = <RIn = never, E = never>(
  config: DesktopConfig<RIn, E>
): Layer.Layer<DesktopApp, DesktopConfigError | E, Exclude<RIn, DesktopRuntimeProviderServices>> =>
  runtime(config) as Layer.Layer<
    DesktopApp,
    DesktopConfigError | E,
    Exclude<RIn, DesktopRuntimeProviderServices>
  >

export const runtime = <RIn = never, E = never>(
  config: DesktopConfig<RIn, E>
): Layer.Layer<
  DesktopRuntimeServices,
  DesktopConfigError | E,
  Exclude<RIn, DesktopRuntimeProviderServices>
> => {
  const validationLayer = Layer.effectDiscard(checkPermissions(config))
  const spine = buildSpine(config)
  return Layer.provideMerge(validationLayer, spine) as Layer.Layer<
    DesktopRuntimeServices,
    DesktopConfigError | E,
    Exclude<RIn, DesktopRuntimeProviderServices>
  >
}

export const DesktopRuntimeLive = runtime

export const runtimeGraph = <RIn, E>(
  config: DesktopConfig<RIn, E>
): Effect.Effect<DesktopRuntimeGraph, DesktopConfigError, never> =>
  resolveRuntimeProvider(config).pipe(Effect.map((provider) => makeRuntimeGraph(config, provider)))

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
  provider: RuntimeProviderDescriptor
): DesktopRuntimeGraph => {
  const selected = Object.freeze({
    runtime: provider.id
  } satisfies DesktopRuntimeSelectedProviders)
  const rpcLayers = config.rpcs ?? []
  const nodes: DesktopRuntimeGraphNode[] = [
    provider.node,
    ...CoreServiceGraphNodes,
    ...rpcLayers.map((rpcLayer, index) => {
      const servedGroup = servedRpcGroup(rpcLayer)
      return graphNode(
        `rpc-layer:${index}`,
        "rpc-layer",
        `RPC layer ${Array.from(servedGroup.requests.keys()).join(", ")}`,
        Array.from(servedGroup.requests.keys()),
        ["RpcServer.Protocol"]
      )
    }),
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
  config: DesktopConfig<RIn, E>
): Effect.Effect<void, DesktopConfigError, never> => {
  const declared = config.permissions ?? []
  const rpcLayers = config.rpcs ?? []
  const seenRpcTags = new Set<string>()

  for (const rpcLayer of rpcLayers) {
    for (const [tag, rpc] of servedRpcGroup(rpcLayer).requests.entries()) {
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
    resolveRuntimeProvider(config).pipe(
      Effect.map((provider) => {
        const graph = makeRuntimeGraph(config, provider)
        const workflowLayers = config.workflows ?? []
        const rpcLayers = (config.rpcs ?? []).map((rpcLayer) => bindRpcLayer<E, RIn>(rpcLayer))

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
            windows: config.windows,
            rpcLayers: config.rpcs ?? []
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
  )

const resolveRuntimeProvider = <RIn, E>(
  config: DesktopConfig<RIn, E>
): Effect.Effect<
  RuntimeProviderDescriptor,
  DesktopConfigError,
  never
> => {
  const provider = selectedProviders(config.providers).runtime
  if (provider === "bun") {
    return Effect.succeed(RuntimeProviders.bun)
  }
  if (provider === "node") {
    return Effect.succeed(RuntimeProviders.node)
  }
  if (provider === "test") {
    return Effect.succeed(RuntimeProviders.test)
  }
  return Effect.fail(
    new DesktopConfigError({
      appId: config.id,
      reason: "missing-provider",
      message: `Runtime provider "${provider}" is not available`,
      provider
    })
  )
}

export const providerLayerFor = (
  choice: DesktopRuntimeSelectedProviders
): Layer.Layer<DesktopRuntimeProviderServices, Config.ConfigError | DesktopConfigError, never> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const provider = choice.runtime
      switch (provider) {
        case "bun": {
          const module = yield* Effect.promise(() => import("../providers/bun.js"))
          return module.BunRuntimeProviderLayer
        }
        case "node": {
          const module = yield* Effect.promise(() => import("../providers/node.js"))
          return module.NodeRuntimeProviderLayer
        }
        case "test": {
          const module = yield* Effect.promise(() => import("../providers/test.js"))
          return module.TestRuntimeProviderLayer
        }
        default:
          return yield* Effect.fail(
            new DesktopConfigError({
              appId: "provider-loader",
              reason: "missing-provider",
              message: `Runtime provider "${provider}" is not available`,
              provider
            })
          )
      }
    })
  )

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

const bindRpcLayer = <E, R>(
  rpcLayer: AnyDesktopRpcLayer<E, R>
): Layer.Layer<never, E, R> =>
  Layer.provide(
    RpcServer.layer(
      (servedRpcGroup(rpcLayer) as RpcGroup.RpcGroup<Rpc.Any>).middleware(PermissionInterceptor)
    ),
    rpcLayer.layer as Layer.Layer<unknown, E, R>
  ) as Layer.Layer<never, E, R>

const freezeArray = <A>(values: ReadonlyArray<A> | undefined): ReadonlyArray<A> =>
  Object.freeze([...(values ?? [])])

const freezeObject = <A extends object>(value: A): A => Object.freeze({ ...value }) as A

const freezeWindows = (
  windows: Readonly<Record<string, WindowSpec>>
): Readonly<Record<string, WindowSpec>> =>
  Object.freeze(
    Object.fromEntries(Object.entries(windows).map(([name, spec]) => [name, Object.freeze(spec)]))
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
