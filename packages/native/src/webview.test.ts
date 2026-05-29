import { expect, test } from "bun:test"
import {
  type BridgeClientExchange,
  type HostProtocolEnvelope,
  HostProtocolEventEnvelope,
  HostProtocolInvalidOutputError,
  HostProtocolResponseEnvelope,
  type HostProtocolRequestEnvelope,
  HostProtocolStreamByRequestEnvelope,
  makeDesktopClientProtocol
} from "@orika/bridge"
import { makeResourceId } from "@orika/core"
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option, Queue, Schema, Stream } from "effect"
import { RpcClient, RpcSchema, RpcTest } from "effect/unstable/rpc"

import {
  WebViewApiCallEvent,
  WebViewFrameEvent,
  WebViewNavigationBlockedEvent,
  WebViewRuntimeEvent
} from "./contracts/webview.js"
import {
  WebView,
  WebViewClient,
  WebViewHandlersLive,
  WebViewRpcs,
  WebViewSurface,
  type WebViewCreateNavigationOptions,
  type WebViewServiceApi
} from "./webview.js"

const webviewHandle = {
  kind: "webview",
  id: makeResourceId("webview-1"),
  generation: 0,
  ownerScope: "window:window-1",
  state: "open"
} as const

const webviewFrameHandle = {
  kind: "webview-frame",
  id: makeResourceId("frame-1"),
  generation: 0,
  ownerScope: "webview:webview-1",
  state: "open"
} as const

test("WebView public surface omits the side event object", async () => {
  const webViewModule = await import("./webview.js")
  const rootModule = await import("./index.js")

  expect("WebViewRpcEvents" in webViewModule).toBe(false)
  expect("WebViewRpcEvents" in rootModule).toBe(false)
})

test("WebView event schemas are owned by RPC stream contracts", () => {
  const expectedSchemas: ReadonlyArray<
    readonly [string, Schema.Codec<unknown, unknown, never, never>]
  > = [
    ["WebView.events.NavigationBlocked", WebViewNavigationBlockedEvent],
    ["WebView.events.ApiCall", WebViewApiCallEvent],
    ["WebView.events.RuntimeEvent", WebViewRuntimeEvent],
    ["WebView.events.FrameEvent", WebViewFrameEvent]
  ]

  for (const [tag, schema] of expectedSchemas) {
    const eventRpc = WebViewRpcs.requests.get(tag)
    const eventDoc = WebViewSurface.schemaDocs.find((doc) => doc.tag === tag)

    expect(eventRpc).toBeDefined()
    expect(eventRpc === undefined ? false : RpcSchema.isStreamSchema(eventRpc.successSchema)).toBe(
      true
    )
    if (eventRpc !== undefined && RpcSchema.isStreamSchema(eventRpc.successSchema)) {
      expect(eventRpc.successSchema.success).toBe(schema)
    }
    expect(eventDoc?.kind).toBe("stream")
    expect(eventDoc?.callable).toBe(true)
  }
})

test("WebView runtime events require phase-specific payload fields", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const malformedEvents = [
        { webview: webviewHandle, phase: "page-load-started" },
        { webview: webviewHandle, phase: "page-load-finished" },
        {
          webview: webviewHandle,
          phase: "page-load-started",
          url: "https://example.test/",
          position: { x: 12, y: 24 }
        },
        {
          webview: webviewHandle,
          phase: "page-load-finished",
          url: "https://example.test/",
          reason: "unexpected"
        },
        { webview: webviewHandle, phase: "drag-enter", paths: ["/tmp/report.txt"] },
        {
          webview: webviewHandle,
          phase: "drag-enter",
          paths: ["/tmp/report.txt"],
          position: { x: 12, y: 24 },
          permission: "camera"
        },
        { webview: webviewHandle, phase: "drag-drop", position: { x: 12, y: 24 } },
        {
          webview: webviewHandle,
          phase: "drag-drop",
          url: "https://example.test/",
          paths: ["/tmp/report.txt"],
          position: { x: 12, y: 24 }
        },
        {
          webview: webviewHandle,
          phase: "drag-drop",
          paths: ["/tmp/report.txt"],
          position: { x: 12, y: 24 },
          reason: "unexpected"
        },
        {
          webview: webviewHandle,
          phase: "drag-over",
          paths: ["/tmp/report.txt"],
          position: { x: 12, y: 24 }
        },
        {
          webview: webviewHandle,
          phase: "drag-over",
          position: { x: 12, y: 24 },
          requestId: "permission-request-1"
        },
        { webview: webviewHandle, phase: "drag-leave", decision: "grant" },
        { webview: webviewHandle, phase: "drag-leave", position: { x: 12, y: 24 } },
        { webview: webviewHandle, phase: "failed", url: "https://example.test/" }
      ] as const
      for (const event of malformedEvents) {
        const exit = yield* Effect.exit(Schema.decodeUnknownEffect(WebViewRuntimeEvent)(event))
        expect(Exit.isFailure(exit)).toBe(true)
      }

      const validEvents = [
        {
          webview: webviewHandle,
          phase: "page-load-started",
          url: "https://example.test/"
        },
        {
          webview: webviewHandle,
          phase: "page-load-finished",
          url: "https://example.test/"
        },
        {
          webview: webviewHandle,
          phase: "drag-enter",
          paths: ["/tmp/report.txt"],
          position: { x: 12, y: 24 }
        },
        { webview: webviewHandle, phase: "drag-over", position: { x: 12, y: 24 } },
        {
          webview: webviewHandle,
          phase: "drag-drop",
          paths: ["/tmp/report.txt"],
          position: { x: 12, y: 24 }
        },
        { webview: webviewHandle, phase: "drag-leave" },
        { webview: webviewHandle, phase: "failed" }
      ] as const
      for (const event of validEvents) {
        const decoded = yield* Schema.decodeUnknownEffect(WebViewRuntimeEvent)(event)
        expect(decoded.phase).toBe(event.phase)
      }
    })
  ))

test("WebView runtime event types reject impossible phase payloads", () => {
  type WebViewRuntimeEventValue = typeof WebViewRuntimeEvent.Type

  const pageLoadStarted: WebViewRuntimeEventValue = {
    webview: webviewHandle,
    phase: "page-load-started",
    url: "https://example.test/"
  }
  const dragDrop: WebViewRuntimeEventValue = {
    webview: webviewHandle,
    phase: "drag-drop",
    paths: ["/tmp/report.txt"],
    position: { x: 12, y: 24 }
  }
  const failed: WebViewRuntimeEventValue = {
    webview: webviewHandle,
    phase: "failed"
  }

  expect(pageLoadStarted.phase).toBe("page-load-started")
  expect(dragDrop.paths).toEqual(["/tmp/report.txt"])
  expect(failed.phase).toBe("failed")

  // @ts-expect-error page-load runtime events must not carry drag payloads.
  const pageLoadWithPosition: WebViewRuntimeEventValue = {
    webview: webviewHandle,
    phase: "page-load-finished",
    url: "https://example.test/",
    position: { x: 12, y: 24 }
  }
  // @ts-expect-error drag-drop runtime events require paths.
  const dragDropWithoutPaths: WebViewRuntimeEventValue = {
    webview: webviewHandle,
    phase: "drag-drop",
    position: { x: 12, y: 24 }
  }
  // @ts-expect-error placeholder runtime events must not carry covered phase payloads.
  const failedWithUrl: WebViewRuntimeEventValue = {
    webview: webviewHandle,
    phase: "failed",
    url: "https://example.test/"
  }

  expect(pageLoadWithPosition.phase).toBe("page-load-finished")
  expect(dragDropWithoutPaths.phase).toBe("drag-drop")
  expect(failedWithUrl.phase).toBe("failed")
})

test("WebView frame events require phase-specific payload fields", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const malformedEvents = [
        {
          ...frameEventBase(),
          phase: "created",
          url: "https://example.test/frame",
          payload: "unexpected"
        },
        {
          ...frameEventBase(),
          phase: "navigated",
          reason: "unexpected"
        },
        {
          ...frameEventBase(),
          phase: "destroyed",
          url: "https://example.test/frame"
        },
        {
          ...frameEventBase(),
          phase: "message"
        },
        {
          ...frameEventBase(),
          phase: "message",
          payload: "hello",
          reason: "unexpected"
        },
        {
          ...frameEventBase(),
          phase: "failed"
        },
        {
          ...frameEventBase(),
          phase: "failed",
          reason: "host failed",
          url: "https://example.test/frame"
        }
      ] as const

      for (const event of malformedEvents) {
        const exit = yield* Effect.exit(Schema.decodeUnknownEffect(WebViewFrameEvent)(event))
        expect(Exit.isFailure(exit)).toBe(true)
      }

      const validEvents = [
        {
          ...frameEventBase(),
          phase: "created",
          url: "https://example.test/frame"
        },
        {
          ...frameEventBase(),
          phase: "navigated",
          url: "https://example.test/frame"
        },
        {
          ...frameEventBase(),
          phase: "destroyed"
        },
        {
          ...frameEventBase(),
          phase: "message",
          payload: "hello"
        },
        {
          ...frameEventBase(),
          phase: "failed",
          reason: "host failed"
        }
      ] as const

      for (const event of validEvents) {
        const decoded = yield* Schema.decodeUnknownEffect(WebViewFrameEvent)(event)
        expect(decoded.phase).toBe(event.phase)
      }
    })
  ))

test("WebView frame bridge events reject inconsistent payloads as InvalidOutput", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const event = new HostProtocolEventEnvelope({
        kind: "event",
        method: "WebView.FrameEvent",
        timestamp: 1,
        traceId: "trace-frame",
        payload: {
          ...frameEventBase(),
          phase: "failed"
        }
      })
      const exchange: BridgeClientExchange = {
        request: () => Effect.die("unexpected request"),
        subscribe: () => Stream.fromIterable([event])
      }

      const exit = yield* Effect.gen(function* () {
        const client = yield* WebViewClient
        return yield* Effect.exit(client.onFrameEvent().pipe(Stream.take(1), Stream.runCollect))
      }).pipe(Effect.provide(WebViewSurface.bridgeClientLayer(exchange)))

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(Cause.squash(exit.cause)).toBeInstanceOf(HostProtocolInvalidOutputError)
      }
    })
  ))

test("WebView direct client consumes canonical RPC event streams", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* directWebViewRuntimeEvent({
        webview: webviewHandle,
        phase: "page-load-started",
        url: "https://example.test/"
      })

      expect(result.event).toMatchObject({
        webview: webviewHandle,
        phase: "page-load-started",
        url: "https://example.test/"
      })
      expect(result.methods).toEqual(["WebView.events.RuntimeEvent"])
    })
  ))

const windowHandle = {
  kind: "window",
  id: makeResourceId("window-1"),
  generation: 0,
  ownerScope: "window:window-1",
  state: "open"
} as const

const sessionProfileHandle = {
  kind: "session-profile",
  id: makeResourceId("profile-1"),
  generation: 0,
  ownerScope: "session-profile:profile-1",
  state: "open"
} as const

const makeRecordingWebViewService = (received: {
  current: WebViewCreateNavigationOptions | undefined
}): WebViewServiceApi =>
  ({
    create: (_window, input) =>
      Effect.sync(() => {
        received.current = input
        return webviewHandle
      }),
    loadRoute: () => Effect.void,
    loadUrl: () => Effect.void,
    reload: () => Effect.void,
    stop: () => Effect.void,
    goBack: () => Effect.void,
    goForward: () => Effect.void,
    getNavigationState: () =>
      Effect.succeed({ canGoBack: false, canGoForward: false, loading: false }),
    print: () => Effect.void,
    setZoom: () => Effect.void,
    openDevTools: () => Effect.void,
    closeDevTools: () => Effect.void,
    setNavigationPolicy: () => Effect.void,
    destroy: () => Effect.void,
    onNavigationBlocked: () => Stream.empty,
    onApiCall: () => Stream.empty,
    onRuntimeEvent: () => Stream.empty,
    onFrameEvent: () => Stream.empty
  }) satisfies WebViewServiceApi

test("WebView.create handler forwards the session profile to the WebView service", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const received: { current: WebViewCreateNavigationOptions | undefined } = {
        current: undefined
      }
      const handlers = Layer.provide(
        WebViewHandlersLive,
        Layer.succeed(WebView)(makeRecordingWebViewService(received))
      )

      yield* Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(WebViewRpcs)
        return yield* client["WebView.create"]({
          window: windowHandle,
          url: "app://localhost/",
          originPolicy: { allowedOrigins: ["app://localhost"], onDisallowed: "block" },
          profile: sessionProfileHandle
        })
      }).pipe(Effect.provide(handlers), Effect.scoped)

      expect(received.current).toBeDefined()
      expect(received.current?.profile).toBeDefined()
      expect(received.current?.profile?.id).toBe(sessionProfileHandle.id)
    })
  ))

const frameEventBase = () => ({
  webview: webviewHandle,
  frame: webviewFrameHandle
})

const directWebViewRuntimeEvent = (payload: unknown) =>
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
          nextRequestId: () => "webview-runtime-event-request",
          nextTraceId: () => "webview-runtime-event-trace"
        }
      )
    )

    const event = yield* runScoped(
      Effect.gen(function* () {
        const client = yield* WebViewClient
        return yield* client
          .onRuntimeEvent(webviewHandle)
          .pipe(Stream.runHead, Effect.map(Option.getOrThrow))
      }),
      Layer.provide(WebViewSurface.clientLayer, protocolLayer)
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
