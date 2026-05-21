import type { HostProtocolError } from "@orika/bridge"
import {
  type WindowStateError,
  WindowDisplayBounds,
  WindowStateEvent,
  WindowStateRecord,
  makeWindowState
} from "@orika/core/runtime/window-state"
import { Context, Effect, Layer, Option, Ref, Schema, Semaphore, Stream } from "effect"
import { KeyValueStore } from "effect/unstable/persistence"

import { Screen, type ScreenServiceApi } from "./screen.js"
import { Window, type WindowServiceApi } from "./window.js"
import { ScreenDisplay } from "./contracts/screen.js"
import { WindowBounds, type WindowHandle } from "./contracts/window.js"

const PositiveFiniteNumber = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0))
const StrictParseOptions = { onExcessProperty: "error" } as const

export const WindowPersistenceErrorReason = Schema.Literals([
  "denied",
  "unsupported",
  "invalid-input",
  "invalid-output",
  "host-failed",
  "storage-failed"
])
export type WindowPersistenceErrorReason = typeof WindowPersistenceErrorReason.Type

export class WindowPersistenceError extends Schema.TaggedErrorClass<WindowPersistenceError>()(
  "WindowPersistenceError",
  {
    reason: WindowPersistenceErrorReason,
    operation: Schema.NonEmptyString,
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Unknown)
  }
) {}

export class WindowPersistenceSaveOptions extends Schema.Class<WindowPersistenceSaveOptions>(
  "WindowPersistenceSaveOptions"
)({
  zoom: Schema.optionalKey(PositiveFiniteNumber),
  devtoolsPanel: Schema.optionalKey(Schema.String),
  scrollPositions: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.Number.check(Schema.isFinite()))
  )
}) {}

export type WindowPersistenceSaveOptionsInput = Schema.Schema.Type<
  typeof WindowPersistenceSaveOptions
>

export class WindowPersistenceRestoreResult extends Schema.Class<WindowPersistenceRestoreResult>(
  "WindowPersistenceRestoreResult"
)({
  restored: Schema.Boolean,
  state: Schema.optionalKey(WindowStateRecord)
}) {}

export interface WindowPersistenceOptions {
  readonly path?: string
  readonly bundleId?: string
  readonly now?: () => number
}

export interface WindowPersistenceApi {
  readonly save: (
    window: WindowHandle,
    options?: WindowPersistenceSaveOptionsInput
  ) => Effect.Effect<void, WindowPersistenceError, never>
  readonly restore: (
    window: WindowHandle
  ) => Effect.Effect<WindowPersistenceRestoreResult, WindowPersistenceError, never>
  readonly clear: (window: WindowHandle) => Effect.Effect<void, WindowPersistenceError, never>
  readonly events: (
    window: WindowHandle
  ) => Stream.Stream<WindowStateEvent, WindowPersistenceError, never>
}

interface WindowPersistenceStateApi {
  readonly restore: () => Effect.Effect<Option.Option<WindowStateRecord>, WindowStateError, never>
  readonly persist: (state: WindowStateRecord) => Effect.Effect<void, WindowStateError, never>
  readonly clear: () => Effect.Effect<void, WindowStateError, never>
  readonly observe: () => Stream.Stream<WindowStateEvent, never, never>
}

export class WindowPersistence extends Context.Service<WindowPersistence, WindowPersistenceApi>()(
  "@orika/native/window-persistence/WindowPersistence"
) {
  static layer(
    options: WindowPersistenceOptions = {}
  ): Layer.Layer<WindowPersistence, never, Window | Screen | KeyValueStore.KeyValueStore> {
    return Layer.effect(WindowPersistence)(makeWindowPersistence(options))
  }
}

export const WindowPersistenceLive: Layer.Layer<
  WindowPersistence,
  never,
  Window | Screen | KeyValueStore.KeyValueStore
> = WindowPersistence.layer()

export const makeWindowPersistenceLayer = (
  options: WindowPersistenceOptions = {}
): Layer.Layer<WindowPersistence, never, Window | Screen | KeyValueStore.KeyValueStore> =>
  WindowPersistence.layer(options)

function makeWindowPersistence(
  options: WindowPersistenceOptions
): Effect.Effect<WindowPersistenceApi, never, Window | Screen | KeyValueStore.KeyValueStore> {
  return Effect.gen(function* () {
    const windowService = yield* Window
    const screen = yield* Screen
    const kv = yield* KeyValueStore.KeyValueStore
    const cache = yield* Ref.make<ReadonlyMap<string, WindowPersistenceStateApi>>(new Map())
    const cacheGate = yield* Semaphore.make(1)
    const mutationGate = yield* Semaphore.make(1)

    const stateFor = (
      window: WindowHandle,
      operation: string
    ): Effect.Effect<WindowPersistenceStateApi, WindowPersistenceError, never> =>
      Semaphore.withPermit(
        cacheGate,
        Effect.gen(function* () {
          const current = yield* Ref.get(cache)
          const existing = current.get(window.id)
          if (existing !== undefined) {
            return existing
          }

          const state = yield* makeWindowState(window.id, options).pipe(
            Effect.provideService(KeyValueStore.KeyValueStore, kv),
            Effect.mapError((error) => mapWindowStateError(error, operation))
          )
          yield* Ref.update(cache, (entries) => new Map(entries).set(window.id, state))
          return state
        })
      )

    return WindowPersistence.of({
      save: (window, input = {}) =>
        Effect.gen(function* () {
          const saveOptions = yield* decodeSaveOptions(input)
          const state = yield* stateFor(window, "WindowPersistence.save")
          const bounds = yield* normalizeHost(
            windowService.getBounds(window),
            "WindowPersistence.save"
          )
          const hostState = yield* normalizeHost(
            windowService.getState(window),
            "WindowPersistence.save"
          )
          const displays = yield* currentDisplays(screen, "WindowPersistence.save")
          const display = yield* displayForBounds(bounds, displays, "WindowPersistence.save")
          yield* Semaphore.withPermit(
            mutationGate,
            state
              .persist(
                new WindowStateRecord({
                  x: bounds.x,
                  y: bounds.y,
                  width: bounds.width,
                  height: bounds.height,
                  displayId: display.id,
                  isFullScreen: hostState.fullscreen,
                  scaleFactor: display.scaleFactor,
                  zoom: saveOptions.zoom ?? 1,
                  ...(saveOptions.devtoolsPanel === undefined
                    ? {}
                    : { devtoolsPanel: saveOptions.devtoolsPanel }),
                  ...(saveOptions.scrollPositions === undefined
                    ? {}
                    : { scrollPositions: saveOptions.scrollPositions })
                })
              )
              .pipe(
                Effect.mapError((error) => mapWindowStateError(error, "WindowPersistence.save"))
              )
          )
        }),
      restore: (window) =>
        Effect.gen(function* () {
          const state = yield* stateFor(window, "WindowPersistence.restore")
          const restored = yield* state
            .restore()
            .pipe(
              Effect.mapError((error) => mapWindowStateError(error, "WindowPersistence.restore"))
            )
          if (Option.isNone(restored)) {
            return new WindowPersistenceRestoreResult({ restored: false })
          }

          const displays = yield* currentDisplays(screen, "WindowPersistence.restore")
          const record = snapToDisplay(Option.getOrThrow(restored), displays)
          const currentState = yield* normalizeHost(
            windowService.getState(window),
            "WindowPersistence.restore"
          )
          if (currentState.fullscreen) {
            yield* normalizeHost(
              windowService.setFullscreen(window, false),
              "WindowPersistence.restore"
            )
          }
          yield* normalizeHost(
            windowService.setBounds(
              window,
              new WindowBounds({
                x: record.x,
                y: record.y,
                width: record.width,
                height: record.height
              })
            ),
            "WindowPersistence.restore"
          )
          if (record.isFullScreen) {
            yield* normalizeHost(
              windowService.setFullscreen(window, true),
              "WindowPersistence.restore"
            )
          }
          return new WindowPersistenceRestoreResult({ restored: true, state: record })
        }),
      clear: (window) =>
        Effect.gen(function* () {
          yield* validateWindowAccess(windowService, window, "WindowPersistence.clear")
          const state = yield* stateFor(window, "WindowPersistence.clear")
          yield* Semaphore.withPermit(
            mutationGate,
            state
              .clear()
              .pipe(
                Effect.mapError((error) => mapWindowStateError(error, "WindowPersistence.clear"))
              )
          )
        }),
      events: (window) =>
        Stream.unwrap(
          Effect.gen(function* () {
            yield* validateWindowAccess(windowService, window, "WindowPersistence.events")
            const state = yield* stateFor(window, "WindowPersistence.events")
            return state.observe()
          })
        )
    } satisfies WindowPersistenceApi)
  })
}

const decodeSaveOptions = (
  input: WindowPersistenceSaveOptionsInput
): Effect.Effect<WindowPersistenceSaveOptions, WindowPersistenceError, never> =>
  Schema.decodeUnknownEffect(WindowPersistenceSaveOptions)(input, StrictParseOptions).pipe(
    Effect.mapError(
      (error) =>
        new WindowPersistenceError({
          reason: "invalid-input",
          operation: "WindowPersistence.save",
          message: formatUnknownError(error),
          cause: error
        })
    )
  )

const currentDisplays = (
  screen: ScreenServiceApi,
  operation: string
): Effect.Effect<ReadonlyArray<ScreenDisplay>, WindowPersistenceError, never> =>
  normalizeHost(screen.getDisplays(), operation).pipe(
    Effect.flatMap((displays) => validateDisplays(displays, operation))
  )

const validateWindowAccess = (
  windowService: WindowServiceApi,
  window: WindowHandle,
  operation: string
): Effect.Effect<void, WindowPersistenceError, never> =>
  normalizeHost(windowService.getById(window.id), operation).pipe(
    Effect.flatMap((resolved) =>
      resolved.id === window.id
        ? Effect.void
        : Effect.fail(
            new WindowPersistenceError({
              reason: "invalid-output",
              operation,
              message: `Window.getById returned mismatched window id: ${String(resolved.id)}`
            })
          )
    )
  )

const validateDisplays = (
  displays: ReadonlyArray<ScreenDisplay>,
  operation: string
): Effect.Effect<ReadonlyArray<ScreenDisplay>, WindowPersistenceError, never> => {
  if (displays.length === 0) {
    return Effect.fail(
      new WindowPersistenceError({
        reason: "invalid-output",
        operation,
        message: "Screen.getDisplays returned no displays"
      })
    )
  }
  for (const display of displays) {
    const invalidReason = invalidDisplayReason(display)
    if (invalidReason !== undefined) {
      return Effect.fail(
        new WindowPersistenceError({
          reason: "invalid-output",
          operation,
          message: invalidReason
        })
      )
    }
  }
  return Effect.succeed(displays)
}

const invalidDisplayReason = (display: ScreenDisplay): string | undefined => {
  if (!(Number.isFinite(display.scaleFactor) && display.scaleFactor > 0)) {
    return `display ${display.id} scaleFactor must be finite and greater than zero`
  }
  for (const [name, bounds] of [
    ["bounds", display.bounds],
    ["workArea", display.workArea]
  ] as const) {
    if (
      !Number.isFinite(bounds.x) ||
      !Number.isFinite(bounds.y) ||
      !(Number.isFinite(bounds.width) && bounds.width > 0) ||
      !(Number.isFinite(bounds.height) && bounds.height > 0)
    ) {
      return `display ${display.id} ${name} must contain finite coordinates and positive size`
    }
  }
  return undefined
}

const displayForBounds = (
  bounds: WindowBounds,
  displays: ReadonlyArray<ScreenDisplay>,
  operation: string
): Effect.Effect<ScreenDisplay, WindowPersistenceError, never> => {
  const fallback = displays[0]
  if (fallback === undefined) {
    return Effect.fail(
      new WindowPersistenceError({
        reason: "invalid-output",
        operation,
        message: "Screen.getDisplays returned no displays"
      })
    )
  }
  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2
  return Effect.succeed(
    displays.find((display) => pointInsideDisplay(centerX, centerY, display)) ??
      displays.find((display) => intersectsScreenDisplay(bounds, display)) ??
      displays.find((display) => display.primary) ??
      fallback
  )
}

const snapToDisplay = (
  state: WindowStateRecord,
  displays: ReadonlyArray<ScreenDisplay>
): WindowStateRecord => {
  const displayBounds = displays.map(displayToWindowBounds)
  const savedDisplay =
    state.displayId === undefined
      ? undefined
      : displayBounds.find((display) => display.id === state.displayId)
  if (
    state.displayId === undefined &&
    displayBounds.some((display) => intersectsDisplay(state, display))
  ) {
    return state
  }
  if (savedDisplay !== undefined && intersectsDisplay(state, savedDisplay)) {
    return state
  }

  const target =
    savedDisplay ?? displayBounds.find((display) => display.primary === true) ?? displayBounds[0]
  if (target === undefined) {
    return state
  }
  return new WindowStateRecord({
    x: target.x,
    y: target.y,
    width: Math.min(state.width, target.width),
    height: Math.min(state.height, target.height),
    ...(state.displayId === undefined ? {} : { displayId: target.id ?? state.displayId }),
    isFullScreen: state.isFullScreen,
    scaleFactor: target.scaleFactor ?? state.scaleFactor,
    zoom: state.zoom,
    ...(state.devtoolsPanel === undefined ? {} : { devtoolsPanel: state.devtoolsPanel }),
    ...(state.scrollPositions === undefined ? {} : { scrollPositions: state.scrollPositions })
  })
}

const displayToWindowBounds = (display: ScreenDisplay): WindowDisplayBounds =>
  new WindowDisplayBounds({
    id: display.id,
    x: display.workArea.x,
    y: display.workArea.y,
    width: display.workArea.width,
    height: display.workArea.height,
    scaleFactor: display.scaleFactor,
    primary: display.primary
  })

const pointInsideDisplay = (x: number, y: number, display: ScreenDisplay): boolean =>
  x >= display.workArea.x &&
  x < display.workArea.x + display.workArea.width &&
  y >= display.workArea.y &&
  y < display.workArea.y + display.workArea.height

const intersectsScreenDisplay = (bounds: WindowBounds, display: ScreenDisplay): boolean =>
  bounds.x < display.workArea.x + display.workArea.width &&
  bounds.x + bounds.width > display.workArea.x &&
  bounds.y < display.workArea.y + display.workArea.height &&
  bounds.y + bounds.height > display.workArea.y

const intersectsDisplay = (state: WindowStateRecord, display: WindowDisplayBounds): boolean =>
  state.x < display.x + display.width &&
  state.x + state.width > display.x &&
  state.y < display.y + display.height &&
  state.y + state.height > display.y

const normalizeHost = <A>(
  effect: Effect.Effect<A, HostProtocolError, never>,
  operation: string
): Effect.Effect<A, WindowPersistenceError, never> =>
  effect.pipe(Effect.mapError((error) => mapHostError(error, operation)))

const mapHostError = (error: HostProtocolError, operation: string): WindowPersistenceError =>
  new WindowPersistenceError({
    reason: hostErrorReason(error),
    operation,
    message: error.message,
    cause: error
  })

const hostErrorReason = (error: HostProtocolError): WindowPersistenceErrorReason => {
  switch (error.tag) {
    case "PermissionDenied":
    case "PermissionRevoked":
    case "OriginInvalid":
      return "denied"
    case "Unsupported":
    case "MethodNotFound":
      return "unsupported"
    case "InvalidArgument":
    case "FrameTooLarge":
    case "BinaryDecodeError":
      return "invalid-input"
    case "InvalidOutput":
      return "invalid-output"
    case "AlreadyExists":
    case "BackpressureOverflow":
    case "Cancelled":
    case "CrossScopeHandle":
    case "DiskFull":
    case "EventLogFull":
    case "EventLogSegmentCorrupt":
    case "FileNotFound":
    case "HostUnavailable":
    case "Internal":
    case "InvalidState":
    case "NetworkError":
    case "NotFound":
    case "PanicInNativeCode":
    case "PtyForceKillTimeout":
    case "RateLimited":
    case "ReconnectBackfillExhausted":
    case "RendererDisconnected":
    case "ResourceBusy":
    case "RuntimeRestarted":
    case "RuntimeUnavailable":
    case "SettingsMigrationFailed":
    case "SettingsRecoveredFromBackup":
    case "StaleHandle":
    case "StreamClosed":
    case "SymlinkEscapesRoot":
    case "Timeout":
    case "UpdateDowngradeRefused":
    case "UpdateDownloadTruncated":
    case "UpdateStaleNotarization":
    case "UpdateSignatureInvalid":
      return "host-failed"
  }
}

const mapWindowStateError = (error: WindowStateError, operation: string): WindowPersistenceError =>
  new WindowPersistenceError({
    reason: error._tag === "InvalidArgument" ? "invalid-input" : "storage-failed",
    operation,
    message: formatWindowStateError(error),
    cause: error
  })

const formatWindowStateError = (error: WindowStateError): string => {
  switch (error._tag) {
    case "InvalidArgument":
      return error.message
    case "WindowStateReadFailed":
    case "WindowStateWriteFailed":
    case "WindowStateCorruptRenamed":
      return error.reason
  }
}

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}
