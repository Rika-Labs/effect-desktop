import { Clock, Context, Effect, Layer, Schema, Stream } from "effect"

import {
  type InspectorCollectorsApi,
  InspectorCollectors,
  InspectorEvent
} from "./inspector-events.js"
import { InspectorTransport, type InspectorTransportApi } from "./inspector-transport.js"
import { InspectorTelemetryEvent, type TelemetryApi, Telemetry } from "./telemetry.js"

export const DesktopRuntimeEventSource = Schema.Literals(["inspector", "telemetry"])
export type DesktopRuntimeEventSource = typeof DesktopRuntimeEventSource.Type

export class DesktopRuntimeEvent extends Schema.Class<DesktopRuntimeEvent>("DesktopRuntimeEvent")({
  source: DesktopRuntimeEventSource,
  timestampMs: Schema.Number,
  inspector: Schema.optionalKey(InspectorEvent),
  telemetry: Schema.optionalKey(InspectorTelemetryEvent)
}) {}

export interface DesktopDevtoolsApi {
  readonly events: Stream.Stream<DesktopRuntimeEvent, never, never>
}

export class DesktopDevtools extends Context.Service<DesktopDevtools, DesktopDevtoolsApi>()(
  "@orika/core/runtime/desktop-devtools/DesktopDevtools"
) {}

export const makeDesktopDevtools = (
  collectors: InspectorCollectorsApi,
  telemetry: TelemetryApi
): DesktopDevtoolsApi =>
  DesktopDevtools.of({
    events: Stream.mergeAll(
      [
        collectors.events.pipe(
          Stream.mapEffect((event) =>
            inspectorTimestamp(event).pipe(
              Effect.map(
                (timestampMs) =>
                  new DesktopRuntimeEvent({
                    source: "inspector",
                    timestampMs,
                    inspector: event
                  })
              )
            )
          )
        ),
        telemetry.eventFeed.pipe(
          Stream.mapEffect((event) =>
            telemetryTimestamp(event).pipe(
              Effect.map(
                (timestampMs) =>
                  new DesktopRuntimeEvent({
                    source: "telemetry",
                    timestampMs,
                    telemetry: event
                  })
              )
            )
          )
        )
      ],
      { concurrency: 2 }
    )
  })

export const DesktopDevtoolsLive: Layer.Layer<
  DesktopDevtools,
  never,
  InspectorCollectors | Telemetry
> = Layer.effect(
  DesktopDevtools,
  Effect.gen(function* () {
    const collectors = yield* InspectorCollectors
    const telemetry = yield* Telemetry
    return makeDesktopDevtools(collectors, telemetry)
  })
)

export const DesktopDevtoolsTransportLive: Layer.Layer<
  never,
  never,
  DesktopDevtools | InspectorTransport
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const devtools = yield* DesktopDevtools
    const transport = yield* InspectorTransport
    yield* streamDevtoolsToTransport(devtools, transport).pipe(
      Effect.forkScoped({ startImmediately: true })
    )
  })
)

export const streamDevtoolsToTransport = (
  devtools: DesktopDevtoolsApi,
  transport: InspectorTransportApi
): Effect.Effect<void, never, never> =>
  devtools.events.pipe(
    Stream.runForEach((event) =>
      transport
        .publish({
          source: `runtime.${event.source}`,
          timestampMs: event.timestampMs,
          payload: event
        })
        .pipe(Effect.orDie)
    )
  )

const inspectorTimestamp = (event: InspectorEvent): Effect.Effect<number, never, never> =>
  event.execution?.timestamp !== undefined
    ? Effect.succeed(event.execution.timestamp)
    : event.filesystem?.timestamp !== undefined
      ? Effect.succeed(event.filesystem.timestamp)
      : event.nativeHost?.timestamp !== undefined
        ? Effect.succeed(event.nativeHost.timestamp)
        : event.persistence?.timestamp !== undefined
          ? Effect.succeed(event.persistence.timestamp)
          : event.workflow?.timestamp !== undefined
            ? Effect.succeed(event.workflow.timestamp)
            : event.eventLog?.timestamp !== undefined
              ? Effect.succeed(event.eventLog.timestamp)
              : event.renderer?.timestamp !== undefined
                ? Effect.succeed(event.renderer.timestamp)
                : Clock.currentTimeMillis

const telemetryTimestamp = (
  event: InspectorTelemetryEvent
): Effect.Effect<number, never, never> => {
  switch (event.kind) {
    case "log":
      return telemetryRecordTimestamp(event.record)
    case "trace":
      return telemetrySpanTimestamp(event.span)
    case "metric":
      return telemetryMetricTimestamp(event.metric)
    case "cause":
      return Effect.succeed(event.timestamp)
  }
}

const telemetryRecordTimestamp = (record: unknown): Effect.Effect<number, never, never> =>
  hasNumberProperty(record, "timestamp")
    ? Effect.succeed(record.timestamp)
    : Clock.currentTimeMillis

const telemetrySpanTimestamp = (span: unknown): Effect.Effect<number, never, never> => {
  if (hasNumberProperty(span, "endedAt")) {
    return Effect.succeed(span.endedAt)
  }
  if (hasNumberProperty(span, "startedAt")) {
    return Effect.succeed(span.startedAt)
  }
  return Clock.currentTimeMillis
}

const telemetryMetricTimestamp = (metric: unknown): Effect.Effect<number, never, never> =>
  hasNumberProperty(metric, "updatedAt")
    ? Effect.succeed(metric.updatedAt)
    : Clock.currentTimeMillis

const hasNumberProperty = <K extends string>(value: unknown, key: K): value is Record<K, number> =>
  typeof value === "object" &&
  value !== null &&
  key in value &&
  typeof Reflect.get(value, key) === "number"
