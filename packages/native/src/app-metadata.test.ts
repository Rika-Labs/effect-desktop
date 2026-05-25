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

import { AppMetadataEvent } from "./contracts/app-metadata.js"
import { AppMetadata, AppMetadataRpcs, AppMetadataSurface } from "./app-metadata.js"

test("AppMetadata public surface omits shallow service and layer helpers", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const source = yield* Effect.promise(() =>
        readFile(new URL("app-metadata.ts", import.meta.url), "utf8")
      )
      const indexSource = yield* Effect.promise(() =>
        readFile(new URL("index.ts", import.meta.url), "utf8")
      )

      for (const removedName of [
        "AppMetadataServiceApi",
        "class AppMetadataClient",
        "AppMetadataLive",
        "makeAppMetadataClientLayer",
        "makeAppMetadataServiceLayer",
        "makeAppMetadataBridgeClientLayer"
      ]) {
        expect(source).not.toContain(removedName)
        expect(indexSource).not.toContain(removedName)
      }
    })
  ))

test("AppMetadata event schema is owned by the RPC stream contract", async () => {
  const appMetadataModule = await import("./app-metadata.js")
  const rootModule = await import("./index.js")
  const callableTags = Array.from(AppMetadataRpcs.requests.keys()).toSorted()
  const eventRpc = AppMetadataRpcs.requests.get("AppMetadata.events.Event")

  expect("AppMetadataRpcEvents" in appMetadataModule).toBe(false)
  expect("AppMetadataRpcEvents" in rootModule).toBe(false)
  expect(callableTags).toEqual([
    "AppMetadata.events.Event",
    "AppMetadata.getInfo",
    "AppMetadata.getLaunchContext",
    "AppMetadata.getPaths"
  ])
  expect(eventRpc).toBeDefined()
  expect(eventRpc === undefined ? false : RpcSchema.isStreamSchema(eventRpc.successSchema)).toBe(
    true
  )
  if (eventRpc !== undefined && RpcSchema.isStreamSchema(eventRpc.successSchema)) {
    expect(eventRpc.successSchema.success).toBe(AppMetadataEvent)
    expect(eventRpc.pipe(rpcSupport)).toEqual({ status: "supported" })
  }

  const eventDoc = AppMetadataSurface.schemaDocs.find(
    (doc) => doc.tag === "AppMetadata.events.Event"
  )
  expect(eventDoc?.kind).toBe("stream")
  expect(eventDoc?.callable).toBe(true)
  expect(eventDoc?.support).toEqual({ status: "supported" })
})

test("AppMetadata direct client consumes the canonical RPC event stream", () =>
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
                      payload: { phase: "info-read" }
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
            nextRequestId: () => "app-metadata-event-rpc",
            nextTraceId: () => "trace-app-metadata-event-rpc"
          }
        )
      )

      const event = yield* runScoped(
        Effect.gen(function* () {
          const metadata = yield* AppMetadata
          return yield* metadata.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
        }),
        Layer.provide(AppMetadataSurface.clientLayer, protocolLayer)
      )

      expect(event).toEqual(new AppMetadataEvent({ phase: "info-read" }))
      expect(requests.map((request) => request.method)).toEqual(["AppMetadata.events.Event"])
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
