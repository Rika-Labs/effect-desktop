import { expect, test } from "bun:test"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"
import { BunServices } from "@effect/platform-bun"
import { WindowBoundsPayload, type HostWindowClient, type WindowCreateInput } from "@orika/bridge"
import { Cause, ConfigProvider, Effect, Exit, Layer, ManagedRuntime, Schema, Stream } from "effect"
import * as FileSystem from "effect/FileSystem"
import * as Path from "effect/Path"

import { ResourceOwner } from "./resource-owner.js"
import { WindowContext } from "./window-context.js"
import {
  APP_EXPORT_ENV,
  APP_MODULE_ENV,
  STARTUP_WINDOWS_ENV,
  StartupWindowConfigError,
  WINDOW_SMOKE_TEST_ENV,
  openDeclaredWindows,
  readStartupEnvironment,
  readStartupWindows,
  requireStartupWindows,
  toStartupModuleSpecifier
} from "./window-supervisor.js"

const encodeUnknownJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))

test("startup environment empty window lists do not assert registration arrays", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const source = yield* Effect.promise(() =>
        Bun.file(new URL("./window-supervisor.ts", import.meta.url)).text()
      )

      expect(source).not.toContain("Object.freeze([]) as ReadonlyArray<")
    })
  ))

test("startup environment imported app services projection does not assert service shape", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const source = yield* Effect.promise(() =>
        Bun.file(new URL("./window-supervisor.ts", import.meta.url)).text()
      )

      expect(source).not.toContain('as DesktopWindowRegistration<SupervisedWindowDeps>["services"]')
      expect(source).not.toContain("rawDescriptor as")
    })
  ))

const runScoped = <A, E, R, LE>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, LE, never>
): Effect.Effect<A, E | LE, never> =>
  Effect.gen(function* () {
    const runtime = ManagedRuntime.make(layer)
    const exit = yield* Effect.promise(() => runtime.runPromiseExit(effect))
    yield* Effect.promise(() => runtime.dispose())
    return yield* exit
  })

const withTempDirectory = <A, E, R>(
  prefix: string,
  body: (dir: string) => Effect.Effect<A, E, R>
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const directory = yield* fs
      .makeTempDirectory({ prefix, directory: tmpdir() })
      .pipe(Effect.orDie)
    const exit = yield* Effect.exit(body(directory))
    yield* fs.remove(directory, { recursive: true, force: true }).pipe(Effect.orDie)
    return yield* exit
  })

test("openDeclaredWindows opens declared windows and smoke-test destroys them", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const created: WindowCreateInput[] = []
      const destroyed: string[] = []
      const client = makeHostWindowClient({
        create: (input = {}) =>
          Effect.sync(() => {
            created.push(input)
            return { windowId: `window-${created.length}` }
          }),
        destroy: (windowId) =>
          Effect.sync(() => {
            destroyed.push(windowId)
          })
      })

      const opened = yield* Effect.scoped(
        openDeclaredWindows(
          client,
          [
            {
              _tag: "DesktopWindowRegistration",
              id: "main",
              spec: { title: "Notes", width: 960, height: 640, renderer: "/" },
              services: undefined
            },
            {
              _tag: "DesktopWindowRegistration",
              id: "prefs",
              spec: { title: "Preferences" },
              services: undefined
            }
          ],
          { smokeTest: true }
        )
      )

      expect(created).toEqual([
        {
          title: "Notes",
          width: 960,
          height: 640,
          renderer: "/"
        },
        {
          title: "Preferences"
        }
      ])
      expect(opened.map((window) => [window.name, window.windowId])).toEqual([
        ["main", "window-1"],
        ["prefs", "window-2"]
      ])
      expect(destroyed).toEqual(["window-1", "window-2"])
    })
  ))

test("openDeclaredWindows binds each window's services Layer to that window's scope", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const created: WindowCreateInput[] = []
      const destroyed: string[] = []
      const events: string[] = []
      const contexts: Array<{
        readonly registrationId: string
        readonly hostWindowId: string
        readonly ownerScope: string
      }> = []
      const client = makeHostWindowClient({
        create: (input = {}) =>
          Effect.sync(() => {
            created.push(input)
            return { windowId: `window-${created.length}` }
          }),
        destroy: (windowId) =>
          Effect.sync(() => {
            destroyed.push(windowId)
          })
      })

      const mainServices = Layer.effectDiscard(
        Effect.gen(function* () {
          const context = yield* WindowContext
          const owner = yield* ResourceOwner
          return yield* Effect.acquireRelease(
            Effect.sync(() => {
              contexts.push({
                registrationId: context.registrationId,
                hostWindowId: context.hostWindowId,
                ownerScope: owner.scopeId
              })
              events.push("main:acquired")
            }),
            () =>
              Effect.sync(() => {
                events.push("main:released")
              })
          )
        })
      )

      const prefsServices = Layer.effectDiscard(
        Effect.gen(function* () {
          const context = yield* WindowContext
          const owner = yield* ResourceOwner
          return yield* Effect.sync(() => {
            contexts.push({
              registrationId: context.registrationId,
              hostWindowId: context.hostWindowId,
              ownerScope: owner.scopeId
            })
            events.push("prefs:acquired")
          })
        })
      )

      yield* Effect.scoped(
        openDeclaredWindows(client, [
          {
            _tag: "DesktopWindowRegistration",
            id: "main",
            spec: { title: "Main" },
            services: mainServices
          },
          {
            _tag: "DesktopWindowRegistration",
            id: "prefs",
            spec: { title: "Preferences" },
            services: prefsServices
          }
        ])
      )

      expect(events).toEqual(["main:acquired", "prefs:acquired", "main:released"])
      expect(contexts).toEqual([
        {
          registrationId: "main",
          hostWindowId: "window-1",
          ownerScope: "window:window-1"
        },
        {
          registrationId: "prefs",
          hostWindowId: "window-2",
          ownerScope: "window:window-2"
        }
      ])
      expect(destroyed).toEqual(["window-2", "window-1"])
    })
  ))

test("openDeclaredWindows tears down a window when its services Layer fails to build", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const destroyed: string[] = []
      const released: string[] = []
      const client = makeHostWindowClient({
        create: () => Effect.succeed({ windowId: "window-1" }),
        destroy: (windowId) =>
          Effect.sync(() => {
            destroyed.push(windowId)
          })
      })

      class ServicesBuildFailure extends Schema.TaggedErrorClass<ServicesBuildFailure>()(
        "ServicesBuildFailure",
        {}
      ) {}

      const failingServices = Layer.effectDiscard(
        Effect.acquireRelease(Effect.fail(new ServicesBuildFailure() as never), () =>
          Effect.sync(() => {
            released.push("released")
          })
        )
      )

      const exit = yield* Effect.exit(
        Effect.scoped(
          openDeclaredWindows(client, [
            {
              _tag: "DesktopWindowRegistration",
              id: "main",
              spec: { title: "Main" },
              services: failingServices
            }
          ])
        )
      )

      expect(Exit.isFailure(exit)).toBe(true)
      expect(destroyed).toEqual(["window-1"])
    })
  ))

test("startup environment decodes declared window specs through Effect Config and Schema", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const config = yield* readStartupEnvironment(
        provider({
          [WINDOW_SMOKE_TEST_ENV]: "yes",
          [STARTUP_WINDOWS_ENV]: encodeUnknownJson({
            main: {
              title: "Terminal",
              width: 1024,
              height: 768,
              renderer: "/terminal"
            }
          })
        })
      )
      const windows = yield* readStartupWindows(config)

      expect(config.smokeTest).toBe(true)
      expect(windows).toEqual([
        {
          _tag: "DesktopWindowRegistration",
          id: "main",
          spec: {
            title: "Terminal",
            width: 1024,
            height: 768,
            renderer: "/terminal"
          },
          services: undefined
        }
      ])
    })
  ))

test("startup environment treats missing and blank startup windows as empty declarations", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const missing = yield* readStartupEnvironment(provider({}))
      const blank = yield* readStartupEnvironment(provider({ [STARTUP_WINDOWS_ENV]: "   " }))

      expect(yield* readStartupWindows(missing)).toEqual([])
      expect(yield* readStartupWindows(blank)).toEqual([])
    })
  ))

test("startup environment requires at least one declared startup window before launch", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const config = yield* readStartupEnvironment(provider({}))
      const windows = yield* readStartupWindows(config)
      const exit = yield* Effect.exit(requireStartupWindows(windows))

      const error = getFailure(exit)
      expect(error).toBeInstanceOf(StartupWindowConfigError)
      expect(error?.message).toContain("at least one startup window must be declared")
      expect(error?.message).toContain(APP_MODULE_ENV)
      expect(error?.message).toContain(STARTUP_WINDOWS_ENV)
    })
  ))

test("startup environment rejects invalid declared window specs with a typed error", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        readStartupEnvironment(
          provider({
            [STARTUP_WINDOWS_ENV]: encodeUnknownJson({
              main: {
                title: "",
                width: -1
              }
            })
          })
        )
      )

      const error = getFailure(exit)
      expect(error).toBeInstanceOf(StartupWindowConfigError)
      expect(error?.message).toContain(STARTUP_WINDOWS_ENV)
    })
  ))

test("startup environment rejects invalid JSON with a typed error", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        readStartupEnvironment(provider({ [STARTUP_WINDOWS_ENV]: "not-json" }))
      )

      const error = getFailure(exit)
      expect(error).toBeInstanceOf(StartupWindowConfigError)
      expect(error?.message).toContain(STARTUP_WINDOWS_ENV)
    })
  ))

test("startup environment rejects reserved object names before building the windows map", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        readStartupEnvironment(
          provider({ [STARTUP_WINDOWS_ENV]: '{"__proto__":{"title":"Polluted"}}' })
        )
      )

      const error = getFailure(exit)
      expect(error).toBeInstanceOf(StartupWindowConfigError)
      expect(error?.message).toContain("reserved window name")
      expect("title" in {}).toBe(false)
    })
  ))

test("startup environment rejects empty window names", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        readStartupEnvironment(
          provider({
            [STARTUP_WINDOWS_ENV]: encodeUnknownJson({
              "": {
                title: "Untitled"
              }
            })
          })
        )
      )

      const error = getFailure(exit)
      expect(error).toBeInstanceOf(StartupWindowConfigError)
      expect(error?.message).toContain("reserved window name")
    })
  ))

test("startup environment decodes module exports and gives app modules precedence", () =>
  Effect.runPromise(
    runScoped(
      withTempDirectory("effect-desktop-startup-", (directory) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const path = yield* Path.Path
          const modulePath = path.join(directory, "app.ts")
          yield* fs
            .writeFileString(
              modulePath,
              [
                "export const named = {",
                '  _tag: "DesktopAppDescriptor",',
                "  windowRegistrations: [",
                '    { id: "module", spec: { title: "Module", width: 800 } }',
                "  ]",
                "}"
              ].join("\n")
            )
            .pipe(Effect.orDie)

          const config = yield* readStartupEnvironment(
            provider({
              [APP_MODULE_ENV]: pathToFileURL(modulePath).href,
              [APP_EXPORT_ENV]: "named",
              [STARTUP_WINDOWS_ENV]: "not-json"
            })
          )
          const windows = yield* readStartupWindows(config)

          expect(windows).toEqual([
            {
              _tag: "DesktopWindowRegistration",
              id: "module",
              spec: { title: "Module", width: 800 },
              services: undefined
            }
          ])
        })
      ),
      BunServices.layer
    )
  ))

test("startup environment preserves imported app window services", () =>
  Effect.runPromise(
    runScoped(
      withTempDirectory("effect-desktop-startup-services-", (directory) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const path = yield* Path.Path
          const modulePath = path.join(directory, "app.mjs")
          const layerKey = "__effectDesktopWindowSupervisorServiceLayer"
          const events: string[] = []
          Object.defineProperty(globalThis, layerKey, {
            configurable: true,
            value: Layer.effectDiscard(
              Effect.sync(() => {
                events.push("module:acquired")
              })
            )
          })

          try {
            yield* fs
              .writeFileString(
                modulePath,
                [
                  "export default {",
                  '  _tag: "DesktopAppDescriptor",',
                  "  windowRegistrations: [",
                  "    {",
                  '      id: "module",',
                  '      spec: { title: "Module" },',
                  `      services: globalThis.${layerKey}`,
                  "    }",
                  "  ]",
                  "}"
                ].join("\n")
              )
              .pipe(Effect.orDie)

            const config = yield* readStartupEnvironment(
              provider({ [APP_MODULE_ENV]: pathToFileURL(modulePath).href })
            )
            const windows = yield* readStartupWindows(config)
            expect(Layer.isLayer(windows[0]?.services)).toBe(true)

            yield* Effect.scoped(
              openDeclaredWindows(makeHostWindowClient(), windows, { smokeTest: true })
            )
            expect(events).toEqual(["module:acquired"])
          } finally {
            Reflect.deleteProperty(globalThis, layerKey)
          }
        })
      ),
      BunServices.layer
    )
  ))

test("startup environment rejects imported app window services that are not Layers", () =>
  Effect.runPromise(
    runScoped(
      withTempDirectory("effect-desktop-startup-invalid-services-", (directory) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const path = yield* Path.Path
          const modulePath = path.join(directory, "app.mjs")
          yield* fs
            .writeFileString(
              modulePath,
              [
                "export default {",
                '  _tag: "DesktopAppDescriptor",',
                "  windowRegistrations: [",
                '    { id: "module", spec: { title: "Module" }, services: "not-a-layer" }',
                "  ]",
                "}"
              ].join("\n")
            )
            .pipe(Effect.orDie)

          const config = yield* readStartupEnvironment(
            provider({ [APP_MODULE_ENV]: pathToFileURL(modulePath).href })
          )
          const exit = yield* Effect.exit(readStartupWindows(config))

          const error = getFailure(exit)
          expect(error).toBeInstanceOf(StartupWindowConfigError)
          expect(error?.message).toContain("services")
        })
      ),
      BunServices.layer
    )
  ))

test("startup environment defaults blank module export to default", () =>
  Effect.runPromise(
    runScoped(
      withTempDirectory("effect-desktop-startup-default-", (directory) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const path = yield* Path.Path
          const modulePath = path.join(directory, "app.ts")
          yield* fs
            .writeFileString(
              modulePath,
              [
                "export default {",
                '  _tag: "DesktopAppDescriptor",',
                "  windowRegistrations: [",
                '    { id: "main", spec: { title: "Default Export" } }',
                "  ]",
                "}"
              ].join("\n")
            )
            .pipe(Effect.orDie)

          const config = yield* readStartupEnvironment(
            provider({
              [APP_MODULE_ENV]: pathToFileURL(modulePath).href,
              [APP_EXPORT_ENV]: "   "
            })
          )
          const windows = yield* readStartupWindows(config)

          expect(windows).toEqual([
            {
              _tag: "DesktopWindowRegistration",
              id: "main",
              spec: { title: "Default Export" },
              services: undefined
            }
          ])
        })
      ),
      BunServices.layer
    )
  ))

test("startup environment rejects non-file URL app modules with a typed error", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const config = yield* readStartupEnvironment(
        provider({ [APP_MODULE_ENV]: "data:text/javascript,export default {}" })
      )
      const exit = yield* Effect.exit(readStartupWindows(config))

      const error = getFailure(exit)
      expect(error).toBeInstanceOf(StartupWindowConfigError)
      expect(error?.message).toContain("only accepts file URLs")
    })
  ))

test("startup environment rejects missing or invalid app exports with a typed error", () =>
  Effect.runPromise(
    runScoped(
      withTempDirectory("effect-desktop-startup-invalid-", (directory) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const path = yield* Path.Path
          const modulePath = path.join(directory, "app.ts")
          yield* fs.writeFileString(modulePath, "export const wrong = {}").pipe(Effect.orDie)

          const config = yield* readStartupEnvironment(
            provider({ [APP_MODULE_ENV]: pathToFileURL(modulePath).href })
          )
          const innerExit = yield* Effect.exit(readStartupWindows(config))

          const error = getFailure(innerExit)
          expect(error).toBeInstanceOf(StartupWindowConfigError)
          expect(error?.message).toContain(APP_MODULE_ENV)
        })
      ),
      BunServices.layer
    )
  ))

test("startup environment uses Effect Config boolean parsing for smoke-test mode", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const enabled = yield* readStartupEnvironment(provider({ [WINDOW_SMOKE_TEST_ENV]: "on" }))
      const disabled = yield* readStartupEnvironment(provider({ [WINDOW_SMOKE_TEST_ENV]: "off" }))
      const invalid = yield* Effect.exit(
        readStartupEnvironment(provider({ [WINDOW_SMOKE_TEST_ENV]: "sometimes" }))
      )

      expect(enabled.smokeTest).toBe(true)
      expect(disabled.smokeTest).toBe(false)
      expect(invalid.pipe(getFailure)).toBeInstanceOf(StartupWindowConfigError)
    })
  ))

test("toStartupModuleSpecifier classifies paths, package specifiers, and URL schemes explicitly", () => {
  expect(toStartupModuleSpecifier("C:\\app\\main.ts")).toBe("file:///C:/app/main.ts")
  expect(toStartupModuleSpecifier("\\\\server\\share\\main.ts")).toBe("file://server/share/main.ts")
  expect(toStartupModuleSpecifier("C:\\app\\release#1\\spine?.ts")).toBe(
    "file:///C:/app/release%231/spine%3F.ts"
  )
  expect(toStartupModuleSpecifier("\\\\server\\share\\release#1\\spine?.ts")).toBe(
    "file://server/share/release%231/spine%3F.ts"
  )
  expect(toStartupModuleSpecifier("@scope/pkg/spine")).toBe("@scope/pkg/spine")
  expect(toStartupModuleSpecifier("pkg/spine")).toBe("pkg/spine")
  expect(toStartupModuleSpecifier("file:///app/main.js")).toBe("file:///app/main.js")
  expect(() => toStartupModuleSpecifier("data:text/javascript,export default {}")).toThrow(
    "only accepts file URLs"
  )
})

const provider = (env: Readonly<Record<string, string>>): ConfigProvider.ConfigProvider =>
  ConfigProvider.fromEnv({ env })

const makeHostWindowClient = (overrides: Partial<HostWindowClient> = {}): HostWindowClient => ({
  create: () => Effect.succeed({ windowId: "window-1" }),
  show: () => Effect.void,
  hide: () => Effect.void,
  focus: () => Effect.void,
  getCurrent: () => Effect.succeed({ windowId: "window-1" }),
  getById: (windowId) => Effect.succeed({ windowId }),
  list: () => Effect.succeed({ windows: [{ windowId: "window-1" }] }),
  getParent: () => Effect.succeed({}),
  getChildren: () => Effect.succeed({ windows: [] }),
  getBounds: () => Effect.succeed(new WindowBoundsPayload({ x: 0, y: 0, width: 800, height: 600 })),
  setBounds: () => Effect.succeed(new WindowBoundsPayload({ x: 0, y: 0, width: 800, height: 600 })),
  setBoundsOnDisplay: () =>
    Effect.succeed(new WindowBoundsPayload({ x: 0, y: 0, width: 800, height: 600 })),
  center: () => Effect.succeed(new WindowBoundsPayload({ x: 0, y: 0, width: 800, height: 600 })),
  centerOnDisplay: () =>
    Effect.succeed(new WindowBoundsPayload({ x: 0, y: 0, width: 800, height: 600 })),
  setTitle: () => Effect.void,
  setResizable: () => Effect.void,
  setDecorations: () => Effect.void,
  setTrafficLights: () => Effect.void,
  setVibrancy: () => Effect.void,
  clearVibrancy: () => Effect.void,
  setShadow: () => Effect.void,
  setTitleBarStyle: () => Effect.void,
  setTitleBarTransparent: () => Effect.void,
  setTransparent: () => Effect.void,
  setAlwaysOnTop: () => Effect.void,
  setSkipTaskbar: () => Effect.void,
  setProgress: () => Effect.void,
  requestAttention: () => Effect.void,
  cancelAttention: () => Effect.void,
  minimize: () => Effect.succeed(defaultWindowState()),
  maximize: () => Effect.succeed(defaultWindowState()),
  restore: () => Effect.succeed(defaultWindowState()),
  setFullscreen: () => Effect.succeed(defaultWindowState()),
  setSimpleFullscreen: () => Effect.succeed(defaultWindowState()),
  getState: () => Effect.succeed(defaultWindowState()),
  events: () => Stream.empty,
  destroy: () => Effect.void,
  ...overrides
})

const defaultWindowState = () => ({
  minimized: false,
  maximized: false,
  fullscreen: false,
  simpleFullscreen: false
})

const getFailure = <E>(exit: Exit.Exit<unknown, E>): E | undefined => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const failure = exit.cause.reasons.find(Cause.isFailReason)
    return failure?.error
  }
  return undefined
}
