import { expect, test } from "bun:test"
import {
  HostProtocolBackpressureOverflowError,
  HostProtocolFileNotFoundError,
  HostProtocolInvalidArgumentError,
  HostProtocolPermissionDeniedError,
  HostProtocolResourceBusyError,
  HostProtocolStaleHandleError
} from "@effect-desktop/bridge"
import { Cause, Deferred, Effect, Exit, Option, Schedule, Stream } from "effect"

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

ptyTest("PTY open exposes output and exit status", async () => {
  const fixture = await makeFixture(
    makeFakeAdapter(() => makeFakeChild({ output: ["prompt$ "], exit: { code: 0 } }))
  )

  const handle = await Effect.runPromise(
    fixture.service.open({
      argv: ["bash"],
      rows: 24,
      cols: 80
    })
  )
  const output = await Effect.runPromise(handle.output.pipe(Stream.runCollect))
  const status = await Effect.runPromise(handle.onExit)

  expect(decodeChunks(Array.from(output))).toBe("prompt$ ")
  expect(status).toEqual(new PtyExitStatus({ code: 0 }))
})

ptyTest("PTY open registers a scoped running resource", async () => {
  const fixture = await makeFixture(
    makeFakeAdapter(() => makeFakeChild({ output: [], exit: { code: 0 } }))
  )

  const handle = await Effect.runPromise(
    fixture.service.open({
      argv: ["bash"],
      rows: 24,
      cols: 80
    })
  )
  const snapshot = await Effect.runPromise(fixture.registry.list())

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

ptyTest("PTY removes the resource when a child exits without awaiting onExit", async () => {
  const fixture = await makeFixture(
    makeFakeAdapter(() => makeFakeChild({ output: [], exit: { code: 0 } }))
  )

  await Effect.runPromise(
    fixture.service.open({
      argv: ["bash"],
      rows: 24,
      cols: 80
    })
  )
  await waitUntil(async () => {
    const snapshot = await Effect.runPromise(fixture.registry.list())
    return snapshot.entries.length === 0
  })
})

ptyTest("PTY removes the resource and releases budget when child exit fails", async () => {
  let openCalls = 0
  const fixture = await makeFixture(
    makeFakeAdapter(() => {
      openCalls += 1
      return openCalls === 1
        ? makeFakeChild({ output: [], exit: { code: 1 }, exitError: new Error("pty failed") })
        : makeFakeChild({ output: [], exit: { code: 0 } })
    }),
    { budgets: { maxConcurrent: 1 } }
  )

  await Effect.runPromise(
    fixture.service.open({
      argv: ["bash"],
      rows: 24,
      cols: 80
    })
  )
  await waitUntil(async () => {
    const snapshot = await Effect.runPromise(fixture.registry.list())
    return snapshot.entries.length === 0
  })
  await Effect.runPromise(
    fixture.service.open({
      argv: ["bash"],
      rows: 24,
      cols: 80
    })
  )

  expect(openCalls).toBe(2)
})

ptyTest("PTY open validates size before adapter activity", async () => {
  let openCalls = 0
  const fixture = await makeFixture(
    makeFakeAdapter(() => {
      openCalls += 1
      return makeFakeChild({ output: [], exit: { code: 0 } })
    })
  )

  const exit = await Effect.runPromiseExit(
    fixture.service.open({
      argv: ["bash"],
      rows: 0,
      cols: 80
    })
  )

  expect(openCalls).toBe(0)
  expectFailure(exit, HostProtocolInvalidArgumentError)
})

test("PTY rejects non-finite graceful shutdown windows", async () => {
  const registry = await Effect.runPromise(makeResourceRegistry())
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const exit = await Effect.runPromiseExit(
      makePty(registry, TEST_OWNER, { adapter: makeFakeAdapter(), gracefulShutdownMs: value })
    )
    expectFailure(exit, HostProtocolInvalidArgumentError)
  }
})

test("PTY rejects non-positive graceful shutdown windows before adapter activity", async () => {
  const registry = await Effect.runPromise(makeResourceRegistry())
  for (const value of [0, -1, -5000]) {
    let openCalls = 0
    const exit = await Effect.runPromiseExit(
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

ptyTest("PTY open denies commands by default before adapter activity", async () => {
  let openCalls = 0
  const registry = await Effect.runPromise(makeResourceRegistry())
  const service = await Effect.runPromise(
    makePty(registry, TEST_OWNER, {
      adapter: {
        open: () => {
          openCalls += 1
          return makeFakeChild({ output: [], exit: { code: 0 } })
        }
      }
    })
  )

  const exit = await Effect.runPromiseExit(
    service.open({
      argv: ["bash"],
      rows: 24,
      cols: 80
    })
  )

  expect(openCalls).toBe(0)
  expectFailure(exit, HostProtocolPermissionDeniedError)
})

ptyTest("PTY open allows commands declared in pty.spawn policy", async () => {
  let openCalls = 0
  const fixture = await makeFixture(
    makeFakeAdapter(() => {
      openCalls += 1
      return makeFakeChild({ output: [], exit: { code: 0 } })
    }),
    { permissions: { spawn: ["bash"] } }
  )

  await Effect.runPromise(
    fixture.service.open({
      argv: ["bash"],
      rows: 24,
      cols: 80
    })
  )

  expect(openCalls).toBe(1)
})

ptyTest("PTY open rejects argv0 shell metacharacters before permission lookup", async () => {
  let openCalls = 0
  const fixture = await makeFixture(
    makeFakeAdapter(() => {
      openCalls += 1
      return makeFakeChild({ output: [], exit: { code: 0 } })
    }),
    { permissions: { spawn: ["bash;rm"] } }
  )

  const exit = await Effect.runPromiseExit(
    fixture.service.open({
      argv: ["bash;rm"],
      rows: 24,
      cols: 80
    })
  )

  expect(openCalls).toBe(0)
  expectFailure(exit, HostProtocolInvalidArgumentError)
})

ptyTest("PTY open rejects empty environment names before adapter activity", async () => {
  let openCalls = 0
  const fixture = await makeFixture(
    makeFakeAdapter(() => {
      openCalls += 1
      return makeFakeChild({ output: [], exit: { code: 0 } })
    }),
    { permissions: { spawn: ["bash"] } }
  )

  const exit = await Effect.runPromiseExit(
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

ptyTest("PTY open rejects NUL bytes in environment names", async () => {
  let openCalls = 0
  const fixture = await makeFixture(
    makeFakeAdapter(() => {
      openCalls += 1
      return makeFakeChild({ output: [], exit: { code: 0 } })
    }),
    { permissions: { spawn: ["bash"] } }
  )
  const nul = String.fromCharCode(0)

  const exit = await Effect.runPromiseExit(
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

ptyTest("PTY open rejects NUL bytes in environment values", async () => {
  let openCalls = 0
  const fixture = await makeFixture(
    makeFakeAdapter(() => {
      openCalls += 1
      return makeFakeChild({ output: [], exit: { code: 0 } })
    }),
    { permissions: { spawn: ["bash"] } }
  )
  const nul = String.fromCharCode(0)

  const exit = await Effect.runPromiseExit(
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

ptyTest("PTY open enforces the per-scope concurrent budget", async () => {
  let openCalls = 0
  const fixture = await makeFixture(
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
  const exits = await Effect.runPromise(
    Effect.all([Effect.exit(first), Effect.exit(second)], { concurrency: "unbounded" })
  )
  await Effect.runPromise(fixture.registry.closeScope("scope-main"))

  expect(openCalls).toBe(1)
  expect(exits.filter(Exit.isSuccess)).toHaveLength(1)
  const failure = exits.find(Exit.isFailure)
  expect(failure).toBeDefined()
  if (failure !== undefined) {
    expectFailure(failure, HostProtocolResourceBusyError)
  }
})

ptyTest("PTY open releases the per-scope budget after adapter failure", async () => {
  let openCalls = 0
  const notFound = new Error("missing pty")
  Object.assign(notFound, { code: "ENOENT" })
  const fixture = await makeFixture(
    makeFakeAdapter(() => {
      openCalls += 1
      if (openCalls === 1) {
        throw notFound
      }
      return makeFakeChild({ output: [], exit: { code: 0 } })
    }),
    { budgets: { maxConcurrent: 1 } }
  )

  const failed = await Effect.runPromiseExit(
    fixture.service.open({
      argv: ["bash"],
      rows: 24,
      cols: 80
    })
  )
  await Effect.runPromise(
    fixture.service.open({
      argv: ["bash"],
      rows: 24,
      cols: 80
    })
  )

  expectFailure(failed, HostProtocolFileNotFoundError)
  expect(openCalls).toBe(2)
})

ptyTest("PTY open validates output budget policy before adapter activity", async () => {
  let openCalls = 0
  const fixture = await makeFixture(
    makeFakeAdapter(() => {
      openCalls += 1
      return makeFakeChild({ output: [], exit: { code: 0 } })
    }),
    { budgets: { outputCoalesceBytes: 0 } }
  )

  const exit = await Effect.runPromiseExit(
    fixture.service.open({
      argv: ["bash"],
      rows: 24,
      cols: 80
    })
  )

  expect(openCalls).toBe(0)
  expectFailure(exit, HostProtocolInvalidArgumentError)
})

ptyTest("PTY output coalesces small chunks up to the byte window", async () => {
  const fixture = await makeFixture(
    makeFakeAdapter(() => makeFakeChild({ output: ["a", "b", "c", "d", "e"], exit: { code: 0 } })),
    { budgets: { outputBufferBytes: 16, outputCoalesceBytes: 4, outputCoalesceMs: 1_000 } }
  )
  const handle = await Effect.runPromise(
    fixture.service.open({
      argv: ["bash"],
      rows: 24,
      cols: 80
    })
  )

  const output = Array.from(await Effect.runPromise(handle.output.pipe(Stream.runCollect)))
  const metrics = await Effect.runPromise(handle.outputMetrics)

  expect(decodeChunks(Array.from(output))).toBe("abcde")
  expect(output.map((chunk) => chunk.byteLength)).toEqual([4, 1])
  expect(metrics).toMatchObject({
    coalescedFrames: 1,
    emittedFrames: 2,
    inputFrames: 5,
    queueDepth: 0
  })
})

ptyTest("PTY output flushes a quiet small chunk when the coalescing window expires", async () => {
  const now = fixedSequenceClock([100, 106])
  const fixture = await makeFixture(
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
  const handle = await Effect.runPromise(
    fixture.service.open({
      argv: ["bash"],
      rows: 24,
      cols: 80
    })
  )

  const output = await Effect.runPromise(
    handle.output.pipe(Stream.take(1), Stream.runCollect, Effect.timeout("100 millis"))
  )
  await Effect.runPromise(fixture.registry.closeScope("scope-main"))

  expect(decodeChunks(Array.from(output))).toBe("p")
})

ptyTest("PTY output fails with BackpressureOverflow when a chunk exceeds budget", async () => {
  const fixture = await makeFixture(
    makeFakeAdapter(() => makeFakeChild({ output: ["abcd"], exit: { code: 0 } })),
    { budgets: { outputBufferBytes: 3, outputCoalesceBytes: 4, outputOverflow: "error" } }
  )
  const handle = await Effect.runPromise(
    fixture.service.open({
      argv: ["bash"],
      rows: 24,
      cols: 80
    })
  )

  const exit = await Effect.runPromiseExit(handle.output.pipe(Stream.runCollect))

  expectFailure(exit, HostProtocolBackpressureOverflowError)
})

ptyTest("PTY output dropOldest keeps the stream buffer bounded", async () => {
  const fixture = await makeFixture(
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
  const handle = await Effect.runPromise(
    fixture.service.open({
      argv: ["bash"],
      rows: 24,
      cols: 80
    })
  )

  const output = await Effect.runPromise(handle.output.pipe(Stream.runCollect))
  const metrics = await Effect.runPromise(handle.outputMetrics)

  expect(decodeChunks(Array.from(output))).toBe("bbcc")
  expect(metrics).toMatchObject({
    emittedFrames: 3,
    inputFrames: 3,
    queueDepth: 0
  })
})

ptyTest("PTY rejects invalid output overflow policies before adapter open", async () => {
  let openCalls = 0
  const fixture = await makeFixture(
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

  const exit = await Effect.runPromiseExit(
    fixture.service.open({
      argv: ["bash"],
      rows: 24,
      cols: 80
    })
  )

  expectFailure(exit, HostProtocolInvalidArgumentError)
  expect(openCalls).toBe(0)
})

ptyTest("PTY handle writes, resizes, kills, and preserves exit signal", async () => {
  const child = makeFakeChild({ output: [], exit: { code: 0 }, naturalExitDelayMs: 60_000 })
  const fixture = await makeFixture(makeFakeAdapter(() => child))
  const handle = await Effect.runPromise(
    fixture.service.open({
      argv: ["bash"],
      rows: 24,
      cols: 80
    })
  )

  await Effect.runPromise(handle.write(textEncoder.encode("echo hi\n")))
  await Effect.runPromise(handle.resize(new PtyResizeInput({ rows: 40, cols: 120 })))
  await Effect.runPromise(handle.kill("SIGTERM"))
  const status = await Effect.runPromise(handle.onExit)

  expect(decodeChunks(child.writes)).toBe("echo hi\n")
  expect(child.resizes).toEqual([new PtyResizeInput({ rows: 40, cols: 120 })])
  expect(child.killedWith).toBe("SIGTERM")
  expect(status).toEqual(new PtyExitStatus({ code: 0, signal: "SIGTERM" }))
})

ptyTest("PTY write rejects non-byte chunks before adapter activity", async () => {
  const child = makeFakeChild({ output: [], exit: { code: 0 }, naturalExitDelayMs: 60_000 })
  const fixture = await makeFixture(makeFakeAdapter(() => child))
  const handle = await Effect.runPromise(
    fixture.service.open({
      argv: ["bash"],
      rows: 24,
      cols: 80
    })
  )

  const exit = await Effect.runPromiseExit(handle.write("echo hi\n"))
  await Effect.runPromise(fixture.registry.closeScope("scope-main"))

  expect(child.writes).toEqual([])
  expectFailure(exit, HostProtocolInvalidArgumentError)
})

ptyTest("PTY side effects reject handles after child exit", async () => {
  const child = makeFakeChild({ output: [], exit: { code: 0 } })
  const fixture = await makeFixture(makeFakeAdapter(() => child))
  const handle = await Effect.runPromise(
    fixture.service.open({
      argv: ["bash"],
      rows: 24,
      cols: 80
    })
  )
  await Effect.runPromise(handle.onExit)

  const writeExit = await Effect.runPromiseExit(handle.write(textEncoder.encode("echo hi\n")))
  const resizeExit = await Effect.runPromiseExit(
    handle.resize(new PtyResizeInput({ rows: 40, cols: 120 }))
  )
  const killExit = await Effect.runPromiseExit(handle.kill("SIGTERM"))

  expect(child.writes).toEqual([])
  expect(child.resizes).toEqual([])
  expect(child.kills).toEqual([])
  expectFailure(writeExit, HostProtocolStaleHandleError)
  expectFailure(resizeExit, HostProtocolStaleHandleError)
  expectFailure(killExit, HostProtocolStaleHandleError)
})

ptyTest("PTY side effects reject handles after scope close", async () => {
  const child = makeFakeChild({ output: [], exit: { code: 0 }, naturalExitDelayMs: 60_000 })
  const fixture = await makeFixture(makeFakeAdapter(() => child))
  const handle = await Effect.runPromise(
    fixture.service.open({
      argv: ["bash"],
      rows: 24,
      cols: 80
    })
  )
  await Effect.runPromise(fixture.registry.closeScope("scope-main"))

  const writeExit = await Effect.runPromiseExit(handle.write(textEncoder.encode("echo hi\n")))
  const resizeExit = await Effect.runPromiseExit(
    handle.resize(new PtyResizeInput({ rows: 40, cols: 120 }))
  )
  const killExit = await Effect.runPromiseExit(handle.kill("SIGKILL"))

  expect(child.writes).toEqual([])
  expect(child.resizes).toEqual([])
  expect(child.kills).toEqual(["SIGTERM"])
  expectFailure(writeExit, HostProtocolStaleHandleError)
  expectFailure(resizeExit, HostProtocolStaleHandleError)
  expectFailure(killExit, HostProtocolStaleHandleError)
})

ptyTest("PTY kill rejects control bytes in signal names", async () => {
  const child = makeFakeChild({ output: [], exit: { code: 0 } })
  const fixture = await makeFixture(
    makeFakeAdapter(() => child),
    { permissions: { spawn: ["bash"] } }
  )
  const handle = await Effect.runPromise(
    fixture.service.open({
      argv: ["bash"],
      rows: 24,
      cols: 80
    })
  )
  const nul = String.fromCharCode(0)

  const exit = await Effect.runPromiseExit(handle.kill(`SIG${nul}TERM`))

  expectFailure(exit, HostProtocolInvalidArgumentError)
  expect(child.killedWith).toBeUndefined()
})

ptyTest("PTY scope close kills the child", async () => {
  const child = makeFakeChild({ output: [], exit: { code: 0 }, naturalExitDelayMs: 60_000 })
  const fixture = await makeFixture(makeFakeAdapter(() => child))

  await Effect.runPromise(
    fixture.service.open({
      argv: ["bash"],
      rows: 24,
      cols: 80
    })
  )
  await Effect.runPromise(fixture.registry.closeScope("scope-main"))

  expect(child.terminateTreeCalls).toBe(1)
})

ptyTest("PTY scope close waits for child exit before releasing budget", async () => {
  let openCalls = 0
  const firstChild = makeFakeChild({
    output: [],
    exit: { code: 0 },
    naturalExitDelayMs: 60_000,
    killExitDelayMs: 20
  })
  const fixture = await makeFixture(
    makeFakeAdapter(() => {
      openCalls += 1
      return openCalls === 1 ? firstChild : makeFakeChild({ output: [], exit: { code: 0 } })
    }),
    { budgets: { maxConcurrent: 1 } }
  )

  await Effect.runPromise(
    fixture.service.open({
      argv: ["bash"],
      rows: 24,
      cols: 80
    })
  )
  await Effect.runPromise(fixture.registry.closeScope("scope-main"))
  await Effect.runPromise(
    fixture.service.open({
      argv: ["bash"],
      rows: 24,
      cols: 80
    })
  )

  expect(firstChild.isRunning()).toBe(false)
  expect(openCalls).toBe(2)
})

ptyTest("PTY scope close escalates to SIGKILL when SIGTERM is ignored", async () => {
  const child = makeFakeChild({
    output: [],
    exit: { code: 0 },
    naturalExitDelayMs: 60_000,
    ignoredSignals: ["SIGTERM"]
  })
  const fixture = await makeFixture(
    makeFakeAdapter(() => child),
    { gracefulShutdownMs: 1 }
  )

  await Effect.runPromise(
    fixture.service.open({
      argv: ["bash"],
      rows: 24,
      cols: 80
    })
  )
  await Effect.runPromise(fixture.registry.closeScope("scope-main"))

  expect(child.terminateTreeCalls).toBe(1)
  expect(child.forceKillTreeCalls).toBe(1)
  expect(child.isRunning()).toBe(false)
})

ptyTest("PTY scope close escalates when terminateTree fails", async () => {
  const child = makeFakeChild({
    output: [],
    exit: { code: 0 },
    naturalExitDelayMs: 60_000,
    terminateError: new Error("terminate failed")
  })
  const fixture = await makeFixture(
    makeFakeAdapter(() => child),
    { gracefulShutdownMs: 1 }
  )

  await Effect.runPromise(
    fixture.service.open({
      argv: ["bash"],
      rows: 24,
      cols: 80
    })
  )
  await Effect.runPromise(fixture.registry.closeScope("scope-main"))

  expect(child.terminateTreeCalls).toBe(1)
  expect(child.forceKillTreeCalls).toBe(1)
  expect(child.killedWith).toBe("SIGKILL")
  expect(child.isRunning()).toBe(false)
})

ptyTest("PTY scope close suppresses forceKillTree failures", async () => {
  const child = makeFakeChild({
    output: [],
    exit: { code: 0 },
    forceKillError: new Error("force kill failed"),
    ignoredSignals: ["SIGTERM"],
    naturalExitDelayMs: 60_000
  })
  const fixture = await makeFixture(
    makeFakeAdapter(() => child),
    { gracefulShutdownMs: 1 }
  )

  await Effect.runPromise(
    fixture.service.open({
      argv: ["bash"],
      rows: 24,
      cols: 80
    })
  )
  await Effect.runPromise(fixture.registry.closeScope("scope-main"))

  expect(child.terminateTreeCalls).toBe(1)
  expect(child.forceKillTreeCalls).toBe(1)
  expect(child.isRunning()).toBe(true)
})

const makeFixture = async (
  adapter?: PtyAdapter,
  options: {
    readonly budgets?: PtyBudgetPolicy
    readonly gracefulShutdownMs?: number
    readonly now?: () => number
    readonly permissions?: PtyPermissionPolicy
  } = {}
): Promise<{ readonly registry: ResourceRegistryApi; readonly service: PtyApi }> => {
  const registry = await Effect.runPromise(makeResourceRegistry())
  const service = await makeService(registry, adapter ?? makeFakeAdapter(), options)
  return { registry, service }
}

const makeService = (
  registry: ResourceRegistryApi,
  adapter: PtyAdapter,
  options: {
    readonly budgets?: PtyBudgetPolicy
    readonly gracefulShutdownMs?: number
    readonly now?: () => number
    readonly permissions?: PtyPermissionPolicy
  } = {}
) =>
  Effect.runPromise(
    makePty(registry, TEST_OWNER, {
      adapter,
      ...(options.budgets === undefined ? {} : { budgets: options.budgets }),
      ...(options.gracefulShutdownMs === undefined
        ? {}
        : { gracefulShutdownMs: options.gracefulShutdownMs }),
      ...(options.now === undefined ? {} : { now: options.now }),
      permissions: options.permissions ?? ALLOW_TEST_PTY_PERMISSIONS
    })
  )

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
  const exitState = Effect.runSync(Deferred.make<PtyExitStatus, unknown>())
  const exited = Effect.runPromise(Deferred.await(exitState))
  const finish = (signal?: string): void => {
    if (settled) {
      return
    }
    settled = true
    clearTimeout(naturalExitTimer)
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
    clearTimeout(naturalExitTimer)
    running = false
    Effect.runSync(Deferred.fail(exitState, error).pipe(Effect.asVoid))
  }
  const naturalExitTimer = setTimeout(() => {
    if (options.exitError === undefined) {
      finish()
    } else {
      fail(options.exitError)
    }
  }, options.naturalExitDelayMs ?? 0)
  naturalExitTimer.unref()

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
    write: async (chunk) => {
      writes.push(chunk)
    },
    resize: async (size) => {
      resizes.push(size)
    },
    isRunning: () => running,
    terminateTree: async () => {
      terminateTreeCalls += 1
      if (options.terminateError !== undefined) {
        throw options.terminateError
      }
      await killFakeChild("SIGTERM")
    },
    forceKillTree: async () => {
      forceKillTreeCalls += 1
      if (options.forceKillError !== undefined) {
        throw options.forceKillError
      }
      await killFakeChild("SIGKILL")
    },
    kill: async (signal) => {
      await killFakeChild(signal ?? "SIGTERM")
    }
  }

  async function killFakeChild(signal: PtySignalInput): Promise<void> {
    killedWith = signal
    kills.push(killedWith)
    if (options.ignoreKill !== true && !options.ignoredSignals?.includes(killedWith)) {
      if (options.killExitDelayMs === undefined) {
        finish(String(killedWith))
      } else {
        setTimeout(() => finish(String(killedWith)), options.killExitDelayMs)
      }
    }
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

const waitUntil = async (predicate: () => boolean | Promise<boolean>): Promise<void> => {
  await Effect.runPromise(
    Effect.tryPromise({
      try: async () => await predicate(),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause)))
    }).pipe(
      Effect.flatMap((ready) =>
        ready ? Effect.void : Effect.fail(new Error("timed out waiting for condition"))
      ),
      Effect.retry(Schedule.spaced("5 millis").pipe(Schedule.both(Schedule.recurs(200)))),
      Effect.mapError(() => new Error("timed out waiting for condition"))
    )
  )
}

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
