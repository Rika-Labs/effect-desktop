import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  HostProtocolBackpressureOverflowError,
  HostProtocolFileNotFoundError,
  HostProtocolInvalidArgumentError,
  HostProtocolPermissionDeniedError,
  HostProtocolResourceBusyError,
  HostProtocolStaleHandleError
} from "@effect-desktop/bridge"
import { BunServices } from "@effect/platform-bun"
import { Cause, Deferred, Effect, Exit, Fiber, Option, PlatformError, Sink, Stream } from "effect"
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

processTest("Process spawn exposes stdout and exit status", async () => {
  const fixture = await makeFixture(
    makeFakeSpawner(() => makeFakeChild({ exit: { code: 0 }, stdout: ["hi\n"] }))
  )

  const handle = await Effect.runPromise(fixture.service.spawn("echo", ["hi"]))
  const output = await Effect.runPromise(handle.stdout.pipe(Stream.runCollect))
  const status = await Effect.runPromise(handle.exit)

  expect(decodeChunks([...output])).toBe("hi\n")
  expect(status).toEqual(new ProcessExitStatus({ code: 0 }))
})

processTest("Process spawn registers a scoped running resource", async () => {
  const fixture = await makeFixture(
    makeFakeSpawner(() => makeFakeChild({ exit: { code: 0 }, stdout: [] }))
  )

  const handle = await Effect.runPromise(fixture.service.spawn("echo", ["hi"]))
  const snapshot = await Effect.runPromise(fixture.registry.list())

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

processTest("Process publishes typed execution inspector events", async () => {
  const inspector = await Effect.runPromise(makeExecutionInspectorCollector())
  const fixture = await makeFixture(
    makeFakeSpawner(() => makeFakeChild({ exit: { code: 0 }, stdout: [] })),
    { inspector, now: incrementingClock(100) }
  )
  const observed = Effect.runFork(inspector.events.pipe(Stream.take(2), Stream.runCollect))
  await Bun.sleep(0)

  const handle = await Effect.runPromise(fixture.service.spawn("echo", ["hi"]))
  await Effect.runPromise(handle.exit)

  const events = [...(await Effect.runPromise(Fiber.join(observed)))]
  expect(events.map((event) => [event.kind, event.status, event.operation])).toEqual([
    ["process", "start", "Process.spawn"],
    ["process", "success", "Process.spawn"]
  ])
  expect(events[1]?.resourceId).toBe(handle.resource.id)
  expect(events[1]?.pid).toBe(42)
})

processTest("Process exposes live devtools snapshots with pid, command, and exit", async () => {
  const fixture = await makeFixture(
    makeFakeSpawner(() => makeFakeChild({ exit: { code: 7 }, stdout: [] }))
  )
  const observed = Effect.runFork(fixture.service.observe().pipe(Stream.take(3), Stream.runCollect))

  const handle = await Effect.runPromise(fixture.service.spawn("echo", ["hi"]))
  await Effect.runPromise(handle.exit)

  const listed = await Effect.runPromise(fixture.service.list())
  const snapshots = [...(await Effect.runPromise(Fiber.join(observed)))]
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

processTest(
  "Process removes the resource when a child exits without awaiting handle.exit",
  async () => {
    const fixture = await makeFixture(
      makeFakeSpawner(() => makeFakeChild({ exit: { code: 0 }, stdout: [] }))
    )

    await Effect.runPromise(fixture.service.spawn("echo", ["hi"]))
    await waitUntil(async () => {
      const snapshot = await Effect.runPromise(fixture.registry.list())
      return snapshot.entries.length === 0
    })
  }
)

test("Process rejects non-finite graceful shutdown windows", async () => {
  const registry = await Effect.runPromise(makeResourceRegistry())
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const exit = await Effect.runPromiseExit(
      makeProcess(registry, TEST_OWNER, { gracefulShutdownMs: value }).pipe(provideFakeSpawner())
    )
    expectFailure(exit, HostProtocolInvalidArgumentError)
  }
})

test("Process rejects non-positive graceful shutdown windows", async () => {
  const registry = await Effect.runPromise(makeResourceRegistry())
  for (const value of [0, -1, -5000]) {
    const exit = await Effect.runPromiseExit(
      makeProcess(registry, TEST_OWNER, { gracefulShutdownMs: value }).pipe(provideFakeSpawner())
    )
    expectFailure(exit, HostProtocolInvalidArgumentError)
  }
})

test("Process accepts a valid finite positive graceful shutdown window", async () => {
  const registry = await Effect.runPromise(makeResourceRegistry())
  for (const value of [1, 0.5, Number.MIN_VALUE, 5000]) {
    const exit = await Effect.runPromiseExit(
      makeProcess(registry, TEST_OWNER, { gracefulShutdownMs: value }).pipe(provideFakeSpawner())
    )
    expect(Exit.isSuccess(exit)).toBe(true)
  }
})

test("Process accepts the default graceful shutdown window when omitted", async () => {
  const registry = await Effect.runPromise(makeResourceRegistry())
  const exit = await Effect.runPromiseExit(
    makeProcess(registry, TEST_OWNER).pipe(provideFakeSpawner())
  )
  expect(Exit.isSuccess(exit)).toBe(true)
})

test("Process rejects invalid snapshot capacities", async () => {
  const registry = await Effect.runPromise(makeResourceRegistry())
  for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const exit = await Effect.runPromiseExit(
      makeProcess(registry, TEST_OWNER, { maxSnapshots: value }).pipe(provideFakeSpawner())
    )
    expectFailure(exit, HostProtocolInvalidArgumentError)
  }
})

test("Process rejects invalid budget options at service construction", async () => {
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
    const registry = await Effect.runPromise(makeResourceRegistry())
    const exit = await Effect.runPromiseExit(
      makeProcess(registry, TEST_OWNER, { budgets }).pipe(provideFakeSpawner())
    )
    expectFailure(exit, HostProtocolInvalidArgumentError)
  }
})

processTest(
  "Process spawn rejects invalid snapshot timestamps before adapter activity",
  async () => {
    for (const now of invalidTimestamps) {
      let spawnCalls = 0
      const fixture = await makeFixture(
        makeFakeSpawner(() => {
          spawnCalls += 1
          return makeFakeChild({ exit: { code: 0 }, stdout: [] })
        }),
        { now: () => now }
      )

      const exit = await Effect.runPromiseExit(fixture.service.spawn("echo", ["hi"]))

      expectFailure(exit, HostProtocolInvalidArgumentError)
      expect(spawnCalls).toBe(0)
      expect(await Effect.runPromise(fixture.service.list())).toEqual([])
      expect((await Effect.runPromise(fixture.registry.list())).entries).toEqual([])
    }
  }
)

processTest("Process spawn denies binaries by default before adapter activity", async () => {
  let spawnCalls = 0
  const registry = await Effect.runPromise(makeResourceRegistry())
  const service = await Effect.runPromise(
    makeProcess(registry, TEST_OWNER).pipe(
      Effect.provideService(
        ChildProcessSpawner.ChildProcessSpawner,
        makeFakeSpawner(() => {
          spawnCalls += 1
          return makeFakeChild({ exit: { code: 0 }, stdout: [] })
        })
      )
    )
  )

  const exit = await Effect.runPromiseExit(service.spawn("git", ["status"]))

  expect(spawnCalls).toBe(0)
  expectFailure(exit, HostProtocolPermissionDeniedError)
})

processTest("Process spawn allows binaries declared in the process.spawn policy", async () => {
  let spawnCalls = 0
  const fixture = await makeFixture(
    makeFakeSpawner(() => {
      spawnCalls += 1
      return makeFakeChild({ exit: { code: 0 }, stdout: [] })
    }),
    { permissions: { spawn: ["git"] } }
  )

  await Effect.runPromise(fixture.service.spawn("git", ["status"]))

  expect(spawnCalls).toBe(1)
})

processTest("Process spawn denies binaries outside the process.spawn policy", async () => {
  let spawnCalls = 0
  const fixture = await makeFixture(
    makeFakeSpawner(() => {
      spawnCalls += 1
      return makeFakeChild({ exit: { code: 0 }, stdout: [] })
    }),
    { permissions: { spawn: ["git"] } }
  )

  const exit = await Effect.runPromiseExit(fixture.service.spawn("rm", ["-rf", "/tmp/project"]))

  expect(spawnCalls).toBe(0)
  expectFailure(exit, HostProtocolPermissionDeniedError)
})

processTest(
  "Process spawn rejects argv0 shell metacharacters before permission lookup",
  async () => {
    let spawnCalls = 0
    const fixture = await makeFixture(
      makeFakeSpawner(() => {
        spawnCalls += 1
        return makeFakeChild({ exit: { code: 0 }, stdout: [] })
      }),
      { permissions: { spawn: ["git;ls"] } }
    )

    const exit = await Effect.runPromiseExit(fixture.service.spawn("git;ls", []))

    expect(spawnCalls).toBe(0)
    expectFailure(exit, HostProtocolInvalidArgumentError)
  }
)

processTest("Process spawn rejects NUL bytes in environment names", async () => {
  let spawnCalls = 0
  const fixture = await makeFixture(
    makeFakeSpawner(() => {
      spawnCalls += 1
      return makeFakeChild({ exit: { code: 0 }, stdout: [] })
    }),
    { permissions: { spawn: ["echo"] } }
  )
  const nul = String.fromCodePoint(0)

  const exit = await Effect.runPromiseExit(
    fixture.service.spawn("echo", ["hi"], {
      env: { [`key${nul}`]: "value" }
    })
  )

  expect(spawnCalls).toBe(0)
  expectFailure(exit, HostProtocolInvalidArgumentError)
})

processTest("Process spawn rejects empty environment names before adapter activity", async () => {
  let spawnCalls = 0
  const fixture = await makeFixture(
    makeFakeSpawner(() => {
      spawnCalls += 1
      return makeFakeChild({ exit: { code: 0 }, stdout: [] })
    }),
    { permissions: { spawn: ["echo"] } }
  )

  const exit = await Effect.runPromiseExit(
    fixture.service.spawn("echo", ["hi"], {
      env: { "": "value" }
    })
  )

  expect(spawnCalls).toBe(0)
  expectFailure(exit, HostProtocolInvalidArgumentError)
})

processTest("Process spawn rejects NUL bytes in environment values", async () => {
  let spawnCalls = 0
  const fixture = await makeFixture(
    makeFakeSpawner(() => {
      spawnCalls += 1
      return makeFakeChild({ exit: { code: 0 }, stdout: [] })
    }),
    { permissions: { spawn: ["echo"] } }
  )
  const nul = String.fromCodePoint(0)

  const exit = await Effect.runPromiseExit(
    fixture.service.spawn("echo", ["hi"], {
      env: { key: `value${nul}` }
    })
  )

  expect(spawnCalls).toBe(0)
  expectFailure(exit, HostProtocolInvalidArgumentError)
})

processTest("Process spawn requires process.shell when shell mode is requested", async () => {
  let spawnCalls = 0
  const fixture = await makeFixture(
    makeFakeSpawner(() => {
      spawnCalls += 1
      return makeFakeChild({ exit: { code: 0 }, stdout: [] })
    }),
    { permissions: { spawn: ["sh"] } }
  )

  const exit = await Effect.runPromiseExit(
    fixture.service.spawn("sh", ["-c", "echo hi"], {
      shell: true
    })
  )

  expect(spawnCalls).toBe(0)
  expectFailure(exit, HostProtocolPermissionDeniedError)
})

processTest("Process spawn allows shell mode with process.shell permission", async () => {
  let spawnCalls = 0
  const fixture = await makeFixture(
    makeFakeSpawner(() => {
      spawnCalls += 1
      return makeFakeChild({ exit: { code: 0 }, stdout: [] })
    }),
    { permissions: { shell: true, spawn: ["sh"] } }
  )

  await Effect.runPromise(
    fixture.service.spawn("sh", ["-c", "echo hi"], {
      shell: true
    })
  )

  expect(spawnCalls).toBe(1)
})

processTest("Process spawn enforces the per-scope concurrent process budget", async () => {
  let spawnCalls = 0
  const fixture = await makeFixture(
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

  await Effect.runPromise(fixture.service.spawn("sleep", ["30"]))
  await Effect.runPromise(fixture.service.spawn("sleep", ["30"]))
  const exit = await Effect.runPromiseExit(fixture.service.spawn("sleep", ["30"]))
  await Effect.runPromise(fixture.registry.closeScope("scope-main"))

  expect(spawnCalls).toBe(2)
  expectFailure(exit, HostProtocolResourceBusyError)
})

processTest("Process spawn reserves budget across parallel spawns", async () => {
  let spawnCalls = 0
  const fixture = await makeFixture(
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

  const exits = await Effect.runPromise(
    Effect.all(
      [
        Effect.exit(fixture.service.spawn("sleep", ["30"])),
        Effect.exit(fixture.service.spawn("sleep", ["30"]))
      ],
      { concurrency: "unbounded" }
    )
  )
  await Effect.runPromise(fixture.registry.closeScope("scope-main"))

  expect(spawnCalls).toBe(1)
  expect(exits.filter(Exit.isSuccess)).toHaveLength(1)
  const failure = exits.find(Exit.isFailure)
  expect(failure).toBeDefined()
  if (failure !== undefined) {
    expectFailure(failure, HostProtocolResourceBusyError)
  }
})

processTest("Process spawn releases budget after child exit", async () => {
  let spawnCalls = 0
  const fixture = await makeFixture(
    makeFakeSpawner(() => {
      spawnCalls += 1
      return makeFakeChild({ exit: { code: 0 }, stdout: [] })
    }),
    { budgets: { maxConcurrent: 1 } }
  )

  await Effect.runPromise(fixture.service.spawn("echo", ["hi"]))
  await waitUntil(async () => {
    const snapshot = await Effect.runPromise(fixture.registry.list())
    return snapshot.entries.length === 0
  })
  await Effect.runPromise(fixture.service.spawn("echo", ["hi"]))

  expect(spawnCalls).toBe(2)
})

processTest("Process spawn releases budget after adapter failure", async () => {
  let spawnCalls = 0
  const fixture = await makeFixture(
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

  const failed = await Effect.runPromiseExit(fixture.service.spawn("definitely-missing", []))
  await Effect.runPromise(fixture.service.spawn("sleep", ["1"]))

  expectFailure(failed, HostProtocolFileNotFoundError)
  expect(spawnCalls).toBe(2)
})

processTest(
  "Process stdout fails with BackpressureOverflow when a chunk exceeds budget",
  async () => {
    const fixture = await makeFixture(
      makeFakeSpawner(() => makeFakeChild({ exit: { code: 0 }, stdout: ["abcd"] })),
      { budgets: { stdoutBufferBytes: 3 } }
    )
    const handle = await Effect.runPromise(fixture.service.spawn("echo", ["abcd"]))

    const exit = await Effect.runPromiseExit(handle.stdout.pipe(Stream.runCollect))

    expectFailure(exit, HostProtocolBackpressureOverflowError)
  }
)

processTest(
  "Process stdout allows cumulative output beyond budget when the consumer drains",
  async () => {
    const fixture = await makeFixture(
      makeFakeSpawner(() =>
        makeFakeChild({
          exit: { code: 0 },
          stdout: ["ab", "cd"],
          stdoutChunkDelayMs: 5
        })
      ),
      { budgets: { stdoutBufferBytes: 3 } }
    )
    const handle = await Effect.runPromise(fixture.service.spawn("echo", ["abcd"]))

    const chunks = await Effect.runPromise(handle.stdout.pipe(Stream.runCollect))

    expect(decodeChunks([...chunks])).toBe("abcd")
  }
)

processTest(
  "Process stdout fails with BackpressureOverflow when queued chunks exceed budget",
  async () => {
    const fixture = await makeFixture(
      makeFakeSpawner(() => makeFakeChild({ exit: { code: 0 }, stdout: ["ab", "cd"] })),
      { budgets: { stdoutBufferBytes: 3 } }
    )
    const handle = await Effect.runPromise(fixture.service.spawn("echo", ["abcd"]))

    const exit = await Effect.runPromiseExit(
      handle.stdout.pipe(
        Stream.tap(() => Effect.sleep("25 millis")),
        Stream.runDrain
      )
    )

    expectFailure(exit, HostProtocolBackpressureOverflowError)
  }
)

processTest(
  "Process stderr fails with BackpressureOverflow when a chunk exceeds budget",
  async () => {
    const fixture = await makeFixture(
      makeFakeSpawner(() => makeFakeChild({ exit: { code: 0 }, stderr: ["abcd"], stdout: [] })),
      { budgets: { stderrBufferBytes: 3 } }
    )
    const handle = await Effect.runPromise(fixture.service.spawn("echo", ["abcd"]))

    const exit = await Effect.runPromiseExit(handle.stderr.pipe(Stream.runCollect))

    expectFailure(exit, HostProtocolBackpressureOverflowError)
  }
)

processTest(
  "Process stderr allows cumulative output beyond budget when the consumer drains",
  async () => {
    const fixture = await makeFixture(
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
    const handle = await Effect.runPromise(fixture.service.spawn("echo", ["abcd"]))

    const chunks = await Effect.runPromise(handle.stderr.pipe(Stream.runCollect))

    expect(decodeChunks([...chunks])).toBe("abcd")
  }
)

processTest("Process spawn maps missing executable to FileNotFound", async () => {
  const fixture = await makeFixture(makeFailingSpawner("NotFound"))

  const exit = await Effect.runPromiseExit(fixture.service.spawn("definitely-missing", []))

  expectFailure(exit, HostProtocolFileNotFoundError)
})

processTest("Process stdin sink writes chunks and closes when the sink completes", async () => {
  const child = makeFakeChild({ exit: { code: 0 }, stdout: [] })
  const fixture = await makeFixture(makeFakeSpawner(() => child))
  const handle = await Effect.runPromise(fixture.service.spawn("cat", []))

  await Effect.runPromise(Stream.make(textEncoder.encode("abc")).pipe(Stream.run(handle.stdin)))

  expect(decodeChunks(child.stdinWrites)).toBe("abc")
  expect(child.stdinClosed).toBe(true)
})

processTest("Process stdin sink keeps child stdin open across chunks", async () => {
  const child = makeFakeChild({ exit: { code: 0 }, stdout: [] })
  const fixture = await makeFixture(makeFakeSpawner(() => child))
  const handle = await Effect.runPromise(fixture.service.spawn("cat", []))

  await Effect.runPromise(
    Stream.make(textEncoder.encode("abc"), textEncoder.encode("def")).pipe(Stream.run(handle.stdin))
  )

  expect(decodeChunks(child.stdinWrites)).toBe("abcdef")
  expect(child.stdinCloseCount).toBe(1)
  expect(child.stdinClosed).toBe(true)
})

processTest("Process stdin rejects non-byte chunks without writing bytes", async () => {
  const child = makeFakeChild({ exit: { code: 0 }, stdout: [] })
  const fixture = await makeFixture(makeFakeSpawner(() => child))
  const handle = await Effect.runPromise(fixture.service.spawn("cat", []))

  const exit = await Effect.runPromiseExit(
    Stream.make("abc" as never).pipe(Stream.run(handle.stdin))
  )

  expect(child.stdinWrites).toEqual([])
  expectFailure(exit, HostProtocolInvalidArgumentError)
})

processTest("Process kill returns a typed effect and exit preserves the signal", async () => {
  const child = makeFakeChild({ exit: { code: 0 }, stdout: [] })
  const fixture = await makeFixture(makeFakeSpawner(() => child))
  const handle = await Effect.runPromise(fixture.service.spawn("sleep", ["10"]))

  await Effect.runPromise(handle.kill("SIGTERM"))
  const status = await Effect.runPromise(handle.exit)

  expect(child.killedWith).toBe("SIGTERM")
  expect(status).toEqual(new ProcessExitStatus({ code: 0, signal: "SIGTERM" }))
})

processTest("Process kill preserves the actual child exit result", async () => {
  const child = makeFakeChild({
    exit: { code: 143, signal: "SIGTERM" },
    killExit: { code: 0 },
    stdout: []
  })
  const fixture = await makeFixture(makeFakeSpawner(() => child))
  const handle = await Effect.runPromise(fixture.service.spawn("sleep", ["10"]))

  await Effect.runPromise(handle.kill("SIGTERM"))
  const status = await Effect.runPromise(handle.exit)

  expect(child.killedWith).toBe("SIGTERM")
  expect(status).toEqual(new ProcessExitStatus({ code: 0 }))
})

processTest("Process kill rejects control bytes in signal names", async () => {
  const child = makeFakeChild({ exit: { code: 0 }, stdout: [] })
  const fixture = await makeFixture(makeFakeSpawner(() => child))
  const handle = await Effect.runPromise(fixture.service.spawn("sleep", ["10"]))
  const nul = String.fromCodePoint(0)

  const exit = await Effect.runPromiseExit(handle.kill(`SIG${nul}TERM` as never))

  expectFailure(exit, HostProtocolInvalidArgumentError)
  expect(child.killedWith).toBeUndefined()
})

processTest("Process kill rejects handles after process exit", async () => {
  const child = makeFakeChild({ exit: { code: 0 }, stdout: [] })
  const fixture = await makeFixture(makeFakeSpawner(() => child))
  const handle = await Effect.runPromise(fixture.service.spawn("sleep", ["10"]))
  await Effect.runPromise(handle.exit)

  const exit = await Effect.runPromiseExit(handle.kill("SIGTERM"))

  expect(child.kills).toEqual([])
  expectFailure(exit, HostProtocolStaleHandleError)
})

processTest(
  "Process exit rejects invalid snapshot timestamps before publishing exit state",
  async () => {
    for (const now of invalidTimestamps) {
      let currentTime = 1000
      const fixture = await makeFixture(
        makeFakeSpawner(() =>
          makeFakeChild({
            exit: { code: 0 },
            naturalExitDelayMs: 10,
            stdout: []
          })
        ),
        { now: () => currentTime }
      )
      const observed = Effect.runFork(
        fixture.service.observe().pipe(Stream.take(2), Stream.runCollect)
      )
      const handle = await Effect.runPromise(fixture.service.spawn("echo", ["hi"]))
      currentTime = now

      const exit = await Effect.runPromiseExit(handle.exit)
      const listed = await Effect.runPromise(fixture.service.list())
      const snapshots = [...(await Effect.runPromise(Fiber.join(observed)))]

      expectFailure(exit, HostProtocolInvalidArgumentError)
      expect(listed[0]?.state).toBe("running")
      expect(listed[0]?.updatedAt).toBe(1000)
      expect(snapshots.at(-1)?.[0]?.state).toBe("running")
      expect(snapshots.at(-1)?.[0]?.updatedAt).toBe(1000)
    }
  }
)

processTest("Process kill rejects handles after scope close", async () => {
  const child = makeFakeChild({
    exit: { code: 0 },
    naturalExitDelayMs: 60_000,
    stdout: []
  })
  const fixture = await makeFixture(makeFakeSpawner(() => child))
  const handle = await Effect.runPromise(fixture.service.spawn("sleep", ["10"]))
  await Effect.runPromise(fixture.registry.closeScope("scope-main"))

  const exit = await Effect.runPromiseExit(handle.kill("SIGKILL"))

  expect(child.kills).toEqual(["SIGTERM"])
  expect(child.treeTerminated).toBe(true)
  expectFailure(exit, HostProtocolStaleHandleError)
})

processTest("Process scope close interrupts the scoped exit observer", async () => {
  const child = makeFakeChild({
    completeExitOnKill: false,
    exit: { code: 0 },
    naturalExitDelayMs: 60_000,
    stdout: []
  })
  const fixture = await makeFixture(
    makeFakeSpawner(() => child),
    { gracefulShutdownMs: 50 }
  )

  await Effect.runPromise(fixture.service.spawn("sleep", ["30"]))
  await Effect.runPromise(fixture.registry.closeScope("scope-main"))

  expect(child.kills).toEqual(["SIGTERM"])
  expect(child.exitCodeInterrupted).toBe(true)
  expect((await Effect.runPromise(fixture.registry.list())).entries).toEqual([])
})

if (process.platform !== "win32") {
  processTest(
    "Process scope close asks the process tree to terminate and waits for exit",
    async () => {
      const child = makeFakeChild({
        exit: { code: 0 },
        naturalExitDelayMs: 60_000,
        stdout: []
      })
      const fixture = await makeFixture(
        makeFakeSpawner(() => child),
        { gracefulShutdownMs: 50 }
      )

      await Effect.runPromise(fixture.service.spawn("sleep", ["30"]))
      await Effect.runPromise(fixture.registry.closeScope("scope-main"))

      expect(child.treeTerminated).toBe(true)
      expect(child.treeForceKilled).toBe(false)
    }
  )

  processTest("Process scope close force-kills the tree after the grace window", async () => {
    const child = makeFakeChild({
      exit: { code: 0 },
      ignoreTerminate: true,
      naturalExitDelayMs: 60_000,
      stdout: []
    })
    const fixture = await makeFixture(
      makeFakeSpawner(() => child),
      { gracefulShutdownMs: 1 }
    )

    await Effect.runPromise(fixture.service.spawn("sleep", ["30"]))
    await Effect.runPromise(fixture.registry.closeScope("scope-main"))

    expect(child.treeTerminated).toBe(true)
    expect(child.treeForceKilled).toBe(true)
  })

  processTest("Process spawn works against Bun for stdout and exit code", async () => {
    const fixture = await makeFixture()
    const handle = await Effect.runPromise(
      fixture.service.spawn(process.execPath, ["--eval", "process.stdout.write('hi\\n')"])
    )

    try {
      await Effect.runPromise(Stream.empty.pipe(Stream.run(handle.stdin)))
      const output = await Effect.runPromise(handle.stdout.pipe(Stream.runCollect))
      const status = await Effect.runPromise(handle.exit)

      expect(decodeChunks([...output])).toBe("hi\n")
      expect(status.code).toBe(0)
    } finally {
      await Effect.runPromise(fixture.registry.closeScope("scope-main"))
    }
  })

  processTest(
    "Process scope close terminates descendants in the spawned process group",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "effect-desktop-process-"))
      const pidFile = join(directory, "children.txt")
      const fixture = await makeFixture(undefined, { gracefulShutdownMs: 50 })
      try {
        await Effect.runPromise(
          fixture.service.spawn(
            "/bin/sh",
            [
              "-c",
              `sleep 30 & echo $! > ${shellQuote(pidFile)}; sleep 30 & echo $! >> ${shellQuote(
                pidFile
              )}; wait`
            ],
            {}
          )
        )
        const childPids = await waitForChildPids(pidFile)

        await Effect.runPromise(fixture.registry.closeScope("scope-main"))
        await waitUntil(() => Promise.resolve(childPids.every((pid) => !isProcessAlive(pid))))

        expect(childPids).toHaveLength(2)
      } finally {
        await rm(directory, { force: true, recursive: true })
      }
    }
  )
}

const makeFixture = async (
  spawner?: ChildProcessSpawner.ChildProcessSpawner["Service"],
  options: {
    readonly budgets?: ProcessBudgetPolicy
    readonly gracefulShutdownMs?: number
    readonly inspector?: ExecutionInspectorCollectorApi
    readonly maxSnapshots?: number
    readonly now?: () => number
    readonly permissions?: ProcessPermissionPolicy
  } = {}
): Promise<{
  readonly registry: ResourceRegistryApi
  readonly service: ProcessApi
}> => {
  const registry = await Effect.runPromise(makeResourceRegistry())
  const service = await makeService(registry, spawner, options)
  return { registry, service }
}

const makeService = (
  registry: ResourceRegistryApi,
  spawner?: ChildProcessSpawner.ChildProcessSpawner["Service"],
  options: {
    readonly budgets?: ProcessBudgetPolicy
    readonly gracefulShutdownMs?: number
    readonly inspector?: ExecutionInspectorCollectorApi
    readonly maxSnapshots?: number
    readonly now?: () => number
    readonly permissions?: ProcessPermissionPolicy
  } = {}
) =>
  Effect.runPromise(
    makeProcess(registry, TEST_OWNER, {
      ...(options.budgets === undefined ? {} : { budgets: options.budgets }),
      permissions: options.permissions ?? ALLOW_TEST_PROCESS_PERMISSIONS,
      ...(options.gracefulShutdownMs === undefined
        ? {}
        : { gracefulShutdownMs: options.gracefulShutdownMs }),
      ...(options.inspector === undefined ? {} : { inspector: options.inspector }),
      ...(options.maxSnapshots === undefined ? {} : { maxSnapshots: options.maxSnapshots }),
      ...(options.now === undefined ? {} : { now: options.now })
    }).pipe(
      spawner === undefined
        ? Effect.provide(BunServices.layer)
        : Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner)
    )
  )

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
    status: { readonly code: number; readonly signal?: string } = options.exit
  ): Effect.Effect<void> =>
    Effect.sync(() => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(naturalExitTimer)
      running = false
      return
    }).pipe(
      Effect.andThen(Deferred.succeed(exitState, new ProcessExitStatus(status))),
      Effect.asVoid
    )
  const naturalExitTimer = setTimeout(() => {
    Effect.runFork(finish())
  }, options.naturalExitDelayMs ?? 0)
  naturalExitTimer.unref()

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
          return yield* Effect.fail(
            PlatformError.systemError({
              _tag: "Unknown",
              description: "stdin was written after close",
              method: "stdin",
              module: "ChildProcessSpawner"
            })
          )
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

const waitUntil = async (predicate: () => Promise<boolean>): Promise<void> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await predicate()) {
      return
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10)
    })
  }
  throw new Error("condition was not met")
}

const incrementingClock = (start: number): (() => number) => {
  let current = start
  return () => {
    current += 1
    return current
  }
}

const waitForChildPids = async (path: string): Promise<readonly number[]> => {
  let pids: readonly number[] = []
  await waitUntil(async () => {
    try {
      const contents = await readFile(path, "utf-8")
      pids = contents
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => Number.parseInt(line, 10))
      return pids.length === 2 && pids.every(Number.isSafeInteger)
    } catch (error) {
      if (isNodeErrorCode(error, "ENOENT")) {
        return false
      }
      throw error
    }
  })
  return pids
}

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
