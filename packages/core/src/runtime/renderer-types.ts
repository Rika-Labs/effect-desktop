import type { Layer, Option } from "effect"
import type { Rpc, RpcGroup } from "effect/unstable/rpc"

import type { RpcCapabilityMetadata, RpcSupportMetadata } from "@orika/bridge"

export interface RendererWindowSpec {
  readonly title: string
  readonly width?: number
  readonly height?: number
  readonly renderer?: string
}

export type DesktopRpcRegistrationGroup<Rpcs extends Rpc.AnyWithProps> = RpcGroup.RpcGroup<Rpcs>

export type AnyDesktopRpcRegistrationGroup = RpcGroup.Any & {
  readonly requests: ReadonlyMap<string, Rpc.AnyWithProps>
}

export interface DesktopRpcRegistration<
  Rpcs extends Rpc.AnyWithProps,
  E = unknown,
  ServerR = unknown,
  HandlerR = ServerR
> {
  readonly _tag: "DesktopRpcRegistration"
  readonly group: DesktopRpcRegistrationGroup<Rpcs>
  readonly handlers: Layer.Layer<Rpc.ToHandler<Rpcs>, E, HandlerR>
  readonly serverLayer: Layer.Layer<never, E, ServerR>
}

export interface AnyDesktopRpcRegistration<
  E = unknown,
  ServerR = unknown,
  HandlerR = unknown,
  HandlerServices = never
> {
  readonly _tag: "DesktopRpcRegistration"
  readonly group: AnyDesktopRpcRegistrationGroup
  readonly handlers: Layer.Layer<HandlerServices, E, HandlerR>
  readonly serverLayer: Layer.Layer<never, E, ServerR>
}

export type DesktopRpcsLayer<
  E = never,
  ServerR = never,
  HandlerR = ServerR,
  HandlerServices = never
> = ReadonlyArray<AnyDesktopRpcRegistration<E, ServerR, HandlerR, HandlerServices>>

export interface DesktopRpcGroupDescriptor {
  readonly _tag: "DesktopRpcGroup"
  readonly group: AnyDesktopRpcRegistrationGroup
}

export interface DesktopAppManifest {
  readonly _tag: "DesktopAppManifest"
  readonly id: string
  readonly windows: Readonly<Record<string, RendererWindowSpec>>
  readonly rpcGroups: ReadonlyArray<DesktopRpcGroupDescriptor>
}

export interface RendererRpcEndpointDescriptor {
  readonly name: string
  readonly tag: string
  readonly kind: "query" | "mutation" | "stream"
  readonly hasPayload: boolean
  readonly rpc: Rpc.AnyWithProps
  readonly capability: Option.Option<RpcCapabilityMetadata>
  readonly support: RpcSupportMetadata
}
