import {
  rpcCapability,
  rpcEndpointKind,
  rpcEndpointName,
  rpcSupport,
  type RpcCapabilityMetadata,
  type RpcSupportMetadata
} from "@orika/bridge"
import { Option, Schema } from "effect"
import { Rpc, RpcSchema } from "effect/unstable/rpc"

import {
  manifest as desktopManifest,
  type DesktopAppManifest,
  type DesktopConfig,
  type DesktopRpcGroupDescriptor,
  type DesktopRpcRegistrationGroup,
  type DesktopWindowsLayer
} from "./desktop-app.js"
import { makeDuplicateDesktopRpcNameError, makeMissingDesktopRpcsError } from "./desktop-errors.js"

export type RpcEndpointDescriptorKind = "query" | "mutation" | "stream"
export interface RpcEndpointDescriptor {
  readonly name: string
  readonly tag: string
  readonly kind: RpcEndpointDescriptorKind
  readonly hasPayload: boolean
  readonly rpc: Rpc.Any
  readonly capability: Option.Option<RpcCapabilityMetadata>
  readonly support: RpcSupportMetadata
}

export type DesktopRpcDescriptorSource =
  | Pick<DesktopAppManifest, "rpcGroups">
  | Pick<DesktopConfig<unknown, unknown>, "rpcs" | "id" | "windows">

interface RpcWithSchemas extends Rpc.Any {
  readonly payloadSchema: Schema.Top
  readonly successSchema: Schema.Top
}

export const describeRpcs = <Group extends DesktopRpcRegistrationGroup>(
  app: DesktopRpcDescriptorSource,
  group: Group
): readonly RpcEndpointDescriptor[] => {
  const rpcGroups =
    "rpcGroups" in app
      ? app.rpcGroups
      : desktopManifest({
          id: "describeRpcs",
          windows: [] as DesktopWindowsLayer<never>,
          ...("rpcs" in app ? { rpcs: app.rpcs } : {})
        } as Parameters<typeof desktopManifest>[0]).rpcGroups
  const provided = providedRpcGroupDescriptor(rpcGroups, group)
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

const providedRpcGroupDescriptor = <Group extends DesktopRpcRegistrationGroup>(
  groups: readonly DesktopRpcGroupDescriptor[],
  group: Group
): DesktopRpcGroupDescriptor | undefined => groups.find((descriptor) => descriptor.group === group)

const endpointKind = (rpc: Rpc.Any): RpcEndpointDescriptorKind =>
  RpcSchema.isStreamSchema(successSchema(rpc)) ? "stream" : rpcEndpointKind(rpc)

const payloadSchema = (rpc: Rpc.Any): Schema.Top => (rpc as RpcWithSchemas).payloadSchema

const successSchema = (rpc: Rpc.Any): Schema.Top => (rpc as RpcWithSchemas).successSchema

const groupTags = (group: DesktopRpcRegistrationGroup): readonly string[] =>
  Array.from(group.requests.keys())
