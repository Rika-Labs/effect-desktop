import { pathToFileURL } from "node:url"

import type { HostProtocolError, HostWindowClient, WindowCreateInput } from "@orika/bridge"
import { Config, ConfigProvider, Data, Effect, Exit, Layer, Option, Schema, Scope } from "effect"

import type { DesktopWindowRegistration, WindowSpec } from "./desktop-app.js"
import { ResourceOwner, type ResourceOwnerInvalidArgumentError } from "./resource-owner.js"
import { makeWindowContext, windowContextLayer, WindowContext } from "./window-context.js"

export const APP_MODULE_ENV = "EFFECT_DESKTOP_APP_MODULE"
export const APP_EXPORT_ENV = "EFFECT_DESKTOP_APP_EXPORT"
export const STARTUP_WINDOWS_ENV = "EFFECT_DESKTOP_STARTUP_WINDOWS"
export const WINDOW_SMOKE_TEST_ENV = "EFFECT_DESKTOP_WINDOW_SMOKE_TEST"
const DEFAULT_APP_EXPORT = "default"
const RESERVED_STARTUP_WINDOW_NAMES = new Set(["__proto__", "constructor", "prototype"])
const PositiveFiniteNumber = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0))
const WindowSpecSchema = Schema.Struct({
  title: Schema.NonEmptyString,
  width: Schema.optionalKey(PositiveFiniteNumber),
  height: Schema.optionalKey(PositiveFiniteNumber),
  renderer: Schema.optionalKey(Schema.String)
})
const StartupWindowsSchema = Schema.Record(Schema.String, WindowSpecSchema)
const StartupWindowsJsonSchema = Schema.fromJsonString(StartupWindowsSchema)
const DesktopWindowRegistrationSchema = Schema.Struct({
  id: Schema.String,
  spec: WindowSpecSchema
})
const DesktopAppDescriptorSchema = Schema.TaggedStruct("DesktopAppDescriptor", {
  windowRegistrations: Schema.Array(DesktopWindowRegistrationSchema)
})

type DecodedStartupWindows = Schema.Schema.Type<typeof StartupWindowsSchema>
type StartupEnvironmentSource = {
  readonly appModule: Option.Option<string>
  readonly appExport: string
  readonly startupWindows: Option.Option<string>
  readonly smokeTest: Option.Option<string>
}

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

export interface StartupEnvironmentConfig {
  readonly appModule: Option.Option<string>
  readonly appExport: string
  readonly startupWindows: ReadonlyArray<DesktopWindowRegistration<SupervisedWindowDeps>>
  readonly smokeTest: boolean
}

export const StartupEnvironmentConfigSource: Config.Config<StartupEnvironmentSource> = Config.all({
  appModule: Config.option(Config.string(APP_MODULE_ENV)).pipe(Config.map(trimmedOption)),
  appExport: Config.option(Config.string(APP_EXPORT_ENV)).pipe(
    Config.map(
      Option.match({
        onNone: () => DEFAULT_APP_EXPORT,
        onSome: (value) => {
          const trimmed = value.trim()
          return trimmed === "" ? DEFAULT_APP_EXPORT : trimmed
        }
      })
    )
  ),
  startupWindows: Config.option(Config.string(STARTUP_WINDOWS_ENV)),
  smokeTest: Config.option(Config.string(WINDOW_SMOKE_TEST_ENV))
})

export const readStartupEnvironment = (
  provider: ConfigProvider.ConfigProvider = ConfigProvider.fromEnv()
): Effect.Effect<StartupEnvironmentConfig, StartupWindowConfigError, never> =>
  StartupEnvironmentConfigSource.parse(provider).pipe(
    Effect.mapError(toStartupEnvironmentConfigError),
    Effect.flatMap((config) =>
      Effect.all({
        startupWindows: Option.isSome(config.appModule)
          ? Effect.succeed(
              Object.freeze([]) as ReadonlyArray<DesktopWindowRegistration<SupervisedWindowDeps>>
            )
          : Option.match(config.startupWindows, {
              onNone: () =>
                Effect.succeed(
                  Object.freeze([]) as ReadonlyArray<
                    DesktopWindowRegistration<SupervisedWindowDeps>
                  >
                ),
              onSome: decodeStartupWindowsJson
            }),
        smokeTest: decodeSmokeTest(config.smokeTest)
      }).pipe(
        Effect.map(({ smokeTest, startupWindows }) => ({
          appModule: config.appModule,
          appExport: config.appExport,
          startupWindows,
          smokeTest
        }))
      )
    )
  )

export const readStartupWindows = (
  config: StartupEnvironmentConfig
): Effect.Effect<
  ReadonlyArray<DesktopWindowRegistration<SupervisedWindowDeps>>,
  StartupWindowConfigError,
  never
> => {
  if (Option.isNone(config.appModule)) {
    return Effect.succeed(config.startupWindows)
  }

  const rawModule = config.appModule.value
  const exportName = config.appExport
  return Effect.tryPromise({
    try: () =>
      import(toStartupModuleSpecifier(rawModule)).then(
        (module: Record<string, unknown>) => module[exportName]
      ),
    catch: (error) =>
      new StartupWindowConfigError({
        env: APP_MODULE_ENV,
        message: `Invalid ${APP_MODULE_ENV}: ${formatUnknownError(error)}`
      })
  }).pipe(Effect.flatMap((app) => decodeDesktopAppDescriptor(app, exportName)))
}

export const requireStartupWindows = (
  registrations: ReadonlyArray<DesktopWindowRegistration<SupervisedWindowDeps>>,
  env = "startup environment"
): Effect.Effect<
  ReadonlyArray<DesktopWindowRegistration<SupervisedWindowDeps>>,
  StartupWindowConfigError,
  never
> => {
  if (registrations.length > 0) {
    return Effect.succeed(registrations)
  }

  return Effect.fail(
    new StartupWindowConfigError({
      env,
      message:
        "Invalid startup environment: at least one startup window must be declared with EFFECT_DESKTOP_APP_MODULE or EFFECT_DESKTOP_STARTUP_WINDOWS"
    })
  )
}

export type WindowSupervisorError = HostProtocolError | ResourceOwnerInvalidArgumentError

type SupervisedWindowDeps = ResourceOwner | WindowContext

export const openDeclaredWindows = (
  windows: HostWindowClient,
  registrations: ReadonlyArray<DesktopWindowRegistration<SupervisedWindowDeps>>,
  options: WindowSupervisorOptions = {}
): Effect.Effect<ReadonlyArray<OpenedDeclaredWindow>, WindowSupervisorError, Scope.Scope> =>
  Effect.gen(function* () {
    const outerScope = yield* Effect.scope
    return yield* Effect.forEach(registrations, (registration) =>
      openSingleWindow(windows, registration, outerScope, options)
    )
  })

const openSingleWindow = (
  windows: HostWindowClient,
  registration: DesktopWindowRegistration<SupervisedWindowDeps>,
  outerScope: Scope.Scope,
  options: WindowSupervisorOptions
): Effect.Effect<OpenedDeclaredWindow, WindowSupervisorError, Scope.Scope> =>
  Effect.gen(function* () {
    const windowScope = yield* Scope.fork(outerScope)
    const opened = yield* windows
      .create(toWindowCreateInput(registration.spec))
      .pipe(Effect.tapError(() => Scope.close(windowScope, Exit.interrupt())))

    if (registration.services !== undefined) {
      const windowContext = windowContextLayer(
        makeWindowContext({
          registrationId: registration.id,
          hostWindowId: opened.windowId
        })
      )
      const resourceOwner = ResourceOwner.window({
        registrationId: registration.id,
        hostWindowId: opened.windowId
      })
      const services: Layer.Layer<never, ResourceOwnerInvalidArgumentError, Scope.Scope> =
        Layer.provide(registration.services, Layer.merge(windowContext, resourceOwner))
      yield* Layer.buildWithScope(services, windowScope).pipe(
        Effect.tapError(() => closeWindowAndScope(windows, windowScope, opened.windowId))
      )
    }

    yield* Scope.addFinalizer(windowScope, windows.destroy(opened.windowId).pipe(Effect.ignore))

    if (options.smokeTest === true) {
      yield* Scope.close(windowScope, Exit.succeed(undefined))
    }

    return {
      name: registration.id,
      windowId: opened.windowId,
      spec: registration.spec
    } as const
  })

const closeWindowAndScope = (
  windows: HostWindowClient,
  scope: Scope.Scope,
  windowId: string
): Effect.Effect<void, never, never> =>
  windows.destroy(windowId).pipe(
    Effect.ignore,
    Effect.flatMap(() => Scope.close(scope, Exit.interrupt()))
  )

const recordToRegistrations = (
  windows: Readonly<Record<string, WindowSpec>>
): ReadonlyArray<DesktopWindowRegistration<SupervisedWindowDeps>> =>
  Object.freeze(
    Object.entries(windows).map(([id, spec]) =>
      Object.freeze({
        _tag: "DesktopWindowRegistration",
        id,
        spec,
        services: undefined
      } satisfies DesktopWindowRegistration<SupervisedWindowDeps>)
    )
  )

export const toWindowCreateInput = (spec: WindowSpec): WindowCreateInput => {
  const input: {
    title?: string
    width?: number
    height?: number
    renderer?: string
  } = {
    title: spec.title
  }

  if (spec.width !== undefined) {
    input.width = spec.width
  }
  if (spec.height !== undefined) {
    input.height = spec.height
  }
  if (spec.renderer !== undefined) {
    input.renderer = spec.renderer
  }

  return input
}

const decodeStartupWindowsJson = (
  value: string
): Effect.Effect<
  ReadonlyArray<DesktopWindowRegistration<SupervisedWindowDeps>>,
  StartupWindowConfigError,
  never
> => {
  if (value.trim() === "") {
    return Effect.succeed(Object.freeze([]))
  }

  return Schema.decodeUnknownEffect(StartupWindowsJsonSchema)(value).pipe(
    Effect.mapError(
      (error) =>
        new StartupWindowConfigError({
          env: STARTUP_WINDOWS_ENV,
          message: `Invalid ${STARTUP_WINDOWS_ENV}: ${formatUnknownError(error)}`
        })
    ),
    Effect.flatMap((windows) => validateWindowNames(windows, STARTUP_WINDOWS_ENV)),
    Effect.map(recordToRegistrations)
  )
}

const decodeDesktopAppDescriptor = (
  value: unknown,
  exportName: string
): Effect.Effect<
  ReadonlyArray<DesktopWindowRegistration<SupervisedWindowDeps>>,
  StartupWindowConfigError,
  never
> =>
  Schema.decodeUnknownEffect(DesktopAppDescriptorSchema)(value).pipe(
    Effect.mapError(
      (error) =>
        new StartupWindowConfigError({
          env: APP_MODULE_ENV,
          message: `Invalid ${APP_MODULE_ENV}: export "${exportName}" is not a Desktop app config: ${formatUnknownError(error)}`
        })
    ),
    Effect.flatMap((app) =>
      validateWindowNames(
        Object.fromEntries(app.windowRegistrations.map((reg) => [reg.id, reg.spec])),
        APP_MODULE_ENV
      ).pipe(Effect.map(() => projectRegistrationsWithServices(value, app.windowRegistrations)))
    )
  )

const projectRegistrationsWithServices = (
  rawDescriptor: unknown,
  validated: ReadonlyArray<{ readonly id: string; readonly spec: WindowSpec }>
): ReadonlyArray<DesktopWindowRegistration<SupervisedWindowDeps>> => {
  const raw =
    (rawDescriptor as { windowRegistrations?: ReadonlyArray<{ services?: unknown }> })
      .windowRegistrations ?? []
  return Object.freeze(
    validated.map((reg, index) =>
      Object.freeze({
        _tag: "DesktopWindowRegistration",
        id: reg.id,
        spec: Object.freeze({ ...reg.spec }),
        services: (raw[index]?.services ??
          undefined) as DesktopWindowRegistration<SupervisedWindowDeps>["services"]
      } satisfies DesktopWindowRegistration<SupervisedWindowDeps>)
    )
  )
}

const decodeSmokeTest = (
  value: Option.Option<string>
): Effect.Effect<boolean, StartupWindowConfigError, never> =>
  Option.match(value, {
    onNone: () => Effect.succeed(false),
    onSome: (raw) =>
      Schema.decodeUnknownEffect(Config.Boolean)(raw).pipe(
        Effect.mapError(
          (error) =>
            new StartupWindowConfigError({
              env: WINDOW_SMOKE_TEST_ENV,
              message: `Invalid ${WINDOW_SMOKE_TEST_ENV}: ${formatUnknownError(error)}`
            })
        )
      )
  })

const validateWindowNames = (
  windows: DecodedStartupWindows,
  env: string
): Effect.Effect<Readonly<Record<string, WindowSpec>>, StartupWindowConfigError, never> => {
  const entries: Array<readonly [string, WindowSpec]> = []
  for (const [name, spec] of Object.entries(windows)) {
    if (!isSafeStartupWindowName(name)) {
      return invalidStartupWindows(env, `reserved window name "${name}" is not allowed`)
    }
    entries.push([name, Object.freeze({ ...spec })])
  }

  return Effect.succeed(Object.freeze(Object.fromEntries(entries)))
}

const invalidStartupWindows = (
  env: string,
  reason: string
): Effect.Effect<never, StartupWindowConfigError, never> =>
  Effect.fail(
    new StartupWindowConfigError({
      env,
      message: `Invalid ${env}: ${reason}`
    })
  )

const toStartupEnvironmentConfigError = (error: Config.ConfigError): StartupWindowConfigError =>
  new StartupWindowConfigError({
    env: "startup environment",
    message: `Invalid startup environment: ${formatUnknownError(error)}`
  })

export const isSafeStartupWindowName = (name: string): boolean =>
  name.length > 0 && !RESERVED_STARTUP_WINDOW_NAMES.has(name)

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function trimmedOption(option: Option.Option<string>): Option.Option<string> {
  return Option.flatMap(option, (value) => {
    const trimmed = value.trim()
    return trimmed === "" ? Option.none() : Option.some(trimmed)
  })
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

const isAbsolutePathSegment = (value: string): boolean =>
  value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\")

const isFilesystemPath = (value: string): boolean =>
  value === "." ||
  value === ".." ||
  value.startsWith("./") ||
  value.startsWith("../") ||
  isAbsolutePathSegment(value)

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
