import { expect, test } from "bun:test"
import { makeHostProtocolInvalidStateError } from "@effect-desktop/bridge"
import { AsyncResult } from "effect/unstable/reactivity"
import { Cause, Effect, Option, Schema } from "effect"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import {
  BrowserHttpClient,
  BrowserKeyValueStore,
  IndexedDb,
  IndexedDbDatabase,
  IndexedDbQueryBuilder,
  IndexedDbTable,
  IndexedDbVersion,
  DesktopProvider,
  type DesktopClient,
  type DesktopWindowClient,
  type PermissionState,
  useDesktop,
  usePermission,
  useWindow
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

test("DesktopProvider renders children without crashing (SSR)", () => {
  const Child = () => createElement("span", null, "child")
  const html = renderToStaticMarkup(
    createElement(DesktopProvider, { client: desktop }, createElement(Child))
  )
  expect(html).toBe("<span>child</span>")
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

test("usePermission exports the deferred shape", () => {
  let state: PermissionState | undefined
  const Probe = () => {
    state = usePermission("dialog.open")
    return createElement("span", null, state.status)
  }

  expect(renderToStaticMarkup(createElement(Probe))).toBe("<span>deferred</span>")
  expect(state).toEqual({ status: "deferred", permission: "dialog.open" })
})

test("AsyncResult.initial is Initial variant", () => {
  const result = AsyncResult.initial<number, string>()
  expect(AsyncResult.isInitial(result)).toBe(true)
  expect(AsyncResult.isSuccess(result)).toBe(false)
  expect(AsyncResult.isFailure(result)).toBe(false)
})

test("AsyncResult.success carries value", () => {
  const result = AsyncResult.success(42)
  expect(AsyncResult.isSuccess(result)).toBe(true)
  if (AsyncResult.isSuccess(result)) {
    expect(result.value).toBe(42)
  }
})

test("AsyncResult.failure carries cause", () => {
  const cause = Cause.fail("boom")
  const result = AsyncResult.failure<number, string>(cause)
  expect(AsyncResult.isFailure(result)).toBe(true)
  if (AsyncResult.isFailure(result)) {
    expect(result.cause).toBe(cause)
  }
})

test("AsyncResult is re-exported from package index", () => {
  expect(typeof AsyncResult.initial).toBe("function")
  expect(typeof AsyncResult.success).toBe("function")
  expect(typeof AsyncResult.failure).toBe("function")
  expect(typeof AsyncResult.isInitial).toBe("function")
  expect(typeof AsyncResult.isSuccess).toBe("function")
  expect(typeof AsyncResult.isFailure).toBe("function")
})

test("platform-browser IndexedDbTable.make produces a typed table descriptor", () => {
  const DraftTable = IndexedDbTable.make({
    name: "drafts",
    schema: Schema.Struct({
      id: Schema.Number,
      body: Schema.String
    }),
    keyPath: "id",
    autoIncrement: true
  })

  expect(DraftTable.tableName).toBe("drafts")
  expect(DraftTable.autoIncrement).toBe(true)
  expect(DraftTable.keyPath).toBe("id")
})

test("platform-browser IndexedDbVersion.make accepts a table descriptor", () => {
  const DraftTable = IndexedDbTable.make({
    name: "drafts",
    schema: Schema.Struct({
      id: Schema.Number,
      body: Schema.String
    }),
    keyPath: "id",
    autoIncrement: true
  })

  const v1 = IndexedDbVersion.make(DraftTable)

  expect(v1.tables.has("drafts")).toBe(true)
  expect(v1.tables.size).toBe(1)
})

test("platform-browser IndexedDbDatabase.make produces a schema builder", () => {
  const DraftTable = IndexedDbTable.make({
    name: "drafts",
    schema: Schema.Struct({
      id: Schema.Number,
      body: Schema.String
    }),
    keyPath: "id",
    autoIncrement: true
  })

  const v1 = IndexedDbVersion.make(DraftTable)

  const schema = IndexedDbDatabase.make(v1, (tx) =>
    tx.createObjectStore("drafts").pipe(Effect.asVoid)
  )

  expect(typeof schema.layer).toBe("function")
  expect(schema.version).toBe(v1)
})

test("platform-browser BrowserKeyValueStore exports layerLocalStorage and layerSessionStorage", () => {
  expect(typeof BrowserKeyValueStore.layerLocalStorage).toBe("object")
  expect(typeof BrowserKeyValueStore.layerSessionStorage).toBe("object")
})

test("platform-browser BrowserHttpClient exports layerFetch and layerXMLHttpRequest", () => {
  expect(typeof BrowserHttpClient.layerFetch).toBe("object")
  expect(typeof BrowserHttpClient.layerXMLHttpRequest).toBe("object")
})

test("platform-browser IndexedDb exports layerWindow", () => {
  expect(typeof IndexedDb.layerWindow).toBe("object")
})

test("platform-browser IndexedDbQueryBuilder exports make", () => {
  expect(typeof IndexedDbQueryBuilder.make).toBe("function")
})
