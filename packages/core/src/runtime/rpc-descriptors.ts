import {
  rpcCapability,
  rpcEndpointKind,
  rpcEndpointName,
  rpcSupport,
  type RpcCapabilityMetadata,
  type RpcSupportMetadata
} from "@effect-desktop/bridge"
import { Option, Schema } from "effect"
import { Rpc, RpcGroup, RpcSchema } from "effect/unstable/rpc"

import type { AnyDesktopRpcLayer, DesktopAppDefinition } from "./desktop-app.js"
import { DuplicateDesktopRpcNameError, MissingDesktopRpcsError } from "./desktop-errors.js"

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

  const descriptors = Array.from(provided.group.requests.values()).map((rpc) =>
    Object.freeze({
      name: rpcEndpointName(rpc._tag),
      tag: rpc._tag,
      kind: endpointKind(rpc),
      rpc,
      capability: rpcCapability(rpc),
      support: rpcSupport(rpc)
    })
  )

  assertUniqueEndpointNames(descriptors)

  return Object.freeze(descriptors)
}

const assertUniqueEndpointNames = (descriptors: readonly RpcEndpointDescriptor[]): void => {
  const seen = new Map<string, string>()

  for (const descriptor of descriptors) {
    const previous = seen.get(descriptor.name)
    if (previous !== undefined) {
      throw new DuplicateDesktopRpcNameError({
        message: `Rpc endpoint name "${descriptor.name}" is produced by both "${previous}" and "${descriptor.tag}"`,
        name: descriptor.name,
        tags: Object.freeze([previous, descriptor.tag])
      })
    }

    seen.set(descriptor.name, descriptor.tag)
  }
}

const providedRpcLayer = <Group extends RpcGroupWithRequests>(
  layers: readonly AnyDesktopRpcLayer[],
  group: Group
): AnyDesktopRpcLayer | undefined => layers.find((layer) => layer.group === group)

const endpointKind = (rpc: Rpc.Any): RpcEndpointDescriptorKind =>
  RpcSchema.isStreamSchema(successSchema(rpc)) ? "stream" : rpcEndpointKind(rpc)

const successSchema = (rpc: Rpc.Any): Schema.Top => (rpc as RpcWithSuccessSchema).successSchema

const groupTags = (group: RpcGroupWithRequests): readonly string[] =>
  Array.from(group.requests.keys())
