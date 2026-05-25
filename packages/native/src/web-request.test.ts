import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import {
  type BridgeClientExchange,
  type HostProtocolEnvelope,
  HostProtocolEventEnvelope,
  HostProtocolInvalidOutputError,
  HostProtocolResponseEnvelope,
  type HostProtocolRequestEnvelope,
  HostProtocolStreamByRequestEnvelope,
  makeDesktopClientProtocol,
  rpcSupport
} from "@orika/bridge"
import { makeResourceId } from "@orika/core"
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option, Queue, Schema, Stream } from "effect"
import { RpcClient, RpcSchema } from "effect/unstable/rpc"

import { makeNativeCapabilityManifest } from "./capabilities.js"
import {
  WebRequestBeforeRequestInput,
  WebRequestEvent,
  WebRequestInterceptorSnapshot
} from "./contracts/web-request.js"
import {
  makeWebRequestMemoryClient,
  makeWebRequestUnsupportedClient,
  WebRequest,
  type WebRequestClientApi,
  WebRequestRpcs,
  WebRequestSurface
} from "./web-request.js"

const UnsupportedMethods = ["onBeforeRequest", "onHeadersReceived", "removeListener"] as const
const UnsupportedSupport = {
  status: "unsupported",
  reason: "host-web-request-unavailable",
  platforms: [
    { platform: "macos", status: "unsupported", reason: "host-web-request-unavailable" },
    { platform: "windows", status: "unsupported", reason: "host-web-request-unavailable" },
    { platform: "linux", status: "unsupported", reason: "host-web-request-unavailable" }
  ]
} as const
const sessionProfileHandle = {
  kind: "session-profile",
  id: makeResourceId("profile-1"),
  generation: 0,
  ownerScope: "test",
  state: "open"
} as const
const beforeRequestInput = {
  profile: sessionProfileHandle,
  urlPattern: "https://example.test/*"
} as const
const webRequestInterceptor = {
  kind: "web-request-interceptor",
  id: makeResourceId("interceptor-1"),
  generation: 0,
  ownerScope: "test",
  state: "open"
} as const
const interceptorSnapshot = {
  interceptor: webRequestInterceptor,
  profile: sessionProfileHandle,
  urlPattern: "https://example.test/*",
  order: 0
} as const

test("WebRequest public surface omits shallow service and layer helpers", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const source = yield* Effect.promise(() =>
        readFile(new URL("web-request.ts", import.meta.url), "utf8")
      )
      const indexSource = yield* Effect.promise(() =>
        readFile(new URL("index.ts", import.meta.url), "utf8")
      )
      const webRequestModule = yield* Effect.promise(() => import("./web-request.js"))
      const rootModule = yield* Effect.promise(() => import("./index.js"))

      for (const removedName of [
        "WebRequest" + "CapabilityFacts",
        "WebRequestRpcEvents",
        "class WebRequestClient",
        "WebRequestLive",
        "WebRequestServiceApi",
        "makeWebRequestService",
        "makeWebRequestClientLayer",
        "makeWebRequestServiceLayer",
        "makeWebRequestBridgeClientLayer"
      ]) {
        expect(source).not.toContain(removedName)
        expect(indexSource).not.toContain(removedName)
      }
      expect("WebRequestCapabilityFacts" in webRequestModule).toBe(false)
      expect("WebRequestCapabilityFacts" in rootModule).toBe(false)
      expect("WebRequestRpcEvents" in webRequestModule).toBe(false)
      expect("WebRequestRpcEvents" in rootModule).toBe(false)
    })
  ))

test("WebRequest before-request redirect action requires a matching redirect URL", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const redirectWithoutUrl = yield* Effect.exit(
        Schema.decodeUnknownEffect(WebRequestBeforeRequestInput)({
          ...beforeRequestInput,
          action: "redirect"
        })
      )
      const allowWithRedirectUrl = yield* Effect.exit(
        Schema.decodeUnknownEffect(WebRequestBeforeRequestInput)({
          ...beforeRequestInput,
          action: "allow",
          redirectUrl: "https://redirect.example.test/"
        })
      )
      const blockWithRedirectUrl = yield* Effect.exit(
        Schema.decodeUnknownEffect(WebRequestBeforeRequestInput)({
          ...beforeRequestInput,
          action: "block",
          redirectUrl: "https://redirect.example.test/"
        })
      )
      const validRedirect = yield* Schema.decodeUnknownEffect(WebRequestBeforeRequestInput)({
        ...beforeRequestInput,
        action: "redirect",
        redirectUrl: "https://redirect.example.test/"
      })

      expect(Exit.isFailure(redirectWithoutUrl)).toBe(true)
      expect(Exit.isFailure(allowWithRedirectUrl)).toBe(true)
      expect(Exit.isFailure(blockWithRedirectUrl)).toBe(true)
      expect(validRedirect.redirectUrl).toBe("https://redirect.example.test/")
    })
  ))

test("WebRequest interceptor snapshots require phase action fields to match", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const beforeRequestModifyHeaders = yield* Effect.exit(
        Schema.decodeUnknownEffect(WebRequestInterceptorSnapshot)({
          ...interceptorSnapshot,
          phase: "before-request",
          action: "modify-headers",
          responseHeaders: [{ name: "x-test", value: "1" }]
        })
      )
      const headersReceivedRedirect = yield* Effect.exit(
        Schema.decodeUnknownEffect(WebRequestInterceptorSnapshot)({
          ...interceptorSnapshot,
          phase: "headers-received",
          action: "redirect",
          redirectUrl: "https://redirect.example.test/"
        })
      )
      const headersReceivedMissingHeaders = yield* Effect.exit(
        Schema.decodeUnknownEffect(WebRequestInterceptorSnapshot)({
          ...interceptorSnapshot,
          phase: "headers-received",
          action: "modify-headers"
        })
      )
      const beforeRequestRedirectWithoutUrl = yield* Effect.exit(
        Schema.decodeUnknownEffect(WebRequestInterceptorSnapshot)({
          ...interceptorSnapshot,
          phase: "before-request",
          action: "redirect"
        })
      )
      const validRedirect = yield* Schema.decodeUnknownEffect(WebRequestInterceptorSnapshot)({
        ...interceptorSnapshot,
        phase: "before-request",
        action: "redirect",
        redirectUrl: "https://redirect.example.test/"
      })
      const validHeadersReceived = yield* Schema.decodeUnknownEffect(WebRequestInterceptorSnapshot)(
        {
          ...interceptorSnapshot,
          phase: "headers-received",
          action: "modify-headers",
          responseHeaders: [{ name: "x-test", value: "1" }]
        }
      )

      expect(Exit.isFailure(beforeRequestModifyHeaders)).toBe(true)
      expect(Exit.isFailure(headersReceivedRedirect)).toBe(true)
      expect(Exit.isFailure(headersReceivedMissingHeaders)).toBe(true)
      expect(Exit.isFailure(beforeRequestRedirectWithoutUrl)).toBe(true)
      expect(validRedirect.redirectUrl).toBe("https://redirect.example.test/")
      expect(validHeadersReceived.responseHeaders).toEqual([{ name: "x-test", value: "1" }])
    })
  ))

test("WebRequest interceptor snapshot types reject impossible phase action payloads", () => {
  type WebRequestInterceptorSnapshotValue = typeof WebRequestInterceptorSnapshot.Type

  const beforeRequestAllow: WebRequestInterceptorSnapshotValue = {
    ...interceptorSnapshot,
    phase: "before-request",
    action: "allow"
  }
  const beforeRequestRedirect: WebRequestInterceptorSnapshotValue = {
    ...interceptorSnapshot,
    phase: "before-request",
    action: "redirect",
    redirectUrl: "https://redirect.example.test/"
  }
  const headersReceived: WebRequestInterceptorSnapshotValue = {
    ...interceptorSnapshot,
    phase: "headers-received",
    action: "modify-headers",
    responseHeaders: [{ name: "x-test", value: "1" }]
  }

  expect(beforeRequestAllow.action).toBe("allow")
  expect(beforeRequestRedirect.redirectUrl).toBe("https://redirect.example.test/")
  expect(headersReceived.responseHeaders).toEqual([{ name: "x-test", value: "1" }])

  // @ts-expect-error before-request snapshots must not use modify-headers.
  const beforeRequestModifyHeaders: WebRequestInterceptorSnapshotValue = {
    ...interceptorSnapshot,
    phase: "before-request",
    action: "modify-headers",
    responseHeaders: [{ name: "x-test", value: "1" }]
  }
  // @ts-expect-error redirect snapshots require redirectUrl.
  const beforeRequestRedirectWithoutUrl: WebRequestInterceptorSnapshotValue = {
    ...interceptorSnapshot,
    phase: "before-request",
    action: "redirect"
  }
  // @ts-expect-error non-redirect before-request snapshots must not carry redirectUrl.
  const beforeRequestAllowWithRedirectUrl: WebRequestInterceptorSnapshotValue = {
    ...interceptorSnapshot,
    phase: "before-request",
    action: "allow",
    redirectUrl: "https://redirect.example.test/"
  }
  // @ts-expect-error headers-received snapshots require modify-headers.
  const headersReceivedRedirect: WebRequestInterceptorSnapshotValue = {
    ...interceptorSnapshot,
    phase: "headers-received",
    action: "redirect",
    redirectUrl: "https://redirect.example.test/"
  }
  // @ts-expect-error headers-received snapshots require responseHeaders.
  const headersReceivedMissingHeaders: WebRequestInterceptorSnapshotValue = {
    ...interceptorSnapshot,
    phase: "headers-received",
    action: "modify-headers"
  }
  // @ts-expect-error headers-received snapshots must not carry redirectUrl.
  const headersReceivedWithRedirectUrl: WebRequestInterceptorSnapshotValue = {
    ...interceptorSnapshot,
    phase: "headers-received",
    action: "modify-headers",
    responseHeaders: [{ name: "x-test", value: "1" }],
    redirectUrl: "https://redirect.example.test/"
  }

  expect(beforeRequestModifyHeaders.action).toBe("modify-headers")
  expect(beforeRequestRedirectWithoutUrl.action).toBe("redirect")
  expect(beforeRequestAllowWithRedirectUrl.action).toBe("allow")
  expect(headersReceivedRedirect.action).toBe("redirect")
  expect(headersReceivedMissingHeaders.action).toBe("modify-headers")
  expect(headersReceivedWithRedirectUrl.action).toBe("modify-headers")
})

test("WebRequest events reject inconsistent failure messages", () => {
  for (const payload of [
    {
      ...eventBase(),
      phase: "registered",
      message: "host failed"
    },
    {
      ...eventBase(),
      phase: "removed",
      message: "host failed"
    },
    {
      ...eventBase(),
      phase: "matched",
      message: "host failed"
    },
    {
      ...eventBase(),
      phase: "failed"
    }
  ] as const) {
    const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(WebRequestEvent)(payload))
    expect(Exit.isFailure(exit)).toBe(true)
  }

  for (const payload of [
    {
      ...eventBase(),
      phase: "registered"
    },
    {
      ...eventBase(),
      phase: "removed"
    },
    {
      ...eventBase(),
      phase: "matched"
    },
    {
      ...eventBase(),
      phase: "failed",
      message: "host failed"
    }
  ] as const) {
    const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(WebRequestEvent)(payload))
    expect(Exit.isSuccess(exit)).toBe(true)
  }
})

test("WebRequest event schema is owned by the RPC stream contract", () => {
  const callableTags = Array.from(WebRequestRpcs.requests.keys()).toSorted()
  expect(callableTags).toEqual(["WebRequest.events.Event", "WebRequest.isSupported"])
  for (const method of UnsupportedMethods) {
    expect(callableTags).not.toContain(`WebRequest.${method}`)
  }

  const eventRpc = WebRequestRpcs.requests.get("WebRequest.events.Event")
  expect(eventRpc).toBeDefined()
  expect(eventRpc === undefined ? false : RpcSchema.isStreamSchema(eventRpc.successSchema)).toBe(
    true
  )
  if (eventRpc !== undefined && RpcSchema.isStreamSchema(eventRpc.successSchema)) {
    expect(eventRpc.successSchema.success).toBe(WebRequestEvent)
    expect(eventRpc.pipe(rpcSupport)).toEqual(UnsupportedSupport)
  }
})

test("WebRequest declares onBeforeRequest/onHeadersReceived/removeListener as unsupported capability facts", () => {
  const facts = webRequestCapabilityFacts()
  const factTags = facts.map((fact) => fact.tag).toSorted()
  expect(factTags).toEqual(UnsupportedMethods.map((method) => `WebRequest.${method}`).toSorted())
  for (const fact of facts) {
    expect(fact.support).toEqual(UnsupportedSupport)
  }
})

test("WebRequest capability facts surface in the manifest and stay non-callable", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const manifest = yield* makeNativeCapabilityManifest([
        { schemaDocs: WebRequestSurface.schemaDocs }
      ])
      const byTag = new Map(manifest.map((fact) => [fact.tag, fact] as const))

      for (const method of UnsupportedMethods) {
        const fact = byTag.get(`WebRequest.${method}`)
        expect(fact).toBeDefined()
        expect(fact?.support.status).toBe("unsupported")
      }

      const callableTags = WebRequestSurface.schemaDocs
        .filter((doc) => doc.callable)
        .map((doc) => doc.tag)
      expect(callableTags.toSorted()).toEqual(["WebRequest.events.Event", "WebRequest.isSupported"])

      const eventDoc = WebRequestSurface.schemaDocs.find(
        (doc) => doc.tag === "WebRequest.events.Event"
      )
      expect(eventDoc?.kind).toBe("stream")
      expect(eventDoc?.callable).toBe(true)
      expect(eventDoc?.support).toEqual(UnsupportedSupport)

      const nonCallableTags = WebRequestSurface.schemaDocs
        .filter((doc) => !doc.callable)
        .map((doc) => doc.tag)
        .toSorted()
      expect(nonCallableTags).toEqual(
        UnsupportedMethods.map((method) => `WebRequest.${method}`).toSorted()
      )
    })
  ))

test("WebRequest direct client consumes the canonical RPC event stream", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* directWebRequestEvent(eventBase())

      expect(result.event).toMatchObject(eventBase())
      expect(result.methods).toEqual(["WebRequest.events.Event"])
    })
  ))

test("WebRequest isSupported reports supported result through the service", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeWebRequestMemoryClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const service = yield* WebRequest
          return yield* service.isSupported()
        }),
        webRequestLayer(client)
      )
      expect(result.supported).toBe(true)
    })
  ))

test("WebRequest unsupported client reports the host-unavailable reason", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = makeWebRequestUnsupportedClient()
      const result = yield* runScoped(
        Effect.gen(function* () {
          const service = yield* WebRequest
          return yield* service.isSupported()
        }),
        webRequestLayer(client)
      )
      expect(result.supported).toBe(false)
      expect(result.reason).toBe("host-web-request-unavailable")
    })
  ))

test("WebRequest unsupported client fails the event stream as unsupported", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = makeWebRequestUnsupportedClient()
      const exit = yield* runScoped(
        Effect.gen(function* () {
          const service = yield* WebRequest
          return yield* Effect.exit(service.events().pipe(Stream.take(1), Stream.runCollect))
        }),
        webRequestLayer(client)
      )

      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "Unsupported",
          reason: "host-web-request-unavailable",
          operation: "WebRequest.Event"
        })
      })
    })
  ))

test("WebRequest bridge client subscribes to the host event channel", () =>
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

      const collected = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* WebRequest
          return yield* client.events().pipe(Stream.runCollect)
        }),
        WebRequestSurface.bridgeClientLayer(exchange)
      )

      expect(Array.from(collected)).toEqual([])
      expect(subscriptions).toEqual(["WebRequest.Event"])
    })
  ))

test("WebRequest bridge client rejects inconsistent event messages as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exchange: BridgeClientExchange = {
        request: () => Effect.die("WebRequest event test does not issue bridge requests"),
        subscribe: (method) =>
          Stream.make(
            new HostProtocolEventEnvelope({
              kind: "event",
              method,
              timestamp: 1_710_000_000_000,
              traceId: "web-request-event-trace",
              payload: {
                ...eventBase(),
                phase: "registered",
                message: "host failed"
              }
            })
          )
      }

      const exit = yield* runScoped(
        Effect.gen(function* () {
          const webRequest = yield* WebRequest
          return yield* Effect.exit(
            webRequest.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
          )
        }),
        WebRequestSurface.bridgeClientLayer(exchange)
      )

      expectInvalidOutput(exit)
    })
  ))

const eventBase = () => ({
  type: "web-request-event",
  timestamp: 1_710_000_000_000,
  phase: "registered",
  interceptor: webRequestInterceptor,
  profile: sessionProfileHandle,
  requestPhase: "before-request",
  urlPattern: "https://example.test/*",
  action: "block",
  order: 1
})

const directWebRequestEvent = (payload: unknown) =>
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
          nextRequestId: () => "web-request-event-request",
          nextTraceId: () => "web-request-event-trace"
        }
      )
    )

    const event = yield* runScoped(
      Effect.gen(function* () {
        const client = yield* WebRequest
        return yield* client
          .events(sessionProfileHandle)
          .pipe(Stream.runHead, Effect.map(Option.getOrThrow))
      }),
      Layer.provide(WebRequestSurface.clientLayer, protocolLayer)
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

const webRequestLayer = (client: WebRequestClientApi): Layer.Layer<WebRequest> =>
  Layer.succeed(WebRequest)(client)

const webRequestCapabilityFacts = () => WebRequestSurface.schemaDocs.filter((doc) => !doc.callable)

const expectExitFailure = <A>(
  exit: Exit.Exit<A, unknown>,
  assert: (error: unknown) => void
): void => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    assert(Cause.squash(exit.cause))
  }
}

const expectInvalidOutput = <A, E>(exit: Exit.Exit<A, E>): void => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (!Exit.isFailure(exit)) {
    return
  }

  expect(Cause.squash(exit.cause)).toBeInstanceOf(HostProtocolInvalidOutputError)
}
