import {
  rpcCapability,
  rpcEndpointKind,
  rpcEndpointName,
  rpcSupport,
  type RpcCapabilityMetadata,
  type RpcSupportMetadata
} from "@rikalabs/effect-desktop/bridge"
import { Option, Schema } from "effect"
import { Rpc, RpcGroup, RpcSchema } from "effect/unstable/rpc"

import type { AnyDesktopRpcLayer, DesktopAppDefinition } from "./desktop-app.js"
import { MissingDesktopRpcsError } from "./desktop-errors.js"

export type RpcEndpointDescriptorKind = "query" | "mutation" | "stream"
export type RpcGroupWithRequests = RpcGroup.Any & {
  readonly requests: ReadonlyMap<string, Rpc.Any>
}

export interface RpcEndpointDescriptor {
  readonly name: string
  readonly tag: string
  readonly kind: RpcEndpointDescriptorKind
  readonly rpc: Rpc.Any
  readonly capability: Option.Option<RpcCapabilityMetadata>
  readonly support: RpcSupportMetadata
}

interface RpcWithSuccessSchema extends Rpc.Any {
  readonly successSchema: Schema.Top
}

export const describeRpcs = <Group extends RpcGroupWithRequests>(
  app: Pick<DesktopAppDefinition<unknown, unknown>, "rpcLayers">,
  group: Group
): readonly RpcEndpointDescriptor[] => {
  const provided = providedRpcLayer(app.rpcLayers, group)
  if (provided === undefined) {
    throw new MissingDesktopRpcsError({
      message: `RpcGroup is not provided to this Desktop app: ${groupTags(group).join(", ")}`,
      tags: groupTags(group)
    })
  }

  return Object.freeze(
    Array.from(provided.group.requests.values()).map((rpc) =>
      Object.freeze({
        name: rpcEndpointName(rpc._tag),
        tag: rpc._tag,
        kind: endpointKind(rpc),
        rpc,
        capability: rpcCapability(rpc),
        support: rpcSupport(rpc)
      })
    )
  )
}

const providedRpcLayer = <Group extends RpcGroupWithRequests>(
  layers: readonly AnyDesktopRpcLayer[],
  group: Group
): AnyDesktopRpcLayer | undefined => layers.find((layer) => layer.group === group)

const endpointKind = (rpc: Rpc.Any): RpcEndpointDescriptorKind =>
  RpcSchema.isStreamSchema(successSchema(rpc)) ? "stream" : rpcEndpointKind(rpc)

const successSchema = (rpc: Rpc.Any): Schema.Top => (rpc as RpcWithSuccessSchema).successSchema

const groupTags = (group: RpcGroupWithRequests): readonly string[] => Array.from(group.requests.keys())
