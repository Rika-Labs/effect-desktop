import { expect, test } from "bun:test"
import {
  makeHostProtocolInvalidStateError,
  RpcEndpoint
} from "@rikalabs/effect-desktop/bridge"
import { Desktop, MissingDesktopRpcsError } from "@rikalabs/effect-desktop/core"
import { AsyncResult } from "effect/unstable/reactivity"
import { Cause, Effect, Option, Schema } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"
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
  MissingDesktopContextError,
  ReactDesktop,
  currentWindow,
  type DesktopClient,
  type DesktopWindowClient,
  type ReactDesktopRpcClient,
  windows,
  type PermissionState,
  useDesktop,
  usePermission,
  useWindow
} from "./index.js"
import { layerLocalStorage, layerSessionStorage } from "./storage/kv.js"
import { makeDatabase, makeMigration, makeTable, makeVersion } from "./storage/idb.js"
import { disposeRuntime } from "./provider.js"

// Regression coverage may mention the old placeholder marker:
// "phase 0 stub compiles and runs" without triggering the repo-shape gate.

const unavailableWindow: DesktopWindowClient = {
  create: () =>
    Effect.fail(makeHostProtocolInvalidStateError("unavailable", "call", "Window.create")),
  setTitle: () =>
    Effect.fail(makeHostProtocolInvalidStateError("unavailable", "call", "Window.setTitle")),
  close: () => Effect.fail(makeHostProtocolInvalidStateError("unavailable", "call", "Window.close"))
}

test("disposeRuntime reports cleanup defects through onCleanupError", async () => {
  const failures: Array<{ context: string; error: unknown }> = []
  disposeRuntime(
    {
      dispose: () => Promise.reject(new Error("dispose failed"))
    },
    (error, context) => {
      failures.push({ context, error })
    }
  )

  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(failures).toEqual([{ context: "runtime cleanup", error: expect.anything() }])
})

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

test("currentWindow subpath exposes the current renderer window id", () => {
  const Probe = () => {
    const windowId = currentWindow.id.useQuery()
    return createElement(
      "span",
      null,
      Option.getOrElse(windowId, () => "missing")
    )
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

test("windows subpath exposes idle create mutation state before invocation", () => {
  const Probe = () => {
    const createWindow = windows.create.useMutation()
    return createElement("span", null, createWindow.status)
  }

  expect(
    renderToStaticMarkup(createElement(DesktopProvider, { client: desktop }, createElement(Probe)))
  ).toBe("<span>idle</span>")
})

test("ReactDesktop.from exposes app-scoped RPC hooks from provided groups", () => {
  const ListNotes = Rpc.make("Notes.List", { success: Schema.Array(Schema.String) }).pipe(
    RpcEndpoint.query
  )
  const CreateNote = Rpc.make("Notes.Create", {
    payload: { title: Schema.String },
    success: Schema.String
  })
  const NotesRpcs = RpcGroup.make(ListNotes, CreateNote)
  const NotesApp = Desktop.make({
    windows: {
      main: {
        title: "Notes"
      }
    }
  }).pipe(
    Desktop.provide(
      Desktop.Rpcs.layer(
        NotesRpcs,
        NotesRpcs.toLayer({
          "Notes.List": () => Effect.succeed(["inbox"]),
          "Notes.Create": ({ title }) => Effect.succeed(`note:${title}`)
        })
      )
    )
  )
  const NotesReact = ReactDesktop.from(NotesApp)
  const client: ReactDesktopRpcClient = {
    "Notes.List": () => Effect.succeed(["inbox"]),
    "Notes.Create": (input) =>
      Effect.succeed(`note:${(input as { readonly title?: unknown }).title ?? "untitled"}`)
  }
  const Probe = () => {
    const notes = NotesReact.useDesktop(NotesRpcs)
    const list = notes.list.useQuery()
    const create = notes.create.useMutation()

    return createElement(
      "span",
      null,
      `${AsyncResult.isInitial(list) ? "initial" : "ready"}:${create.status}`
    )
  }

  expect(
    renderToStaticMarkup(
      createElement(
        NotesReact.DesktopRoot,
        { clients: [[NotesRpcs, client]] },
        createElement(Probe)
      )
    )
  ).toBe("<span>initial:idle</span>")
})

test("ReactDesktop.useDesktop fails loudly without a generated root or installed client", () => {
  const Ping = Rpc.make("Notes.Ping")
  const NotesRpcs = RpcGroup.make(Ping)
  const NotesApp = Desktop.make({
    windows: {
      main: {
        title: "Notes"
      }
    }
  }).pipe(
    Desktop.provide(
      Desktop.Rpcs.layer(
        NotesRpcs,
        NotesRpcs.toLayer({
          "Notes.Ping": () => Effect.void
        })
      )
    )
  )
  const NotesReact = ReactDesktop.from(NotesApp)
  const Probe = () => {
    NotesReact.useDesktop(NotesRpcs)
    return createElement("span", null, "mounted")
  }

  expect(() => renderToStaticMarkup(createElement(Probe))).toThrow(MissingDesktopContextError)
  expect(() =>
    renderToStaticMarkup(createElement(NotesReact.DesktopRoot, null, createElement(Probe)))
  ).toThrow(MissingDesktopRpcsError)
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

test("usePermission rejects empty permission identifiers", () => {
  const Probe = () => {
    usePermission("")
    return createElement("span", null, "mounted")
  }

  expect(() => renderToStaticMarkup(createElement(Probe))).toThrow(RangeError)
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

test("storage/idb exposes migration builder helper", () => {
  expect(typeof makeMigration).toBe("function")
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

test("storage/kv exposes key-value layers", () => {
  expect(typeof layerLocalStorage).toBe("object")
  expect(typeof layerSessionStorage).toBe("object")
})

test("storage/idb exposes schema constructor helpers", () => {
  expect(typeof makeTable).toBe("function")
  expect(typeof makeVersion).toBe("function")
  expect(typeof makeDatabase).toBe("function")
})

test("platform-browser IndexedDbQueryBuilder exports make", () => {
  expect(typeof IndexedDbQueryBuilder.make).toBe("function")
})
