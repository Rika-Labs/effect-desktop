import { Context, Effect, Layer, Option, Ref, Schema, Stream } from "effect"

import { HostProtocolNotFoundError } from "@orika/bridge"
import {
  makePermissionRegistry,
  NormalizedCapability,
  PermissionRegistry,
  ResourceRegistry,
  ResourceRegistryLive,
  type DesktopRpcContractLaw,
  type DesktopRpcSchemaDoc,
  type PermissionRegistryApi,
  type ResourceRegistryApi
} from "@orika/core"
import {
  Clipboard,
  ClipboardSurface,
  Dialog,
  DialogSurface,
  Screen,
  ScreenSurface,
  Window,
  Native,
  type ClipboardClient,
  type ClipboardError,
  type ClipboardServiceApi,
  type DialogClient,
  type DialogError,
  type DialogServiceApi,
  type ScreenClient,
  type ScreenError,
  type ScreenServiceApi,
  type WindowError,
  type WindowServiceApi
} from "@orika/native"
import {
  ClipboardImage,
  ScreenDisplay,
  ScreenDisplaysChangedEvent,
  ScreenPoint,
  WindowBounds,
  WindowState,
  type ClipboardCapability,
  type ClipboardImageOptions,
  type DialogConfirmOptions,
  type DialogMessageOptions,
  type DialogOpenDirectoryOptions,
  type DialogOpenFileOptions,
  type DialogSaveFileOptions,
  type ScreenMethod,
  type WindowCreateOptions,
  type WindowHandle
} from "@orika/native/contracts"
// oxlint-disable-next-line import/no-cycle -- test native harness extends the package barrel it is re-exported from.
import { assertNoOpenResources } from "./index.js"

export interface TestClipboardOptions {
  readonly text?: string
  readonly html?: string
  readonly supported?: Partial<Record<ClipboardCapability, boolean>>
}

export interface TestDialogOptions {
  readonly openFilePaths?: readonly string[]
  readonly openDirectoryPaths?: readonly string[]
  readonly saveFilePath?: string | null
  readonly confirmResult?: boolean
}

export interface TestScreenOptions {
  readonly displays?: readonly {
    readonly id?: string
    readonly bounds?: {
      readonly x?: number
      readonly y?: number
      readonly width?: number
      readonly height?: number
    }
    readonly workArea?: {
      readonly x?: number
      readonly y?: number
      readonly width?: number
      readonly height?: number
    }
    readonly scaleFactor?: number
    readonly primary?: boolean
  }[]
}

export interface TestWindowRecord {
  readonly input: WindowCreateOptions
  readonly window: WindowHandle
}

export interface TestWindowStateApi {
  readonly windows: Effect.Effect<readonly TestWindowRecord[], never, never>
}

export class TestWindowState extends Context.Service<TestWindowState, TestWindowStateApi>()(
  "@orika/test/native/TestWindowState"
) {}

export interface TestNativeSurface {
  readonly tag: string
  readonly contractLaws: readonly DesktopRpcContractLaw[]
  readonly schemaDocs: readonly DesktopRpcSchemaDoc[]
}

export const TestNativeSurfaces: readonly TestNativeSurface[] = snapshotTestNativeSurfaces()

export const ClipboardTest = (options: TestClipboardOptions = {}): Layer.Layer<Clipboard> =>
  makeClipboardScenarioLayer(options)

export const DialogTest = (options: TestDialogOptions = {}): Layer.Layer<Dialog> =>
  makeDialogScenarioLayer(options)

export const ScreenTest = (options: TestScreenOptions = {}): Layer.Layer<Screen> =>
  makeScreenScenarioLayer(options)

export const WindowTest = (): Layer.Layer<Window | TestWindowState, never, ResourceRegistry> =>
  makeWindowScenarioLayer()

export const ClipboardClientTest = (
  options: TestClipboardOptions = {}
): Layer.Layer<ClipboardClient> =>
  Layer.provide(ClipboardSurface.testClientLayer, makeClipboardScenarioLayer(options))

export const DialogClientTest = (options: TestDialogOptions = {}): Layer.Layer<DialogClient> =>
  Layer.provide(DialogSurface.testClientLayer, makeDialogScenarioLayer(options))

export const ScreenClientTest = (options: TestScreenOptions = {}): Layer.Layer<ScreenClient> =>
  Layer.provide(ScreenSurface.testClientLayer, makeScreenScenarioLayer(options))

export type TestDesktopServices =
  | Clipboard
  | Dialog
  | PermissionRegistry
  | Screen
  | Window
  | TestWindowState
  | ResourceRegistry

export type TestDesktopPermissions = "allow-all" | "deny-all"

export interface TestDesktopOptions {
  readonly clipboard?: TestClipboardOptions
  readonly dialog?: TestDialogOptions
  readonly permissions?: TestDesktopPermissions
  readonly screen?: TestScreenOptions
}

export const TestDesktopLive = (
  options: TestDesktopOptions = {}
): Layer.Layer<TestDesktopServices> =>
  Layer.mergeAll(
    ClipboardTest(options.clipboard),
    DialogTest(options.dialog),
    TestPermissionRegistry(options.permissions ?? "allow-all"),
    ScreenTest(options.screen),
    WindowTest().pipe(Layer.provideMerge(ResourceRegistryLive))
  )

export const TestDesktop = Object.freeze({
  expectNoLeakedResources: Effect.suspend(() => assertNoOpenResources()),
  layer: TestDesktopLive,
  windows: Effect.gen(function* () {
    const state = yield* TestWindowState
    return yield* state.windows
  })
})

export const TestPermissionRegistry = (
  permissions: TestDesktopPermissions
): Layer.Layer<PermissionRegistry> =>
  Layer.effect(PermissionRegistry, makeTestPermissionRegistry(permissions))

export const makeTestPermissionRegistry = (
  permissions: TestDesktopPermissions
): Effect.Effect<PermissionRegistryApi, never, never> =>
  Effect.gen(function* () {
    const registry = yield* makePermissionRegistry()
    if (permissions === "deny-all") {
      return registry
    }

    const capabilities = yield* nativeInvokeCapabilities()
    yield* Effect.forEach(capabilities, (capability) =>
      registry
        .declare(capability, { effect: "allow", source: "TestDesktop.allow-all" })
        .pipe(Effect.orDie)
    )

    return registry
  })

export const makeClipboardScenarioLayer = (
  options: TestClipboardOptions
): Layer.Layer<Clipboard, never, never> =>
  Layer.succeed(Clipboard)(
    makeClipboardScenario({
      initialHtml: options.html ?? "",
      initialText: options.text ?? "",
      supported: options.supported ?? {}
    })
  )

const makeClipboardScenario = (options: {
  readonly initialHtml: string
  readonly initialText: string
  readonly supported: Partial<Record<ClipboardCapability, boolean>>
}): ClipboardServiceApi => {
  let htmlContent = options.initialHtml
  let textContent = options.initialText
  let imageContent: ClipboardImage | undefined

  return Object.freeze({
    readText: (): Effect.Effect<string, ClipboardError, never> => Effect.sync(() => textContent),
    writeText: (text: string): Effect.Effect<void, ClipboardError, never> =>
      Effect.sync(() => {
        textContent = text
      }),
    readHtml: (): Effect.Effect<string, ClipboardError, never> => Effect.sync(() => htmlContent),
    writeHtml: (html: string): Effect.Effect<void, ClipboardError, never> =>
      Effect.sync(() => {
        htmlContent = html
      }),
    readImage: (): Effect.Effect<ClipboardImage, ClipboardError, never> =>
      Effect.sync(
        () => imageContent ?? new ClipboardImage({ mime: "image/png", bytes: new Uint8Array(0) })
      ),
    writeImage: (input: ClipboardImageOptions): Effect.Effect<void, ClipboardError, never> =>
      Effect.sync(() => {
        imageContent = new ClipboardImage(input)
      }),
    clear: (): Effect.Effect<void, ClipboardError, never> =>
      Effect.sync(() => {
        htmlContent = ""
        textContent = ""
        imageContent = undefined
      }),
    isSupported: (capability: ClipboardCapability): Effect.Effect<boolean, ClipboardError, never> =>
      Effect.sync(() => options.supported[capability] ?? true)
  } satisfies ClipboardServiceApi)
}

export const makeDialogScenarioLayer = (
  options: TestDialogOptions
): Layer.Layer<Dialog, never, never> => Layer.succeed(Dialog)(makeDialogScenario(options))

const makeDialogScenario = (options: TestDialogOptions): DialogServiceApi =>
  Object.freeze({
    openFile: (_input?: DialogOpenFileOptions): Effect.Effect<readonly string[], DialogError> =>
      Effect.succeed([...(options.openFilePaths ?? [])]),
    openDirectory: (
      _input?: DialogOpenDirectoryOptions
    ): Effect.Effect<readonly string[], DialogError> =>
      Effect.succeed([...(options.openDirectoryPaths ?? [])]),
    saveFile: (_input?: DialogSaveFileOptions): Effect.Effect<string | undefined, DialogError> =>
      Effect.succeed(
        options.saveFilePath === null ? undefined : (options.saveFilePath ?? "/tmp/save")
      ),
    message: (_input: DialogMessageOptions): Effect.Effect<void, DialogError> => Effect.void,
    confirm: (_input: DialogConfirmOptions): Effect.Effect<boolean, DialogError> =>
      Effect.succeed(options.confirmResult ?? true)
  } satisfies DialogServiceApi)

const DEFAULT_DISPLAY: ScreenDisplay = new ScreenDisplay({
  id: "display-1",
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1080 },
  scaleFactor: 2,
  primary: true
})

export const makeScreenScenarioLayer = (
  options: TestScreenOptions
): Layer.Layer<Screen, never, never> => Layer.succeed(Screen)(makeScreenScenario(options))

const makeScreenScenario = (options: TestScreenOptions): ScreenServiceApi => {
  const displays = options.displays?.map(
    (display) =>
      new ScreenDisplay({
        id: display.id ?? "display-1",
        bounds: {
          x: display.bounds?.x ?? 0,
          y: display.bounds?.y ?? 0,
          width: display.bounds?.width ?? 1920,
          height: display.bounds?.height ?? 1080
        },
        workArea: {
          x: display.workArea?.x ?? 0,
          y: display.workArea?.y ?? 0,
          width: display.workArea?.width ?? 1920,
          height: display.workArea?.height ?? 1080
        },
        scaleFactor: display.scaleFactor ?? 2,
        primary: display.primary ?? true
      })
  ) ?? [DEFAULT_DISPLAY]
  const primaryDisplay =
    displays.find((display) => display.primary) ?? displays[0] ?? DEFAULT_DISPLAY

  return Object.freeze({
    getDisplays: (): Effect.Effect<readonly ScreenDisplay[], ScreenError> =>
      Effect.succeed(displays),
    getPrimaryDisplay: (): Effect.Effect<ScreenDisplay, ScreenError> =>
      Effect.succeed(primaryDisplay),
    getPointerPoint: (): Effect.Effect<ScreenPoint, ScreenError> =>
      Effect.succeed(new ScreenPoint({ x: 0, y: 0 })),
    onDisplaysChanged: () => Stream.make(new ScreenDisplaysChangedEvent({ displays })),
    isSupported: (_method: ScreenMethod): Effect.Effect<boolean, ScreenError> =>
      Effect.succeed(true)
  } satisfies ScreenServiceApi)
}

export const makeWindowScenarioLayer = (): Layer.Layer<
  Window | TestWindowState,
  never,
  ResourceRegistry
> =>
  Layer.effectContext(
    Effect.gen(function* () {
      const registry = yield* ResourceRegistry
      const windows = yield* Ref.make<ReadonlyMap<string, TestWindowRecord>>(new Map())
      const state: TestWindowStateApi = {
        windows: Ref.get(windows).pipe(Effect.map((records) => [...records.values()]))
      }
      const service = makeWindowScenario(registry, windows)

      return Context.add(Window, service)(Context.make(TestWindowState, state))
    })
  )

const makeWindowScenario = (
  registry: ResourceRegistryApi,
  windows: Ref.Ref<ReadonlyMap<string, TestWindowRecord>>
): WindowServiceApi =>
  Object.freeze({
    create: (input = {}): Effect.Effect<WindowHandle, WindowError, never> =>
      Effect.gen(function* () {
        const handle = yield* registry
          .register({
            kind: "window",
            ownerScope: "test-window",
            state: "open"
          })
          .pipe(Effect.orDie)
        const window: WindowHandle = {
          kind: handle.kind,
          id: handle.id,
          generation: handle.generation,
          ownerScope: handle.ownerScope,
          state: handle.state
        }
        yield* Ref.update(windows, (records) => {
          const next = new Map(records)
          next.set(window.id, { input, window })
          return next
        })

        return window
      }),
    close: (window): Effect.Effect<void, WindowError, never> =>
      Effect.gen(function* () {
        yield* registry.dispose(window.id)
        yield* Ref.update(windows, (records) => {
          const next = new Map(records)
          next.delete(window.id)
          return next
        })
      }),
    destroy: (window): Effect.Effect<void, WindowError, never> =>
      Effect.gen(function* () {
        yield* registry.dispose(window.id)
        yield* Ref.update(windows, (records) => {
          const next = new Map(records)
          next.delete(window.id)
          return next
        })
      }),
    show: (_window): Effect.Effect<void, WindowError, never> => Effect.void,
    hide: (_window): Effect.Effect<void, WindowError, never> => Effect.void,
    focus: (_window): Effect.Effect<void, WindowError, never> => Effect.void,
    getCurrent: (): Effect.Effect<WindowHandle, WindowError, never> =>
      Ref.get(windows).pipe(
        Effect.flatMap((records) => {
          const window = records.values().next().value?.window
          return window === undefined
            ? Effect.fail(notFoundWindow("current", "Window.getCurrent"))
            : Effect.succeed(window)
        })
      ),
    getById: (windowId): Effect.Effect<WindowHandle, WindowError, never> =>
      Ref.get(windows).pipe(
        Effect.flatMap((records) => {
          const window = records.get(windowId)?.window
          return window === undefined
            ? Effect.fail(notFoundWindow(windowId, "Window.getById"))
            : Effect.succeed(window)
        })
      ),
    list: (): Effect.Effect<readonly WindowHandle[], WindowError, never> =>
      Ref.get(windows).pipe(
        Effect.map((records) => [...records.values()].map((record) => record.window))
      ),
    getParent: (window): Effect.Effect<WindowHandle | undefined, WindowError, never> =>
      Ref.get(windows).pipe(
        Effect.flatMap((records) => {
          const record = records.get(window.id)
          if (record === undefined) {
            return Effect.fail(notFoundWindow(window.id, "Window.getParent"))
          }
          return Effect.succeed(record.input.parent)
        })
      ),
    getChildren: (window): Effect.Effect<readonly WindowHandle[], WindowError, never> =>
      Ref.get(windows).pipe(
        Effect.flatMap((records) => {
          if (!records.has(window.id)) {
            return Effect.fail(notFoundWindow(window.id, "Window.getChildren"))
          }
          return Effect.succeed(
            [...records.values()]
              .filter((record) => record.input.parent?.id === window.id)
              .map((record) => record.window)
          )
        })
      ),
    getBounds: (_window): Effect.Effect<WindowBounds, WindowError, never> =>
      Effect.succeed(new WindowBounds({ x: 0, y: 0, width: 640, height: 480 })),
    setBounds: (_window, bounds): Effect.Effect<WindowBounds, WindowError, never> =>
      Effect.succeed(new WindowBounds(bounds)),
    setBoundsOnDisplay: (
      _window,
      _displayId,
      bounds
    ): Effect.Effect<WindowBounds, WindowError, never> => Effect.succeed(new WindowBounds(bounds)),
    center: (_window): Effect.Effect<WindowBounds, WindowError, never> =>
      Effect.succeed(new WindowBounds({ x: 0, y: 0, width: 640, height: 480 })),
    centerOnDisplay: (_window, _displayId): Effect.Effect<WindowBounds, WindowError, never> =>
      Effect.succeed(new WindowBounds({ x: 0, y: 0, width: 640, height: 480 })),
    setTitle: (_window, _title): Effect.Effect<void, WindowError, never> => Effect.void,
    setResizable: (_window, _resizable): Effect.Effect<void, WindowError, never> => Effect.void,
    setDecorations: (_window, _decorations): Effect.Effect<void, WindowError, never> => Effect.void,
    setTrafficLights: (_window, _trafficLights): Effect.Effect<void, WindowError, never> =>
      Effect.void,
    setVibrancy: (_window, _material): Effect.Effect<void, WindowError, never> => Effect.void,
    clearVibrancy: (_window): Effect.Effect<void, WindowError, never> => Effect.void,
    setShadow: (_window, _hasShadow): Effect.Effect<void, WindowError, never> => Effect.void,
    setTitleBarStyle: (_window, _titleBarStyle): Effect.Effect<void, WindowError, never> =>
      Effect.void,
    setTitleBarTransparent: (
      _window,
      _titleBarTransparent
    ): Effect.Effect<void, WindowError, never> => Effect.void,
    setTransparent: (_window, _transparent): Effect.Effect<void, WindowError, never> => Effect.void,
    setAlwaysOnTop: (_window, _alwaysOnTop): Effect.Effect<void, WindowError, never> => Effect.void,
    setSkipTaskbar: (_window, _skipTaskbar): Effect.Effect<void, WindowError, never> => Effect.void,
    setProgress: (_window, _input): Effect.Effect<void, WindowError, never> => Effect.void,
    requestAttention: (_window, _requestType): Effect.Effect<void, WindowError, never> =>
      Effect.void,
    cancelAttention: (_window): Effect.Effect<void, WindowError, never> => Effect.void,
    minimize: (_window): Effect.Effect<WindowState, WindowError, never> =>
      Effect.succeed(defaultWindowState()),
    maximize: (_window): Effect.Effect<WindowState, WindowError, never> =>
      Effect.succeed(defaultWindowState()),
    restore: (_window): Effect.Effect<WindowState, WindowError, never> =>
      Effect.succeed(defaultWindowState()),
    setFullscreen: (_window, _fullscreen): Effect.Effect<WindowState, WindowError, never> =>
      Effect.succeed(defaultWindowState()),
    setSimpleFullscreen: (
      _window,
      _simpleFullscreen
    ): Effect.Effect<WindowState, WindowError, never> => Effect.succeed(defaultWindowState()),
    getState: (_window): Effect.Effect<WindowState, WindowError, never> =>
      Effect.succeed(defaultWindowState()),
    events: () => Stream.empty
  } satisfies WindowServiceApi)

const defaultWindowState = (): WindowState =>
  new WindowState({
    minimized: false,
    maximized: false,
    fullscreen: false,
    simpleFullscreen: false
  })

const notFoundWindow = (windowId: string, operation: string): WindowError =>
  new HostProtocolNotFoundError({
    tag: "NotFound",
    resource: `Window:${windowId}`,
    message: `window not found: ${windowId}`,
    operation,
    recoverable: true
  })

function testNativeSurface(surface: {
  readonly tag: string
  readonly contractLaws: readonly DesktopRpcContractLaw[]
  readonly schemaDocs: readonly DesktopRpcSchemaDoc[]
}): TestNativeSurface {
  return Object.freeze({
    tag: surface.tag,
    contractLaws: surface.contractLaws,
    schemaDocs: surface.schemaDocs
  })
}

function snapshotTestNativeSurfaces(): readonly TestNativeSurface[] {
  return Object.freeze(Native.all.surfaces.map(testNativeSurface))
}

const nativeInvokeCapabilities = (): Effect.Effect<
  readonly (typeof NormalizedCapability.Type)[],
  never,
  never
> =>
  Effect.forEach(
    TestNativeSurfaces.flatMap((surface) => surface.schemaDocs),
    (doc) =>
      Option.isSome(doc.capability)
        ? Schema.decodeUnknownEffect(NormalizedCapability)(doc.capability.value).pipe(Effect.option)
        : Effect.succeed(Option.none()),
    { concurrency: "unbounded" }
  ).pipe(
    Effect.map((capabilities) =>
      capabilities.flatMap((capability) =>
        Option.isSome(capability) && capability.value.kind === "native.invoke"
          ? [capability.value]
          : []
      )
    )
  )
