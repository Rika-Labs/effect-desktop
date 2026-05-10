import { Config, Context, Data, Effect, Layer } from "effect"

import type { ApiContractClass, ApiContractSpec } from "@effect-desktop/bridge"

import { DesktopLoggerLayer } from "./logger.js"
import { BunServicesLayer } from "./platform.js"
import { PermissionRegistry, makePermissionRegistry } from "./permission-registry.js"
import type { NormalizedCapability } from "./permission-registry.js"
import { ReactivityLayer } from "./reactivity.js"
import { ResourceRegistryLive } from "./resources.js"
import { Telemetry, makeTelemetry } from "./telemetry.js"
import { WorkflowEngineLive } from "./workflow.js"
import type { WorkflowLayer } from "./workflow.js"

export interface WindowSpec {
  readonly title: string
  readonly width: number
  readonly height: number
}

export interface AnyApiLayer {
  readonly contract: ApiContractClass<string, ApiContractSpec>
  readonly handlers: object
}

export interface DesktopConfig<RIn = never, E = never> {
  readonly id: string
  readonly windows: Readonly<Record<string, WindowSpec>>
  readonly handlers?: ReadonlyArray<AnyApiLayer>
  readonly layers?: ReadonlyArray<Layer.Layer<unknown, E, RIn>>
  readonly permissions?: ReadonlyArray<NormalizedCapability>
  readonly workflows?: ReadonlyArray<WorkflowLayer>
}

export class DesktopConfigError extends Data.TaggedError("DesktopConfigError")<{
  readonly appId: string
  readonly reason: "missing-permission" | "invalid-config"
  readonly message: string
  readonly contract?: string
  readonly method?: string
  readonly permission?: string
}> {}

export interface DesktopAppApi {
  readonly appId: string
  readonly windows: Readonly<Record<string, WindowSpec>>
}

export class DesktopApp extends Context.Service<DesktopApp, DesktopAppApi>()("DesktopApp") {}

const TelemetryLive: Layer.Layer<Telemetry, never, never> = Layer.effect(Telemetry)(
  makeTelemetry().pipe(Effect.orDie)
)

const PermissionRegistryLive: Layer.Layer<PermissionRegistry, never, never> =
  Layer.effect(PermissionRegistry)(makePermissionRegistry())

const coreServicesLayer: Layer.Layer<never, Config.ConfigError, never> = Layer.mergeAll(
  ResourceRegistryLive,
  TelemetryLive,
  PermissionRegistryLive,
  ReactivityLayer,
  DesktopLoggerLayer,
  BunServicesLayer,
  WorkflowEngineLive
)

export const app = <RIn = never, E = never>(
  config: DesktopConfig<RIn, E>
): Layer.Layer<DesktopApp, DesktopConfigError | E, RIn> => {
  const validationLayer = Layer.effectDiscard(checkPermissions(config))
  const spine = buildSpine(config)
  return Layer.provideMerge(validationLayer, spine) as unknown as Layer.Layer<
    DesktopApp,
    DesktopConfigError | E,
    RIn
  >
}

export const launch = (
  layer: Layer.Layer<DesktopApp, DesktopConfigError, never>
): Effect.Effect<never, DesktopConfigError, never> => Layer.launch(layer)

const checkPermissions = <RIn, E>(
  config: DesktopConfig<RIn, E>
): Effect.Effect<void, DesktopConfigError, never> => {
  const declared = config.permissions ?? []
  const handlers = config.handlers ?? []

  for (const apiLayer of handlers) {
    for (const [method, spec] of Object.entries(apiLayer.contract.spec)) {
      const required = spec.permission
      if (required === undefined) {
        continue
      }

      const covered = declared.some((cap) => cap.kind === required)
      if (!covered) {
        return Effect.fail(
          new DesktopConfigError({
            appId: config.id,
            reason: "missing-permission",
            message: `RPC method "${apiLayer.contract.tag}.${method}" requires capability "${required}" but it is not declared in config.permissions`,
            contract: apiLayer.contract.tag,
            method,
            permission: required
          })
        )
      }
    }
  }

  return Effect.void
}

const buildSpine = <RIn, E>(config: DesktopConfig<RIn, E>): Layer.Layer<DesktopApp, E, RIn> => {
  const wfs = config.workflows ?? []
  const userLayers = config.layers ?? []

  const workflowLayer: Layer.Layer<never, never, never> =
    wfs.length === 0
      ? Layer.empty
      : wfs.reduce<Layer.Layer<never, never, never>>(
          (acc, wf) => Layer.merge(acc, wf as Layer.Layer<never, never, never>),
          Layer.empty
        )

  const baseServices: Layer.Layer<never, Config.ConfigError, never> = Layer.merge(
    coreServicesLayer,
    workflowLayer
  )

  const services: Layer.Layer<never, E, RIn> =
    userLayers.length === 0
      ? (baseServices as unknown as Layer.Layer<never, E, RIn>)
      : userLayers.reduce<Layer.Layer<never, E, RIn>>(
          (acc, layer) => Layer.merge(acc, layer as Layer.Layer<never, E, RIn>),
          baseServices as unknown as Layer.Layer<never, E, RIn>
        )

  const desktopAppLayer: Layer.Layer<DesktopApp, never, never> = Layer.effect(DesktopApp)(
    Effect.succeed({
      appId: config.id,
      windows: config.windows
    })
  )

  return Layer.provideMerge(desktopAppLayer, services)
}
