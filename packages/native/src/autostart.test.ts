import { expect, test } from "bun:test"
import {
  type BridgeClientExchange,
  type HostProtocolEnvelope,
  HostProtocolEventEnvelope,
  HostProtocolInvalidOutputError,
  type HostProtocolRequestEnvelope,
  HostProtocolResponseEnvelope,
  HostProtocolStreamByRequestEnvelope,
  makeDesktopClientProtocol,
  rpcSupport
} from "@orika/bridge"
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option, Queue, Schema, Stream } from "effect"
import { RpcClient, RpcSchema } from "effect/unstable/rpc"

import {
  Autostart,
  AutostartClient,
  AutostartLive,
  AutostartRpcs,
  AutostartSurface
} from "./autostart.js"
import { AutostartEvent } from "./contracts/autostart.js"

test("Autostart event schema is owned by the RPC stream contract", async () => {
  const autostartModule = await import("./autostart.js")
  const eventRpc = AutostartRpcs.requests.get("Autostart.events.Event")

  expect("AutostartRpcEvents" in autostartModule).toBe(false)
  expect(eventRpc).toBeDefined()
  expect(eventRpc === undefined ? false : RpcSchema.isStreamSchema(eventRpc.successSchema)).toBe(
    true
  )
  if (eventRpc !== undefined && RpcSchema.isStreamSchema(eventRpc.successSchema)) {
    expect(eventRpc.successSchema.success).toBe(AutostartEvent)
    expect(eventRpc.pipe(rpcSupport)).toEqual({ status: "supported" })
  }

  const eventDoc = AutostartSurface.schemaDocs.find((doc) => doc.tag === "Autostart.events.Event")
  expect(eventDoc?.kind).toBe("stream")
  expect(eventDoc?.callable).toBe(true)
  expect(eventDoc?.support).toEqual({ status: "supported" })
})

test("Autostart direct client consumes the canonical RPC event stream", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<HostProtocolEnvelope>()
      const requests: HostProtocolRequestEnvelope[] = []
      const protocolLayer = Layer.effect(RpcClient.Protocol)(
        makeDesktopClientProtocol(
          {
            send: (envelope) => {
              if (envelope.kind !== "request") {
                return Effect.void
              }
              requests.push(envelope)
              return Effect.all(
                [
                  Queue.offer(
                    queue,
                    new HostProtocolStreamByRequestEnvelope({
                      kind: "stream",
                      id: envelope.id,
                      timestamp: 1_710_000_000_001,
                      traceId: envelope.traceId,
                      payload: { phase: "checked", mechanism: "macos-login-item" }
                    })
                  ),
                  Queue.offer(
                    queue,
                    new HostProtocolResponseEnvelope({
                      kind: "response",
                      id: envelope.id,
                      timestamp: 1_710_000_000_002,
                      traceId: envelope.traceId
                    })
                  )
                ],
                { discard: true }
              )
            },
            run: (onEnvelope) =>
              Stream.fromQueue(queue).pipe(
                Stream.runForEach(onEnvelope),
                Effect.andThen(Effect.never)
              )
          },
          {
            nextRequestId: () => "autostart-event-rpc",
            nextTraceId: () => "trace-autostart-event-rpc"
          }
        )
      )

      const event = yield* runScoped(
        Effect.gen(function* () {
          const autostart = yield* AutostartClient
          return yield* autostart.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
        }),
        Layer.provide(AutostartSurface.clientLayer, protocolLayer)
      )

      expect(event).toEqual(new AutostartEvent({ phase: "checked", mechanism: "macos-login-item" }))
      expect(requests.map((request) => request.method)).toEqual(["Autostart.events.Event"])
    })
  ))

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
        Layer.provide(AutostartLive, AutostartSurface.bridgeClientLayer(exchange))
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
