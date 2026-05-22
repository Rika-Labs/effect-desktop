import { expect, test } from "bun:test"
import { Buffer } from "node:buffer"
import { fileURLToPath, pathToFileURL } from "node:url"

import { BunServices } from "@effect/platform-bun"
import {
  Effect,
  Fiber,
  FileSystem,
  Inspectable,
  ManagedRuntime,
  Path,
  Queue,
  Schema,
  Stream
} from "effect"
import { ChildProcess } from "effect/unstable/process"
import {
  decodeHostProtocolFrame,
  HOST_PING_METHOD,
  HOST_PROTOCOL_VERSION,
  type HostProtocolRequestEnvelope,
  HOST_VERSION_METHOD,
  WINDOW_CREATE_METHOD,
  WINDOW_DESTROY_METHOD
} from "@orika/bridge"
import packageJson from "../../package.json" with { type: "json" }
import {
  APP_EXPORT_ENV,
  APP_MODULE_ENV,
  STARTUP_WINDOWS_ENV,
  WINDOW_SMOKE_TEST_ENV
} from "./window-supervisor.js"

const formatCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : Inspectable.toStringUnknown(cause)

const BunServicesRuntime = ManagedRuntime.make(BunServices.layer)

const runWithBun = <A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>
): Effect.Effect<A, E, never> =>
  Effect.promise(() => BunServicesRuntime.runPromise(effect)) as Effect.Effect<A, E, never>

const pathService = BunServicesRuntime.runSync(Path.Path.asEffect())

const join = (...segments: readonly string[]): string => pathService.join(...segments)

const PACKAGE_ROOT = pathService.resolve(fileURLToPath(new URL("../..", import.meta.url)))

const RuntimeReadyEvent = Schema.Struct({
  event: Schema.Literal("runtime.ready"),
  version: Schema.String
})

const RuntimeReadyEventJson = Schema.fromJsonString(RuntimeReadyEvent)
const decodeRuntimeReadyEventJson = Schema.decodeUnknownSync(RuntimeReadyEventJson)

const encodeUnknownJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))

class MainTestRuntimeFailure extends Schema.TaggedErrorClass<MainTestRuntimeFailure>()(
  "MainTestRuntimeFailure",
  {
    message: Schema.String
  }
) {}

type RuntimeReadyEvent = typeof RuntimeReadyEvent.Type
type HostProtocolRequest = HostProtocolRequestEnvelope

interface RuntimeHostResult {
  readonly readyEvents: RuntimeReadyEvent[]
  readonly methods: string[]
  readonly stderr: string
  readonly exitCode: number | null
  readonly trailingStdoutBytes: number
}

test("runtime entry emits ready and opens declared startup windows after host readiness", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* Effect.promise(() =>
        runRuntimeWithFakeHost({
          startupWindows: {
            main: {
              title: "Notes",
              width: 960,
              height: 640,
              renderer: "/"
            }
          }
        })
      )

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe("")
      expect(result.trailingStdoutBytes).toBe(0)
      expect(result.readyEvents).toEqual([
        {
          event: "runtime.ready",
          version: packageJson.version
        }
      ])
      expect(result.methods).toEqual([
        HOST_VERSION_METHOD,
        HOST_PING_METHOD,
        WINDOW_CREATE_METHOD,
        WINDOW_DESTROY_METHOD
      ])
    })
  ))

test("runtime smoke mode rejects launch when no startup windows are declared", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* Effect.promise(() => runRuntimeWithFakeHost())

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain("at least one startup window must be declared")
      expect(result.trailingStdoutBytes).toBe(0)
      expect(result.methods).toEqual([])
    })
  ))

test("runtime normal launch rejects launch when no startup windows are declared", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* Effect.promise(() => runRuntimeWithFakeHost({ windowSmokeTest: false }))

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain("at least one startup window must be declared")
      expect(result.trailingStdoutBytes).toBe(0)
      expect(result.methods).toEqual([])
    })
  ))

test("runtime normal launch keeps declared startup windows alive", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* Effect.promise(() =>
        runRuntimeWithFakeHost({
          startupWindows: {
            main: {
              title: "Notes",
              width: 960,
              height: 640,
              renderer: "/"
            }
          },
          killAfterMs: 250,
          windowSmokeTest: false
        })
      )

      expect(result.stderr).toBe("")
      expect(result.trailingStdoutBytes).toBe(0)
      expect(result.methods).toEqual([HOST_VERSION_METHOD, HOST_PING_METHOD, WINDOW_CREATE_METHOD])
    })
  ))

test("runtime entry can open startup windows from the Desktop app module", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* runWithBun(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          return yield* fs.makeTempDirectory({ prefix: "effect-desktop-runtime-" })
        }).pipe(Effect.orDie)
      )
      const modulePath = join(directory, "app.ts")
      const coreSpecifier = pathToFileURL(pathService.resolve(PACKAGE_ROOT, "src/index.ts")).href
      yield* runWithBun(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          yield* fs.writeFileString(
            modulePath,
            [
              `import { Desktop } from ${encodeUnknownJson(coreSpecifier)}`,
              "export default Desktop.make({",
              '  windows: Desktop.window("main", { title: "Module Notes", width: 960, height: 640, renderer: "/" })',
              "})"
            ].join("\n")
          )
        }).pipe(Effect.orDie)
      )

      try {
        const result = yield* Effect.promise(() =>
          runRuntimeWithFakeHost({
            appModule: pathToFileURL(modulePath).href
          })
        )

        expect(result.exitCode).toBe(0)
        expect(result.stderr).toBe("")
        expect(result.trailingStdoutBytes).toBe(0)
        expect(result.methods).toEqual([
          HOST_VERSION_METHOD,
          HOST_PING_METHOD,
          WINDOW_CREATE_METHOD,
          WINDOW_DESTROY_METHOD
        ])
      } finally {
        yield* runWithBun(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem
            yield* fs.remove(directory, { recursive: true, force: true })
          }).pipe(Effect.orDie)
        )
      }
    })
  ))

test("runtime entry runs from a Node-targeted build", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* runWithBun(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          return yield* fs.makeTempDirectory({ prefix: "effect-desktop-runtime-node-" })
        }).pipe(Effect.orDie)
      )
      const outfile = join(directory, "runtime-main.js")

      try {
        yield* Effect.promise(() =>
          runCommand("bun", ["build", "src/runtime/main.ts", "--target=node", "--outfile", outfile])
        )
        const result = yield* Effect.promise(() =>
          runRuntimeWithFakeHost({
            runtimeCommand: "node",
            runtimeArgs: [outfile],
            startupWindows: {
              main: {
                title: "Node Runtime"
              }
            }
          })
        )

        expect(result.exitCode).toBe(0)
        expect(result.stderr).toBe("")
        expect(result.trailingStdoutBytes).toBe(0)
        expect(result.readyEvents).toEqual([
          {
            event: "runtime.ready",
            version: packageJson.version
          }
        ])
        expect(result.methods).toEqual([
          HOST_VERSION_METHOD,
          HOST_PING_METHOD,
          WINDOW_CREATE_METHOD,
          WINDOW_DESTROY_METHOD
        ])
      } finally {
        yield* runWithBun(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem
            yield* fs.remove(directory, { recursive: true, force: true })
          }).pipe(Effect.orDie)
        )
      }
    })
  ))

interface RuntimeHostOptions {
  readonly appModule?: string
  readonly startupWindows?: unknown
  readonly windowSmokeTest?: boolean
  readonly runtimeCommand?: string
  readonly runtimeArgs?: readonly string[]
  readonly killAfterMs?: number
}

const runtimeEnv = (options: RuntimeHostOptions): Record<string, string | undefined> => {
  const env: Record<string, string | undefined> = { ...process.env }
  if (options.windowSmokeTest !== false) {
    env[WINDOW_SMOKE_TEST_ENV] = "1"
  } else {
    delete env[WINDOW_SMOKE_TEST_ENV]
  }
  delete env[STARTUP_WINDOWS_ENV]
  delete env[APP_MODULE_ENV]
  delete env[APP_EXPORT_ENV]
  if (options.appModule !== undefined) {
    env[APP_MODULE_ENV] = options.appModule
  }
  if (options.startupWindows !== undefined) {
    env[STARTUP_WINDOWS_ENV] = encodeUnknownJson(options.startupWindows)
  }
  return env
}

const runRuntimeWithFakeHost = (options: RuntimeHostOptions = {}): Promise<RuntimeHostResult> =>
  BunServicesRuntime.runPromise(
    Effect.gen(function* () {
      const stdinQueue = yield* Queue.unbounded<Uint8Array>()
      const command = ChildProcess.make(
        options.runtimeCommand ?? "bun",
        Array.from(options.runtimeArgs ?? ["src/runtime/main.ts"]),
        {
          cwd: PACKAGE_ROOT,
          env: runtimeEnv(options),
          extendEnv: false,
          stdin: Stream.fromQueue(stdinQueue),
          stdout: "pipe",
          stderr: "pipe"
        }
      )

      const readyEvents: RuntimeReadyEvent[] = []
      const methods: string[] = []
      let stdoutBuffer = Buffer.alloc(0)
      let readyParsed = false

      return yield* Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* command
          if (options.killAfterMs !== undefined) {
            yield* Effect.sleep(`${options.killAfterMs} millis`).pipe(
              Effect.andThen(handle.kill({ killSignal: "SIGTERM" })),
              Effect.ignore,
              Effect.forkChild
            )
          }
          const stderrFiber = yield* handle.stderr.pipe(
            Stream.runFold(
              () => Buffer.alloc(0),
              (acc, chunk) => Buffer.concat([acc, Buffer.from(chunk)])
            ),
            Effect.forkChild
          )

          const processChunk = (chunk: Uint8Array): Effect.Effect<void, MainTestRuntimeFailure> =>
            Effect.gen(function* () {
              stdoutBuffer = Buffer.concat([stdoutBuffer, Buffer.from(chunk)])
              if (!readyParsed) {
                const newline = stdoutBuffer.indexOf(0x0a)
                if (newline === -1) {
                  return
                }
                const line = stdoutBuffer.subarray(0, newline).toString("utf8").replace(/\r$/, "")
                stdoutBuffer = stdoutBuffer.subarray(newline + 1)
                readyEvents.push(decodeRuntimeReadyEventJson(line))
                readyParsed = true
              }

              while (stdoutBuffer.byteLength >= 4) {
                const frameLength = stdoutBuffer.readUInt32BE(0)
                if (stdoutBuffer.byteLength < 4 + frameLength) {
                  return
                }
                const requestValue = yield* decodeHostProtocolFrame(
                  stdoutBuffer.subarray(4, 4 + frameLength),
                  "runtime stdout request"
                ).pipe(
                  Effect.mapError(
                    (cause) =>
                      new MainTestRuntimeFailure({
                        message: `failed to decode runtime stdout frame: ${formatCause(cause)}`
                      })
                  )
                )
                stdoutBuffer = stdoutBuffer.subarray(4 + frameLength)
                if (requestValue.kind !== "request") {
                  return yield* new MainTestRuntimeFailure({
                    message: `runtime stdout was not a request: ${encodeUnknownJson(requestValue)}`
                  })
                }
                methods.push(requestValue.method)
                yield* Queue.offer(stdinQueue, encodeFrame(responseFor(requestValue)))
              }
            })

          yield* handle.stdout.pipe(
            Stream.mapError(
              (cause) =>
                new MainTestRuntimeFailure({
                  message: `runtime stdout stream failed: ${formatCause(cause)}`
                })
            ),
            Stream.runForEach(processChunk)
          )

          const exitCode =
            options.killAfterMs === undefined
              ? yield* handle.exitCode.pipe(
                  Effect.mapError(
                    (cause) =>
                      new MainTestRuntimeFailure({
                        message: `runtime process exit failed: ${formatCause(cause)}`
                      })
                  )
                )
              : null
          const stderrBuffer = yield* Fiber.join(stderrFiber)

          return {
            readyEvents,
            methods,
            stderr: stderrBuffer.toString("utf8"),
            exitCode: exitCode as number,
            trailingStdoutBytes: stdoutBuffer.byteLength
          } satisfies RuntimeHostResult
        })
      )
    })
  )

const runCommand = (command: string, args: readonly string[]): Promise<void> =>
  BunServicesRuntime.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const child = ChildProcess.make(command, Array.from(args), {
          cwd: PACKAGE_ROOT,
          stdin: "ignore",
          stdout: "ignore",
          stderr: "pipe"
        })
        const handle = yield* child
        const stderrFiber = yield* handle.stderr.pipe(
          Stream.runFold(
            () => Buffer.alloc(0),
            (acc, chunk) => Buffer.concat([acc, Buffer.from(chunk)])
          ),
          Effect.forkChild
        )
        const exitCode = yield* handle.exitCode.pipe(
          Effect.mapError(
            (cause) =>
              new MainTestRuntimeFailure({
                message: `${command} ${args.join(" ")} failed to spawn: ${formatCause(cause)}`
              })
          )
        )
        const stderrBuffer = yield* Fiber.join(stderrFiber)
        if ((exitCode as number) !== 0) {
          return yield* new MainTestRuntimeFailure({
            message: `${command} ${args.join(" ")} failed with ${String(exitCode)}: ${stderrBuffer.toString("utf8")}`
          })
        }
      })
    )
  )

const responseFor = (request: HostProtocolRequest): unknown => {
  const base = {
    kind: "response",
    id: request.id,
    timestamp: request.timestamp + 1,
    traceId: request.traceId
  } as const

  if (request.method === HOST_VERSION_METHOD) {
    return {
      ...base,
      payload: {
        protocolVersion: HOST_PROTOCOL_VERSION
      }
    }
  }

  if (request.method === HOST_PING_METHOD) {
    return base
  }

  if (request.method === WINDOW_CREATE_METHOD) {
    return {
      ...base,
      payload: {
        windowId: "window-1"
      }
    }
  }

  if (request.method === WINDOW_DESTROY_METHOD) {
    return base
  }

  return {
    ...base,
    error: {
      tag: "MethodNotFound",
      method: request.method,
      message: `host method not found: ${request.method}`,
      operation: request.method,
      recoverable: false
    }
  }
}

const encodeFrame = (value: unknown): Buffer => {
  const body = Buffer.from(JSON.stringify(value), "utf8")
  const prefix = Buffer.alloc(4)
  prefix.writeUInt32BE(body.byteLength, 0)
  return Buffer.concat([prefix, body])
}
