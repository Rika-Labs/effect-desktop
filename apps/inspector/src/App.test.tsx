import { expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { App } from "./App.js"
import type { InspectorAppSnapshot } from "./inspector-app.js"

test("App exposes the selected Inspector session to assistive technology", () => {
  const html = renderToStaticMarkup(
    createElement(App, {
      snapshot: inspectorSnapshot(),
      onSelectSession: () => undefined
    })
  )

  expect(html).toContain('aria-current="page"')
  expect(html).toContain('class="session-button selected" aria-current="page"')
  expect(html).toContain('class="session-button"')
})

test("App renders timeline event times with machine-readable dates", () => {
  const html = renderToStaticMarkup(
    createElement(App, {
      snapshot: inspectorSnapshot({
        events: [
          {
            id: "event-one",
            atMs: 1000,
            surface: "transport",
            title: "rpc.notes.load",
            detail: "method",
            category: "rpc"
          }
        ]
      }),
      onSelectSession: () => undefined
    })
  )

  expect(html).toContain('<time dateTime="1970-01-01T00:00:01.000Z">1000</time>')
})

const inspectorSnapshot = (
  overrides: Partial<InspectorAppSnapshot> = {}
): InspectorAppSnapshot => ({
  selectedSessionId: "recorded-one",
  sessions: [
    {
      id: "live-one",
      label: "Live app",
      kind: "live",
      startedAt: 1,
      events: 0
    },
    {
      id: "recorded-one",
      label: "Recorded fixture",
      kind: "recorded",
      startedAt: 2,
      events: 1
    }
  ],
  events: [],
  categories: [],
  ...overrides
})
