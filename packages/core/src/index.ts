import { RedactionFilter, RpcCapability, RpcEndpoint, RpcSupport } from "@effect-desktop/bridge"
import { Context, Effect, Layer } from "effect"
import { WorkflowEngine } from "effect/unstable/workflow"

import {
  app as desktopApp,
  launch,
  make,
  manifest,
  native,
  permission,
  permissions,
  provider,
  providers,
  Provider,
  providerLayerFor,
  rpc,
  rpcs,
  runtime,
  runtimeGraph,
  runtimeGraphSnapshot,
  desktopWindow,
  windows,
  workflow,
  workflows,
  WorkflowEngineDurable,
  WorkflowEngineMemory
} from "./runtime/desktop-app.js"
import {
  DesktopPermissionRegistry,
  DesktopPermissionRegistryLive
} from "./runtime/desktop-permission-registry.js"
import {
  DesktopWorkflowRegistry,
  DesktopWorkflowRegistryLive
} from "./runtime/desktop-workflow-registry.js"
import { snapshotDeclarationLayerSync } from "./runtime/desktop-declaration.js"
import type {
  DesktopApp,
  DesktopConfig,
  DesktopConfigError,
  DesktopPermissionsLayer,
  DesktopRuntimeProviderServices,
  DesktopWorkflowLayer,
  DesktopWorkflowsLayer
} from "./runtime/desktop-app.js"
import { DesktopRpc } from "./runtime/desktop-rpc-surface.js"
import type { NormalizedCapability } from "./runtime/permission-registry.js"
import { PermissionRegistry } from "./runtime/permission-registry.js"
import type { ResourceOwner } from "./runtime/resource-owner.js"
import { describeRpcs } from "./runtime/rpc-descriptors.js"

export {
  RedactionFilter,
  RpcCapability,
  RpcEndpoint,
  RpcSupport,
  redact
} from "@effect-desktop/bridge"
export { makeBridgeCallRegistry, makeBridgeStreamRegistry } from "@effect-desktop/bridge"
export type {
  BridgeCallRegistry,
  BridgeCallState,
  BridgeStreamRegistry,
  BridgeStreamRegistryEntry,
  RpcCapabilityMetadata,
  RpcEndpointKind,
  RpcSupportMetadata
} from "@effect-desktop/bridge"
export * from "./runtime/desktop-env-config.js"
export * from "./runtime/desktop-schedules.js"
export * from "./runtime/logger.js"
export * from "./runtime/resources.js"
export * from "./runtime/filesystem.js"
export * from "./runtime/audit-events.js"
export * from "./runtime/approval-broker.js"
export * from "./runtime/commands.js"
export * from "./runtime/process.js"
export * from "./runtime/sidecar.js"
export * from "./runtime/pty.js"
export * from "./runtime/worker.js"
export * from "./runtime/permission-registry.js"
export * from "./runtime/permission-interceptor.js"
export * from "./runtime/permission-approval-workflow.js"
export * from "./runtime/provider-registry.js"
export * from "./runtime/secrets.js"
export * from "./runtime/settings.js"
export * from "./runtime/sqlite.js"
export * from "./runtime/telemetry.js"
export * from "./runtime/inspector-events.js"
export * from "./runtime/desktop-devtools.js"
export * from "./runtime/inspector-safety-policy.js"
export * from "./runtime/inspector-security-events.js"
export * from "./runtime/desktop-observability.js"
export * from "./runtime/inspector-transport.js"
export * from "./runtime/desktop-errors.js"
export * from "./runtime/desktop-native-registry.js"
export * from "./runtime/desktop-permission-registry.js"
export * from "./runtime/desktop-rpc-registry.js"
export * from "./runtime/desktop-rpc-surface.js"
export * from "./runtime/desktop-workflow-registry.js"
export * from "./runtime/desktop-window-registry.js"
export * from "./runtime/resource-owner.js"
export * from "./runtime/window-context.js"
export {
  DesktopApp,
  app as desktopApp,
  launch,
  layerGraphSnapshotFromGraph,
  make,
  manifest,
  native,
  permission,
  permissions,
  provider,
  providers,
  Provider,
  providerLayerFor,
  rpc,
  rpcs,
  runtime,
  runtimeGraph,
  runtimeGraphSnapshot,
  desktopWindow,
  windows,
  workflow,
  workflows,
  type DesktopAppApi,
  type DesktopAppDescriptor,
  type DesktopAppManifest,
  type DesktopConfig,
  type DesktopMakeConfig,
  type DesktopManifestSource,
  type DesktopProviderDescriptor,
  type DesktopProviderBudget,
  type DesktopProvidersLayer,
  type DesktopRpcGroupDescriptor,
  type DesktopRpcsLayer,
  type DesktopWindowsLayer,
  type DesktopRuntimeApi,
  type DesktopRuntimeGraph,
  type DesktopRuntimeGraphNode,
  type DesktopRuntimeGraphNodeKind,
  type DesktopRuntimeProviderDescriptor,
  type DesktopRuntimeProviderId,
  type DesktopRuntimeProviderOptions,
  type DesktopWebViewHostEngine,
  type DesktopWebViewProviderDescriptor,
  type DesktopWebViewProviderId,
  type DesktopWebViewProviderOptions,
  type DesktopRuntimeProviderServices,
  type DesktopRuntimeSelectedProviders,
  type DesktopRuntimeServices,
  type DesktopNativeDeclaration,
  type DesktopNativeCapabilitySelection,
  type DesktopNativeLayer,
  type DesktopNativeSurfaceSelection,
  type DesktopPermissionsLayer,
  type DesktopWorkflowEngineLayer,
  type DesktopWorkflowLayer,
  type DesktopWorkflowsLayer,
  WorkflowEngineDurable,
  WorkflowEngineMemory,
  LayerFailurePayload,
  LayerGraphNodeSnapshot,
  LayerGraphSnapshot,
  ProviderFact,
  type WindowSpec
} from "./runtime/desktop-app.js"
export { DesktopRuntime, DesktopRuntimeLive } from "./runtime/desktop-app.js"
export { DesktopConfigError as DesktopSpineConfigError } from "./runtime/desktop-app.js"

export interface DesktopAppOptions<RIn = never, E = never> {
  readonly workflows?: DesktopWorkflowsLayer<RIn, E>
  readonly permissions?: DesktopPermissionsLayer
}

interface DesktopAppOptionsWithPermissions<RIn = never, E = never> extends DesktopAppOptions<
  RIn,
  E
> {
  readonly permissions: DesktopPermissionsLayer
}

function app(): Layer.Layer<WorkflowEngine.WorkflowEngine, never, never>
function app<RIn = never, E = never>(
  config: DesktopConfig<RIn, E>
): Layer.Layer<
  DesktopApp,
  DesktopConfigError | E,
  Exclude<RIn, DesktopRuntimeProviderServices | ResourceOwner>
>
function app<RIn = never, E = never>(
  options: DesktopAppOptionsWithPermissions<RIn, E>
): Layer.Layer<WorkflowEngine.WorkflowEngine, E, RIn | PermissionRegistry>
function app<RIn = never, E = never>(
  options: DesktopAppOptions<RIn, E>
): Layer.Layer<WorkflowEngine.WorkflowEngine, E, RIn>
function app<RIn = never, E = never>(
  options: DesktopAppOptions<RIn, E> | DesktopConfig<RIn, E> = {}
):
  | Layer.Layer<WorkflowEngine.WorkflowEngine, never, never>
  | Layer.Layer<WorkflowEngine.WorkflowEngine, E, RIn>
  | Layer.Layer<WorkflowEngine.WorkflowEngine, E, RIn | PermissionRegistry>
  | Layer.Layer<
      DesktopApp,
      DesktopConfigError | E,
      Exclude<RIn, DesktopRuntimeProviderServices | ResourceOwner>
    > {
  if ("id" in options) {
    return desktopApp(options)
  }

  const workflows = snapshotStandaloneWorkflows(options.workflows)
  const permissions = snapshotStandalonePermissions(options.permissions)

  const declareLayer =
    permissions.length === 0
      ? Layer.empty
      : Layer.effectDiscard(
          Effect.gen(function* () {
            const registry = yield* PermissionRegistry
            for (const capability of permissions) {
              yield* registry
                .declare(capability, { source: "Desktop.app", effect: "allow" })
                .pipe(Effect.orDie)
            }
          })
        )

  if (workflows.length === 0) {
    return Layer.merge(WorkflowEngineMemory, declareLayer)
  }

  const merged = workflows.reduce<Layer.Layer<never, E, RIn | WorkflowEngine.WorkflowEngine>>(
    (acc, wf) => Layer.merge(acc, wf),
    Layer.empty as Layer.Layer<never, E, RIn | WorkflowEngine.WorkflowEngine>
  )
  return Layer.merge(Layer.provideMerge(merged, WorkflowEngineMemory), declareLayer)
}

const snapshotStandalonePermissions = (
  permissions: DesktopPermissionsLayer | undefined
): ReadonlyArray<NormalizedCapability> => {
  if (permissions === undefined) return []

  return snapshotDeclarationLayerSync({
    layer: permissions,
    live: DesktopPermissionRegistryLive,
    snapshot: (context) => Context.get(context, DesktopPermissionRegistry).snapshot,
    onAsyncBuild: (cause) => cause
  })
}

const snapshotStandaloneWorkflows = <RIn, E>(
  workflows: DesktopWorkflowsLayer<RIn, E> | undefined
): ReadonlyArray<DesktopWorkflowLayer<RIn, E>> => {
  if (workflows === undefined) return []

  const snapshot = snapshotDeclarationLayerSync({
    layer: workflows,
    live: DesktopWorkflowRegistryLive,
    snapshot: (context) => Context.get(context, DesktopWorkflowRegistry).snapshot,
    onAsyncBuild: (cause) => cause
  })

  return snapshot as ReadonlyArray<DesktopWorkflowLayer<RIn, E>>
}

export const Desktop = Object.freeze({
  RedactionFilter,
  RpcCapability,
  RpcEndpoint,
  RpcSupport,
  app,
  WorkflowEngineDurable,
  WorkflowEngineMemory,
  launch,
  make,
  manifest,
  native,
  permission,
  permissions,
  provider,
  providers,
  Provider,
  providerLayerFor,
  rpc,
  rpcs,
  window: desktopWindow,
  windows,
  workflow,
  workflows,
  Rpc: DesktopRpc,
  runtime,
  runtimeGraph,
  runtimeGraphSnapshot,
  describeRpcs
})
