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

const inspectorSnapshot = (): InspectorAppSnapshot => ({
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
  categories: []
})
