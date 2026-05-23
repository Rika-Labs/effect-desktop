import {
  describeRpcs as describeManifestRpcs,
  type RpcEndpointDescriptor,
  type RpcEndpointDescriptorKind
} from "./renderer-rpc-descriptors.js"

import {
  manifest as desktopManifest,
  type DesktopAppManifest,
  type DesktopManifestSource,
  type DesktopRpcRegistrationGroup
} from "./desktop-app.js"

export type DesktopRpcDescriptorSource =
  | Pick<DesktopAppManifest, "rpcGroups">
  | DesktopManifestSource<unknown, unknown, unknown>

export const describeRpcs = <Group extends DesktopRpcRegistrationGroup>(
  app: DesktopRpcDescriptorSource,
  group: Group
): readonly RpcEndpointDescriptor[] => {
  const rpcGroups = "rpcGroups" in app ? app.rpcGroups : desktopManifest(app).rpcGroups
  return describeManifestRpcs({ rpcGroups }, group)
}
export type { RpcEndpointDescriptor, RpcEndpointDescriptorKind }
