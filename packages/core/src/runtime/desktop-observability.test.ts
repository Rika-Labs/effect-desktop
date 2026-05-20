import { expect, test } from "bun:test"
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option } from "effect"

import {
  CollectorRegistry,
  DesktopObservability,
  DesktopObservabilityConfigError,
  Telemetry
} from "../index.js"

test("DesktopObservability off mode does not start collectors or retain telemetry", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let starts = 0

      const result = yield* runScoped(
        Effect.gen(function* () {
          const observability = yield* DesktopObservability
          const collectors = yield* CollectorRegistry
          const telemetry = yield* Telemetry
          yield* collectors.register({
            id: "worker",
            surface: "workers",
            start: Effect.sync(() => {
              starts += 1
            })
          })
          yield* telemetry.log({
            level: "info",
            subsystem: "runtime",
            operation: "observe",
            traceId: "trace-off",
            message: "disabled"
          })
          return {
            mode: observability.mode,
            transport: observability.transport,
            collectors: yield* collectors.list(),
            logs: yield* telemetry.listLogs()
          }
        }),
        DesktopObservability.layer({ mode: "off" })
      )

      expect(starts).toBe(0)
      expect(result.mode).toBe("off")
      expect(result.transport).toEqual(Option.none())
      expect(result.collectors).toEqual([])
      expect(result.logs).toEqual([])
    })
  ))

test("DesktopObservability embedded mode starts registered collectors", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let starts = 0

      const result = yield* runScoped(
        Effect.gen(function* () {
          const observability = yield* DesktopObservability
          const collectors = yield* CollectorRegistry
          yield* collectors.register({
            id: "workflow",
            surface: "workflows",
            start: Effect.sync(() => {
              starts += 1
            })
          })
          return {
            mode: observability.mode,
            transport: observability.transport,
            collectors: yield* collectors.list()
          }
        }),
        DesktopObservability.layer({ mode: "embedded-devtools" })
      )

      expect(starts).toBe(1)
      expect(result.mode).toBe("embedded-devtools")
      expect(result.transport).toEqual(
        Option.some({
          kind: "embedded-devtools",
          webSocketUrl: Option.none()
        })
      )
      expect(result.collectors).toEqual([{ id: "workflow", surface: "workflows", started: true }])
    })
  ))

test("DesktopObservability rejects invalid and underspecified standalone modes", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const invalidMode = yield* Effect.exit(
        Effect.scoped(Layer.build(DesktopObservability.layer({ mode: "unknown" })))
      )
      const missingUrl = yield* Effect.exit(
        Effect.scoped(Layer.build(DesktopObservability.layer({ mode: "standalone-inspector" })))
      )

      expectConfigError(invalidMode, "mode")
      expectConfigError(missingUrl, "webSocketUrl")
    })
  ))

const runScoped = <A, E, R, LE>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, LE, never>
): Effect.Effect<A, E | LE, never> =>
  Effect.gen(function* () {
    const runtime = ManagedRuntime.make(layer)
    const exit = yield* Effect.promise(() => runtime.runPromiseExit(effect))
    yield* Effect.promise(() => runtime.dispose())
    return yield* exit
  })

const expectConfigError = (
  exit: Exit.Exit<unknown, DesktopObservabilityConfigError>,
  field: string
): void => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const failure = exit.cause.reasons.find(Cause.isFailReason)
    expect(failure?.error).toBeInstanceOf(DesktopObservabilityConfigError)
    expect(failure?.error).toMatchObject({ field })
  }
}
