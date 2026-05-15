import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
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
  DesktopRpc,
  type DesktopRpcSurface,
  type DesktopRpcSurfaceDirectOptions,
  type DesktopRpcSurfaceMappedOptions,
  P,
  type PermissionRegistry
} from "@effect-desktop/core"
import { Effect, Layer, Schema } from "effect"
import { Rpc, RpcClient, RpcGroup } from "effect/unstable/rpc"

import { makeNativeHostRpcRuntime } from "./native-rpc-runtime.js"

type NativeRpcGroup<Rpcs extends Rpc.Any> = RpcGroup.RpcGroup<Rpcs> & {
  readonly requests: ReadonlyMap<string, Rpcs>
}

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

export interface NativeRpcSurface<
  Tag extends string,
  Group extends NativeRpcGroup<Rpcs>,
  Rpcs extends Rpc.Any,
  ServiceId,
  ServerE,
  ServerR
> extends DesktopRpcSurface<Tag, Group, Rpcs, ServiceId, ServerE, ServerR> {
  readonly bridgeClientLayer: (
    exchange: BridgeClientExchange,
    options?: BridgeClientOptions
  ) => Layer.Layer<ServiceId>
  readonly hostRuntime: (
    handlers: Parameters<Group["toLayer"]>[0],
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
  ServerR
>(
  tag: Tag,
  group: Group,
  options: DesktopRpcSurfaceDirectOptions<RpcGroup.Rpcs<Group>, ServiceId, ServerE, ServerR>
): NativeRpcSurface<Tag, Group, RpcGroup.Rpcs<Group>, ServiceId, ServerE, ServerR>
function make<
  const Tag extends string,
  Group extends RpcGroup.Any & NativeRpcGroup<RpcGroup.Rpcs<Group>>,
  ServiceId,
  Service,
  ServerE,
  ServerR
>(
  tag: Tag,
  group: Group,
  options: DesktopRpcSurfaceMappedOptions<
    RpcGroup.Rpcs<Group>,
    ServiceId,
    Service,
    ServerE,
    ServerR
  >
): NativeRpcSurface<Tag, Group, RpcGroup.Rpcs<Group>, ServiceId, ServerE, ServerR>
function make<
  const Tag extends string,
  Group extends RpcGroup.Any & NativeRpcGroup<RpcGroup.Rpcs<Group>>,
  ServiceId,
  Service,
  ServerE,
  ServerR
>(
  tag: Tag,
  group: Group,
  options:
    | DesktopRpcSurfaceDirectOptions<RpcGroup.Rpcs<Group>, ServiceId, ServerE, ServerR>
    | DesktopRpcSurfaceMappedOptions<RpcGroup.Rpcs<Group>, ServiceId, Service, ServerE, ServerR>
): NativeRpcSurface<Tag, Group, RpcGroup.Rpcs<Group>, ServiceId, ServerE, ServerR> {
  const desktopSurface =
    "client" in options
      ? DesktopRpc.surface(tag, group, options)
      : DesktopRpc.surface(tag, group, options)

  return Object.freeze({
    ...desktopSurface,
    bridgeClientLayer: (exchange: BridgeClientExchange, bridgeOptions: BridgeClientOptions = {}) =>
      Layer.provide(desktopSurface.clientLayer, makeBridgeProtocolLayer(exchange, bridgeOptions)),
    hostRuntime: (
      handlers: Parameters<Group["toLayer"]>[0],
      runtimeOptions: BridgeHandlerRuntimeOptions = {}
    ) => makeNativeHostRpcRuntime(group, group.toLayer(handlers), runtimeOptions)
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
