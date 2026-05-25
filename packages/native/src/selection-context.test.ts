import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import {
  type BridgeClientExchange,
  type HostProtocolEnvelope,
  type HostProtocolRequestEnvelope,
  HostProtocolResponseEnvelope,
  HostProtocolStreamByRequestEnvelope,
  makeDesktopClientProtocol,
  rpcSupport
} from "@orika/bridge"
import { Effect, Layer, ManagedRuntime, Option, Queue, Schema, Stream } from "effect"
import { RpcClient, RpcSchema } from "effect/unstable/rpc"

import { makeNativeCapabilityManifest } from "./capabilities.js"
import { SelectionContextEvent } from "./contracts/selection-context.js"
import {
  makeSelectionContextMemoryClient,
  makeSelectionContextUnsupportedClient,
  SelectionContext,
  SelectionContextCapabilityFacts,
  type SelectionContextClientApi,
  SelectionContextRpcs,
  SelectionContextSurface
} from "./selection-context.js"

const UnsupportedMethods = [
  "readSelection",
  "readDocumentContext",
  "watchFocus",
  "stopWatching"
] as const

test("SelectionContext public surface omits shallow service and layer helpers", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const source = yield* Effect.promise(() =>
        readFile(new URL("selection-context.ts", import.meta.url), "utf8")
      )
      const indexSource = yield* Effect.promise(() =>
        readFile(new URL("index.ts", import.meta.url), "utf8")
      )

      for (const removedName of [
        "SelectionContextServiceApi",
        "class SelectionContextClient",
        "SelectionContextLive",
        "SelectionContextRpcEvents",
        "makeSelectionContextClientLayer",
        "makeSelectionContextServiceLayer",
        "makeSelectionContextBridgeClientLayer",
        "makeSelectionContextService"
      ]) {
        expect(source).not.toContain(removedName)
        expect(indexSource).not.toContain(removedName)
      }
    })
  ))

test("SelectionContext exposes only isSupported as a callable RPC", () => {
  const callableTags = Array.from(SelectionContextRpcs.requests.keys()).toSorted()
  expect(callableTags).toEqual(["SelectionContext.events.Event", "SelectionContext.isSupported"])
  for (const method of UnsupportedMethods) {
    expect(callableTags).not.toContain(`SelectionContext.${method}`)
  }
})

test("SelectionContext event schema is owned by the RPC stream contract", async () => {
  const contextModule = await import("./selection-context.js")
  const eventRpc = SelectionContextRpcs.requests.get("SelectionContext.events.Event")

  expect("SelectionContextRpcEvents" in contextModule).toBe(false)
  expect(eventRpc).toBeDefined()
  expect(eventRpc === undefined ? false : RpcSchema.isStreamSchema(eventRpc.successSchema)).toBe(
    true
  )
  if (eventRpc !== undefined && RpcSchema.isStreamSchema(eventRpc.successSchema)) {
    expect(eventRpc.successSchema.success).toBe(SelectionContextEvent)
    expect(eventRpc.pipe(rpcSupport)).toMatchObject({
      status: "unsupported",
      reason: "host-adapter-unimplemented"
    })
  }

  const eventDoc = SelectionContextSurface.schemaDocs.find(
    (doc) => doc.tag === "SelectionContext.events.Event"
  )
  expect(eventDoc?.kind).toBe("stream")
  expect(eventDoc?.callable).toBe(true)
  expect(eventDoc?.support).toMatchObject({
    status: "unsupported",
    reason: "host-adapter-unimplemented"
  })
})

test("SelectionContext declares the demoted methods as non-callable capability facts", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const factTags = SelectionContextCapabilityFacts.map((fact) => fact.tag).toSorted()
      expect(factTags).toEqual(
        UnsupportedMethods.map((method) => `SelectionContext.${method}`).toSorted()
      )
      for (const fact of SelectionContextCapabilityFacts) {
        expect(fact.support.status).toBe("unsupported")
        expect(fact.capability.kind).toBe("native.invoke")
      }

      const manifest = yield* makeNativeCapabilityManifest([
        { schemaDocs: SelectionContextSurface.schemaDocs }
      ])
      const byTag = new Map(manifest.map((fact) => [fact.tag, fact] as const))
      for (const method of UnsupportedMethods) {
        const fact = byTag.get(`SelectionContext.${method}`)
        expect(fact).toBeDefined()
        expect(fact?.support.status).toBe("unsupported")
      }

      const callableTags = SelectionContextSurface.schemaDocs
        .filter((doc) => doc.callable)
        .map((doc) => doc.tag)
        .toSorted()
      expect(callableTags).toEqual([
        "SelectionContext.events.Event",
        "SelectionContext.isSupported"
      ])

      const nonCallableTags = SelectionContextSurface.schemaDocs
        .filter((doc) => !doc.callable)
        .map((doc) => doc.tag)
        .toSorted()
      expect(nonCallableTags).toEqual(
        UnsupportedMethods.map((method) => `SelectionContext.${method}`).toSorted()
      )
    })
  ))

test("SelectionContext direct client consumes the canonical RPC event stream", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<HostProtocolEnvelope>()
      const requests: HostProtocolRequestEnvelope[] = []
      const eventPayload = {
        ...eventBase(),
        phase: "selection-changed",
        selection: selectionMetadata()
      } as const
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
                      payload: eventPayload
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
            nextRequestId: () => "selection-context-event-rpc",
            nextTraceId: () => "trace-selection-context-event-rpc"
          }
        )
      )

      const event = yield* runScoped(
        Effect.gen(function* () {
          const context = yield* SelectionContext
          return yield* context.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
        }),
        Layer.provide(SelectionContextSurface.clientLayer, protocolLayer)
      )

      expect(event).toEqual(new SelectionContextEvent(eventPayload))
      expect(requests.map((request) => request.method)).toEqual(["SelectionContext.events.Event"])
    })
  ))

test("SelectionContext isSupported reports supported result through the service", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeSelectionContextMemoryClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const context = yield* SelectionContext
          return yield* context.isSupported()
        }),
        selectionContextLayer(client)
      )
      expect(result.supported).toBe(true)
    })
  ))

test("SelectionContext unsupported client reports the host-unavailable reason", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = makeSelectionContextUnsupportedClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const context = yield* SelectionContext
          return yield* context.isSupported()
        }),
        selectionContextLayer(client)
      )
      expect(result.supported).toBe(false)
      expect(result.reason).toBe("host-adapter-unimplemented")
    })
  ))

test("SelectionContext events reject inconsistent phase payloads", () => {
  const document = selectionDocument()
  const selection = selectionMetadata()
  for (const payload of [
    {
      ...eventBase(),
      phase: "focus-changed"
    },
    {
      ...eventBase(),
      phase: "focus-changed",
      document,
      selection
    },
    {
      ...eventBase(),
      phase: "selection-changed"
    },
    {
      ...eventBase(),
      phase: "selection-changed",
      selection,
      reason: "host-failed"
    },
    {
      ...eventBase(),
      phase: "watch-started"
    },
    {
      ...eventBase(),
      phase: "watch-stopped",
      watchId: "watch-1",
      message: "stopped"
    },
    {
      ...eventBase(),
      phase: "failed"
    },
    {
      ...eventBase(),
      phase: "failed",
      reason: "host-failed",
      document
    }
  ] as const) {
    const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(SelectionContextEvent)(payload))
    expect(exit._tag).toBe("Failure")
  }

  for (const payload of [
    {
      ...eventBase(),
      phase: "focus-changed",
      document
    },
    {
      ...eventBase(),
      phase: "focus-changed",
      watchId: "watch-1",
      document
    },
    {
      ...eventBase(),
      phase: "selection-changed",
      selection
    },
    {
      ...eventBase(),
      phase: "selection-changed",
      watchId: "watch-1",
      document,
      selection
    },
    {
      ...eventBase(),
      phase: "watch-started",
      watchId: "watch-1"
    },
    {
      ...eventBase(),
      phase: "watch-stopped",
      watchId: "watch-1"
    },
    {
      ...eventBase(),
      phase: "failed",
      reason: "host-failed",
      message: "host failed"
    },
    {
      ...eventBase(),
      phase: "failed",
      watchId: "watch-1",
      reason: "host-failed"
    }
  ] as const) {
    const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(SelectionContextEvent)(payload))
    expect(exit._tag).toBe("Success")
  }
})

test("SelectionContext bridge client fails event stream as unsupported before subscribing", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const subscriptions: string[] = []
      const exchange: BridgeClientExchange = {
        request: () => Effect.die("unexpected request"),
        subscribe: (method) => {
          subscriptions.push(method)
          return Stream.empty
        }
      }

      const runtime = ManagedRuntime.make(SelectionContextSurface.bridgeClientLayer(exchange))
      const exit = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const context = yield* SelectionContext
            return yield* Effect.exit(context.events().pipe(Stream.take(1), Stream.runCollect))
          })
        )
      )
      yield* Effect.promise(() => runtime.dispose())

      expect(exit._tag).toBe("Failure")
      expect(subscriptions).toEqual([])
    })
  ))

const eventBase = () =>
  ({
    type: "selection-context-event",
    timestamp: 1_710_000_000_100
  }) as const

const selectionDocument = () => ({
  documentId: "document-1",
  kind: "editor-buffer",
  title: "Document"
})

const selectionMetadata = () => ({
  sourceApplication: "Editor",
  mimeType: "text/plain",
  characterCount: 12,
  selectionHash: "hash-12"
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

const selectionContextLayer = (client: SelectionContextClientApi): Layer.Layer<SelectionContext> =>
  Layer.succeed(SelectionContext)(client)
