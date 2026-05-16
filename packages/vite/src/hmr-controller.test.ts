import { resolve } from "node:path"
import { describe, expect, test } from "bun:test"
import { encodeFrame, FrameDecoder } from "@effect-desktop/core/runtime/transport"
import { type Cause, Deferred, Effect, Layer, Queue, Schedule, Sink, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { makeHmrController, type ViteDevRuntimeServer } from "./hmr-controller.js"
import {
  FRAME_DOWN_EVENT,
  FRAME_UP_EVENT,
  RUNTIME_READY_EVENT,
  RUNTIME_RESTART_EVENT
} from "./virtual-module.js"

describe("HMR controller", () => {
  test("spawns the runtime through ChildProcessSpawner and forwards frames through HMR", async () => {
    const fake = makeFakeProcessLayer()
    const server = makeFakeServer()
    const controller = makeHmrController({
      entry: "src/runtime.ts",
      cwd: "/workspace/app",
      server,
      processLayer: fake.layer
    })

    await waitFor(() => server.sent.some(([event]) => event === RUNTIME_READY_EVENT))

    const record = firstRecord(fake.records)
    expect(record.command._tag).toBe("StandardCommand")
    if (record.command._tag !== "StandardCommand") {
      throw new Error("expected standard command")
    }
    expect(record.command.command).toBe("bun")
    expect(record.command.args).toEqual(["run", resolve("/workspace/app", "src/runtime.ts")])
    expect(record.command.options.stdin).toEqual({ stream: "pipe", endOnDone: false })

    const down = new Uint8Array([1, 2, 3, 4])
    await Effect.runPromise(Queue.offer(record.stdout, encodeFrame(down)))

    await waitFor(() => server.sent.some(([event]) => event === FRAME_DOWN_EVENT))
    const downPayload = server.sent.find(([event]) => event === FRAME_DOWN_EVENT)?.[1]
    expect(decodeSentFrame(downPayload)).toEqual(down)

    const up = new Uint8Array([9, 8, 7])
    server.emitWs(FRAME_UP_EVENT, { data: Buffer.from(up).toString("base64") })

    await waitFor(() => record.stdin.length > 0)
    expect(decodeWrittenFrames(record.stdin)).toEqual([up])

    controller.dispose()
    await waitFor(() => record.killed)
  })

  test("restart closes the previous process before spawning the replacement", async () => {
    const fake = makeFakeProcessLayer()
    const server = makeFakeServer()
    const controller = makeHmrController({
      entry: "src/runtime.ts",
      cwd: "/workspace/app",
      server,
      processLayer: fake.layer
    })

    await waitFor(() => server.sent.some(([event]) => event === RUNTIME_READY_EVENT))
    server.emitWatchChange(resolve("/workspace/app", "src/runtime.ts"))

    await waitFor(() => fake.records.length === 2)
    expect(fake.records[0]?.killed).toBe(true)
    expect(fake.events).toEqual(["spawn:1", "close:1", "spawn:2"])
    await waitFor(() => server.sent.some(([event]) => event === RUNTIME_RESTART_EVENT))

    controller.dispose()
    await waitFor(() => fake.records.every((record) => record.killed))
  })

  test("initial runtime frames are not dropped before active process assignment", async () => {
    const initialFrame = new Uint8Array([5, 6, 7])
    const fake = makeFakeProcessLayer({ initialFrames: [initialFrame] })
    const server = makeFakeServer()
    const controller = makeHmrController({
      entry: "src/runtime.ts",
      cwd: "/workspace/app",
      server,
      processLayer: fake.layer
    })

    await waitFor(() => server.sent.some(([event]) => event === FRAME_DOWN_EVENT))
    const downPayload = server.sent.find(([event]) => event === FRAME_DOWN_EVENT)?.[1]
    expect(decodeSentFrame(downPayload)).toEqual(initialFrame)

    controller.dispose()
    controller.dispose()
    await waitFor(() => fake.records.every((record) => record.killed))
    expect(fake.events).toEqual(["spawn:1", "close:1"])
  })

  test("runtime frame errors are reported without failing the controller lifecycle", async () => {
    const fake = makeFakeProcessLayer()
    const server = makeFakeServer()
    const controller = makeHmrController({
      entry: "src/runtime.ts",
      cwd: "/workspace/app",
      server,
      processLayer: fake.layer
    })

    await waitFor(() => server.sent.some(([event]) => event === RUNTIME_READY_EVENT))
    const record = firstRecord(fake.records)
    await Effect.runPromise(Queue.offer(record.stdout, new Uint8Array([0, 0, 0, 4, 1])))
    await Effect.runPromise(Queue.end(record.stdout))

    await waitFor(() => server.errors.some((error) => error.includes("runtime error")))
    controller.dispose()
    await waitFor(() => record.killed)
  })

  test("dispose is idempotent when Vite close hooks fire more than once", async () => {
    const fake = makeFakeProcessLayer()
    const server = makeFakeServer()
    const controller = makeHmrController({
      entry: "src/runtime.ts",
      cwd: "/workspace/app",
      server,
      processLayer: fake.layer
    })

    await waitFor(() => server.sent.some(([event]) => event === RUNTIME_READY_EVENT))
    controller.dispose()
    controller.dispose()

    await waitFor(() => fake.records.every((record) => record.killed))
    expect(fake.events).toEqual(["spawn:1", "close:1"])
  })

  test("dispose unregisters Vite websocket and watcher handlers", async () => {
    const fake = makeFakeProcessLayer()
    const server = makeFakeServer()
    const controller = makeHmrController({
      entry: "src/runtime.ts",
      cwd: "/workspace/app",
      server,
      processLayer: fake.layer
    })

    await waitFor(() => server.sent.some(([event]) => event === RUNTIME_READY_EVENT))
    expect(server.listenerCounts()).toEqual({ frameUp: 1, change: 1 })

    controller.dispose()
    await waitFor(() => fake.records.every((record) => record.killed))
    await waitFor(
      () => server.listenerCounts().frameUp === 0 && server.listenerCounts().change === 0
    )
  })

  test("rapid restarts are serialized through process cleanup", async () => {
    const fake = makeFakeProcessLayer()
    const server = makeFakeServer()
    const controller = makeHmrController({
      entry: "src/runtime.ts",
      cwd: "/workspace/app",
      server,
      processLayer: fake.layer
    })

    await waitFor(() => server.sent.some(([event]) => event === RUNTIME_READY_EVENT))
    const entryPath = resolve("/workspace/app", "src/runtime.ts")
    server.emitWatchChange(entryPath)
    server.emitWatchChange(entryPath)

    await waitFor(() => fake.records.length === 3)
    expect(fake.events).toEqual(["spawn:1", "close:1", "spawn:2", "close:2", "spawn:3"])

    controller.dispose()
    await waitFor(() => fake.records.every((record) => record.killed))
  })
})

interface FakeProcessRecord {
  readonly id: number
  readonly command: ChildProcess.Command
  readonly stdout: Queue.Queue<Uint8Array, Cause.Done>
  readonly stdin: Uint8Array[]
  killed: boolean
}

const makeFakeProcessLayer = (
  options: { readonly initialFrames?: readonly Uint8Array[] } = {}
): {
  readonly layer: Layer.Layer<ChildProcessSpawner.ChildProcessSpawner, never, never>
  readonly records: FakeProcessRecord[]
  readonly events: string[]
} => {
  const records: FakeProcessRecord[] = []
  const events: string[] = []
  const spawner = ChildProcessSpawner.make((command) =>
    Effect.gen(function* () {
      const id = records.length + 1
      const stdout = yield* Queue.bounded<Uint8Array, Cause.Done>(16)
      const exit = yield* Deferred.make<ChildProcessSpawner.ExitCode>()
      const record: FakeProcessRecord = {
        id,
        command,
        stdout,
        stdin: [],
        killed: false
      }
      records.push(record)
      events.push(`spawn:${id}`)
      for (const frame of options.initialFrames ?? []) {
        yield* Queue.offer(stdout, encodeFrame(frame))
      }

      const kill = Effect.gen(function* () {
        if (!record.killed) {
          record.killed = true
          events.push(`close:${id}`)
          yield* Queue.end(stdout)
          yield* Deferred.succeed(exit, ChildProcessSpawner.ExitCode(0))
        }
      })
      yield* Effect.addFinalizer(() => kill)

      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(id),
        exitCode: Deferred.await(exit),
        isRunning: Effect.sync(() => !record.killed),
        kill: () => kill,
        stdin: Sink.forEach((chunk: Uint8Array) =>
          Effect.sync(() => {
            record.stdin.push(chunk)
          })
        ),
        stdout: Stream.fromQueue(stdout),
        stderr: Stream.empty,
        all: Stream.fromQueue(stdout),
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void)
      })
    })
  )

  return {
    layer: Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
    records,
    events
  }
}

type SentEvent = readonly [string, unknown]

const makeFakeServer = (): ViteDevRuntimeServer & {
  readonly sent: SentEvent[]
  readonly errors: string[]
  readonly emitWs: (event: string, payload: { readonly data: string }) => void
  readonly emitWatchChange: (filePath: string) => void
  readonly listenerCounts: () => { readonly frameUp: number; readonly change: number }
} => {
  const wsHandlers = new Map<string, Set<(payload: { readonly data: string }) => void>>()
  const watchHandlers = new Set<(filePath: string) => void>()
  const sent: SentEvent[] = []
  const errors: string[] = []

  return {
    sent,
    errors,
    ws: {
      send: (event, payload) => {
        sent.push([event, payload])
      },
      on: (event, handler) => {
        const handlers = wsHandlers.get(event) ?? new Set()
        handlers.add(handler)
        wsHandlers.set(event, handlers)
      },
      off: (event, handler) => {
        const handlers = wsHandlers.get(event)
        handlers?.delete(handler)
        if (handlers?.size === 0) {
          wsHandlers.delete(event)
        }
      }
    },
    watcher: {
      on: (_event, handler) => {
        watchHandlers.add(handler)
      },
      off: (_event, handler) => {
        watchHandlers.delete(handler)
      }
    },
    httpServer: {
      once: () => {}
    },
    config: {
      logger: {
        error: (message) => {
          errors.push(message)
        }
      }
    },
    emitWs: (event, payload) => {
      for (const handler of wsHandlers.get(event) ?? []) {
        handler(payload)
      }
    },
    emitWatchChange: (filePath) => {
      for (const handler of watchHandlers) {
        handler(filePath)
      }
    },
    listenerCounts: () => ({
      frameUp: wsHandlers.get(FRAME_UP_EVENT)?.size ?? 0,
      change: watchHandlers.size
    })
  }
}

const decodeSentFrame = (payload: unknown): Uint8Array => {
  if (!isFramePayload(payload)) {
    throw new Error("missing frame payload")
  }
  return new Uint8Array(Buffer.from(payload.data, "base64"))
}

const decodeWrittenFrames = (chunks: readonly Uint8Array[]): readonly Uint8Array[] => {
  const decoder = new FrameDecoder()
  return decoder.push(concatBytes(chunks))
}

const concatBytes = (chunks: readonly Uint8Array[]): Uint8Array => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

const isFramePayload = (payload: unknown): payload is { readonly data: string } =>
  typeof payload === "object" &&
  payload !== null &&
  "data" in payload &&
  typeof payload.data === "string"

const waitFor = async (predicate: () => boolean): Promise<void> => {
  await Effect.runPromise(
    Effect.suspend(() =>
      predicate() ? Effect.void : Effect.fail(new Error("condition not met"))
    ).pipe(
      Effect.retry(Schedule.spaced("5 millis").pipe(Schedule.both(Schedule.recurs(200)))),
      Effect.mapError(() => new Error("timed out waiting for condition"))
    )
  )
}

const firstRecord = (records: readonly FakeProcessRecord[]): FakeProcessRecord => {
  const record = records[0]
  if (!record) {
    throw new Error("missing process record")
  }
  return record
}
