import { expect, test } from "bun:test"
import {
  HostProtocolBackpressureOverflowError,
  HostProtocolFileNotFoundError,
  HostProtocolInvalidArgumentError,
  HostProtocolPermissionDeniedError,
  HostProtocolResourceBusyError,
  HostProtocolStaleHandleError
} from "@effect-desktop/bridge"
import { Cause, Deferred, Effect, Exit, Fiber, Option, Schedule, Schema, Stream } from "effect"

import { PermissionActor } from "./permission-registry.js"
import {
  makePty,
  PtyExitStatus,
  PtyResizeInput,
  type PtyAdapter,
  type PtyApi,
  type PtyBudgetPolicy,
  type PtyChild,
  type PtyPermissionPolicy,
  type PtySignalInput
} from "./pty.js"
import type { ResourceOwnerApi } from "./resource-owner.js"
import { makeResourceRegistry, type ResourceRegistryApi } from "./resources.js"

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()
const ptyTest = process.platform === "win32" ? test.skip : test
const TEST_OWNER: ResourceOwnerApi = Object.freeze({
  kind: "test",
  scopeId: "scope-main",
  actor: new PermissionActor({ kind: "resource", id: "scope-main" }),
  attributes: Object.freeze({ scopeId: "scope-main" })
})

ptyTest("PTY open exposes output and exit status", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fixture = yield* makeFixture(
        makeFakeAdapter(() => makeFakeChild({ output: ["prompt$ "], exit: { code: 0 } }))
      )

      const handle = yield* fixture.service.open({
        argv: ["bash"],
        rows: 24,
        cols: 80
      })
      const output = yield* handle.output.pipe(Stream.runCollect)
      const status = yield* handle.onExit

      expect(decodeChunks(Array.from(output))).toBe("prompt$ ")
      expect(status).toEqual(new PtyExitStatus({ code: 0 }))
    })
  )
)

ptyTest("PTY open registers a scoped running resource", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fixture = yield* makeFixture(
        makeFakeAdapter(() => makeFakeChild({ output: [], exit: { code: 0 } }))
      )

      const handle = yield* fixture.service.open({
        argv: ["bash"],
        rows: 24,
        cols: 80
      })
      const snapshot = yield* fixture.registry.list()

      expect(handle.resource.kind).toBe("pty")
      expect(handle.resource.ownerScope).toBe("scope-main")
      expect(snapshot.entries.map((entry) => entry.handle)).toContainEqual({
        kind: handle.resource.kind,
        id: handle.resource.id,
        generation: handle.resource.generation,
        ownerScope: handle.resource.ownerScope,
        state: handle.resource.state
      })
    })
  )
)

ptyTest("PTY removes the resource when a child exits without awaiting onExit", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fixture = yield* makeFixture(
        makeFakeAdapter(() => makeFakeChild({ output: [], exit: { code: 0 } }))
      )

      yield* fixture.service.open({
        argv: ["bash"],
        rows: 24,
        cols: 80
      })
      yield* waitUntil(
        fixture.registry.list().pipe(Effect.map((snapshot) => snapshot.entries.length === 0))
      )
    })
  )
)

ptyTest("PTY removes the resource and releases budget when child exit fails", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let openCalls = 0
      const fixture = yield* makeFixture(
        makeFakeAdapter(() => {
          openCalls += 1
          return openCalls === 1
            ? makeFakeChild({ output: [], exit: { code: 1 }, exitError: new Error("pty failed") })
            : makeFakeChild({ output: [], exit: { code: 0 } })
        }),
        { budgets: { maxConcurrent: 1 } }
      )

      yield* fixture.service.open({
        argv: ["bash"],
        rows: 24,
        cols: 80
      })
      yield* waitUntil(
        fixture.registry.list().pipe(Effect.map((snapshot) => snapshot.entries.length === 0))
      )
      yield* fixture.service.open({
        argv: ["bash"],
        rows: 24,
        cols: 80
      })

      expect(openCalls).toBe(2)
    })
  )
)

ptyTest("PTY open validates size before adapter activity", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let openCalls = 0
      const fixture = yield* makeFixture(
        makeFakeAdapter(() => {
          openCalls += 1
          return makeFakeChild({ output: [], exit: { code: 0 } })
        })
      )

      const exit = yield* Effect.exit(
        fixture.service.open({
          argv: ["bash"],
          rows: 0,
          cols: 80
        })
      )

      expect(openCalls).toBe(0)
      expectFailure(exit, HostProtocolInvalidArgumentError)
    })
  )
)

test("PTY rejects non-finite graceful shutdown windows", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry()
      for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        const exit = yield* Effect.exit(
          makePty(registry, TEST_OWNER, { adapter: makeFakeAdapter(), gracefulShutdownMs: value })
        )
        expectFailure(exit, HostProtocolInvalidArgumentError)
      }
    })
  ))

test("PTY rejects non-positive graceful shutdown windows before adapter activity", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry()
      for (const value of [0, -1, -5000]) {
        let openCalls = 0
        const exit = yield* Effect.exit(
          makePty(registry, TEST_OWNER, {
            gracefulShutdownMs: value,
            adapter: {
              open: () => {
                openCalls += 1
                return makeFakeChild({ output: [], exit: { code: 0 } })
              }
            }
          })
        )
        expect(openCalls).toBe(0)
        expectFailure(exit, HostProtocolInvalidArgumentError)
      }
    })
  ))

ptyTest("PTY open denies commands by default before adapter activity", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let openCalls = 0
      const registry = yield* makeResourceRegistry()
      const service = yield* makePty(registry, TEST_OWNER, {
        adapter: {
          open: () => {
            openCalls += 1
            return makeFakeChild({ output: [], exit: { code: 0 } })
          }
        }
      })

      const exit = yield* Effect.exit(
        service.open({
          argv: ["bash"],
          rows: 24,
          cols: 80
        })
      )

      expect(openCalls).toBe(0)
      expectFailure(exit, HostProtocolPermissionDeniedError)
    })
  )
)

ptyTest("PTY open allows commands declared in pty.spawn policy", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let openCalls = 0
      const fixture = yield* makeFixture(
        makeFakeAdapter(() => {
          openCalls += 1
          return makeFakeChild({ output: [], exit: { code: 0 } })
        }),
        { permissions: { spawn: ["bash"] } }
      )

      yield* fixture.service.open({
        argv: ["bash"],
        rows: 24,
        cols: 80
      })

      expect(openCalls).toBe(1)
    })
  )
)

ptyTest("PTY open rejects argv0 shell metacharacters before permission lookup", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let openCalls = 0
      const fixture = yield* makeFixture(
        makeFakeAdapter(() => {
          openCalls += 1
          return makeFakeChild({ output: [], exit: { code: 0 } })
        }),
        { permissions: { spawn: ["bash;rm"] } }
      )

      const exit = yield* Effect.exit(
        fixture.service.open({
          argv: ["bash;rm"],
          rows: 24,
          cols: 80
        })
      )

      expect(openCalls).toBe(0)
      expectFailure(exit, HostProtocolInvalidArgumentError)
    })
  )
)

ptyTest("PTY open rejects empty environment names before adapter activity", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let openCalls = 0
      const fixture = yield* makeFixture(
        makeFakeAdapter(() => {
          openCalls += 1
          return makeFakeChild({ output: [], exit: { code: 0 } })
        }),
        { permissions: { spawn: ["bash"] } }
      )

      const exit = yield* Effect.exit(
        fixture.service.open({
          argv: ["bash"],
          rows: 24,
          cols: 80,
          env: { "": "bad" }
        })
      )

      expect(openCalls).toBe(0)
      expectFailure(exit, HostProtocolInvalidArgumentError)
    })
  )
)

ptyTest("PTY open rejects NUL bytes in environment names", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let openCalls = 0
      const fixture = yield* makeFixture(
        makeFakeAdapter(() => {
          openCalls += 1
          return makeFakeChild({ output: [], exit: { code: 0 } })
        }),
        { permissions: { spawn: ["bash"] } }
      )
      const nul = String.fromCharCode(0)

      const exit = yield* Effect.exit(
        fixture.service.open({
          argv: ["bash"],
          rows: 24,
          cols: 80,
          env: { [`key${nul}`]: "value" }
        })
      )

      expect(openCalls).toBe(0)
      expectFailure(exit, HostProtocolInvalidArgumentError)
    })
  )
)

ptyTest("PTY open rejects NUL bytes in environment values", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let openCalls = 0
      const fixture = yield* makeFixture(
        makeFakeAdapter(() => {
          openCalls += 1
          return makeFakeChild({ output: [], exit: { code: 0 } })
        }),
        { permissions: { spawn: ["bash"] } }
      )
      const nul = String.fromCharCode(0)

      const exit = yield* Effect.exit(
        fixture.service.open({
          argv: ["bash"],
          rows: 24,
          cols: 80,
          env: { key: `value${nul}` }
        })
      )

      expect(openCalls).toBe(0)
      expectFailure(exit, HostProtocolInvalidArgumentError)
    })
  )
)

ptyTest("PTY open enforces the per-scope concurrent budget", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let openCalls = 0
      const fixture = yield* makeFixture(
        makeFakeAdapter(() => {
          openCalls += 1
          return makeFakeChild({
            output: [],
            exit: { code: 0 },
            naturalExitDelayMs: 60_000
          })
        }),
        { budgets: { maxConcurrent: 1 } }
      )

      const first = fixture.service.open({
        argv: ["bash"],
        rows: 24,
        cols: 80
      })
      const second = fixture.service.open({
        argv: ["bash"],
        rows: 24,
        cols: 80
      })
      const exits = yield* Effect.all([Effect.exit(first), Effect.exit(second)], {
        concurrency: "unbounded"
      })
      yield* fixture.registry.closeScope("scope-main")

      expect(openCalls).toBe(1)
      expect(exits.filter(Exit.isSuccess)).toHaveLength(1)
      const failure = exits.find(Exit.isFailure)
      expect(failure).toBeDefined()
      if (failure !== undefined) {
        expectFailure(failure, HostProtocolResourceBusyError)
      }
    })
  )
)

ptyTest("PTY open releases the per-scope budget after adapter failure", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let openCalls = 0
      const notFound = new Error("missing pty")
      Object.assign(notFound, { code: "ENOENT" })
      const fixture = yield* makeFixture(
        makeFakeAdapter(() => {
          openCalls += 1
          if (openCalls === 1) {
            throw notFound
          }
          return makeFakeChild({ output: [], exit: { code: 0 } })
        }),
        { budgets: { maxConcurrent: 1 } }
      )

      const failed = yield* Effect.exit(
        fixture.service.open({
          argv: ["bash"],
          rows: 24,
          cols: 80
        })
      )
      yield* fixture.service.open({
        argv: ["bash"],
        rows: 24,
        cols: 80
      })

      expectFailure(failed, HostProtocolFileNotFoundError)
      expect(openCalls).toBe(2)
    })
  )
)

ptyTest("PTY open validates output budget policy before adapter activity", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let openCalls = 0
      const fixture = yield* makeFixture(
        makeFakeAdapter(() => {
          openCalls += 1
          return makeFakeChild({ output: [], exit: { code: 0 } })
        }),
        { budgets: { outputCoalesceBytes: 0 } }
      )

      const exit = yield* Effect.exit(
        fixture.service.open({
          argv: ["bash"],
          rows: 24,
          cols: 80
        })
      )

      expect(openCalls).toBe(0)
      expectFailure(exit, HostProtocolInvalidArgumentError)
    })
  )
)

ptyTest("PTY output coalesces small chunks up to the byte window", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fixture = yield* makeFixture(
        makeFakeAdapter(() =>
          makeFakeChild({ output: ["a", "b", "c", "d", "e"], exit: { code: 0 } })
        ),
        { budgets: { outputBufferBytes: 16, outputCoalesceBytes: 4, outputCoalesceMs: 1_000 } }
      )
      const handle = yield* fixture.service.open({
        argv: ["bash"],
        rows: 24,
        cols: 80
      })

      const output = Array.from(yield* handle.output.pipe(Stream.runCollect))
      const metrics = yield* handle.outputMetrics

      expect(decodeChunks(Array.from(output))).toBe("abcde")
      expect(output.map((chunk) => chunk.byteLength)).toEqual([4, 1])
      expect(metrics).toMatchObject({
        coalescedFrames: 1,
        emittedFrames: 2,
        inputFrames: 5,
        queueDepth: 0
      })
    })
  )
)

ptyTest("PTY output flushes a quiet small chunk when the coalescing window expires", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const now = fixedSequenceClock([100, 106])
      const fixture = yield* makeFixture(
        makeFakeAdapter(() =>
          makeFakeChild({
            output: ["p"],
            exit: { code: 0 },
            keepOutputOpen: true,
            naturalExitDelayMs: 60_000
          })
        ),
        { budgets: { outputBufferBytes: 16, outputCoalesceBytes: 4, outputCoalesceMs: 5 }, now }
      )
      const handle = yield* fixture.service.open({
        argv: ["bash"],
        rows: 24,
        cols: 80
      })

      const output = yield* handle.output.pipe(
        Stream.take(1),
        Stream.runCollect,
        Effect.timeout("100 millis")
      )
      yield* fixture.registry.closeScope("scope-main")

      expect(decodeChunks(Array.from(output))).toBe("p")
    })
  )
)

ptyTest("PTY output fails with BackpressureOverflow when a chunk exceeds budget", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fixture = yield* makeFixture(
        makeFakeAdapter(() => makeFakeChild({ output: ["abcd"], exit: { code: 0 } })),
        { budgets: { outputBufferBytes: 3, outputCoalesceBytes: 4, outputOverflow: "error" } }
      )
      const handle = yield* fixture.service.open({
        argv: ["bash"],
        rows: 24,
        cols: 80
      })

      const exit = yield* Effect.exit(handle.output.pipe(Stream.runCollect))

      expectFailure(exit, HostProtocolBackpressureOverflowError)
    })
  )
)

ptyTest("PTY output dropOldest keeps the stream buffer bounded", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fixture = yield* makeFixture(
        makeFakeAdapter(() => makeFakeChild({ output: ["aa", "bb", "cc"], exit: { code: 0 } })),
        {
          budgets: {
            outputBufferBytes: 4,
            outputCoalesceBytes: 2,
            outputCoalesceMs: 1_000,
            outputOverflow: "dropOldest"
          }
        }
      )
      const handle = yield* fixture.service.open({
        argv: ["bash"],
        rows: 24,
        cols: 80
      })

      const output = yield* handle.output.pipe(Stream.runCollect)
      const metrics = yield* handle.outputMetrics

      expect(decodeChunks(Array.from(output))).toBe("bbcc")
      expect(metrics).toMatchObject({
        emittedFrames: 3,
        inputFrames: 3,
        queueDepth: 0
      })
    })
  )
)

ptyTest("PTY rejects invalid output overflow policies before adapter open", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let openCalls = 0
      const fixture = yield* makeFixture(
        {
          open: () => {
            openCalls += 1
            return makeFakeChild({ output: [], exit: { code: 0 } })
          }
        },
        {
          budgets: {
            outputBufferBytes: 4,
            outputCoalesceBytes: 2,
            outputCoalesceMs: 1_000,
            outputOverflow: "surprise"
          }
        }
      )

      const exit = yield* Effect.exit(
        fixture.service.open({
          argv: ["bash"],
          rows: 24,
          cols: 80
        })
      )

      expectFailure(exit, HostProtocolInvalidArgumentError)
      expect(openCalls).toBe(0)
    })
  )
)

ptyTest("PTY handle writes, resizes, kills, and preserves exit signal", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const child = makeFakeChild({ output: [], exit: { code: 0 }, naturalExitDelayMs: 60_000 })
      const fixture = yield* makeFixture(makeFakeAdapter(() => child))
      const handle = yield* fixture.service.open({
        argv: ["bash"],
        rows: 24,
        cols: 80
      })

      yield* handle.write(textEncoder.encode("echo hi\n"))
      yield* handle.resize(new PtyResizeInput({ rows: 40, cols: 120 }))
      yield* handle.kill("SIGTERM")
      const status = yield* handle.onExit

      expect(decodeChunks(child.writes)).toBe("echo hi\n")
      expect(child.resizes).toEqual([new PtyResizeInput({ rows: 40, cols: 120 })])
      expect(child.killedWith).toBe("SIGTERM")
      expect(status).toEqual(new PtyExitStatus({ code: 0, signal: "SIGTERM" }))
    })
  )
)

ptyTest("PTY write rejects non-byte chunks before adapter activity", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const child = makeFakeChild({ output: [], exit: { code: 0 }, naturalExitDelayMs: 60_000 })
      const fixture = yield* makeFixture(makeFakeAdapter(() => child))
      const handle = yield* fixture.service.open({
        argv: ["bash"],
        rows: 24,
        cols: 80
      })

      const exit = yield* Effect.exit(handle.write("echo hi\n"))
      yield* fixture.registry.closeScope("scope-main")

      expect(child.writes).toEqual([])
      expectFailure(exit, HostProtocolInvalidArgumentError)
    })
  )
)

ptyTest("PTY side effects reject handles after child exit", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const child = makeFakeChild({ output: [], exit: { code: 0 } })
      const fixture = yield* makeFixture(makeFakeAdapter(() => child))
      const handle = yield* fixture.service.open({
        argv: ["bash"],
        rows: 24,
        cols: 80
      })
      yield* handle.onExit

      const writeExit = yield* Effect.exit(handle.write(textEncoder.encode("echo hi\n")))
      const resizeExit = yield* Effect.exit(
        handle.resize(new PtyResizeInput({ rows: 40, cols: 120 }))
      )
      const killExit = yield* Effect.exit(handle.kill("SIGTERM"))

      expect(child.writes).toEqual([])
      expect(child.resizes).toEqual([])
      expect(child.kills).toEqual([])
      expectFailure(writeExit, HostProtocolStaleHandleError)
      expectFailure(resizeExit, HostProtocolStaleHandleError)
      expectFailure(killExit, HostProtocolStaleHandleError)
    })
  )
)

ptyTest("PTY side effects reject handles after scope close", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const child = makeFakeChild({ output: [], exit: { code: 0 }, naturalExitDelayMs: 60_000 })
      const fixture = yield* makeFixture(makeFakeAdapter(() => child))
      const handle = yield* fixture.service.open({
        argv: ["bash"],
        rows: 24,
        cols: 80
      })
      yield* fixture.registry.closeScope("scope-main")

      const writeExit = yield* Effect.exit(handle.write(textEncoder.encode("echo hi\n")))
      const resizeExit = yield* Effect.exit(
        handle.resize(new PtyResizeInput({ rows: 40, cols: 120 }))
      )
      const killExit = yield* Effect.exit(handle.kill("SIGKILL"))

      expect(child.writes).toEqual([])
      expect(child.resizes).toEqual([])
      expect(child.kills).toEqual(["SIGTERM"])
      expectFailure(writeExit, HostProtocolStaleHandleError)
      expectFailure(resizeExit, HostProtocolStaleHandleError)
      expectFailure(killExit, HostProtocolStaleHandleError)
    })
  )
)

ptyTest("PTY kill rejects control bytes in signal names", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const child = makeFakeChild({ output: [], exit: { code: 0 } })
      const fixture = yield* makeFixture(
        makeFakeAdapter(() => child),
        { permissions: { spawn: ["bash"] } }
      )
      const handle = yield* fixture.service.open({
        argv: ["bash"],
        rows: 24,
        cols: 80
      })
      const nul = String.fromCharCode(0)

      const exit = yield* Effect.exit(handle.kill(`SIG${nul}TERM`))

      expectFailure(exit, HostProtocolInvalidArgumentError)
      expect(child.killedWith).toBeUndefined()
    })
  )
)

ptyTest("PTY scope close kills the child", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const child = makeFakeChild({ output: [], exit: { code: 0 }, naturalExitDelayMs: 60_000 })
      const fixture = yield* makeFixture(makeFakeAdapter(() => child))

      yield* fixture.service.open({
        argv: ["bash"],
        rows: 24,
        cols: 80
      })
      yield* fixture.registry.closeScope("scope-main")

      expect(child.terminateTreeCalls).toBe(1)
    })
  )
)

ptyTest("PTY scope close waits for child exit before releasing budget", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let openCalls = 0
      const firstChild = makeFakeChild({
        output: [],
        exit: { code: 0 },
        naturalExitDelayMs: 60_000,
        killExitDelayMs: 20
      })
      const fixture = yield* makeFixture(
        makeFakeAdapter(() => {
          openCalls += 1
          return openCalls === 1 ? firstChild : makeFakeChild({ output: [], exit: { code: 0 } })
        }),
        { budgets: { maxConcurrent: 1 } }
      )

      yield* fixture.service.open({
        argv: ["bash"],
        rows: 24,
        cols: 80
      })
      yield* fixture.registry.closeScope("scope-main")
      yield* fixture.service.open({
        argv: ["bash"],
        rows: 24,
        cols: 80
      })

      expect(firstChild.isRunning()).toBe(false)
      expect(openCalls).toBe(2)
    })
  )
)

ptyTest("PTY scope close escalates to SIGKILL when SIGTERM is ignored", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const child = makeFakeChild({
        output: [],
        exit: { code: 0 },
        naturalExitDelayMs: 60_000,
        ignoredSignals: ["SIGTERM"]
      })
      const fixture = yield* makeFixture(
        makeFakeAdapter(() => child),
        { gracefulShutdownMs: 1 }
      )

      yield* fixture.service.open({
        argv: ["bash"],
        rows: 24,
        cols: 80
      })
      yield* fixture.registry.closeScope("scope-main")

      expect(child.terminateTreeCalls).toBe(1)
      expect(child.forceKillTreeCalls).toBe(1)
      expect(child.isRunning()).toBe(false)
    })
  )
)

ptyTest("PTY scope close escalates when terminateTree fails", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const child = makeFakeChild({
        output: [],
        exit: { code: 0 },
        naturalExitDelayMs: 60_000,
        terminateError: new Error("terminate failed")
      })
      const fixture = yield* makeFixture(
        makeFakeAdapter(() => child),
        { gracefulShutdownMs: 1 }
      )

      yield* fixture.service.open({
        argv: ["bash"],
        rows: 24,
        cols: 80
      })
      yield* fixture.registry.closeScope("scope-main")

      expect(child.terminateTreeCalls).toBe(1)
      expect(child.forceKillTreeCalls).toBe(1)
      expect(child.killedWith).toBe("SIGKILL")
      expect(child.isRunning()).toBe(false)
    })
  )
)

ptyTest("PTY scope close suppresses forceKillTree failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const child = makeFakeChild({
        output: [],
        exit: { code: 0 },
        forceKillError: new Error("force kill failed"),
        ignoredSignals: ["SIGTERM"],
        naturalExitDelayMs: 60_000
      })
      const fixture = yield* makeFixture(
        makeFakeAdapter(() => child),
        { gracefulShutdownMs: 1 }
      )

      yield* fixture.service.open({
        argv: ["bash"],
        rows: 24,
        cols: 80
      })
      yield* fixture.registry.closeScope("scope-main")

      expect(child.terminateTreeCalls).toBe(1)
      expect(child.forceKillTreeCalls).toBe(1)
      expect(child.isRunning()).toBe(true)
    })
  )
)

interface PtyFixtureOptions {
  readonly budgets?: PtyBudgetPolicy
  readonly gracefulShutdownMs?: number
  readonly now?: () => number
  readonly permissions?: PtyPermissionPolicy
}

const makeFixture = (
  adapter?: PtyAdapter,
  options: PtyFixtureOptions = {}
): Effect.Effect<
  { readonly registry: ResourceRegistryApi; readonly service: PtyApi },
  HostProtocolInvalidArgumentError
> =>
  Effect.gen(function* () {
    const registry = yield* makeResourceRegistry()
    const service = yield* makeService(registry, adapter ?? makeFakeAdapter(), options)
    return { registry, service }
  })

const makeService = (
  registry: ResourceRegistryApi,
  adapter: PtyAdapter,
  options: PtyFixtureOptions = {}
): Effect.Effect<PtyApi, HostProtocolInvalidArgumentError> =>
  makePty(registry, TEST_OWNER, {
    adapter,
    ...(options.budgets === undefined ? {} : { budgets: options.budgets }),
    ...(options.gracefulShutdownMs === undefined
      ? {}
      : { gracefulShutdownMs: options.gracefulShutdownMs }),
    ...(options.now === undefined ? {} : { now: options.now }),
    permissions: options.permissions ?? ALLOW_TEST_PTY_PERMISSIONS
  })

const ALLOW_TEST_PTY_PERMISSIONS: PtyPermissionPolicy = {
  spawn: ["bash"]
}

const makeFakeAdapter = (
  makeChild: () => PtyChild = () => makeFakeChild({ output: [], exit: { code: 0 } })
): PtyAdapter => ({
  open: () => makeChild()
})

interface FakeChild extends PtyChild {
  readonly writes: Uint8Array[]
  readonly resizes: PtyResizeInput[]
  readonly killedWith: PtySignalInput | undefined
  readonly kills: PtySignalInput[]
  readonly terminateTreeCalls: number
  readonly forceKillTreeCalls: number
}

const makeFakeChild = (options: {
  readonly output: readonly string[]
  readonly exit: { readonly code: number; readonly signal?: string }
  readonly exitError?: unknown
  readonly killExitDelayMs?: number
  readonly naturalExitDelayMs?: number
  readonly terminateError?: unknown
  readonly forceKillError?: unknown
  readonly ignoredSignals?: readonly PtySignalInput[]
  readonly ignoreKill?: boolean
  readonly keepOutputOpen?: boolean
}): FakeChild => {
  const writes: Uint8Array[] = []
  const resizes: PtyResizeInput[] = []
  const kills: PtySignalInput[] = []
  let killedWith: PtySignalInput | undefined
  let terminateTreeCalls = 0
  let forceKillTreeCalls = 0
  let running = true
  let settled = false
  const exitState = Effect.runSync(Deferred.make<PtyExitStatus, PtyFakeChildFailure>())
  const exited = Effect.runPromise(
    Deferred.await(exitState).pipe(Effect.catch((failure) => Effect.die(failure.cause ?? failure)))
  )
  const finish = (signal?: string): void => {
    if (settled) {
      return
    }
    settled = true
    Effect.runFork(Fiber.interrupt(naturalExitFiber))
    running = false
    Effect.runSync(
      Deferred.succeed(
        exitState,
        new PtyExitStatus({
          code: options.exit.code,
          ...(signal === undefined
            ? options.exit.signal === undefined
              ? {}
              : { signal: options.exit.signal }
            : { signal })
        })
      ).pipe(Effect.asVoid)
    )
  }
  const fail = (error: unknown): void => {
    if (settled) {
      return
    }
    settled = true
    Effect.runFork(Fiber.interrupt(naturalExitFiber))
    running = false
    Effect.runSync(
      Deferred.fail(exitState, new PtyFakeChildFailure({ cause: error })).pipe(Effect.asVoid)
    )
  }
  const naturalExitFiber = Effect.runFork(
    Effect.sleep(options.naturalExitDelayMs ?? 0).pipe(
      Effect.andThen(
        Effect.sync(() => {
          if (options.exitError === undefined) {
            finish()
          } else {
            fail(options.exitError)
          }
        })
      )
    )
  )

  return {
    pid: Option.some(42),
    output: readableFromStrings(options.output, options.keepOutputOpen ?? false),
    exited,
    writes,
    resizes,
    kills,
    get terminateTreeCalls() {
      return terminateTreeCalls
    },
    get forceKillTreeCalls() {
      return forceKillTreeCalls
    },
    get killedWith() {
      return killedWith
    },
    write: (chunk) => {
      writes.push(chunk)
      return Promise.resolve()
    },
    resize: (size) => {
      resizes.push(size)
      return Promise.resolve()
    },
    isRunning: () => running,
    terminateTree: () => {
      terminateTreeCalls += 1
      if (options.terminateError !== undefined) {
        return Promise.reject(options.terminateError)
      }
      return killFakeChild("SIGTERM")
    },
    forceKillTree: () => {
      forceKillTreeCalls += 1
      if (options.forceKillError !== undefined) {
        return Promise.reject(options.forceKillError)
      }
      return killFakeChild("SIGKILL")
    },
    kill: (signal) => killFakeChild(signal ?? "SIGTERM")
  }

  function killFakeChild(signal: PtySignalInput): Promise<void> {
    killedWith = signal
    kills.push(killedWith)
    if (options.ignoreKill !== true && options.ignoredSignals?.includes(killedWith) !== true) {
      if (options.killExitDelayMs === undefined) {
        finish(String(killedWith))
      } else {
        const delayMs = options.killExitDelayMs
        return Effect.runPromise(
          Effect.sleep(delayMs).pipe(
            Effect.andThen(
              Effect.sync(() => {
                finish(String(killedWith))
              })
            )
          )
        )
      }
    }
    return Promise.resolve()
  }
}

const readableFromStrings = (
  chunks: readonly string[],
  keepOpen = false
): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(textEncoder.encode(chunk))
      }
      if (!keepOpen) {
        controller.close()
      }
    }
  })

const decodeChunks = (chunks: readonly Uint8Array[]): string => {
  const totalLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
  const bytes = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  return textDecoder.decode(bytes)
}

class PtyWaitUntilTimeout extends Schema.TaggedErrorClass<PtyWaitUntilTimeout>()(
  "PtyWaitUntilTimeout",
  { cause: Schema.optionalKey(Schema.Unknown) }
) {}

class PtyFakeChildFailure extends Schema.TaggedErrorClass<PtyFakeChildFailure>()(
  "PtyFakeChildFailure",
  { cause: Schema.optionalKey(Schema.Unknown) }
) {}

const waitUntil = <E>(
  predicate: Effect.Effect<boolean, E>
): Effect.Effect<void, PtyWaitUntilTimeout> =>
  predicate.pipe(
    Effect.mapError((cause) => new PtyWaitUntilTimeout({ cause })),
    Effect.flatMap(
      (ready): Effect.Effect<void, PtyWaitUntilTimeout> =>
        ready ? Effect.void : Effect.fail(new PtyWaitUntilTimeout())
    ),
    Effect.retry(Schedule.spaced("5 millis").pipe(Schedule.both(Schedule.recurs(200)))),
    Effect.mapError(() => new PtyWaitUntilTimeout())
  )

const fixedSequenceClock = (values: readonly number[]): (() => number) => {
  let index = 0
  return () => {
    const value = values[index] ?? values.at(-1)
    index += 1
    return value ?? 0
  }
}

const expectFailure = <E>(
  exit: Exit.Exit<unknown, E>,
  constructor: abstract new (...args: ReadonlyArray<never>) => E
): void => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const fail = exit.cause.reasons.find(Cause.isFailReason)
    expect(fail).toBeDefined()
    if (fail !== undefined) {
      expect(fail.error).toBeInstanceOf(constructor)
    }
  }
}
