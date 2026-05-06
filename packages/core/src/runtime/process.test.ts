import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  HostProtocolFileNotFoundError,
  HostProtocolInvalidArgumentError
} from "@effect-desktop/bridge"
import { Cause, Effect, Exit, Stream } from "effect"

import {
  makeProcess,
  ProcessExitStatus,
  type ProcessAdapter,
  type ProcessApi,
  type ProcessChild,
  type ProcessSignalInput
} from "./process.js"
import { makeResourceRegistry, type ResourceRegistryApi } from "./resources.js"

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()
const processTest = process.platform === "win32" ? test.skip : test

processTest("Process spawn exposes stdout and exit status", async () => {
  const fixture = await makeFixture(
    makeFakeAdapter(() => makeFakeChild({ stdout: ["hi\n"], exit: { code: 0 } }))
  )

  const handle = await Effect.runPromise(
    fixture.service.spawn("echo", ["hi"], { ownerScope: "scope-main" })
  )
  const output = await Effect.runPromise(handle.stdout.pipe(Stream.runCollect))
  const status = await Effect.runPromise(handle.exit)

  expect(decodeChunks(Array.from(output))).toBe("hi\n")
  expect(status).toEqual(new ProcessExitStatus({ code: 0 }))
})

processTest("Process spawn registers a scoped running resource", async () => {
  const fixture = await makeFixture(
    makeFakeAdapter(() => makeFakeChild({ stdout: [], exit: { code: 0 } }))
  )

  const handle = await Effect.runPromise(
    fixture.service.spawn("echo", ["hi"], { ownerScope: "scope-main" })
  )
  const snapshot = await Effect.runPromise(fixture.registry.list())

  expect(handle.resource.kind).toBe("process")
  expect(handle.resource.ownerScope).toBe("scope-main")
  expect(snapshot.entries.map((entry) => entry.handle)).toContainEqual(handle.resource)
})

processTest(
  "Process removes the resource when a child exits without awaiting handle.exit",
  async () => {
    const fixture = await makeFixture(
      makeFakeAdapter(() => makeFakeChild({ stdout: [], exit: { code: 0 } }))
    )

    await Effect.runPromise(fixture.service.spawn("echo", ["hi"], { ownerScope: "scope-main" }))
    await waitUntil(async () => {
      const snapshot = await Effect.runPromise(fixture.registry.list())
      return snapshot.entries.length === 0
    })
  }
)

processTest("Process spawn validates required owner scope before adapter activity", async () => {
  let spawnCalls = 0
  const fixture = await makeFixture(
    makeFakeAdapter(() => {
      spawnCalls += 1
      return makeFakeChild({ stdout: [], exit: { code: 0 } })
    })
  )

  const exit = await Effect.runPromiseExit(fixture.service.spawn("echo", [], { ownerScope: "" }))

  expect(spawnCalls).toBe(0)
  expectFailure(exit, HostProtocolInvalidArgumentError)
})

processTest("Process spawn reports missing options as a typed failure", async () => {
  const fixture = await makeFixture(
    makeFakeAdapter(() => makeFakeChild({ stdout: [], exit: { code: 0 } }))
  )

  const exit = await Effect.runPromiseExit(fixture.service.spawn("echo"))

  expectFailure(exit, HostProtocolInvalidArgumentError)
})

processTest("Process spawn maps missing executable to FileNotFound", async () => {
  const fixture = await makeFixture({
    spawn: () => {
      throw Object.assign(new Error("not found"), { code: "ENOENT" })
    }
  })

  const exit = await Effect.runPromiseExit(
    fixture.service.spawn("definitely-missing", [], { ownerScope: "scope-main" })
  )

  expectFailure(exit, HostProtocolFileNotFoundError)
})

processTest("Process stdin sink writes chunks and closes when the sink completes", async () => {
  const child = makeFakeChild({ stdout: [], exit: { code: 0 } })
  const fixture = await makeFixture(makeFakeAdapter(() => child))
  const handle = await Effect.runPromise(
    fixture.service.spawn("cat", [], { ownerScope: "scope-main" })
  )

  await Effect.runPromise(Stream.make(textEncoder.encode("abc")).pipe(Stream.run(handle.stdin)))

  expect(decodeChunks(child.stdinWrites)).toBe("abc")
  expect(child.stdinClosed).toBe(true)
})

processTest("Process kill returns a typed effect and exit preserves the signal", async () => {
  const child = makeFakeChild({ stdout: [], exit: { code: 0 } })
  const fixture = await makeFixture(makeFakeAdapter(() => child))
  const handle = await Effect.runPromise(
    fixture.service.spawn("sleep", ["10"], { ownerScope: "scope-main" })
  )

  await Effect.runPromise(handle.kill("SIGTERM"))
  const status = await Effect.runPromise(handle.exit)

  expect(child.killedWith).toBe("SIGTERM")
  expect(status).toEqual(new ProcessExitStatus({ code: 0, signal: "SIGTERM" }))
})

if (process.platform !== "win32") {
  processTest(
    "Process scope close asks the process tree to terminate and waits for exit",
    async () => {
      const child = makeFakeChild({ stdout: [], exit: { code: 0 }, naturalExitDelayMs: 60_000 })
      const fixture = await makeFixture(
        makeFakeAdapter(() => child),
        { gracefulShutdownMs: 50 }
      )

      await Effect.runPromise(fixture.service.spawn("sleep", ["30"], { ownerScope: "scope-main" }))
      await Effect.runPromise(fixture.registry.closeScope("scope-main"))

      expect(child.treeTerminated).toBe(true)
      expect(child.treeForceKilled).toBe(false)
    }
  )

  processTest("Process scope close force-kills the tree after the grace window", async () => {
    const child = makeFakeChild({
      stdout: [],
      exit: { code: 0 },
      naturalExitDelayMs: 60_000,
      ignoreTerminate: true
    })
    const fixture = await makeFixture(
      makeFakeAdapter(() => child),
      { gracefulShutdownMs: 1 }
    )

    await Effect.runPromise(fixture.service.spawn("sleep", ["30"], { ownerScope: "scope-main" }))
    await Effect.runPromise(fixture.registry.closeScope("scope-main"))

    expect(child.treeTerminated).toBe(true)
    expect(child.treeForceKilled).toBe(true)
  })

  processTest("Process spawn works against Bun for stdout and exit code", async () => {
    const fixture = await makeFixture()
    const handle = await Effect.runPromise(
      fixture.service.spawn(process.execPath, ["--eval", "process.stdout.write('hi\\n')"], {
        ownerScope: "scope-main"
      })
    )

    try {
      await Effect.runPromise(Stream.empty.pipe(Stream.run(handle.stdin)))
      const output = await Effect.runPromise(handle.stdout.pipe(Stream.runCollect))
      const status = await Effect.runPromise(handle.exit)

      expect(decodeChunks(Array.from(output))).toBe("hi\n")
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
            { ownerScope: "scope-main" }
          )
        )
        const childPids = await waitForChildPids(pidFile)

        await Effect.runPromise(fixture.registry.closeScope("scope-main"))
        await waitUntil(async () => childPids.every((pid) => !isProcessAlive(pid)))

        expect(childPids).toHaveLength(2)
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    }
  )
}

const makeFixture = async (
  adapter?: ProcessAdapter,
  options: { readonly gracefulShutdownMs?: number } = {}
): Promise<{ readonly registry: ResourceRegistryApi; readonly service: ProcessApi }> => {
  const registry = await Effect.runPromise(makeResourceRegistry())
  const service = await makeService(registry, adapter, options)
  return { registry, service }
}

const makeService = (
  registry: ResourceRegistryApi,
  adapter?: ProcessAdapter,
  options: { readonly gracefulShutdownMs?: number } = {}
) =>
  Effect.runPromise(
    makeProcess(registry, {
      ...(adapter === undefined ? {} : { adapter }),
      ...(options.gracefulShutdownMs === undefined
        ? {}
        : { gracefulShutdownMs: options.gracefulShutdownMs })
    })
  )

const makeFakeAdapter = (makeChild: () => ProcessChild): ProcessAdapter => ({
  spawn: () => makeChild()
})

interface FakeChild extends ProcessChild {
  readonly stdinWrites: Uint8Array[]
  readonly stdinClosed: boolean
  readonly killedWith: ProcessSignalInput | undefined
  readonly treeTerminated: boolean
  readonly treeForceKilled: boolean
}

const makeFakeChild = (options: {
  readonly stdout: readonly string[]
  readonly stderr?: readonly string[]
  readonly exit: { readonly code: number; readonly signal?: string }
  readonly naturalExitDelayMs?: number
  readonly ignoreTerminate?: boolean
}): FakeChild => {
  const stdinWrites: Uint8Array[] = []
  let stdinClosed = false
  let killedWith: ProcessSignalInput | undefined
  let treeTerminated = false
  let treeForceKilled = false
  let running = true
  let settled = false
  let resolveExit: (status: ProcessExitStatus) => void
  const exited = new Promise<ProcessExitStatus>((resolve) => {
    resolveExit = resolve
  })
  const finish = (signal?: string): void => {
    if (settled) {
      return
    }
    settled = true
    clearTimeout(naturalExitTimer)
    running = false
    resolveExit(
      new ProcessExitStatus({
        code: options.exit.code,
        ...(signal === undefined
          ? options.exit.signal === undefined
            ? {}
            : { signal: options.exit.signal }
          : { signal })
      })
    )
  }
  const naturalExitTimer = setTimeout(() => finish(), options.naturalExitDelayMs ?? 0)
  naturalExitTimer.unref()

  const child: FakeChild = {
    pid: 42,
    stdout: readableFromStrings(options.stdout),
    stderr: readableFromStrings(options.stderr ?? []),
    exited,
    stdinWrites,
    get stdinClosed() {
      return stdinClosed
    },
    get killedWith() {
      return killedWith
    },
    get treeTerminated() {
      return treeTerminated
    },
    get treeForceKilled() {
      return treeForceKilled
    },
    writeStdin: async (chunk) => {
      stdinWrites.push(chunk)
    },
    closeStdin: async () => {
      stdinClosed = true
    },
    isRunning: () => running,
    terminateTree: async () => {
      treeTerminated = true
      if (options.ignoreTerminate !== true) {
        finish("SIGTERM")
      }
    },
    forceKillTree: async () => {
      treeForceKilled = true
      finish("SIGKILL")
    },
    kill: (signal) => {
      killedWith = signal ?? "SIGTERM"
      finish(String(killedWith))
    }
  }

  return child
}

const readableFromStrings = (chunks: readonly string[]): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(textEncoder.encode(chunk))
      }
      controller.close()
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

const waitUntil = async (predicate: () => Promise<boolean>): Promise<void> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await predicate()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("condition was not met")
}

const waitForChildPids = async (path: string): Promise<readonly number[]> => {
  let pids: readonly number[] = []
  await waitUntil(async () => {
    try {
      const contents = await readFile(path, "utf8")
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
