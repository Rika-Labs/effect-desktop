import path from "node:path"
import { pathToFileURL } from "node:url"

import type { HostProtocolError, HostWindowClient, WindowCreateInput } from "@effect-desktop/bridge"
import { Data, Effect } from "effect"

import type { DesktopAppDefinition, WindowSpec } from "./desktop-app.js"

export const APP_MODULE_ENV = "EFFECT_DESKTOP_APP_MODULE"
export const APP_EXPORT_ENV = "EFFECT_DESKTOP_APP_EXPORT"
export const STARTUP_WINDOWS_ENV = "EFFECT_DESKTOP_STARTUP_WINDOWS"
const DEFAULT_APP_EXPORT = "default"
const RESERVED_WINDOW_NAMES = new Set(["__proto__", "constructor", "prototype"])

export interface OpenedDeclaredWindow {
  readonly name: string
  readonly windowId: string
  readonly spec: WindowSpec
}

export interface WindowSupervisorOptions {
  readonly smokeTest?: boolean
}

export class StartupWindowConfigError extends Data.TaggedError("StartupWindowConfigError")<{
  readonly message: string
  readonly env: string
}> {}

type WindowSpecValidation =
  | { readonly _tag: "Success"; readonly value: WindowSpec }
  | { readonly _tag: "Failure"; readonly error: StartupWindowConfigError }

export const readStartupWindowsEnv = (
  env: Readonly<Record<string, string | undefined>>
): Effect.Effect<Readonly<Record<string, WindowSpec>>, StartupWindowConfigError, never> => {
  const raw = env[STARTUP_WINDOWS_ENV]
  if (raw === undefined || raw.trim() === "") {
    return Effect.succeed(Object.freeze({}))
  }

  return Effect.try({
    try: () => JSON.parse(raw) as unknown,
    catch: (error) =>
      new StartupWindowConfigError({
        env: STARTUP_WINDOWS_ENV,
        message: `Invalid ${STARTUP_WINDOWS_ENV}: ${formatUnknownError(error)}`
      })
  }).pipe(Effect.flatMap(validateStartupWindows))
}

export const readStartupWindows = (
  env: Readonly<Record<string, string | undefined>>
): Effect.Effect<Readonly<Record<string, WindowSpec>>, StartupWindowConfigError, never> => {
  const rawModule = env[APP_MODULE_ENV]
  if (rawModule === undefined || rawModule.trim() === "") {
    return readStartupWindowsEnv(env)
  }

  const exportName = normalizedAppExport(env)
  return Effect.tryPromise({
    try: async () => {
      const module = (await import(toStartupModuleSpecifier(rawModule))) as Readonly<
        Record<string, unknown>
      >
      const app = module[exportName]
      if (!isDesktopAppDefinition(app)) {
        throw new Error(`export "${exportName}" is not a Desktop app definition`)
      }
      return app.windows
    },
    catch: (error) =>
      new StartupWindowConfigError({
        env: APP_MODULE_ENV,
        message: `Invalid ${APP_MODULE_ENV}: ${formatUnknownError(error)}`
      })
  }).pipe(Effect.flatMap(validateStartupWindows))
}

export const openDeclaredWindows = (
  windows: HostWindowClient,
  declared: Readonly<Record<string, WindowSpec>>,
  options: WindowSupervisorOptions = {}
): Effect.Effect<ReadonlyArray<OpenedDeclaredWindow>, HostProtocolError, never> =>
  Effect.forEach(Object.entries(declared), ([name, spec]) =>
    Effect.gen(function* () {
      const opened = yield* windows.create(toWindowCreateInput(spec))
      if (options.smokeTest === true) {
        yield* windows.destroy(opened.windowId)
      }
      return {
        name,
        windowId: opened.windowId,
        spec
      } as const
    })
  )

export const toWindowCreateInput = (spec: WindowSpec): WindowCreateInput => {
  const input: {
    title?: string
    width?: number
    height?: number
  } = {
    title: spec.title
  }

  if (spec.width !== undefined) {
    input.width = spec.width
  }
  if (spec.height !== undefined) {
    input.height = spec.height
  }

  return input
}

const validateStartupWindows = (
  value: unknown
): Effect.Effect<Readonly<Record<string, WindowSpec>>, StartupWindowConfigError, never> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalidStartupWindows("expected a JSON object keyed by window name")
  }

  const windows: Array<readonly [string, WindowSpec]> = []
  for (const [name, spec] of Object.entries(value)) {
    if (!isSafeWindowName(name)) {
      return invalidStartupWindows(`reserved window name "${name}" is not allowed`)
    }

    const validated = validateWindowSpec(name, spec)
    if (validated._tag === "Failure") {
      return Effect.fail(validated.error)
    }
    windows.push([name, validated.value])
  }

  return Effect.succeed(Object.freeze(Object.fromEntries(windows)))
}

const validateWindowSpec = (name: string, value: unknown): WindowSpecValidation => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return validationFailure(makeInvalidWindow(name, "expected an object"))
  }

  const record = value as Readonly<Record<string, unknown>>
  const title = record["title"]
  if (typeof title !== "string" || title.length === 0) {
    return validationFailure(makeInvalidWindow(name, "title must be a non-empty string"))
  }

  const spec: {
    title: string
    width?: number
    height?: number
    renderer?: string
  } = { title }

  const width = record["width"]
  if (width !== undefined) {
    if (!isPositiveFiniteNumber(width)) {
      return validationFailure(makeInvalidWindow(name, "width must be a positive finite number"))
    }
    spec.width = width
  }

  const height = record["height"]
  if (height !== undefined) {
    if (!isPositiveFiniteNumber(height)) {
      return validationFailure(makeInvalidWindow(name, "height must be a positive finite number"))
    }
    spec.height = height
  }

  const renderer = record["renderer"]
  if (renderer !== undefined) {
    if (typeof renderer !== "string") {
      return validationFailure(makeInvalidWindow(name, "renderer must be a string"))
    }
    spec.renderer = renderer
  }

  return { _tag: "Success", value: Object.freeze(spec) }
}

const invalidStartupWindows = (
  reason: string
): Effect.Effect<never, StartupWindowConfigError, never> =>
  Effect.fail(
    new StartupWindowConfigError({
      env: STARTUP_WINDOWS_ENV,
      message: `Invalid ${STARTUP_WINDOWS_ENV}: ${reason}`
    })
  )

const makeInvalidWindow = (name: string, reason: string): StartupWindowConfigError =>
  new StartupWindowConfigError({
    env: STARTUP_WINDOWS_ENV,
    message: `Invalid ${STARTUP_WINDOWS_ENV} entry "${name}": ${reason}`
  })

const validationFailure = (error: StartupWindowConfigError): WindowSpecValidation => ({
  _tag: "Failure",
  error
})

const isPositiveFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0

const isSafeWindowName = (name: string): boolean =>
  name.length > 0 && !RESERVED_WINDOW_NAMES.has(name)

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

const normalizedAppExport = (env: Readonly<Record<string, string | undefined>>): string => {
  const exportName = env[APP_EXPORT_ENV]
  if (exportName === undefined || exportName.trim() === "") {
    return DEFAULT_APP_EXPORT
  }
  return exportName.trim()
}

export const toStartupModuleSpecifier = (raw: string): string => {
  const value = raw.trim()
  if (value === "") {
    throw new Error(`${APP_MODULE_ENV} must not be empty`)
  }
  if (isWindowsDrivePath(value)) {
    return windowsDrivePathToFileUrl(value)
  }
  if (isWindowsUncPath(value)) {
    return windowsUncPathToFileUrl(value)
  }

  const parsedUrl = parseUrl(value)
  if (parsedUrl !== undefined) {
    if (parsedUrl.protocol !== "file:") {
      throw new Error(`${APP_MODULE_ENV} only accepts file URLs, file paths, or package specifiers`)
    }
    return value
  }

  if (isFilesystemPath(value)) {
    return pathToFileURL(value).href
  }

  return value
}

const parseUrl = (value: string): URL | undefined => {
  try {
    return new URL(value)
  } catch {
    return undefined
  }
}

const isFilesystemPath = (value: string): boolean =>
  value === "." ||
  value === ".." ||
  value.startsWith("./") ||
  value.startsWith("../") ||
  value.startsWith("/") ||
  path.isAbsolute(value)

const isWindowsDrivePath = (value: string): boolean => /^[a-zA-Z]:[\\/]/.test(value)

const isWindowsUncPath = (value: string): boolean => /^\\\\[^\\]+\\[^\\]+/.test(value)

const windowsDrivePathToFileUrl = (value: string): string => {
  const [drive, ...segments] = value.replace(/\\/g, "/").split("/")
  return `file:///${drive}/${encodePathSegments(segments)}`
}

const windowsUncPathToFileUrl = (value: string): string => {
  const [host, ...segments] = value.slice(2).replace(/\\/g, "/").split("/")
  return `file://${host}/${encodePathSegments(segments)}`
}

const encodePathSegments = (segments: ReadonlyArray<string>): string =>
  segments.map((segment) => encodeURIComponent(segment)).join("/")

const isDesktopAppDefinition = (value: unknown): value is DesktopAppDefinition<unknown, unknown> =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  (value as { readonly _tag?: unknown })._tag === "DesktopAppDefinition" &&
  "windows" in value &&
  typeof (value as { readonly windows?: unknown }).windows === "object" &&
  (value as { readonly windows?: unknown }).windows !== null
