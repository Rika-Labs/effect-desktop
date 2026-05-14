import { Context, Effect, Layer, Schema, Stream } from "effect"

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
  "@effect-desktop/core/DesktopDevtools"
) {}

export const makeDesktopDevtools = (
  collectors: InspectorCollectorsApi,
  telemetry: TelemetryApi
): DesktopDevtoolsApi =>
  DesktopDevtools.of({
    events: Stream.mergeAll(
      [
        collectors.events.pipe(
          Stream.map(
            (event) =>
              new DesktopRuntimeEvent({
                source: "inspector",
                timestampMs: inspectorTimestamp(event),
                inspector: event
              })
          )
        ),
        telemetry.eventFeed.pipe(
          Stream.map(
            (event) =>
              new DesktopRuntimeEvent({
                source: "telemetry",
                timestampMs: telemetryTimestamp(event),
                telemetry: event
              })
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

const inspectorTimestamp = (event: InspectorEvent): number =>
  event.execution?.timestamp ??
  event.filesystem?.timestamp ??
  event.nativeHost?.timestamp ??
  event.persistence?.timestamp ??
  event.workflow?.timestamp ??
  event.eventLog?.timestamp ??
  event.renderer?.timestamp ??
  Date.now()

const telemetryTimestamp = (event: InspectorTelemetryEvent): number => {
  switch (event.kind) {
    case "log":
      return telemetryRecordTimestamp(event.record)
    case "trace":
      return telemetrySpanTimestamp(event.span)
    case "metric":
      return telemetryMetricTimestamp(event.metric)
    case "cause":
      return event.timestamp
  }
}

const telemetryRecordTimestamp = (record: unknown): number =>
  hasNumberProperty(record, "timestamp") ? record.timestamp : Date.now()

const telemetrySpanTimestamp = (span: unknown): number => {
  if (hasNumberProperty(span, "endedAt")) {
    return span.endedAt
  }
  if (hasNumberProperty(span, "startedAt")) {
    return span.startedAt
  }
  return Date.now()
}

const telemetryMetricTimestamp = (metric: unknown): number =>
  hasNumberProperty(metric, "updatedAt") ? metric.updatedAt : Date.now()

const hasNumberProperty = <K extends string>(value: unknown, key: K): value is Record<K, number> =>
  typeof value === "object" &&
  value !== null &&
  key in value &&
  typeof Reflect.get(value, key) === "number"
