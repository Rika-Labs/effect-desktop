import { rpcCapability, rpcEndpointKind, rpcEndpointName, rpcSupport } from "@orika/bridge"
import { Schema } from "effect"
import { Rpc, RpcSchema } from "effect/unstable/rpc"

import { makeDuplicateDesktopRpcNameError, makeMissingDesktopRpcsError } from "./desktop-errors.js"
import type {
  DesktopAppManifest,
  DesktopRpcRegistrationGroup,
  RendererRpcEndpointDescriptor
} from "./renderer-types.js"

export type RpcEndpointDescriptorKind = RendererRpcEndpointDescriptor["kind"]
export type RpcEndpointDescriptor = RendererRpcEndpointDescriptor
export type DesktopRpcDescriptorSource = Pick<DesktopAppManifest, "rpcGroups">

// Effect's public Rpc.Any type omits these fields, but RpcGroup requests contain full Rpc values.
interface RpcWithSchemas extends Rpc.Any {
  readonly payloadSchema: Schema.Top
  readonly successSchema: Schema.Top
}

export const describeRpcs = <Group extends DesktopRpcRegistrationGroup>(
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
      hasPayload: payloadSchema(rpc) !== Schema.Void,
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

const endpointKind = (rpc: Rpc.Any): RendererRpcEndpointDescriptor["kind"] =>
  RpcSchema.isStreamSchema(successSchema(rpc)) ? "stream" : rpcEndpointKind(rpc)

const payloadSchema = (rpc: Rpc.Any): Schema.Top => (rpc as RpcWithSchemas).payloadSchema

const successSchema = (rpc: Rpc.Any): Schema.Top => (rpc as RpcWithSchemas).successSchema

const groupTags = (group: DesktopRpcRegistrationGroup): readonly string[] =>
  Array.from(group.requests.keys())
