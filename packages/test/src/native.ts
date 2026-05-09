import {
  ApiResourceHandleShape,
  HostProtocolNotFoundError,
  hostProtocolErrorRecoverableDefault,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { Effect, Layer, Ref, Stream } from "effect"

import {
  App,
  AppInfo,
  AppCommandLine,
  AppSingleInstanceResult,
  Clipboard,
  ClipboardImage,
  ClipboardSupportedResult,
  CrashReporter,
  CrashReporterFlushResult,
  Dialog,
  DialogConfirmResult,
  DialogOpenResult,
  DialogSaveResult,
  Menu,
  MenuCapabilityResult,
  Notification,
  NotificationPermissionResult,
  NotificationSupportedResult,
  PowerMonitor,
  PowerMonitorSupportedResult,
  SafeStorage,
  Screen,
  ScreenDisplay,
  ScreenDisplaysResult,
  ScreenPoint,
  ScreenSupportedResult,
  Shell,
  SystemAppearance,
  SystemAppearanceSupportedResult,
  Tray,
  TraySupportedResult,
  Updater,
  UpdaterCheckResult,
  UpdaterStatusResult,
  Window,
  type AppClientApi,
  type AppError,
  type AppOpenAtLoginOptions,
  type AppProtocolOptions,
  type AppQuitOptions,
  type AppRestartOptions,
  type ClipboardClientApi,
  type ClipboardError,
  type ClipboardImageOptions,
  type CrashReporterBreadcrumb,
  type CrashReporterClientApi,
  type CrashReporterError,
  type CrashReportUploadHandler,
  type CrashReporterStartOptions,
  type DialogClientApi,
  type DialogConfirmOptions,
  type DialogError,
  type DialogMessageOptions,
  type DialogOpenDirectoryOptions,
  type DialogOpenFileOptions,
  type DialogSaveFileOptions,
  type MenuClientApi,
  type MenuCapabilityOptions,
  type MenuClearOptions,
  type MenuError,
  type MenuTemplateOptions,
  type NotificationClientApi,
  type NotificationError,
  type NotificationHandle,
  type NotificationShowOptions,
  type PowerMonitorClientApi,
  type PowerMonitorError,
  type PowerMonitorMethod,
  type SafeStorageClientApi,
  type SafeStorageError,
  type ScreenClientApi,
  type ScreenError,
  type ScreenMethod,
  type ShellClientApi,
  type ShellError,
  type SystemAppearanceClientApi,
  type SystemAppearanceError,
  type SystemAppearanceMethod,
  type TrayClientApi,
  type TrayCreateOptions,
  type TrayError,
  type TrayHandle,
  type UpdaterCheckOptions,
  type UpdaterClientApi,
  type UpdaterDownloadOptions,
  type UpdaterError,
  type UpdaterInstallOptions,
  type WindowClientApi,
  type WindowCreateOptions,
  type WindowError,
  type WindowHandle,
  type WindowPosition,
  type WindowSize,
  makeAppServiceLayer,
  makeClipboardServiceLayer,
  makeCrashReporterMemoryClient,
  makeDialogServiceLayer,
  makeMenuServiceLayer,
  makeNotificationServiceLayer,
  makePowerMonitorServiceLayer,
  makeSafeStorageServiceLayer,
  makeScreenServiceLayer,
  makeShellServiceLayer,
  makeSystemAppearanceServiceLayer,
  makeTrayServiceLayer,
  makeUpdaterServiceLayer,
  makeWindowServiceLayer
} from "@effect-desktop/native"
import type {
  AppBeforeQuitEvent,
  AppOpenFileEvent,
  AppOpenUrlEvent,
  AppSecondInstanceEvent,
  ClipboardText,
  MenuActivatedEvent,
  NotificationActionEvent,
  NotificationClickEvent,
  PowerMonitorResumeEvent,
  PowerMonitorShutdownEvent,
  PowerMonitorSourceChangedEvent,
  PowerMonitorSuspendEvent,
  ShellOpenExternalOptions,
  ShellOpenPathOptions,
  SystemAppearanceAccentColorResult,
  SystemAppearanceBooleanResult,
  SystemAppearanceChangedEvent,
  SystemAppearanceResult,
  TrayActivatedEvent,
  UpdaterPreparingRestartEvent,
  WindowFullScreenChanged,
  WindowScaleChanged,
  WindowScaleFactorOutput
} from "@effect-desktop/native"
import { SecretValue } from "@effect-desktop/native"

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const notFound = (resource: string, operation: string): HostProtocolNotFoundError =>
  new HostProtocolNotFoundError({
    tag: "NotFound",
    resource,
    message: `not found: ${resource}`,
    operation,
    recoverable: hostProtocolErrorRecoverableDefault("NotFound")
  })

// ---------------------------------------------------------------------------
// TestWindow
// ---------------------------------------------------------------------------

export interface TestWindowCall {
  readonly method: string
  readonly args: ReadonlyArray<unknown>
}

export interface TestWindowApi extends WindowClientApi {
  readonly calls: () => readonly TestWindowCall[]
  readonly openHandles: () => ReadonlyMap<string, WindowHandle>
}

export const makeTestWindowClient = (): TestWindowApi => {
  const log: TestWindowCall[] = []
  const handles = new Map<string, WindowHandle>()
  let nextId = 1

  const record = (method: string, args: ReadonlyArray<unknown>): void => {
    log.push({ method, args })
  }

  const makeHandle = (id: string): WindowHandle =>
    new ApiResourceHandleShape({
      kind: "window",
      id,
      generation: 0,
      ownerScope: `window-${id}`,
      state: "open"
    }) as WindowHandle

  const assertHandle = (
    window: WindowHandle,
    operation: string
  ): Effect.Effect<WindowHandle, WindowError, never> => {
    const existing = handles.get(window.id)
    if (existing === undefined) {
      return Effect.fail(notFound(window.id, operation))
    }
    return Effect.succeed(existing)
  }

  return Object.freeze({
    calls: () => log.slice(),
    openHandles: () => new Map(handles),
    create: (input: WindowCreateOptions) =>
      Effect.sync(() => {
        const id = `test-window-${nextId++}`
        record("Window.create", [input])
        const handle = makeHandle(id)
        handles.set(id, handle)
        return handle
      }),
    show: (window: WindowHandle) =>
      assertHandle(window, "Window.show").pipe(
        Effect.tap(() => Effect.sync(() => record("Window.show", [window])))
      ),
    hide: (window: WindowHandle) =>
      assertHandle(window, "Window.hide").pipe(
        Effect.tap(() => Effect.sync(() => record("Window.hide", [window]))),
        Effect.asVoid
      ),
    focus: (window: WindowHandle) =>
      assertHandle(window, "Window.focus").pipe(
        Effect.tap(() => Effect.sync(() => record("Window.focus", [window]))),
        Effect.asVoid
      ),
    close: (window: WindowHandle) =>
      assertHandle(window, "Window.close").pipe(
        Effect.flatMap(() =>
          Effect.sync(() => {
            record("Window.close", [window])
            handles.delete(window.id)
          })
        )
      ),
    setTitle: (window: WindowHandle, title: string) =>
      assertHandle(window, "Window.setTitle").pipe(
        Effect.tap(() => Effect.sync(() => record("Window.setTitle", [window, title]))),
        Effect.asVoid
      ),
    setSize: (window: WindowHandle, size: WindowSize) =>
      assertHandle(window, "Window.setSize").pipe(
        Effect.tap(() => Effect.sync(() => record("Window.setSize", [window, size]))),
        Effect.asVoid
      ),
    setPosition: (window: WindowHandle, position: WindowPosition) =>
      assertHandle(window, "Window.setPosition").pipe(
        Effect.tap(() => Effect.sync(() => record("Window.setPosition", [window, position]))),
        Effect.asVoid
      ),
    setBackgroundColor: (window: WindowHandle, color: string) =>
      assertHandle(window, "Window.setBackgroundColor").pipe(
        Effect.tap(() => Effect.sync(() => record("Window.setBackgroundColor", [window, color]))),
        Effect.asVoid
      ),
    setVibrancy: (window: WindowHandle, material: string) =>
      assertHandle(window, "Window.setVibrancy").pipe(
        Effect.tap(() => Effect.sync(() => record("Window.setVibrancy", [window, material]))),
        Effect.asVoid
      ),
    setHasShadow: (window: WindowHandle, hasShadow: boolean) =>
      assertHandle(window, "Window.setHasShadow").pipe(
        Effect.tap(() => Effect.sync(() => record("Window.setHasShadow", [window, hasShadow]))),
        Effect.asVoid
      ),
    setFullscreen: (window: WindowHandle, fullscreen: boolean) =>
      assertHandle(window, "Window.setFullscreen").pipe(
        Effect.tap(() => Effect.sync(() => record("Window.setFullscreen", [window, fullscreen]))),
        Effect.asVoid
      ),
    enterFullScreen: (window: WindowHandle) =>
      assertHandle(window, "Window.enterFullScreen").pipe(
        Effect.tap(() => Effect.sync(() => record("Window.enterFullScreen", [window]))),
        Effect.asVoid
      ),
    exitFullScreen: (window: WindowHandle) =>
      assertHandle(window, "Window.exitFullScreen").pipe(
        Effect.tap(() => Effect.sync(() => record("Window.exitFullScreen", [window]))),
        Effect.asVoid
      ),
    onFullScreenChanged: (
      _window: WindowHandle
    ): Stream.Stream<WindowFullScreenChanged, WindowError, never> => Stream.empty,
    getScaleFactor: (
      window: WindowHandle
    ): Effect.Effect<WindowScaleFactorOutput, WindowError, never> =>
      assertHandle(window, "Window.getScaleFactor").pipe(
        Effect.tap(() => Effect.sync(() => record("Window.getScaleFactor", [window]))),
        Effect.flatMap(() => Effect.succeed({ scaleFactor: 2 } as WindowScaleFactorOutput))
      ),
    onScaleChanged: (
      _window: WindowHandle
    ): Stream.Stream<WindowScaleChanged, WindowError, never> => Stream.empty,
    persistState: (window: WindowHandle) =>
      assertHandle(window, "Window.persistState").pipe(
        Effect.tap(() => Effect.sync(() => record("Window.persistState", [window]))),
        Effect.asVoid
      )
  } satisfies TestWindowApi)
}

export const TestWindow = Object.freeze({
  layer: (): Layer.Layer<Window> => makeWindowServiceLayer(makeTestWindowClient())
})

// ---------------------------------------------------------------------------
// TestMenu
// ---------------------------------------------------------------------------

export interface TestMenuCall {
  readonly method: string
  readonly args: ReadonlyArray<unknown>
}

export interface TestMenuApi extends MenuClientApi {
  readonly calls: () => readonly TestMenuCall[]
}

export const makeTestMenuClient = (): TestMenuApi => {
  const log: TestMenuCall[] = []

  const record = (method: string, args: ReadonlyArray<unknown>): void => {
    log.push({ method, args })
  }

  return Object.freeze({
    calls: () => log.slice(),
    setApplicationMenu: (template: MenuTemplateOptions) =>
      Effect.sync(() => record("Menu.setApplicationMenu", [template])),
    setWindowMenu: (window: WindowHandle, template: MenuTemplateOptions) =>
      Effect.sync(() => record("Menu.setWindowMenu", [window, template])),
    clear: (input?: MenuClearOptions) => Effect.sync(() => record("Menu.clear", [input])),
    bindCommand: (itemId: string, commandId: string) =>
      Effect.sync(() => record("Menu.bindCommand", [itemId, commandId])),
    capability: (
      input: MenuCapabilityOptions
    ): Effect.Effect<MenuCapabilityResult, MenuError, never> =>
      Effect.sync(() => {
        record("Menu.capability", [input])
        return new MenuCapabilityResult({ supported: true })
      }),
    onActivated: (): Stream.Stream<MenuActivatedEvent, MenuError, never> => Stream.empty
  } satisfies TestMenuApi)
}

export const TestMenu = Object.freeze({
  layer: (): Layer.Layer<Menu> => makeMenuServiceLayer(makeTestMenuClient())
})

// ---------------------------------------------------------------------------
// TestTray
// ---------------------------------------------------------------------------

export interface TestTrayCall {
  readonly method: string
  readonly args: ReadonlyArray<unknown>
}

export interface TestTrayApi extends TrayClientApi {
  readonly calls: () => readonly TestTrayCall[]
}

export const makeTestTrayClient = (): TestTrayApi => {
  const log: TestTrayCall[] = []
  const handles = new Map<string, TrayHandle>()
  let nextId = 1

  const record = (method: string, args: ReadonlyArray<unknown>): void => {
    log.push({ method, args })
  }

  const assertHandle = (
    tray: TrayHandle,
    operation: string
  ): Effect.Effect<TrayHandle, TrayError, never> => {
    const existing = handles.get(tray.id)
    if (existing === undefined) {
      return Effect.fail(notFound(tray.id, operation))
    }
    return Effect.succeed(existing)
  }

  return Object.freeze({
    calls: () => log.slice(),
    create: (input: TrayCreateOptions) =>
      Effect.sync(() => {
        const id = `test-tray-${nextId++}`
        record("Tray.create", [input])
        const handle = new ApiResourceHandleShape({
          kind: "tray",
          id,
          generation: 0,
          ownerScope: "app",
          state: "open"
        }) as TrayHandle
        handles.set(id, handle)
        return handle
      }),
    setIcon: (tray: TrayHandle, icon: string) =>
      assertHandle(tray, "Tray.setIcon").pipe(
        Effect.tap(() => Effect.sync(() => record("Tray.setIcon", [tray, icon]))),
        Effect.asVoid
      ),
    setTooltip: (tray: TrayHandle, tooltip: string) =>
      assertHandle(tray, "Tray.setTooltip").pipe(
        Effect.tap(() => Effect.sync(() => record("Tray.setTooltip", [tray, tooltip]))),
        Effect.asVoid
      ),
    setMenu: (tray: TrayHandle, menu: MenuTemplateOptions) =>
      assertHandle(tray, "Tray.setMenu").pipe(
        Effect.tap(() => Effect.sync(() => record("Tray.setMenu", [tray, menu]))),
        Effect.asVoid
      ),
    destroy: (tray: TrayHandle) =>
      assertHandle(tray, "Tray.destroy").pipe(
        Effect.flatMap(() =>
          Effect.sync(() => {
            record("Tray.destroy", [tray])
            handles.delete(tray.id)
          })
        )
      ),
    onActivated: (): Stream.Stream<TrayActivatedEvent, TrayError, never> => Stream.empty,
    isSupported: (): Effect.Effect<TraySupportedResult, TrayError, never> =>
      Effect.succeed(new TraySupportedResult({ supported: true }))
  } satisfies TestTrayApi)
}

export const TestTray = Object.freeze({
  layer: (): Layer.Layer<Tray> => makeTrayServiceLayer(makeTestTrayClient())
})

// ---------------------------------------------------------------------------
// TestDialog
// ---------------------------------------------------------------------------

export interface TestDialogCall {
  readonly method: string
  readonly args: ReadonlyArray<unknown>
}

export interface TestDialogOptions {
  readonly openFilePaths?: readonly string[]
  readonly openDirectoryPaths?: readonly string[]
  readonly saveFilePath?: string
  readonly confirmResult?: boolean
}

export interface TestDialogApi extends DialogClientApi {
  readonly calls: () => readonly TestDialogCall[]
}

export const makeTestDialogClient = (options: TestDialogOptions = {}): TestDialogApi => {
  const log: TestDialogCall[] = []

  const record = (method: string, args: ReadonlyArray<unknown>): void => {
    log.push({ method, args })
  }

  return Object.freeze({
    calls: () => log.slice(),
    openFile: (
      input?: DialogOpenFileOptions
    ): Effect.Effect<DialogOpenResult, DialogError, never> =>
      Effect.sync(() => {
        record("Dialog.openFile", [input])
        return new DialogOpenResult({ paths: [...(options.openFilePaths ?? [])] })
      }),
    openDirectory: (
      input?: DialogOpenDirectoryOptions
    ): Effect.Effect<DialogOpenResult, DialogError, never> =>
      Effect.sync(() => {
        record("Dialog.openDirectory", [input])
        return new DialogOpenResult({ paths: [...(options.openDirectoryPaths ?? [])] })
      }),
    saveFile: (
      input?: DialogSaveFileOptions
    ): Effect.Effect<DialogSaveResult, DialogError, never> =>
      Effect.sync(() => {
        record("Dialog.saveFile", [input])
        return new DialogSaveResult({ path: options.saveFilePath ?? "/tmp/save" })
      }),
    message: (input: DialogMessageOptions): Effect.Effect<void, DialogError, never> =>
      Effect.sync(() => record("Dialog.message", [input])),
    confirm: (
      input: DialogConfirmOptions
    ): Effect.Effect<DialogConfirmResult, DialogError, never> =>
      Effect.sync(() => {
        record("Dialog.confirm", [input])
        return new DialogConfirmResult({ confirmed: options.confirmResult ?? true })
      })
  } satisfies TestDialogApi)
}

export const TestDialog = Object.freeze({
  layer: (options?: TestDialogOptions): Layer.Layer<Dialog> =>
    makeDialogServiceLayer(makeTestDialogClient(options))
})

// ---------------------------------------------------------------------------
// TestClipboard
// ---------------------------------------------------------------------------

export interface TestClipboardCall {
  readonly method: string
  readonly args: ReadonlyArray<unknown>
}

export interface TestClipboardApi extends ClipboardClientApi {
  readonly calls: () => readonly TestClipboardCall[]
  readonly text: () => string
}

export const makeTestClipboardClient = (): TestClipboardApi => {
  const log: TestClipboardCall[] = []
  let textContent = ""
  let imageContent: ClipboardImage | undefined

  const record = (method: string, args: ReadonlyArray<unknown>): void => {
    log.push({ method, args })
  }

  return Object.freeze({
    calls: () => log.slice(),
    text: () => textContent,
    readText: (): Effect.Effect<ClipboardText, ClipboardError, never> =>
      Effect.sync(() => {
        record("Clipboard.readText", [])
        return { text: textContent } as ClipboardText
      }),
    writeText: (text: string): Effect.Effect<void, ClipboardError, never> =>
      Effect.sync(() => {
        record("Clipboard.writeText", [text])
        textContent = text
      }),
    readImage: (): Effect.Effect<ClipboardImage, ClipboardError, never> =>
      Effect.sync(() => {
        record("Clipboard.readImage", [])
        return imageContent ?? ({ mime: "image/png", bytes: new Uint8Array(0) } as ClipboardImage)
      }),
    writeImage: (input: ClipboardImageOptions): Effect.Effect<void, ClipboardError, never> =>
      Effect.sync(() => {
        record("Clipboard.writeImage", [input])
        imageContent = input as ClipboardImage
      }),
    clear: (): Effect.Effect<void, ClipboardError, never> =>
      Effect.sync(() => {
        record("Clipboard.clear", [])
        textContent = ""
        imageContent = undefined
      }),
    isSupported: (): Effect.Effect<ClipboardSupportedResult, ClipboardError, never> =>
      Effect.sync(() => {
        record("Clipboard.isSupported", [])
        return new ClipboardSupportedResult({ supported: true })
      })
  } satisfies TestClipboardApi)
}

export const TestClipboard = Object.freeze({
  layer: (): Layer.Layer<Clipboard> => makeClipboardServiceLayer(makeTestClipboardClient())
})

// ---------------------------------------------------------------------------
// TestNotification
// ---------------------------------------------------------------------------

export interface TestNotificationCall {
  readonly method: string
  readonly args: ReadonlyArray<unknown>
}

export interface TestNotificationApi extends NotificationClientApi {
  readonly calls: () => readonly TestNotificationCall[]
  readonly shown: () => readonly NotificationHandle[]
}

export const makeTestNotificationClient = (): TestNotificationApi => {
  const log: TestNotificationCall[] = []
  const shown: NotificationHandle[] = []
  let nextId = 1

  const record = (method: string, args: ReadonlyArray<unknown>): void => {
    log.push({ method, args })
  }

  return Object.freeze({
    calls: () => log.slice(),
    shown: () => shown.slice(),
    show: (
      input: NotificationShowOptions
    ): Effect.Effect<NotificationHandle, NotificationError, never> =>
      Effect.sync(() => {
        record("Notification.show", [input])
        const handle = new ApiResourceHandleShape({
          kind: "notification",
          id: `test-notification-${nextId++}`,
          generation: 0,
          ownerScope: "app",
          state: "open"
        }) as NotificationHandle
        shown.push(handle)
        return handle
      }),
    close: (notification: NotificationHandle): Effect.Effect<void, NotificationError, never> =>
      Effect.sync(() => record("Notification.close", [notification])),
    isSupported: (): Effect.Effect<NotificationSupportedResult, NotificationError, never> =>
      Effect.succeed(new NotificationSupportedResult({ supported: true })),
    requestPermission: (): Effect.Effect<NotificationPermissionResult, NotificationError, never> =>
      Effect.succeed(new NotificationPermissionResult({ state: "granted" })),
    getPermissionStatus: (): Effect.Effect<
      NotificationPermissionResult,
      NotificationError,
      never
    > => Effect.succeed(new NotificationPermissionResult({ state: "granted" })),
    onClick: (): Stream.Stream<NotificationClickEvent, NotificationError, never> => Stream.empty,
    onAction: (): Stream.Stream<NotificationActionEvent, NotificationError, never> => Stream.empty
  } satisfies TestNotificationApi)
}

export const TestNotification = Object.freeze({
  layer: (): Layer.Layer<Notification> => makeNotificationServiceLayer(makeTestNotificationClient())
})

// ---------------------------------------------------------------------------
// TestSafeStorage
// ---------------------------------------------------------------------------

export interface TestSafeStorageCall {
  readonly method: string
  readonly args: ReadonlyArray<unknown>
}

export interface TestSafeStorageApi extends SafeStorageClientApi {
  readonly calls: () => readonly TestSafeStorageCall[]
  readonly snapshot: () => ReadonlyMap<string, Uint8Array>
}

export const makeTestSafeStorageClient = (): TestSafeStorageApi => {
  const log: TestSafeStorageCall[] = []
  const store = new Map<string, Uint8Array>()

  const record = (method: string, args: ReadonlyArray<unknown>): void => {
    log.push({ method, args })
  }

  return Object.freeze({
    calls: () => log.slice(),
    snapshot: () => new Map([...store.entries()].map(([k, v]) => [k, new Uint8Array(v)])),
    set: (key: string, value: SecretValue): Effect.Effect<void, SafeStorageError, never> =>
      Effect.sync(() => {
        record("SafeStorage.set", [key])
        store.set(key, value.unsafeBytes())
      }),
    get: (key: string): Effect.Effect<SecretValue, SafeStorageError, never> =>
      Effect.gen(function* () {
        record("SafeStorage.get", [key])
        const value = store.get(key)
        if (value === undefined) {
          return yield* Effect.fail(notFound(key, "SafeStorage.get") as HostProtocolError)
        }
        return SecretValue.fromBytes(value)
      }),
    delete: (key: string): Effect.Effect<void, SafeStorageError, never> =>
      Effect.sync(() => {
        record("SafeStorage.delete", [key])
        store.delete(key)
      }),
    list: (): Effect.Effect<ReadonlyArray<string>, SafeStorageError, never> =>
      Effect.sync(() => {
        record("SafeStorage.list", [])
        return [...store.keys()].sort()
      }),
    isAvailable: (): Effect.Effect<boolean, SafeStorageError, never> =>
      Effect.sync(() => {
        record("SafeStorage.isAvailable", [])
        return true
      })
  } satisfies TestSafeStorageApi)
}

export const TestSafeStorage = Object.freeze({
  layer: (): Layer.Layer<SafeStorage> => makeSafeStorageServiceLayer(makeTestSafeStorageClient())
})

// ---------------------------------------------------------------------------
// TestCrashReporter
// ---------------------------------------------------------------------------

export interface TestCrashReporterCall {
  readonly method: string
  readonly args: ReadonlyArray<unknown>
}

export interface TestCrashReporterApi extends CrashReporterClientApi {
  readonly calls: () => readonly TestCrashReporterCall[]
  readonly breadcrumbs: () => ReadonlyArray<CrashReporterBreadcrumb>
}

export const makeTestCrashReporterClient = (): Effect.Effect<TestCrashReporterApi, never, never> =>
  Effect.gen(function* () {
    const log: TestCrashReporterCall[] = []
    const inner = yield* makeCrashReporterMemoryClient()

    const record = (method: string, args: ReadonlyArray<unknown>): void => {
      log.push({ method, args })
    }

    const breadcrumbsRef = yield* Ref.make<CrashReporterBreadcrumb[]>([])

    return Object.freeze({
      calls: () => log.slice(),
      breadcrumbs: () => {
        let result: CrashReporterBreadcrumb[] = []
        Effect.runSync(
          Ref.get(breadcrumbsRef).pipe(Effect.tap((b) => Effect.sync(() => (result = b))))
        )
        return result
      },
      start: (
        options?: CrashReporterStartOptions
      ): Effect.Effect<void, CrashReporterError, never> =>
        inner
          .start(options)
          .pipe(Effect.tap(() => Effect.sync(() => record("CrashReporter.start", [options])))),
      recordBreadcrumb: (
        breadcrumb: CrashReporterBreadcrumb
      ): Effect.Effect<void, CrashReporterError, never> =>
        inner
          .recordBreadcrumb(breadcrumb)
          .pipe(
            Effect.tap(() =>
              Ref.update(breadcrumbsRef, (b) => [...b, breadcrumb]).pipe(
                Effect.tap(() =>
                  Effect.sync(() => record("CrashReporter.recordBreadcrumb", [breadcrumb]))
                )
              )
            )
          ),
      flush: (): Effect.Effect<CrashReporterFlushResult, CrashReporterError, never> =>
        inner
          .flush()
          .pipe(Effect.tap((result) => Effect.sync(() => record("CrashReporter.flush", [result])))),
      setUploadHandler: (
        handler: CrashReportUploadHandler
      ): Effect.Effect<void, CrashReporterError, never> =>
        inner
          .setUploadHandler(handler)
          .pipe(Effect.tap(() => Effect.sync(() => record("CrashReporter.setUploadHandler", []))))
    } satisfies TestCrashReporterApi)
  })

export const TestCrashReporter = Object.freeze({
  layer: (): Layer.Layer<CrashReporter> =>
    Layer.effect(CrashReporter)(
      Effect.gen(function* () {
        const client = yield* makeTestCrashReporterClient()
        return Object.freeze({
          start: (options?: CrashReporterStartOptions) => client.start(options),
          recordBreadcrumb: (breadcrumb: CrashReporterBreadcrumb) =>
            client.recordBreadcrumb(breadcrumb),
          flush: () => client.flush(),
          setUploadHandler: (handler: CrashReportUploadHandler) => client.setUploadHandler(handler)
        })
      })
    )
})

// ---------------------------------------------------------------------------
// TestUpdater
// ---------------------------------------------------------------------------

export interface TestUpdaterCall {
  readonly method: string
  readonly args: ReadonlyArray<unknown>
}

export interface TestUpdaterOptions {
  readonly available?: boolean
  readonly version?: string
}

export interface TestUpdaterApi extends UpdaterClientApi {
  readonly calls: () => readonly TestUpdaterCall[]
}

export const makeTestUpdaterClient = (options: TestUpdaterOptions = {}): TestUpdaterApi => {
  const log: TestUpdaterCall[] = []

  const record = (method: string, args: ReadonlyArray<unknown>): void => {
    log.push({ method, args })
  }

  return Object.freeze({
    calls: () => log.slice(),
    check: (input?: UpdaterCheckOptions): Effect.Effect<UpdaterCheckResult, UpdaterError, never> =>
      Effect.sync(() => {
        record("Updater.check", [input])
        return new UpdaterCheckResult({
          available: options.available ?? false,
          ...(options.version !== undefined ? { version: options.version } : {})
        })
      }),
    download: (
      input?: UpdaterDownloadOptions
    ): Effect.Effect<UpdaterStatusResult, UpdaterError, never> =>
      Effect.sync(() => {
        record("Updater.download", [input])
        return new UpdaterStatusResult({ state: "downloaded" })
      }),
    install: (
      input?: UpdaterInstallOptions
    ): Effect.Effect<UpdaterStatusResult, UpdaterError, never> =>
      Effect.sync(() => {
        record("Updater.install", [input])
        return new UpdaterStatusResult({ state: "installing" })
      }),
    installAndRestart: (
      input?: UpdaterInstallOptions
    ): Effect.Effect<UpdaterStatusResult, UpdaterError, never> =>
      Effect.sync(() => {
        record("Updater.installAndRestart", [input])
        return new UpdaterStatusResult({ state: "installing" })
      }),
    getStatus: (): Effect.Effect<UpdaterStatusResult, UpdaterError, never> =>
      Effect.sync(() => {
        record("Updater.getStatus", [])
        return new UpdaterStatusResult({ state: "idle" })
      }),
    readyForRestart: (): Effect.Effect<void, UpdaterError, never> =>
      Effect.sync(() => record("Updater.readyForRestart", [])),
    onPreparingRestart: (): Stream.Stream<UpdaterPreparingRestartEvent, UpdaterError, never> =>
      Stream.empty
  } satisfies TestUpdaterApi)
}

export const TestUpdater = Object.freeze({
  layer: (options?: TestUpdaterOptions): Layer.Layer<Updater> =>
    makeUpdaterServiceLayer(makeTestUpdaterClient(options))
})

// ---------------------------------------------------------------------------
// TestSystemAppearance
// ---------------------------------------------------------------------------

export interface TestSystemAppearanceCall {
  readonly method: string
  readonly args: ReadonlyArray<unknown>
}

export interface TestSystemAppearanceOptions {
  readonly appearance?: "light" | "dark" | "highContrast"
  readonly accentColor?: { r: number; g: number; b: number; a: number } | null
  readonly reducedMotion?: boolean
  readonly reducedTransparency?: boolean
}

export interface TestSystemAppearanceApi extends SystemAppearanceClientApi {
  readonly calls: () => readonly TestSystemAppearanceCall[]
}

export const makeTestSystemAppearanceClient = (
  options: TestSystemAppearanceOptions = {}
): TestSystemAppearanceApi => {
  const log: TestSystemAppearanceCall[] = []

  const record = (method: string, args: ReadonlyArray<unknown>): void => {
    log.push({ method, args })
  }

  return Object.freeze({
    calls: () => log.slice(),
    getAppearance: (): Effect.Effect<SystemAppearanceResult, SystemAppearanceError, never> =>
      Effect.sync(() => {
        record("SystemAppearance.getAppearance", [])
        return { appearance: options.appearance ?? "light" } as SystemAppearanceResult
      }),
    getAccentColor: (): Effect.Effect<
      SystemAppearanceAccentColorResult,
      SystemAppearanceError,
      never
    > =>
      Effect.sync(() => {
        record("SystemAppearance.getAccentColor", [])
        return {
          color: options.accentColor ?? null
        } as SystemAppearanceAccentColorResult
      }),
    getReducedMotion: (): Effect.Effect<
      SystemAppearanceBooleanResult,
      SystemAppearanceError,
      never
    > =>
      Effect.sync(() => {
        record("SystemAppearance.getReducedMotion", [])
        return { enabled: options.reducedMotion ?? false } as SystemAppearanceBooleanResult
      }),
    getReducedTransparency: (): Effect.Effect<
      SystemAppearanceBooleanResult,
      SystemAppearanceError,
      never
    > =>
      Effect.sync(() => {
        record("SystemAppearance.getReducedTransparency", [])
        return {
          enabled: options.reducedTransparency ?? false
        } as SystemAppearanceBooleanResult
      }),
    onAppearanceChanged: (): Stream.Stream<
      SystemAppearanceChangedEvent,
      SystemAppearanceError,
      never
    > => Stream.empty,
    isSupported: (
      _method: SystemAppearanceMethod
    ): Effect.Effect<SystemAppearanceSupportedResult, SystemAppearanceError, never> =>
      Effect.sync(() => {
        record("SystemAppearance.isSupported", [_method])
        return new SystemAppearanceSupportedResult({ supported: true })
      })
  } satisfies TestSystemAppearanceApi)
}

export const TestSystemAppearance = Object.freeze({
  layer: (options?: TestSystemAppearanceOptions): Layer.Layer<SystemAppearance> =>
    makeSystemAppearanceServiceLayer(makeTestSystemAppearanceClient(options))
})

// ---------------------------------------------------------------------------
// TestPowerMonitor
// ---------------------------------------------------------------------------

export interface TestPowerMonitorCall {
  readonly method: string
  readonly args: ReadonlyArray<unknown>
}

export interface TestPowerMonitorApi extends PowerMonitorClientApi {
  readonly calls: () => readonly TestPowerMonitorCall[]
}

export const makeTestPowerMonitorClient = (): TestPowerMonitorApi => {
  const log: TestPowerMonitorCall[] = []

  const record = (method: string, args: ReadonlyArray<unknown>): void => {
    log.push({ method, args })
  }

  return Object.freeze({
    calls: () => log.slice(),
    onSuspend: (): Stream.Stream<PowerMonitorSuspendEvent, PowerMonitorError, never> =>
      Stream.empty,
    onResume: (): Stream.Stream<PowerMonitorResumeEvent, PowerMonitorError, never> => Stream.empty,
    onShutdown: (): Stream.Stream<PowerMonitorShutdownEvent, PowerMonitorError, never> =>
      Stream.empty,
    onPowerSourceChanged: (): Stream.Stream<
      PowerMonitorSourceChangedEvent,
      PowerMonitorError,
      never
    > => Stream.empty,
    isSupported: (
      method: PowerMonitorMethod
    ): Effect.Effect<PowerMonitorSupportedResult, PowerMonitorError, never> =>
      Effect.sync(() => {
        record("PowerMonitor.isSupported", [method])
        return new PowerMonitorSupportedResult({ supported: true })
      })
  } satisfies TestPowerMonitorApi)
}

export const TestPowerMonitor = Object.freeze({
  layer: (): Layer.Layer<PowerMonitor> => makePowerMonitorServiceLayer(makeTestPowerMonitorClient())
})

// ---------------------------------------------------------------------------
// TestScreen
// ---------------------------------------------------------------------------

export interface TestScreenCall {
  readonly method: string
  readonly args: ReadonlyArray<unknown>
}

export interface TestScreenOptions {
  readonly displays?: readonly {
    id?: string
    bounds?: { x?: number; y?: number; width?: number; height?: number }
    workArea?: { x?: number; y?: number; width?: number; height?: number }
    scaleFactor?: number
    primary?: boolean
  }[]
}

export interface TestScreenApi extends ScreenClientApi {
  readonly calls: () => readonly TestScreenCall[]
}

const DEFAULT_DISPLAY: ScreenDisplay = new ScreenDisplay({
  id: "display-1",
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1080 },
  scaleFactor: 2,
  primary: true
})

export const makeTestScreenClient = (_options: TestScreenOptions = {}): TestScreenApi => {
  const log: TestScreenCall[] = []

  const record = (method: string, args: ReadonlyArray<unknown>): void => {
    log.push({ method, args })
  }

  return Object.freeze({
    calls: () => log.slice(),
    getDisplays: (): Effect.Effect<ScreenDisplaysResult, ScreenError, never> =>
      Effect.sync(() => {
        record("Screen.getDisplays", [])
        return new ScreenDisplaysResult({ displays: [DEFAULT_DISPLAY] })
      }),
    getPrimaryDisplay: (): Effect.Effect<ScreenDisplay, ScreenError, never> =>
      Effect.sync(() => {
        record("Screen.getPrimaryDisplay", [])
        return DEFAULT_DISPLAY
      }),
    getPointerPoint: (): Effect.Effect<ScreenPoint, ScreenError, never> =>
      Effect.sync(() => {
        record("Screen.getPointerPoint", [])
        return new ScreenPoint({ x: 0, y: 0 })
      }),
    isSupported: (method: ScreenMethod): Effect.Effect<ScreenSupportedResult, ScreenError, never> =>
      Effect.sync(() => {
        record("Screen.isSupported", [method])
        return new ScreenSupportedResult({ supported: true })
      })
  } satisfies TestScreenApi)
}

export const TestScreen = Object.freeze({
  layer: (options?: TestScreenOptions): Layer.Layer<Screen> =>
    makeScreenServiceLayer(makeTestScreenClient(options))
})

// ---------------------------------------------------------------------------
// TestShell
// ---------------------------------------------------------------------------

export interface TestShellCall {
  readonly method: string
  readonly args: ReadonlyArray<unknown>
}

export interface TestShellApi extends ShellClientApi {
  readonly calls: () => readonly TestShellCall[]
}

export const makeTestShellClient = (): TestShellApi => {
  const log: TestShellCall[] = []

  const record = (method: string, args: ReadonlyArray<unknown>): void => {
    log.push({ method, args })
  }

  return Object.freeze({
    calls: () => log.slice(),
    openExternal: (
      url: string,
      options?: Omit<ShellOpenExternalOptions, "url">
    ): Effect.Effect<void, ShellError, never> =>
      Effect.sync(() => record("Shell.openExternal", [url, options])),
    showItemInFolder: (path: string): Effect.Effect<void, ShellError, never> =>
      Effect.sync(() => record("Shell.showItemInFolder", [path])),
    openPath: (
      path: string,
      options?: Omit<ShellOpenPathOptions, "path">
    ): Effect.Effect<void, ShellError, never> =>
      Effect.sync(() => record("Shell.openPath", [path, options])),
    trashItem: (path: string): Effect.Effect<void, ShellError, never> =>
      Effect.sync(() => record("Shell.trashItem", [path]))
  } satisfies TestShellApi)
}

export const TestShell = Object.freeze({
  layer: (): Layer.Layer<Shell> => makeShellServiceLayer(makeTestShellClient())
})

// ---------------------------------------------------------------------------
// TestApp
// ---------------------------------------------------------------------------

export interface TestAppCall {
  readonly method: string
  readonly args: ReadonlyArray<unknown>
}

export interface TestAppOptions {
  readonly id?: string
  readonly name?: string
  readonly version?: string
}

export interface TestAppApi extends AppClientApi {
  readonly calls: () => readonly TestAppCall[]
}

export const makeTestAppClient = (options: TestAppOptions = {}): TestAppApi => {
  const log: TestAppCall[] = []

  const record = (method: string, args: ReadonlyArray<unknown>): void => {
    log.push({ method, args })
  }

  return Object.freeze({
    calls: () => log.slice(),
    getInfo: (): Effect.Effect<AppInfo, AppError, never> =>
      Effect.sync(() => {
        record("App.getInfo", [])
        return new AppInfo({
          id: options.id ?? "com.test.app",
          name: options.name ?? "Test App",
          version: options.version ?? "0.0.0-test"
        })
      }),
    getCommandLine: (): Effect.Effect<AppCommandLine, AppError, never> =>
      Effect.sync(() => {
        record("App.getCommandLine", [])
        return new AppCommandLine({ argv: ["test"], cwd: "/tmp" })
      }),
    quit: (input: AppQuitOptions): Effect.Effect<void, AppError, never> =>
      Effect.sync(() => record("App.quit", [input])),
    restart: (input: AppRestartOptions): Effect.Effect<void, AppError, never> =>
      Effect.sync(() => record("App.restart", [input])),
    focus: (): Effect.Effect<void, AppError, never> => Effect.sync(() => record("App.focus", [])),
    requestSingleInstanceLock: (): Effect.Effect<AppSingleInstanceResult, AppError, never> =>
      Effect.sync(() => {
        record("App.requestSingleInstanceLock", [])
        return new AppSingleInstanceResult({ acquired: true })
      }),
    setOpenAtLogin: (input: AppOpenAtLoginOptions): Effect.Effect<void, AppError, never> =>
      Effect.sync(() => record("App.setOpenAtLogin", [input])),
    registerProtocol: (input: AppProtocolOptions): Effect.Effect<void, AppError, never> =>
      Effect.sync(() => record("App.registerProtocol", [input])),
    onSecondInstance: (): Stream.Stream<AppSecondInstanceEvent, AppError, never> => Stream.empty,
    onOpenFile: (): Stream.Stream<AppOpenFileEvent, AppError, never> => Stream.empty,
    onOpenUrl: (): Stream.Stream<AppOpenUrlEvent, AppError, never> => Stream.empty,
    onBeforeQuit: (): Stream.Stream<AppBeforeQuitEvent, AppError, never> => Stream.empty
  } satisfies TestAppApi)
}

export const TestApp = Object.freeze({
  layer: (options?: TestAppOptions): Layer.Layer<App> =>
    makeAppServiceLayer(makeTestAppClient(options))
})

// ---------------------------------------------------------------------------
// TestDesktop — composed layer for all desktop services
// ---------------------------------------------------------------------------

export type TestDesktopServices =
  | App
  | Clipboard
  | CrashReporter
  | Dialog
  | Menu
  | Notification
  | PowerMonitor
  | SafeStorage
  | Screen
  | Shell
  | SystemAppearance
  | Tray
  | Updater
  | Window

export interface TestDesktopOptions {
  readonly app?: TestAppOptions
  readonly dialog?: TestDialogOptions
  readonly screen?: TestScreenOptions
  readonly systemAppearance?: TestSystemAppearanceOptions
  readonly updater?: TestUpdaterOptions
}

export const TestDesktopLive = (
  options: TestDesktopOptions = {}
): Layer.Layer<TestDesktopServices> =>
  Layer.mergeAll(
    TestApp.layer(options.app),
    TestClipboard.layer(),
    TestCrashReporter.layer(),
    TestDialog.layer(options.dialog),
    TestMenu.layer(),
    TestNotification.layer(),
    TestPowerMonitor.layer(),
    TestSafeStorage.layer(),
    TestScreen.layer(options.screen),
    TestShell.layer(),
    TestSystemAppearance.layer(options.systemAppearance),
    TestTray.layer(),
    TestUpdater.layer(options.updater),
    TestWindow.layer()
  )

export const TestDesktop = Object.freeze({
  layer: TestDesktopLive
})

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

export const expectWindowCall = (client: TestWindowApi, method: string, count?: number): void => {
  const matching = client.calls().filter((call) => call.method === method)
  const expected = count ?? 1
  if (matching.length !== expected) {
    throw new Error(
      `Expected ${expected} call(s) to ${method}, got ${matching.length}. Calls: ${JSON.stringify(client.calls())}`
    )
  }
}

export const expectMenuCall = (client: TestMenuApi, method: string, count?: number): void => {
  const matching = client.calls().filter((call) => call.method === method)
  const expected = count ?? 1
  if (matching.length !== expected) {
    throw new Error(
      `Expected ${expected} call(s) to ${method}, got ${matching.length}. Calls: ${JSON.stringify(client.calls())}`
    )
  }
}

export const expectShellCall = (client: TestShellApi, method: string, count?: number): void => {
  const matching = client.calls().filter((call) => call.method === method)
  const expected = count ?? 1
  if (matching.length !== expected) {
    throw new Error(
      `Expected ${expected} call(s) to ${method}, got ${matching.length}. Calls: ${JSON.stringify(client.calls())}`
    )
  }
}

export const expectClipboardText = (client: TestClipboardApi, expected: string): void => {
  const actual = client.text()
  if (actual !== expected) {
    throw new Error(`Expected clipboard text "${expected}", got "${actual}"`)
  }
}

export const expectNotificationShown = (client: TestNotificationApi, count?: number): void => {
  const actual = client.shown().length
  const expected = count ?? 1
  if (actual !== expected) {
    throw new Error(`Expected ${expected} notification(s) shown, got ${actual}`)
  }
}

export const expectCrashBreadcrumb = (client: TestCrashReporterApi, count?: number): void => {
  const actual = client.breadcrumbs().length
  const expected = count ?? 1
  if (actual !== expected) {
    throw new Error(`Expected ${expected} crash breadcrumb(s), got ${actual}`)
  }
}

export const expectSafeStorageKey = (client: TestSafeStorageApi, key: string): void => {
  const snapshot = client.snapshot()
  if (!snapshot.has(key)) {
    throw new Error(
      `Expected SafeStorage key "${key}" to exist. Keys: ${JSON.stringify([...snapshot.keys()])}`
    )
  }
}

export const expectUpdaterCall = (client: TestUpdaterApi, method: string, count?: number): void => {
  const matching = client.calls().filter((call) => call.method === method)
  const expected = count ?? 1
  if (matching.length !== expected) {
    throw new Error(
      `Expected ${expected} call(s) to ${method}, got ${matching.length}. Calls: ${JSON.stringify(client.calls())}`
    )
  }
}

export const expectAppearance = (
  client: TestSystemAppearanceApi,
  method: string,
  count?: number
): void => {
  const matching = client.calls().filter((call) => call.method === method)
  const expected = count ?? 1
  if (matching.length !== expected) {
    throw new Error(
      `Expected ${expected} call(s) to ${method}, got ${matching.length}. Calls: ${JSON.stringify(client.calls())}`
    )
  }
}
