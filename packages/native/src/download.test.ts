import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import {
  type BridgeClientExchange,
  type HostProtocolEnvelope,
  HostProtocolEventEnvelope,
  HostProtocolInvalidOutputError,
  type HostProtocolRequestEnvelope,
  HostProtocolResponseEnvelope,
  HostProtocolStreamByRequestEnvelope,
  makeDesktopClientProtocol
} from "@orika/bridge"
import { makeResourceId } from "@orika/core"
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option, Queue, Schema, Stream } from "effect"
import { RpcClient, RpcSchema } from "effect/unstable/rpc"

import { makeNativeCapabilityManifest } from "./capabilities.js"
import { DownloadEvent, DownloadProgressedEvent, DownloadSnapshot } from "./contracts/download.js"
import {
  Download,
  type DownloadClientApi,
  DownloadRpcs,
  DownloadSurface,
  makeDownloadMemoryClient,
  makeDownloadUnsupportedClient
} from "./download.js"

const UnsupportedMethods = ["start", "pause", "resume", "cancel", "list"] as const

test("Download public surface omits shallow service and layer helpers", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const source = yield* Effect.promise(() =>
        readFile(new URL("download.ts", import.meta.url), "utf8")
      )
      const indexSource = yield* Effect.promise(() =>
        readFile(new URL("index.ts", import.meta.url), "utf8")
      )

      for (const removedName of [
        "Download" + "CapabilityFacts",
        "DownloadServiceApi",
        "class DownloadClient",
        "DownloadLive",
        "DownloadRpcEvents",
        "makeDownloadClientLayer",
        "makeDownloadServiceLayer",
        "makeDownloadBridgeClientLayer",
        "makeDownloadService",
        "subscribeNativeEvent"
      ]) {
        expect(source).not.toContain(removedName)
        expect(indexSource).not.toContain(removedName)
      }
    })
  ))

test("Download exposes isSupported and its event stream as callable RPCs", () => {
  const callableTags = Array.from(DownloadRpcs.requests.keys()).toSorted()
  expect(callableTags).toEqual(["Download.events.Event", "Download.isSupported"])
  for (const method of UnsupportedMethods) {
    expect(callableTags).not.toContain(`Download.${method}`)
  }
})

test("Download event schema is owned by the RPC stream contract", async () => {
  const downloadModule = await import("./download.js")
  const eventRpc = DownloadRpcs.requests.get("Download.events.Event")

  expect("DownloadRpcEvents" in downloadModule).toBe(false)
  expect(eventRpc).toBeDefined()
  expect(eventRpc === undefined ? false : RpcSchema.isStreamSchema(eventRpc.successSchema)).toBe(
    true
  )
  if (eventRpc !== undefined && RpcSchema.isStreamSchema(eventRpc.successSchema)) {
    expect(eventRpc.successSchema.success).toBe(DownloadEvent)
  }

  const eventDoc = DownloadSurface.schemaDocs.find((doc) => doc.tag === "Download.events.Event")
  expect(eventDoc?.kind).toBe("stream")
  expect(eventDoc?.callable).toBe(true)
})

test("Download isSupported reports supported result through the service", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeDownloadMemoryClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const downloads = yield* Download
          return yield* downloads.isSupported()
        }),
        downloadLayer(client)
      )
      expect(result.supported).toBe(true)
    })
  ))

test("Download unsupported client reports the host-unavailable reason", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = makeDownloadUnsupportedClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const downloads = yield* Download
          return yield* downloads.isSupported()
        }),
        downloadLayer(client)
      )
      expect(result.supported).toBe(false)
      expect(result.reason).toBe("host-download-unavailable")
    })
  ))

test("Download declares the 5 unsupported methods as non-callable capability facts", () => {
  const facts = downloadCapabilityFacts()
  const factTags = facts.map((fact) => fact.tag).toSorted()
  expect(factTags).toEqual(UnsupportedMethods.map((method) => `Download.${method}`).toSorted())
  for (const fact of facts) {
    expect(fact.support.status).toBe("unsupported")
  }
})

test("Download capability facts surface in the manifest and stay non-callable", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const manifest = yield* makeNativeCapabilityManifest([
        { schemaDocs: DownloadSurface.schemaDocs }
      ])
      const byTag = new Map(manifest.map((fact) => [fact.tag, fact] as const))

      for (const method of UnsupportedMethods) {
        const fact = byTag.get(`Download.${method}`)
        expect(fact).toBeDefined()
        expect(fact?.support.status).toBe("unsupported")
      }

      const callableFactTags = DownloadSurface.schemaDocs
        .filter((doc) => doc.callable)
        .map((doc) => doc.tag)
      expect(callableFactTags).toEqual(["Download.isSupported", "Download.events.Event"])
      expect(byTag.get("Download.events.Event")?.capability.kind).toBe("none")
      expect(byTag.get("Download.events.Event")?.support).toEqual({ status: "supported" })

      const nonCallableTags = DownloadSurface.schemaDocs
        .filter((doc) => !doc.callable)
        .map((doc) => doc.tag)
        .toSorted()
      expect(nonCallableTags).toEqual(
        UnsupportedMethods.map((method) => `Download.${method}`).toSorted()
      )
    })
  ))

test("Download contracts reject received bytes greater than total bytes", () => {
  const snapshotExit = Effect.runSyncExit(
    Schema.decodeUnknownEffect(DownloadSnapshot)({
      download: downloadHandle(),
      profile: profileHandle(),
      url: "https://example.test/file.zip",
      state: "running",
      receivedBytes: 20,
      totalBytes: 10
    })
  )
  const eventExit = Effect.runSyncExit(
    Schema.decodeUnknownEffect(DownloadEvent)({
      type: "download-event",
      timestamp: 1_710_000_000_000,
      phase: "progressed",
      download: downloadHandle(),
      profile: profileHandle(),
      url: "https://example.test/file.zip",
      receivedBytes: 20,
      totalBytes: 10
    })
  )

  expect(snapshotExit._tag).toBe("Failure")
  expect(eventExit._tag).toBe("Failure")
})

test("Download contracts reject inconsistent failure messages", () => {
  const invalidSnapshots = [
    { state: "running", message: "host failed" },
    { state: "failed" }
  ] as const
  for (const invalid of invalidSnapshots) {
    const exit = Effect.runSyncExit(
      Schema.decodeUnknownEffect(DownloadSnapshot)({
        download: downloadHandle(),
        profile: profileHandle(),
        url: "https://example.test/file.zip",
        receivedBytes: 0,
        ...invalid
      })
    )
    expect(Exit.isFailure(exit)).toBe(true)
  }

  const invalidEvents = [
    { phase: "completed", message: "host failed" },
    { phase: "failed" }
  ] as const
  for (const invalid of invalidEvents) {
    const exit = Effect.runSyncExit(
      Schema.decodeUnknownEffect(DownloadEvent)({
        type: "download-event",
        timestamp: 1_710_000_000_000,
        download: downloadHandle(),
        profile: profileHandle(),
        url: "https://example.test/file.zip",
        receivedBytes: 0,
        ...invalid
      })
    )
    expect(Exit.isFailure(exit)).toBe(true)
  }

  for (const valid of [
    { state: "running" },
    { state: "failed", message: "host failed" }
  ] as const) {
    const exit = Effect.runSyncExit(
      Schema.decodeUnknownEffect(DownloadSnapshot)({
        download: downloadHandle(),
        profile: profileHandle(),
        url: "https://example.test/file.zip",
        receivedBytes: 0,
        ...valid
      })
    )
    expect(Exit.isSuccess(exit)).toBe(true)
  }

  for (const valid of [
    { phase: "completed" },
    { phase: "failed", message: "host failed" }
  ] as const) {
    const exit = Effect.runSyncExit(
      Schema.decodeUnknownEffect(DownloadEvent)({
        type: "download-event",
        timestamp: 1_710_000_000_000,
        download: downloadHandle(),
        profile: profileHandle(),
        url: "https://example.test/file.zip",
        receivedBytes: 0,
        ...valid
      })
    )
    expect(Exit.isSuccess(exit)).toBe(true)
  }
})

test("Download event types reject impossible phase payloads", () => {
  type DownloadEventValue = typeof DownloadEvent.Type
  const baseEvent = {
    type: "download-event",
    timestamp: 1_710_000_000_000,
    download: downloadHandle(),
    profile: profileHandle(),
    url: "https://example.test/file.zip",
    receivedBytes: 0
  } as const

  const completed: DownloadEventValue = {
    ...baseEvent,
    phase: "completed"
  }
  const failed: DownloadEventValue = {
    ...baseEvent,
    phase: "failed",
    message: "host failed"
  }

  expect(completed.phase).toBe("completed")
  expect(failed.message).toBe("host failed")

  // @ts-expect-error completed download events must not carry failure messages.
  const completedWithMessage: DownloadEventValue = {
    ...baseEvent,
    phase: "completed",
    message: "host failed"
  }
  // @ts-expect-error failed download events must carry failure messages.
  const failedWithoutMessage: DownloadEventValue = {
    ...baseEvent,
    phase: "failed"
  }

  expect(completedWithMessage.phase).toBe("completed")
  expect(failedWithoutMessage.phase).toBe("failed")
})

test("Download direct client consumes the canonical RPC event stream and filters by handle", () =>
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
                      payload: {
                        type: "download-event",
                        timestamp: 1_710_000_000_001,
                        phase: "progressed",
                        download: downloadHandle("download:2"),
                        profile: profileHandle(),
                        url: "https://example.test/file.zip",
                        receivedBytes: 1
                      }
                    })
                  ),
                  Queue.offer(
                    queue,
                    new HostProtocolStreamByRequestEnvelope({
                      kind: "stream",
                      id: envelope.id,
                      timestamp: 1_710_000_000_002,
                      traceId: envelope.traceId,
                      payload: {
                        type: "download-event",
                        timestamp: 1_710_000_000_002,
                        phase: "progressed",
                        download: downloadHandle(),
                        profile: profileHandle(),
                        url: "https://example.test/file.zip",
                        receivedBytes: 2
                      }
                    })
                  ),
                  Queue.offer(
                    queue,
                    new HostProtocolResponseEnvelope({
                      kind: "response",
                      id: envelope.id,
                      timestamp: 1_710_000_000_003,
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
            nextRequestId: () => "download-event-rpc",
            nextTraceId: () => "trace-download-event-rpc"
          }
        )
      )

      const events = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* Download
          return yield* client.events(downloadHandle()).pipe(Stream.take(1), Stream.runCollect)
        }),
        Layer.provide(DownloadSurface.clientLayer, protocolLayer)
      )

      expect(Array.from(events)).toEqual([
        new DownloadProgressedEvent({
          type: "download-event",
          timestamp: 1_710_000_000_002,
          phase: "progressed",
          download: downloadHandle(),
          profile: profileHandle(),
          url: "https://example.test/file.zip",
          receivedBytes: 2
        })
      ])
      expect(requests.map((request) => request.method)).toEqual(["Download.events.Event"])
    })
  ))

test("Download bridge client rejects invalid byte progress events as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exchange: BridgeClientExchange = {
        request: () => Effect.die("Download test does not issue bridge requests"),
        subscribe: (method) =>
          Stream.make(
            new HostProtocolEventEnvelope({
              kind: "event",
              method,
              timestamp: 1_710_000_000_000,
              traceId: "download-event-trace",
              payload: {
                type: "download-event",
                timestamp: 1_710_000_000_000,
                phase: "progressed",
                download: downloadHandle(),
                profile: profileHandle(),
                url: "https://example.test/file.zip",
                receivedBytes: 20,
                totalBytes: 10
              }
            })
          )
      }
      const exit = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* Download
          return yield* Effect.exit(
            client.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
          )
        }),
        DownloadSurface.bridgeClientLayer(exchange)
      )

      expectInvalidOutput(exit)
    })
  ))

test("Download bridge client rejects inconsistent failure messages as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const payload of [
        {
          type: "download-event",
          timestamp: 1_710_000_000_000,
          phase: "completed",
          download: downloadHandle(),
          profile: profileHandle(),
          url: "https://example.test/file.zip",
          receivedBytes: 0,
          message: "host failed"
        },
        {
          type: "download-event",
          timestamp: 1_710_000_000_000,
          phase: "failed",
          download: downloadHandle(),
          profile: profileHandle(),
          url: "https://example.test/file.zip",
          receivedBytes: 0
        }
      ] as const) {
        const exchange: BridgeClientExchange = {
          request: () => Effect.die("Download test does not issue bridge requests"),
          subscribe: (method) =>
            Stream.make(
              new HostProtocolEventEnvelope({
                kind: "event",
                method,
                timestamp: 1_710_000_000_000,
                traceId: "download-event-trace",
                payload
              })
            )
        }
        const exit = yield* runScoped(
          Effect.gen(function* () {
            const client = yield* Download
            return yield* Effect.exit(
              client.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
            )
          }),
          DownloadSurface.bridgeClientLayer(exchange)
        )

        expectInvalidOutput(exit)
      }
    })
  ))

test("Download bridge client validates event payloads through the RPC stream contract", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const subscriptions: string[] = []
      const exchange: BridgeClientExchange = {
        request: () => Effect.die("Download event contract test does not issue bridge requests"),
        subscribe: (method) => {
          subscriptions.push(method)
          return Stream.make(
            new HostProtocolEventEnvelope({
              kind: "event",
              method,
              timestamp: 1_710_000_000_000,
              traceId: "download-event-trace",
              payload: {
                type: "download-event",
                timestamp: 1_710_000_000_000,
                phase: "progressed",
                download: downloadHandle(),
                profile: profileHandle(),
                url: "https://example.test/file.zip",
                receivedBytes: 1,
                unexpected: "must be rejected by strict contract decode"
              }
            })
          )
        }
      }
      const exit = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* Download
          return yield* Effect.exit(
            client.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
          )
        }),
        DownloadSurface.bridgeClientLayer(exchange)
      )

      expectInvalidOutput(exit)
      expect(subscriptions).toEqual(["Download.Event"])
    })
  ))

test("Download bridge client filters event streams by download handle", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const subscriptions: string[] = []
      const exchange: BridgeClientExchange = {
        request: () => Effect.die("Download event filter test does not issue bridge requests"),
        subscribe: (method) => {
          subscriptions.push(method)
          return Stream.make(
            new HostProtocolEventEnvelope({
              kind: "event",
              method,
              timestamp: 1_710_000_000_000,
              traceId: "download-other-handle",
              payload: {
                type: "download-event",
                timestamp: 1_710_000_000_000,
                phase: "progressed",
                download: downloadHandle("download:2"),
                profile: profileHandle(),
                url: "https://example.test/file.zip",
                receivedBytes: 1
              }
            }),
            new HostProtocolEventEnvelope({
              kind: "event",
              method,
              timestamp: 1_710_000_000_001,
              traceId: "download-target-handle",
              payload: {
                type: "download-event",
                timestamp: 1_710_000_000_001,
                phase: "progressed",
                download: downloadHandle(),
                profile: profileHandle(),
                url: "https://example.test/file.zip",
                receivedBytes: 2
              }
            })
          )
        }
      }
      const events = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* Download
          return yield* client.events(downloadHandle()).pipe(Stream.take(1), Stream.runCollect)
        }),
        DownloadSurface.bridgeClientLayer(exchange)
      )

      expect(Array.from(events)).toEqual([
        new DownloadProgressedEvent({
          type: "download-event",
          timestamp: 1_710_000_000_001,
          phase: "progressed",
          download: downloadHandle(),
          profile: profileHandle(),
          url: "https://example.test/file.zip",
          receivedBytes: 2
        })
      ])
      expect(subscriptions).toEqual(["Download.Event"])
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

const downloadLayer = (client: DownloadClientApi): Layer.Layer<Download> =>
  Layer.succeed(Download)(client)

const downloadCapabilityFacts = () => DownloadSurface.schemaDocs.filter((doc) => !doc.callable)

const downloadHandle = (id = "download:1") =>
  ({
    kind: "download",
    id: makeResourceId(id),
    generation: 0,
    ownerScope: "scope-1",
    state: "open"
  }) as const

const profileHandle = () =>
  ({
    kind: "session-profile",
    id: makeResourceId("session-profile:workspace-1"),
    generation: 0,
    ownerScope: "scope-1",
    state: "open"
  }) as const

const expectInvalidOutput = <A, E>(exit: Exit.Exit<A, E>): void => {
  expect(exit._tag).toBe("Failure")
  if (exit._tag !== "Failure") {
    return
  }

  expect(Cause.squash(exit.cause)).toBeInstanceOf(HostProtocolInvalidOutputError)
}
