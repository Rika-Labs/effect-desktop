import { Effect, Layer } from "effect"

import type { DesktopRpcContractLaw } from "@effect-desktop/core"
import {
  AppSurface,
  Clipboard,
  ClipboardSurface,
  ContextMenuSurface,
  CrashReporterSurface,
  Dialog,
  DialogSurface,
  DockSurface,
  GlobalShortcutSurface,
  MenuSurface,
  NotificationSurface,
  PathSurface,
  PowerMonitorSurface,
  ProtocolSurface,
  SafeStorageSurface,
  Screen,
  ScreenSurface,
  ShellSurface,
  SystemAppearanceSurface,
  TraySurface,
  UpdaterSurface,
  WebViewSurface,
  WindowSurface,
  type ClipboardClient,
  type ClipboardError,
  type ClipboardServiceApi,
  type DialogClient,
  type DialogError,
  type DialogServiceApi,
  type ScreenClient,
  type ScreenError,
  type ScreenServiceApi
} from "@effect-desktop/native"
import {
  ClipboardImage,
  ScreenDisplay,
  ScreenPoint,
  type ClipboardCapability,
  type ClipboardImageOptions,
  type DialogConfirmOptions,
  type DialogMessageOptions,
  type DialogOpenDirectoryOptions,
  type DialogOpenFileOptions,
  type DialogSaveFileOptions,
  type ScreenMethod
} from "@effect-desktop/native/contracts"

export interface TestClipboardOptions {
  readonly text?: string
  readonly supported?: Partial<Record<ClipboardCapability, boolean>>
}

export interface TestDialogOptions {
  readonly openFilePaths?: readonly string[]
  readonly openDirectoryPaths?: readonly string[]
  readonly saveFilePath?: string
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

export interface TestNativeSurface {
  readonly tag: string
  readonly contractLaws: readonly DesktopRpcContractLaw[]
}

export const TestNativeSurfaces: readonly TestNativeSurface[] = Object.freeze([
  { tag: AppSurface.tag, contractLaws: AppSurface.contractLaws },
  { tag: ClipboardSurface.tag, contractLaws: ClipboardSurface.contractLaws },
  { tag: ContextMenuSurface.tag, contractLaws: ContextMenuSurface.contractLaws },
  { tag: CrashReporterSurface.tag, contractLaws: CrashReporterSurface.contractLaws },
  { tag: DialogSurface.tag, contractLaws: DialogSurface.contractLaws },
  { tag: DockSurface.tag, contractLaws: DockSurface.contractLaws },
  { tag: GlobalShortcutSurface.tag, contractLaws: GlobalShortcutSurface.contractLaws },
  { tag: MenuSurface.tag, contractLaws: MenuSurface.contractLaws },
  { tag: NotificationSurface.tag, contractLaws: NotificationSurface.contractLaws },
  { tag: PathSurface.tag, contractLaws: PathSurface.contractLaws },
  { tag: PowerMonitorSurface.tag, contractLaws: PowerMonitorSurface.contractLaws },
  { tag: ProtocolSurface.tag, contractLaws: ProtocolSurface.contractLaws },
  { tag: SafeStorageSurface.tag, contractLaws: SafeStorageSurface.contractLaws },
  { tag: ScreenSurface.tag, contractLaws: ScreenSurface.contractLaws },
  { tag: ShellSurface.tag, contractLaws: ShellSurface.contractLaws },
  { tag: SystemAppearanceSurface.tag, contractLaws: SystemAppearanceSurface.contractLaws },
  { tag: TraySurface.tag, contractLaws: TraySurface.contractLaws },
  { tag: UpdaterSurface.tag, contractLaws: UpdaterSurface.contractLaws },
  { tag: WebViewSurface.tag, contractLaws: WebViewSurface.contractLaws },
  { tag: WindowSurface.tag, contractLaws: WindowSurface.contractLaws }
])

export const ClipboardTest = (options: TestClipboardOptions = {}): Layer.Layer<Clipboard> =>
  makeClipboardScenarioLayer(options)

export const DialogTest = (options: TestDialogOptions = {}): Layer.Layer<Dialog> =>
  makeDialogScenarioLayer(options)

export const ScreenTest = (options: TestScreenOptions = {}): Layer.Layer<Screen> =>
  makeScreenScenarioLayer(options)

export const ClipboardClientTest = (
  options: TestClipboardOptions = {}
): Layer.Layer<ClipboardClient> =>
  Layer.provide(ClipboardSurface.testClientLayer, makeClipboardScenarioLayer(options))

export const DialogClientTest = (options: TestDialogOptions = {}): Layer.Layer<DialogClient> =>
  Layer.provide(DialogSurface.testClientLayer, makeDialogScenarioLayer(options))

export const ScreenClientTest = (options: TestScreenOptions = {}): Layer.Layer<ScreenClient> =>
  Layer.provide(ScreenSurface.testClientLayer, makeScreenScenarioLayer(options))

export type TestDesktopServices = Clipboard | Dialog | Screen

export interface TestDesktopOptions {
  readonly clipboard?: TestClipboardOptions
  readonly dialog?: TestDialogOptions
  readonly screen?: TestScreenOptions
}

export const TestDesktopLive = (
  options: TestDesktopOptions = {}
): Layer.Layer<TestDesktopServices> =>
  Layer.mergeAll(
    ClipboardTest(options.clipboard),
    DialogTest(options.dialog),
    ScreenTest(options.screen)
  )

export const TestDesktop = Object.freeze({
  layer: TestDesktopLive
})

export const makeClipboardScenarioLayer = (
  options: TestClipboardOptions
): Layer.Layer<Clipboard, never, never> =>
  Layer.succeed(Clipboard)(
    makeClipboardScenario({
      initialText: options.text ?? "",
      supported: options.supported ?? {}
    })
  )

const makeClipboardScenario = (options: {
  readonly initialText: string
  readonly supported: Partial<Record<ClipboardCapability, boolean>>
}): ClipboardServiceApi => {
  let textContent = options.initialText
  let imageContent: ClipboardImage | undefined

  return Object.freeze({
    readText: (): Effect.Effect<string, ClipboardError, never> => Effect.sync(() => textContent),
    writeText: (text: string): Effect.Effect<void, ClipboardError, never> =>
      Effect.sync(() => {
        textContent = text
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
    saveFile: (_input?: DialogSaveFileOptions): Effect.Effect<string, DialogError> =>
      Effect.succeed(options.saveFilePath ?? "/tmp/save"),
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
    isSupported: (_method: ScreenMethod): Effect.Effect<boolean, ScreenError> =>
      Effect.succeed(true)
  } satisfies ScreenServiceApi)
}
