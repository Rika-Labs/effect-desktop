import {
  HostProtocolNotFoundError,
  hostProtocolErrorRecoverableDefault
} from "@effect-desktop/bridge"
import { Effect, Layer, Stream } from "effect"

import {
  App,
  Clipboard,
  CrashReporter,
  Dialog,
  Menu,
  Notification,
  PowerMonitor,
  SafeStorage,
  Screen,
  Shell,
  SystemAppearance,
  Tray,
  Updater,
  Window,
  type AppClientApi,
  type AppError,
  type ClipboardClientApi,
  type ClipboardError,
  type CrashReporterBreadcrumb,
  type CrashReporterClientApi,
  type CrashReporterError,
  type CrashReportUploadHandler,
  type CrashReporterStartOptions,
  type DialogClientApi,
  type DialogError,
  type MenuClientApi,
  type MenuCapabilityOptions,
  type MenuError,
  type NotificationClientApi,
  type NotificationError,
  type PowerMonitorClientApi,
  type PowerMonitorError,
  type SafeStorageClientApi,
  type SafeStorageError,
  type ScreenClientApi,
  type ScreenError,
  type ShellClientApi,
  type ShellError,
  type SystemAppearanceClientApi,
  type SystemAppearanceError,
  type TrayClientApi,
  type TrayError,
  type UpdaterCheckOptions,
  type UpdaterClientApi,
  type UpdaterDownloadOptions,
  type UpdaterError,
  type UpdaterInstallOptions,
  type WindowClientApi,
  type WindowError,
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
import {
  AppCommandLine,
  AppInfo,
  AppSingleInstanceResult,
  ClipboardImage,
  ClipboardSupportedResult,
  CrashReporterFlushResult,
  DialogConfirmResult,
  DialogOpenResult,
  DialogSaveResult,
  MenuCapabilityResult,
  NotificationPermissionResult,
  NotificationSupportedResult,
  PowerMonitorSupportedResult,
  ScreenDisplay,
  ScreenDisplaysResult,
  ScreenPoint,
  ScreenSupportedResult,
  SystemAppearanceSupportedResult,
  TraySupportedResult,
  type AppOpenAtLoginOptions,
  type AppProtocolOptions,
  AppBeforeQuitEvent,
  AppOpenFileEvent,
  AppOpenUrlEvent,
  AppSecondInstanceEvent,
  type AppQuitOptions,
  type AppRestartOptions,
  type ClipboardImageOptions,
  ClipboardText,
  type DialogConfirmOptions,
  type DialogMessageOptions,
  type DialogOpenDirectoryOptions,
  type DialogOpenFileOptions,
  type DialogSaveFileOptions,
  MenuActivatedEvent,
  type MenuClearOptions,
  type MenuTemplateOptions,
  NotificationActionEvent,
  NotificationClickEvent,
  type NotificationHandle,
  type NotificationShowOptions,
  type PowerMonitorMethod,
  PowerMonitorResumeEvent,
  PowerMonitorShutdownEvent,
  PowerMonitorSourceChangedEvent,
  PowerMonitorSuspendEvent,
  type ScreenMethod,
  type ShellOpenExternalOptions,
  type ShellOpenPathOptions,
  SystemAppearanceAccentColorResult,
  SystemAppearanceBooleanResult,
  SystemAppearanceChangedEvent,
  type SystemAppearanceMethod,
  SystemAppearanceResult,
  TrayActivatedEvent,
  type TrayCreateOptions,
  type TrayHandle,
  type UpdaterCheckResult,
  UpdaterPreparingRestartEvent,
  type UpdaterStatusResult,
  type WindowCreateOptions,
  type WindowHandle
} from "@effect-desktop/native/contracts"
import { makeSecretBytes, type SecretBytes, unsafeSecretBytes } from "@effect-desktop/native"

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

export interface TestWindowRpcs extends WindowClientApi {
  readonly calls: () => readonly TestWindowCall[]
  readonly openHandles: () => ReadonlyMap<string, WindowHandle>
}

export const makeTestWindowClient = (): TestWindowRpcs => {
  const log: TestWindowCall[] = []
  const handles = new Map<string, WindowHandle>()
  let nextId = 1

  const record = (method: string, args: ReadonlyArray<unknown>): void => {
    log.push({ method, args })
  }

  const makeHandle = (id: string): WindowHandle =>
    Object.freeze({
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
    close: (window: WindowHandle) =>
      assertHandle(window, "Window.close").pipe(
        Effect.flatMap(() =>
          Effect.sync(() => {
            record("Window.close", [window])
            handles.delete(window.id)
          })
        )
      )
  } satisfies TestWindowRpcs)
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

export interface TestMenuRpcs extends MenuClientApi {
  readonly calls: () => readonly TestMenuCall[]
}

export const makeTestMenuClient = (): TestMenuRpcs => {
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
  } satisfies TestMenuRpcs)
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

export interface TestTrayRpcs extends TrayClientApi {
  readonly calls: () => readonly TestTrayCall[]
}

export const makeTestTrayClient = (): TestTrayRpcs => {
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
        const handle = Object.freeze({
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
  } satisfies TestTrayRpcs)
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

export interface TestDialogRpcs extends DialogClientApi {
  readonly calls: () => readonly TestDialogCall[]
}

export const makeTestDialogClient = (options: TestDialogOptions = {}): TestDialogRpcs => {
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
  } satisfies TestDialogRpcs)
}

export const DialogTest = (options?: TestDialogOptions): Layer.Layer<Dialog> =>
  makeDialogServiceLayer(makeTestDialogClient(options))

// ---------------------------------------------------------------------------
// TestClipboard
// ---------------------------------------------------------------------------

export interface TestClipboardCall {
  readonly method: string
  readonly args: ReadonlyArray<unknown>
}

export interface TestClipboardRpcs extends ClipboardClientApi {
  readonly calls: () => readonly TestClipboardCall[]
  readonly text: () => string
}

export const makeTestClipboardClient = (): TestClipboardRpcs => {
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
  } satisfies TestClipboardRpcs)
}

export const ClipboardTest = (): Layer.Layer<Clipboard> =>
  makeClipboardServiceLayer(makeTestClipboardClient())

// ---------------------------------------------------------------------------
// TestNotification
// ---------------------------------------------------------------------------

export interface TestNotificationCall {
  readonly method: string
  readonly args: ReadonlyArray<unknown>
}

export interface TestNotificationRpcs extends NotificationClientApi {
  readonly calls: () => readonly TestNotificationCall[]
  readonly shown: () => readonly NotificationHandle[]
}

export const makeTestNotificationClient = (): TestNotificationRpcs => {
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
        const handle = Object.freeze({
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
      Effect.sync(() => {
        record("Notification.close", [notification])
        const idx = shown.findIndex((n) => n.id === notification.id)
        if (idx !== -1) shown.splice(idx, 1)
      }),
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
  } satisfies TestNotificationRpcs)
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

export interface TestSafeStorageRpcs extends SafeStorageClientApi {
  readonly calls: () => readonly TestSafeStorageCall[]
  readonly snapshot: () => ReadonlyMap<string, Uint8Array>
}

export const makeTestSafeStorageClient = (): TestSafeStorageRpcs => {
  const log: TestSafeStorageCall[] = []
  const store = new Map<string, Uint8Array>()

  const record = (method: string, args: ReadonlyArray<unknown>): void => {
    log.push({ method, args })
  }

  return Object.freeze({
    calls: () => log.slice(),
    snapshot: () => new Map([...store.entries()].map(([k, v]) => [k, new Uint8Array(v)])),
    set: (key: string, value: SecretBytes): Effect.Effect<void, SafeStorageError, never> =>
      Effect.sync(() => {
        record("SafeStorage.set", [key])
        store.set(key, unsafeSecretBytes(value))
      }),
    get: (key: string): Effect.Effect<SecretBytes, SafeStorageError, never> =>
      Effect.gen(function* () {
        record("SafeStorage.get", [key])
        const value = store.get(key)
        if (value === undefined) {
          return yield* Effect.fail(notFound(key, "SafeStorage.get"))
        }
        return makeSecretBytes(value)
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
  } satisfies TestSafeStorageRpcs)
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

export interface TestCrashReporterRpcs extends CrashReporterClientApi {
  readonly calls: () => readonly TestCrashReporterCall[]
  readonly breadcrumbs: () => ReadonlyArray<CrashReporterBreadcrumb>
}

export const makeTestCrashReporterClient = (): Effect.Effect<TestCrashReporterRpcs, never, never> =>
  Effect.gen(function* () {
    const log: TestCrashReporterCall[] = []
    const inner = yield* makeCrashReporterMemoryClient()
    const breadcrumbs: CrashReporterBreadcrumb[] = []

    const record = (method: string, args: ReadonlyArray<unknown>): void => {
      log.push({ method, args })
    }

    return Object.freeze({
      calls: () => log.slice(),
      breadcrumbs: () => breadcrumbs.slice(),
      start: (
        options?: CrashReporterStartOptions
      ): Effect.Effect<void, CrashReporterError, never> =>
        inner.start(options).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              record("CrashReporter.start", [options])
              breadcrumbs.length = 0
            })
          )
        ),
      recordBreadcrumb: (
        breadcrumb: CrashReporterBreadcrumb
      ): Effect.Effect<void, CrashReporterError, never> =>
        inner.recordBreadcrumb(breadcrumb).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              breadcrumbs.push(breadcrumb)
              record("CrashReporter.recordBreadcrumb", [breadcrumb])
            })
          )
        ),
      flush: (): Effect.Effect<CrashReporterFlushResult, CrashReporterError, never> =>
        inner.flush().pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              record("CrashReporter.flush", [result])
              breadcrumbs.length = 0
            })
          )
        ),
      setUploadHandler: (
        handler: CrashReportUploadHandler
      ): Effect.Effect<void, CrashReporterError, never> =>
        inner
          .setUploadHandler(handler)
          .pipe(Effect.tap(() => Effect.sync(() => record("CrashReporter.setUploadHandler", []))))
    } satisfies TestCrashReporterRpcs)
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

export interface TestUpdaterRpcs extends UpdaterClientApi {
  readonly calls: () => readonly TestUpdaterCall[]
}

export const makeTestUpdaterClient = (options: TestUpdaterOptions = {}): TestUpdaterRpcs => {
  const log: TestUpdaterCall[] = []

  const record = (method: string, args: ReadonlyArray<unknown>): void => {
    log.push({ method, args })
  }

  const checkResult = (available: boolean): UpdaterCheckResult =>
    available
      ? {
          available: true,
          version: options.version ?? "0.0.0"
        }
      : {
          available: false,
          ...(options.version === undefined ? {} : { version: options.version })
        }

  const statusResult = (state: "downloaded" | "installing"): UpdaterStatusResult => ({
    state,
    version: options.version ?? "0.0.0"
  })

  return Object.freeze({
    calls: () => log.slice(),
    check: (input?: UpdaterCheckOptions): Effect.Effect<UpdaterCheckResult, UpdaterError, never> =>
      Effect.sync(() => {
        record("Updater.check", [input])
        return checkResult(options.available ?? false)
      }),
    download: (
      input?: UpdaterDownloadOptions
    ): Effect.Effect<UpdaterStatusResult, UpdaterError, never> =>
      Effect.sync(() => {
        record("Updater.download", [input])
        return statusResult("downloaded")
      }),
    install: (
      input?: UpdaterInstallOptions
    ): Effect.Effect<UpdaterStatusResult, UpdaterError, never> =>
      Effect.sync(() => {
        record("Updater.install", [input])
        return statusResult("installing")
      }),
    installAndRestart: (
      input?: UpdaterInstallOptions
    ): Effect.Effect<UpdaterStatusResult, UpdaterError, never> =>
      Effect.sync(() => {
        record("Updater.installAndRestart", [input])
        return statusResult("installing")
      }),
    getStatus: (): Effect.Effect<UpdaterStatusResult, UpdaterError, never> =>
      Effect.sync(() => {
        record("Updater.getStatus", [])
        return { state: "idle" }
      }),
    readyForRestart: (): Effect.Effect<void, UpdaterError, never> =>
      Effect.sync(() => record("Updater.readyForRestart", [])),
    onPreparingRestart: (): Stream.Stream<UpdaterPreparingRestartEvent, UpdaterError, never> =>
      Stream.empty
  } satisfies TestUpdaterRpcs)
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

export interface TestSystemAppearanceRpcs extends SystemAppearanceClientApi {
  readonly calls: () => readonly TestSystemAppearanceCall[]
}

export const makeTestSystemAppearanceClient = (
  options: TestSystemAppearanceOptions = {}
): TestSystemAppearanceRpcs => {
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
  } satisfies TestSystemAppearanceRpcs)
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

export interface TestPowerMonitorRpcs extends PowerMonitorClientApi {
  readonly calls: () => readonly TestPowerMonitorCall[]
}

export const makeTestPowerMonitorClient = (): TestPowerMonitorRpcs => {
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
  } satisfies TestPowerMonitorRpcs)
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

export interface TestScreenRpcs extends ScreenClientApi {
  readonly calls: () => readonly TestScreenCall[]
}

const DEFAULT_DISPLAY: ScreenDisplay = new ScreenDisplay({
  id: "display-1",
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1080 },
  scaleFactor: 2,
  primary: true
})

export const makeTestScreenClient = (_options: TestScreenOptions = {}): TestScreenRpcs => {
  const log: TestScreenCall[] = []

  const record = (method: string, args: ReadonlyArray<unknown>): void => {
    log.push({ method, args })
  }

  const displays = _options.displays?.map(
    (d) =>
      new ScreenDisplay({
        id: d.id ?? "display-1",
        bounds: {
          x: d.bounds?.x ?? 0,
          y: d.bounds?.y ?? 0,
          width: d.bounds?.width ?? 1920,
          height: d.bounds?.height ?? 1080
        },
        workArea: {
          x: d.workArea?.x ?? 0,
          y: d.workArea?.y ?? 0,
          width: d.workArea?.width ?? 1920,
          height: d.workArea?.height ?? 1080
        },
        scaleFactor: d.scaleFactor ?? 2,
        primary: d.primary ?? true
      })
  ) ?? [DEFAULT_DISPLAY]

  const primaryDisplay = displays.find((d) => d.primary) ?? displays[0] ?? DEFAULT_DISPLAY

  return Object.freeze({
    calls: () => log.slice(),
    getDisplays: (): Effect.Effect<ScreenDisplaysResult, ScreenError, never> =>
      Effect.sync(() => {
        record("Screen.getDisplays", [])
        return new ScreenDisplaysResult({ displays })
      }),
    getPrimaryDisplay: (): Effect.Effect<ScreenDisplay, ScreenError, never> =>
      Effect.sync(() => {
        record("Screen.getPrimaryDisplay", [])
        return primaryDisplay
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
  } satisfies TestScreenRpcs)
}

export const ScreenTest = (options?: TestScreenOptions): Layer.Layer<Screen> =>
  makeScreenServiceLayer(makeTestScreenClient(options))

// ---------------------------------------------------------------------------
// TestShell
// ---------------------------------------------------------------------------

export interface TestShellCall {
  readonly method: string
  readonly args: ReadonlyArray<unknown>
}

export interface TestShellRpcs extends ShellClientApi {
  readonly calls: () => readonly TestShellCall[]
}

export const makeTestShellClient = (): TestShellRpcs => {
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
  } satisfies TestShellRpcs)
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

export interface TestAppRpcs extends AppClientApi {
  readonly calls: () => readonly TestAppCall[]
}

export const makeTestAppClient = (options: TestAppOptions = {}): TestAppRpcs => {
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
  } satisfies TestAppRpcs)
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
    ClipboardTest(),
    TestCrashReporter.layer(),
    DialogTest(options.dialog),
    TestMenu.layer(),
    TestNotification.layer(),
    TestPowerMonitor.layer(),
    TestSafeStorage.layer(),
    ScreenTest(options.screen),
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

export const expectWindowCall = (client: TestWindowRpcs, method: string, count?: number): void => {
  const matching = client.calls().filter((call) => call.method === method)
  const expected = count ?? 1
  if (matching.length !== expected) {
    throw new Error(
      `Expected ${expected} call(s) to ${method}, got ${matching.length}. Calls: ${JSON.stringify(client.calls())}`
    )
  }
}

export const expectMenuCall = (client: TestMenuRpcs, method: string, count?: number): void => {
  const matching = client.calls().filter((call) => call.method === method)
  const expected = count ?? 1
  if (matching.length !== expected) {
    throw new Error(
      `Expected ${expected} call(s) to ${method}, got ${matching.length}. Calls: ${JSON.stringify(client.calls())}`
    )
  }
}

export const expectShellCall = (client: TestShellRpcs, method: string, count?: number): void => {
  const matching = client.calls().filter((call) => call.method === method)
  const expected = count ?? 1
  if (matching.length !== expected) {
    throw new Error(
      `Expected ${expected} call(s) to ${method}, got ${matching.length}. Calls: ${JSON.stringify(client.calls())}`
    )
  }
}

export const expectClipboardText = (client: TestClipboardRpcs, expected: string): void => {
  const actual = client.text()
  if (actual !== expected) {
    throw new Error(`Expected clipboard text "${expected}", got "${actual}"`)
  }
}

export const expectNotificationShown = (client: TestNotificationRpcs, count?: number): void => {
  const actual = client.shown().length
  const expected = count ?? 1
  if (actual !== expected) {
    throw new Error(`Expected ${expected} notification(s) shown, got ${actual}`)
  }
}

export const expectCrashBreadcrumb = (client: TestCrashReporterRpcs, count?: number): void => {
  const actual = client.breadcrumbs().length
  const expected = count ?? 1
  if (actual !== expected) {
    throw new Error(`Expected ${expected} crash breadcrumb(s), got ${actual}`)
  }
}

export const expectSafeStorageKey = (client: TestSafeStorageRpcs, key: string): void => {
  const snapshot = client.snapshot()
  if (!snapshot.has(key)) {
    throw new Error(
      `Expected SafeStorage key "${key}" to exist. Keys: ${JSON.stringify([...snapshot.keys()])}`
    )
  }
}

export const expectUpdaterCall = (
  client: TestUpdaterRpcs,
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

export const expectAppearance = (
  client: TestSystemAppearanceRpcs,
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
