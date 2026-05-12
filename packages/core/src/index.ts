import { RedactionFilter, RpcCapability, RpcEndpoint, RpcSupport } from "@effect-desktop/bridge"
import { Effect, Layer } from "effect"

import {
  Rpcs,
  app as desktopApp,
  launch,
  make,
  manifest,
  provide,
  toLayer
} from "./runtime/desktop-app.js"
import type { DesktopApp, DesktopConfig, DesktopConfigError } from "./runtime/desktop-app.js"
import type { NormalizedCapability } from "./runtime/permission-registry.js"
import { PermissionRegistry } from "./runtime/permission-registry.js"
import { describeRpcs } from "./runtime/rpc-descriptors.js"
import type { WorkflowLayer } from "./runtime/workflow.js"
import { WorkflowEngine, WorkflowEngineLive } from "./runtime/workflow.js"

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
export * from "./runtime/logger.js"
export * from "./runtime/resources.js"
export * from "./runtime/platform.js"
export * from "./runtime/filesystem.js"
export * from "./runtime/event-log.js"
export * from "./runtime/audit-events.js"
export * from "./runtime/approval-broker.js"
export * from "./runtime/commands.js"
export * from "./runtime/process.js"
export * from "./runtime/pty.js"
export * from "./runtime/worker.js"
export * from "./runtime/workflow.js"
export * from "./runtime/permission-registry.js"
export * from "./runtime/permission-interceptor.js"
export * from "./runtime/permission-approval-workflow.js"
export * from "./runtime/secrets.js"
export * from "./runtime/settings.js"
export * from "./runtime/sqlite.js"
export * from "./runtime/telemetry.js"
export * from "./runtime/desktop-errors.js"
export * from "./runtime/reactivity.js"
export {
  DesktopApp,
  app as desktopApp,
  launch,
  make,
  manifest,
  provide,
  Rpcs,
  toLayer,
  type AnyDesktopRpcLayer,
  type DesktopAppApi,
  type DesktopAppDefinition,
  type DesktopAppManifest,
  type DesktopConfig,
  type DesktopMakeConfig,
  type DesktopRpcGroupDescriptor,
  type DesktopRpcLayer,
  type WindowSpec
} from "./runtime/desktop-app.js"
export { DesktopConfigError as DesktopSpineConfigError } from "./runtime/desktop-app.js"

export interface DesktopAppOptions {
  readonly workflows?: readonly WorkflowLayer[]
  readonly permissions?: readonly NormalizedCapability[]
}

interface DesktopAppOptionsWithPermissions extends DesktopAppOptions {
  readonly permissions: readonly NormalizedCapability[]
}

function app(): Layer.Layer<WorkflowEngine.WorkflowEngine, never, never>
function app(
  options: DesktopAppOptionsWithPermissions
): Layer.Layer<WorkflowEngine.WorkflowEngine, never, PermissionRegistry>
function app<RIn = never, E = never>(
  config: DesktopConfig<RIn, E>
): Layer.Layer<DesktopApp, DesktopConfigError | E, RIn>
function app<RIn = never, E = never>(
  options: DesktopAppOptions | DesktopConfig<RIn, E> = {}
):
  | Layer.Layer<WorkflowEngine.WorkflowEngine, never, never>
  | Layer.Layer<WorkflowEngine.WorkflowEngine, never, PermissionRegistry>
  | Layer.Layer<DesktopApp, DesktopConfigError | E, RIn> {
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
    return Layer.merge(WorkflowEngineLive, declareLayer)
  }

  const merged = wfs.reduce<Layer.Layer<never, never, WorkflowEngine.WorkflowEngine>>(
    (acc, wf) => Layer.merge(acc, wf),
    Layer.empty as Layer.Layer<never, never, WorkflowEngine.WorkflowEngine>
  )
  return Layer.merge(Layer.provideMerge(merged, WorkflowEngineLive), declareLayer)
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
  provide,
  Rpcs,
  toLayer,
  describeRpcs
})
