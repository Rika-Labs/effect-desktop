import { describe, expect, test } from "bun:test"
import { encodeFrame, FrameDecoder } from "@orika/core/runtime/transport"
import { type Cause, Deferred, Effect, Layer, Queue, Schedule, Schema, Sink, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { makeHmrController, type ViteDevRuntimeServer } from "./hmr-controller.js"
import {
  FRAME_DOWN_EVENT,
  FRAME_UP_EVENT,
  RUNTIME_READY_EVENT,
  RUNTIME_RESTART_EVENT
} from "./virtual-module.js"

class WaitForTimeout extends Schema.TaggedErrorClass<WaitForTimeout>()("WaitForTimeout", {}) {}

class MissingProcessRecord extends Schema.TaggedErrorClass<MissingProcessRecord>()(
  "MissingProcessRecord",
  {}
) {}

const SyntheticRuntimePath = "/workspace/app/src/runtime.ts"
const SyntheticRuntimeDependencyPath = "/workspace/app/src/runtime-dependency.ts"
const SyntheticRendererPath = "/workspace/app/src/renderer.tsx"

describe("HMR controller", () => {
  test("spawns the runtime through ChildProcessSpawner and forwards frames through HMR", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fake = makeFakeProcessLayer()
        const server = makeFakeServer()
        const controller = makeHmrController({
          entry: "src/runtime.ts",
          cwd: "/workspace/app",
          server,
          processLayer: fake.layer
        })

        yield* waitFor(() => server.sent.some(([event]) => event === RUNTIME_READY_EVENT))

        const record = yield* firstRecord(fake.records)
        expect(record.command._tag).toBe("StandardCommand")
        if (record.command._tag !== "StandardCommand") {
          return
        }
        expect(record.command.command).toBe("bun")
        expect(record.command.args).toEqual(["run", SyntheticRuntimePath])
        expect(record.command.options.stdin).toEqual({ stream: "pipe", endOnDone: false })

        const down = new Uint8Array([1, 2, 3, 4])
        yield* Queue.offer(record.stdout, encodeFrame(down))

        yield* waitFor(() => server.sent.some(([event]) => event === FRAME_DOWN_EVENT))
        const downPayload = server.sent.find(([event]) => event === FRAME_DOWN_EVENT)?.[1]
        expect(decodeSentFrame(downPayload)).toEqual(down)

        const up = new Uint8Array([9, 8, 7])
        server.emitWs(FRAME_UP_EVENT, { data: Buffer.from(up).toString("base64") })

        yield* waitFor(() => record.stdin.length > 0)
        expect(decodeWrittenFrames(record.stdin)).toEqual([up])

        controller.dispose()
        yield* waitFor(() => record.killed)
      })
    ))

  test("restart closes the previous process before spawning the replacement", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fake = makeFakeProcessLayer()
        const server = makeFakeServer()
        const controller = makeHmrController({
          entry: "src/runtime.ts",
          cwd: "/workspace/app",
          server,
          processLayer: fake.layer
        })

        yield* waitFor(() => server.sent.some(([event]) => event === RUNTIME_READY_EVENT))
        controller.handleHotUpdate(SyntheticRuntimePath, [
          makeFakeRuntimeModule(SyntheticRuntimePath)
        ])

        yield* waitFor(() => fake.records.length === 2)
        expect(fake.records[0]?.killed).toBe(true)
        expect(fake.events).toEqual(["spawn:1", "close:1", "spawn:2"])
        yield* waitFor(() => server.sent.some(([event]) => event === RUNTIME_RESTART_EVENT))

        controller.dispose()
        yield* waitFor(() => fake.records.every((record) => record.killed))
      })
    ))

  test("warms Vite SSR module graph after runtime starts", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fake = makeFakeProcessLayer()
        const server = makeFakeServer()
        const controller = makeHmrController({
          entry: "src/runtime.ts",
          cwd: "/workspace/app",
          server,
          processLayer: fake.layer
        })

        yield* waitFor(() => server.transforms.length === 1)
        expect(server.transforms).toEqual([[SyntheticRuntimePath, { ssr: true }]])

        controller.dispose()
        yield* waitFor(() => fake.records.every((record) => record.killed))
      })
    ))

  test("restarts when Vite reports a changed runtime dependency", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fake = makeFakeProcessLayer()
        const server = makeFakeServer()
        const controller = makeHmrController({
          entry: "src/runtime.ts",
          cwd: "/workspace/app",
          server,
          processLayer: fake.layer
        })

        yield* waitFor(() => server.sent.some(([event]) => event === RUNTIME_READY_EVENT))
        const runtime = makeFakeRuntimeModule(SyntheticRuntimePath)
        const dependency = makeFakeRuntimeModule(SyntheticRuntimeDependencyPath)
        dependency.importers.add(runtime)

        controller.handleHotUpdate(SyntheticRuntimeDependencyPath, [dependency])

        yield* waitFor(() => fake.records.length === 2)
        expect(fake.records[0]?.killed).toBe(true)
        expect(fake.events).toEqual(["spawn:1", "close:1", "spawn:2"])

        controller.dispose()
        yield* waitFor(() => fake.records.every((record) => record.killed))
      })
    ))

  test("ignores Vite hot updates outside the runtime dependency graph", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fake = makeFakeProcessLayer()
        const server = makeFakeServer()
        const controller = makeHmrController({
          entry: "src/runtime.ts",
          cwd: "/workspace/app",
          server,
          processLayer: fake.layer
        })

        yield* waitFor(() => server.sent.some(([event]) => event === RUNTIME_READY_EVENT))
        const renderer = makeFakeRuntimeModule(SyntheticRendererPath)

        controller.handleHotUpdate(SyntheticRendererPath, [renderer])

        yield* Effect.sleep("25 millis")
        expect(fake.records).toHaveLength(1)

        controller.dispose()
        yield* waitFor(() => fake.records.every((record) => record.killed))
      })
    ))

  test("initial runtime frames are not dropped before active process assignment", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const initialFrame = new Uint8Array([5, 6, 7])
        const fake = makeFakeProcessLayer({ initialFrames: [initialFrame] })
        const server = makeFakeServer()
        const controller = makeHmrController({
          entry: "src/runtime.ts",
          cwd: "/workspace/app",
          server,
          processLayer: fake.layer
        })

        yield* waitFor(() => server.sent.some(([event]) => event === FRAME_DOWN_EVENT))
        const downPayload = server.sent.find(([event]) => event === FRAME_DOWN_EVENT)?.[1]
        expect(decodeSentFrame(downPayload)).toEqual(initialFrame)

        controller.dispose()
        controller.dispose()
        yield* waitFor(() => fake.records.every((record) => record.killed))
        expect(fake.events).toEqual(["spawn:1", "close:1"])
      })
    ))

  test("runtime frame errors are reported without failing the controller lifecycle", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fake = makeFakeProcessLayer()
        const server = makeFakeServer()
        const controller = makeHmrController({
          entry: "src/runtime.ts",
          cwd: "/workspace/app",
          server,
          processLayer: fake.layer
        })

        yield* waitFor(() => server.sent.some(([event]) => event === RUNTIME_READY_EVENT))
        const record = yield* firstRecord(fake.records)
        yield* Queue.offer(record.stdout, new Uint8Array([0, 0, 0, 4, 1]))
        yield* Queue.end(record.stdout)

        yield* waitFor(() => server.errors.some((error) => error.includes("runtime error")))
        controller.dispose()
        yield* waitFor(() => record.killed)
      })
    ))

  test("dispose is idempotent when Vite close hooks fire more than once", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fake = makeFakeProcessLayer()
        const server = makeFakeServer()
        const controller = makeHmrController({
          entry: "src/runtime.ts",
          cwd: "/workspace/app",
          server,
          processLayer: fake.layer
        })

        yield* waitFor(() => server.sent.some(([event]) => event === RUNTIME_READY_EVENT))
        controller.dispose()
        controller.dispose()

        yield* waitFor(() => fake.records.every((record) => record.killed))
        expect(fake.events).toEqual(["spawn:1", "close:1"])
      })
    ))

  test("dispose unregisters Vite websocket handlers", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fake = makeFakeProcessLayer()
        const server = makeFakeServer()
        const controller = makeHmrController({
          entry: "src/runtime.ts",
          cwd: "/workspace/app",
          server,
          processLayer: fake.layer
        })

        yield* waitFor(() => server.sent.some(([event]) => event === RUNTIME_READY_EVENT))
        expect(server.listenerCounts()).toEqual({ frameUp: 1 })

        controller.dispose()
        yield* waitFor(() => fake.records.every((record) => record.killed))
        yield* waitFor(() => server.listenerCounts().frameUp === 0)
      })
    ))

  test("dispose does not surface interrupted in-flight sends as runtime errors", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const stdinStarted = yield* Deferred.make<void>()
        const fake = makeFakeProcessLayer({
          stdin: Sink.forEach(() =>
            Deferred.succeed(stdinStarted, undefined).pipe(Effect.andThen(Effect.never))
          )
        })
        const server = makeFakeServer()
        const controller = makeHmrController({
          entry: "src/runtime.ts",
          cwd: "/workspace/app",
          server,
          processLayer: fake.layer
        })

        yield* waitFor(() => server.sent.some(([event]) => event === RUNTIME_READY_EVENT))

        const up = new Uint8Array([9, 8, 7])
        server.emitWs(FRAME_UP_EVENT, { data: Buffer.from(up).toString("base64") })
        yield* Deferred.await(stdinStarted)

        controller.dispose()
        yield* waitFor(() => fake.records.every((record) => record.killed))

        expect(server.errors).toEqual([])
      })
    ))

  test("rapid restarts are serialized through process cleanup", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fake = makeFakeProcessLayer()
        const server = makeFakeServer()
        const controller = makeHmrController({
          entry: "src/runtime.ts",
          cwd: "/workspace/app",
          server,
          processLayer: fake.layer
        })

        yield* waitFor(() => server.sent.some(([event]) => event === RUNTIME_READY_EVENT))
        controller.handleHotUpdate(SyntheticRuntimePath, [
          makeFakeRuntimeModule(SyntheticRuntimePath)
        ])
        controller.handleHotUpdate(SyntheticRuntimePath, [
          makeFakeRuntimeModule(SyntheticRuntimePath)
        ])

        yield* waitFor(() => fake.records.length === 3)
        expect(fake.events).toEqual(["spawn:1", "close:1", "spawn:2", "close:2", "spawn:3"])

        controller.dispose()
        yield* waitFor(() => fake.records.every((record) => record.killed))
      })
    ))
})

interface FakeProcessRecord {
  readonly id: number
  readonly command: ChildProcess.Command
  readonly stdout: Queue.Queue<Uint8Array, Cause.Done>
  readonly stdin: Uint8Array[]
  killed: boolean
}

const makeFakeProcessLayer = (
  options: {
    readonly initialFrames?: readonly Uint8Array[]
    readonly stdin?: Sink.Sink<void, Uint8Array, never, never, never>
  } = {}
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
        stdin:
          options.stdin ??
          Sink.forEach((chunk: Uint8Array) =>
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

interface FakeRuntimeModule {
  readonly id: string
  readonly file: string
  readonly importers: Set<FakeRuntimeModule>
}

const makeFakeRuntimeModule = (file: string): FakeRuntimeModule => ({
  id: file,
  file,
  importers: new Set()
})

type SentEvent = readonly [string, unknown]

const makeFakeServer = (): ViteDevRuntimeServer & {
  readonly sent: SentEvent[]
  readonly errors: string[]
  readonly transforms: Array<readonly [string, { readonly ssr?: boolean } | undefined]>
  readonly emitWs: (event: string, payload: { readonly data: string }) => void
  readonly listenerCounts: () => { readonly frameUp: number }
} => {
  const wsHandlers = new Map<string, Set<(payload: { readonly data: string }) => void>>()
  const sent: SentEvent[] = []
  const errors: string[] = []
  const transforms: Array<readonly [string, { readonly ssr?: boolean } | undefined]> = []

  return {
    sent,
    errors,
    transforms,
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
    transformRequest: (url, options) => {
      transforms.push([url, options])
      return Promise.resolve(undefined)
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
    listenerCounts: () => ({
      frameUp: wsHandlers.get(FRAME_UP_EVENT)?.size ?? 0
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

const waitFor = (predicate: () => boolean): Effect.Effect<void, WaitForTimeout, never> =>
  Effect.suspend(() => (predicate() ? Effect.void : new WaitForTimeout().asEffect())).pipe(
    Effect.retry(Schedule.spaced("5 millis").pipe(Schedule.both(Schedule.recurs(200))))
  )

const firstRecord = (
  records: readonly FakeProcessRecord[]
): Effect.Effect<FakeProcessRecord, MissingProcessRecord, never> => {
  const record = records[0]
  return record === undefined ? new MissingProcessRecord().asEffect() : Effect.succeed(record)
}
