import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"

import { Context, Data, Effect, Layer, Option, PubSub, Schema, Stream } from "effect"

export class WindowStateRecord extends Schema.Class<WindowStateRecord>("WindowStateRecord")({
  x: Schema.Number.check(Schema.isFinite()),
  y: Schema.Number.check(Schema.isFinite()),
  width: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0)),
  height: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0)),
  isFullScreen: Schema.Boolean,
  scaleFactor: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0)),
  zoom: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0)),
  devtoolsPanel: Schema.optionalKey(Schema.String),
  scrollPositions: Schema.optionalKey(Schema.Record(Schema.String, Schema.Number))
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

const WindowStateWindowIdSchema = Schema.String.check(Schema.isPattern(/\S/))

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
  readonly restore: (
    windowId: string
  ) => Effect.Effect<Option.Option<WindowStateRecord>, WindowStateError, never>
  readonly restoreAll: () => Effect.Effect<
    Readonly<Record<string, WindowStateRecord>>,
    WindowStateError,
    never
  >
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
  options: WindowStateOptions = {}
): Effect.Effect<WindowStateApi, never, never> =>
  Effect.gen(function* () {
    const path = options.path ?? defaultWindowStatePath(options.bundleId ?? "effect-desktop")
    const now = options.now ?? Date.now
    const validateBounds = (state: WindowStateRecord) =>
      snapToVisibleDisplay(options.validateBounds?.(state) ?? state, options.displays)
    const events = yield* PubSub.sliding<WindowStateEvent>({ capacity: 128, replay: 0 })
    const read = readStore(path, now)
    const publishReadEvent = (result: WindowStateReadResult): Effect.Effect<void, never, never> =>
      result.event === undefined
        ? Effect.void
        : PubSub.publish(events, result.event).pipe(Effect.asVoid)

    return Object.freeze({
      restore: (windowId: string) =>
        Effect.gen(function* () {
          const result = yield* read
          yield* publishReadEvent(result)
          const store = result.store
          const record = store.windows[windowId]
          return record === undefined ? Option.none() : Option.some(validateBounds(record))
        }),
      restoreAll: () =>
        Effect.gen(function* () {
          const result = yield* read
          yield* publishReadEvent(result)
          return Object.fromEntries(
            Object.entries(result.store.windows).map(([windowId, record]) => [
              windowId,
              validateBounds(record)
            ])
          )
        }),
      persist: (windowId: string, state: WindowStateRecord) =>
        Effect.gen(function* () {
          const result = yield* read
          yield* publishReadEvent(result)
          const current = result.store
          const next = new WindowStateStore({
            windows: {
              ...current.windows,
              [windowId]: state
            }
          })

          yield* writeStore(path, next)
          yield* PubSub.publish(events, new WindowStateEvent({ kind: "persisted", path, windowId }))
        }),
      clear: (windowId?: string) =>
        Effect.gen(function* () {
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

          yield* writeStore(path, next)
          yield* PubSub.publish(
            events,
            new WindowStateEvent({
              kind: "cleared",
              path,
              ...(windowId === undefined ? {} : { windowId })
            })
          )
        }),
      observe: () => Stream.fromPubSub(events)
    })
  })

export class WindowState extends Context.Service<WindowState, WindowStateApi>()("WindowState") {}

export const WindowStateLive = Layer.effect(WindowState)(makeWindowState())

const readStore = (
  path: string,
  now: () => number
): Effect.Effect<WindowStateReadResult, WindowStateError, never> =>
  Effect.gen(function* () {
    const content = yield* Effect.tryPromise({
      try: () => readFile(path, "utf8"),
      catch: (error) => error
    }).pipe(
      Effect.catch((error) => {
        if (isNodeError(error) && error.code === "ENOENT") {
          return Effect.succeed(undefined)
        }

        return Effect.fail(new WindowStateReadFailed({ path, reason: formatUnknownError(error) }))
      })
    )

    if (content === undefined) {
      return { store: new WindowStateStore({ windows: {} }) }
    }

    return yield* decodeStore(content, path).pipe(
      Effect.map((store) => ({ store })),
      Effect.catchTag("WindowStateReadFailed", (error) =>
        renameCorruptFile(path, now, error.reason)
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
  Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: () => JSON.parse(content) as unknown,
      catch: (error) => new WindowStateReadFailed({ path, reason: formatUnknownError(error) })
    })

    return yield* Schema.decodeUnknownEffect(WindowStateStore)(parsed).pipe(
      Effect.mapError(
        (error) => new WindowStateReadFailed({ path, reason: formatUnknownError(error) })
      )
    )
  })

const writeStore = (
  path: string,
  store: WindowStateStore
): Effect.Effect<void, WindowStateWriteFailed, never> =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => mkdir(dirname(path), { recursive: true }),
      catch: (error) => new WindowStateWriteFailed({ path, reason: formatUnknownError(error) })
    })
    const tempPath = `${path}.tmp-${globalThis.crypto.randomUUID()}`
    const encoded = JSON.stringify(store, null, 2)
    yield* Effect.tryPromise({
      try: () => writeFile(tempPath, `${encoded}\n`, "utf8"),
      catch: (error) => new WindowStateWriteFailed({ path, reason: formatUnknownError(error) })
    })
    yield* Effect.tryPromise({
      try: () => rename(tempPath, path),
      catch: (error) => new WindowStateWriteFailed({ path, reason: formatUnknownError(error) })
    })
  })

const renameCorruptFile = (
  path: string,
  now: () => number,
  reason: string
): Effect.Effect<WindowStateReadResult, WindowStateCorruptRenamed, never> => {
  const corruptPath = corruptWindowStatePath(path, now())

  return Effect.tryPromise({
    try: () => rename(path, corruptPath),
    catch: (error) =>
      new WindowStateCorruptRenamed({
        path,
        corruptPath,
        reason: `${reason}; corrupt-file rename failed: ${formatUnknownError(error)}`
      })
  }).pipe(
    Effect.as({
      store: new WindowStateStore({ windows: {} }),
      event: new WindowStateEvent({
        kind: "corrupt-renamed",
        path,
        corruptPath,
        reason
      })
    })
  )
}

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

export const defaultWindowStatePath = (bundleId: string): string => {
  switch (process.platform) {
    case "darwin":
      return join(homeDirectory(), "Library", "Application Support", bundleId, "window-state.json")
    case "win32":
      return join(process.env["APPDATA"] ?? tmpdir(), bundleId, "window-state.json")
    default:
      return join(
        process.env["XDG_STATE_HOME"] ?? join(homeDirectory(), ".local", "state"),
        bundleId,
        "window-state.json"
      )
  }
}

const corruptWindowStatePath = (path: string, timestamp: number): string =>
  join(dirname(path), `window-state.corrupt.${timestamp}.json`)

const homeDirectory = (): string => process.env["HOME"] ?? tmpdir()

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  typeof error === "object" && error !== null && "code" in error

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
