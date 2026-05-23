import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  type HostProtocolError,
  HostProtocolError as HostProtocolErrorSchema,
  makeDesktopClientProtocol,
  makeUnaryDesktopTransportFromBridgeClientExchange,
  RpcCapability,
  type RpcCapabilityMetadata,
  RpcEndpoint,
  type RpcEndpointKind,
  type RpcPlatformSupportMetadata,
  RpcSupport,
  type RpcSupportMetadata
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
  P,
  type PermissionRegistry
} from "@orika/core"
import { Context, Effect, Layer, Option, Schema, SchemaAST, Stream } from "effect"
import { Rpc, RpcClient, RpcGroup, RpcSchema } from "effect/unstable/rpc"

import { subscribeNativeEvent } from "./event-stream.js"
import { makeNativeHostRpcRuntime } from "./native-rpc-runtime.js"

type NativeRpcGroup<Rpcs extends Rpc.Any> = RpcGroup.RpcGroup<Rpcs> & {
  readonly requests: ReadonlyMap<string, Rpcs>
}

type NativeRpcHandlers<Group extends RpcGroup.Any> = RpcGroup.HandlersFrom<RpcGroup.Rpcs<Group>>

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

export type NativeRpcAuthority =
  | {
      readonly kind: "native"
      readonly primitive?: string
    }
  | {
      readonly kind: "none"
    }
  | {
      readonly kind: "custom"
      readonly capability: Parameters<typeof RpcCapability>[0]
    }

export interface NativeRpcOptions<
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
> {
  readonly payload: Payload
  readonly success: Success
  readonly authority: NativeRpcAuthority
  readonly endpoint: RpcEndpointKind
  readonly support: RpcSupportMetadata
}

export interface NativeEventOptions<Payload extends Schema.Codec<unknown, unknown, never, never>> {
  readonly payload: Payload
  readonly support: RpcSupportMetadata
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
> = Rpc.Rpc<
  `${Surface}.events.${EventName}`,
  typeof Schema.Void,
  RpcSchema.Stream<Payload, typeof HostProtocolErrorSchema>,
  typeof Schema.Never
>

export interface NativeRpcSurfaceSelectionOptions<Method extends string = never> {
  readonly capabilities?: readonly Method[]
}

export interface NativeRpcSurfaceBridgeClientOptions<Rpcs extends Rpc.Any, Service> {
  readonly bridgeClient?: (
    client: DesktopRpcClient<Rpcs>,
    exchange: BridgeClientExchange
  ) => Service
}

export interface NativeRpcSurface<
  Tag extends string,
  Group extends NativeRpcGroup<Rpcs>,
  Rpcs extends Rpc.Any,
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
  readonly hostRuntime: (
    handlers: NativeRpcHandlers<Group>,
    runtimeOptions?: BridgeHandlerRuntimeOptions
  ) => BridgeHandlerRuntime<PermissionRegistry>
}

export const nativeAuthority = Object.freeze({
  native: (primitive?: string): NativeRpcAuthority =>
    primitive === undefined
      ? Object.freeze({ kind: "native" })
      : Object.freeze({ kind: "native", primitive }),
  none: Object.freeze({ kind: "none" } satisfies NativeRpcAuthority),
  custom: (capability: Parameters<typeof RpcCapability>[0]): NativeRpcAuthority =>
    Object.freeze({ kind: "custom", capability })
})

export const NativeRpcSupport = Object.freeze({
  supported: Object.freeze({ status: "supported" } satisfies RpcSupportMetadata),
  partial: (
    reason: string,
    options: { readonly platforms?: readonly RpcPlatformSupportMetadata[] } = {}
  ): RpcSupportMetadata => Object.freeze({ status: "partial", reason, ...options }),
  unsupported: (
    reason: string,
    options: { readonly platforms?: readonly RpcPlatformSupportMetadata[] } = {}
  ): RpcSupportMetadata => Object.freeze({ status: "unsupported", reason, ...options })
})

const rpc = <
  const Surface extends string,
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(
  surface: Surface,
  method: Method,
  options: NativeRpcOptions<Payload, Success>
) => {
  const base = Rpc.make(`${surface}.${method}` as const, {
    payload: options.payload,
    success: options.success,
    error: HostProtocolErrorSchema
  })

  return applySupport(
    applyCapability(applyEndpoint(base, options.endpoint), surface, method, options.authority),
    options.support
  )
}

const event = <
  const Surface extends string,
  const EventName extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>
>(
  surface: Surface,
  eventName: EventName,
  options: NativeEventOptions<Payload>
): NativeEventRpc<Surface, EventName, Payload> => {
  const base = Rpc.make(`${surface}.events.${eventName}` as const, {
    success: options.payload,
    error: HostProtocolErrorSchema,
    stream: true
  })

  return applySupport(
    applyCapability(base, surface, `events.${eventName}`, nativeAuthority.none),
    options.support
  )
}

export interface NativeCapabilityFactOptions {
  readonly authority: NativeRpcAuthority
  readonly support: RpcSupportMetadata
}

const capabilityFact = <const Surface extends string, const Method extends string>(
  surface: Surface,
  method: Method,
  options: NativeCapabilityFactOptions
): DesktopRpcCapabilityFact =>
  Object.freeze({
    tag: `${surface}.${method}` as const,
    capability: capabilityFor(surface, method, options.authority),
    support: options.support
  })

function make<
  const Tag extends string,
  Group extends RpcGroup.Any & NativeRpcGroup<RpcGroup.Rpcs<Group>>,
  ServiceId,
  ServerE,
  ServerR,
  const Method extends string = never
>(
  tag: Tag,
  group: Group,
  options: DesktopRpcSurfaceDirectOptions<RpcGroup.Rpcs<Group>, ServiceId, ServerE, ServerR> &
    NativeRpcSurfaceSelectionOptions<Method>
): NativeRpcSurface<Tag, Group, RpcGroup.Rpcs<Group>, ServiceId, ServerE, ServerR, Method>
function make<
  const Tag extends string,
  Group extends RpcGroup.Any & NativeRpcGroup<RpcGroup.Rpcs<Group>>,
  ServiceId,
  Service,
  ServerE,
  ServerR,
  const Method extends string = never
>(
  tag: Tag,
  group: Group,
  options: DesktopRpcSurfaceMappedOptions<
    RpcGroup.Rpcs<Group>,
    ServiceId,
    Service,
    ServerE,
    ServerR
  > &
    NativeRpcSurfaceSelectionOptions<Method> &
    NativeRpcSurfaceBridgeClientOptions<RpcGroup.Rpcs<Group>, Service>
): NativeRpcSurface<Tag, Group, RpcGroup.Rpcs<Group>, ServiceId, ServerE, ServerR, Method>
function make<
  const Tag extends string,
  Group extends RpcGroup.Any & NativeRpcGroup<RpcGroup.Rpcs<Group>>,
  ServiceId,
  Service,
  ServerE,
  ServerR,
  const Method extends string = never
>(
  tag: Tag,
  group: Group,
  options:
    | (DesktopRpcSurfaceDirectOptions<RpcGroup.Rpcs<Group>, ServiceId, ServerE, ServerR> &
        NativeRpcSurfaceSelectionOptions<Method>)
    | (DesktopRpcSurfaceMappedOptions<RpcGroup.Rpcs<Group>, ServiceId, Service, ServerE, ServerR> &
        NativeRpcSurfaceSelectionOptions<Method> &
        NativeRpcSurfaceBridgeClientOptions<RpcGroup.Rpcs<Group>, Service>)
): NativeRpcSurface<Tag, Group, RpcGroup.Rpcs<Group>, ServiceId, ServerE, ServerR, Method> {
  type Rpcs = RpcGroup.Rpcs<Group>
  const service = options.service as Context.Key<ServiceId, DesktopRpcClient<Rpcs> | Service>
  const toBridgeService = (
    client: DesktopRpcClient<Rpcs>,
    exchange: BridgeClientExchange
  ): DesktopRpcClient<Rpcs> | Service =>
    "bridgeClient" in options && options.bridgeClient !== undefined
      ? options.bridgeClient(client, exchange)
      : "client" in options
        ? options.client(client)
        : client
  const desktopSurface =
    "client" in options
      ? DesktopRpc.surface(tag, group, options)
      : DesktopRpc.surface(tag, group, options)

  const surfaceWithoutSelection = Object.freeze({
    ...desktopSurface,
    bridgeClientLayer: (exchange: BridgeClientExchange, bridgeOptions: BridgeClientOptions = {}) =>
      Layer.effect(
        service,
        RpcClient.make(group).pipe(Effect.map((client) => toBridgeService(client, exchange)))
      ).pipe(Layer.provide(makeBridgeProtocolLayer(exchange, bridgeOptions))),
    hostRuntime: (
      handlers: NativeRpcHandlers<Group>,
      runtimeOptions: BridgeHandlerRuntimeOptions = {}
    ) => makeNativeHostRpcRuntime(group, group.toLayer(handlers), runtimeOptions)
  })

  return Object.freeze({
    ...surfaceWithoutSelection,
    selection: surfaceSelection(surfaceWithoutSelection),
    permissions: nativeSurfacePermissions(surfaceWithoutSelection, options.capabilities ?? [])
  })
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

const applyEndpoint = <R extends Rpc.Any>(rpc: R, endpoint: RpcEndpointKind): R =>
  endpoint === "query" ? RpcEndpoint.query(rpc) : RpcEndpoint.mutation(rpc)

const applyCapability = <R extends Rpc.Any>(
  rpc: R,
  surface: string,
  method: string,
  authority: NativeRpcAuthority
): R => RpcCapability(capabilityFor(surface, method, authority))(rpc)

const applySupport = <R extends Rpc.Any>(rpc: R, support: RpcSupportMetadata): R =>
  support.status === "supported"
    ? RpcSupport.supported(
        rpc,
        support.platforms === undefined ? {} : { platforms: support.platforms }
      )
    : support.status === "partial"
      ? RpcSupport.partial(
          support.reason,
          support.platforms === undefined ? {} : { platforms: support.platforms }
        )(rpc)
      : RpcSupport.unsupported(
          support.reason,
          support.platforms === undefined ? {} : { platforms: support.platforms }
        )(rpc)

const capabilityFor = (
  surface: string,
  method: string,
  authority: NativeRpcAuthority
): Parameters<typeof RpcCapability>[0] => {
  switch (authority.kind) {
    case "custom":
      return authority.capability
    case "native":
      return P.nativeInvoke({ primitive: authority.primitive ?? surface, methods: [method] })
    case "none":
      return { kind: "none" }
  }
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
