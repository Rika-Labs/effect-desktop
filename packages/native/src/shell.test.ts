import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import {
  type BridgeClientExchange,
  type BridgeClientResponse,
  HostProtocolRequestEnvelope
} from "@orika/bridge"
import { Cause, Effect, Exit, Layer, ManagedRuntime } from "effect"

import { Shell, ShellSurface } from "./shell.js"

test("Shell public surface omits shallow service and layer helpers", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const source = yield* Effect.promise(() =>
        readFile(new URL("shell.ts", import.meta.url), "utf8")
      )
      const indexSource = yield* Effect.promise(() =>
        readFile(new URL("index.ts", import.meta.url), "utf8")
      )

      for (const removedName of [
        "class ShellClient",
        "ShellLive",
        "ShellServiceApi",
        "makeShellClientLayer",
        "makeShellServiceLayer",
        "makeShellBridgeClientLayer"
      ]) {
        expect(source).not.toContain(removedName)
        expect(indexSource).not.toContain(removedName)
      }
    })
  ))

const shellExchange = (
  requests: HostProtocolRequestEnvelope[],
  respond: (request: HostProtocolRequestEnvelope) => BridgeClientResponse
): BridgeClientExchange => ({
  request: (request) => {
    requests.push(request)
    return Effect.succeed(respond(request))
  }
})

const runScoped = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, never, never>
): Effect.Effect<A, E, never> =>
  Effect.gen(function* () {
    const runtime = ManagedRuntime.make(layer)
    const exit = yield* Effect.promise(() => runtime.runPromiseExit(effect))
    yield* Effect.promise(() => runtime.dispose())
    return yield* exit
  })

const expectExitFailure = <E>(
  exit: Exit.Exit<unknown, E>,
  predicate: (error: E) => boolean
): void => {
  expect(Exit.isFailure(exit)).toBe(true)

  if (Exit.isFailure(exit)) {
    const fail = exit.cause.reasons.find(Cause.isFailReason)
    expect(fail).toBeDefined()
    if (fail !== undefined) {
      expect(predicate(fail.error)).toBe(true)
      return
    }
  }

  throw new Error("expected typed failure")
}

const hasErrorTag = (error: unknown, tag: string): boolean =>
  typeof error === "object" && error !== null && "_tag" in error && error._tag === tag

test("Shell.openPath denies trailing-separator executable bundle paths without allowExecutable", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      const result = yield* runScoped(
        Effect.gen(function* () {
          const client = yield* Shell
          const appBundleExit = yield* Effect.exit(client.openPath("/Applications/Calculator.app/"))
          const shellScriptExit = yield* Effect.exit(client.openPath("/tmp/install.sh/"))
          const commandBundleExit = yield* Effect.exit(client.openPath("/tmp/run.command//"))
          return { appBundleExit, commandBundleExit, shellScriptExit }
        }),
        ShellSurface.bridgeClientLayer(
          shellExchange(requests, () => ({ kind: "success", payload: undefined }))
        )
      )

      expectExitFailure(result.appBundleExit, (error) => hasErrorTag(error, "PermissionDenied"))
      expectExitFailure(result.shellScriptExit, (error) => hasErrorTag(error, "PermissionDenied"))
      expectExitFailure(result.commandBundleExit, (error) => hasErrorTag(error, "PermissionDenied"))
      expect(requests).toEqual([])
    })
  ))

test("Shell.openPath forwards trailing-separator executable bundle paths with allowExecutable", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const requests: HostProtocolRequestEnvelope[] = []
      yield* runScoped(
        Effect.gen(function* () {
          const client = yield* Shell
          yield* client.openPath("/Applications/Calculator.app/", { allowExecutable: true })
        }),
        ShellSurface.bridgeClientLayer(
          shellExchange(requests, () => ({ kind: "success", payload: undefined }))
        )
      )

      expect(requests.map((request) => [request.method, request.payload])).toEqual([
        ["Shell.openPath", { path: "/Applications/Calculator.app/", allowExecutable: true }]
      ])
    })
  ))
