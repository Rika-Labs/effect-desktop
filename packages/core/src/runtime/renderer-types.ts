import type { Layer, Option } from "effect"
import type { Rpc, RpcGroup } from "effect/unstable/rpc"

import type { RpcCapabilityMetadata, RpcSupportMetadata } from "@orika/bridge"

export interface RendererWindowSpec {
  readonly title: string
  readonly width?: number
  readonly height?: number
  readonly renderer?: string
}

export type DesktopRpcRegistrationGroup = RpcGroup.Any & {
  readonly requests: ReadonlyMap<string, Rpc.Any>
}

export interface AnyDesktopRpcRegistration<E = unknown, R = unknown> {
  readonly _tag: "DesktopRpcRegistration"
  readonly group: DesktopRpcRegistrationGroup
  readonly handlers: Layer.Layer<never, E, R>
  readonly serverLayer: Layer.Layer<never, E, R>
}

export type DesktopRpcsLayer<E = never, RIn = never> = ReadonlyArray<
  AnyDesktopRpcRegistration<E, RIn>
>

export interface DesktopRpcGroupDescriptor {
  readonly _tag: "DesktopRpcGroup"
  readonly group: DesktopRpcRegistrationGroup
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
  readonly rpc: Rpc.Any
  readonly capability: Option.Option<RpcCapabilityMetadata>
  readonly support: RpcSupportMetadata
}
