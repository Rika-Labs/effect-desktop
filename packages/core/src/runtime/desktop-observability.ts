import { Context, Data, Effect, Layer, Option, Ref, Schema } from "effect"
import { DevTools } from "effect/unstable/devtools"

import {
  InspectorSafetyPolicy,
  type InspectorSafetyPolicyOptions,
  makeInspectorSafetyPolicy
} from "./inspector-safety-policy.js"
import { EffectTelemetryRuntimeLive, Telemetry, makeTelemetry } from "./telemetry.js"

export type DesktopObservabilityModeName = "off" | "embedded-devtools" | "standalone-inspector"

export class ObservabilityMode extends Schema.Class<ObservabilityMode>("ObservabilityMode")({
  mode: Schema.Literals(["off", "embedded-devtools", "standalone-inspector"])
}) {}

export class CollectorRegistrationInput extends Schema.Class<CollectorRegistrationInput>(
  "CollectorRegistrationInput"
)({
  id: Schema.NonEmptyString,
  surface: Schema.NonEmptyString
}) {}

export interface CollectorRegistrationOptions {
  readonly id: string
  readonly surface: string
  readonly start: Effect.Effect<void, never, never>
}

export interface CollectorRegistrationRecord {
  readonly id: string
  readonly surface: string
  readonly started: boolean
}

export interface CollectorRegistryApi {
  readonly register: (
    input: CollectorRegistrationOptions
  ) => Effect.Effect<void, DesktopObservabilityConfigError, never>
  readonly list: () => Effect.Effect<readonly CollectorRegistrationRecord[], never, never>
}

export interface DesktopObservabilityApi {
  readonly mode: DesktopObservabilityModeName
  readonly transport: Option.Option<DesktopObservabilityTransport>
}

export interface DesktopObservabilityTransport {
  readonly kind: "embedded-devtools" | "standalone-inspector"
  readonly webSocketUrl: Option.Option<string>
}

export interface DesktopObservabilityLayerOptions {
  readonly mode: string
  readonly webSocketUrl?: string | undefined
  readonly inspectorSafetyPolicy?: InspectorSafetyPolicyOptions
}

interface DecodedDesktopObservabilityLayerOptions extends Omit<
  DesktopObservabilityLayerOptions,
  "mode"
> {
  readonly mode: DesktopObservabilityModeName
}

export class DesktopObservabilityConfigError extends Data.TaggedError(
  "DesktopObservabilityConfigError"
)<{
  readonly field: string
  readonly message: string
}> {}

export class CollectorRegistry extends Context.Service<CollectorRegistry, CollectorRegistryApi>()(
  "CollectorRegistry"
) {}

export class DesktopObservability extends Context.Service<
  DesktopObservability,
  DesktopObservabilityApi
>()("DesktopObservability") {}

export const makeCollectorRegistry = (options: {
  readonly enabled: boolean
}): Effect.Effect<CollectorRegistryApi, never, never> =>
  Effect.gen(function* () {
    const records = yield* Ref.make<ReadonlyMap<string, CollectorRegistrationRecord>>(new Map())

    return Object.freeze({
      register: (input) =>
        Effect.gen(function* () {
          const decoded = yield* decodeCollectorRegistration(input)
          if (!options.enabled) {
            return
          }
          yield* decoded.start
          yield* Ref.update(records, (current) => {
            const next = new Map(current)
            next.set(decoded.id, {
              id: decoded.id,
              surface: decoded.surface,
              started: true
            })
            return next
          })
        }),
      list: () => Ref.get(records).pipe(Effect.map((current) => Array.from(current.values())))
    } satisfies CollectorRegistryApi)
  })

const layer = (
  options: DesktopObservabilityLayerOptions
): Layer.Layer<
  DesktopObservability | CollectorRegistry | InspectorSafetyPolicy | Telemetry,
  DesktopObservabilityConfigError,
  never
> =>
  Layer.unwrap(
    decodeOptions(options).pipe(
      Effect.map((decoded) => {
        const enabled = decoded.mode !== "off"
        const safetyOptions =
          decoded.mode === "off"
            ? {
                ...decoded.inspectorSafetyPolicy,
                mode: "production" as const,
                productionCapture: "disabled" as const
              }
            : decoded.inspectorSafetyPolicy
        const safetyLayer = Layer.effect(
          InspectorSafetyPolicy,
          makeInspectorSafetyPolicy(safetyOptions).pipe(
            Effect.mapError(
              (error) =>
                new DesktopObservabilityConfigError({
                  field: `inspectorSafetyPolicy.${error.field}`,
                  message: error.message
                })
            )
          )
        )
        const telemetryLayer = Layer.effect(
          Telemetry,
          Effect.gen(function* () {
            const inspectorSafety = yield* InspectorSafetyPolicy
            return yield* makeTelemetry({
              inspectorSafety,
              tracingEnabled: enabled
            }).pipe(
              Effect.mapError(
                (error) =>
                  new DesktopObservabilityConfigError({
                    field: `telemetry.${error.field}`,
                    message: error.message
                  })
              )
            )
          })
        )
        const collectorLayer = Layer.effect(CollectorRegistry, makeCollectorRegistry({ enabled }))
        const observabilityLayer = Layer.succeed(DesktopObservability)(
          Object.freeze({
            mode: decoded.mode,
            transport: transportFor(decoded)
          } satisfies DesktopObservabilityApi)
        )
        const telemetryWithObserverLayer = Layer.provideMerge(
          EffectTelemetryRuntimeLive,
          Layer.provide(telemetryLayer, safetyLayer)
        )
        const baseLayer = Layer.mergeAll(
          safetyLayer,
          telemetryWithObserverLayer,
          collectorLayer,
          observabilityLayer
        )

        return decoded.mode === "standalone-inspector"
          ? Layer.merge(baseLayer, DevTools.layer(decoded.webSocketUrl))
          : baseLayer
      })
    )
  )

export const DesktopObservabilityLive = layer

export namespace DesktopObservability {
  export const layer = DesktopObservabilityLive
}

const decodeOptions = (
  options: DesktopObservabilityLayerOptions
): Effect.Effect<DecodedDesktopObservabilityLayerOptions, DesktopObservabilityConfigError, never> =>
  Schema.decodeUnknownEffect(ObservabilityMode)(options).pipe(
    Effect.mapError(
      () =>
        new DesktopObservabilityConfigError({
          field: "mode",
          message: "must be one of off, embedded-devtools, standalone-inspector"
        })
    ),
    Effect.flatMap((decodedMode) => {
      const decoded: DecodedDesktopObservabilityLayerOptions = {
        ...options,
        mode: decodedMode.mode
      }
      return decoded.mode === "standalone-inspector" &&
        (decoded.webSocketUrl === undefined || decoded.webSocketUrl.length === 0)
        ? Effect.fail(
            new DesktopObservabilityConfigError({
              field: "webSocketUrl",
              message: "standalone inspector mode requires an explicit WebSocket URL"
            })
          )
        : Effect.succeed(decoded)
    })
  )

const decodeCollectorRegistration = (
  input: CollectorRegistrationOptions
): Effect.Effect<CollectorRegistrationOptions, DesktopObservabilityConfigError, never> =>
  Schema.decodeUnknownEffect(CollectorRegistrationInput)(input).pipe(
    Effect.as(input),
    Effect.mapError(
      () =>
        new DesktopObservabilityConfigError({
          field: "collector",
          message: "collector id and surface must be non-empty strings"
        })
    )
  )

const transportFor = (
  options: DecodedDesktopObservabilityLayerOptions
): Option.Option<DesktopObservabilityTransport> => {
  if (options.mode === "off") {
    return Option.none()
  }
  if (options.mode === "embedded-devtools") {
    return Option.some({
      kind: "embedded-devtools",
      webSocketUrl: Option.none()
    })
  }
  const webSocketUrl = options.webSocketUrl
  if (webSocketUrl === undefined) {
    return Option.none()
  }
  return Option.some({
    kind: "standalone-inspector",
    webSocketUrl: Option.some(webSocketUrl)
  })
}
