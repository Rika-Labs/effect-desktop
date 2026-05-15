import { dirname, join } from "node:path"
import { tmpdir } from "node:os"

import {
  Clock,
  Context,
  Data,
  Effect,
  Layer,
  Option,
  PubSub,
  Schema,
  Semaphore,
  Stream
} from "effect"
import { KeyValueStore } from "effect/unstable/persistence"

import { DesktopWindowContext } from "./desktop-window-context.js"

export class WindowStateRecord extends Schema.Class<WindowStateRecord>("WindowStateRecord")({
  x: Schema.Number.check(Schema.isFinite()),
  y: Schema.Number.check(Schema.isFinite()),
  width: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0)),
  height: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0)),
  isFullScreen: Schema.Boolean,
  scaleFactor: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0)),
  zoom: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0)),
  devtoolsPanel: Schema.optionalKey(Schema.String),
  scrollPositions: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.Number.check(Schema.isFinite()))
  )
}) {}

export class WindowStateStore extends Schema.Class<WindowStateStore>("WindowStateStore")({
  windows: Schema.Record(Schema.String, WindowStateRecord)
}) {}

export class WindowDisplayBounds extends Schema.Class<WindowDisplayBounds>("WindowDisplayBounds")({
  x: Schema.Number.check(Schema.isFinite()),
  y: Schema.Number.check(Schema.isFinite()),
  width: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0)),
  height: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0)),
  primary: Schema.optionalKey(Schema.Boolean)
}) {}

export const WindowStateEventKind = Schema.Literals(["persisted", "cleared", "corrupt-renamed"])
export type WindowStateEventKind = typeof WindowStateEventKind.Type

export class WindowStateEvent extends Schema.Class<WindowStateEvent>("WindowStateEvent")({
  kind: WindowStateEventKind,
  path: Schema.String,
  windowId: Schema.optionalKey(Schema.String),
  corruptPath: Schema.optionalKey(Schema.String),
  reason: Schema.optionalKey(Schema.String)
}) {}

const WindowStateStoreText = Schema.fromJsonString(Schema.toCodecJson(WindowStateStore))

export class WindowStateReadFailed extends Data.TaggedError("WindowStateReadFailed")<{
  readonly path: string
  readonly reason: string
}> {}

export class WindowStateWriteFailed extends Data.TaggedError("WindowStateWriteFailed")<{
  readonly path: string
  readonly reason: string
}> {}

export class WindowStateCorruptRenamed extends Data.TaggedError("WindowStateCorruptRenamed")<{
  readonly path: string
  readonly corruptPath: string
  readonly reason: string
}> {}

export class WindowStateInvalidArgumentError extends Data.TaggedError("InvalidArgument")<{
  readonly operation: string
  readonly field: string
  readonly message: string
  readonly cause: Option.Option<unknown>
}> {}

export type WindowStateError =
  | WindowStateReadFailed
  | WindowStateWriteFailed
  | WindowStateCorruptRenamed
  | WindowStateInvalidArgumentError

const WindowStateWindowIdSchema = Schema.NonEmptyString.check(
  Schema.isPattern(/\S/),
  // eslint-disable-next-line no-control-regex
  Schema.isPattern(/^[^\x00-\x1F\x7F]+$/)
)

const decodeWindowId = (
  windowId: string,
  operation: string
): Effect.Effect<string, WindowStateInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(WindowStateWindowIdSchema)(windowId).pipe(
    Effect.mapError(
      (error) =>
        new WindowStateInvalidArgumentError({
          operation,
          field: "windowId",
          message: error instanceof Error ? error.message : String(error),
          cause: Option.some(error)
        })
    )
  )

export interface WindowStateApi {
  readonly restore: () => Effect.Effect<Option.Option<WindowStateRecord>, WindowStateError, never>
  readonly persist: (state: WindowStateRecord) => Effect.Effect<void, WindowStateError, never>
  readonly clear: () => Effect.Effect<void, WindowStateError, never>
  readonly observe: () => Stream.Stream<WindowStateEvent, never, never>
}

interface WindowStateRepositoryApi {
  readonly restore: (
    windowId: string
  ) => Effect.Effect<Option.Option<WindowStateRecord>, WindowStateError, never>
  readonly persist: (
    windowId: string,
    state: WindowStateRecord
  ) => Effect.Effect<void, WindowStateError, never>
  readonly clear: (windowId?: string) => Effect.Effect<void, WindowStateError, never>
  readonly observe: () => Stream.Stream<WindowStateEvent, never, never>
}

export interface WindowStateOptions {
  readonly path?: string
  readonly bundleId?: string
  readonly now?: () => number
  readonly validateBounds?: (state: WindowStateRecord) => WindowStateRecord
  readonly displays?: readonly WindowDisplayBounds[]
}

export const makeWindowState = (
  windowId: string,
  options: WindowStateOptions = {}
): Effect.Effect<WindowStateApi, WindowStateInvalidArgumentError, KeyValueStore.KeyValueStore> =>
  Effect.gen(function* () {
    const repository = yield* makeWindowStateRepository(options)
    const resolvedWindowId = yield* decodeWindowId(windowId, "WindowState.make")
    return Object.freeze({
      restore: () => repository.restore(resolvedWindowId),
      persist: (state: WindowStateRecord) => repository.persist(resolvedWindowId, state),
      clear: () => repository.clear(resolvedWindowId),
      observe: () => repository.observe()
    })
  })

const makeWindowStateRepository = (
  options: WindowStateOptions = {}
): Effect.Effect<
  WindowStateRepositoryApi,
  WindowStateInvalidArgumentError,
  KeyValueStore.KeyValueStore
> =>
  Effect.gen(function* () {
    const path =
      options.path ??
      buildDefaultWindowStatePath(
        yield* validateBundleId(options.bundleId ?? "effect-desktop", "WindowState.make")
      )
    const kv = yield* KeyValueStore.KeyValueStore
    const storeKey = path
    const now =
      options.now === undefined
        ? Clock.currentTimeMillis
        : Effect.sync(options.now).pipe(
            Effect.catchDefect((error) =>
              Effect.fail(
                new WindowStateReadFailed({
                  path,
                  reason: `window-state clock failed: ${formatUnknownError(error)}`
                })
              )
            )
          )
    const validateBounds = (state: WindowStateRecord) =>
      snapToVisibleDisplay(options.validateBounds?.(state) ?? state, options.displays)
    const events = yield* PubSub.sliding<WindowStateEvent>({ capacity: 128, replay: 0 })
    const mutationGate = yield* Semaphore.make(1)
    const read = readStore(kv, storeKey, path, now)
    const publishReadEvent = (result: WindowStateReadResult): Effect.Effect<void, never, never> =>
      result.event === undefined
        ? Effect.void
        : PubSub.publish(events, result.event).pipe(Effect.asVoid)

    return Object.freeze({
      restore: (windowId: string) =>
        Effect.gen(function* () {
          yield* decodeWindowId(windowId, "WindowState.restore")
          const result = yield* read
          yield* publishReadEvent(result)
          const store = result.store
          const record = store.windows[windowId]
          return record === undefined ? Option.none() : Option.some(validateBounds(record))
        }),
      persist: (windowId: string, state: WindowStateRecord) =>
        Semaphore.withPermit(
          mutationGate,
          Effect.gen(function* () {
            yield* decodeWindowId(windowId, "WindowState.persist")
            const result = yield* read
            yield* publishReadEvent(result)
            const current = result.store
            const next = new WindowStateStore({
              windows: {
                ...current.windows,
                [windowId]: state
              }
            })

            yield* writeStore(kv, storeKey, path, next)
            yield* PubSub.publish(
              events,
              new WindowStateEvent({ kind: "persisted", path, windowId })
            )
          })
        ),
      clear: (windowId?: string) =>
        Semaphore.withPermit(
          mutationGate,
          Effect.gen(function* () {
            if (windowId !== undefined) {
              yield* decodeWindowId(windowId, "WindowState.clear")
            }
            const result = yield* read
            yield* publishReadEvent(result)
            const next =
              windowId === undefined
                ? new WindowStateStore({ windows: {} })
                : new WindowStateStore({
                    windows: Object.fromEntries(
                      Object.entries(result.store.windows).filter(([id]) => id !== windowId)
                    )
                  })

            yield* writeStore(kv, storeKey, path, next)
            yield* PubSub.publish(
              events,
              new WindowStateEvent({
                kind: "cleared",
                path,
                ...(windowId === undefined ? {} : { windowId })
              })
            )
          })
        ),
      observe: () => Stream.fromPubSub(events)
    })
  })

export class WindowState extends Context.Service<WindowState, WindowStateApi>()("WindowState") {
  static window(
    options: WindowStateOptions = {}
  ): Layer.Layer<
    WindowState,
    WindowStateInvalidArgumentError,
    DesktopWindowContext | KeyValueStore.KeyValueStore
  > {
    return Layer.effect(
      WindowState,
      Effect.gen(function* () {
        const context = yield* DesktopWindowContext
        return yield* makeWindowState(context.registrationId, options)
      })
    )
  }
}

export const WindowStateLive: Layer.Layer<
  WindowState,
  WindowStateInvalidArgumentError,
  DesktopWindowContext | KeyValueStore.KeyValueStore
> = WindowState.window()

const readStore = (
  kv: KeyValueStore.KeyValueStore,
  storeKey: string,
  path: string,
  now: Effect.Effect<number, WindowStateReadFailed, never>
): Effect.Effect<WindowStateReadResult, WindowStateError, never> =>
  Effect.gen(function* () {
    const content = yield* kv
      .get(storeKey)
      .pipe(
        Effect.mapError(
          (error) => new WindowStateReadFailed({ path, reason: formatUnknownError(error) })
        )
      )

    if (content === undefined) {
      return { store: new WindowStateStore({ windows: {} }) }
    }

    return yield* decodeStore(content, path).pipe(
      Effect.map((store) => ({ store })),
      Effect.catchTag("WindowStateReadFailed", (error) =>
        clearCorruptState(kv, storeKey, path, now, error.reason)
      )
    )
  })

interface WindowStateReadResult {
  readonly store: WindowStateStore
  readonly event?: WindowStateEvent
}

const decodeStore = (
  content: string,
  path: string
): Effect.Effect<WindowStateStore, WindowStateReadFailed, never> =>
  Schema.decodeUnknownEffect(WindowStateStoreText)(content).pipe(
    Effect.mapError(
      (error) => new WindowStateReadFailed({ path, reason: formatUnknownError(error) })
    )
  )

const writeStore = (
  kv: KeyValueStore.KeyValueStore,
  storeKey: string,
  path: string,
  store: WindowStateStore
): Effect.Effect<void, WindowStateWriteFailed, never> =>
  Effect.gen(function* () {
    const encoded = yield* Schema.encodeUnknownEffect(WindowStateStoreText)(store).pipe(
      Effect.mapError(
        (error) => new WindowStateWriteFailed({ path, reason: formatUnknownError(error) })
      )
    )
    yield* kv
      .set(storeKey, encoded)
      .pipe(
        Effect.mapError(
          (error) => new WindowStateWriteFailed({ path, reason: formatUnknownError(error) })
        )
      )
  })

const clearCorruptState = (
  kv: KeyValueStore.KeyValueStore,
  storeKey: string,
  path: string,
  now: Effect.Effect<number, WindowStateReadFailed, never>,
  reason: string
): Effect.Effect<WindowStateReadResult, WindowStateCorruptRenamed | WindowStateReadFailed, never> =>
  Effect.gen(function* () {
    const timestamp = yield* readRecoveryTimestamp(path, now)
    const corruptPath = corruptWindowStatePath(path, timestamp)
    yield* kv.remove(storeKey).pipe(
      Effect.mapError(
        (error) =>
          new WindowStateCorruptRenamed({
            path,
            corruptPath,
            reason: `${reason}; corrupt-state removal failed: ${formatUnknownError(error)}`
          })
      )
    )

    return {
      store: new WindowStateStore({ windows: {} }),
      event: new WindowStateEvent({
        kind: "corrupt-renamed",
        path,
        corruptPath,
        reason
      })
    }
  })

const readRecoveryTimestamp = (
  path: string,
  now: Effect.Effect<number, WindowStateReadFailed, never>
): Effect.Effect<number, WindowStateReadFailed, never> =>
  now.pipe(
    Effect.flatMap((timestamp) =>
      Number.isSafeInteger(timestamp) && timestamp >= 0
        ? Effect.succeed(timestamp)
        : Effect.fail(
            new WindowStateReadFailed({
              path,
              reason: `corrupt-file recovery timestamp must be a finite non-negative safe integer: ${String(timestamp)}`
            })
          )
    ),
    Effect.catchDefect((error) =>
      Effect.fail(
        new WindowStateReadFailed({
          path,
          reason: `corrupt-file recovery timestamp failed: ${formatUnknownError(error)}`
        })
      )
    )
  )

const snapToVisibleDisplay = (
  state: WindowStateRecord,
  displays: readonly WindowDisplayBounds[] | undefined
): WindowStateRecord => {
  if (displays === undefined || displays.length === 0 || intersectsAnyDisplay(state, displays)) {
    return state
  }

  const target = displays.find((display) => display.primary === true) ?? displays[0]
  if (target === undefined) {
    return state
  }

  return new WindowStateRecord({
    x: target.x,
    y: target.y,
    width: Math.min(state.width, target.width),
    height: Math.min(state.height, target.height),
    isFullScreen: state.isFullScreen,
    scaleFactor: state.scaleFactor,
    zoom: state.zoom,
    ...(state.devtoolsPanel === undefined ? {} : { devtoolsPanel: state.devtoolsPanel }),
    ...(state.scrollPositions === undefined ? {} : { scrollPositions: state.scrollPositions })
  })
}

const intersectsAnyDisplay = (
  state: WindowStateRecord,
  displays: readonly WindowDisplayBounds[]
): boolean =>
  displays.some(
    (display) =>
      state.x < display.x + display.width &&
      state.x + state.width > display.x &&
      state.y < display.y + display.height &&
      state.y + state.height > display.y
  )

export const defaultWindowStatePath = (bundleId: string): string =>
  buildDefaultWindowStatePath(assertBundleId(bundleId))

const buildDefaultWindowStatePath = (bundleId: string): string => {
  switch (process.platform) {
    case "darwin":
      return join(homeDirectory(), "Library", "Application Support", bundleId, "window-state.json")
    case "win32":
      return join(process.env["APPDATA"] ?? tmpdir(), bundleId, "window-state.json")
    case "aix":
    case "android":
    case "cygwin":
    case "freebsd":
    case "haiku":
    case "linux":
    case "netbsd":
    case "openbsd":
    case "sunos":
      return join(
        process.env["XDG_STATE_HOME"] ?? join(homeDirectory(), ".local", "state"),
        bundleId,
        "window-state.json"
      )
  }
}

const validateBundleId = (
  bundleId: string,
  operation: string
): Effect.Effect<string, WindowStateInvalidArgumentError, never> =>
  isSafeBundleId(bundleId)
    ? Effect.succeed(bundleId)
    : Effect.fail(invalidBundleId(bundleId, operation))

const assertBundleId = (bundleId: string): string => {
  if (isSafeBundleId(bundleId)) {
    return bundleId
  }

  throw invalidBundleId(bundleId, "defaultWindowStatePath")
}

const isSafeBundleId = (bundleId: string): boolean =>
  bundleId.length > 0 &&
  bundleId !== "." &&
  bundleId !== ".." &&
  !bundleId.includes("..") &&
  // eslint-disable-next-line no-control-regex
  /^[^\x00-\x1F\x7F/\\:]+$/.test(bundleId)

const invalidBundleId = (bundleId: string, operation: string): WindowStateInvalidArgumentError =>
  new WindowStateInvalidArgumentError({
    operation,
    field: "bundleId",
    message: `invalid window-state bundle id: ${bundleId}`,
    cause: Option.none()
  })

const corruptWindowStatePath = (path: string, timestamp: number): string =>
  join(dirname(path), `window-state.corrupt.${timestamp}.json`)

const homeDirectory = (): string => process.env["HOME"] ?? tmpdir()

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
