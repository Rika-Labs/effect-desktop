import { expect, test } from "bun:test"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type BridgeClientExchange,
  type BridgeClientResponse,
  encodeHostProtocolEnvelope,
  HostProtocolEventEnvelope,
  type HostProtocolError,
  type HostProtocolRequestEnvelope,
  makeHostProtocolInternalError
} from "@orika/bridge"
import { type AuditEvent, type AuditEventsApi, makePermissionRegistry, P } from "@orika/core"
import {
  Cause,
  Context,
  Effect,
  Exit,
  Fiber,
  Layer,
  ManagedRuntime,
  Option,
  Queue,
  Schema,
  Stream
} from "effect"

import {
  LocalToolRuntime,
  LocalToolRuntimeClient,
  type LocalToolRuntimeClientApi,
  LocalToolRuntimeSurface,
  makeLocalToolRuntimeMemoryClient,
  makeLocalToolRuntimeServiceLayer,
  makeLocalToolRuntimeUnsupportedClient
} from "./local-tool-runtime.js"
import { NativeCapabilities, makeNativeCapabilitiesLayer } from "./capabilities.js"
import { Native } from "./native.js"
import {
  LocalToolRuntimeActor,
  LocalToolRuntimeBudgetPolicy,
  LocalToolRuntimeCleanupPolicy,
  LocalToolRuntimeCommand,
  LocalToolRuntimeCwdPolicy,
  LocalToolRuntimeEnvironmentPolicy,
  LocalToolRuntimeEvent,
  LocalToolRuntimeFilesystemPolicy,
  LocalToolRuntimeHealthCheck,
  LocalToolRuntimeHealthInput,
  LocalToolRuntimeHealthRequest,
  LocalToolRuntimeManifest,
  LocalToolRuntimeNetworkPolicy,
  LocalToolRuntimePolicy,
  LocalToolRuntimeRegisterInput,
  LocalToolRuntimeRegisterRequest,
  LocalToolRuntimeRunRequest,
  LocalToolRuntimeStdioPolicy,
  LocalToolRuntimeStopRequest
} from "./contracts/local-tool-runtime.js"

const hostProtocolStdioTest = process.platform === "win32" ? test.skip : test
const UnboundedOsBudget = Number.MAX_SAFE_INTEGER

test("LocalToolRuntime contracts reject event phases with inconsistent payloads", () => {
  const baseEvent = {
    type: "local-tool-runtime-event",
    timestamp: 1_710_000_000_000,
    runtimeId: "runtime-1"
  } as const

  for (const event of [
    { ...baseEvent, phase: "run-completed" },
    { ...baseEvent, phase: "registered", status: "completed" },
    { ...baseEvent, phase: "run-started", runId: "run-1", status: "completed" },
    { ...baseEvent, phase: "health-checked" },
    { ...baseEvent, phase: "health-checked", health: "healthy", status: "failed" },
    { ...baseEvent, phase: "stopped", runId: "run-1" }
  ] as const) {
    const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(LocalToolRuntimeEvent)(event))
    expect(Exit.isFailure(exit)).toBe(true)
  }

  for (const event of [
    { ...baseEvent, phase: "registered", toolId: "tool-1" },
    {
      ...baseEvent,
      phase: "run-started",
      toolId: "tool-1",
      commandId: "node-version",
      runId: "run-1"
    },
    {
      ...baseEvent,
      phase: "run-completed",
      toolId: "tool-1",
      commandId: "node-version",
      runId: "run-1",
      status: "completed"
    },
    { ...baseEvent, phase: "health-checked", toolId: "tool-1", health: "healthy" },
    { ...baseEvent, phase: "stopped" }
  ] as const) {
    const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(LocalToolRuntimeEvent)(event))
    expect(Exit.isSuccess(exit)).toBe(true)
  }
})

test("LocalToolRuntime service registers, runs manifest commands, checks health, stops, emits events, and audits use", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rows: AuditEvent[] = []
      const permissions = yield* configuredPermissions(rows)
      const client = yield* makeLocalToolRuntimeMemoryClient({
        nextRuntimeId: () => "runtime-1",
        nextRunId: () => "run-1",
        stdout: "v20.0.0"
      })

      const runtime = ManagedRuntime.make(
        makeLocalToolRuntimeServiceLayer(client, {
          permissions,
          audit: memoryAudit(rows),
          nextRuntimeId: () => "runtime-1",
          nextRunId: () => "run-1",
          nextTraceId: () => "trace-tool"
        })
      )
      const result = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const runtimeService = yield* LocalToolRuntime
            const registered = yield* runtimeService.register(registerRequest())
            const run = yield* runtimeService.run(runRequest(registered.runtimeId))
            const health = yield* runtimeService.health(
              new LocalToolRuntimeHealthRequest({ runtimeId: registered.runtimeId })
            )
            const stopped = yield* runtimeService.stop(
              new LocalToolRuntimeStopRequest({ runtimeId: registered.runtimeId })
            )
            const event = yield* runtimeService
              .events()
              .pipe(Stream.runHead, Effect.map(Option.getOrThrow))
            return { event, health, registered, run, stopped }
          })
        )
      )
      yield* Effect.promise(() => runtime.dispose())

      expect(result.registered.runtimeId).toBe("runtime-1")
      expect(result.registered.toolId).toBe("tool-1")
      expect(result.registered.manifest.commands[0]?.timeoutMillis).toBe(1_000)
      expect(result.run).toMatchObject({
        runtimeId: "runtime-1",
        commandId: "node-version",
        runId: "run-1",
        status: "completed",
        stdout: "v20.0.0"
      })
      expect(result.health.status).toBe("healthy")
      expect(result.stopped.stopped).toBe(true)
      expect(result.event.phase).toBe("registered")
      expect(rows.some((row) => row.kind === "permission-used")).toBe(true)
      expect(rows.find((row) => row.source === "LocalToolRuntime.run")?.actor).toMatchObject({
        id: "extension:extension-1"
      })
    })
  ))

hostProtocolStdioTest(
  "LocalToolRuntime public Effect API executes a declared command through the real Rust host",
  () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const root = yield* Effect.promise(() =>
          mkdtemp(join(tmpdir(), "effect-desktop-local-tool-runtime-"))
        )
        const rows: AuditEvent[] = []
        const host = makeHostProtocolStdioExchange()

        try {
          const permissions = yield* configuredPermissions(rows, {
            command: "/bin/sh",
            root
          })
          const result = yield* Effect.scoped(
            Effect.gen(function* () {
              let runSequence = 0
              const clientContext = yield* Layer.build(
                LocalToolRuntimeSurface.bridgeClientLayer(host.exchange, {
                  nextRequestId: () => `request-${globalThis.crypto.randomUUID()}`,
                  nextTraceId: () => `trace-${globalThis.crypto.randomUUID()}`,
                  now: () => 1_710_000_000_000
                })
              )
              const client = Context.get(clientContext, LocalToolRuntimeClient)
              const runtimeContext = yield* Layer.build(
                makeLocalToolRuntimeServiceLayer(client, {
                  permissions,
                  audit: memoryAudit(rows),
                  nextRuntimeId: () => "runtime-real-host",
                  nextRunId: () => `run-real-host-${++runSequence}`,
                  nextTraceId: () => "trace-real-host"
                })
              )
              const runtime = Context.get(runtimeContext, LocalToolRuntime)
              const eventsFiber = yield* Effect.forkScoped(
                runtime.events().pipe(Stream.take(10), Stream.runCollect)
              )
              const registered = yield* runtime.register(
                registerRequestWithManifest(realHostManifest(root))
              )
              const run = yield* runtime.run(
                new LocalToolRuntimeRunRequest({
                  runtimeId: registered.runtimeId,
                  commandId: "print",
                  traceId: "trace-real-run"
                })
              )
              const failure = yield* runtime.run(
                new LocalToolRuntimeRunRequest({
                  runtimeId: registered.runtimeId,
                  commandId: "fail",
                  traceId: "trace-real-fail"
                })
              )
              const timeout = yield* runtime.run(
                new LocalToolRuntimeRunRequest({
                  runtimeId: registered.runtimeId,
                  commandId: "timeout",
                  traceId: "trace-real-timeout"
                })
              )
              const health = yield* runtime.health(
                new LocalToolRuntimeHealthRequest({ runtimeId: registered.runtimeId })
              )
              const stoppedRunFiber = yield* Effect.forkScoped(
                runtime.run(
                  new LocalToolRuntimeRunRequest({
                    runtimeId: registered.runtimeId,
                    commandId: "long",
                    traceId: "trace-real-stop"
                  })
                )
              )
              yield* Effect.sleep("100 millis")
              const stopped = yield* runtime.stop(
                new LocalToolRuntimeStopRequest({ runtimeId: registered.runtimeId })
              )
              const stoppedRun = yield* Fiber.join(stoppedRunFiber)
              const events = yield* Fiber.join(eventsFiber)
              return {
                events: Array.from(events),
                failure,
                health,
                registered,
                run,
                stoppedRun,
                stopped,
                timeout
              }
            })
          )

          expect(result.registered.runtimeId).toBe("runtime-real-host")
          expect(result.run).toMatchObject({
            runtimeId: "runtime-real-host",
            commandId: "print",
            runId: "run-real-host-1",
            status: "completed",
            stdout: "host-ok"
          })
          expect(result.failure).toMatchObject({
            runtimeId: "runtime-real-host",
            commandId: "fail",
            runId: "run-real-host-2",
            status: "failed",
            exitCode: 7,
            stderr: "denied\n"
          })
          expect(result.timeout).toMatchObject({
            runtimeId: "runtime-real-host",
            commandId: "timeout",
            runId: "run-real-host-3",
            status: "timeout"
          })
          expect(result.health.status).toBe("healthy")
          expect(result.stopped.stopped).toBe(true)
          expect(result.stoppedRun).toMatchObject({
            runtimeId: "runtime-real-host",
            commandId: "long",
            runId: "run-real-host-4",
            status: "failed"
          })
          expect(result.events.map((event) => event.phase)).toEqual([
            "registered",
            "run-started",
            "run-completed",
            "run-started",
            "run-completed",
            "run-started",
            "run-completed",
            "health-checked",
            "run-started",
            "stopped"
          ])
          expect(rows.find((row) => row.source === "LocalToolRuntime.run")?.resource).toBe(
            "runtime-real-host"
          )
        } finally {
          yield* Effect.promise(() => host.close())
          yield* Effect.promise(() => rm(root, { force: true, recursive: true }))
        }
      })
    ),
  300_000
)

test("LocalToolRuntime denies register before host side effects", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* makePermissionRegistry()
      let calls = 0
      const baseClient = yield* makeLocalToolRuntimeMemoryClient()
      const client: LocalToolRuntimeClientApi = {
        ...baseClient,
        register: (input) =>
          Effect.sync(() => {
            calls += 1
          }).pipe(Effect.andThen(baseClient.register(input)))
      }

      const runtime = ManagedRuntime.make(makeLocalToolRuntimeServiceLayer(client, { permissions }))
      const exit = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const runtimeService = yield* LocalToolRuntime
            return yield* Effect.exit(runtimeService.register(registerRequest()))
          })
        )
      )
      yield* Effect.promise(() => runtime.dispose())

      expect(calls).toBe(0)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "PermissionDenied",
          operation: "LocalToolRuntime.register"
        })
      })
    })
  ))

test("LocalToolRuntime rejects malformed manifests before bridge transport", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const invalidManifest of [
        manifest({
          commands: [command({ executable: "/usr/bin/node;rm" })]
        }),
        manifestPayload({
          commands: [commandPayload({ cwd: "/tmp/app/../secret" })]
        }),
        manifestPayload({
          policy: policyPayload({ cwdRoots: ["relative"] })
        }),
        manifestPayload({
          policy: policyPayload({ readRoots: ["/tmp/app/../secret"] })
        }),
        manifestPayload({
          policy: policyPayload({ writeRoots: ["/tmp/app/../secret"] })
        })
      ]) {
        const requests: HostProtocolRequestEnvelope[] = []
        const exchange: BridgeClientExchange = {
          request: (request) => {
            requests.push(request)
            return Effect.succeed({
              kind: "success",
              payload: {
                runtimeId: "runtime-1",
                toolId: "tool-1",
                manifest: manifest(),
                state: "registered"
              }
            })
          },
          subscribe: () => Stream.empty
        }

        const runtime = ManagedRuntime.make(LocalToolRuntimeSurface.bridgeClientLayer(exchange))
        const exit = yield* Effect.promise(() =>
          runtime.runPromise(
            Effect.gen(function* () {
              const client = yield* LocalToolRuntimeClient
              const malformedInput = {
                actor: actor(),
                manifest: invalidManifest
              }
              return yield* Effect.exit(
                // @ts-expect-error: malformed JavaScript callers must still be rejected.
                client.register(malformedInput)
              )
            })
          )
        )
        yield* Effect.promise(() => runtime.dispose())

        expect(requests).toEqual([])
        expectExitFailure(exit, (error) => {
          expect(error).toMatchObject({
            tag: "InvalidArgument",
            operation: "LocalToolRuntime.register"
          })
        })
      }
    })
  ))

test("LocalToolRuntime registers Windows manifests whose command cwd is nested under a backslash root", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const windowsRoot = "C:\\app"
      const windowsExecutable = "C:\\app\\node.exe"
      const windowsCommandCwd = "C:\\app\\sub"
      const permissions = yield* configuredPermissions([], {
        command: windowsExecutable,
        root: windowsRoot
      })
      const client = yield* makeLocalToolRuntimeMemoryClient({
        nextRuntimeId: () => "runtime-windows"
      })

      const runtime = ManagedRuntime.make(
        makeLocalToolRuntimeServiceLayer(client, {
          permissions,
          nextRuntimeId: () => "runtime-windows"
        })
      )
      const exit = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const runtimeService = yield* LocalToolRuntime
            return yield* Effect.exit(
              runtimeService.register(
                registerRequestWithManifest(
                  manifest({
                    commands: [command({ executable: windowsExecutable, cwd: windowsCommandCwd })],
                    permissions: [
                      processPermission({ command: windowsExecutable, root: windowsRoot }),
                      P.filesystemRead({ roots: [windowsRoot] })
                    ],
                    policy: policy({ cwdRoots: [windowsRoot], readRoots: [windowsRoot] })
                  })
                )
              )
            )
          })
        )
      )
      yield* Effect.promise(() => runtime.dispose())

      expectExitSuccess(exit, (result) => {
        expect(result.runtimeId).toBe("runtime-windows")
      })
    })
  ))

test("LocalToolRuntime refuses commands not declared in the manifest before run side effects", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissions([])
      let runs = 0
      const baseClient = yield* makeLocalToolRuntimeMemoryClient()
      const client: LocalToolRuntimeClientApi = {
        ...baseClient,
        run: (input) =>
          Effect.sync(() => {
            runs += 1
          }).pipe(Effect.andThen(baseClient.run(input)))
      }

      const runtime = ManagedRuntime.make(
        makeLocalToolRuntimeServiceLayer(client, {
          permissions,
          nextRuntimeId: () => "runtime-1"
        })
      )
      const exit = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const runtimeService = yield* LocalToolRuntime
            const registered = yield* runtimeService.register(registerRequest())
            return yield* Effect.exit(
              runtimeService.run(
                new LocalToolRuntimeRunRequest({
                  runtimeId: registered.runtimeId,
                  commandId: "undeclared"
                })
              )
            )
          })
        )
      )
      yield* Effect.promise(() => runtime.dispose())

      expect(runs).toBe(0)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({ tag: "InvalidArgument", operation: "LocalToolRuntime.run" })
      })
    })
  ))

test("LocalToolRuntime denies run before host side effects when process permission is missing", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const permissions = yield* configuredPermissions([])
      let runs = 0
      const baseClient = yield* makeLocalToolRuntimeMemoryClient()
      const client: LocalToolRuntimeClientApi = {
        ...baseClient,
        run: (input) =>
          Effect.sync(() => {
            runs += 1
          }).pipe(Effect.andThen(baseClient.run(input)))
      }

      const runtime = ManagedRuntime.make(
        makeLocalToolRuntimeServiceLayer(client, {
          permissions,
          nextRuntimeId: () => "runtime-1"
        })
      )
      const exit = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const runtimeService = yield* LocalToolRuntime
            const registered = yield* runtimeService.register(
              registerRequestWithManifest(
                manifest({
                  commands: [
                    command({
                      environment: [{ name: "LOCAL_TOOL_VALUE", value: "1" }]
                    })
                  ]
                })
              )
            )
            return yield* Effect.exit(runtimeService.run(runRequest(registered.runtimeId)))
          })
        )
      )
      yield* Effect.promise(() => runtime.dispose())

      expect(runs).toBe(0)
      expectExitFailure(exit, (error) => {
        expect(error).toMatchObject({
          tag: "PermissionDenied",
          operation: "LocalToolRuntime.run"
        })
      })
    })
  ))

test("LocalToolRuntime unsupported client exposes typed unsupported failures", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = makeLocalToolRuntimeUnsupportedClient()
      const registerExit = yield* Effect.exit(client.register(registerInput()))
      const runExit = yield* Effect.exit(client.run(runInput("runtime-1")))
      const stopExit = yield* Effect.exit(client.stop({ runtimeId: "runtime-1" }))
      const healthExit = yield* Effect.exit(
        client.health(new LocalToolRuntimeHealthInput({ runtimeId: "runtime-1" }))
      )

      for (const exit of [registerExit, runExit, stopExit, healthExit]) {
        expectExitFailure(exit, (error) => {
          expect(error).toMatchObject({ tag: "Unsupported" })
        })
      }
      const supported = yield* client.isSupported()
      expect(supported.supported).toBe(false)
    })
  ))

test("LocalToolRuntime support metadata reports Windows supported after host CI coverage", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const runtime = ManagedRuntime.make(
        makeNativeCapabilitiesLayer(Native.available(LocalToolRuntimeSurface.selection))
      )
      const result = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const capabilities = yield* NativeCapabilities
            const support = yield* capabilities.support("LocalToolRuntime.register")
            yield* capabilities.requirePlatform("LocalToolRuntime.register", "macos")
            yield* capabilities.requirePlatform("LocalToolRuntime.register", "linux")
            const windows = yield* Effect.exit(
              capabilities.requirePlatform("LocalToolRuntime.register", "windows")
            )
            return { support, windows }
          })
        )
      )
      yield* Effect.promise(() => runtime.dispose())

      expect(result.support).toEqual({ status: "supported" })
      expect(Exit.isSuccess(result.windows)).toBe(true)
    })
  ))

interface PermissionFixtureOptions {
  readonly command?: string
  readonly root?: string
}

const configuredPermissions = (rows: AuditEvent[], options: PermissionFixtureOptions = {}) =>
  Effect.gen(function* () {
    const commandPath = options.command ?? "/usr/bin/node"
    const root = options.root ?? "/tmp/app"
    const permissions = yield* makePermissionRegistry({
      audit: memoryAudit(rows),
      traceId: () => "trace-permission",
      nextToken: () => "grant-1"
    })
    yield* Effect.all([
      permissions.declare(P.nativeInvoke({ primitive: "LocalToolRuntime", methods: ["register"] })),
      permissions.declare(P.nativeInvoke({ primitive: "LocalToolRuntime", methods: ["stop"] })),
      permissions.declare(P.nativeInvoke({ primitive: "LocalToolRuntime", methods: ["health"] })),
      permissions.declare(processPermission({ command: commandPath, root })),
      permissions.declare(P.filesystemRead({ roots: [root] })),
      permissions.declare(P.networkConnect({ hosts: ["api.example.test"] }))
    ])
    return permissions
  })

const actor = (): LocalToolRuntimeActor =>
  new LocalToolRuntimeActor({ kind: "extension", id: "extension-1" })

const command = (
  options: Partial<ConstructorParameters<typeof LocalToolRuntimeCommand>[0]> = {}
): LocalToolRuntimeCommand =>
  new LocalToolRuntimeCommand({
    commandId: "node-version",
    executable: "/usr/bin/node",
    defaultArgs: ["--version"],
    cwd: "/tmp/app",
    timeoutMillis: 1_000,
    ...options
  })

const manifest = (
  options: Partial<ConstructorParameters<typeof LocalToolRuntimeManifest>[0]> = {}
): LocalToolRuntimeManifest =>
  new LocalToolRuntimeManifest({
    toolId: "tool-1",
    name: "Tool One",
    version: "1.0.0",
    commands: [command()],
    permissions: [processPermission(), P.filesystemRead({ roots: ["/tmp/app"] })],
    policy: policy(),
    ...options
  })

const manifestPayload = (options: {
  readonly commands?: readonly unknown[]
  readonly policy?: unknown
}) => ({
  toolId: "tool-1",
  name: "Tool One",
  version: "1.0.0",
  commands: options.commands ?? [commandPayload()],
  permissions: [processPermission(), P.filesystemRead({ roots: ["/tmp/app"] })],
  policy: options.policy ?? policyPayload()
})

const commandPayload = (options: Record<string, unknown> = {}) => ({
  commandId: "node-version",
  executable: "/usr/bin/node",
  defaultArgs: ["--version"],
  cwd: "/tmp/app",
  timeoutMillis: 1_000,
  ...options
})

const realHostManifest = (root: string): LocalToolRuntimeManifest =>
  new LocalToolRuntimeManifest({
    toolId: "tool-real-host",
    name: "Real Host Tool",
    version: "1.0.0",
    commands: [
      new LocalToolRuntimeCommand({
        commandId: "print",
        executable: "/bin/sh",
        defaultArgs: ["-c", "printf host-ok"],
        cwd: root,
        timeoutMillis: 1_000
      }),
      new LocalToolRuntimeCommand({
        commandId: "fail",
        executable: "/bin/sh",
        defaultArgs: ["-c", "printf 'denied\\n' >&2; exit 7"],
        cwd: root,
        timeoutMillis: 1_000
      }),
      new LocalToolRuntimeCommand({
        commandId: "timeout",
        executable: "/bin/sh",
        defaultArgs: ["-c", "sleep 1"],
        cwd: root,
        timeoutMillis: 50
      }),
      new LocalToolRuntimeCommand({
        commandId: "long",
        executable: "/bin/sh",
        defaultArgs: ["-c", "sleep 30"],
        cwd: root,
        timeoutMillis: 60_000
      })
    ],
    permissions: [
      processPermission({ command: "/bin/sh", root }),
      P.filesystemRead({ roots: [root] })
    ],
    health: new LocalToolRuntimeHealthCheck({
      commandId: "print",
      intervalMillis: 1_000,
      timeoutMillis: 1_000
    }),
    policy: new LocalToolRuntimePolicy({
      cwd: new LocalToolRuntimeCwdPolicy({ roots: [root] }),
      environment: new LocalToolRuntimeEnvironmentPolicy({ variables: [] }),
      filesystem: new LocalToolRuntimeFilesystemPolicy({ readRoots: [root] }),
      network: new LocalToolRuntimeNetworkPolicy({ hosts: [] }),
      budgets: new LocalToolRuntimeBudgetPolicy({
        cpuMillis: UnboundedOsBudget,
        memoryBytes: UnboundedOsBudget,
        wallClockMillis: 1_000,
        stdoutBytes: 1_024,
        stderrBytes: 1_024
      }),
      stdio: new LocalToolRuntimeStdioPolicy({ stdout: "capture", stderr: "capture" }),
      cleanup: new LocalToolRuntimeCleanupPolicy({
        killProcessTree: true,
        removeWorkingDirectory: false
      })
    })
  })

interface PolicyOptions {
  readonly cwdRoots?: readonly string[]
  readonly readRoots?: readonly string[]
  readonly writeRoots?: readonly string[]
}

const policy = (options: PolicyOptions = {}): LocalToolRuntimePolicy =>
  new LocalToolRuntimePolicy({
    cwd: new LocalToolRuntimeCwdPolicy({ roots: options.cwdRoots ?? ["/tmp/app"] }),
    environment: new LocalToolRuntimeEnvironmentPolicy({ variables: [] }),
    filesystem: new LocalToolRuntimeFilesystemPolicy({
      readRoots: options.readRoots ?? ["/tmp/app"],
      ...(options.writeRoots === undefined ? {} : { writeRoots: options.writeRoots })
    }),
    network: new LocalToolRuntimeNetworkPolicy({ hosts: [] }),
    budgets: new LocalToolRuntimeBudgetPolicy({
      cpuMillis: 500,
      memoryBytes: 67_108_864,
      wallClockMillis: 1_000,
      stdoutBytes: 1_024,
      stderrBytes: 1_024
    }),
    stdio: new LocalToolRuntimeStdioPolicy({ stdout: "capture", stderr: "capture" }),
    cleanup: new LocalToolRuntimeCleanupPolicy({
      killProcessTree: true,
      removeWorkingDirectory: true
    })
  })

const policyPayload = (options: PolicyOptions = {}) => ({
  cwd: { roots: options.cwdRoots ?? ["/tmp/app"] },
  environment: { variables: [] },
  filesystem: {
    readRoots: options.readRoots ?? ["/tmp/app"],
    ...(options.writeRoots === undefined ? {} : { writeRoots: options.writeRoots })
  },
  network: { hosts: [] },
  budgets: {
    cpuMillis: 500,
    memoryBytes: 67_108_864,
    wallClockMillis: 1_000,
    stdoutBytes: 1_024,
    stderrBytes: 1_024
  },
  stdio: { stdout: "capture", stderr: "capture" },
  cleanup: {
    killProcessTree: true,
    removeWorkingDirectory: true
  }
})

const registerRequest = (): LocalToolRuntimeRegisterRequest =>
  new LocalToolRuntimeRegisterRequest({
    actor: actor(),
    manifest: manifest(),
    traceId: "trace-register"
  })

const registerRequestWithManifest = (
  value: LocalToolRuntimeManifest
): LocalToolRuntimeRegisterRequest =>
  new LocalToolRuntimeRegisterRequest({
    actor: actor(),
    manifest: value,
    traceId: "trace-register"
  })

const registerInput = (): LocalToolRuntimeRegisterInput =>
  new LocalToolRuntimeRegisterInput({
    actor: actor(),
    manifest: manifest(),
    traceId: "trace-register"
  })

const runRequest = (runtimeId: string): LocalToolRuntimeRunRequest =>
  new LocalToolRuntimeRunRequest({
    runtimeId,
    commandId: "node-version",
    args: ["--version"],
    traceId: "trace-run"
  })

const runInput = (runtimeId: string) => ({
  runtimeId,
  commandId: "node-version",
  args: ["--version"],
  traceId: "trace-run"
})

interface ProcessPermissionOptions {
  readonly command?: string
  readonly root?: string
}

const processPermission = (options: ProcessPermissionOptions = {}) =>
  P.processSpawn({
    commands: [options.command ?? "/usr/bin/node"],
    cwd: [options.root ?? "/tmp/app"],
    environment: "none"
  })

const memoryAudit = (rows: AuditEvent[]): AuditEventsApi => ({
  emit: (event: AuditEvent) =>
    Effect.sync(() => {
      rows.push(event)
    }),
  observe: () => Stream.fromIterable(rows)
})

interface HostProtocolStdioExchange {
  readonly exchange: BridgeClientExchange
  readonly close: () => Promise<void>
}

interface PendingHostRequest {
  readonly resolve: (response: BridgeClientResponse) => void
  readonly reject: (error: HostProtocolError) => void
}

const makeHostProtocolStdioExchange = (): HostProtocolStdioExchange => {
  const child = spawn("cargo", ["run", "-q", "-p", "host", "--", "--host-protocol-stdio"], {
    cwd: process.cwd(),
    stdio: "pipe"
  })
  const pending = new Map<string, PendingHostRequest>()
  const eventQueues = new Map<string, Queue.Queue<HostProtocolEventEnvelope>>()
  const eventReplay = new Map<string, HostProtocolEventEnvelope[]>()
  let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  let stderr = ""

  child.stdout.on("data", (chunk: Buffer) => {
    stdout = Buffer.concat([stdout, chunk])
    drainHostFrames(stdout, (remaining, envelope) => {
      stdout = remaining
      routeHostEnvelope(envelope, pending, eventQueues, eventReplay)
    })
  })
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk
  })
  child.on("exit", (code, signal) => {
    const error = makeHostProtocolInternalError(
      `host protocol stdio exited with code ${code ?? "null"} signal ${signal ?? "null"}: ${stderr}`,
      "LocalToolRuntime.hostProtocolStdio"
    )
    for (const request of pending.values()) {
      request.reject(error)
    }
    pending.clear()
  })

  return {
    exchange: {
      request: (request) =>
        Effect.tryPromise({
          try: () => sendHostRequest(child, pending, request),
          catch: (error) =>
            makeHostProtocolInternalError(
              formatUnknown(error),
              "LocalToolRuntime.hostProtocolStdio"
            )
        }),
      subscribe: (method) => {
        const queue = eventQueue(eventQueues, method)
        const replay = eventReplay.get(method) ?? []
        return Stream.fromIterable(replay).pipe(Stream.concat(Stream.fromQueue(queue)))
      }
    },
    close: () =>
      Effect.runPromise(
        Effect.gen(function* () {
          child.stdin.end()
          if (child.exitCode === null) {
            child.kill()
          }
          for (const queue of eventQueues.values()) {
            yield* Queue.shutdown(queue)
          }
        })
      )
  }
}

const sendHostRequest = (
  child: ChildProcessWithoutNullStreams,
  pending: Map<string, PendingHostRequest>,
  request: HostProtocolRequestEnvelope
): Promise<BridgeClientResponse> =>
  new Promise((resolve, reject) => {
    pending.set(request.id, { resolve, reject })
    const body = Buffer.from(JSON.stringify(encodeHostProtocolEnvelope(request)), "utf8")
    const frame = Buffer.alloc(4 + body.byteLength)
    frame.writeUInt32BE(body.byteLength, 0)
    body.copy(frame, 4)
    child.stdin.write(frame, (error) => {
      if (error !== null && error !== undefined) {
        pending.delete(request.id)
        reject(
          makeHostProtocolInternalError(
            formatUnknown(error),
            "LocalToolRuntime.hostProtocolStdio.write"
          )
        )
      }
    })
  })

const drainHostFrames = (
  buffer: Buffer,
  handle: (remaining: Buffer, envelope: unknown) => void
) => {
  let offset = 0
  while (buffer.byteLength - offset >= 4) {
    const length = buffer.readUInt32BE(offset)
    const frameStart = offset + 4
    const frameEnd = frameStart + length
    if (buffer.byteLength < frameEnd) {
      break
    }
    const envelope = JSON.parse(buffer.subarray(frameStart, frameEnd).toString("utf8")) as unknown
    offset = frameEnd
    handle(buffer.subarray(offset), envelope)
  }
}

const routeHostEnvelope = (
  envelope: unknown,
  pending: Map<string, PendingHostRequest>,
  eventQueues: Map<string, Queue.Queue<HostProtocolEventEnvelope>>,
  eventReplay: Map<string, HostProtocolEventEnvelope[]>
) => {
  if (!isRecord(envelope)) {
    return
  }
  const kind = envelope["kind"]
  if (kind === "response" && typeof envelope["id"] === "string") {
    const id = envelope["id"]
    const request = pending.get(id)
    if (request === undefined) {
      return
    }
    pending.delete(id)
    const error = envelope["error"]
    if (error !== undefined && error !== null) {
      request.resolve({ kind: "failure", error })
      return
    }
    request.resolve({ kind: "success", payload: envelope["payload"] })
    return
  }
  if (kind === "event" && typeof envelope["method"] === "string") {
    const timestamp = envelope["timestamp"]
    const traceId = envelope["traceId"]
    if (typeof timestamp !== "number" || typeof traceId !== "string") {
      return
    }
    const windowId = envelope["windowId"]
    const event = new HostProtocolEventEnvelope({
      kind: "event",
      method: envelope["method"],
      timestamp,
      traceId,
      ...(typeof windowId === "string" ? { windowId } : {}),
      ...("payload" in envelope ? { payload: envelope["payload"] } : {})
    })
    const replay = eventReplay.get(event.method) ?? []
    replay.push(event)
    eventReplay.set(event.method, replay.slice(-64))
    void Effect.runPromise(Queue.offer(eventQueue(eventQueues, event.method), event))
  }
}

const eventQueue = (
  queues: Map<string, Queue.Queue<HostProtocolEventEnvelope>>,
  method: string
): Queue.Queue<HostProtocolEventEnvelope> => {
  const existing = queues.get(method)
  if (existing !== undefined) {
    return existing
  }
  const queue = Effect.runSync(Queue.unbounded<HostProtocolEventEnvelope>())
  queues.set(method, queue)
  return queue
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const formatUnknown = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const expectExitFailure = (
  exit: Exit.Exit<unknown, HostProtocolError>,
  assertion: (error: unknown) => void
) => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    assertion(Cause.squash(exit.cause))
  }
}

const expectExitSuccess = <A>(exit: Exit.Exit<A, unknown>, assertion: (value: A) => void) => {
  expect(Exit.isSuccess(exit)).toBe(true)
  if (Exit.isSuccess(exit)) {
    assertion(exit.value)
  }
}
