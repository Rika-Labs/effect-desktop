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

import { servedRpcGroup } from "./desktop-app.js"
import type {
  AnyDesktopRpcLayer,
  DesktopAppDefinition,
  DesktopAppManifest,
  DesktopRpcGroupDescriptor
} from "./desktop-app.js"
import { makeDuplicateDesktopRpcNameError, makeMissingDesktopRpcsError } from "./desktop-errors.js"

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

export type DesktopRpcDescriptorSource =
  | Pick<DesktopAppDefinition<unknown, unknown>, "rpcLayers">
  | Pick<DesktopAppManifest, "rpcGroups">

interface RpcWithSuccessSchema extends Rpc.Any {
  readonly successSchema: Schema.Top
}

export const describeRpcs = <Group extends RpcGroupWithRequests>(
  app: DesktopRpcDescriptorSource,
  group: Group
): readonly RpcEndpointDescriptor[] => {
  const provided = providedRpcGroup(app, group)
  if (provided === undefined) {
    throw makeMissingDesktopRpcsError(
      groupTags(group),
      `RpcGroup is not provided to this Desktop app: ${groupTags(group).join(", ")}`
    )
  }

  const descriptors = Array.from(descriptorGroup(provided).requests.values()).map((rpc) =>
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
      throw makeDuplicateDesktopRpcNameError(
        descriptor.name,
        Object.freeze([previous, descriptor.tag]),
        `Rpc endpoint name "${descriptor.name}" is produced by both "${previous}" and "${descriptor.tag}"`
      )
    }

    seen.set(descriptor.name, descriptor.tag)
  }
}

const providedRpcGroup = <Group extends RpcGroupWithRequests>(
  app: DesktopRpcDescriptorSource,
  group: Group
): AnyDesktopRpcLayer | DesktopRpcGroupDescriptor | undefined =>
  "rpcGroups" in app
    ? providedRpcGroupDescriptor(app.rpcGroups, group)
    : providedRpcLayer(app.rpcLayers, group)

const providedRpcLayer = <Group extends RpcGroupWithRequests>(
  layers: readonly AnyDesktopRpcLayer[],
  group: Group
): AnyDesktopRpcLayer | undefined =>
  layers.find((layer) => layer.group === group || servedRpcGroup(layer) === group)

const providedRpcGroupDescriptor = <Group extends RpcGroupWithRequests>(
  groups: readonly DesktopRpcGroupDescriptor[],
  group: Group
): DesktopRpcGroupDescriptor | undefined =>
  groups.find((descriptor) => descriptor.group === group || servedRpcGroup(descriptor) === group)

const descriptorGroup = (
  descriptor: AnyDesktopRpcLayer | DesktopRpcGroupDescriptor
): RpcGroupWithRequests => servedRpcGroup(descriptor)

const endpointKind = (rpc: Rpc.Any): RpcEndpointDescriptorKind =>
  RpcSchema.isStreamSchema(successSchema(rpc)) ? "stream" : rpcEndpointKind(rpc)

const successSchema = (rpc: Rpc.Any): Schema.Top => (rpc as RpcWithSuccessSchema).successSchema

const groupTags = (group: RpcGroupWithRequests): readonly string[] =>
  Array.from(group.requests.keys())
