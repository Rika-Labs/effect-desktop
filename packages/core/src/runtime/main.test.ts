import { expect, test } from "bun:test"
import { Buffer } from "node:buffer"
import { spawn } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import {
  HOST_PING_METHOD,
  HOST_PROTOCOL_VERSION,
  HOST_VERSION_METHOD,
  WINDOW_CREATE_METHOD,
  WINDOW_DESTROY_METHOD
} from "@effect-desktop/bridge"
import packageJson from "../../package.json" with { type: "json" }
import { APP_MODULE_ENV, STARTUP_WINDOWS_ENV } from "./window-supervisor.js"

const PACKAGE_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)))

interface RuntimeReadyEvent {
  readonly event: "runtime.ready"
  readonly version: string
}

interface HostProtocolRequest {
  readonly kind: "request"
  readonly id: string
  readonly method: string
  readonly timestamp: number
  readonly traceId: string
  readonly payload?: unknown
}

interface RuntimeHostResult {
  readonly readyEvents: RuntimeReadyEvent[]
  readonly methods: string[]
  readonly stderr: string
  readonly exitCode: number | null
  readonly trailingStdoutBytes: number
}

const isRuntimeReadyEvent = (value: unknown): value is RuntimeReadyEvent => {
  if (typeof value !== "object" || value === null) {
    return false
  }

  const record = value as Record<string, unknown>

  return record["event"] === "runtime.ready" && typeof record["version"] === "string"
}

const isHostProtocolRequest = (value: unknown): value is HostProtocolRequest => {
  if (typeof value !== "object" || value === null) {
    return false
  }

  const record = value as Record<string, unknown>

  return (
    record["kind"] === "request" &&
    typeof record["id"] === "string" &&
    typeof record["method"] === "string" &&
    typeof record["timestamp"] === "number" &&
    typeof record["traceId"] === "string"
  )
}

test("runtime entry emits ready and opens declared startup windows after host readiness", async () => {
  const result = await runRuntimeWithFakeHost({
    startupWindows: {
      main: {
        title: "Notes",
        width: 960,
        height: 640,
        renderer: "/"
      }
    }
  })

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

test("runtime smoke mode opens a fallback window when no startup windows are declared", async () => {
  const result = await runRuntimeWithFakeHost()

  expect(result.exitCode).toBe(0)
  expect(result.stderr).toBe("")
  expect(result.trailingStdoutBytes).toBe(0)
  expect(result.methods).toEqual([
    HOST_VERSION_METHOD,
    HOST_PING_METHOD,
    WINDOW_CREATE_METHOD,
    WINDOW_DESTROY_METHOD
  ])
})

test("runtime normal launch opens a fallback window when no startup windows are declared", async () => {
  const result = await runRuntimeWithFakeHost({ windowSmokeTest: false })

  expect(result.exitCode).toBe(0)
  expect(result.stderr).toBe("")
  expect(result.trailingStdoutBytes).toBe(0)
  expect(result.methods).toEqual([HOST_VERSION_METHOD, HOST_PING_METHOD, WINDOW_CREATE_METHOD])
})

test("runtime entry can open startup windows from the Desktop app module", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-desktop-runtime-"))
  const modulePath = join(directory, "app.ts")
  const coreSpecifier = pathToFileURL(resolve(PACKAGE_ROOT, "src/index.ts")).href
  await writeFile(
    modulePath,
    [
      `import { Desktop } from ${JSON.stringify(coreSpecifier)}`,
      "export default Desktop.make({",
      "  windows: {",
      '    main: { title: "Module Notes", width: 960, height: 640, renderer: "/" }',
      "  }",
      "})"
    ].join("\n"),
    "utf8"
  )

  try {
    const result = await runRuntimeWithFakeHost({
      appModule: pathToFileURL(modulePath).href
    })

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
    await rm(directory, { recursive: true, force: true })
  }
})

interface RuntimeHostOptions {
  readonly appModule?: string
  readonly startupWindows?: unknown
  readonly windowSmokeTest?: boolean
}

const runRuntimeWithFakeHost = (options: RuntimeHostOptions = {}): Promise<RuntimeHostResult> =>
  new Promise((resolvePromise, rejectPromise) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env
    }
    if (options.windowSmokeTest !== false) {
      env["EFFECT_DESKTOP_WINDOW_SMOKE_TEST"] = "1"
    } else {
      delete env["EFFECT_DESKTOP_WINDOW_SMOKE_TEST"]
    }
    delete env[STARTUP_WINDOWS_ENV]
    delete env[APP_MODULE_ENV]
    if (options.appModule !== undefined) {
      env[APP_MODULE_ENV] = options.appModule
    }
    if (options.startupWindows !== undefined) {
      env[STARTUP_WINDOWS_ENV] = JSON.stringify(options.startupWindows)
    }

    const child = spawn("bun", ["src/runtime/main.ts"], {
      cwd: PACKAGE_ROOT,
      env,
      stdio: ["pipe", "pipe", "pipe"]
    }) as unknown as NodeJS.EventEmitter & {
      stdin: NodeJS.WritableStream
      stdout: NodeJS.ReadableStream
      stderr: NodeJS.ReadableStream
      kill: () => void
    }
    const readyEvents: RuntimeReadyEvent[] = []
    const methods: string[] = []
    const stderrChunks: Buffer[] = []
    let stdoutBuffer = Buffer.alloc(0)
    let readyParsed = false
    let settled = false

    const reject = (error: unknown): void => {
      if (settled) {
        return
      }

      settled = true
      child.kill()
      rejectPromise(error)
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer = Buffer.concat([stdoutBuffer, chunk])
      try {
        processStdout()
      } catch (error) {
        reject(error)
      }
    })
    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk)
    })
    child.on("error", reject)
    child.on("close", (exitCode: number | null) => {
      if (settled) {
        return
      }

      settled = true
      resolvePromise({
        readyEvents,
        methods,
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        exitCode,
        trailingStdoutBytes: stdoutBuffer.byteLength
      })
    })

    const processStdout = (): void => {
      if (!readyParsed) {
        const newline = stdoutBuffer.indexOf(0x0a)
        if (newline === -1) {
          return
        }

        const line = stdoutBuffer.subarray(0, newline).toString("utf8").replace(/\r$/, "")
        stdoutBuffer = stdoutBuffer.subarray(newline + 1)
        const parsed: unknown = JSON.parse(line)
        if (!isRuntimeReadyEvent(parsed)) {
          throw new Error(`runtime stdout was not a ready event: ${line}`)
        }

        readyEvents.push(parsed)
        readyParsed = true
      }

      while (stdoutBuffer.byteLength >= 4) {
        const frameLength = stdoutBuffer.readUInt32BE(0)
        if (stdoutBuffer.byteLength < 4 + frameLength) {
          return
        }

        const requestValue: unknown = JSON.parse(
          stdoutBuffer.subarray(4, 4 + frameLength).toString("utf8")
        )
        stdoutBuffer = stdoutBuffer.subarray(4 + frameLength)

        if (!isHostProtocolRequest(requestValue)) {
          throw new Error(`runtime stdout was not a request: ${JSON.stringify(requestValue)}`)
        }

        methods.push(requestValue.method)
        child.stdin.write(encodeFrame(responseFor(requestValue)))
      }
    }
  })

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
