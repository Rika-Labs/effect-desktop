import { expect, test } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import { Deferred, Effect, Exit, Fiber, FileSystem, ManagedRuntime, Option, Path } from "effect"

import {
  DevtoolsInvalidInputError,
  DevtoolsShellOpenError,
  DevtoolsTokenError,
  DevtoolsUnsafeProductionCaptureError,
  makeDevtoolsShell,
  shouldStartDevtools,
  type DevtoolsListener,
  type DevtoolsLoopbackTransport,
  type DevtoolsShellWindow
} from "./shell.js"

const BunServicesRuntime = ManagedRuntime.make(BunServices.layer)

const runWithBun = <A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>
): Effect.Effect<A, E, never> =>
  Effect.promise(() => BunServicesRuntime.runPromise(effect)) as Effect.Effect<A, E, never>

const tempStateDir: Effect.Effect<string, never, never> = runWithBun(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.makeTempDirectory({ prefix: "effect-desktop-devtools-" })
  }).pipe(Effect.orDie)
)

const readUtf8 = (path: string): Effect.Effect<string, never, never> =>
  runWithBun(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      return yield* fs.readFileString(path, "utf8")
    }).pipe(Effect.orDie)
  )

const statMode = (path: string): Effect.Effect<number, never, never> =>
  runWithBun(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const info = yield* fs.stat(path)
      return Number(info.mode) & 0o777
    }).pipe(Effect.orDie)
  )

const fileExists = (path: string): Effect.Effect<boolean, never, never> =>
  runWithBun(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      return yield* fs.exists(path)
    }).pipe(Effect.orDie)
  )

const removeFile = (path: string): Effect.Effect<void, never, never> =>
  runWithBun(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      yield* fs.remove(path)
    }).pipe(Effect.orDie)
  )

const makeDirectory = (path: string): Effect.Effect<void, never, never> =>
  runWithBun(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      yield* fs.makeDirectory(path)
    }).pipe(Effect.orDie)
  )

const expectSome = <A>(option: Option.Option<A>): A => {
  expect(Option.isSome(option)).toBe(true)
  if (Option.isSome(option)) {
    return option.value
  }
  throw new Error("expected Option.some")
}

test("DevtoolsShell stays disabled in production without both gates", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const stateDir = yield* tempStateDir
      const shell = yield* makeDevtoolsShell()

      const withoutFlag = yield* shell.start({
        profile: "prod",
        stateDir,
        securityDevtoolsInProd: true
      })
      const withoutConfig = yield* shell.start({
        profile: "prod",
        stateDir,
        devtoolsFlag: true
      })

      expect(withoutFlag.status).toBe("disabled")
      expect(withoutConfig.status).toBe("disabled")
      expect(Option.isNone(withoutFlag.tokenPath)).toBe(true)
      expect(Option.isNone(withoutConfig.tokenPath)).toBe(true)
    })
  ))

test("DevtoolsShell mints a 256-bit token, opens shell, and disables cleanly", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const stateDir = yield* tempStateDir
      const closed: string[] = []
      const opened: string[] = []
      const shell = yield* makeDevtoolsShell({
        transport: fakeTransport(closed),
        shellWindow: fakeShellWindow(opened)
      })

      const handle = yield* shell.start({
        profile: "dev",
        stateDir
      })
      const tokenPath = expectSome(handle.tokenPath)
      const token = yield* readUtf8(tokenPath)
      const mode = yield* statMode(tokenPath)
      yield* handle.disable

      expect(handle.status).toBe("enabled")
      expect(handle.url.pipe(expectSome)).toBe("http://127.0.0.1:49152")
      expect(token).toMatch(/^[\da-f]{64}$/u)
      if (process.platform !== "win32") {
        expect(mode).toBe(0o600)
      }
      expect(opened).toEqual([`http://127.0.0.1:49152:${tokenPath}`])
      expect(closed).toEqual(["closed"])
      expect(yield* fileExists(tokenPath)).toBe(false)
    })
  ))

test("DevtoolsShell rotates the token on every start", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const stateDir = yield* tempStateDir
      const shell = yield* makeDevtoolsShell({
        transport: fakeTransport([]),
        shellWindow: fakeShellWindow([])
      })

      const first = yield* shell.start({ profile: "dev", stateDir, openShell: false })
      const firstPath = expectSome(first.tokenPath)
      const firstToken = yield* readUtf8(firstPath)
      yield* first.disable
      const second = yield* shell.start({ profile: "dev", stateDir, openShell: false })
      const secondToken = yield* readUtf8(second.tokenPath.pipe(expectSome))
      yield* second.disable

      expect(firstToken).not.toBe(secondToken)
    })
  ))

test("DevtoolsShell rejects unsafe token names before writing outside the state directory", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const tokenName of [
        "",
        ".",
        "..",
        "../escaped-devtools-token",
        "nested/devtools-token",
        "nested\\devtools-token",
        "devtools-token\nforged"
      ]) {
        const stateDir = yield* tempStateDir
        const escapedPath = `${stateDir}/../escaped-devtools-token`
        const shell = yield* makeDevtoolsShell({
          tokenName,
          transport: fakeTransport([]),
          shellWindow: fakeShellWindow([])
        })

        const exit = yield* Effect.exit(shell.start({ profile: "dev", stateDir, openShell: false }))
        if (Exit.isSuccess(exit)) {
          yield* exit.value.disable
        }

        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail")
          expect(failure?.error).toBeInstanceOf(DevtoolsInvalidInputError)
        }
        expect(yield* fileExists(escapedPath)).toBe(false)
      }
    })
  ))

test("DevtoolsShell disable awaits loopback close completion", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const stateDir = yield* tempStateDir
      const closeReleased = yield* Deferred.make<void>()
      let closed = false
      const shell = yield* makeDevtoolsShell({
        transport: {
          listen: () =>
            Effect.succeed({
              url: "http://127.0.0.1:49152",
              close: Deferred.await(closeReleased).pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    closed = true
                  })
                )
              )
            } satisfies DevtoolsListener)
        },
        shellWindow: fakeShellWindow([])
      })

      const handle = yield* shell.start({ profile: "dev", stateDir, openShell: false })
      const disableFiber = yield* handle.disable.pipe(Effect.forkChild({ startImmediately: true }))

      yield* Effect.yieldNow
      expect(closed).toBe(false)

      yield* Deferred.succeed(closeReleased, undefined)
      yield* Fiber.join(disableFiber)
      expect(closed).toBe(true)
    })
  ))

test("DevtoolsShell reports token cleanup failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const stateDir = yield* tempStateDir
      const shell = yield* makeDevtoolsShell({
        transport: fakeTransport([]),
        shellWindow: fakeShellWindow([])
      })

      const handle = yield* shell.start({ profile: "dev", stateDir, openShell: false })
      const tokenPath = expectSome(handle.tokenPath)
      yield* removeFile(tokenPath)
      yield* makeDirectory(tokenPath)

      const exit = yield* Effect.exit(handle.disable)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail")
        expect(failure?.error).toBeInstanceOf(DevtoolsTokenError)
      }
    })
  ))

test("DevtoolsShell fails with a typed error when no shell window port is configured", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const stateDir = yield* tempStateDir
      const closed: string[] = []
      const shell = yield* makeDevtoolsShell({
        transport: fakeTransport(closed)
      })

      const error = yield* Effect.flip(
        shell.start({
          profile: "dev",
          stateDir
        })
      )

      expect(error).toBeInstanceOf(DevtoolsShellOpenError)
      expect(closed).toEqual(["closed"])
    })
  ))

test("DevtoolsShell rejects production capture without an explicit safe inspector policy", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const stateDir = yield* tempStateDir
      const shell = yield* makeDevtoolsShell({
        transport: fakeTransport([]),
        shellWindow: fakeShellWindow([])
      })

      const error = yield* Effect.flip(
        shell.start({
          profile: "prod",
          stateDir,
          devtoolsFlag: true,
          securityDevtoolsInProd: true
        })
      )

      expect(error).toBeInstanceOf(DevtoolsUnsafeProductionCaptureError)
    })
  ))

test("shouldStartDevtools models dev and production gates", () => {
  expect(shouldStartDevtools({ profile: "dev", stateDir: "/tmp/state" })).toBe(true)
  expect(
    shouldStartDevtools({
      profile: "prod",
      stateDir: "/tmp/state",
      devtoolsFlag: true,
      securityDevtoolsInProd: true,
      inspectorCapture: "safe"
    })
  ).toBe(true)
  expect(
    shouldStartDevtools({
      profile: "prod",
      stateDir: "/tmp/state",
      devtoolsFlag: true,
      securityDevtoolsInProd: true
    })
  ).toBe(false)
  expect(
    shouldStartDevtools({
      profile: "prod",
      stateDir: "/tmp/state",
      devtoolsFlag: true,
      securityDevtoolsInProd: false
    })
  ).toBe(false)
})

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
