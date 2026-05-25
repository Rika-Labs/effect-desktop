import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  type HostProtocolError,
  makeDesktopClientProtocol,
  makeUnaryDesktopTransportFromBridgeClientExchange,
  type RpcCapabilityMetadata
} from "@orika/bridge"
import {
  type AnyDesktopNativeRegistration,
  DesktopRpc,
  type DesktopRpcBoundServerRequirements,
  type DesktopRpcCapabilityFact,
  type DesktopRpcClient,
  type DesktopNativeSurfaceSelection,
  type DesktopRpcSurface,
  type DesktopRpcSurfaceDirectOptions,
  type DesktopRpcSurfaceMappedOptions,
  NormalizedCapability as NormalizedCapabilitySchema,
  type NormalizedCapability,
  PermissionInterceptor
} from "@orika/core"
import { Context, Effect, Layer, Option, Schema, SchemaAST, Stream } from "effect"
import type { Scope } from "effect"
import { Rpc, RpcClient, RpcGroup } from "effect/unstable/rpc"

import { subscribeNativeEvent } from "./event-stream.js"
import {
  nativeAuthority,
  nativeCapabilityFact,
  nativeEvent,
  type NativeCapabilityFactOptions,
  type NativeEventOptions,
  type NativeEventRpc as NativeDescriptorEventRpc,
  nativeRpc as rpc,
  NativeRpcSupport
} from "./native-rpc-descriptor.js"
import {
  makeNativeHostRpcRuntime,
  type NativeHostRpcRuntimeEnvironment
} from "./native-rpc-runtime.js"

type NativeRpcGroup<Rpcs extends Rpc.AnyWithProps> = RpcGroup.RpcGroup<Rpcs> & {
  readonly requests: ReadonlyMap<string, Rpcs>
}

type PermissionedNativeRpcs<Rpcs extends Rpc.Any> = Rpc.AddMiddleware<
  Rpcs,
  typeof PermissionInterceptor
>

export type NativeRpcHandlers<Group extends RpcGroup.Any, R = never> = {
  readonly [Current in PermissionedNativeRpcs<
    RpcGroup.Rpcs<Group>
  > as Current["_tag"]]: Rpc.ToHandlerFn<Current, R>
}

type NativeRpcHandlerRequirements<Group extends RpcGroup.Any, R> =
  | Exclude<R, Scope.Scope>
  | RpcGroup.HandlersServices<
      PermissionedNativeRpcs<RpcGroup.Rpcs<Group>>,
      NativeRpcHandlers<Group, R>
    >

export type NativeSurfaceSelection<
  E = unknown,
  ServerR = unknown,
  HandlerR = unknown
> = DesktopNativeSurfaceSelection<E, ServerR, HandlerR>

export type NativeSurfaceApi<
  E = unknown,
  ServerR = unknown,
  HandlerR = unknown
> = NativeSurfaceSelection<E, ServerR, HandlerR>

export type NativePermissionsApi<Method extends string = never> = Readonly<
  Record<Method, NormalizedCapability> & {
    readonly all: readonly NormalizedCapability[]
  }
>

export interface NativeRpcSurfaceSelectionOptions<Method extends string = never> {
  readonly capabilities?: readonly Method[]
}

export interface NativeRpcSurfaceBridgeClientOptions<Rpcs extends Rpc.AnyWithProps, Service> {
  readonly bridgeClient?: (
    client: DesktopRpcClient<Rpcs>,
    exchange: BridgeClientExchange
  ) => Service
}

export interface NativeRpcSurface<
  Tag extends string,
  Group extends NativeRpcGroup<Rpcs>,
  Rpcs extends Rpc.AnyWithProps,
  ServiceId,
  ServerE,
  ServerR,
  Method extends string = never
> extends DesktopRpcSurface<Tag, Group, Rpcs, ServiceId, ServerE, ServerR> {
  readonly selection: NativeSurfaceApi<
    ServerE,
    DesktopRpcBoundServerRequirements<Rpcs, ServerR>,
    ServerR
  >
  readonly permissions: NativePermissionsApi<Method>
  readonly bridgeClientLayer: (
    exchange: BridgeClientExchange,
    options?: BridgeClientOptions
  ) => Layer.Layer<ServiceId>
  readonly hostRuntime: <R = never>(
    handlers: NativeRpcHandlers<Group, R>,
    runtimeOptions?: BridgeHandlerRuntimeOptions
  ) => BridgeHandlerRuntime<
    NativeHostRpcRuntimeEnvironment<Rpcs, NativeRpcHandlerRequirements<Group, R>>
  >
}

export type NativeEventRpc<
  Surface extends string = string,
  EventName extends string = string,
  Payload extends Schema.Codec<unknown, unknown, never, never> = Schema.Codec<
    unknown,
    unknown,
    never,
    never
  >
> = NativeDescriptorEventRpc<Surface, EventName, Payload>

const capabilityFact = <const Surface extends string, const Method extends string>(
  surface: Surface,
  method: Method,
  options: NativeCapabilityFactOptions
): DesktopRpcCapabilityFact => nativeCapabilityFact(surface, method, options)

const event = <
  const Surface extends string,
  const EventName extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>
>(
  surface: Surface,
  eventName: EventName,
  options: NativeEventOptions<Payload>
): NativeEventRpc<Surface, EventName, Payload> => nativeEvent(surface, eventName, options)

function make<
  const Tag extends string,
  Rpcs extends Rpc.AnyWithProps,
  Group extends NativeRpcGroup<Rpcs>,
  ServiceId,
  ServerE,
  ServerR,
  const Method extends string = never
>(
  tag: Tag,
  group: NativeRpcGroup<Rpcs> & Group,
  options: DesktopRpcSurfaceDirectOptions<Rpcs, ServiceId, ServerE, ServerR> &
    NativeRpcSurfaceSelectionOptions<Method>
): NativeRpcSurface<Tag, Group, Rpcs, ServiceId, ServerE, ServerR, Method>
function make<
  const Tag extends string,
  Rpcs extends Rpc.AnyWithProps,
  Group extends NativeRpcGroup<Rpcs>,
  ServiceId,
  Service,
  ServerE,
  ServerR,
  const Method extends string = never
>(
  tag: Tag,
  group: NativeRpcGroup<Rpcs> & Group,
  options: DesktopRpcSurfaceMappedOptions<Rpcs, ServiceId, Service, ServerE, ServerR> &
    NativeRpcSurfaceSelectionOptions<Method> &
    NativeRpcSurfaceBridgeClientOptions<Rpcs, Service>
): NativeRpcSurface<Tag, Group, Rpcs, ServiceId, ServerE, ServerR, Method>
function make<
  const Tag extends string,
  Rpcs extends Rpc.AnyWithProps,
  Group extends NativeRpcGroup<Rpcs>,
  ServiceId,
  Service,
  ServerE,
  ServerR,
  const Method extends string = never
>(
  tag: Tag,
  group: NativeRpcGroup<Rpcs> & Group,
  options:
    | (DesktopRpcSurfaceDirectOptions<Rpcs, ServiceId, ServerE, ServerR> &
        NativeRpcSurfaceSelectionOptions<Method>)
    | (DesktopRpcSurfaceMappedOptions<Rpcs, ServiceId, Service, ServerE, ServerR> &
        NativeRpcSurfaceSelectionOptions<Method> &
        NativeRpcSurfaceBridgeClientOptions<Rpcs, Service>)
): NativeRpcSurface<Tag, Group, Rpcs, ServiceId, ServerE, ServerR, Method> {
  const hostRuntime = <R = never>(
    handlers: NativeRpcHandlers<Group, R>,
    runtimeOptions: BridgeHandlerRuntimeOptions = {}
  ): BridgeHandlerRuntime<
    NativeHostRpcRuntimeEnvironment<Rpcs, NativeRpcHandlerRequirements<Group, R>>
  > =>
    makeNativeHostRpcRuntime(
      group,
      group.middleware(PermissionInterceptor).toLayer(handlers),
      runtimeOptions
    )

  const makeSurface = <SurfaceService>(
    service: Context.Key<ServiceId, SurfaceService>,
    desktopSurface: DesktopRpcSurface<Tag, Group, Rpcs, ServiceId, ServerE, ServerR>,
    toBridgeService: (
      client: DesktopRpcClient<Rpcs>,
      exchange: BridgeClientExchange
    ) => SurfaceService
  ): NativeRpcSurface<Tag, Group, Rpcs, ServiceId, ServerE, ServerR, Method> => {
    const surfaceWithoutSelection = Object.freeze({
      ...desktopSurface,
      bridgeClientLayer: (
        exchange: BridgeClientExchange,
        bridgeOptions: BridgeClientOptions = {}
      ) =>
        Layer.effect(
          service,
          RpcClient.make(group).pipe(Effect.map((client) => toBridgeService(client, exchange)))
        ).pipe(Layer.provide(makeBridgeProtocolLayer(exchange, bridgeOptions))),
      hostRuntime
    })

    return Object.freeze({
      ...surfaceWithoutSelection,
      selection: surfaceSelection(surfaceWithoutSelection),
      permissions: nativeSurfacePermissions(surfaceWithoutSelection, options.capabilities ?? [])
    })
  }

  if ("client" in options) {
    const bridgeClient = options.bridgeClient
    return makeSurface(
      options.service,
      DesktopRpc.surface(tag, group, options),
      bridgeClient === undefined
        ? (client) => options.client(client)
        : (client, exchange) => bridgeClient(client, exchange)
    )
  }

  return makeSurface(options.service, DesktopRpc.surface(tag, group, options), (client) => client)
}

const makeBridgeProtocolLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): Layer.Layer<RpcClient.Protocol> =>
  Layer.effect(RpcClient.Protocol)(
    makeUnaryDesktopTransportFromBridgeClientExchange(exchange, options).pipe(
      Effect.flatMap((transport) => makeDesktopClientProtocol(transport, options))
    )
  )

const EventTagSeparator = ".events."
const StrictEventParseOptions = { onExcessProperty: "error" } as const

const subscribeEvent = <
  const Surface extends string,
  const EventName extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>
>(
  exchange: BridgeClientExchange | undefined,
  eventRpc: NativeEventRpc<Surface, EventName, Payload>,
  parseOptions: SchemaAST.ParseOptions = StrictEventParseOptions
): Stream.Stream<Payload["Type"], HostProtocolError, never> =>
  subscribeNativeEvent(
    exchange,
    eventMethodFromRpcTag(eventRpc._tag),
    eventRpc.successSchema.success,
    parseOptions
  )

const eventMethodFromRpcTag = (tag: `${string}.events.${string}`): string => {
  const separatorIndex = tag.indexOf(EventTagSeparator)
  return `${tag.slice(0, separatorIndex)}.${tag.slice(separatorIndex + EventTagSeparator.length)}`
}

const nativeSurfacePermissions = <const Method extends string, E, ServerR, HandlerR>(
  registration: AnyDesktopNativeRegistration<E, ServerR, HandlerR>,
  capabilities: readonly Method[]
): NativePermissionsApi<Method> => {
  const permissions: Record<Method, NormalizedCapability> = {} as Record<
    Method,
    NormalizedCapability
  >
  for (const method of capabilities) {
    permissions[method] = permissionCapability(registration, method)
  }

  return Object.freeze({
    ...permissions,
    all: allPermissionCapabilities([registration])
  })
}

const surfaceSelection = <E, ServerR, HandlerR>(
  registration: AnyDesktopNativeRegistration<E, ServerR, HandlerR>
): NativeSurfaceSelection<E, ServerR, HandlerR> =>
  Object.freeze({
    _tag: "NativeSurfaceSelection" as const,
    surfaces: Object.freeze([registration])
  })

const permissionCapability = (
  registration: AnyDesktopNativeRegistration,
  method: string
): NormalizedCapability => {
  const capability = permissionCapabilitiesByMethod(registration).get(method)
  if (capability === undefined) {
    throw new TypeError(
      `Native.${registration.tag} cannot expose capability for unprivileged or unknown method ${JSON.stringify(method)}`
    )
  }
  return capability
}

const isRpcCapabilityMetadata = (value: unknown): value is RpcCapabilityMetadata =>
  typeof value === "object" &&
  value !== null &&
  "kind" in value &&
  typeof (value as { readonly kind?: unknown }).kind === "string"

const allPermissionCapabilities = (
  surfaces: readonly AnyDesktopNativeRegistration[]
): readonly NormalizedCapability[] => {
  const permissions: NormalizedCapability[] = []
  const seen = new Set<string>()

  for (const nativeSurface of surfaces) {
    for (const doc of nativeSurface.schemaDocs) {
      if (!doc.callable) {
        continue
      }
      const capability = Option.getOrUndefined(doc.capability)
      if (capability === undefined) {
        continue
      }
      if (!isRpcCapabilityMetadata(capability)) {
        throw new TypeError(
          `Native.${nativeSurface.tag} cannot declare invalid capability metadata for ${doc.tag}`
        )
      }
      if (capability.kind === "none") {
        continue
      }

      const decoded = Schema.decodeUnknownOption(NormalizedCapabilitySchema)(capability)
      if (Option.isNone(decoded)) {
        throw new TypeError(
          `Native.${nativeSurface.tag} cannot declare non-normalized capability metadata for ${doc.tag}: ${capability.kind}`
        )
      }

      const key = JSON.stringify(decoded.value)
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      permissions.push(decoded.value)
    }
  }

  return Object.freeze(permissions)
}

const permissionCapabilitiesByMethod = (
  surfaceRegistration: AnyDesktopNativeRegistration
): ReadonlyMap<string, NormalizedCapability> => {
  const capabilities = new Map<string, NormalizedCapability>()

  for (const doc of surfaceRegistration.schemaDocs) {
    if (!doc.callable) {
      continue
    }
    const method = methodNameFromTag(surfaceRegistration.tag, doc.tag)
    const capability = Option.getOrUndefined(doc.capability)
    if (capability === undefined) {
      continue
    }
    if (!isRpcCapabilityMetadata(capability)) {
      throw new TypeError(
        `Native.${surfaceRegistration.tag} cannot declare invalid capability metadata for ${doc.tag}`
      )
    }
    if (capability.kind === "none") {
      continue
    }

    const decoded = Schema.decodeUnknownOption(NormalizedCapabilitySchema)(capability)
    if (Option.isNone(decoded)) {
      throw new TypeError(
        `Native.${surfaceRegistration.tag} cannot declare non-normalized capability metadata for ${doc.tag}: ${capability.kind}`
      )
    }

    capabilities.set(method, decoded.value)
  }

  return capabilities
}

const methodNameFromTag = (surfaceTag: string, tag: string): string => {
  const prefix = `${surfaceTag}.`
  return tag.startsWith(prefix) ? tag.slice(prefix.length) : tag
}

export const NativeSurface = Object.freeze({
  authority: nativeAuthority,
  capabilityFact,
  event,
  make,
  rpc,
  subscribeEvent,
  support: NativeRpcSupport
})
