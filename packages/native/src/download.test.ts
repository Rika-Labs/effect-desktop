import { expect, test } from "bun:test"
import {
  type BridgeClientExchange,
  HostProtocolEventEnvelope,
  HostProtocolInvalidOutputError
} from "@orika/bridge"
import { Cause, Effect, Exit, type Layer, ManagedRuntime, Option, Schema, Stream } from "effect"

import { makeNativeCapabilityManifest } from "./capabilities.js"
import { DownloadEvent, DownloadSnapshot } from "./contracts/download.js"
import {
  Download,
  DownloadCapabilityFacts,
  DownloadClient,
  DownloadRpcs,
  DownloadSurface,
  makeDownloadBridgeClientLayer,
  makeDownloadMemoryClient,
  makeDownloadServiceLayer,
  makeDownloadUnsupportedClient
} from "./download.js"

const UnsupportedMethods = ["start", "pause", "resume", "cancel", "list"] as const

test("Download exposes only isSupported as a callable RPC", () => {
  const callableTags = Array.from(DownloadRpcs.requests.keys()).toSorted()
  expect(callableTags).toEqual(["Download.isSupported"])
  for (const method of UnsupportedMethods) {
    expect(callableTags).not.toContain(`Download.${method}`)
  }
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
        makeDownloadServiceLayer(client)
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
        makeDownloadServiceLayer(client)
      )
      expect(result.supported).toBe(false)
      expect(result.reason).toBe("host-download-unavailable")
    })
  ))

test("Download declares the 5 unsupported methods as non-callable capability facts", () => {
  const factTags = DownloadCapabilityFacts.map((fact) => fact.tag).toSorted()
  expect(factTags).toEqual(UnsupportedMethods.map((method) => `Download.${method}`).toSorted())
  for (const fact of DownloadCapabilityFacts) {
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
      expect(callableFactTags).toEqual(["Download.isSupported"])

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
          const client = yield* DownloadClient
          return yield* Effect.exit(
            client.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
          )
        }),
        makeDownloadBridgeClientLayer(exchange)
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

const downloadHandle = () =>
  ({
    kind: "download",
    id: "download-1",
    generation: 0,
    ownerScope: "scope-1",
    state: "open"
  }) as const

const profileHandle = () =>
  ({
    kind: "session-profile",
    id: "profile-1",
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
