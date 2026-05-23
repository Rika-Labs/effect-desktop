import { expect, test } from "bun:test"
import {
  type BridgeClientExchange,
  HostProtocolEventEnvelope,
  HostProtocolInvalidOutputError
} from "@orika/bridge"
import { makeResourceId } from "@orika/core"
import { Cause, Effect, Exit, Schema, Stream } from "effect"

import { WebViewFrameEvent, WebViewRuntimeEvent } from "./contracts/webview.js"
import { WebViewClient, WebViewSurface } from "./webview.js"

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

const frameEventBase = () => ({
  webview: webviewHandle,
  frame: webviewFrameHandle
})
