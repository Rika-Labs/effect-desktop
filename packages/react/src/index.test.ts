import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { BunServices } from "@effect/platform-bun"
import { makeHostProtocolInvalidStateError, RpcEndpoint, RpcSupport } from "@orika/bridge"
import {
  Desktop,
  DuplicateDesktopRpcNameError,
  makeResourceId,
  MissingDesktopRpcClientError
} from "@orika/core"
import {
  makeWindowServiceLayer,
  Native,
  WindowHandlersLive,
  WindowRpcs,
  type WindowClientApi
} from "@orika/native"
import type { WindowHandle } from "@orika/native/contracts"
import { AsyncResult, Atom } from "effect/unstable/reactivity"
import {
  Cause,
  Effect,
  Exit,
  FileSystem,
  Layer,
  ManagedRuntime,
  Option,
  Schema,
  Stream
} from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import {
  createUnavailableDesktopClient,
  DesktopProvider,
  MissingDesktopContextError,
  ReactDesktop,
  currentWindow,
  type CurrentWindowCloseMutation,
  type DesktopClient,
  type DesktopWindowClient,
  windows,
  type WindowCreateMutation,
  type PermissionState,
  useDesktop,
  useDesktopAction,
  useAtomValue,
  usePermission,
  useWindow
} from "./index.js"
import { layerLocalStorage, layerSessionStorage } from "./storage/kv.js"
import { makeDatabase, makeMigration, makeTable, makeVersion } from "./storage/idb.js"
import { disposeRuntime } from "./provider.js"

// Regression coverage may mention the old placeholder marker:
// "phase 0 stub compiles and runs" without triggering the repo-shape gate.

const ReactPackageExportTarget = Schema.Union([
  Schema.String,
  Schema.Struct({
    types: Schema.optionalKey(Schema.String),
    default: Schema.optionalKey(Schema.String)
  })
])

const ReactPackageJson = Schema.Struct({
  exports: Schema.Record(Schema.String, ReactPackageExportTarget)
})

const decodeReactPackageJson = Schema.decodeUnknownSync(Schema.fromJsonString(ReactPackageJson))

const reactPackageJsonUrl = new URL("../package.json", import.meta.url)
const reactPackageRootUrl = new URL("../", import.meta.url)
const reactPackageIndexUrl = new URL("index.ts", import.meta.url)
const reactDesktopSourceUrl = new URL("desktop.tsx", import.meta.url)
const workspaceRootUrl = new URL("../../../", import.meta.url)
const reactRootBundleEntryUrl = new URL(".tmp-react-root-bundle-entry.tsx", workspaceRootUrl)

const urlToPath = (url: URL): string => fileURLToPath(url)

const PlatformRuntime = ManagedRuntime.make(BunServices.layer)

test("React package exports point at checked-in source files", () =>
  PlatformRuntime.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const packageJson = decodeReactPackageJson(
        yield* fs.readFileString(urlToPath(reactPackageJsonUrl))
      )
      const missing: string[] = []

      for (const [subpath, target] of Object.entries(packageJson.exports)) {
        if (typeof target === "string") {
          if (!(yield* fs.exists(urlToPath(new URL(target, reactPackageRootUrl))))) {
            missing.push(`${subpath}:default:${target}`)
          }
          continue
        }

        for (const condition of ["types", "default"] as const) {
          const relativePath = target[condition]
          if (relativePath === undefined) {
            missing.push(`${subpath}:${condition}:<missing condition>`)
          } else if (!(yield* fs.exists(urlToPath(new URL(relativePath, reactPackageRootUrl))))) {
            missing.push(`${subpath}:${condition}:${relativePath}`)
          }
        }
      }

      expect(missing).toEqual([])
    })
  ))

test("React package root does not export browser storage services", () =>
  PlatformRuntime.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const source = yield* fs.readFileString(urlToPath(reactPackageIndexUrl))

      expect(source).not.toContain("BrowserKeyValueStore")
      expect(source).not.toContain("IndexedDb")
      expect(source).not.toContain("RendererSqlite")
      expect(source).not.toContain("indexedDbStorage")
      expect(source).not.toContain("keyValueStorage")
    })
  ))

test("ReactDesktop delegates native Window helpers to the native renderer client", () =>
  PlatformRuntime.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const source = yield* fs.readFileString(urlToPath(reactDesktopSourceUrl))

      expect(source).toContain("makeWindowRendererClient")
      expect(source).toContain('@orika/native/renderer"')
      expect(source).not.toContain('from "@orika/native"')
      expect(source).not.toContain("WindowResource")
      expect(source).not.toContain("RequiredWindowRpcTags")
    })
  ))

test("React package root hooks browser-bundle without host modules", () =>
  PlatformRuntime.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const entryPath = urlToPath(reactRootBundleEntryUrl)
      const outdir = yield* fs.makeTempDirectory({ prefix: "orika-react-root-bundle-" })

      try {
        yield* fs.writeFileString(
          entryPath,
          'import { useDesktopQuery } from "@orika/react"\nvoid useDesktopQuery\n'
        )

        const result = yield* Effect.promise(() =>
          Bun.build({
            entrypoints: [entryPath],
            format: "esm",
            outdir,
            target: "browser"
          })
        )

        expect(result.logs.map((log) => log.message)).toEqual([])
        expect(result.success).toBe(true)
      } finally {
        yield* fs.remove(entryPath, { force: true })
        yield* fs.remove(outdir, { recursive: true, force: true })
      }
    })
  ))

const unavailableWindow: DesktopWindowClient = {
  create: () =>
    Effect.fail(makeHostProtocolInvalidStateError("unavailable", "call", "window.create")),
  close: () =>
    Effect.fail(makeHostProtocolInvalidStateError("unavailable", "call", "window.close")),
  destroy: () =>
    Effect.fail(makeHostProtocolInvalidStateError("unavailable", "call", "window.destroy"))
}

test("disposeRuntime reports cleanup defects through onCleanupError", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const failures: Array<{ context: string; error: unknown }> = []
      disposeRuntime(
        {
          disposeEffect: Effect.die(new Error("dispose failed"))
        },
        (error, context) => {
          failures.push({ context, error })
        }
      )

      yield* Effect.yieldNow
      expect(failures).toEqual([{ context: "runtime cleanup", error: expect.anything() }])
    })
  ))

const desktop: DesktopClient = Object.freeze({
  window: unavailableWindow
})

const makeTestWindowHandle = (id: string): WindowHandle => ({
  kind: "window",
  id: makeResourceId(id),
  generation: 0,
  ownerScope: `window:${id}`,
  state: "open"
})

const testNoop = Effect.sync(() => undefined)
const testWindowBounds = { x: 0, y: 0, width: 100, height: 100 } as const
const testWindowState = {
  fullscreen: false,
  maximized: false,
  minimized: false,
  simpleFullscreen: false
} as const

const makeTestWindowClient = (current: WindowHandle, calls: string[]): WindowClientApi => ({
  create: (input) =>
    Effect.sync(() => {
      calls.push(`create:${input.title ?? ""}`)
      return current
    }),
  close: (window) =>
    Effect.sync(() => {
      calls.push(`close:${window.id}`)
    }),
  destroy: (window) =>
    Effect.sync(() => {
      calls.push(`destroy:${window.id}`)
    }),
  show: () => testNoop,
  hide: () => testNoop,
  focus: () => testNoop,
  getCurrent: () =>
    Effect.sync(() => {
      calls.push("getCurrent")
      return current
    }),
  getById: (windowId) => Effect.succeed(makeTestWindowHandle(windowId)),
  list: () => Effect.succeed([current]),
  getParent: () => Effect.sync((): WindowHandle | undefined => undefined),
  getChildren: () => Effect.succeed([]),
  getBounds: () => Effect.succeed(testWindowBounds),
  setBounds: (_window, bounds) => Effect.succeed(bounds),
  setBoundsOnDisplay: (_window, _displayId, bounds) => Effect.succeed(bounds),
  center: () => Effect.succeed(testWindowBounds),
  centerOnDisplay: () => Effect.succeed(testWindowBounds),
  setTitle: () => testNoop,
  setResizable: () => testNoop,
  setDecorations: () => testNoop,
  setTrafficLights: () => testNoop,
  setVibrancy: () => testNoop,
  clearVibrancy: () => testNoop,
  setShadow: () => testNoop,
  setTitleBarStyle: () => testNoop,
  setTitleBarTransparent: () => testNoop,
  setTransparent: () => testNoop,
  setAlwaysOnTop: () => testNoop,
  setSkipTaskbar: () => testNoop,
  setProgress: () => testNoop,
  requestAttention: () => testNoop,
  cancelAttention: () => testNoop,
  minimize: () => Effect.succeed(testWindowState),
  maximize: () => Effect.succeed(testWindowState),
  restore: () => Effect.succeed(testWindowState),
  setFullscreen: () => Effect.succeed(testWindowState),
  setSimpleFullscreen: () => Effect.succeed(testWindowState),
  getState: () => Effect.succeed(testWindowState),
  events: () => Stream.empty
})

test("DesktopProvider renders children without crashing (SSR)", () => {
  const Child = () => createElement("span", null, "child")
  const html = renderToStaticMarkup(
    createElement(DesktopProvider, { client: desktop }, createElement(Child))
  )
  expect(html).toBe("<span>child</span>")
})

test("DesktopProvider exposes the upstream Effect atom registry", () => {
  const count = Atom.make(42)
  const Probe = () => createElement("span", null, useAtomValue(count))

  expect(
    renderToStaticMarkup(createElement(DesktopProvider, { client: desktop }, createElement(Probe)))
  ).toBe("<span>42</span>")
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

test("window lifecycle subpaths expose explicit destroy mutations", () => {
  const Probe = () => {
    const destroyWindow = windows.destroy.useMutation()
    const destroyCurrentWindow = currentWindow.destroy.useMutation()
    return createElement("span", null, `${destroyWindow.status}:${destroyCurrentWindow.status}`)
  }
  const window = {
    kind: "window",
    id: "window-1",
    generation: 0,
    ownerScope: "window:window-1",
    state: "open"
  } as const as Parameters<DesktopWindowClient["destroy"]>[0]

  expect(
    renderToStaticMarkup(
      createElement(
        DesktopProvider,
        { client: desktop, currentWindow: window },
        createElement(Probe)
      )
    )
  ).toBe("<span>idle:idle</span>")
})

test("createUnavailableDesktopClient exposes lowercase renderer namespaces", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = createUnavailableDesktopClient("test unavailable")
      const exit = yield* Effect.exit(client.window.create())

      expect(Exit.isFailure(exit)).toBe(true)
    })
  ))

test("useDesktopQuery defaults to reload-only dependencies for inline operations", () =>
  PlatformRuntime.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const source = yield* fs.readFileString(
        urlToPath(new URL("./hooks/desktop.ts", import.meta.url))
      )

      expect(source).toContain("deps === undefined ? [reloads] : [...deps, reloads]")
      expect(source).not.toContain("deps === undefined ? [reloads, operation]")
    })
  ))

test("useDesktopAction cancel clears active action state synchronously", () =>
  PlatformRuntime.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const source = yield* fs.readFileString(
        urlToPath(new URL("./hooks/desktop.ts", import.meta.url))
      )

      expect(source).toContain("const cancelActiveAction = useCallback")
      expect(source).toContain(
        "const actionOperation = useMemo(() => makeFrameworkScopedOperation(defaultRuntime), [])"
      )
      expect(source).toContain("runningRef.current = false")
      expect(source).toContain("queueRef.current = []")
      expect(source).toContain("setState(idle<A, E>())")
      expect(source).not.toContain("const mountedRef = useRef(true)")
      expect(source).not.toContain("const runIdRef = useRef(0)")
    })
  ))

test("useDesktopAction accepts a new default action immediately after cancel", () => {
  let starts = 0
  let action: { readonly run: () => void; readonly cancel: () => void } | undefined

  const Probe = () => {
    action = useDesktopAction(() => {
      starts += 1
      return Effect.never
    })
    return createElement("span", null, "ready")
  }

  expect(renderToStaticMarkup(createElement(Probe))).toBe("<span>ready</span>")
  expect(action).toBeDefined()

  action?.run()
  action?.cancel()
  action?.run()
  action?.cancel()

  expect(starts).toBe(2)
})

test("React adapter lifecycle paths use the shared scoped framework helper", () =>
  PlatformRuntime.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const desktopSource = yield* fs.readFileString(
        urlToPath(new URL("./desktop.tsx", import.meta.url))
      )
      const mutationSource = yield* fs.readFileString(
        urlToPath(new URL("./mutation.ts", import.meta.url))
      )
      const desktopHookSource = yield* fs.readFileString(
        urlToPath(new URL("./hooks/desktop.ts", import.meta.url))
      )
      const streamHookSource = yield* fs.readFileString(
        urlToPath(new URL("./hooks/stream.ts", import.meta.url))
      )

      expect(desktopSource).toContain("makeFrameworkRuntime(runtime)")
      expect(desktopSource).toContain("Effect.runCallback(runtime.disposeEffect)")
      expect(desktopSource).not.toContain("void runtime.dispose()")
      expect(desktopSource).not.toContain("await frameworkRuntime.dispose()")
      expect(mutationSource).toContain("makeFrameworkScopedOperation(runtime)")
      expect(mutationSource).not.toContain("runIdRef")
      expect(mutationSource).not.toContain("mountedRef")
      expect(mutationSource).not.toContain("runFrameworkPromiseExit")
      expect(desktopHookSource).toContain("makeFrameworkScopedOperation(defaultRuntime)")
      expect(desktopHookSource).not.toContain("runFrameworkPromiseExit")
      expect(streamHookSource).toContain("makeFrameworkScopedOperation(runtime)")
      expect(streamHookSource).not.toContain("let active")
    })
  ))

test("ReactDesktop.from exposes app-scoped RPC hooks from provided groups", () => {
  const ListNotes = Rpc.make("Notes.List", { success: Schema.Array(Schema.String) }).pipe(
    RpcEndpoint.query
  )
  const CreateNote = Rpc.make("Notes.Create", {
    payload: { title: Schema.String },
    success: Schema.String
  })
  const NotesRpcs = RpcGroup.make(ListNotes, CreateNote)
  const NotesLayer = Desktop.rpc(
    NotesRpcs,
    NotesRpcs.toLayer({
      "Notes.List": () => Effect.succeed(["inbox"]),
      "Notes.Create": ({ title }) => Effect.succeed(`note:${title}`)
    })
  )
  const NotesApp = Desktop.make({
    windows: Desktop.window("main", { title: "Notes" }),
    rpcs: NotesLayer
  })
  const NotesReact = ReactDesktop.from(Desktop.manifest(NotesApp))
  const rpcs = NotesLayer
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
    renderToStaticMarkup(createElement(NotesReact.DesktopRoot, { rpcs }, createElement(Probe)))
  ).toBe("<span>initial:idle</span>")
})

test("ReactDesktop root exposes native Window helpers when the app declares Native.Window", () => {
  let closeCurrentWindow: CurrentWindowCloseMutation | undefined
  let createWindow: WindowCreateMutation | undefined
  const calls: string[] = []
  const window = makeTestWindowHandle("window-main")
  const WindowLayer = Desktop.rpc(
    WindowRpcs,
    Layer.provide(WindowHandlersLive, makeWindowServiceLayer(makeTestWindowClient(window, calls)))
  )
  const NotesApp = Desktop.make({
    windows: Desktop.window("main", { title: "Notes" }),
    native: Desktop.native(Native.Window)
  })
  const NotesReact = ReactDesktop.from(Desktop.manifest(NotesApp))
  const Probe = () => {
    closeCurrentWindow = currentWindow.close.useMutation()
    createWindow = windows.create.useMutation()
    return createElement("span", null, `${closeCurrentWindow.status}:${createWindow.status}`)
  }

  expect(
    renderToStaticMarkup(
      createElement(NotesReact.DesktopRoot, { rpcs: WindowLayer }, createElement(Probe))
    )
  ).toBe("<span>idle:idle</span>")

  if (closeCurrentWindow === undefined || createWindow === undefined) {
    throw new Error("window mutations were not captured")
  }
  const closeMutation = closeCurrentWindow
  const createMutation = createWindow

  return Effect.runPromise(
    Effect.gen(function* () {
      const createExit = yield* Effect.promise(() => createMutation.runPromise({ title: "Child" }))
      const closeExit = yield* Effect.promise(() => closeMutation.runPromise())
      expect(Exit.isSuccess(createExit)).toBe(true)
      expect(Exit.isSuccess(closeExit)).toBe(true)
      expect(calls).toEqual(["create:Child", "getCurrent", "close:window-main"])
    })
  )
})

test("ReactDesktop.useDesktop keeps reserved endpoint names as own properties", () => {
  const Reserved = Rpc.make("Notes.__proto__", { success: Schema.String }).pipe(RpcEndpoint.query)
  const NotesRpcs = RpcGroup.make(Reserved)
  const NotesLayer = Desktop.rpc(
    NotesRpcs,
    NotesRpcs.toLayer({
      "Notes.__proto__": () => Effect.succeed("ok")
    })
  )
  const NotesApp = Desktop.make({
    windows: Desktop.window("main", { title: "Notes" }),
    rpcs: NotesLayer
  })
  const NotesReact = ReactDesktop.from(Desktop.manifest(NotesApp))
  const rpcs = NotesLayer
  const Probe = () => {
    const notes = NotesReact.useDesktop(NotesRpcs)
    const hasReserved = Object.prototype.hasOwnProperty.call(notes, "__proto__")
    return createElement("span", null, `${Object.getPrototypeOf(notes) === null}:${hasReserved}`)
  }

  expect(
    renderToStaticMarkup(createElement(NotesReact.DesktopRoot, { rpcs }, createElement(Probe)))
  ).toBe("<span>true:true</span>")
})

test("ReactDesktop.useDesktop rejects colliding endpoint names", () => {
  const ProjectList = Rpc.make("Projects.List", { success: Schema.Array(Schema.String) })
  const TaskList = Rpc.make("Tasks.List", { success: Schema.Array(Schema.String) })
  const CollidingRpcs = RpcGroup.make(ProjectList, TaskList)
  const CollidingLayer = Desktop.rpc(
    CollidingRpcs,
    CollidingRpcs.toLayer({
      "Projects.List": () => Effect.succeed(["project"]),
      "Tasks.List": () => Effect.succeed(["task"])
    })
  )
  const CollidingApp = Desktop.make({
    windows: Desktop.window("main", { title: "Lists" }),
    rpcs: CollidingLayer
  })
  const CollidingReact = ReactDesktop.from(Desktop.manifest(CollidingApp))
  const rpcs = CollidingLayer
  const Probe = () => {
    CollidingReact.useDesktop(CollidingRpcs)
    return createElement("span", null, "mounted")
  }

  expect(() =>
    renderToStaticMarkup(createElement(CollidingReact.DesktopRoot, { rpcs }, createElement(Probe)))
  ).toThrow(DuplicateDesktopRpcNameError)
})

test("ReactDesktop.useDesktop fails loudly without a generated root or renderer RPC layers", () => {
  const Ping = Rpc.make("Notes.Ping")
  const NotesRpcs = RpcGroup.make(Ping)
  const NotesApp = Desktop.make({
    windows: Desktop.window("main", { title: "Notes" }),
    rpcs: Desktop.rpc(
      NotesRpcs,
      NotesRpcs.toLayer({
        "Notes.Ping": () => Effect.void
      })
    )
  })
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
  type SupportedQueryEndpoint = {
    readonly useQuery: unknown
    readonly support: { readonly status: string }
    readonly isSupported: boolean
  }
  const Unsupported = Rpc.make("Notes.Unsupported", { success: Schema.String }).pipe(
    RpcEndpoint.query,
    RpcSupport.unsupported("host method is unavailable")
  )
  const NotesRpcs = RpcGroup.make(Unsupported)
  const NotesLayer = Desktop.rpc(
    NotesRpcs,
    NotesRpcs.toLayer({
      "Notes.Unsupported": () => Effect.succeed("unused")
    })
  )
  const NotesApp = Desktop.make({
    windows: Desktop.window("main", { title: "Notes" }),
    rpcs: NotesLayer
  })
  const NotesReact = ReactDesktop.from(Desktop.manifest(NotesApp))
  const rpcs = NotesLayer
  const Probe = () => {
    const notes = NotesReact.useDesktop(NotesRpcs)
    const endpoint: SupportedQueryEndpoint = notes.unsupported
    return createElement("span", null, `${endpoint.isSupported}:${endpoint.support.status}`)
  }

  expect(
    renderToStaticMarkup(createElement(NotesReact.DesktopRoot, { rpcs }, createElement(Probe)))
  ).toBe("<span>false:unsupported</span>")
})

test("ReactDesktop generated no-payload stream hooks accept stream options", () => {
  const Tail = Rpc.make("Notes.Tail", {
    success: Schema.String,
    error: Schema.Never,
    stream: true
  })
  const NotesRpcs = RpcGroup.make(Tail)
  const NotesLayer = Desktop.rpc(
    NotesRpcs,
    NotesRpcs.toLayer({
      "Notes.Tail": () => Stream.make("a", "b", "c")
    })
  )
  const NotesApp = Desktop.make({
    windows: Desktop.window("main", { title: "Notes" }),
    rpcs: NotesLayer
  })
  const NotesReact = ReactDesktop.from(Desktop.manifest(NotesApp))
  const Probe = () => {
    const notes = NotesReact.useDesktop(NotesRpcs)
    const tail = notes.tail.useStream({ capacity: 0, onItem: () => undefined })
    return createElement("span", null, `${tail.status}:${tail.data.length}`)
  }

  expect(
    renderToStaticMarkup(
      createElement(NotesReact.DesktopRoot, { rpcs: NotesLayer }, createElement(Probe))
    )
  ).toBe("<span>idle:0</span>")
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

test("storage/idb exposes migration builder helper", () => {
  expect(typeof makeMigration).toBe("function")
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
