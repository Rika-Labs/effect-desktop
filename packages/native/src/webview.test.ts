import { expect, test } from "bun:test"
import { Effect, Exit, Schema } from "effect"

import { WebViewRuntimeEvent } from "./contracts/webview.js"

const webviewHandle = {
  kind: "webview",
  id: "webview-1",
  generation: 0,
  ownerScope: "window:window-1",
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
        { webview: webviewHandle, phase: "drag-leave", position: { x: 12, y: 24 } }
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
