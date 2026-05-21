import { expect, test } from "bun:test"
import { Desktop } from "@orika/core"

import { NextDesktop } from "./index.js"

test("NextDesktop.from exposes the React desktop adapter behind a client boundary module", () => {
  const NotesApp = Desktop.make({
    windows: Desktop.window("main", { title: "Notes" })
  })
  const NotesManifest = Desktop.manifest(NotesApp)
  const NotesNext = NextDesktop.from(NotesManifest)

  expect(NotesNext.app).toBe(NotesManifest)
  expect(typeof NotesNext.DesktopRoot).toBe("function")
  expect(typeof NotesNext.createRoot).toBe("function")
  expect(typeof NotesNext.useDesktop).toBe("function")
})
