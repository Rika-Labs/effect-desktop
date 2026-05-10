import { expect, test } from "bun:test"
import { Desktop } from "@rikalabs/effect-desktop/core"

import { NextDesktop } from "./index.js"

test("NextDesktop.from exposes the React desktop adapter behind a client boundary module", () => {
  const NotesApp = Desktop.make({
    windows: {
      main: {
        title: "Notes"
      }
    }
  })
  const NotesNext = NextDesktop.from(NotesApp)

  expect(NotesNext.app).toBe(NotesApp)
  expect(typeof NotesNext.DesktopRoot).toBe("function")
  expect(typeof NotesNext.createRoot).toBe("function")
  expect(typeof NotesNext.useDesktop).toBe("function")
})
