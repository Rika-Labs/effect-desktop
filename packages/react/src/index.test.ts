import { expect, test } from "bun:test"
import { makeHostProtocolInvalidStateError } from "@effect-desktop/bridge"
import { Effect, Option } from "effect"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import {
  DesktopProvider,
  type DesktopClient,
  useDesktop,
  useWindow,
  type DesktopWindowClient
} from "./index.js"

const unavailableWindow: DesktopWindowClient = {
  create: () =>
    Effect.fail(makeHostProtocolInvalidStateError("unavailable", "call", "Window.create")),
  setTitle: () =>
    Effect.fail(makeHostProtocolInvalidStateError("unavailable", "call", "Window.setTitle")),
  close: () => Effect.fail(makeHostProtocolInvalidStateError("unavailable", "call", "Window.close"))
}

const desktop: DesktopClient = Object.freeze({
  Window: unavailableWindow
})

test("DesktopProvider supplies the desktop client as a value", () => {
  const Probe = () => {
    const provided = useDesktop()

    return createElement("span", null, Option.isSome(provided) ? "provided" : "missing")
  }

  expect(
    renderToStaticMarkup(createElement(DesktopProvider, { client: desktop }, createElement(Probe)))
  ).toBe("<span>provided</span>")
})

test("hooks model a missing provider without throwing", () => {
  const Probe = () => {
    const desktopOption = useDesktop()
    const windowOption = useWindow()

    return createElement(
      "span",
      null,
      Option.isNone(desktopOption) && Option.isNone(windowOption) ? "missing" : "provided"
    )
  }

  expect(renderToStaticMarkup(createElement(Probe))).toBe("<span>missing</span>")
})
