import { expect, test } from "bun:test"

import { makeHostProtocolHostUnavailableError } from "@effect-desktop/bridge"
import { Cause, Effect, Exit, Sink, Stream } from "effect"

import { ProcessExitStatus, type ProcessApi, type ProcessHandle } from "./process.js"
import { makeResourceId, makeResourceRegistry } from "./resources.js"
import type { ManagedResourceHandle } from "./resources.js"
import { makeSidecar, SidecarCommand, SidecarError } from "./sidecar.js"

test("Sidecar retry preserves start failure after retries are exhausted", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let attempts = 0
      const process = Object.freeze({
        spawn: () =>
          Effect.sync(() => {
            attempts += 1
          }).pipe(
            Effect.andThen(Effect.fail(makeHostProtocolHostUnavailableError("Process.spawn")))
          ),
        list: () => Effect.succeed([]),
        observe: () => Stream.empty
      } satisfies ProcessApi)
      const registry = yield* makeResourceRegistry()
      const sidecar = yield* makeSidecar(process, registry)

      const exit = yield* Effect.exit(
        sidecar.start(
          new SidecarCommand({
            args: [],
            command: "helper",
            ownerScope: "scope-main"
          }),
          {
            readiness: { _tag: "None" },
            retry: { idempotent: true, retries: 2 }
          }
        )
      )

      expect(attempts).toBe(3)
      expectFailure(exit, SidecarError)
      const snapshot = yield* registry.list()
      expect(snapshot).toEqual({ entries: [] })
    })
  ))

test("Sidecar readiness failure updates status and fails ready effect", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const processHandle = makeFakeProcessHandle()
      const process = Object.freeze({
        spawn: () => Effect.succeed(processHandle),
        list: () => Effect.succeed([]),
        observe: () => Stream.empty
      } satisfies ProcessApi)
      const registry = yield* makeResourceRegistry()
      const sidecar = yield* makeSidecar(process, registry)

      const handle = yield* sidecar.start(
        new SidecarCommand({
          args: [],
          command: "helper",
          ownerScope: "scope-main"
        }),
        { readiness: { _tag: "Line", match: "ready", stream: "stdout" } }
      )
      const readyExit = yield* Effect.exit(handle.ready)
      yield* Effect.yieldNow
      const status = yield* handle.status

      expectFailure(readyExit, SidecarError)
      expect(status).toMatchObject({
        _tag: "Failed",
        message: "sidecar exited before readiness was observed",
        recoverable: false
      })
    })
  ))

const makeFakeProcessHandle = (): ProcessHandle =>
  Object.freeze({
    exit: Effect.succeed(new ProcessExitStatus({ code: 0 })),
    kill: () => Effect.void,
    pid: 42,
    resource: fakeProcessResource,
    stderr: Stream.empty,
    stdin: Sink.drain,
    stdout: Stream.empty
  } satisfies ProcessHandle)

const fakeProcessResource: ManagedResourceHandle<"process", "running"> = Object.freeze({
  dispose: () => Effect.void,
  generation: 0,
  id: makeResourceId("process-1"),
  kind: "process",
  ownerScope: "scope-main",
  state: "running"
})

const expectFailure = (
  exit: Exit.Exit<unknown, SidecarError>,
  errorType: abstract new (...args: never[]) => unknown
): void => {
  expect(Exit.isFailure(exit)).toBe(true)

  if (Exit.isFailure(exit)) {
    const fail = exit.cause.reasons.find(Cause.isFailReason)
    expect(fail?.error).toBeInstanceOf(errorType)
  }
}
