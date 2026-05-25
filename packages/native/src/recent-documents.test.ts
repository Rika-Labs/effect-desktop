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

import { CanonicalPath } from "./contracts/path.js"
import { RecentDocumentsEvent } from "./contracts/recent-documents.js"
import { RecentDocuments, RecentDocumentsRpcs, RecentDocumentsSurface } from "./recent-documents.js"

test("RecentDocuments public surface omits shallow service and layer helpers", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const source = yield* Effect.promise(() =>
        readFile(new URL("recent-documents.ts", import.meta.url), "utf8")
      )
      const indexSource = yield* Effect.promise(() =>
        readFile(new URL("index.ts", import.meta.url), "utf8")
      )

      for (const removedName of [
        "class RecentDocumentsClient",
        "RecentDocumentsLive",
        "RecentDocumentsServiceApi",
        "RecentDocumentsRpcEvents",
        "makeRecentDocumentsClientLayer",
        "makeRecentDocumentsServiceLayer",
        "makeRecentDocumentsBridgeClientLayer"
      ]) {
        expect(source).not.toContain(removedName)
        expect(indexSource).not.toContain(removedName)
      }
    })
  ))

test("RecentDocuments event schema is owned by the RPC stream contract", async () => {
  const recentDocumentsModule = await import("./recent-documents.js")
  const rootModule = await import("./index.js")
  const callableTags = Array.from(RecentDocumentsRpcs.requests.keys()).toSorted()
  const eventRpc = RecentDocumentsRpcs.requests.get("RecentDocuments.events.Event")

  expect("RecentDocumentsRpcEvents" in recentDocumentsModule).toBe(false)
  expect("RecentDocumentsRpcEvents" in rootModule).toBe(false)
  expect(callableTags).toEqual([
    "RecentDocuments.add",
    "RecentDocuments.clear",
    "RecentDocuments.events.Event",
    "RecentDocuments.list"
  ])
  expect(eventRpc).toBeDefined()
  expect(eventRpc === undefined ? false : RpcSchema.isStreamSchema(eventRpc.successSchema)).toBe(
    true
  )
  if (eventRpc !== undefined && RpcSchema.isStreamSchema(eventRpc.successSchema)) {
    expect(eventRpc.successSchema.success).toBe(RecentDocumentsEvent)
    expect(eventRpc.pipe(rpcSupport)).toEqual({ status: "supported" })
  }

  const eventDoc = RecentDocumentsSurface.schemaDocs.find(
    (doc) => doc.tag === "RecentDocuments.events.Event"
  )
  expect(eventDoc?.kind).toBe("stream")
  expect(eventDoc?.callable).toBe(true)
  expect(eventDoc?.support).toEqual({ status: "supported" })
})

test("RecentDocuments direct client consumes the canonical RPC event stream", () =>
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
                      payload: { phase: "document-added", path: { path: "/tmp/report.txt" } }
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
            nextRequestId: () => "recent-documents-event-rpc",
            nextTraceId: () => "trace-recent-documents-event-rpc"
          }
        )
      )

      const event = yield* runScoped(
        Effect.gen(function* () {
          const recentDocuments = yield* RecentDocuments
          return yield* recentDocuments.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
        }),
        Layer.provide(RecentDocumentsSurface.clientLayer, protocolLayer)
      )

      expect(event).toEqual(
        new RecentDocumentsEvent({
          phase: "document-added",
          path: new CanonicalPath({ path: "/tmp/report.txt" })
        })
      )
      expect(requests.map((request) => request.method)).toEqual(["RecentDocuments.events.Event"])
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
