import { expect, test } from "bun:test"
import {
  type HostProtocolEnvelope,
  HostProtocolResponseEnvelope,
  type HostProtocolRequestEnvelope,
  HostProtocolStreamByRequestEnvelope,
  makeDesktopClientProtocol,
  rpcSupport
} from "@orika/bridge"
import { Effect, Exit, Layer, ManagedRuntime, Option, Queue, Schema, Stream } from "effect"
import { RpcClient, RpcSchema } from "effect/unstable/rpc"

import {
  ScreenBounds,
  ScreenDisplay,
  ScreenDisplaysChangedEvent,
  ScreenDisplaysResult
} from "./contracts/screen.js"
import { ScreenClient, ScreenRpcs, ScreenSurface } from "./screen.js"

test("Screen public surface omits the side event object", async () => {
  const screenModule = await import("./screen.js")
  const rootModule = await import("./index.js")

  expect("ScreenRpcEvents" in screenModule).toBe(false)
  expect("ScreenRpcEvents" in rootModule).toBe(false)
})

test("Screen event schema is owned by the RPC stream contract", () => {
  const callableTags = Array.from(ScreenRpcs.requests.keys()).toSorted()
  expect(callableTags).toEqual([
    "Screen.events.DisplaysChanged",
    "Screen.getDisplays",
    "Screen.getPointerPoint",
    "Screen.getPrimaryDisplay",
    "Screen.isSupported"
  ])

  const eventRpc = ScreenRpcs.requests.get("Screen.events.DisplaysChanged")
  expect(eventRpc).toBeDefined()
  expect(eventRpc === undefined ? false : RpcSchema.isStreamSchema(eventRpc.successSchema)).toBe(
    true
  )
  if (eventRpc !== undefined && RpcSchema.isStreamSchema(eventRpc.successSchema)) {
    expect(eventRpc.successSchema.success).toBe(ScreenDisplaysChangedEvent)
    expect(eventRpc.pipe(rpcSupport)).toEqual({ status: "supported" })
  }

  const eventDoc = ScreenSurface.schemaDocs.find(
    (doc) => doc.tag === "Screen.events.DisplaysChanged"
  )
  expect(eventDoc?.kind).toBe("stream")
  expect(eventDoc?.callable).toBe(true)
  expect(eventDoc?.support).toEqual({ status: "supported" })
})

test("Screen direct client consumes the canonical RPC event stream", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const payload = {
        displays: [screenDisplay({ id: "display-1", primary: true })]
      }
      const result = yield* directScreenDisplaysChangedEvent(payload)

      expect(result.event).toMatchObject(payload)
      expect(result.methods).toEqual(["Screen.events.DisplaysChanged"])
    })
  ))

test("Screen display list payloads require exactly one primary display", () => {
  const invalidDisplayLists = [
    [],
    [
      screenDisplay({
        id: "display-1",
        primary: false
      })
    ],
    [
      screenDisplay({
        id: "display-1",
        primary: true
      }),
      screenDisplay({
        id: "display-2",
        primary: true
      })
    ]
  ] as const

  for (const displays of invalidDisplayLists) {
    const resultExit = Effect.runSyncExit(
      Schema.decodeUnknownEffect(ScreenDisplaysResult)({ displays })
    )
    expect(Exit.isFailure(resultExit)).toBe(true)

    const eventExit = Effect.runSyncExit(
      Schema.decodeUnknownEffect(ScreenDisplaysChangedEvent)({ displays })
    )
    expect(Exit.isFailure(eventExit)).toBe(true)
  }

  const validDisplays = [
    screenDisplay({
      id: "display-1",
      primary: true
    }),
    screenDisplay({
      id: "display-2",
      primary: false
    })
  ] as const

  expect(
    Exit.isSuccess(
      Effect.runSyncExit(
        Schema.decodeUnknownEffect(ScreenDisplaysResult)({ displays: validDisplays })
      )
    )
  ).toBe(true)
  expect(
    Exit.isSuccess(
      Effect.runSyncExit(
        Schema.decodeUnknownEffect(ScreenDisplaysChangedEvent)({ displays: validDisplays })
      )
    )
  ).toBe(true)
})

const screenBounds = new ScreenBounds({ x: 0, y: 0, width: 1920, height: 1080 })

const screenDisplay = ({
  id,
  primary
}: {
  readonly id: string
  readonly primary: boolean
}): ScreenDisplay =>
  new ScreenDisplay({
    id,
    bounds: screenBounds,
    workArea: screenBounds,
    scaleFactor: 2,
    primary
  })

const directScreenDisplaysChangedEvent = (payload: unknown) =>
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
          nextRequestId: () => "screen-displays-event-request",
          nextTraceId: () => "screen-displays-event-trace"
        }
      )
    )

    const event = yield* runScoped(
      Effect.gen(function* () {
        const client = yield* ScreenClient
        return yield* client.onDisplaysChanged().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
      }),
      Layer.provide(ScreenSurface.clientLayer, protocolLayer)
    )

    return {
      event,
      methods: requests.map((request) => request.method)
    }
  })

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
