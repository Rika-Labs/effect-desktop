import { RedactionFilter, RpcCapability, RpcEndpoint, RpcSupport } from "@effect-desktop/bridge"
import { Effect, Layer } from "effect"
import { WorkflowEngine } from "effect/unstable/workflow"

import {
  Rpcs,
  app as desktopApp,
  launch,
  make,
  manifest,
  providerLayerFor,
  runtime,
  runtimeGraph,
  runtimeGraphSnapshot
} from "./runtime/desktop-app.js"
import type {
  DesktopApp,
  DesktopConfig,
  DesktopConfigError,
  DesktopRuntimeProviderServices,
  DesktopWorkflowLayer
} from "./runtime/desktop-app.js"
import { DesktopRpc } from "./runtime/desktop-rpc-surface.js"
import type { NormalizedCapability } from "./runtime/permission-registry.js"
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
export * from "./runtime/pty.js"
export * from "./runtime/worker.js"
export * from "./runtime/permission-registry.js"
export * from "./runtime/permission-interceptor.js"
export * from "./runtime/permission-approval-workflow.js"
export * from "./runtime/secrets.js"
export * from "./runtime/settings.js"
export * from "./runtime/sqlite.js"
export * from "./runtime/telemetry.js"
export * from "./runtime/inspector-events.js"
export * from "./runtime/inspector-safety-policy.js"
export * from "./runtime/inspector-security-events.js"
export * from "./runtime/desktop-observability.js"
export * from "./runtime/inspector-transport.js"
export * from "./runtime/desktop-errors.js"
export * from "./runtime/desktop-rpc-surface.js"
export {
  DesktopApp,
  app as desktopApp,
  launch,
  layerGraphSnapshotFromGraph,
  make,
  manifest,
  providerLayerFor,
  runtime,
  runtimeGraph,
  runtimeGraphSnapshot,
  Rpcs,
  type AnyDesktopRpcLayer,
  type DesktopAppApi,
  type DesktopAppDescriptor,
  type DesktopAppManifest,
  type DesktopConfig,
  type DesktopMakeConfig,
  type DesktopManifestSource,
  type DesktopProviderBudget,
  type DesktopProviderSelection,
  type DesktopRpcGroupDescriptor,
  type DesktopRpcLayer,
  type DesktopRuntimeApi,
  type DesktopRuntimeGraph,
  type DesktopRuntimeGraphNode,
  type DesktopRuntimeGraphNodeKind,
  type DesktopRuntimeProviderId,
  type DesktopRuntimeProviderServices,
  type DesktopRuntimeSelectedProviders,
  type DesktopRuntimeServices,
  type DesktopWorkflowLayer,
  LayerFailurePayload,
  LayerGraphNodeSnapshot,
  LayerGraphSnapshot,
  ProviderFact,
  type WindowSpec
} from "./runtime/desktop-app.js"
export { DesktopRuntime, DesktopRuntimeLive } from "./runtime/desktop-app.js"
export { DesktopConfigError as DesktopSpineConfigError } from "./runtime/desktop-app.js"

export interface DesktopAppOptions {
  readonly workflows?: readonly DesktopWorkflowLayer[]
  readonly permissions?: readonly NormalizedCapability[]
}

interface DesktopAppOptionsWithPermissions extends DesktopAppOptions {
  readonly permissions: readonly NormalizedCapability[]
}

function app(): Layer.Layer<WorkflowEngine.WorkflowEngine, never, never>
function app<RIn = never, E = never>(
  config: DesktopConfig<RIn, E>
): Layer.Layer<DesktopApp, DesktopConfigError | E, Exclude<RIn, DesktopRuntimeProviderServices>>
function app(
  options: DesktopAppOptionsWithPermissions
): Layer.Layer<WorkflowEngine.WorkflowEngine, never, PermissionRegistry>
function app<RIn = never, E = never>(
  options: DesktopAppOptions | DesktopConfig<RIn, E> = {}
):
  | Layer.Layer<WorkflowEngine.WorkflowEngine, never, never>
  | Layer.Layer<WorkflowEngine.WorkflowEngine, never, PermissionRegistry>
  | Layer.Layer<DesktopApp, DesktopConfigError | E, Exclude<RIn, DesktopRuntimeProviderServices>> {
  if ("id" in options) {
    return desktopApp(options as DesktopConfig)
  }

  const wfs = options.workflows ?? []
  const permissions = options.permissions ?? []

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

  if (wfs.length === 0) {
    return Layer.merge(WorkflowEngine.layerMemory, declareLayer)
  }

  const merged = wfs.reduce<Layer.Layer<never, never, WorkflowEngine.WorkflowEngine>>(
    (acc, wf) => Layer.merge(acc, wf),
    Layer.empty as Layer.Layer<never, never, WorkflowEngine.WorkflowEngine>
  )
  return Layer.merge(Layer.provideMerge(merged, WorkflowEngine.layerMemory), declareLayer)
}

export const Desktop = Object.freeze({
  RedactionFilter,
  RpcCapability,
  RpcEndpoint,
  RpcSupport,
  app,
  launch,
  make,
  manifest,
  providerLayerFor,
  Rpc: DesktopRpc,
  runtime,
  runtimeGraph,
  runtimeGraphSnapshot,
  Rpcs,
  describeRpcs
})
