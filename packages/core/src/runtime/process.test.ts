import { expect, test } from "bun:test"
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

test("Process spawn exposes stdout and exit status", async () => {
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

test("Process spawn registers a scoped running resource", async () => {
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

test("Process removes the resource when a child exits without awaiting handle.exit", async () => {
  const fixture = await makeFixture(
    makeFakeAdapter(() => makeFakeChild({ stdout: [], exit: { code: 0 } }))
  )

  await Effect.runPromise(fixture.service.spawn("echo", ["hi"], { ownerScope: "scope-main" }))
  await waitUntil(async () => {
    const snapshot = await Effect.runPromise(fixture.registry.list())
    return snapshot.entries.length === 0
  })
})

test("Process spawn validates required owner scope before adapter activity", async () => {
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

test("Process spawn reports missing options as a typed failure", async () => {
  const fixture = await makeFixture(
    makeFakeAdapter(() => makeFakeChild({ stdout: [], exit: { code: 0 } }))
  )

  const exit = await Effect.runPromiseExit(fixture.service.spawn("echo"))

  expectFailure(exit, HostProtocolInvalidArgumentError)
})

test("Process spawn maps missing executable to FileNotFound", async () => {
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

test("Process stdin sink writes chunks and closes when the sink completes", async () => {
  const child = makeFakeChild({ stdout: [], exit: { code: 0 } })
  const fixture = await makeFixture(makeFakeAdapter(() => child))
  const handle = await Effect.runPromise(
    fixture.service.spawn("cat", [], { ownerScope: "scope-main" })
  )

  await Effect.runPromise(Stream.make(textEncoder.encode("abc")).pipe(Stream.run(handle.stdin)))

  expect(decodeChunks(child.stdinWrites)).toBe("abc")
  expect(child.stdinClosed).toBe(true)
})

test("Process kill returns a typed effect and exit preserves the signal", async () => {
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

test("Process spawn works against Bun for stdout and exit code", async () => {
  const fixture = await makeFixture()
  const handle = await Effect.runPromise(
    fixture.service.spawn(process.execPath, ["--eval", "process.stdout.write('hi\\n')"], {
      ownerScope: "scope-main"
    })
  )

  const output = await Effect.runPromise(handle.stdout.pipe(Stream.runCollect))
  const status = await Effect.runPromise(handle.exit)

  expect(decodeChunks(Array.from(output))).toBe("hi\n")
  expect(status.code).toBe(0)
})

const makeFixture = async (
  adapter?: ProcessAdapter
): Promise<{ readonly registry: ResourceRegistryApi; readonly service: ProcessApi }> => {
  const registry = await Effect.runPromise(makeResourceRegistry())
  const service = await makeService(registry, adapter)
  return { registry, service }
}

const makeService = (registry: ResourceRegistryApi, adapter?: ProcessAdapter) =>
  Effect.runPromise(makeProcess(registry, adapter === undefined ? {} : { adapter }))

const makeFakeAdapter = (makeChild: () => ProcessChild): ProcessAdapter => ({
  spawn: () => makeChild()
})

interface FakeChild extends ProcessChild {
  readonly stdinWrites: Uint8Array[]
  readonly stdinClosed: boolean
  readonly killedWith: ProcessSignalInput | undefined
}

const makeFakeChild = (options: {
  readonly stdout: readonly string[]
  readonly stderr?: readonly string[]
  readonly exit: { readonly code: number; readonly signal?: string }
}): FakeChild => {
  const stdinWrites: Uint8Array[] = []
  let stdinClosed = false
  let killedWith: ProcessSignalInput | undefined
  let running = true

  const child: FakeChild = {
    pid: 42,
    stdout: readableFromStrings(options.stdout),
    stderr: readableFromStrings(options.stderr ?? []),
    exited: new Promise((resolve) => {
      setTimeout(() => {
        running = false
        resolve(
          new ProcessExitStatus({
            code: options.exit.code,
            ...(killedWith === undefined
              ? options.exit.signal === undefined
                ? {}
                : { signal: options.exit.signal }
              : { signal: String(killedWith) })
          })
        )
      }, 0)
    }),
    stdinWrites,
    get stdinClosed() {
      return stdinClosed
    },
    get killedWith() {
      return killedWith
    },
    writeStdin: async (chunk) => {
      stdinWrites.push(chunk)
    },
    closeStdin: async () => {
      stdinClosed = true
    },
    isRunning: () => running,
    kill: (signal) => {
      killedWith = signal ?? "SIGTERM"
      running = false
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
