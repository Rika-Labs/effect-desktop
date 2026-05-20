import { expect, test } from "bun:test"

import {
  HostProtocolBackpressureOverflowError,
  HostProtocolFileNotFoundError,
  HostProtocolInvalidArgumentError,
  HostProtocolPermissionDeniedError,
  HostProtocolResourceBusyError,
  HostProtocolStaleHandleError
} from "@orika/bridge"
import { BunServices } from "@effect/platform-bun"
import {
  Cause,
  Clock,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  ManagedRuntime,
  Option,
  Path,
  PlatformError,
  Schedule,
  Schema,
  Sink,
  Stream
} from "effect"
import { ChildProcessSpawner } from "effect/unstable/process"

import {
  makeExecutionInspectorCollector,
  type ExecutionInspectorCollectorApi
} from "./inspector-events.js"
import { PermissionActor } from "./permission-registry.js"
import { makeProcess, ProcessExitStatus } from "./process.js"
import type {
  ProcessApi,
  ProcessBudgetPolicy,
  ProcessPermissionPolicy,
  ProcessSignalInput
} from "./process.js"
import type { ResourceOwnerApi } from "./resource-owner.js"
import { makeResourceRegistry } from "./resources.js"
import type { ResourceRegistryApi } from "./resources.js"

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()
const processTest = process.platform === "win32" ? test.skip : test
const TEST_OWNER: ResourceOwnerApi = Object.freeze({
  kind: "test",
  scopeId: "scope-main",
  actor: new PermissionActor({ kind: "resource", id: "scope-main" }),
  attributes: Object.freeze({ scopeId: "scope-main" })
})

processTest("Process spawn exposes stdout and exit status", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fixture = yield* makeFixture(
        makeFakeSpawner(() => makeFakeChild({ exit: { code: 0 }, stdout: ["hi\n"] }))
      )

      const handle = yield* fixture.service.spawn("echo", ["hi"])
      const output = yield* handle.stdout.pipe(Stream.runCollect)
      const status = yield* handle.exit

      expect(decodeChunks([...output])).toBe("hi\n")
      expect(status).toEqual(new ProcessExitStatus({ code: 0 }))
    })
  )
)

processTest("Process spawn registers a scoped running resource", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fixture = yield* makeFixture(
        makeFakeSpawner(() => makeFakeChild({ exit: { code: 0 }, stdout: [] }))
      )

      const handle = yield* fixture.service.spawn("echo", ["hi"])
      const snapshot = yield* fixture.registry.list()

      expect(handle.resource.kind).toBe("process")
      expect(handle.resource.ownerScope).toBe("scope-main")
      expect(snapshot.entries.map((entry) => entry.handle)).toContainEqual({
        generation: handle.resource.generation,
        id: handle.resource.id,
        kind: handle.resource.kind,
        ownerScope: handle.resource.ownerScope,
        state: handle.resource.state
      })
    })
  )
)

processTest("Process publishes typed execution inspector events", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const inspector = yield* makeExecutionInspectorCollector()
      const fixture = yield* makeFixture(
        makeFakeSpawner(() => makeFakeChild({ exit: { code: 0 }, stdout: [] })),
        { inspector, now: incrementingClock(100) }
      )
      const observed = yield* Effect.forkChild(
        inspector.events.pipe(Stream.take(2), Stream.runCollect),
        { startImmediately: true }
      )
      yield* Effect.yieldNow

      const handle = yield* fixture.service.spawn("echo", ["hi"])
      yield* handle.exit

      const events = [...(yield* Fiber.join(observed))]
      expect(events.map((event) => [event.kind, event.status, event.operation])).toEqual([
        ["process", "start", "Process.spawn"],
        ["process", "success", "Process.spawn"]
      ])
      expect(events[1]?.resourceId).toBe(handle.resource.id)
      expect(events[1]?.pid).toBe(42)
    })
  )
)

processTest("Process exposes live devtools snapshots with pid, command, and exit", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fixture = yield* makeFixture(
        makeFakeSpawner(() => makeFakeChild({ exit: { code: 7 }, stdout: [] }))
      )
      const observed = yield* Effect.forkChild(
        fixture.service.observe().pipe(Stream.take(3), Stream.runCollect),
        { startImmediately: true }
      )

      const handle = yield* fixture.service.spawn("echo", ["hi"])
      yield* handle.exit

      const listed = yield* fixture.service.list()
      const snapshots = [...(yield* Fiber.join(observed))]
      const terminal = listed[0]

      expect(snapshots[0]).toEqual([])
      expect(snapshots[1]?.[0]).toMatchObject({
        args: ["hi"],
        command: "echo",
        pid: 42,
        state: "running"
      })
      expect(terminal?.state).toBe("exited")
      expect(Option.isSome(terminal?.lastExit ?? Option.none())).toBe(true)
      expect(snapshots[2]?.[0]?.state).toBe("exited")
    })
  )
)

processTest("Process removes the resource when a child exits without awaiting handle.exit", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fixture = yield* makeFixture(
        makeFakeSpawner(() => makeFakeChild({ exit: { code: 0 }, stdout: [] }))
      )

      yield* fixture.service.spawn("echo", ["hi"])
      yield* waitUntil(
        fixture.registry.list().pipe(Effect.map((snapshot) => snapshot.entries.length === 0))
      )
    })
  )
)

test("Process rejects non-finite graceful shutdown windows", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry()
      for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        const exit = yield* Effect.exit(
          makeProcess(registry, TEST_OWNER, { gracefulShutdownMs: value }).pipe(
            provideFakeSpawner()
          )
        )
        expectFailure(exit, HostProtocolInvalidArgumentError)
      }
    })
  ))

test("Process rejects non-positive graceful shutdown windows", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry()
      for (const value of [0, -1, -5000]) {
        const exit = yield* Effect.exit(
          makeProcess(registry, TEST_OWNER, { gracefulShutdownMs: value }).pipe(
            provideFakeSpawner()
          )
        )
        expectFailure(exit, HostProtocolInvalidArgumentError)
      }
    })
  ))

test("Process accepts a valid finite positive graceful shutdown window", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry()
      for (const value of [1, 0.5, Number.MIN_VALUE, 5000]) {
        const exit = yield* Effect.exit(
          makeProcess(registry, TEST_OWNER, { gracefulShutdownMs: value }).pipe(
            provideFakeSpawner()
          )
        )
        expect(Exit.isSuccess(exit)).toBe(true)
      }
    })
  ))

test("Process accepts the default graceful shutdown window when omitted", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry()
      const exit = yield* Effect.exit(makeProcess(registry, TEST_OWNER).pipe(provideFakeSpawner()))
      expect(Exit.isSuccess(exit)).toBe(true)
    })
  ))

test("Process rejects invalid snapshot capacities", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeResourceRegistry()
      for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        const exit = yield* Effect.exit(
          makeProcess(registry, TEST_OWNER, { maxSnapshots: value }).pipe(provideFakeSpawner())
        )
        expectFailure(exit, HostProtocolInvalidArgumentError)
      }
    })
  ))

test("Process rejects invalid budget options at service construction", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cases: readonly ProcessBudgetPolicy[] = [
        { maxConcurrent: 0 },
        { maxConcurrent: -1 },
        { maxConcurrent: 1.5 },
        { maxConcurrent: Number.NaN },
        { stdoutBufferBytes: 0 },
        { stdoutBufferBytes: Number.POSITIVE_INFINITY },
        { stderrBufferBytes: 0 },
        { stderrBufferBytes: Number.NaN }
      ]

      for (const budgets of cases) {
        const registry = yield* makeResourceRegistry()
        const exit = yield* Effect.exit(
          makeProcess(registry, TEST_OWNER, { budgets }).pipe(provideFakeSpawner())
        )
        expectFailure(exit, HostProtocolInvalidArgumentError)
      }
    })
  ))

processTest("Process spawn rejects invalid snapshot timestamps before adapter activity", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const now of invalidTimestamps) {
        let spawnCalls = 0
        const fixture = yield* makeFixture(
          makeFakeSpawner(() => {
            spawnCalls += 1
            return makeFakeChild({ exit: { code: 0 }, stdout: [] })
          }),
          { now: () => now }
        )

        const exit = yield* Effect.exit(fixture.service.spawn("echo", ["hi"]))

        expectFailure(exit, HostProtocolInvalidArgumentError)
        expect(spawnCalls).toBe(0)
        expect(yield* fixture.service.list()).toEqual([])
        expect((yield* fixture.registry.list()).entries).toEqual([])
      }
    })
  )
)

processTest("Process spawn failure timestamps fall back to the Effect Clock", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const timestamp = 1_715_001_234_000
      const inspector = yield* makeExecutionInspectorCollector()
      let spawnCalls = 0
      const fixture = yield* makeFixture(
        makeFakeSpawner(() => {
          spawnCalls += 1
          return makeFakeChild({ exit: { code: 0 }, stdout: [] })
        }),
        { inspector, now: () => Number.NaN }
      )
      const observed = yield* Effect.forkChild(
        inspector.events.pipe(Stream.take(1), Stream.runCollect),
        { startImmediately: true }
      )
      yield* Effect.yieldNow

      const exit = yield* Effect.exit(
        fixture.service
          .spawn("echo", ["hi"])
          .pipe(Effect.provideService(Clock.Clock, fixedClock(timestamp)))
      )
      const events = [...(yield* Fiber.join(observed))]

      expectFailure(exit, HostProtocolInvalidArgumentError)
      expect(spawnCalls).toBe(0)
      expect(events[0]?.status).toBe("failure")
      expect(events[0]?.timestamp).toBe(timestamp)
    })
  )
)

processTest("Process spawn denies binaries by default before adapter activity", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let spawnCalls = 0
      const registry = yield* makeResourceRegistry()
      const service = yield* makeProcess(registry, TEST_OWNER).pipe(
        Effect.provideService(
          ChildProcessSpawner.ChildProcessSpawner,
          makeFakeSpawner(() => {
            spawnCalls += 1
            return makeFakeChild({ exit: { code: 0 }, stdout: [] })
          })
        )
      )

      const exit = yield* Effect.exit(service.spawn("git", ["status"]))

      expect(spawnCalls).toBe(0)
      expectFailure(exit, HostProtocolPermissionDeniedError)
    })
  )
)

processTest("Process spawn allows binaries declared in the process.spawn policy", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let spawnCalls = 0
      const fixture = yield* makeFixture(
        makeFakeSpawner(() => {
          spawnCalls += 1
          return makeFakeChild({ exit: { code: 0 }, stdout: [] })
        }),
        { permissions: { spawn: ["git"] } }
      )

      yield* fixture.service.spawn("git", ["status"])

      expect(spawnCalls).toBe(1)
    })
  )
)

processTest("Process spawn denies binaries outside the process.spawn policy", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let spawnCalls = 0
      const fixture = yield* makeFixture(
        makeFakeSpawner(() => {
          spawnCalls += 1
          return makeFakeChild({ exit: { code: 0 }, stdout: [] })
        }),
        { permissions: { spawn: ["git"] } }
      )

      const exit = yield* Effect.exit(fixture.service.spawn("rm", ["-rf", "/tmp/project"]))

      expect(spawnCalls).toBe(0)
      expectFailure(exit, HostProtocolPermissionDeniedError)
    })
  )
)

processTest("Process spawn rejects argv0 shell metacharacters before permission lookup", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let spawnCalls = 0
      const fixture = yield* makeFixture(
        makeFakeSpawner(() => {
          spawnCalls += 1
          return makeFakeChild({ exit: { code: 0 }, stdout: [] })
        }),
        { permissions: { spawn: ["git;ls"] } }
      )

      const exit = yield* Effect.exit(fixture.service.spawn("git;ls", []))

      expect(spawnCalls).toBe(0)
      expectFailure(exit, HostProtocolInvalidArgumentError)
    })
  )
)

processTest("Process spawn rejects NUL bytes in environment names", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let spawnCalls = 0
      const fixture = yield* makeFixture(
        makeFakeSpawner(() => {
          spawnCalls += 1
          return makeFakeChild({ exit: { code: 0 }, stdout: [] })
        }),
        { permissions: { spawn: ["echo"] } }
      )
      const nul = String.fromCodePoint(0)

      const exit = yield* Effect.exit(
        fixture.service.spawn("echo", ["hi"], {
          env: { [`key${nul}`]: "value" }
        })
      )

      expect(spawnCalls).toBe(0)
      expectFailure(exit, HostProtocolInvalidArgumentError)
    })
  )
)

processTest("Process spawn rejects empty environment names before adapter activity", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let spawnCalls = 0
      const fixture = yield* makeFixture(
        makeFakeSpawner(() => {
          spawnCalls += 1
          return makeFakeChild({ exit: { code: 0 }, stdout: [] })
        }),
        { permissions: { spawn: ["echo"] } }
      )

      const exit = yield* Effect.exit(
        fixture.service.spawn("echo", ["hi"], {
          env: { "": "value" }
        })
      )

      expect(spawnCalls).toBe(0)
      expectFailure(exit, HostProtocolInvalidArgumentError)
    })
  )
)

processTest("Process spawn rejects NUL bytes in environment values", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let spawnCalls = 0
      const fixture = yield* makeFixture(
        makeFakeSpawner(() => {
          spawnCalls += 1
          return makeFakeChild({ exit: { code: 0 }, stdout: [] })
        }),
        { permissions: { spawn: ["echo"] } }
      )
      const nul = String.fromCodePoint(0)

      const exit = yield* Effect.exit(
        fixture.service.spawn("echo", ["hi"], {
          env: { key: `value${nul}` }
        })
      )

      expect(spawnCalls).toBe(0)
      expectFailure(exit, HostProtocolInvalidArgumentError)
    })
  )
)

processTest("Process spawn requires process.shell when shell mode is requested", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let spawnCalls = 0
      const fixture = yield* makeFixture(
        makeFakeSpawner(() => {
          spawnCalls += 1
          return makeFakeChild({ exit: { code: 0 }, stdout: [] })
        }),
        { permissions: { spawn: ["sh"] } }
      )

      const exit = yield* Effect.exit(
        fixture.service.spawn("sh", ["-c", "echo hi"], {
          shell: true
        })
      )

      expect(spawnCalls).toBe(0)
      expectFailure(exit, HostProtocolPermissionDeniedError)
    })
  )
)

processTest("Process spawn allows shell mode with process.shell permission", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let spawnCalls = 0
      const fixture = yield* makeFixture(
        makeFakeSpawner(() => {
          spawnCalls += 1
          return makeFakeChild({ exit: { code: 0 }, stdout: [] })
        }),
        { permissions: { shell: true, spawn: ["sh"] } }
      )

      yield* fixture.service.spawn("sh", ["-c", "echo hi"], {
        shell: true
      })

      expect(spawnCalls).toBe(1)
    })
  )
)

processTest("Process spawn enforces the per-scope concurrent process budget", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let spawnCalls = 0
      const fixture = yield* makeFixture(
        makeFakeSpawner(() => {
          spawnCalls += 1
          return makeFakeChild({
            exit: { code: 0 },
            ignoreTerminate: true,
            naturalExitDelayMs: 60_000,
            stdout: []
          })
        }),
        { budgets: { maxConcurrent: 2 }, gracefulShutdownMs: 1 }
      )

      yield* fixture.service.spawn("sleep", ["30"])
      yield* fixture.service.spawn("sleep", ["30"])
      const exit = yield* Effect.exit(fixture.service.spawn("sleep", ["30"]))
      yield* fixture.registry.closeScope("scope-main")

      expect(spawnCalls).toBe(2)
      expectFailure(exit, HostProtocolResourceBusyError)
    })
  )
)

processTest("Process spawn reserves budget across parallel spawns", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let spawnCalls = 0
      const fixture = yield* makeFixture(
        makeFakeSpawner(() => {
          spawnCalls += 1
          return makeFakeChild({
            exit: { code: 0 },
            ignoreTerminate: true,
            naturalExitDelayMs: 60_000,
            stdout: []
          })
        }),
        { budgets: { maxConcurrent: 1 }, gracefulShutdownMs: 1 }
      )

      const exits = yield* Effect.all(
        [
          Effect.exit(fixture.service.spawn("sleep", ["30"])),
          Effect.exit(fixture.service.spawn("sleep", ["30"]))
        ],
        { concurrency: "unbounded" }
      )
      yield* fixture.registry.closeScope("scope-main")

      expect(spawnCalls).toBe(1)
      expect(exits.filter(Exit.isSuccess)).toHaveLength(1)
      const failure = exits.find(Exit.isFailure)
      expect(failure).toBeDefined()
      if (failure !== undefined) {
        expectFailure(failure, HostProtocolResourceBusyError)
      }
    })
  )
)

processTest("Process spawn releases budget after child exit", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let spawnCalls = 0
      const fixture = yield* makeFixture(
        makeFakeSpawner(() => {
          spawnCalls += 1
          return makeFakeChild({ exit: { code: 0 }, stdout: [] })
        }),
        { budgets: { maxConcurrent: 1 } }
      )

      yield* fixture.service.spawn("echo", ["hi"])
      yield* waitUntil(
        fixture.registry.list().pipe(Effect.map((snapshot) => snapshot.entries.length === 0))
      )
      yield* fixture.service.spawn("echo", ["hi"])

      expect(spawnCalls).toBe(2)
    })
  )
)

processTest("Process spawn releases budget after adapter failure", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let spawnCalls = 0
      const fixture = yield* makeFixture(
        ChildProcessSpawner.make(() => {
          spawnCalls += 1
          if (spawnCalls === 1) {
            return Effect.fail(
              PlatformError.systemError({
                _tag: "NotFound",
                method: "spawn",
                module: "ChildProcessSpawner"
              })
            )
          }
          return Effect.succeed(makeFakeChild({ exit: { code: 0 }, stdout: [] }))
        }),
        { budgets: { maxConcurrent: 1 } }
      )

      const failed = yield* Effect.exit(fixture.service.spawn("definitely-missing", []))
      yield* fixture.service.spawn("sleep", ["1"])

      expectFailure(failed, HostProtocolFileNotFoundError)
      expect(spawnCalls).toBe(2)
    })
  )
)

processTest("Process stdout fails with BackpressureOverflow when a chunk exceeds budget", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fixture = yield* makeFixture(
        makeFakeSpawner(() => makeFakeChild({ exit: { code: 0 }, stdout: ["abcd"] })),
        { budgets: { stdoutBufferBytes: 3 } }
      )
      const handle = yield* fixture.service.spawn("echo", ["abcd"])

      const exit = yield* Effect.exit(handle.stdout.pipe(Stream.runCollect))

      expectFailure(exit, HostProtocolBackpressureOverflowError)
    })
  )
)

processTest("Process stdout allows cumulative output beyond budget when the consumer drains", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fixture = yield* makeFixture(
        makeFakeSpawner(() =>
          makeFakeChild({
            exit: { code: 0 },
            stdout: ["ab", "cd"],
            stdoutChunkDelayMs: 5
          })
        ),
        { budgets: { stdoutBufferBytes: 3 } }
      )
      const handle = yield* fixture.service.spawn("echo", ["abcd"])

      const chunks = yield* handle.stdout.pipe(Stream.runCollect)

      expect(decodeChunks([...chunks])).toBe("abcd")
    })
  )
)

processTest("Process stdout fails with BackpressureOverflow when queued chunks exceed budget", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fixture = yield* makeFixture(
        makeFakeSpawner(() => makeFakeChild({ exit: { code: 0 }, stdout: ["ab", "cd"] })),
        { budgets: { stdoutBufferBytes: 3 } }
      )
      const handle = yield* fixture.service.spawn("echo", ["abcd"])

      const exit = yield* Effect.exit(
        handle.stdout.pipe(
          Stream.tap(() => Effect.sleep("25 millis")),
          Stream.runDrain
        )
      )

      expectFailure(exit, HostProtocolBackpressureOverflowError)
    })
  )
)

processTest("Process stderr fails with BackpressureOverflow when a chunk exceeds budget", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fixture = yield* makeFixture(
        makeFakeSpawner(() => makeFakeChild({ exit: { code: 0 }, stderr: ["abcd"], stdout: [] })),
        { budgets: { stderrBufferBytes: 3 } }
      )
      const handle = yield* fixture.service.spawn("echo", ["abcd"])

      const exit = yield* Effect.exit(handle.stderr.pipe(Stream.runCollect))

      expectFailure(exit, HostProtocolBackpressureOverflowError)
    })
  )
)

processTest("Process stderr allows cumulative output beyond budget when the consumer drains", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fixture = yield* makeFixture(
        makeFakeSpawner(() =>
          makeFakeChild({
            exit: { code: 0 },
            stderr: ["ab", "cd"],
            stderrChunkDelayMs: 5,
            stdout: []
          })
        ),
        { budgets: { stderrBufferBytes: 3 } }
      )
      const handle = yield* fixture.service.spawn("echo", ["abcd"])

      const chunks = yield* handle.stderr.pipe(Stream.runCollect)

      expect(decodeChunks([...chunks])).toBe("abcd")
    })
  )
)

processTest("Process spawn maps missing executable to FileNotFound", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fixture = yield* makeFixture(makeFailingSpawner("NotFound"))

      const exit = yield* Effect.exit(fixture.service.spawn("definitely-missing", []))

      expectFailure(exit, HostProtocolFileNotFoundError)
    })
  )
)

processTest("Process stdin sink writes chunks and closes when the sink completes", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const child = makeFakeChild({ exit: { code: 0 }, stdout: [] })
      const fixture = yield* makeFixture(makeFakeSpawner(() => child))
      const handle = yield* fixture.service.spawn("cat", [])

      yield* Stream.make(textEncoder.encode("abc")).pipe(Stream.run(handle.stdin))

      expect(decodeChunks(child.stdinWrites)).toBe("abc")
      expect(child.stdinClosed).toBe(true)
    })
  )
)

processTest("Process stdin sink keeps child stdin open across chunks", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const child = makeFakeChild({ exit: { code: 0 }, stdout: [] })
      const fixture = yield* makeFixture(makeFakeSpawner(() => child))
      const handle = yield* fixture.service.spawn("cat", [])

      yield* Stream.make(textEncoder.encode("abc"), textEncoder.encode("def")).pipe(
        Stream.run(handle.stdin)
      )

      expect(decodeChunks(child.stdinWrites)).toBe("abcdef")
      expect(child.stdinCloseCount).toBe(1)
      expect(child.stdinClosed).toBe(true)
    })
  )
)

processTest("Process stdin rejects non-byte chunks without writing bytes", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const child = makeFakeChild({ exit: { code: 0 }, stdout: [] })
      const fixture = yield* makeFixture(makeFakeSpawner(() => child))
      const handle = yield* fixture.service.spawn("cat", [])

      const exit = yield* Effect.exit(Stream.make("abc").pipe(Stream.run(handle.stdin)))

      expect(child.stdinWrites).toEqual([])
      expectFailure(exit, HostProtocolInvalidArgumentError)
    })
  )
)

processTest("Process kill returns a typed effect and exit preserves the signal", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const child = makeFakeChild({ exit: { code: 0 }, stdout: [] })
      const fixture = yield* makeFixture(makeFakeSpawner(() => child))
      const handle = yield* fixture.service.spawn("sleep", ["10"])

      yield* handle.kill("SIGTERM")
      const status = yield* handle.exit

      expect(child.killedWith).toBe("SIGTERM")
      expect(status).toEqual(new ProcessExitStatus({ code: 0, signal: "SIGTERM" }))
    })
  )
)

processTest("Process kill preserves the actual child exit result", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const child = makeFakeChild({
        exit: { code: 143, signal: "SIGTERM" },
        killExit: { code: 0 },
        stdout: []
      })
      const fixture = yield* makeFixture(makeFakeSpawner(() => child))
      const handle = yield* fixture.service.spawn("sleep", ["10"])

      yield* handle.kill("SIGTERM")
      const status = yield* handle.exit

      expect(child.killedWith).toBe("SIGTERM")
      expect(status).toEqual(new ProcessExitStatus({ code: 0 }))
    })
  )
)

processTest("Process kill rejects control bytes in signal names", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const child = makeFakeChild({ exit: { code: 0 }, stdout: [] })
      const fixture = yield* makeFixture(makeFakeSpawner(() => child))
      const handle = yield* fixture.service.spawn("sleep", ["10"])
      const nul = String.fromCodePoint(0)

      const exit = yield* Effect.exit(handle.kill(`SIG${nul}TERM`))

      expectFailure(exit, HostProtocolInvalidArgumentError)
      expect(child.killedWith).toBeUndefined()
    })
  )
)

processTest("Process kill rejects handles after process exit", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const child = makeFakeChild({ exit: { code: 0 }, stdout: [] })
      const fixture = yield* makeFixture(makeFakeSpawner(() => child))
      const handle = yield* fixture.service.spawn("sleep", ["10"])
      yield* handle.exit
      yield* waitUntil(
        fixture.registry.list().pipe(Effect.map((snapshot) => snapshot.entries.length === 0))
      )

      const exit = yield* Effect.exit(handle.kill("SIGTERM"))

      expect(child.kills).toEqual([])
      expectFailure(exit, HostProtocolStaleHandleError)
    })
  )
)

processTest("Process exit rejects invalid snapshot timestamps before publishing exit state", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const now of invalidTimestamps) {
        let currentTime = 1000
        const fixture = yield* makeFixture(
          makeFakeSpawner(() =>
            makeFakeChild({
              exit: { code: 0 },
              naturalExitDelayMs: 10,
              stdout: []
            })
          ),
          { now: () => currentTime }
        )
        const observed = yield* Effect.forkChild(
          fixture.service.observe().pipe(Stream.take(2), Stream.runCollect),
          { startImmediately: true }
        )
        const handle = yield* fixture.service.spawn("echo", ["hi"])
        currentTime = now

        const exit = yield* Effect.exit(handle.exit)
        const listed = yield* fixture.service.list()
        const snapshots = [...(yield* Fiber.join(observed))]

        expectFailure(exit, HostProtocolInvalidArgumentError)
        expect(listed[0]?.state).toBe("running")
        expect(listed[0]?.updatedAt).toBe(1000)
        expect(snapshots.at(-1)?.[0]?.state).toBe("running")
        expect(snapshots.at(-1)?.[0]?.updatedAt).toBe(1000)
      }
    })
  )
)

processTest("Process kill rejects handles after scope close", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const child = makeFakeChild({
        exit: { code: 0 },
        naturalExitDelayMs: 60_000,
        stdout: []
      })
      const fixture = yield* makeFixture(makeFakeSpawner(() => child))
      const handle = yield* fixture.service.spawn("sleep", ["10"])
      yield* fixture.registry.closeScope("scope-main")

      const exit = yield* Effect.exit(handle.kill("SIGKILL"))

      expect(child.kills).toEqual(["SIGTERM"])
      expect(child.treeTerminated).toBe(true)
      expectFailure(exit, HostProtocolStaleHandleError)
    })
  )
)

processTest("Process scope close interrupts the scoped exit observer", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const child = makeFakeChild({
        completeExitOnKill: false,
        exit: { code: 0 },
        naturalExitDelayMs: 60_000,
        stdout: []
      })
      const fixture = yield* makeFixture(
        makeFakeSpawner(() => child),
        { gracefulShutdownMs: 50 }
      )

      yield* fixture.service.spawn("sleep", ["30"])
      yield* fixture.registry.closeScope("scope-main")

      expect(child.kills).toEqual(["SIGTERM"])
      expect(child.exitCodeInterrupted).toBe(true)
      expect((yield* fixture.registry.list()).entries).toEqual([])
    })
  )
)

if (process.platform !== "win32") {
  processTest("Process scope close asks the process tree to terminate and waits for exit", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const child = makeFakeChild({
          exit: { code: 0 },
          naturalExitDelayMs: 60_000,
          stdout: []
        })
        const fixture = yield* makeFixture(
          makeFakeSpawner(() => child),
          { gracefulShutdownMs: 50 }
        )

        yield* fixture.service.spawn("sleep", ["30"])
        yield* fixture.registry.closeScope("scope-main")

        expect(child.treeTerminated).toBe(true)
        expect(child.treeForceKilled).toBe(false)
      })
    )
  )

  processTest("Process scope close force-kills the tree after the grace window", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const child = makeFakeChild({
          exit: { code: 0 },
          ignoreTerminate: true,
          naturalExitDelayMs: 60_000,
          stdout: []
        })
        const fixture = yield* makeFixture(
          makeFakeSpawner(() => child),
          { gracefulShutdownMs: 1 }
        )

        yield* fixture.service.spawn("sleep", ["30"])
        yield* fixture.registry.closeScope("scope-main")

        expect(child.treeTerminated).toBe(true)
        expect(child.treeForceKilled).toBe(true)
      })
    )
  )

  processTest("Process scope close suppresses kill failures", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const child = makeFakeChild({
          exit: { code: 0 },
          killError: PlatformError.systemError({
            _tag: "Unknown",
            description: "kill failed",
            method: "kill",
            module: "ChildProcessSpawner"
          }),
          naturalExitDelayMs: 60_000,
          stdout: []
        })
        const fixture = yield* makeFixture(
          makeFakeSpawner(() => child),
          { gracefulShutdownMs: 1 }
        )

        yield* fixture.service.spawn("sleep", ["30"])
        yield* fixture.registry.closeScope("scope-main")

        expect(child.kills).toEqual(["SIGTERM"])
        expect(child.treeTerminated).toBe(true)
        expect(yield* child.isRunning).toBe(true)
        expect((yield* fixture.registry.list()).entries).toEqual([])
      })
    )
  )

  processTest("Process spawn works against Bun for stdout and exit code", () =>
    Effect.runPromise(
      runScoped(
        Effect.gen(function* () {
          const fixture = yield* makeFixture()
          const handle = yield* fixture.service.spawn(process.execPath, [
            "--eval",
            "process.stdout.write('hi\\n')"
          ])

          try {
            yield* Stream.empty.pipe(Stream.run(handle.stdin))
            const output = yield* handle.stdout.pipe(Stream.runCollect)
            const status = yield* handle.exit

            expect(decodeChunks([...output])).toBe("hi\n")
            expect(status.code).toBe(0)
          } finally {
            yield* fixture.registry.closeScope("scope-main")
          }
        }),
        BunServices.layer
      )
    )
  )

  processTest("Process scope close terminates descendants in the spawned process group", () =>
    Effect.runPromise(
      runScoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const pathService = yield* Path.Path
          const directory = yield* fs.makeTempDirectory({ prefix: "effect-desktop-process-" })
          const pidFile = pathService.join(directory, "children.txt")
          const fixture = yield* makeFixture(undefined, { gracefulShutdownMs: 50 })
          try {
            yield* fixture.service.spawn(
              "/bin/sh",
              [
                "-c",
                `sleep 30 & echo $! > ${shellQuote(pidFile)}; sleep 30 & echo $! >> ${shellQuote(
                  pidFile
                )}; wait`
              ],
              {}
            )
            const childPids = yield* waitForChildPids(pidFile)

            yield* fixture.registry.closeScope("scope-main")
            yield* waitUntil(Effect.sync(() => childPids.every((pid) => !isProcessAlive(pid))))

            expect(childPids).toHaveLength(2)
          } finally {
            yield* fs.remove(directory, { force: true, recursive: true })
          }
        }),
        BunServices.layer
      )
    )
  )
}

interface ProcessFixtureOptions {
  readonly budgets?: ProcessBudgetPolicy
  readonly gracefulShutdownMs?: number
  readonly inspector?: ExecutionInspectorCollectorApi
  readonly maxSnapshots?: number
  readonly now?: () => number
  readonly permissions?: ProcessPermissionPolicy
}

type ProcessFixture = {
  readonly registry: ResourceRegistryApi
  readonly service: ProcessApi
}

function makeFixture(
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  options?: ProcessFixtureOptions
): Effect.Effect<ProcessFixture, HostProtocolInvalidArgumentError>
function makeFixture(
  spawner?: undefined,
  options?: ProcessFixtureOptions
): Effect.Effect<
  ProcessFixture,
  HostProtocolInvalidArgumentError,
  ChildProcessSpawner.ChildProcessSpawner
>
function makeFixture(
  spawner?: ChildProcessSpawner.ChildProcessSpawner["Service"],
  options: ProcessFixtureOptions = {}
): Effect.Effect<
  ProcessFixture,
  HostProtocolInvalidArgumentError,
  ChildProcessSpawner.ChildProcessSpawner
> {
  return Effect.gen(function* () {
    const registry = yield* makeResourceRegistry()
    const resolvedSpawner = spawner ?? (yield* ChildProcessSpawner.ChildProcessSpawner.asEffect())
    const service = yield* makeService(registry, resolvedSpawner, options)
    return { registry, service }
  })
}

const makeService = (
  registry: ResourceRegistryApi,
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  options: ProcessFixtureOptions = {}
): Effect.Effect<ProcessApi, HostProtocolInvalidArgumentError> =>
  makeProcess(registry, TEST_OWNER, {
    ...(options.budgets === undefined ? {} : { budgets: options.budgets }),
    permissions: options.permissions ?? ALLOW_TEST_PROCESS_PERMISSIONS,
    ...(options.gracefulShutdownMs === undefined
      ? {}
      : { gracefulShutdownMs: options.gracefulShutdownMs }),
    ...(options.inspector === undefined ? {} : { inspector: options.inspector }),
    ...(options.maxSnapshots === undefined ? {} : { maxSnapshots: options.maxSnapshots }),
    ...(options.now === undefined ? {} : { now: options.now })
  }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner))

const ALLOW_TEST_PROCESS_PERMISSIONS: ProcessPermissionPolicy = {
  spawn: ["echo", "sleep", "cat", "definitely-missing", process.execPath, "/bin/sh"]
}

const invalidTimestamps = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 1.5]

const provideFakeSpawner = () =>
  Effect.provideService(
    ChildProcessSpawner.ChildProcessSpawner,
    makeFakeSpawner(() => makeFakeChild({ exit: { code: 0 }, stdout: [] }))
  )

const makeFakeSpawner = (
  makeChild: () => FakeChild
): ChildProcessSpawner.ChildProcessSpawner["Service"] =>
  ChildProcessSpawner.make(() => Effect.succeed(makeChild()))

const makeFailingSpawner = (
  tag: PlatformError.SystemErrorTag
): ChildProcessSpawner.ChildProcessSpawner["Service"] =>
  ChildProcessSpawner.make(() =>
    Effect.fail(
      PlatformError.systemError({
        _tag: tag,
        method: "spawn",
        module: "ChildProcessSpawner"
      })
    )
  )

interface FakeChild extends ChildProcessSpawner.ChildProcessHandle {
  readonly stdinWrites: Uint8Array[]
  readonly stdinClosed: boolean
  readonly stdinCloseCount: number
  readonly killedWith: ProcessSignalInput | undefined
  readonly kills: ProcessSignalInput[]
  readonly exitCodeInterrupted: boolean
  readonly treeTerminated: boolean
  readonly treeForceKilled: boolean
}

const makeFakeChild = (options: {
  readonly stdout: readonly string[]
  readonly stderr?: readonly string[]
  readonly exit: { readonly code: number; readonly signal?: string }
  readonly killExit?: { readonly code: number; readonly signal?: string }
  readonly killError?: PlatformError.PlatformError
  readonly naturalExitDelayMs?: number
  readonly ignoreTerminate?: boolean
  readonly completeExitOnKill?: boolean
  readonly stdoutChunkDelayMs?: number
  readonly stderrChunkDelayMs?: number
}): FakeChild => {
  const stdinWrites: Uint8Array[] = []
  let stdinClosed = false
  let stdinCloseCount = 0
  let killedWith: ProcessSignalInput | undefined
  const kills: ProcessSignalInput[] = []
  let treeTerminated = false
  let treeForceKilled = false
  let exitCodeInterrupted = false
  let running = true
  let settled = false
  const exitState = Effect.runSync(Deferred.make<ProcessExitStatus>())
  const finish = (
    status: { readonly code: number; readonly signal?: string } = options.exit,
    interruptNaturalExit = true
  ): Effect.Effect<void> =>
    Effect.sync(() => {
      if (settled) {
        return false
      }
      settled = true
      running = false
      return true
    }).pipe(
      Effect.flatMap((shouldComplete) =>
        shouldComplete
          ? Deferred.succeed(exitState, new ProcessExitStatus(status)).pipe(
              Effect.andThen(interruptNaturalExit ? Fiber.interrupt(naturalExitFiber) : Effect.void)
            )
          : Effect.void
      ),
      Effect.asVoid
    )
  const naturalExitFiber = Effect.runFork(
    Effect.sleep(options.naturalExitDelayMs ?? 0).pipe(Effect.andThen(finish(options.exit, false)))
  )

  const child = ChildProcessSpawner.makeHandle({
    all: streamBytes(options.stdout, options.stdoutChunkDelayMs),
    exitCode: Deferred.await(exitState).pipe(
      Effect.onInterrupt(() =>
        Effect.sync(() => {
          exitCodeInterrupted = true
        })
      ),
      Effect.flatMap((status) =>
        status.signal === undefined
          ? Effect.succeed(ChildProcessSpawner.ExitCode(status.code))
          : Effect.fail(
              PlatformError.systemError({
                _tag: "Unknown",
                description: `Process interrupted due to receipt of signal: '${status.signal}'`,
                method: "exitCode",
                module: "ChildProcessSpawner"
              })
            )
      )
    ),
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    isRunning: Effect.sync(() => running),
    kill: (killOptions) => {
      const signal = killOptions?.killSignal ?? "SIGTERM"
      killedWith = signal
      kills.push(signal)
      if (signal === "SIGTERM") {
        treeTerminated = true
      }
      if (options.killError !== undefined) {
        return Effect.fail(options.killError)
      }
      if (options.ignoreTerminate === true && signal === "SIGTERM") {
        if (killOptions?.forceKillAfter === undefined) {
          return Effect.never
        }
        treeForceKilled = true
        killedWith = "SIGKILL"
        kills.push("SIGKILL")
        return finish({ code: options.exit.code, signal: "SIGKILL" })
      }
      if (options.completeExitOnKill === false) {
        running = false
        return Effect.void
      }
      return finish(options.killExit ?? { code: options.exit.code, signal })
    },
    pid: ChildProcessSpawner.ProcessId(42),
    stderr: streamBytes(options.stderr ?? [], options.stderrChunkDelayMs),
    stdin: Sink.forEach((chunk: Uint8Array) =>
      Effect.gen(function* writeStdinChunk() {
        if (stdinClosed) {
          return yield* PlatformError.systemError({
            _tag: "Unknown",
            description: "stdin was written after close",
            method: "stdin",
            module: "ChildProcessSpawner"
          })
        }
        stdinWrites.push(chunk)
      })
    ).pipe(
      Sink.ensuring(
        Effect.sync(() => {
          stdinClosed = true
          stdinCloseCount += 1
        })
      )
    ),
    stdout: streamBytes(options.stdout, options.stdoutChunkDelayMs),
    unref: Effect.succeed(Effect.void)
  }) as FakeChild

  Object.defineProperties(child, {
    killedWith: { get: () => killedWith },
    kills: { value: kills },
    exitCodeInterrupted: { get: () => exitCodeInterrupted },
    stdinCloseCount: { get: () => stdinCloseCount },
    stdinClosed: { get: () => stdinClosed },
    stdinWrites: { value: stdinWrites },
    treeForceKilled: { get: () => treeForceKilled },
    treeTerminated: { get: () => treeTerminated }
  })

  return child
}

const streamBytes = (chunks: readonly string[], chunkDelayMs?: number): Stream.Stream<Uint8Array> =>
  Stream.fromIterable(chunks).pipe(
    Stream.tap(() =>
      chunkDelayMs === undefined ? Effect.void : Effect.sleep(`${chunkDelayMs} millis`)
    ),
    Stream.map((chunk) => textEncoder.encode(chunk))
  )

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

class ProcessWaitUntilTimeout extends Schema.TaggedErrorClass<ProcessWaitUntilTimeout>()(
  "ProcessWaitUntilTimeout",
  { cause: Schema.optionalKey(Schema.Unknown) }
) {}

const waitUntil = <E>(
  predicate: Effect.Effect<boolean, E>
): Effect.Effect<void, ProcessWaitUntilTimeout> =>
  predicate.pipe(
    Effect.mapError((cause) => new ProcessWaitUntilTimeout({ cause })),
    Effect.flatMap(
      (ready): Effect.Effect<void, ProcessWaitUntilTimeout> =>
        ready ? Effect.void : Effect.fail(new ProcessWaitUntilTimeout())
    ),
    Effect.retry(Schedule.spaced("10 millis").pipe(Schedule.both(Schedule.recurs(50)))),
    Effect.mapError(() => new ProcessWaitUntilTimeout())
  )

const incrementingClock = (start: number): (() => number) => {
  let current = start
  return () => {
    current += 1
    return current
  }
}

const fixedClock = (timestamp: number): Clock.Clock => ({
  currentTimeMillisUnsafe: () => timestamp,
  currentTimeMillis: Effect.succeed(timestamp),
  currentTimeNanosUnsafe: () => BigInt(timestamp) * 1_000_000n,
  currentTimeNanos: Effect.succeed(BigInt(timestamp) * 1_000_000n),
  sleep: () => Effect.void
})

const waitForChildPids = (
  path: string
): Effect.Effect<readonly number[], ProcessWaitUntilTimeout, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    let pids: readonly number[] = []
    const readPids = fs.readFileString(path, "utf8").pipe(
      Effect.map((contents) => {
        pids = contents
          .trim()
          .split("\n")
          .filter((line) => line.length > 0)
          .map((line) => Number.parseInt(line, 10))
        return pids.length === 2 && pids.every(Number.isSafeInteger)
      }),
      Effect.catch((error) =>
        error._tag === "PlatformError" && error.reason._tag === "NotFound"
          ? Effect.succeed(false)
          : Effect.die(error)
      )
    )
    yield* waitUntil(readPids)
    return pids
  })

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (isNodeErrorCode(error, "ESRCH")) {
      return false
    }
    throw error
  }
}

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`

const isNodeErrorCode = (error: unknown, code: string): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === code

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

const expectFailure = <E>(
  exit: Exit.Exit<unknown, E>,
  constructor: abstract new (...args: readonly never[]) => E
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
