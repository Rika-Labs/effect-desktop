import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import {
  type BridgeClientExchange,
  HostProtocolEventEnvelope,
  type HostProtocolEnvelope,
  HostProtocolInvalidOutputError,
  HostProtocolRequestEnvelope,
  HostProtocolResponseEnvelope,
  HostProtocolStreamByRequestEnvelope,
  makeDesktopClientProtocol,
  rpcSupport
} from "@orika/bridge"
import { makeResourceId } from "@orika/core"
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option, Queue, Schema, Stream } from "effect"
import { RpcClient, RpcSchema } from "effect/unstable/rpc"

import { makeNativeCapabilityManifest } from "./capabilities.js"
import { CookieStoreEvent, CookieStoreRemovedEvent } from "./contracts/cookie-store.js"
import type { SessionProfileHandle } from "./contracts/session-profile.js"
import {
  CookieStore,
  type CookieStoreClientApi,
  CookieStoreRpcs,
  CookieStoreSurface,
  makeCookieStoreMemoryClient,
  makeCookieStoreUnsupportedClient
} from "./cookie-store.js"

const SupportedMethods = ["get", "remove", "set"] as const
const ExpectedLiveWebViewSupport = {
  status: "partial",
  reason: "host-cookie-store-live-webview-required",
  platforms: [
    { platform: "macos", status: "partial", reason: "host-cookie-store-live-webview-required" },
    { platform: "windows", status: "partial", reason: "host-cookie-store-live-webview-required" },
    { platform: "linux", status: "partial", reason: "host-cookie-store-live-webview-required" }
  ]
} as const
const Profile = {
  kind: "session-profile",
  id: makeResourceId("session-profile:workspace-1"),
  generation: 0,
  ownerScope: "workspace:1",
  state: "open"
} satisfies SessionProfileHandle
const OtherProfile = {
  kind: "session-profile",
  id: makeResourceId("session-profile:workspace-2"),
  generation: 0,
  ownerScope: "workspace:2",
  state: "open"
} satisfies SessionProfileHandle

test("CookieStore public surface omits shallow service and layer helpers", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const source = yield* Effect.promise(() =>
        readFile(new URL("cookie-store.ts", import.meta.url), "utf8")
      )
      const indexSource = yield* Effect.promise(() =>
        readFile(new URL("index.ts", import.meta.url), "utf8")
      )

      for (const removedName of [
        "CookieStoreServiceApi",
        "class CookieStoreClient",
        "CookieStoreLive",
        "makeCookieStoreClientLayer",
        "makeCookieStoreServiceLayer",
        "makeCookieStoreBridgeClientLayer",
        "makeCookieStoreService"
      ]) {
        expect(source).not.toContain(removedName)
        expect(indexSource).not.toContain(removedName)
      }
    })
  ))

test("CookieStore exposes get, remove, set, and isSupported as callable RPCs", () => {
  const callableTags = Array.from(CookieStoreRpcs.requests.keys()).toSorted()
  expect(callableTags).toEqual([
    "CookieStore.events.Event",
    "CookieStore.get",
    "CookieStore.isSupported",
    "CookieStore.remove",
    "CookieStore.set"
  ])
  for (const method of SupportedMethods) {
    expect(callableTags).toContain(`CookieStore.${method}`)
  }
})

test("CookieStore event schema is owned by the RPC stream contract", async () => {
  const cookieStoreModule = await import("./cookie-store.js")
  const rootModule = await import("./index.js")
  const callableTags = Array.from(CookieStoreRpcs.requests.keys()).toSorted()
  const eventRpc = CookieStoreRpcs.requests.get("CookieStore.events.Event")

  for (const removedExport of ["CookieStoreCapabilityFacts", "CookieStoreRpcEvents"]) {
    expect(removedExport in cookieStoreModule).toBe(false)
    expect(removedExport in rootModule).toBe(false)
  }
  expect(callableTags).toEqual([
    "CookieStore.events.Event",
    "CookieStore.get",
    "CookieStore.isSupported",
    "CookieStore.remove",
    "CookieStore.set"
  ])
  expect(eventRpc).toBeDefined()
  expect(eventRpc === undefined ? false : RpcSchema.isStreamSchema(eventRpc.successSchema)).toBe(
    true
  )
  if (eventRpc !== undefined && RpcSchema.isStreamSchema(eventRpc.successSchema)) {
    expect(eventRpc.successSchema.success).toBe(CookieStoreEvent)
    expect(eventRpc.pipe(rpcSupport)).toEqual(ExpectedLiveWebViewSupport)
  }

  const eventDoc = CookieStoreSurface.schemaDocs.find(
    (doc) => doc.tag === "CookieStore.events.Event"
  )
  expect(eventDoc?.kind).toBe("stream")
  expect(eventDoc?.callable).toBe(true)
  expect(eventDoc?.support).toEqual(ExpectedLiveWebViewSupport)
})

test("CookieStore isSupported reports supported result through the service", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeCookieStoreMemoryClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const store = yield* CookieStore
          return yield* store.isSupported()
        }),
        cookieStoreLayer(client)
      )
      expect(result.supported).toBe(true)
    })
  ))

test("CookieStore get validates input and returns a typed result through the service", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeCookieStoreMemoryClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const store = yield* CookieStore
          return yield* store.get({
            profile: Profile,
            url: "https://example.test/account",
            name: "token"
          })
        }),
        cookieStoreLayer(client)
      )
      expect(result.cookies).toEqual([])
    })
  ))

test("CookieStore remove validates input and delegates through the service", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeCookieStoreMemoryClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const store = yield* CookieStore
          yield* store.remove({
            profile: Profile,
            url: "https://example.test/account",
            name: "token"
          })
          return true
        }),
        cookieStoreLayer(client)
      )
      expect(result).toBe(true)
      const error = yield* Effect.flip(
        client.remove({
          profile: Profile,
          url: "https://example.test/account",
          name: ""
        })
      )
      expect(error).toMatchObject({ tag: "InvalidArgument", operation: "CookieStore.remove" })
    })
  ))

test("CookieStore set validates input and delegates through the service", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeCookieStoreMemoryClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const store = yield* CookieStore
          yield* store.set({
            profile: Profile,
            url: "https://example.test/account",
            cookie: {
              name: "token",
              value: "secret",
              domain: "example.test",
              path: "/account",
              secure: true,
              httpOnly: true,
              sameSite: "lax",
              expiresAt: 1_710_000_000_000
            }
          })
          return true
        }),
        cookieStoreLayer(client)
      )
      expect(result).toBe(true)
      const error = yield* Effect.flip(
        client.set({
          profile: Profile,
          url: "https://example.test/account",
          cookie: {
            name: "token",
            value: "secret",
            domain: "example.test",
            path: "account"
          }
        })
      )
      expect(error).toMatchObject({ tag: "InvalidArgument", operation: "CookieStore.set" })
    })
  ))

test("CookieStore unsupported client reports the host-unavailable reason", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = makeCookieStoreUnsupportedClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const store = yield* CookieStore
          return yield* store.isSupported()
        }),
        cookieStoreLayer(client)
      )
      expect(result.supported).toBe(false)
      expect(result.reason).toBe("host-cookie-store-unavailable")
      const error = yield* Effect.flip(
        client.get({ profile: Profile, url: "https://example.test" })
      )
      expect(error.tag).toBe("Unsupported")
      expect(error.operation).toBe("CookieStore.get")
      const removeError = yield* Effect.flip(
        client.remove({ profile: Profile, url: "https://example.test", name: "token" })
      )
      expect(removeError.tag).toBe("Unsupported")
      expect(removeError.operation).toBe("CookieStore.remove")
      const setError = yield* Effect.flip(
        client.set({
          profile: Profile,
          url: "https://example.test",
          cookie: {
            name: "token",
            value: "secret",
            domain: "example.test",
            path: "/"
          }
        })
      )
      expect(setError.tag).toBe("Unsupported")
      expect(setError.operation).toBe("CookieStore.set")
    })
  ))

test("CookieStore contracts reject inconsistent event phase payloads", () => {
  const cookie = {
    name: "token",
    value: "secret",
    domain: "example.test",
    path: "/"
  } as const
  const invalidPayloads = [
    {
      type: "cookie-store-event",
      timestamp: 1_710_000_000_000,
      phase: "set",
      profile: Profile,
      url: "https://example.test/account",
      name: "token",
      message: "bad shape"
    },
    {
      type: "cookie-store-event",
      timestamp: 1_710_000_000_000,
      phase: "removed",
      profile: Profile,
      url: "https://example.test/account",
      cookie
    },
    {
      type: "cookie-store-event",
      timestamp: 1_710_000_000_000,
      phase: "failed",
      profile: Profile,
      url: "https://example.test/account",
      cookie,
      message: "host failed"
    }
  ] as const

  for (const payload of invalidPayloads) {
    const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(CookieStoreEvent)(payload))
    expect(exit._tag).toBe("Failure")
  }

  for (const payload of [
    {
      type: "cookie-store-event",
      timestamp: 1_710_000_000_000,
      phase: "set",
      profile: Profile,
      url: "https://example.test/account",
      cookie
    },
    {
      type: "cookie-store-event",
      timestamp: 1_710_000_000_000,
      phase: "removed",
      profile: Profile,
      url: "https://example.test/account",
      name: "token"
    },
    {
      type: "cookie-store-event",
      timestamp: 1_710_000_000_000,
      phase: "failed",
      profile: Profile,
      url: "https://example.test/account",
      message: "host failed"
    }
  ] as const) {
    const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(CookieStoreEvent)(payload))
    expect(exit._tag).toBe("Success")
  }
})

test("CookieStore event types reject impossible phase payloads", () => {
  type CookieStoreEventValue = typeof CookieStoreEvent.Type
  const cookie = {
    name: "token",
    value: "secret",
    domain: "example.test",
    path: "/"
  } as const
  const baseEvent = {
    type: "cookie-store-event",
    timestamp: 1_710_000_000_000,
    profile: Profile,
    url: "https://example.test/account"
  } as const

  const set: CookieStoreEventValue = {
    ...baseEvent,
    phase: "set",
    cookie
  }
  const removed: CookieStoreEventValue = {
    ...baseEvent,
    phase: "removed",
    name: "token"
  }
  const failed: CookieStoreEventValue = {
    ...baseEvent,
    phase: "failed",
    message: "host failed"
  }

  expect(set.phase).toBe("set")
  expect(removed.phase).toBe("removed")
  expect(failed.message).toBe("host failed")

  // @ts-expect-error set cookie store events must not carry name.
  const setWithName: CookieStoreEventValue = {
    ...baseEvent,
    phase: "set",
    cookie,
    name: "token"
  }
  // @ts-expect-error removed cookie store events must not carry cookie.
  const removedWithCookie: CookieStoreEventValue = {
    ...baseEvent,
    phase: "removed",
    name: "token",
    cookie
  }
  // @ts-expect-error failed cookie store events must carry message.
  const failedWithoutMessage: CookieStoreEventValue = {
    ...baseEvent,
    phase: "failed"
  }

  expect(setWithName.phase).toBe("set")
  expect(removedWithCookie.phase).toBe("removed")
  expect(failedWithoutMessage.phase).toBe("failed")
})

test("CookieStore direct client consumes the canonical RPC event stream", () =>
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
                      timestamp: 1_710_000_000_000,
                      traceId: envelope.traceId,
                      payload: {
                        type: "cookie-store-event",
                        timestamp: 1_710_000_000_000,
                        phase: "removed",
                        profile: Profile,
                        url: "https://example.test/account",
                        name: "token"
                      }
                    })
                  ),
                  Queue.offer(
                    queue,
                    new HostProtocolResponseEnvelope({
                      kind: "response",
                      id: envelope.id,
                      timestamp: 1_710_000_000_001,
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
            nextRequestId: () => "cookie-store-event-rpc",
            nextTraceId: () => "trace-cookie-store-event-rpc"
          }
        )
      )

      const event = yield* runScoped(
        Effect.gen(function* () {
          const store = yield* CookieStore
          return yield* store.events(Profile).pipe(Stream.runHead, Effect.map(Option.getOrThrow))
        }),
        Layer.provide(CookieStoreSurface.clientLayer, protocolLayer)
      )

      expect(event).toEqual(
        new CookieStoreRemovedEvent({
          type: "cookie-store-event",
          timestamp: 1_710_000_000_000,
          phase: "removed",
          profile: Profile,
          url: "https://example.test/account",
          name: "token"
        })
      )
      expect(requests.map((request) => request.method)).toEqual(["CookieStore.events.Event"])
    })
  ))

test("CookieStore bridge client rejects inconsistent event phase payloads as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exchange: BridgeClientExchange = {
        request: () => Effect.die("CookieStore event test does not issue bridge requests"),
        subscribe: (method) =>
          Stream.make(
            new HostProtocolEventEnvelope({
              kind: "event",
              method,
              timestamp: 1_710_000_000_000,
              traceId: "cookie-store-event-trace",
              payload: {
                type: "cookie-store-event",
                timestamp: 1_710_000_000_000,
                phase: "set",
                profile: Profile,
                url: "https://example.test/account",
                name: "token",
                message: "bad shape"
              }
            })
          )
      }
      const exit = yield* runScoped(
        Effect.gen(function* () {
          const store = yield* CookieStore
          return yield* Effect.exit(
            store.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
          )
        }),
        CookieStoreSurface.bridgeClientLayer(exchange)
      )

      expectInvalidOutput(exit)
    })
  ))

test("CookieStore bridge client filters event streams by session profile", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const subscriptions: string[] = []
      const exchange: BridgeClientExchange = {
        request: () => Effect.die("CookieStore event filter test does not issue bridge requests"),
        subscribe: (method) => {
          subscriptions.push(method)
          return Stream.make(
            new HostProtocolEventEnvelope({
              kind: "event",
              method,
              timestamp: 1_710_000_000_000,
              traceId: "cookie-store-other-profile",
              payload: {
                type: "cookie-store-event",
                timestamp: 1_710_000_000_000,
                phase: "removed",
                profile: OtherProfile,
                url: "https://example.test/account",
                name: "token"
              }
            }),
            new HostProtocolEventEnvelope({
              kind: "event",
              method,
              timestamp: 1_710_000_000_001,
              traceId: "cookie-store-target-profile",
              payload: {
                type: "cookie-store-event",
                timestamp: 1_710_000_000_001,
                phase: "removed",
                profile: Profile,
                url: "https://example.test/account",
                name: "token"
              }
            })
          )
        }
      }
      const events = yield* runScoped(
        Effect.gen(function* () {
          const store = yield* CookieStore
          return yield* store.events(Profile).pipe(Stream.take(1), Stream.runCollect)
        }),
        CookieStoreSurface.bridgeClientLayer(exchange)
      )

      expect(Array.from(events)).toEqual([
        new CookieStoreRemovedEvent({
          type: "cookie-store-event",
          timestamp: 1_710_000_000_001,
          phase: "removed",
          profile: Profile,
          url: "https://example.test/account",
          name: "token"
        })
      ])
      expect(subscriptions).toEqual(["CookieStore.Event"])
    })
  ))

test("CookieStore keeps unsupported helpers out of schema docs", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const manifest = yield* makeNativeCapabilityManifest([
        { schemaDocs: CookieStoreSurface.schemaDocs }
      ])
      const byTag = new Map(manifest.map((fact) => [fact.tag, fact] as const))

      expect(byTag.has("CookieStore.set")).toBe(true)

      const callableFactTags = CookieStoreSurface.schemaDocs
        .filter((doc) => doc.callable)
        .map((doc) => doc.tag)
        .toSorted()
      expect(callableFactTags).toEqual([
        "CookieStore.events.Event",
        "CookieStore.get",
        "CookieStore.isSupported",
        "CookieStore.remove",
        "CookieStore.set"
      ])
      const getFact = CookieStoreSurface.schemaDocs.find((doc) => doc.tag === "CookieStore.get")
      expect(getFact?.support.status).toBe("partial")
      if (getFact?.support.status !== "partial") {
        throw new Error("CookieStore.get should be partially supported")
      }
      expect(getFact.support.reason).toBe("host-cookie-store-live-webview-required")
      const removeFact = CookieStoreSurface.schemaDocs.find(
        (doc) => doc.tag === "CookieStore.remove"
      )
      expect(removeFact?.support.status).toBe("partial")
      if (removeFact?.support.status !== "partial") {
        throw new Error("CookieStore.remove should be partially supported")
      }
      expect(removeFact.support.reason).toBe("host-cookie-store-live-webview-required")
      const setFact = CookieStoreSurface.schemaDocs.find((doc) => doc.tag === "CookieStore.set")
      expect(setFact?.support.status).toBe("partial")
      if (setFact?.support.status !== "partial") {
        throw new Error("CookieStore.set should be partially supported")
      }
      expect(setFact.support.reason).toBe("host-cookie-store-live-webview-required")

      const nonCallableTags = CookieStoreSurface.schemaDocs
        .filter((doc) => !doc.callable)
        .map((doc) => doc.tag)
        .toSorted()
      expect(nonCallableTags).toEqual([])
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

const cookieStoreLayer = (client: CookieStoreClientApi): Layer.Layer<CookieStore> =>
  Layer.succeed(CookieStore)(client)

const expectInvalidOutput = <A, E>(exit: Exit.Exit<A, E>): void => {
  expect(exit._tag).toBe("Failure")
  if (exit._tag !== "Failure") {
    return
  }

  expect(Cause.squash(exit.cause)).toBeInstanceOf(HostProtocolInvalidOutputError)
}
