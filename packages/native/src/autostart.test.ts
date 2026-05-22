import { expect, test } from "bun:test"
import {
  type BridgeClientExchange,
  HostProtocolEventEnvelope,
  HostProtocolInvalidOutputError
} from "@orika/bridge"
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option, Schema, Stream } from "effect"

import { Autostart, AutostartLive, makeAutostartBridgeClientLayer } from "./autostart.js"
import { AutostartEvent } from "./contracts/autostart.js"

test("Autostart contracts reject inconsistent event phase payloads", () => {
  for (const payload of [
    { phase: "checked" },
    { phase: "enabled" },
    {
      phase: "disabled",
      mechanism: "linux-xdg-autostart",
      reason: "host adapter failed"
    },
    { phase: "failed" }
  ] as const) {
    const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(AutostartEvent)(payload))
    expect(exit._tag).toBe("Failure")
  }

  for (const payload of [
    { phase: "checked", mechanism: "linux-xdg-autostart" },
    { phase: "enabled", mechanism: "linux-xdg-autostart" },
    { phase: "disabled", mechanism: "linux-xdg-autostart" },
    {
      phase: "failed",
      mechanism: "unsupported",
      reason: "host adapter unavailable"
    },
    { phase: "failed", reason: "host adapter unavailable" }
  ] as const) {
    const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(AutostartEvent)(payload))
    expect(exit._tag).toBe("Success")
  }
})

test("Autostart bridge client rejects inconsistent event phase payloads as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exchange: BridgeClientExchange = {
        request: () => Effect.die("Autostart event test does not issue bridge requests"),
        subscribe: (method) =>
          Stream.make(
            new HostProtocolEventEnvelope({
              kind: "event",
              method,
              timestamp: 1_710_000_000_000,
              traceId: "autostart-event-trace",
              payload: {
                phase: "enabled",
                reason: "bad shape"
              }
            })
          )
      }
      const exit = yield* runScoped(
        Effect.gen(function* () {
          const autostart = yield* Autostart
          return yield* Effect.exit(
            autostart.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
          )
        }),
        Layer.provide(AutostartLive, makeAutostartBridgeClientLayer(exchange))
      )

      expectInvalidOutput(exit)
    })
  ))

const runScoped = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, never, never>
): Effect.Effect<A, E, never> =>
  Effect.gen(function* () {
    const runtime = ManagedRuntime.make(layer)
    const result = yield* Effect.promise(() => runtime.runPromise(effect))
    yield* Effect.promise(() => runtime.dispose())
    return result
  })

const expectInvalidOutput = <A, E>(exit: Exit.Exit<A, E>): void => {
  expect(exit._tag).toBe("Failure")
  if (exit._tag !== "Failure") {
    return
  }

  expect(Cause.squash(exit.cause)).toBeInstanceOf(HostProtocolInvalidOutputError)
}
