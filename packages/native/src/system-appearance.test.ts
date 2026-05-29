import { expect, test } from "bun:test"
import {
  type HostProtocolEnvelope,
  type HostProtocolError,
  HostProtocolResponseEnvelope,
  type HostProtocolRequestEnvelope,
  HostProtocolStreamByRequestEnvelope,
  makeDesktopClientProtocol,
  makeHostProtocolHostUnavailableError,
  rpcSupport
} from "@orika/bridge"
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option, Queue, Stream } from "effect"
import { RpcClient, RpcClientError, RpcSchema } from "effect/unstable/rpc"

import {
  SystemAppearanceChangedEvent,
  SystemAppearanceColor
} from "./contracts/system-appearance.js"
import {
  SystemAppearance,
  SystemAppearanceRpcs,
  SystemAppearanceSnapshotSupport,
  SystemAppearanceSurface
} from "./system-appearance.js"

test("SystemAppearance public surface omits the side event object", async () => {
  const appearanceModule = await import("./system-appearance.js")
  const rootModule = await import("./index.js")

  expect("SystemAppearanceRpcEvents" in appearanceModule).toBe(false)
  expect("SystemAppearanceRpcEvents" in rootModule).toBe(false)
})

test("SystemAppearance event schema is owned by the RPC stream contract", () => {
  const eventRpc = SystemAppearanceRpcs.requests.get("SystemAppearance.events.AppearanceChanged")
  expect(eventRpc).toBeDefined()
  expect(eventRpc === undefined ? false : RpcSchema.isStreamSchema(eventRpc.successSchema)).toBe(
    true
  )
  if (eventRpc !== undefined && RpcSchema.isStreamSchema(eventRpc.successSchema)) {
    expect(eventRpc.successSchema.success).toBe(SystemAppearanceChangedEvent)
    expect(eventRpc.pipe(rpcSupport)).toEqual(SystemAppearanceSnapshotSupport)
  }

  const eventDoc = SystemAppearanceSurface.schemaDocs.find(
    (doc) => doc.tag === "SystemAppearance.events.AppearanceChanged"
  )
  expect(eventDoc?.kind).toBe("stream")
  expect(eventDoc?.callable).toBe(true)
  expect(eventDoc?.support).toEqual(SystemAppearanceSnapshotSupport)
})

test("SystemAppearance direct client consumes the canonical RPC event stream", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const payload = {
        appearance: "dark",
        accentColor: { r: 0.1, g: 0.2, b: 0.3, a: 1 },
        reducedMotion: true,
        reducedTransparency: false
      }
      const result = yield* directSystemAppearanceChangedEvent(payload)

      expect(result.event).toEqual(
        new SystemAppearanceChangedEvent({
          appearance: "dark",
          accentColor: new SystemAppearanceColor({ r: 0.1, g: 0.2, b: 0.3, a: 1 }),
          reducedMotion: true,
          reducedTransparency: false
        })
      )
      expect(result.methods).toEqual(["SystemAppearance.events.AppearanceChanged"])
    })
  ))

const directSystemAppearanceChangedEvent = (payload: unknown) =>
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
                    payload
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
          nextRequestId: () => "system-appearance-event-request",
          nextTraceId: () => "system-appearance-event-trace"
        }
      )
    )

    const event = yield* runScoped(
      Effect.gen(function* () {
        const appearance = yield* SystemAppearance
        return yield* appearance
          .onAppearanceChanged()
          .pipe(Stream.runHead, Effect.map(Option.getOrThrow))
      }),
      Layer.provide(SystemAppearance.layer, SystemAppearanceSurface.clientLayer).pipe(
        Layer.provide(protocolLayer)
      )
    )

    return {
      event,
      methods: requests.map((request) => request.method)
    }
  })

test("SystemAppearance preserves the host error tag and recoverable flag through the RPC client", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const hostFailure = makeHostProtocolHostUnavailableError("SystemAppearance.getAppearance")
      const exit = yield* runScoped(
        Effect.gen(function* () {
          const appearance = yield* SystemAppearance
          return yield* Effect.exit(appearance.getAppearance())
        }),
        Layer.provide(SystemAppearance.layer, SystemAppearanceSurface.clientLayer).pipe(
          Layer.provide(protocolLayerFailingSend(wrapHostError(hostFailure)))
        )
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(Cause.squash(exit.cause)).toMatchObject({
          tag: "HostUnavailable",
          recoverable: true,
          operation: "SystemAppearance.getAppearance"
        })
      }
    })
  ))

const wrapHostError = (error: HostProtocolError): RpcClientError.RpcClientError =>
  new RpcClientError.RpcClientError({
    reason: new RpcClientError.RpcClientDefect({ message: error.message, cause: error })
  })

const protocolLayerFailingSend = (
  failure: RpcClientError.RpcClientError
): Layer.Layer<RpcClient.Protocol> =>
  Layer.effect(RpcClient.Protocol)(
    RpcClient.Protocol.make((_write, _clientIds) =>
      Effect.succeed({
        send: () => Effect.fail(failure),
        supportsAck: false,
        supportsTransferables: false
      })
    )
  )

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
