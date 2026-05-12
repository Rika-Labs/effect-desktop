import { expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import {
  HostProtocolResponseEnvelope,
  HostProtocolStreamByRequestEnvelope,
  makeHostProtocolInvalidOutputError,
  makeHostProtocolInvalidStateError,
  RpcEndpoint,
  RpcSupport,
  type HostProtocolEnvelope,
  type HostProtocolError
} from "@effect-desktop/bridge"
import {
  Desktop,
  DuplicateDesktopRpcNameError,
  MissingDesktopRpcClientError,
  type DesktopRendererRpcTransport
} from "@effect-desktop/core"
import { AsyncResult } from "effect/unstable/reactivity"
import { Cause, Effect, Exit, Fiber, Option, Queue, Schema, Stream } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import {
  BrowserHttpClient,
  BrowserKeyValueStore,
  createUnavailableDesktopClient,
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

interface ReactPackageJson {
  readonly exports: Record<string, ReactPackageExportTarget>
}

type ReactPackageExportTarget =
  | string
  | {
      readonly types?: string
      readonly default?: string
    }

const reactPackageJsonUrl = new URL("../package.json", import.meta.url)
const reactPackageRootUrl = new URL("../", import.meta.url)

test("React package exports point at checked-in source files", () => {
  const packageJson = JSON.parse(readFileSync(reactPackageJsonUrl, "utf8")) as ReactPackageJson
  const missing: string[] = []

  for (const [subpath, target] of Object.entries(packageJson.exports)) {
    if (typeof target === "string") {
      if (!existsSync(new URL(target, reactPackageRootUrl))) {
        missing.push(`${subpath}:default:${target}`)
      }
      continue
    }

    for (const condition of ["types", "default"] as const) {
      const relativePath = target[condition]
      if (relativePath === undefined) {
        missing.push(`${subpath}:${condition}:<missing condition>`)
      } else if (!existsSync(new URL(relativePath, reactPackageRootUrl))) {
        missing.push(`${subpath}:${condition}:${relativePath}`)
      }
    }
  }

  expect(missing).toEqual([])
})

const unavailableWindow: DesktopWindowClient = {
  create: () =>
    Effect.fail(makeHostProtocolInvalidStateError("unavailable", "call", "window.create")),
  setTitle: () =>
    Effect.fail(makeHostProtocolInvalidStateError("unavailable", "call", "window.setTitle")),
  close: () => Effect.fail(makeHostProtocolInvalidStateError("unavailable", "call", "window.close"))
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
  window: unavailableWindow
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

test("createUnavailableDesktopClient exposes lowercase renderer namespaces", async () => {
  const client = createUnavailableDesktopClient("test unavailable")
  const exit = await Effect.runPromiseExit(client.window.create())

  expect(Exit.isFailure(exit)).toBe(true)
})

test("useDesktopQuery defaults to reload-only dependencies for inline operations", () => {
  const source = readFileSync(new URL("./hooks/desktop.ts", import.meta.url), "utf8")

  expect(source).toContain("deps === undefined ? [reloads] : [...deps, reloads]")
  expect(source).not.toContain("deps === undefined ? [reloads, operation]")
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
  const NotesReact = ReactDesktop.from(Desktop.manifest(NotesApp))
  const transport = makeRpcTransport({
    "Notes.List": () => Effect.succeed(["inbox"]),
    "Notes.Create": (input) => {
      const title = (input as { readonly title?: unknown }).title
      return Effect.succeed(`note:${typeof title === "string" ? title : "untitled"}`)
    }
  })
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
    renderToStaticMarkup(createElement(NotesReact.DesktopRoot, { transport }, createElement(Probe)))
  ).toBe("<span>initial:idle</span>")
})

test("ReactDesktop.useDesktop keeps reserved endpoint names as own properties", () => {
  const Reserved = Rpc.make("Notes.__proto__", { success: Schema.String }).pipe(RpcEndpoint.query)
  const NotesRpcs = RpcGroup.make(Reserved)
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
          "Notes.__proto__": () => Effect.succeed("ok")
        })
      )
    )
  )
  const NotesReact = ReactDesktop.from(Desktop.manifest(NotesApp))
  const transport = makeRpcTransport({
    "Notes.__proto__": () => Effect.succeed("ok")
  })
  const Probe = () => {
    const notes = NotesReact.useDesktop(NotesRpcs) as unknown as Record<string, unknown>
    const hasReserved = Object.prototype.hasOwnProperty.call(notes, "__proto__")
    return createElement("span", null, `${Object.getPrototypeOf(notes) === null}:${hasReserved}`)
  }

  expect(
    renderToStaticMarkup(createElement(NotesReact.DesktopRoot, { transport }, createElement(Probe)))
  ).toBe("<span>true:true</span>")
})

test("ReactDesktop.useDesktop rejects colliding endpoint names", () => {
  const ProjectList = Rpc.make("Projects.List", { success: Schema.Array(Schema.String) })
  const TaskList = Rpc.make("Tasks.List", { success: Schema.Array(Schema.String) })
  const CollidingRpcs = RpcGroup.make(ProjectList, TaskList)
  const CollidingApp = Desktop.make({
    windows: {
      main: {
        title: "Lists"
      }
    }
  }).pipe(
    Desktop.provide(
      Desktop.Rpcs.layer(
        CollidingRpcs,
        CollidingRpcs.toLayer({
          "Projects.List": () => Effect.succeed(["project"]),
          "Tasks.List": () => Effect.succeed(["task"])
        })
      )
    )
  )
  const CollidingReact = ReactDesktop.from(Desktop.manifest(CollidingApp))
  const transport = makeRpcTransport({
    "Projects.List": () => Effect.succeed(["project"]),
    "Tasks.List": () => Effect.succeed(["task"])
  })
  const Probe = () => {
    CollidingReact.useDesktop(CollidingRpcs)
    return createElement("span", null, "mounted")
  }

  expect(() =>
    renderToStaticMarkup(
      createElement(CollidingReact.DesktopRoot, { transport }, createElement(Probe))
    )
  ).toThrow(DuplicateDesktopRpcNameError)
})

test("ReactDesktop.useDesktop fails loudly without a generated root or transport", () => {
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
  const NotesReact = ReactDesktop.from(Desktop.manifest(NotesApp))
  const Probe = () => {
    NotesReact.useDesktop(NotesRpcs)
    return createElement("span", null, "mounted")
  }

  expect(() => renderToStaticMarkup(createElement(Probe))).toThrow(MissingDesktopContextError)
  expect(() =>
    renderToStaticMarkup(createElement(NotesReact.DesktopRoot, null, createElement(Probe)))
  ).toThrow(MissingDesktopRpcClientError)
})

test("ReactDesktop.useDesktop exposes RpcSupport metadata on generated endpoints", () => {
  const Unsupported = Rpc.make("Notes.Unsupported", { success: Schema.String }).pipe(
    RpcEndpoint.query,
    RpcSupport.unsupported("host method is unavailable")
  )
  const NotesRpcs = RpcGroup.make(Unsupported)
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
          "Notes.Unsupported": () => Effect.succeed("unused")
        })
      )
    )
  )
  const NotesReact = ReactDesktop.from(Desktop.manifest(NotesApp))
  const transport = makeRpcTransport({
    "Notes.Unsupported": () => Effect.succeed("unused")
  })
  const Probe = () => {
    const notes = NotesReact.useDesktop(NotesRpcs)
    return createElement(
      "span",
      null,
      `${notes.unsupported.isSupported}:${notes.unsupported.support.status}`
    )
  }

  expect(
    renderToStaticMarkup(createElement(NotesReact.DesktopRoot, { transport }, createElement(Probe)))
  ).toBe("<span>false:unsupported</span>")
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

type RpcTransportHandler = (
  payload: unknown
) => Effect.Effect<unknown, unknown, never> | Stream.Stream<unknown, unknown, never>

const makeRpcTransport = (
  handlers: Readonly<Record<string, RpcTransportHandler>>
): DesktopRendererRpcTransport => {
  const queue = Effect.runSync(Queue.unbounded<HostProtocolEnvelope>())
  const fibers = new Map<string, Fiber.Fiber<void, unknown>>()
  return {
    send: (envelope) => {
      if (envelope.kind === "cancel" && envelope.id !== undefined) {
        const fiber = fibers.get(envelope.id)
        if (fiber === undefined) {
          return Effect.void
        }
        fibers.delete(envelope.id)
        return Fiber.interrupt(fiber).pipe(Effect.asVoid)
      }
      if (envelope.kind !== "request") {
        return Effect.void
      }
      const handler = handlers[envelope.method]
      if (handler === undefined) {
        return Queue.offer(
          queue,
          responseEnvelope(envelope, {
            error: makeHostProtocolInvalidOutputError(envelope.method, "missing test handler")
          })
        )
      }
      const result = handler(envelope.payload)
      if (Stream.isStream(result)) {
        return Effect.gen(function* () {
          const fiber = yield* Effect.forkDetach(
            Effect.exit(
              Stream.runForEach(result, (item) =>
                Queue.offer(queue, streamEnvelope(envelope, item))
              )
            ).pipe(
              Effect.flatMap((exit) => Queue.offer(queue, responseFromExit(envelope, exit))),
              Effect.asVoid
            ),
            { startImmediately: true }
          )
          fibers.set(envelope.id, fiber)
        })
      }
      return Effect.exit(result).pipe(
        Effect.flatMap((exit) => Queue.offer(queue, responseFromExit(envelope, exit)))
      )
    },
    run: (onEnvelope) => Effect.forever(Queue.take(queue).pipe(Effect.flatMap(onEnvelope)))
  }
}

const responseFromExit = (
  request: Extract<HostProtocolEnvelope, { readonly kind: "request" }>,
  exit: Exit.Exit<unknown, unknown>
): HostProtocolResponseEnvelope =>
  Exit.isSuccess(exit)
    ? responseEnvelope(request, { payload: exit.value === undefined ? null : exit.value })
    : responseEnvelope(request, { error: hostProtocolErrorFromCause(request.method, exit.cause) })

const responseEnvelope = (
  request: Extract<HostProtocolEnvelope, { readonly kind: "request" }>,
  fields: { readonly payload?: unknown; readonly error?: HostProtocolError }
): HostProtocolResponseEnvelope =>
  new HostProtocolResponseEnvelope({
    kind: "response",
    id: request.id,
    timestamp: 0,
    traceId: request.traceId,
    ...fields
  })

const streamEnvelope = (
  request: Extract<HostProtocolEnvelope, { readonly kind: "request" }>,
  payload: unknown
): HostProtocolStreamByRequestEnvelope =>
  new HostProtocolStreamByRequestEnvelope({
    kind: "stream",
    id: request.id,
    timestamp: 0,
    traceId: request.traceId,
    payload
  })

const hostProtocolErrorFromCause = (
  method: string,
  cause: Cause.Cause<unknown>
): HostProtocolError => {
  const failure = cause.reasons.find(Cause.isFailReason)
  return failure?.error instanceof Error || typeof failure?.error === "string"
    ? makeHostProtocolInvalidOutputError(method, String(failure.error))
    : makeHostProtocolInvalidOutputError(method, String(cause))
}

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
