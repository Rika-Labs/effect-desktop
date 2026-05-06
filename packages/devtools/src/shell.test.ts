import { expect, test } from "bun:test"
import { mkdtemp, readFile, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Effect, Option } from "effect"

import {
  DevtoolsShellOpenError,
  makeDevtoolsShell,
  shouldStartDevtools,
  type DevtoolsListener,
  type DevtoolsLoopbackTransport,
  type DevtoolsShellWindow
} from "./shell.js"

test("DevtoolsShell stays disabled in production without both gates", async () => {
  const stateDir = await tempStateDir()
  const shell = await Effect.runPromise(makeDevtoolsShell())

  const withoutFlag = await Effect.runPromise(
    shell.start({
      profile: "prod",
      stateDir,
      securityDevtoolsInProd: true
    })
  )
  const withoutConfig = await Effect.runPromise(
    shell.start({
      profile: "prod",
      stateDir,
      devtoolsFlag: true
    })
  )

  expect(withoutFlag.status).toBe("disabled")
  expect(withoutConfig.status).toBe("disabled")
  expect(Option.isNone(withoutFlag.tokenPath)).toBe(true)
  expect(Option.isNone(withoutConfig.tokenPath)).toBe(true)
})

test("DevtoolsShell mints a 256-bit token, opens shell, and disables cleanly", async () => {
  const stateDir = await tempStateDir()
  const closed: string[] = []
  const opened: string[] = []
  const shell = await Effect.runPromise(
    makeDevtoolsShell({
      transport: fakeTransport(closed),
      shellWindow: fakeShellWindow(opened)
    })
  )

  const handle = await Effect.runPromise(
    shell.start({
      profile: "dev",
      stateDir
    })
  )
  const tokenPath = expectSome(handle.tokenPath)
  const token = await readFile(tokenPath, "utf8")
  const mode = (await stat(tokenPath)).mode & 0o777
  await Effect.runPromise(handle.disable)

  expect(handle.status).toBe("enabled")
  expect(expectSome(handle.url)).toBe("http://127.0.0.1:49152")
  expect(token).toMatch(/^[\da-f]{64}$/u)
  if (process.platform !== "win32") {
    expect(mode).toBe(0o600)
  }
  expect(opened).toEqual([`http://127.0.0.1:49152:${tokenPath}`])
  expect(closed).toEqual(["closed"])
  expect(await fileExists(tokenPath)).toBe(false)
})

test("DevtoolsShell rotates the token on every start", async () => {
  const stateDir = await tempStateDir()
  const shell = await Effect.runPromise(
    makeDevtoolsShell({
      transport: fakeTransport([]),
      shellWindow: fakeShellWindow([])
    })
  )

  const first = await Effect.runPromise(shell.start({ profile: "dev", stateDir, openShell: false }))
  const firstPath = expectSome(first.tokenPath)
  const firstToken = await readFile(firstPath, "utf8")
  await Effect.runPromise(first.disable)
  const second = await Effect.runPromise(
    shell.start({ profile: "dev", stateDir, openShell: false })
  )
  const secondToken = await readFile(expectSome(second.tokenPath), "utf8")
  await Effect.runPromise(second.disable)

  expect(firstToken).not.toBe(secondToken)
})

test("DevtoolsShell fails with a typed error when no shell window port is configured", async () => {
  const stateDir = await tempStateDir()
  const closed: string[] = []
  const shell = await Effect.runPromise(
    makeDevtoolsShell({
      transport: fakeTransport(closed)
    })
  )

  const error = await Effect.runPromise(
    Effect.flip(
      shell.start({
        profile: "dev",
        stateDir
      })
    )
  )

  expect(error).toBeInstanceOf(DevtoolsShellOpenError)
  expect(closed).toEqual(["closed"])
})

test("shouldStartDevtools models dev and production gates", () => {
  expect(shouldStartDevtools({ profile: "dev", stateDir: "/tmp/state" })).toBe(true)
  expect(
    shouldStartDevtools({
      profile: "prod",
      stateDir: "/tmp/state",
      devtoolsFlag: true,
      securityDevtoolsInProd: true
    })
  ).toBe(true)
  expect(
    shouldStartDevtools({
      profile: "prod",
      stateDir: "/tmp/state",
      devtoolsFlag: true,
      securityDevtoolsInProd: false
    })
  ).toBe(false)
})

const tempStateDir = (): Promise<string> => mkdtemp(join(tmpdir(), "effect-desktop-devtools-"))

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

const fakeTransport = (closed: string[]): DevtoolsLoopbackTransport => ({
  listen: () =>
    Effect.succeed({
      url: "http://127.0.0.1:49152",
      close: Effect.sync(() => {
        closed.push("closed")
      })
    } satisfies DevtoolsListener)
})

const fakeShellWindow = (opened: string[]): DevtoolsShellWindow => ({
  open: ({ url, tokenPath }) =>
    Effect.sync(() => {
      opened.push(`${url}:${tokenPath}`)
    })
})

const expectSome = <A>(option: Option.Option<A>): A => {
  expect(Option.isSome(option)).toBe(true)
  if (Option.isSome(option)) {
    return option.value
  }
  throw new Error("expected Option.some")
}
