import {
  InspectorSafetyPolicy,
  type InspectorSafetyPolicyApi,
  type InspectorSafetySummary
} from "@effect-desktop/core"
import { Context, Effect, Layer, Logger, LogLevel, Option, Ref, Stream } from "effect"

import { positiveFrameInterval, positiveRowLimit } from "./panel-options.js"

export type LogsPanelLevel = "Trace" | "Debug" | "Info" | "Warning" | "Error" | "Fatal"

export interface LogsPanelRecord {
  readonly timestamp: number
  readonly level: LogsPanelLevel
  readonly message: string
  readonly fiber: string
  readonly safety: InspectorSafetySummary
}

export interface LogsPanelSnapshot {
  readonly records: readonly LogsPanelRecord[]
  readonly totalCount: number
  readonly levelFilter: LogsPanelLevel
  readonly safety: InspectorSafetySummary
}

export interface LogsPanelApi {
  readonly list: () => Effect.Effect<LogsPanelSnapshot, never, never>
  readonly setLevelFilter: (level: LogsPanelLevel) => Effect.Effect<void, never, never>
  readonly observe: () => Stream.Stream<LogsPanelSnapshot, never, never>
  readonly layer: () => Layer.Layer<never>
}

export interface LogsPanelOptions {
  readonly maxRows?: number
  readonly levelFilter?: LogsPanelLevel
  readonly frameInterval?: `${number} millis`
  readonly inspectorSafety?: InspectorSafetyPolicyApi
}

export class LogsPanel extends Context.Service<LogsPanel, LogsPanelApi>()(
  "@effect-desktop/devtools/LogsPanel"
) {}

export const LogsPanelLive = (
  options: LogsPanelOptions = {}
): Layer.Layer<LogsPanel, never, InspectorSafetyPolicy> =>
  Layer.effect(LogsPanel)(makeLogsPanel(options))

export const makeLogsPanel = (
  options: LogsPanelOptions = {}
): Effect.Effect<LogsPanelApi, never, InspectorSafetyPolicy> =>
  Effect.gen(function* () {
    const maxRows = positiveRowLimit(options.maxRows, 1_024)
    const frameInterval = positiveFrameInterval(options.frameInterval, "16 millis")
    const levelRef = yield* Ref.make<LogsPanelLevel>(options.levelFilter ?? "Debug")
    const inspectorSafety = options.inspectorSafety ?? (yield* InspectorSafetyPolicy)
    const buffer: LogsPanelRecord[] = []

    const captureLogger: Logger.Logger<unknown, void> = Logger.make(
      (opts: Logger.Options<unknown>) => {
        const level = logLevelToPanel(opts.logLevel)
        if (level === undefined) {
          return
        }
        const decision = inspectorSafety.sanitizeSync({
          source: "devtools.logs.record",
          payload: {
            timestamp: opts.date.getTime(),
            level,
            message: String(opts.message),
            fiber: String(opts.fiber.id)
          } satisfies Omit<LogsPanelRecord, "safety">
        })
        if (Option.isNone(decision.value)) {
          return
        }
        const record: LogsPanelRecord = {
          ...decision.value.value,
          safety: decision.summary
        }
        buffer.push(record)
        if (buffer.length > maxRows) {
          buffer.splice(0, buffer.length - maxRows)
        }
      }
    )

    const list = (): Effect.Effect<LogsPanelSnapshot, never, never> =>
      Effect.gen(function* () {
        const filter = yield* Ref.get(levelRef)
        const all = buffer.slice()
        const filtered = all.filter(
          (r: LogsPanelRecord) => levelOrder(r.level) >= levelOrder(filter)
        )
        return {
          records: filtered,
          totalCount: all.length,
          levelFilter: filter,
          safety: yield* inspectorSafety.snapshot()
        } satisfies LogsPanelSnapshot
      })

    return Object.freeze({
      list,
      setLevelFilter: (level) => Ref.set(levelRef, level),
      observe: () =>
        Stream.fromEffect(list()).pipe(
          Stream.concat(
            Stream.fromEffectRepeat(Effect.sleep(frameInterval).pipe(Effect.andThen(list())))
          )
        ),
      layer: () => Logger.layer([captureLogger])
    } satisfies LogsPanelApi)
  })

const logLevelToPanel = (level: LogLevel.LogLevel): LogsPanelLevel | undefined => {
  switch (level) {
    case "Trace":
      return "Trace"
    case "Debug":
      return "Debug"
    case "Info":
      return "Info"
    case "Warn":
      return "Warning"
    case "Error":
      return "Error"
    case "Fatal":
      return "Fatal"
    default:
      return undefined
  }
}

const LEVEL_ORDER: Record<LogsPanelLevel, number> = {
  Trace: 0,
  Debug: 1,
  Info: 2,
  Warning: 3,
  Error: 4,
  Fatal: 5
}

const levelOrder = (level: LogsPanelLevel): number => LEVEL_ORDER[level]
