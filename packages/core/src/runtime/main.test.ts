import { expect, test } from "bun:test"
import { Buffer } from "node:buffer"
import { spawn } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { Effect, Schema } from "effect"
import {
  decodeHostProtocolFrame,
  HOST_PING_METHOD,
  HOST_PROTOCOL_VERSION,
  type HostProtocolRequestEnvelope,
  HOST_VERSION_METHOD,
  WINDOW_CREATE_METHOD,
  WINDOW_DESTROY_METHOD
} from "@effect-desktop/bridge"
import packageJson from "../../package.json" with { type: "json" }
import {
  APP_EXPORT_ENV,
  APP_MODULE_ENV,
  STARTUP_WINDOWS_ENV,
  WINDOW_SMOKE_TEST_ENV
} from "./window-supervisor.js"

const PACKAGE_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)))

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

test("runtime entry can open startup windows from the Desktop app module", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-runtime-"))
      )
      const modulePath = join(directory, "app.ts")
      const coreSpecifier = pathToFileURL(resolve(PACKAGE_ROOT, "src/index.ts")).href
      yield* Effect.promise(() =>
        writeFile(
          modulePath,
          [
            `import { Desktop } from ${encodeUnknownJson(coreSpecifier)}`,
            "export default Desktop.make({",
            '  windows: Desktop.window("main", { title: "Module Notes", width: 960, height: 640, renderer: "/" })',
            "})"
          ].join("\n"),
          "utf8"
        )
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
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

test("runtime entry runs from a Node-targeted build", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        mkdtemp(join(tmpdir(), "effect-desktop-runtime-node-"))
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
        yield* Effect.promise(() => rm(directory, { recursive: true, force: true }))
      }
    })
  ))

interface RuntimeHostOptions {
  readonly appModule?: string
  readonly startupWindows?: unknown
  readonly windowSmokeTest?: boolean
  readonly runtimeCommand?: string
  readonly runtimeArgs?: readonly string[]
}

const runRuntimeWithFakeHost = (options: RuntimeHostOptions = {}): Promise<RuntimeHostResult> =>
  Effect.runPromise(
    Effect.callback<RuntimeHostResult, MainTestRuntimeFailure>((resume) => {
      const env: NodeJS.ProcessEnv = {
        ...process.env
      }
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

      const child = spawn(
        options.runtimeCommand ?? "bun",
        Array.from(options.runtimeArgs ?? ["src/runtime/main.ts"]),
        {
          cwd: PACKAGE_ROOT,
          env,
          stdio: ["pipe", "pipe", "pipe"]
        }
      )
      const readyEvents: RuntimeReadyEvent[] = []
      const methods: string[] = []
      const stderrChunks: Buffer[] = []
      let stdoutBuffer = Buffer.alloc(0)
      let readyParsed = false
      let settled = false

      const reject = (message: string): void => {
        if (settled) {
          return
        }

        settled = true
        child.kill()
        resume(Effect.fail(new MainTestRuntimeFailure({ message })))
      }

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBuffer = Buffer.concat([stdoutBuffer, chunk])
        try {
          processStdout()
        } catch (error) {
          reject(error instanceof globalThis.Error ? error.message : String(error))
        }
      })
      child.stderr.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk)
      })
      child.on("error", (error) => reject(error.message))
      child.on("close", (exitCode) => {
        if (exitCode !== null && typeof exitCode !== "number") {
          reject("runtime process closed with invalid exit code")
          return
        }
        if (settled) {
          return
        }

        settled = true
        resume(
          Effect.succeed({
            readyEvents,
            methods,
            stderr: Buffer.concat(stderrChunks).toString("utf8"),
            exitCode,
            trailingStdoutBytes: stdoutBuffer.byteLength
          })
        )
      })

      const processStdout = (): void => {
        if (!readyParsed) {
          const newline = stdoutBuffer.indexOf(0x0a)
          if (newline === -1) {
            return
          }

          const line = stdoutBuffer.subarray(0, newline).toString("utf8").replace(/\r$/, "")
          stdoutBuffer = stdoutBuffer.subarray(newline + 1)
          const parsed = decodeRuntimeReadyEventJson(line)
          readyEvents.push(parsed)
          readyParsed = true
        }

        while (stdoutBuffer.byteLength >= 4) {
          const frameLength = stdoutBuffer.readUInt32BE(0)
          if (stdoutBuffer.byteLength < 4 + frameLength) {
            return
          }

          const requestValue = Effect.runSync(
            decodeHostProtocolFrame(
              stdoutBuffer.subarray(4, 4 + frameLength),
              "runtime stdout request"
            )
          )
          stdoutBuffer = stdoutBuffer.subarray(4 + frameLength)

          if (requestValue.kind !== "request") {
            throw new globalThis.Error(
              `runtime stdout was not a request: ${encodeUnknownJson(requestValue)}`
            )
          }

          methods.push(requestValue.method)
          child.stdin.write(encodeFrame(responseFor(requestValue)))
        }
      }
      return Effect.sync(() => {
        if (!settled) {
          settled = true
          child.kill()
        }
      })
    })
  )

const runCommand = (command: string, args: readonly string[]): Promise<void> =>
  Effect.runPromise(
    Effect.callback<void, MainTestRuntimeFailure>((resume) => {
      const child = spawn(command, Array.from(args), {
        cwd: PACKAGE_ROOT,
        stdio: ["ignore", "ignore", "pipe"]
      })
      const stderrChunks: Buffer[] = []

      child.stderr.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk)
      })
      let settled = false
      const reject = (message: string): void => {
        if (settled) {
          return
        }
        settled = true
        resume(Effect.fail(new MainTestRuntimeFailure({ message })))
      }

      child.on("error", (error) => reject(error.message))
      child.on("close", (exitCode) => {
        if (exitCode !== null && typeof exitCode !== "number") {
          reject(`${command} ${args.join(" ")} closed with invalid exit code`)
          return
        }
        if (settled) {
          return
        }
        settled = true
        if (exitCode === 0) {
          resume(Effect.void)
        } else {
          resume(
            Effect.fail(
              new MainTestRuntimeFailure({
                message: `${command} ${args.join(" ")} failed with ${exitCode}: ${Buffer.concat(stderrChunks).toString("utf8")}`
              })
            )
          )
        }
      })
      return Effect.sync(() => {
        if (!settled) {
          settled = true
          child.kill()
        }
      })
    })
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
