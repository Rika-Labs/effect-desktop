import { expect, test } from "bun:test"
import { Desktop } from "@rikalabs/effect-desktop/core"

import { AstroDesktop, MissingAstroClientOnlyRendererError } from "./index.js"

test("AstroDesktop.from records framework island hydration metadata", () => {
  const NotesApp = Desktop.make({
    windows: {
      main: {
        title: "Notes"
      }
    }
  })
  const adapter = { framework: "react" }
  const island = AstroDesktop.from(NotesApp).island(adapter, {
    directive: "only",
    renderer: "react"
  })

  expect(island.app).toBe(NotesApp)
  expect(island.adapter).toBe(adapter)
  expect(island.directive).toBe("only")
  expect(island.renderer).toBe("react")
})

test("AstroDesktop rejects client:only islands without an explicit renderer hint", () => {
  const NotesApp = Desktop.make({
    windows: {
      main: {
        title: "Notes"
      }
    }
  })

  expect(() =>
    AstroDesktop.from(NotesApp).island({ framework: "solid" }, { directive: "only" })
  ).toThrow(MissingAstroClientOnlyRendererError)
})
