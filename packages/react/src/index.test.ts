import { expect, test } from "bun:test"
import { makeHostProtocolInvalidStateError } from "@effect-desktop/bridge"
import { Effect, Option, Stream } from "effect"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import {
  DesktopProvider,
  type DesktopClient,
  type DesktopStreamState,
  retainDesktopStreamData,
  useDesktopStream,
  useDesktop,
  usePermission,
  useResource,
  useWindow,
  type DesktopWindowClient,
  type PermissionState
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

test("DesktopProvider can expose the current window handle", () => {
  const Probe = () => {
    const window = useWindow()

    return createElement("span", null, Option.isSome(window) ? window.value.id : "missing")
  }
  const window = {
    kind: "window",
    id: "window-1",
    generation: 0,
    ownerScope: "window:window-1",
    state: "open"
  } as const as Parameters<DesktopWindowClient["close"]>[0]

  expect(
    renderToStaticMarkup(
      createElement(
        DesktopProvider,
        { client: desktop, currentWindow: window },
        createElement(Probe)
      )
    )
  ).toBe("<span>window-1</span>")
})

test("usePermission exports the deferred Phase 16 shape", () => {
  let state: PermissionState | undefined
  const Probe = () => {
    state = usePermission("dialog.open")

    return createElement("span", null, state.status)
  }

  expect(renderToStaticMarkup(createElement(Probe))).toBe("<span>deferred</span>")
  expect(state).toEqual({ status: "deferred", permission: "dialog.open" })
})

test("hook exports are callable from components without provider throws", () => {
  const Probe = () => {
    useDesktopStream(Stream.empty)
    useResource(Option.none())

    return createElement("span", null, "mounted")
  }

  expect(renderToStaticMarkup(createElement(Probe))).toBe("<span>mounted</span>")
})

test("useDesktopStream exposes an initial value state during render", () => {
  let state: DesktopStreamState<number, never> | undefined
  const Probe = () => {
    state = useDesktopStream(Stream.make(1))

    return createElement("span", null, state.status)
  }

  expect(renderToStaticMarkup(createElement(Probe))).toBe("<span>idle</span>")
  expect(state).toEqual({
    status: "idle",
    data: [],
    error: Option.none()
  })
})

test("useDesktopStream retention keeps only the newest items within capacity", () => {
  const retained = [1, 2, 3, 4, 5].reduce<readonly number[]>(
    (current, item) => retainDesktopStreamData(current, item, 3),
    []
  )

  expect(retained).toEqual([3, 4, 5])
})

test("useDesktopStream retention can disable stored data", () => {
  const retained = [1, 2, 3].reduce<readonly number[]>(
    (current, item) => retainDesktopStreamData(current, item, 0),
    []
  )

  expect(retained).toEqual([])
})

test("useDesktopStream retention rejects invalid capacities", () => {
  expect(() => retainDesktopStreamData([], 1, -1)).toThrow(RangeError)
  expect(() => retainDesktopStreamData([], 1, 1.5)).toThrow(RangeError)
  expect(() => retainDesktopStreamData([], 1, Number.POSITIVE_INFINITY)).toThrow(RangeError)
})
