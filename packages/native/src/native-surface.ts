import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  type HostProtocolRequestEnvelope,
  HostProtocolError as HostProtocolErrorSchema,
  makeDesktopClientProtocol,
  makeUnaryDesktopTransportFromBridgeClientExchange,
  RpcCapability,
  RpcEndpoint,
  type RpcEndpointKind,
  RpcSupport,
  type RpcSupportMetadata
} from "@effect-desktop/bridge"
import {
  type AnyDesktopNativeRegistration,
  DesktopRpc,
  type DesktopRpcClient,
  type DesktopNativeCapabilitySelection,
  type DesktopNativeSurfaceSelection,
  type DesktopRpcSurface,
  NormalizedCapability as NormalizedCapabilitySchema,
  type NormalizedCapability,
  P,
  type PermissionRegistry
} from "@effect-desktop/core"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { Rpc, RpcClient, RpcGroup } from "effect/unstable/rpc"

import { makeNativeHostRpcRuntime } from "./native-rpc-runtime.js"

type NativeRpcGroup<Rpcs extends Rpc.Any> = RpcGroup.RpcGroup<Rpcs> & {
  readonly requests: ReadonlyMap<string, Rpcs>
}

type NativeRpcHandlers<Group extends RpcGroup.Any> = RpcGroup.HandlersFrom<RpcGroup.Rpcs<Group>>

export type NativeSurfaceSelection = DesktopNativeSurfaceSelection
export type NativeCapabilitySelection = DesktopNativeCapabilitySelection

export type NativeSurfaceApi<Method extends string = never> = Readonly<
  NativeSurfaceSelection &
    Record<Method, NativeCapabilitySelection> & {
      readonly all: NativeCapabilitySelection
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

export interface NativeRpcSurfaceSelectionOptions<Method extends string = never> {
  readonly capabilities?: readonly Method[]
  readonly bridge?: NativeBridgeProtocolOptions
}

export interface NativeBridgeProtocolOptions extends BridgeClientOptions {
  readonly normalizeRequest?: (request: HostProtocolRequestEnvelope) => HostProtocolRequestEnvelope
}

export interface NativeRpcSurfaceDirectOptions<
  Rpcs extends Rpc.Any,
  ServiceId,
  ServerE,
  ServerR,
  Method extends string = never
> extends NativeRpcSurfaceSelectionOptions<Method> {
  readonly service: Context.Key<ServiceId, DesktopRpcClient<Rpcs>>
  readonly handlers: Layer.Layer<Rpc.ToHandler<Rpcs>, ServerE, ServerR>
}

export interface NativeRpcSurfaceMappedOptions<
  Rpcs extends Rpc.Any,
  ServiceId,
  Service,
  ServerE,
  ServerR,
  Method extends string = never
> extends NativeRpcSurfaceSelectionOptions<Method> {
  readonly service: Context.Key<ServiceId, Service>
  readonly handlers: Layer.Layer<Rpc.ToHandler<Rpcs>, ServerE, ServerR>
  readonly client: (client: DesktopRpcClient<Rpcs>) => Service
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
  readonly selection: NativeSurfaceApi<Method>
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
  unsupported: (reason: string): RpcSupportMetadata =>
    Object.freeze({ status: "unsupported", reason })
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
  options: NativeRpcSurfaceDirectOptions<RpcGroup.Rpcs<Group>, ServiceId, ServerE, ServerR, Method>
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
  options: NativeRpcSurfaceMappedOptions<
    RpcGroup.Rpcs<Group>,
    ServiceId,
    Service,
    ServerE,
    ServerR,
    Method
  >
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
    | NativeRpcSurfaceDirectOptions<RpcGroup.Rpcs<Group>, ServiceId, ServerE, ServerR, Method>
    | NativeRpcSurfaceMappedOptions<
        RpcGroup.Rpcs<Group>,
        ServiceId,
        Service,
        ServerE,
        ServerR,
        Method
      >
): NativeRpcSurface<Tag, Group, RpcGroup.Rpcs<Group>, ServiceId, ServerE, ServerR, Method> {
  const desktopSurface =
    "client" in options
      ? DesktopRpc.surface(tag, group, options)
      : DesktopRpc.surface(tag, group, options)

  const surfaceWithoutSelection = Object.freeze({
    ...desktopSurface,
    bridgeClientLayer: (exchange: BridgeClientExchange, bridgeOptions: BridgeClientOptions = {}) =>
      makeBridgeClientLayer(exchange, bridgeOptions),
    hostRuntime: (
      handlers: NativeRpcHandlers<Group>,
      runtimeOptions: BridgeHandlerRuntimeOptions = {}
    ) => makeNativeHostRpcRuntime(group, group.toLayer(handlers), runtimeOptions)
  })

  return Object.freeze({
    ...surfaceWithoutSelection,
    selection: nativeSurfaceSelection(surfaceWithoutSelection, options.capabilities ?? [])
  })

  function makeBridgeClientLayer(
    exchange: BridgeClientExchange,
    bridgeOptions: BridgeClientOptions
  ): Layer.Layer<ServiceId> {
    const protocolLayer = makeBridgeProtocolLayer(exchange, {
      ...bridgeOptions,
      ...options.bridge
    })

    if ("bridgeClient" in options && options.bridgeClient !== undefined) {
      const bridgeClient = options.bridgeClient
      return Layer.effect(
        options.service,
        RpcClient.make(group).pipe(Effect.map((client) => bridgeClient(client, exchange)))
      ).pipe(Layer.provide(protocolLayer))
    }

    return Layer.provide(desktopSurface.clientLayer, protocolLayer)
  }
}

const makeBridgeProtocolLayer = (
  exchange: BridgeClientExchange,
  options: NativeBridgeProtocolOptions
): Layer.Layer<RpcClient.Protocol> =>
  Layer.effect(RpcClient.Protocol)(
    makeUnaryDesktopTransportFromBridgeClientExchange(exchange, options).pipe(
      Effect.flatMap((transport) => makeDesktopClientProtocol(transport, options))
    )
  )

const nativeSurfaceSelection = <const Method extends string>(
  registration: AnyDesktopNativeRegistration,
  capabilities: readonly Method[]
): NativeSurfaceApi<Method> =>
  Object.freeze({
    ...surfaceSelection(registration),
    ...Object.fromEntries(
      capabilities.map((method) => [method, surfaceCapability(registration, method)] as const)
    ),
    all: capabilitySelection(registration, allPermissionCapabilities([registration]))
  }) as NativeSurfaceApi<Method>

const surfaceSelection = (registration: AnyDesktopNativeRegistration): NativeSurfaceSelection =>
  Object.freeze({
    _tag: "NativeSurfaceSelection" as const,
    surfaces: Object.freeze([registration])
  })

const capabilitySelection = (
  registration: AnyDesktopNativeRegistration,
  permissions: readonly NormalizedCapability[]
): NativeCapabilitySelection =>
  Object.freeze({
    _tag: "NativeCapabilitySelection" as const,
    surfaces: Object.freeze([registration]),
    permissions: Object.freeze([...permissions])
  })

const surfaceCapability = (
  registration: AnyDesktopNativeRegistration,
  method: string
): NativeCapabilitySelection =>
  capabilitySelection(registration, [permissionCapability(registration, method)])

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

export const allCapabilitySelection = (
  surfaces: readonly AnyDesktopNativeRegistration[]
): NativeCapabilitySelection =>
  Object.freeze({
    _tag: "NativeCapabilitySelection" as const,
    surfaces: Object.freeze([...surfaces]),
    permissions: allPermissionCapabilities(surfaces)
  })

const allPermissionCapabilities = (
  surfaces: readonly AnyDesktopNativeRegistration[]
): readonly NormalizedCapability[] => {
  const permissions: NormalizedCapability[] = []
  const seen = new Set<string>()

  for (const nativeSurface of surfaces) {
    for (const doc of nativeSurface.schemaDocs) {
      const capability = Option.getOrUndefined(doc.capability)
      if (capability === undefined || capability.kind === "none") {
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
    const method = methodNameFromTag(surfaceRegistration.tag, doc.tag)
    const capability = Option.getOrUndefined(doc.capability)
    if (capability === undefined || capability.kind === "none") {
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
    ? RpcSupport.supported(rpc)
    : RpcSupport.unsupported(support.reason)(rpc)

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
  make,
  rpc,
  support: NativeRpcSupport
})
