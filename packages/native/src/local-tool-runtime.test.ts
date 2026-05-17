import { expect, test } from "bun:test"
import {
  type BridgeClientExchange,
  type HostProtocolError,
  type HostProtocolRequestEnvelope
} from "@effect-desktop/bridge"
import {
  type AuditEvent,
  type AuditEventsApi,
  makePermissionRegistry,
  P
} from "@effect-desktop/core"
import { Cause, Effect, Exit, Option, Stream } from "effect"

import {
  LocalToolRuntime,
  LocalToolRuntimeClient,
  type LocalToolRuntimeClientApi,
  makeLocalToolRuntimeBridgeClientLayer,
  makeLocalToolRuntimeMemoryClient,
  makeLocalToolRuntimeServiceLayer,
  makeLocalToolRuntimeUnsupportedClient
} from "./local-tool-runtime.js"
import {
  LocalToolRuntimeActor,
  LocalToolRuntimeBudgetPolicy,
  LocalToolRuntimeCleanupPolicy,
  LocalToolRuntimeCommand,
  LocalToolRuntimeCwdPolicy,
  LocalToolRuntimeEnvironmentPolicy,
  LocalToolRuntimeFilesystemPolicy,
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

test("LocalToolRuntime service registers, runs manifest commands, checks health, stops, emits events, and audits use", async () => {
  const rows: AuditEvent[] = []
  const permissions = await configuredPermissions(rows)
  const client = await Effect.runPromise(
    makeLocalToolRuntimeMemoryClient({
      nextRuntimeId: () => "runtime-1",
      nextRunId: () => "run-1",
      stdout: "v20.0.0"
    })
  )

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const runtime = yield* LocalToolRuntime
      const registered = yield* runtime.register(registerRequest())
      const run = yield* runtime.run(runRequest(registered.runtimeId))
      const health = yield* runtime.health(
        new LocalToolRuntimeHealthRequest({ runtimeId: registered.runtimeId })
      )
      const stopped = yield* runtime.stop(
        new LocalToolRuntimeStopRequest({ runtimeId: registered.runtimeId })
      )
      const event = yield* runtime.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
      return { event, health, registered, run, stopped }
    }).pipe(
      Effect.provide(
        makeLocalToolRuntimeServiceLayer(client, {
          permissions,
          audit: memoryAudit(rows),
          nextRuntimeId: () => "runtime-1",
          nextRunId: () => "run-1",
          nextTraceId: () => "trace-tool"
        })
      )
    )
  )

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

test("LocalToolRuntime denies register before host side effects", async () => {
  const permissions = await Effect.runPromise(makePermissionRegistry())
  let calls = 0
  const baseClient = await Effect.runPromise(makeLocalToolRuntimeMemoryClient())
  const client: LocalToolRuntimeClientApi = {
    ...baseClient,
    register: (input) =>
      Effect.sync(() => {
        calls += 1
      }).pipe(Effect.andThen(baseClient.register(input)))
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const runtime = yield* LocalToolRuntime
      return yield* Effect.exit(runtime.register(registerRequest()))
    }).pipe(Effect.provide(makeLocalToolRuntimeServiceLayer(client, { permissions })))
  )

  expect(calls).toBe(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "PermissionDenied", operation: "LocalToolRuntime.register" })
  })
})

test("LocalToolRuntime rejects malformed manifests before bridge transport", async () => {
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

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* LocalToolRuntimeClient
      return yield* Effect.exit(
        client.register(
          new LocalToolRuntimeRegisterInput({
            actor: actor(),
            manifest: manifest({
              commands: [command({ executable: "/usr/bin/node;rm" })]
            })
          })
        )
      )
    }).pipe(Effect.provide(makeLocalToolRuntimeBridgeClientLayer(exchange)))
  )

  expect(requests).toEqual([])
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "InvalidArgument", operation: "LocalToolRuntime.register" })
  })
})

test("LocalToolRuntime refuses commands not declared in the manifest before run side effects", async () => {
  const permissions = await configuredPermissions([])
  let runs = 0
  const baseClient = await Effect.runPromise(makeLocalToolRuntimeMemoryClient())
  const client: LocalToolRuntimeClientApi = {
    ...baseClient,
    run: (input) =>
      Effect.sync(() => {
        runs += 1
      }).pipe(Effect.andThen(baseClient.run(input)))
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const runtime = yield* LocalToolRuntime
      const registered = yield* runtime.register(registerRequest())
      return yield* Effect.exit(
        runtime.run(
          new LocalToolRuntimeRunRequest({
            runtimeId: registered.runtimeId,
            commandId: "undeclared"
          })
        )
      )
    }).pipe(
      Effect.provide(
        makeLocalToolRuntimeServiceLayer(client, {
          permissions,
          nextRuntimeId: () => "runtime-1"
        })
      )
    )
  )

  expect(runs).toBe(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "InvalidArgument", operation: "LocalToolRuntime.run" })
  })
})

test("LocalToolRuntime unsupported client exposes typed unsupported failures", async () => {
  const client = makeLocalToolRuntimeUnsupportedClient()
  const registerExit = await Effect.runPromise(Effect.exit(client.register(registerInput())))
  const runExit = await Effect.runPromise(Effect.exit(client.run(runInput("runtime-1"))))
  const stopExit = await Effect.runPromise(Effect.exit(client.stop({ runtimeId: "runtime-1" })))
  const healthExit = await Effect.runPromise(
    Effect.exit(client.health(new LocalToolRuntimeHealthInput({ runtimeId: "runtime-1" })))
  )

  for (const exit of [registerExit, runExit, stopExit, healthExit]) {
    expectExitFailure(exit, (error) => {
      expect(error).toMatchObject({ tag: "Unsupported" })
    })
  }
  const supported = await Effect.runPromise(client.isSupported())
  expect(supported.supported).toBe(false)
})

const configuredPermissions = async (rows: AuditEvent[]) => {
  const permissions = await Effect.runPromise(
    makePermissionRegistry({
      audit: memoryAudit(rows),
      traceId: () => "trace-permission",
      nextToken: () => "grant-1"
    })
  )
  await Effect.runPromise(
    Effect.all([
      permissions.declare(P.nativeInvoke({ primitive: "LocalToolRuntime", methods: ["register"] })),
      permissions.declare(P.nativeInvoke({ primitive: "LocalToolRuntime", methods: ["stop"] })),
      permissions.declare(P.nativeInvoke({ primitive: "LocalToolRuntime", methods: ["health"] })),
      permissions.declare(processPermission()),
      permissions.declare(P.filesystemRead({ roots: ["/tmp/app"] })),
      permissions.declare(P.networkConnect({ hosts: ["api.example.test"] }))
    ])
  )
  return permissions
}

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

const policy = (): LocalToolRuntimePolicy =>
  new LocalToolRuntimePolicy({
    cwd: new LocalToolRuntimeCwdPolicy({ roots: ["/tmp/app"] }),
    environment: new LocalToolRuntimeEnvironmentPolicy({ variables: [] }),
    filesystem: new LocalToolRuntimeFilesystemPolicy({ readRoots: ["/tmp/app"] }),
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

const registerRequest = (): LocalToolRuntimeRegisterRequest =>
  new LocalToolRuntimeRegisterRequest({
    actor: actor(),
    manifest: manifest(),
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

const processPermission = () =>
  P.processSpawn({
    commands: ["/usr/bin/node"],
    cwd: ["/tmp/app"],
    environment: "none"
  })

const memoryAudit = (rows: AuditEvent[]): AuditEventsApi => ({
  emit: (event: AuditEvent) =>
    Effect.sync(() => {
      rows.push(event)
    }),
  observe: () => Stream.fromIterable(rows)
})

const expectExitFailure = (
  exit: Exit.Exit<unknown, HostProtocolError>,
  assertion: (error: unknown) => void
) => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    assertion(Cause.squash(exit.cause))
  }
}
