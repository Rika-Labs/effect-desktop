import { Api, Client, Handlers, RedactionFilter } from "@effect-desktop/bridge"
import { Effect, Layer } from "effect"

import type { NormalizedCapability } from "./runtime/permission-registry.js"
import { PermissionRegistry } from "./runtime/permission-registry.js"
import type { WorkflowLayer } from "./runtime/workflow.js"
import { WorkflowEngine, WorkflowEngineLive } from "./runtime/workflow.js"

export { Api, Client, Handlers, RedactionFilter, redact } from "@effect-desktop/bridge"
export { makeBridgeCallRegistry, makeBridgeStreamRegistry } from "@effect-desktop/bridge"
export type {
  BridgeCallRegistry,
  BridgeCallState,
  BridgeStreamRegistry,
  BridgeStreamRegistryEntry
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
export * from "./runtime/secrets-migration.js"
export * from "./runtime/settings.js"
export * from "./runtime/sqlite.js"
export * from "./runtime/transport.js"
export * from "./runtime/stdio-socket.js"
export * from "./runtime/postmessage-socket.js"
export * from "./runtime/telemetry.js"
export * from "./runtime/telemetry-otel.js"
export * from "./runtime/framework-metrics.js"
export * from "./runtime/window-state.js"
export * from "./runtime/reactivity.js"
export * from "./runtime/workflows/auto-save.js"
export * from "./runtime/workflows/backup.js"
export * from "./runtime/workflows/restore.js"

export interface DesktopAppOptions {
  readonly workflows?: readonly WorkflowLayer[]
  readonly permissions?: readonly NormalizedCapability[]
}

const app = (
  options: DesktopAppOptions = {}
): Layer.Layer<WorkflowEngine.WorkflowEngine, never, PermissionRegistry> => {
  const wfs = options.workflows ?? []
  const permissions = options.permissions ?? []

  const declareLayer = Layer.effectDiscard(
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
  Api,
  Client,
  Handlers,
  RedactionFilter,
  app
})
