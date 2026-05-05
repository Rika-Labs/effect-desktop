import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"

import { Context, Data, Effect, Layer, Option, Schema } from "effect"

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

export type WindowStateError =
  | WindowStateReadFailed
  | WindowStateWriteFailed
  | WindowStateCorruptRenamed

export interface WindowStateApi {
  readonly restore: (
    windowId: string
  ) => Effect.Effect<Option.Option<WindowStateRecord>, WindowStateError, never>
  readonly persist: (
    windowId: string,
    state: WindowStateRecord
  ) => Effect.Effect<void, WindowStateError, never>
}

export interface WindowStateOptions {
  readonly path?: string
  readonly bundleId?: string
  readonly now?: () => number
  readonly validateBounds?: (state: WindowStateRecord) => WindowStateRecord
}

export const makeWindowState = (
  options: WindowStateOptions = {}
): Effect.Effect<WindowStateApi, never, never> =>
  Effect.sync(() => {
    const path = options.path ?? defaultWindowStatePath(options.bundleId ?? "effect-desktop")
    const now = options.now ?? Date.now
    const validateBounds = options.validateBounds ?? ((state: WindowStateRecord) => state)

    return Object.freeze({
      restore: (windowId: string) =>
        Effect.gen(function* () {
          const store = yield* readStore(path, now)
          const record = store.windows[windowId]
          return record === undefined ? Option.none() : Option.some(validateBounds(record))
        }),
      persist: (windowId: string, state: WindowStateRecord) =>
        Effect.gen(function* () {
          const current = yield* readStore(path, now)
          const next = new WindowStateStore({
            windows: {
              ...current.windows,
              [windowId]: state
            }
          })

          yield* writeStore(path, next)
        })
    })
  })

export class WindowState extends Context.Service<WindowState, WindowStateApi>()("WindowState") {}

export const WindowStateLive = Layer.effect(WindowState)(makeWindowState())

const readStore = (
  path: string,
  now: () => number
): Effect.Effect<WindowStateStore, WindowStateError, never> =>
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
      return new WindowStateStore({ windows: {} })
    }

    return yield* decodeStore(content, path).pipe(
      Effect.catchTag("WindowStateReadFailed", (error) =>
        renameCorruptFile(path, now, error.reason)
      )
    )
  })

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
): Effect.Effect<WindowStateStore, WindowStateCorruptRenamed, never> => {
  const corruptPath = corruptWindowStatePath(path, now())

  return Effect.tryPromise({
    try: () => rename(path, corruptPath),
    catch: (error) =>
      new WindowStateCorruptRenamed({
        path,
        corruptPath,
        reason: `${reason}; corrupt-file rename failed: ${formatUnknownError(error)}`
      })
  }).pipe(Effect.as(new WindowStateStore({ windows: {} })))
}

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
