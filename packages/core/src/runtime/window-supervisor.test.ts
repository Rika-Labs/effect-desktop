import { expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import type { HostWindowClient, WindowCreateInput } from "@effect-desktop/bridge"
import { Cause, ConfigProvider, Effect, Exit, Layer } from "effect"

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

test("openDeclaredWindows opens declared windows and smoke-test destroys them", async () => {
  const created: WindowCreateInput[] = []
  const destroyed: string[] = []
  const client: HostWindowClient = {
    create: (input = {}) =>
      Effect.sync(() => {
        created.push(input)
        return { windowId: `window-${created.length}` }
      }),
    destroy: (windowId) =>
      Effect.sync(() => {
        destroyed.push(windowId)
      })
  }

  const opened = await Effect.runPromise(
    Effect.scoped(
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
  )

  expect(created).toEqual([
    {
      title: "Notes",
      width: 960,
      height: 640
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

test("openDeclaredWindows binds each window's services Layer to that window's scope", async () => {
  const created: WindowCreateInput[] = []
  const destroyed: string[] = []
  const events: string[] = []
  const contexts: Array<{
    readonly registrationId: string
    readonly hostWindowId: string
    readonly ownerScope: string
  }> = []
  const client: HostWindowClient = {
    create: (input = {}) =>
      Effect.sync(() => {
        created.push(input)
        return { windowId: `window-${created.length}` }
      }),
    destroy: (windowId) =>
      Effect.sync(() => {
        destroyed.push(windowId)
      })
  }

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

  await Effect.runPromise(
    Effect.scoped(
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

test("openDeclaredWindows tears down a window when its services Layer fails to build", async () => {
  const destroyed: string[] = []
  const released: string[] = []
  const client: HostWindowClient = {
    create: () => Effect.succeed({ windowId: "window-1" }),
    destroy: (windowId) =>
      Effect.sync(() => {
        destroyed.push(windowId)
      })
  }

  class ServicesBuildFailure extends Error {
    constructor() {
      super("services failure")
    }
  }

  const failingServices = Layer.effectDiscard(
    Effect.acquireRelease(Effect.fail(new ServicesBuildFailure() as never), () =>
      Effect.sync(() => {
        released.push("released")
      })
    )
  )

  const exit = await Effect.runPromiseExit(
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

test("startup environment decodes declared window specs through Effect Config and Schema", async () => {
  const config = await Effect.runPromise(
    readStartupEnvironment(
      provider({
        [WINDOW_SMOKE_TEST_ENV]: "yes",
        [STARTUP_WINDOWS_ENV]: JSON.stringify({
          main: {
            title: "Terminal",
            width: 1024,
            height: 768,
            renderer: "/terminal"
          }
        })
      })
    )
  )
  const windows = await Effect.runPromise(readStartupWindows(config))

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

test("startup environment treats missing and blank startup windows as empty declarations", async () => {
  const missing = await Effect.runPromise(readStartupEnvironment(provider({})))
  const blank = await Effect.runPromise(
    readStartupEnvironment(provider({ [STARTUP_WINDOWS_ENV]: "   " }))
  )

  expect(await Effect.runPromise(readStartupWindows(missing))).toEqual([])
  expect(await Effect.runPromise(readStartupWindows(blank))).toEqual([])
})

test("startup environment requires at least one declared startup window before launch", async () => {
  const config = await Effect.runPromise(readStartupEnvironment(provider({})))
  const windows = await Effect.runPromise(readStartupWindows(config))
  const exit = await Effect.runPromiseExit(requireStartupWindows(windows))

  const error = getFailure(exit)
  expect(error).toBeInstanceOf(StartupWindowConfigError)
  expect(error?.message).toContain("at least one startup window must be declared")
  expect(error?.message).toContain(APP_MODULE_ENV)
  expect(error?.message).toContain(STARTUP_WINDOWS_ENV)
})

test("startup environment rejects invalid declared window specs with a typed error", async () => {
  const exit = await Effect.runPromiseExit(
    readStartupEnvironment(
      provider({
        [STARTUP_WINDOWS_ENV]: JSON.stringify({
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

test("startup environment rejects invalid JSON with a typed error", async () => {
  const exit = await Effect.runPromiseExit(
    readStartupEnvironment(provider({ [STARTUP_WINDOWS_ENV]: "not-json" }))
  )

  const error = getFailure(exit)
  expect(error).toBeInstanceOf(StartupWindowConfigError)
  expect(error?.message).toContain(STARTUP_WINDOWS_ENV)
})

test("startup environment rejects reserved object names before building the windows map", async () => {
  const exit = await Effect.runPromiseExit(
    readStartupEnvironment(
      provider({ [STARTUP_WINDOWS_ENV]: '{"__proto__":{"title":"Polluted"}}' })
    )
  )

  const error = getFailure(exit)
  expect(error).toBeInstanceOf(StartupWindowConfigError)
  expect(error?.message).toContain("reserved window name")
  expect("title" in {}).toBe(false)
})

test("startup environment rejects empty window names", async () => {
  const exit = await Effect.runPromiseExit(
    readStartupEnvironment(
      provider({
        [STARTUP_WINDOWS_ENV]: JSON.stringify({
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

test("startup environment decodes module exports and gives app modules precedence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-startup-"))
  const modulePath = join(directory, "app.ts")
  await writeFile(
    modulePath,
    [
      "export const named = {",
      '  _tag: "DesktopAppDescriptor",',
      "  windowRegistrations: [",
      '    { id: "module", spec: { title: "Module", width: 800 } }',
      "  ]",
      "}"
    ].join("\n"),
    "utf8"
  )

  try {
    const config = await Effect.runPromise(
      readStartupEnvironment(
        provider({
          [APP_MODULE_ENV]: pathToFileURL(modulePath).href,
          [APP_EXPORT_ENV]: "named",
          [STARTUP_WINDOWS_ENV]: "not-json"
        })
      )
    )
    const windows = await Effect.runPromise(readStartupWindows(config))

    expect(windows).toEqual([
      {
        _tag: "DesktopWindowRegistration",
        id: "module",
        spec: { title: "Module", width: 800 },
        services: undefined
      }
    ])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("startup environment defaults blank module export to default", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-startup-default-"))
  const modulePath = join(directory, "app.ts")
  await writeFile(
    modulePath,
    [
      "export default {",
      '  _tag: "DesktopAppDescriptor",',
      "  windowRegistrations: [",
      '    { id: "main", spec: { title: "Default Export" } }',
      "  ]",
      "}"
    ].join("\n"),
    "utf8"
  )

  try {
    const config = await Effect.runPromise(
      readStartupEnvironment(
        provider({
          [APP_MODULE_ENV]: pathToFileURL(modulePath).href,
          [APP_EXPORT_ENV]: "   "
        })
      )
    )
    const windows = await Effect.runPromise(readStartupWindows(config))

    expect(windows).toEqual([
      {
        _tag: "DesktopWindowRegistration",
        id: "main",
        spec: { title: "Default Export" },
        services: undefined
      }
    ])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("startup environment rejects non-file URL app modules with a typed error", async () => {
  const config = await Effect.runPromise(
    readStartupEnvironment(provider({ [APP_MODULE_ENV]: "data:text/javascript,export default {}" }))
  )
  const exit = await Effect.runPromiseExit(readStartupWindows(config))

  const error = getFailure(exit)
  expect(error).toBeInstanceOf(StartupWindowConfigError)
  expect(error?.message).toContain("only accepts file URLs")
})

test("startup environment rejects missing or invalid app exports with a typed error", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-startup-invalid-"))
  const modulePath = join(directory, "app.ts")
  await writeFile(modulePath, "export const wrong = {}", "utf8")

  try {
    const config = await Effect.runPromise(
      readStartupEnvironment(provider({ [APP_MODULE_ENV]: pathToFileURL(modulePath).href }))
    )
    const exit = await Effect.runPromiseExit(readStartupWindows(config))

    const error = getFailure(exit)
    expect(error).toBeInstanceOf(StartupWindowConfigError)
    expect(error?.message).toContain(APP_MODULE_ENV)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("startup environment uses Effect Config boolean parsing for smoke-test mode", async () => {
  const enabled = await Effect.runPromise(
    readStartupEnvironment(provider({ [WINDOW_SMOKE_TEST_ENV]: "on" }))
  )
  const disabled = await Effect.runPromise(
    readStartupEnvironment(provider({ [WINDOW_SMOKE_TEST_ENV]: "off" }))
  )
  const invalid = await Effect.runPromiseExit(
    readStartupEnvironment(provider({ [WINDOW_SMOKE_TEST_ENV]: "sometimes" }))
  )

  expect(enabled.smokeTest).toBe(true)
  expect(disabled.smokeTest).toBe(false)
  expect(getFailure(invalid)).toBeInstanceOf(StartupWindowConfigError)
})

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

const getFailure = <E>(exit: Exit.Exit<unknown, E>): E | undefined => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const failure = exit.cause.reasons.find(Cause.isFailReason)
    return failure?.error
  }
  return undefined
}
