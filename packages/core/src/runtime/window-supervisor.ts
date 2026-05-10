import type {
  HostProtocolError,
  HostWindowClient,
  WindowCreateInput
} from "@effect-desktop/bridge"
import { Data, Effect } from "effect"

import type { WindowSpec } from "./desktop-app.js"

export const STARTUP_WINDOWS_ENV = "EFFECT_DESKTOP_STARTUP_WINDOWS"

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

  const windows: Record<string, WindowSpec> = {}
  for (const [name, spec] of Object.entries(value)) {
    const validated = validateWindowSpec(name, spec)
    if (validated._tag === "Failure") {
      return Effect.fail(validated.error)
    }
    windows[name] = validated.value
  }

  return Effect.succeed(Object.freeze(windows))
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

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
