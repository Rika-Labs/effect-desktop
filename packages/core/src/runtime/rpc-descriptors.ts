import {
  describeRpcs as describeManifestRpcs,
  type RpcEndpointDescriptor,
  type RpcEndpointDescriptorKind
} from "./renderer-rpc-descriptors.js"

import {
  manifest as desktopManifest,
  type DesktopAppManifest,
  type DesktopConfig,
  type DesktopRpcRegistrationGroup,
  type DesktopWindowsLayer
} from "./desktop-app.js"

export type DesktopRpcDescriptorSource =
  | Pick<DesktopAppManifest, "rpcGroups">
  | Pick<DesktopConfig<unknown, unknown>, "rpcs" | "id" | "windows">

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
  return describeManifestRpcs({ rpcGroups }, group)
}
export type { RpcEndpointDescriptor, RpcEndpointDescriptorKind }
