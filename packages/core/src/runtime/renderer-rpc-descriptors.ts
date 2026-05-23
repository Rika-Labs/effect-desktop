import { rpcCapability, rpcEndpointKind, rpcEndpointName, rpcSupport } from "@orika/bridge"
import { Schema } from "effect"
import { Rpc, RpcSchema } from "effect/unstable/rpc"

import { makeDuplicateDesktopRpcNameError, makeMissingDesktopRpcsError } from "./desktop-errors.js"
import type {
  AnyDesktopRpcRegistrationGroup,
  DesktopAppManifest,
  RendererRpcEndpointDescriptor
} from "./renderer-types.js"

export type RpcEndpointDescriptorKind = RendererRpcEndpointDescriptor["kind"]
export type RpcEndpointDescriptor = RendererRpcEndpointDescriptor
export type DesktopRpcDescriptorSource = Pick<DesktopAppManifest, "rpcGroups">

export const describeRpcs = <Group extends AnyDesktopRpcRegistrationGroup>(
  app: DesktopRpcDescriptorSource,
  group: Group
): readonly RendererRpcEndpointDescriptor[] => {
  const provided = app.rpcGroups.find((descriptor) => descriptor.group === group)
  if (provided === undefined) {
    throw makeMissingDesktopRpcsError(
      groupTags(group),
      `RpcGroup is not provided to this Desktop app: ${groupTags(group).join(", ")}`
    )
  }

  const descriptors = Array.from(provided.group.requests.values()).map((rpc) =>
    Object.freeze({
      name: rpcEndpointName(rpc._tag),
      tag: rpc._tag,
      kind: endpointKind(rpc),
      hasPayload: rpc.payloadSchema !== Schema.Void,
      rpc,
      capability: rpcCapability(rpc),
      support: rpcSupport(rpc)
    })
  )

  assertUniqueEndpointNames(descriptors)

  return Object.freeze(descriptors)
}

const assertUniqueEndpointNames = (descriptors: readonly RendererRpcEndpointDescriptor[]): void => {
  const seen = new Map<string, string>()

  for (const descriptor of descriptors) {
    const previous = seen.get(descriptor.name)
    if (previous !== undefined) {
      throw makeDuplicateDesktopRpcNameError(
        descriptor.name,
        Object.freeze([previous, descriptor.tag]),
        `Rpc endpoint name "${descriptor.name}" is produced by both "${previous}" and "${descriptor.tag}"`
      )
    }

    seen.set(descriptor.name, descriptor.tag)
  }
}

const endpointKind = (rpc: Rpc.AnyWithProps): RendererRpcEndpointDescriptor["kind"] =>
  RpcSchema.isStreamSchema(rpc.successSchema) ? "stream" : rpcEndpointKind(rpc)

const groupTags = (group: AnyDesktopRpcRegistrationGroup): readonly string[] =>
  Array.from(group.requests.keys())
