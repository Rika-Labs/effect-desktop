import { Config, Context, Data, Effect, Layer, Option, Schema } from "effect"
import { Rpc, RpcGroup, RpcServer } from "effect/unstable/rpc"

import { rpcCapability, type ApiContractClass, type ApiContractSpec } from "@effect-desktop/bridge"

import { DesktopLoggerLayer } from "./logger.js"
import { BunServicesLayer } from "./platform.js"
import {
  NormalizedCapability as NormalizedCapabilitySchema,
  PermissionRegistry,
  capabilityCovers,
  makePermissionRegistry
} from "./permission-registry.js"
import type { NormalizedCapability } from "./permission-registry.js"
import { ReactivityLayer } from "./reactivity.js"
import { ResourceRegistryLive } from "./resources.js"
import { Telemetry, makeTelemetry } from "./telemetry.js"
import { WorkflowEngineLive } from "./workflow.js"
import type { WorkflowLayer } from "./workflow.js"

export interface WindowSpec {
  readonly title: string
  readonly width?: number
  readonly height?: number
  readonly renderer?: string
}

export interface AnyApiLayer {
  readonly contract: ApiContractClass<string, ApiContractSpec>
  readonly handlers: object
}

export interface DesktopConfig<RIn = never, E = never> {
  readonly id: string
  readonly windows: Readonly<Record<string, WindowSpec>>
  readonly handlers?: ReadonlyArray<AnyApiLayer>
  readonly layers?: ReadonlyArray<Layer.Layer<unknown, E, RIn>>
  readonly rpcs?: ReadonlyArray<AnyDesktopRpcLayer>
  readonly permissions?: ReadonlyArray<NormalizedCapability>
  readonly workflows?: ReadonlyArray<WorkflowLayer>
}

export interface DesktopMakeConfig {
  readonly id?: string
  readonly windows: Readonly<Record<string, WindowSpec>>
  readonly permissions?: ReadonlyArray<NormalizedCapability>
  readonly workflows?: ReadonlyArray<WorkflowLayer>
}

export interface DesktopAppDefinition<E = never, R = never> {
  readonly _tag: "DesktopAppDefinition"
  readonly id: string
  readonly windows: Readonly<Record<string, WindowSpec>>
  readonly layers: ReadonlyArray<Layer.Layer<unknown, E, R>>
  readonly rpcLayers: ReadonlyArray<AnyDesktopRpcLayer>
  readonly permissions: ReadonlyArray<NormalizedCapability>
  readonly workflows: ReadonlyArray<WorkflowLayer>
  pipe(): DesktopAppDefinition<E, R>
  pipe<A>(ab: (self: DesktopAppDefinition<E, R>) => A): A
  pipe<A, B>(ab: (self: DesktopAppDefinition<E, R>) => A, bc: (a: A) => B): B
  pipe<A, B, C>(ab: (self: DesktopAppDefinition<E, R>) => A, bc: (a: A) => B, cd: (b: B) => C): C
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

export interface AnyDesktopRpcLayer {
  readonly _tag: "DesktopRpcsLayer"
  readonly group: RpcGroup.Any & { readonly requests: ReadonlyMap<string, Rpc.Any> }
  readonly layer: Layer.Layer<unknown, unknown, unknown>
}

export class DesktopConfigError extends Data.TaggedError("DesktopConfigError")<{
  readonly appId: string
  readonly reason: "missing-permission" | "invalid-config" | "duplicate-rpc"
  readonly message: string
  readonly contract?: string
  readonly method?: string
  readonly permission?: string
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
  readonly rpcLayers: ReadonlyArray<AnyDesktopRpcLayer>
}

export class DesktopApp extends Context.Service<DesktopApp, DesktopAppApi>()("DesktopApp") {}

const TelemetryLive: Layer.Layer<Telemetry, never, never> = Layer.effect(Telemetry)(
  makeTelemetry().pipe(Effect.orDie)
)

const PermissionRegistryLive: Layer.Layer<PermissionRegistry, never, never> =
  Layer.effect(PermissionRegistry)(makePermissionRegistry())

const coreServicesLayer: Layer.Layer<never, Config.ConfigError, never> = Layer.mergeAll(
  ResourceRegistryLive,
  TelemetryLive,
  PermissionRegistryLive,
  ReactivityLayer,
  DesktopLoggerLayer,
  BunServicesLayer,
  WorkflowEngineLive
)

export const make = (config: DesktopMakeConfig): DesktopAppDefinition<never, never> =>
  makeDefinition({
    id: config.id ?? "app",
    windows: freezeWindows(config.windows),
    layers: Object.freeze([]),
    rpcLayers: Object.freeze([]),
    permissions: freezeArray(config.permissions),
    workflows: freezeArray(config.workflows)
  })

export const manifest = <E, R>(definition: DesktopAppDefinition<E, R>): DesktopAppManifest =>
  Object.freeze({
    _tag: "DesktopAppManifest" as const,
    id: definition.id,
    windows: definition.windows,
    rpcGroups: Object.freeze(
      definition.rpcLayers.map((rpcLayer) =>
        Object.freeze({
          _tag: "DesktopRpcGroup" as const,
          group: rpcLayer.group
        })
      )
    )
  })

export function provide<Provided, E, R>(
  layer: Layer.Layer<Provided, E, R>
): <AppE, AppR>(
  definition: DesktopAppDefinition<AppE, AppR>
) => DesktopAppDefinition<E | AppE, R | AppR>
export function provide<Rpcs extends Rpc.Any, E, R>(
  rpcLayer: DesktopRpcLayer<Rpcs, E, R>
): <AppE, AppR>(
  definition: DesktopAppDefinition<AppE, AppR>
) => DesktopAppDefinition<E | AppE, R | AppR>
export function provide(
  provided: unknown
): (definition: DesktopAppDefinition<unknown, unknown>) => DesktopAppDefinition<unknown, unknown> {
  return (definition) =>
    isDesktopRpcLayer(provided)
      ? appendRpcLayer(definition, provided)
      : appendLayer(definition, provided as Layer.Layer<unknown, unknown, unknown>)
}

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

const appendLayer = <E, R, AppE, AppR>(
  definition: DesktopAppDefinition<AppE, AppR>,
  layer: Layer.Layer<unknown, E, R>
): DesktopAppDefinition<E | AppE, R | AppR> =>
  makeDefinition({
    id: definition.id,
    windows: definition.windows,
    layers: Object.freeze([
      ...definition.layers,
      layer as Layer.Layer<unknown, E | AppE, R | AppR>
    ]),
    rpcLayers: definition.rpcLayers,
    permissions: definition.permissions,
    workflows: definition.workflows
  })

const appendRpcLayer = <E, R, AppE, AppR>(
  definition: DesktopAppDefinition<AppE, AppR>,
  rpcLayer: AnyDesktopRpcLayer
): DesktopAppDefinition<E | AppE, R | AppR> =>
  makeDefinition({
    id: definition.id,
    windows: definition.windows,
    layers: definition.layers as ReadonlyArray<Layer.Layer<unknown, E | AppE, R | AppR>>,
    rpcLayers: Object.freeze([...definition.rpcLayers, rpcLayer as unknown as AnyDesktopRpcLayer]),
    permissions: definition.permissions,
    workflows: definition.workflows
  })

export const toLayer = <E, R>(
  definition: DesktopAppDefinition<E, R>
): Layer.Layer<DesktopApp, DesktopConfigError | E, R> =>
  app({
    id: definition.id,
    windows: definition.windows,
    layers: definition.layers,
    rpcs: definition.rpcLayers,
    permissions: definition.permissions,
    workflows: definition.workflows
  })

export const app = <RIn = never, E = never>(
  config: DesktopConfig<RIn, E>
): Layer.Layer<DesktopApp, DesktopConfigError | E, RIn> => {
  const normalized = normalizeDesktopConfig(config)
  const validationLayer = Layer.effectDiscard(checkPermissions(normalized))
  const spine = buildSpine(normalized)
  return Layer.provideMerge(validationLayer, spine) as unknown as Layer.Layer<
    DesktopApp,
    DesktopConfigError | E,
    RIn
  >
}

export const launch = (
  layer: Layer.Layer<DesktopApp, DesktopConfigError, never>
): Effect.Effect<never, DesktopConfigError, never> => Layer.launch(layer)

const normalizeDesktopConfig = <RIn, E>(config: DesktopConfig<RIn, E>): DesktopConfig<RIn, E> => {
  const handlers = config.handlers ?? []
  if (handlers.length === 0) {
    return config
  }

  return {
    id: config.id,
    windows: config.windows,
    ...(config.layers === undefined ? {} : { layers: config.layers }),
    ...(config.permissions === undefined ? {} : { permissions: config.permissions }),
    ...(config.workflows === undefined ? {} : { workflows: config.workflows }),
    rpcs: Object.freeze([...handlers.map(apiLayerToRpcLayer), ...(config.rpcs ?? [])])
  }
}

const apiLayerToRpcLayer = (apiLayer: AnyApiLayer): AnyDesktopRpcLayer => {
  const eventTags = Object.keys(apiLayer.contract.events ?? {}).map(
    (event) => `${apiLayer.contract.tag}.events.${event}`
  )
  const fullGroup = apiLayer.contract.toRpcGroup()
  const group =
    eventTags.length === 0
      ? fullGroup
      : fullGroup.omit(...(eventTags as unknown as ReadonlyArray<never>))
  const handlers: Record<string, (input: unknown) => unknown> = Object.create(null) as Record<
    string,
    (input: unknown) => unknown
  >

  for (const method of Object.keys(apiLayer.contract.spec)) {
    const rpcTag = `${apiLayer.contract.tag}.${method}`
    const handler = Reflect.get(apiLayer.handlers, method)
    handlers[rpcTag] =
      typeof handler === "function"
        ? (input: unknown): unknown => handler.call(apiLayer.handlers, input)
        : (): Effect.Effect<never> => Effect.die(`Legacy API handler is missing for ${rpcTag}`)
  }

  return Rpcs.layer(
    group,
    group.toLayer(Object.freeze(handlers) as never)
  ) as unknown as AnyDesktopRpcLayer
}

const checkPermissions = <RIn, E>(
  config: DesktopConfig<RIn, E>
): Effect.Effect<void, DesktopConfigError, never> => {
  const declared = config.permissions ?? []
  const handlers = config.handlers ?? []
  const rpcLayers = config.rpcs ?? []
  const seenRpcTags = new Set<string>()

  for (const rpcLayer of rpcLayers) {
    for (const [tag, rpc] of rpcLayer.group.requests.entries()) {
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
      if (Option.isNone(required)) {
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

  for (const apiLayer of handlers) {
    for (const [method, spec] of Object.entries(apiLayer.contract.spec)) {
      const required = spec.permission
      if (required === undefined) {
        continue
      }

      const covered = declared.some((cap) => cap.kind === required)
      if (!covered) {
        return Effect.fail(
          new DesktopConfigError({
            appId: config.id,
            reason: "missing-permission",
            message: `RPC method "${apiLayer.contract.tag}.${method}" requires capability "${required}" but it is not declared in config.permissions`,
            contract: apiLayer.contract.tag,
            method,
            permission: required
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
      message: `RPC method "${method}" requires legacy capability "${value.kind}" but it is not declared in config.permissions`,
      method,
      permission: value.kind
    })
  )
}

const buildSpine = <RIn, E>(config: DesktopConfig<RIn, E>): Layer.Layer<DesktopApp, E, RIn> => {
  const wfs = config.workflows ?? []
  const rpcLayers = (config.rpcs ?? []).map((rpcLayer) => bindRpcLayer<E, RIn>(rpcLayer))
  const userLayers = [...(config.layers ?? []), ...rpcLayers]

  const workflowLayer: Layer.Layer<never, never, never> =
    wfs.length === 0
      ? Layer.empty
      : wfs.reduce<Layer.Layer<never, never, never>>(
          (acc, wf) => Layer.merge(acc, wf as Layer.Layer<never, never, never>),
          Layer.empty
        )

  const baseServices: Layer.Layer<never, Config.ConfigError, never> = Layer.merge(
    coreServicesLayer,
    workflowLayer
  )

  const services: Layer.Layer<never, E, RIn> =
    userLayers.length === 0
      ? (baseServices as unknown as Layer.Layer<never, E, RIn>)
      : userLayers.reduce<Layer.Layer<never, E, RIn>>(
          (acc, layer) => Layer.merge(acc, layer as Layer.Layer<never, E, RIn>),
          baseServices as unknown as Layer.Layer<never, E, RIn>
        )

  const desktopAppLayer: Layer.Layer<DesktopApp, never, never> = Layer.effect(DesktopApp)(
    Effect.succeed({
      appId: config.id,
      windows: config.windows,
      rpcLayers: config.rpcs ?? []
    })
  )

  return Layer.provideMerge(desktopAppLayer, services)
}

const bindRpcLayer = <E, R>(rpcLayer: AnyDesktopRpcLayer): Layer.Layer<never, E, R> =>
  Layer.provide(
    RpcServer.layer(rpcLayer.group as RpcGroup.RpcGroup<Rpc.Any>),
    rpcLayer.layer as Layer.Layer<unknown, E, R>
  ) as unknown as Layer.Layer<never, E, R>

const makeDefinition = <E, R>(definition: {
  readonly id: string
  readonly windows: Readonly<Record<string, WindowSpec>>
  readonly layers: ReadonlyArray<Layer.Layer<unknown, E, R>>
  readonly rpcLayers: ReadonlyArray<AnyDesktopRpcLayer>
  readonly permissions: ReadonlyArray<NormalizedCapability>
  readonly workflows: ReadonlyArray<WorkflowLayer>
}): DesktopAppDefinition<E, R> =>
  Object.freeze({
    _tag: "DesktopAppDefinition" as const,
    id: definition.id,
    windows: definition.windows,
    layers: definition.layers,
    rpcLayers: definition.rpcLayers,
    permissions: definition.permissions,
    workflows: definition.workflows,
    pipe(...operations: ReadonlyArray<(value: unknown) => unknown>): unknown {
      if (operations.length === 0) {
        return this
      }
      return operations.reduce<unknown>((value, operation) => operation(value), this)
    }
  }) as DesktopAppDefinition<E, R>

const freezeArray = <A>(values: ReadonlyArray<A> | undefined): ReadonlyArray<A> =>
  Object.freeze([...(values ?? [])])

const freezeWindows = (
  windows: Readonly<Record<string, WindowSpec>>
): Readonly<Record<string, WindowSpec>> =>
  Object.freeze(
    Object.fromEntries(Object.entries(windows).map(([name, spec]) => [name, Object.freeze(spec)]))
  )

const isDesktopRpcLayer = (value: unknown): value is AnyDesktopRpcLayer =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  (value as { readonly _tag?: unknown })._tag === "DesktopRpcsLayer"
