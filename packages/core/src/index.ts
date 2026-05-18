import { RedactionFilter, RpcCapability, RpcEndpoint, RpcSupport } from "@effect-desktop/bridge"
import { Effect, Layer } from "effect"
import { WorkflowEngine } from "effect/unstable/workflow"

import {
  launch,
  layer as desktopLayer,
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
import type { DesktopPermissionsLayer, DesktopWorkflowsLayer } from "./runtime/desktop-app.js"
import { DesktopRpc } from "./runtime/desktop-rpc-surface.js"
import { PermissionRegistry } from "./runtime/permission-registry.js"
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
export * from "./runtime/desktop-rpc-surface.js"
export * from "./runtime/resource-owner.js"
export * from "./runtime/window-context.js"
export {
  DesktopApp,
  launch,
  layer,
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
  type AnyDesktopNativeRegistration,
  type AnyDesktopRpcRegistration,
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
export {
  NativeHostMethodInventorySnapshot,
  NativeParityHostStatus,
  NativeParityMatrixError,
  NativeParityMatrixErrorReason,
  NativeParityMatrixResult,
  NativeParityMatrixRow,
  NativeParityMatrixSummary,
  NativeParityPlatform,
  NativeParityPlatformSupport,
  NativeParitySupport,
  NativeParitySupportStatus,
  type NativeHostMethodInventorySnapshotType,
  type NativeParityCapabilityKind,
  type NativeParityMatrixResultType,
  type NativeParityMatrixRowType,
  type NativeParityMatrixSummaryType
} from "./native-parity-matrix.js"

export interface DesktopWorkflowEngineOptions<RIn = never, E = never> {
  readonly workflows?: DesktopWorkflowsLayer<RIn, E>
  readonly permissions?: DesktopPermissionsLayer
}

interface DesktopWorkflowEngineOptionsWithPermissions<
  RIn = never,
  E = never
> extends DesktopWorkflowEngineOptions<RIn, E> {
  readonly permissions: DesktopPermissionsLayer
}

function workflowEngine(): Layer.Layer<WorkflowEngine.WorkflowEngine, never, never>
function workflowEngine<RIn = never, E = never>(
  options: DesktopWorkflowEngineOptionsWithPermissions<RIn, E>
): Layer.Layer<WorkflowEngine.WorkflowEngine, E, RIn | PermissionRegistry>
function workflowEngine<RIn = never, E = never>(
  options: DesktopWorkflowEngineOptions<RIn, E>
): Layer.Layer<WorkflowEngine.WorkflowEngine, E, RIn>
function workflowEngine<RIn = never, E = never>(
  options: DesktopWorkflowEngineOptions<RIn, E> = {}
):
  | Layer.Layer<WorkflowEngine.WorkflowEngine, never, never>
  | Layer.Layer<WorkflowEngine.WorkflowEngine, E, RIn>
  | Layer.Layer<WorkflowEngine.WorkflowEngine, E, RIn | PermissionRegistry> {
  const workflowLayers = options.workflows ?? []
  const declaredPermissions = options.permissions ?? []

  const declareLayer =
    declaredPermissions.length === 0
      ? Layer.empty
      : Layer.effectDiscard(
          Effect.gen(function* () {
            const registry = yield* PermissionRegistry
            for (const capability of declaredPermissions) {
              yield* registry
                .declare(capability, { source: "Desktop.workflowEngine", effect: "allow" })
                .pipe(Effect.orDie)
            }
          })
        )

  if (workflowLayers.length === 0) {
    return Layer.merge(WorkflowEngineMemory, declareLayer)
  }

  const merged = workflowLayers.reduce<Layer.Layer<never, E, RIn | WorkflowEngine.WorkflowEngine>>(
    (acc, wf) => Layer.merge(acc, wf),
    Layer.empty as Layer.Layer<never, E, RIn | WorkflowEngine.WorkflowEngine>
  )
  return Layer.merge(Layer.provideMerge(merged, WorkflowEngineMemory), declareLayer)
}

export const Desktop = Object.freeze({
  RedactionFilter,
  RpcCapability,
  RpcEndpoint,
  RpcSupport,
  layer: desktopLayer,
  workflowEngine,
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
