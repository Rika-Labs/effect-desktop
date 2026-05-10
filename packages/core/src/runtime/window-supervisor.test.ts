import { expect, test } from "bun:test"
import type { HostWindowClient, WindowCreateInput } from "@rikalabs/effect-desktop/bridge"
import { Cause, Effect, Exit } from "effect"

import {
  STARTUP_WINDOWS_ENV,
  StartupWindowConfigError,
  openDeclaredWindows,
  readStartupWindowsEnv
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
    openDeclaredWindows(
      client,
      {
        main: {
          title: "Notes",
          width: 960,
          height: 640,
          renderer: "/"
        },
        prefs: {
          title: "Preferences"
        }
      },
      { smokeTest: true }
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

test("readStartupWindowsEnv parses declared window specs from the runtime environment", async () => {
  const windows = await Effect.runPromise(
    readStartupWindowsEnv({
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

  expect(windows).toEqual({
    main: {
      title: "Terminal",
      width: 1024,
      height: 768,
      renderer: "/terminal"
    }
  })
})

test("readStartupWindowsEnv rejects invalid declared window specs with a typed error", async () => {
  const exit = await Effect.runPromiseExit(
    readStartupWindowsEnv({
      [STARTUP_WINDOWS_ENV]: JSON.stringify({
        main: {
          title: "",
          width: -1
        }
      })
    })
  )

  const error = getFailure(exit)
  expect(error).toBeInstanceOf(StartupWindowConfigError)
  expect(error?.message).toContain('entry "main"')
})

const getFailure = <E>(exit: Exit.Exit<unknown, E>): E | undefined => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const failure = exit.cause.reasons.find(Cause.isFailReason)
    return failure?.error
  }
  return undefined
}
