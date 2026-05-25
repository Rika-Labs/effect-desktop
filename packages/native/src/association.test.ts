import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import {
  type HostProtocolEnvelope,
  HostProtocolResponseEnvelope,
  type HostProtocolRequestEnvelope,
  HostProtocolStreamByRequestEnvelope,
  makeDesktopClientProtocol,
  rpcSupport
} from "@orika/bridge"
import { Effect, Layer, ManagedRuntime, Option, Queue, Stream } from "effect"
import { RpcClient, RpcSchema } from "effect/unstable/rpc"

import { AssociationEvent } from "./contracts/association.js"
import { Association, AssociationRpcs, AssociationSurface } from "./association.js"

test("Association public surface omits shallow service and layer helpers", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const source = yield* Effect.promise(() =>
        readFile(new URL("association.ts", import.meta.url), "utf8")
      )
      const indexSource = yield* Effect.promise(() =>
        readFile(new URL("index.ts", import.meta.url), "utf8")
      )

      for (const removedName of [
        "AssociationServiceApi",
        "class AssociationClient",
        "AssociationLive",
        "makeAssociationClientLayer",
        "makeAssociationServiceLayer",
        "makeAssociationBridgeClientLayer"
      ]) {
        expect(source).not.toContain(removedName)
        expect(indexSource).not.toContain(removedName)
      }
    })
  ))

test("Association event schema is owned by the RPC stream contract", async () => {
  const associationModule = await import("./association.js")
  const rootModule = await import("./index.js")
  const callableTags = Array.from(AssociationRpcs.requests.keys()).toSorted()
  const eventRpc = AssociationRpcs.requests.get("Association.events.Event")

  expect("AssociationRpcEvents" in associationModule).toBe(false)
  expect("AssociationRpcEvents" in rootModule).toBe(false)
  expect(callableTags).toEqual([
    "Association.events.Event",
    "Association.getFileAssociations",
    "Association.isDefaultProtocolClient",
    "Association.setDefaultProtocolClient"
  ])
  expect(eventRpc).toBeDefined()
  expect(eventRpc === undefined ? false : RpcSchema.isStreamSchema(eventRpc.successSchema)).toBe(
    true
  )
  if (eventRpc !== undefined && RpcSchema.isStreamSchema(eventRpc.successSchema)) {
    expect(eventRpc.successSchema.success).toBe(AssociationEvent)
    expect(eventRpc.pipe(rpcSupport)).toEqual({
      platforms: [
        { platform: "macos", status: "supported" },
        { platform: "windows", status: "unsupported", reason: "host-adapter-unimplemented" },
        { platform: "linux", status: "unsupported", reason: "host-adapter-unimplemented" }
      ],
      reason: "macos-association-only",
      status: "partial"
    })
  }

  const eventDoc = AssociationSurface.schemaDocs.find(
    (doc) => doc.tag === "Association.events.Event"
  )
  expect(eventDoc?.kind).toBe("stream")
  expect(eventDoc?.callable).toBe(true)
  expect(eventDoc?.support).toEqual({
    platforms: [
      { platform: "macos", status: "supported" },
      { platform: "windows", status: "unsupported", reason: "host-adapter-unimplemented" },
      { platform: "linux", status: "unsupported", reason: "host-adapter-unimplemented" }
    ],
    reason: "macos-association-only",
    status: "partial"
  })
})

test("Association direct client consumes the canonical RPC event stream", () =>
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
                      payload: { phase: "protocol-updated" }
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
            nextRequestId: () => "association-event-rpc",
            nextTraceId: () => "trace-association-event-rpc"
          }
        )
      )

      const event = yield* runScoped(
        Effect.gen(function* () {
          const association = yield* Association
          return yield* association.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
        }),
        Layer.provide(AssociationSurface.clientLayer, protocolLayer)
      )

      expect(event).toEqual(new AssociationEvent({ phase: "protocol-updated" }))
      expect(requests.map((request) => request.method)).toEqual(["Association.events.Event"])
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
