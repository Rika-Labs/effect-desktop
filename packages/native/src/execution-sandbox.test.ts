import { expect, test } from "bun:test"
import {
  type BridgeClientExchange,
  type HostProtocolError,
  type HostProtocolRequestEnvelope,
  makeHostProtocolInternalError
} from "@effect-desktop/bridge"
import {
  type AuditEvent,
  type AuditEventsApi,
  makePermissionRegistry,
  P
} from "@effect-desktop/core"
import { Cause, Effect, Exit, Option, Stream } from "effect"

import {
  ExecutionSandbox,
  ExecutionSandboxClient,
  type ExecutionSandboxClientApi,
  makeExecutionSandboxBridgeClientLayer,
  makeExecutionSandboxMemoryClient,
  makeExecutionSandboxServiceLayer,
  makeExecutionSandboxUnsupportedClient
} from "./execution-sandbox.js"
import {
  ExecutionSandboxActor,
  ExecutionSandboxBudgetPolicy,
  ExecutionSandboxCleanupPolicy,
  ExecutionSandboxCreateInput,
  ExecutionSandboxCreateRequest,
  ExecutionSandboxCreateResult,
  ExecutionSandboxDestroyRequest,
  ExecutionSandboxDestroyResult,
  ExecutionSandboxEnvironmentEntry,
  ExecutionSandboxFilesystemPolicy,
  ExecutionSandboxNetworkPolicy,
  ExecutionSandboxPolicy,
  ExecutionSandboxRunInput,
  ExecutionSandboxRunRequest,
  ExecutionSandboxRunResult
} from "./contracts/execution-sandbox.js"

test("ExecutionSandbox service creates, runs, destroys, emits events, and audits privileged use", async () => {
  const rows: AuditEvent[] = []
  const permissions = await Effect.runPromise(
    makePermissionRegistry({
      audit: memoryAudit(rows),
      traceId: () => "trace-permission",
      nextToken: () => "grant-1"
    })
  )
  await Effect.runPromise(
    permissions.declare(processPermission(), { source: "test", effect: "allow" })
  )
  const client = await Effect.runPromise(
    makeExecutionSandboxMemoryClient({
      nextSandboxId: () => "sandbox-1",
      nextRunId: () => "run-1",
      stdout: "v20.0.0"
    })
  )

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const sandbox = yield* ExecutionSandbox
      const created = yield* sandbox.create(createRequest())
      const run = yield* sandbox.run(runRequest(created.sandboxId))
      const destroyed = yield* sandbox.destroy(
        new ExecutionSandboxDestroyRequest({ sandboxId: created.sandboxId })
      )
      const event = yield* sandbox.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
      return { created, destroyed, event, run }
    }).pipe(
      Effect.provide(
        makeExecutionSandboxServiceLayer(client, {
          permissions,
          audit: memoryAudit(rows),
          nextSandboxId: () => "sandbox-1",
          nextRunId: () => "run-1",
          nextTraceId: () => "trace-sandbox"
        })
      )
    )
  )

  expect(result.created).toEqual(
    new ExecutionSandboxCreateResult({
      sandboxId: "sandbox-1",
      policy: defaultDenyPolicy(),
      state: "created"
    })
  )
  expect(result.run).toEqual(
    new ExecutionSandboxRunResult({
      sandboxId: "sandbox-1",
      runId: "run-1",
      status: "completed",
      exitCode: 0,
      stdout: "v20.0.0",
      stderr: ""
    })
  )
  expect(result.destroyed.destroyed).toBe(true)
  expect(result.event.phase).toBe("created")
  expect(rows.some((row) => row.kind === "permission-used")).toBe(true)
  expect(rows.find((row) => row.source === "ExecutionSandbox.run")?.actor).toMatchObject({
    id: "extension:extension-1"
  })
  expect(rows.find((row) => row.source === "ExecutionSandbox.destroy")?.actor).toMatchObject({
    id: "extension:extension-1"
  })
})

test("ExecutionSandbox service treats omitted filesystem and network policy as explicit empty access", async () => {
  const permissions = await Effect.runPromise(makePermissionRegistry())
  let captured: ExecutionSandboxPolicy | undefined
  const client: ExecutionSandboxClientApi = {
    create: (input) =>
      Effect.sync(() => {
        captured = input.policy
        return new ExecutionSandboxCreateResult({
          sandboxId: input.sandboxId ?? "sandbox-1",
          policy: input.policy,
          state: "created"
        })
      }),
    run: () => Effect.succeed(runResult("sandbox-1")),
    destroy: (input) =>
      Effect.succeed(
        new ExecutionSandboxDestroyResult({ sandboxId: input.sandboxId, destroyed: true })
      ),
    isSupported: () => Effect.succeed({ supported: true }),
    events: () => Stream.empty
  }

  await Effect.runPromise(
    Effect.gen(function* () {
      const sandbox = yield* ExecutionSandbox
      return yield* sandbox.create(createRequest())
    }).pipe(
      Effect.provide(
        makeExecutionSandboxServiceLayer(client, {
          permissions
        })
      )
    )
  )

  expect(captured?.filesystem?.readRoots).toEqual([])
  expect(captured?.filesystem?.writeRoots).toEqual([])
  expect(captured?.network?.hosts).toEqual([])
})

test("ExecutionSandbox service denies filesystem and network policy before client side effects", async () => {
  const rows: AuditEvent[] = []
  const permissions = await Effect.runPromise(
    makePermissionRegistry({
      audit: memoryAudit(rows),
      traceId: () => "trace-permission",
      nextToken: () => "grant-1"
    })
  )
  let calls = 0
  const client: ExecutionSandboxClientApi = {
    create: () => {
      calls += 1
      return Effect.succeed(createResult("sandbox-1", privilegedPolicy()))
    },
    run: () => Effect.succeed(runResult("sandbox-1")),
    destroy: (input) =>
      Effect.succeed(
        new ExecutionSandboxDestroyResult({ sandboxId: input.sandboxId, destroyed: true })
      ),
    isSupported: () => Effect.succeed({ supported: true }),
    events: () => Stream.empty
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const sandbox = yield* ExecutionSandbox
      return yield* Effect.exit(
        sandbox.create(
          new ExecutionSandboxCreateRequest({ actor: actor(), policy: privilegedPolicy() })
        )
      )
    }).pipe(
      Effect.provide(
        makeExecutionSandboxServiceLayer(client, {
          permissions,
          audit: memoryAudit(rows),
          nextTraceId: () => "trace-sandbox"
        })
      )
    )
  )

  expect(calls).toBe(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "PermissionDenied", operation: "ExecutionSandbox.create" })
  })
  expect(rows.some((row) => row.kind === "permission-denied")).toBe(true)
})

test("ExecutionSandbox service checks process spawn permission before run side effects", async () => {
  const permissions = await Effect.runPromise(makePermissionRegistry())
  let runs = 0
  const client: ExecutionSandboxClientApi = {
    create: (input) => Effect.succeed(createResult(input.sandboxId ?? "sandbox-1", input.policy)),
    run: () => {
      runs += 1
      return Effect.succeed(runResult("sandbox-1"))
    },
    destroy: (input) =>
      Effect.succeed(
        new ExecutionSandboxDestroyResult({ sandboxId: input.sandboxId, destroyed: true })
      ),
    isSupported: () => Effect.succeed({ supported: true }),
    events: () => Stream.empty
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const sandbox = yield* ExecutionSandbox
      const created = yield* sandbox.create(createRequest())
      return yield* Effect.exit(sandbox.run(runRequest(created.sandboxId)))
    }).pipe(
      Effect.provide(
        makeExecutionSandboxServiceLayer(client, {
          permissions,
          nextSandboxId: () => "sandbox-1",
          nextRunId: () => "run-1"
        })
      )
    )
  )

  expect(runs).toBe(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "PermissionDenied", operation: "ExecutionSandbox.run" })
  })
})

test("ExecutionSandbox service scopes process spawn permission to sandbox cwd and environment", async () => {
  const cwdPermissions = await Effect.runPromise(
    makePermissionRegistry({ traceId: () => "trace-permission", nextToken: () => "grant-1" })
  )
  await Effect.runPromise(
    cwdPermissions.declare(
      P.processSpawn({
        commands: ["/usr/bin/node"],
        cwd: ["/tmp/other"],
        environment: "none"
      }),
      { source: "test", effect: "allow" }
    )
  )
  const envPermissions = await Effect.runPromise(
    makePermissionRegistry({ traceId: () => "trace-permission", nextToken: () => "grant-2" })
  )
  await Effect.runPromise(
    envPermissions.declare(processPermission(), { source: "test", effect: "allow" })
  )
  let runs = 0
  const client: ExecutionSandboxClientApi = {
    create: (input) => Effect.succeed(createResult(input.sandboxId ?? "sandbox-1", input.policy)),
    run: () => {
      runs += 1
      return Effect.succeed(runResult("sandbox-1"))
    },
    destroy: (input) =>
      Effect.succeed(
        new ExecutionSandboxDestroyResult({ sandboxId: input.sandboxId, destroyed: true })
      ),
    isSupported: () => Effect.succeed({ supported: true }),
    events: () => Stream.empty
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const wrongCwd = yield* Effect.gen(function* () {
        const sandbox = yield* ExecutionSandbox
        const created = yield* sandbox.create(createRequest())
        return yield* Effect.exit(sandbox.run(runRequest(created.sandboxId)))
      }).pipe(
        Effect.provide(
          makeExecutionSandboxServiceLayer(client, {
            permissions: cwdPermissions,
            nextSandboxId: () => "sandbox-cwd",
            nextRunId: () => "run-cwd"
          })
        )
      )
      const wrongEnvironment = yield* Effect.gen(function* () {
        const sandbox = yield* ExecutionSandbox
        const created = yield* sandbox.create(
          new ExecutionSandboxCreateRequest({ actor: actor(), policy: environmentPolicy() })
        )
        return yield* Effect.exit(sandbox.run(runRequest(created.sandboxId)))
      }).pipe(
        Effect.provide(
          makeExecutionSandboxServiceLayer(client, {
            permissions: envPermissions,
            nextSandboxId: () => "sandbox-env",
            nextRunId: () => "run-env"
          })
        )
      )
      return { wrongCwd, wrongEnvironment }
    })
  )

  expect(runs).toBe(0)
  expectExitFailure(exit.wrongCwd, (error) => {
    expect(error).toMatchObject({ tag: "PermissionDenied", operation: "ExecutionSandbox.run" })
  })
  expectExitFailure(exit.wrongEnvironment, (error) => {
    expect(error).toMatchObject({ tag: "PermissionDenied", operation: "ExecutionSandbox.run" })
  })
})

test("ExecutionSandbox service removes sandbox state on destroy", async () => {
  const permissions = await Effect.runPromise(makePermissionRegistry())
  await Effect.runPromise(
    permissions.declare(processPermission(), { source: "test", effect: "allow" })
  )
  let runs = 0
  const client: ExecutionSandboxClientApi = {
    create: (input) => Effect.succeed(createResult(input.sandboxId ?? "sandbox-1", input.policy)),
    run: () => {
      runs += 1
      return Effect.succeed(runResult("sandbox-1"))
    },
    destroy: (input) =>
      Effect.succeed(
        new ExecutionSandboxDestroyResult({ sandboxId: input.sandboxId, destroyed: true })
      ),
    isSupported: () => Effect.succeed({ supported: true }),
    events: () => Stream.empty
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const sandbox = yield* ExecutionSandbox
      const created = yield* sandbox.create(createRequest())
      yield* sandbox.destroy(new ExecutionSandboxDestroyRequest({ sandboxId: created.sandboxId }))
      return yield* Effect.exit(sandbox.run(runRequest(created.sandboxId)))
    }).pipe(
      Effect.provide(
        makeExecutionSandboxServiceLayer(client, {
          permissions,
          nextSandboxId: () => "sandbox-1",
          nextRunId: () => "run-1"
        })
      )
    )
  )

  expect(runs).toBe(0)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "InvalidArgument", operation: "ExecutionSandbox.run" })
  })
})

test("ExecutionSandbox bridge client rejects malformed input before native transport", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const exchange: BridgeClientExchange = {
    request: (request) => {
      requests.push(request)
      return Effect.succeed({
        kind: "success",
        payload: createResult("sandbox-1", defaultDenyPolicy())
      })
    },
    subscribe: () => Stream.empty
  }
  const input = createInput()
  Object.defineProperty(input.policy, "cwd", { value: "/tmp/app\nforged" })

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* ExecutionSandboxClient
      return yield* Effect.exit(client.create(input))
    }).pipe(Effect.provide(makeExecutionSandboxBridgeClientLayer(exchange)))
  )

  expect(requests).toEqual([])
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "InvalidArgument", operation: "ExecutionSandbox.create" })
  })
})

test("ExecutionSandbox bridge client rejects shell-shaped run commands before native transport", async () => {
  const requests: HostProtocolRequestEnvelope[] = []
  const exchange: BridgeClientExchange = {
    request: (request) => {
      requests.push(request)
      return Effect.succeed({
        kind: "success",
        payload: runResult("sandbox-1")
      })
    },
    subscribe: () => Stream.empty
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* ExecutionSandboxClient
      return yield* Effect.exit(
        client.run(
          new ExecutionSandboxRunInput({
            sandboxId: "sandbox-1",
            command: "node;rm",
            runId: "run-1"
          })
        )
      )
    }).pipe(Effect.provide(makeExecutionSandboxBridgeClientLayer(exchange)))
  )

  expect(requests).toEqual([])
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "InvalidArgument", operation: "ExecutionSandbox.run" })
  })
})

test("ExecutionSandbox unsupported client exposes typed unsupported failures", async () => {
  const client = makeExecutionSandboxUnsupportedClient()
  const supported = await Effect.runPromise(client.isSupported())
  const exit = await Effect.runPromiseExit(client.create(createInput()))

  expect(supported).toEqual({ supported: false, reason: "host-adapter-unimplemented" })
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "Unsupported", operation: "ExecutionSandbox.create" })
  })
})

test("ExecutionSandbox memory client exposes typed host failures", async () => {
  const client = await Effect.runPromise(
    makeExecutionSandboxMemoryClient({
      failure: {
        run: makeHostProtocolInternalError("host execution sandbox failed", "ExecutionSandbox.run")
      }
    })
  )

  const exit = await Effect.runPromiseExit(client.run(runInput("sandbox-1")))

  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "Internal", operation: "ExecutionSandbox.run" })
  })
})

const actor = (): ExecutionSandboxActor =>
  new ExecutionSandboxActor({ kind: "extension", id: "extension-1" })

const budgets = (): ExecutionSandboxBudgetPolicy =>
  new ExecutionSandboxBudgetPolicy({
    cpuMillis: 500,
    memoryBytes: 67_108_864,
    wallClockMillis: 1_000,
    stdoutBytes: 1_024,
    stderrBytes: 1_024
  })

const cleanup = (): ExecutionSandboxCleanupPolicy =>
  new ExecutionSandboxCleanupPolicy({
    killProcessTree: true,
    removeWorkingDirectory: true
  })

const defaultDenyPolicy = (): ExecutionSandboxPolicy =>
  new ExecutionSandboxPolicy({
    cwd: "/tmp/app",
    budgets: budgets(),
    cleanup: cleanup(),
    environment: [],
    filesystem: new ExecutionSandboxFilesystemPolicy({
      readRoots: [],
      writeRoots: []
    }),
    network: new ExecutionSandboxNetworkPolicy({
      hosts: []
    })
  })

const privilegedPolicy = (): ExecutionSandboxPolicy =>
  new ExecutionSandboxPolicy({
    cwd: "/tmp/app",
    environment: [new ExecutionSandboxEnvironmentEntry({ name: "PATH", value: "/usr/bin" })],
    filesystem: new ExecutionSandboxFilesystemPolicy({
      readRoots: ["/tmp/app"],
      writeRoots: ["/tmp/app/out"]
    }),
    network: new ExecutionSandboxNetworkPolicy({
      hosts: ["api.example.test"]
    }),
    budgets: budgets(),
    cleanup: cleanup()
  })

const environmentPolicy = (): ExecutionSandboxPolicy =>
  new ExecutionSandboxPolicy({
    cwd: "/tmp/app",
    environment: [new ExecutionSandboxEnvironmentEntry({ name: "PATH", value: "/usr/bin" })],
    budgets: budgets(),
    cleanup: cleanup()
  })

const createRequest = (): ExecutionSandboxCreateRequest =>
  new ExecutionSandboxCreateRequest({
    actor: actor(),
    policy: new ExecutionSandboxPolicy({
      cwd: "/tmp/app",
      budgets: budgets(),
      cleanup: cleanup()
    }),
    traceId: "trace-sandbox"
  })

const createInput = (): ExecutionSandboxCreateInput =>
  new ExecutionSandboxCreateInput({
    actor: actor(),
    policy: defaultDenyPolicy(),
    sandboxId: "sandbox-1",
    traceId: "trace-sandbox"
  })

const runRequest = (sandboxId: string): ExecutionSandboxRunRequest =>
  new ExecutionSandboxRunRequest({
    sandboxId,
    command: "/usr/bin/node",
    args: ["--version"],
    traceId: "trace-run"
  })

const runInput = (sandboxId: string): ExecutionSandboxRunInput =>
  new ExecutionSandboxRunInput({
    sandboxId,
    command: "/usr/bin/node",
    args: ["--version"],
    runId: "run-1",
    traceId: "trace-run"
  })

const createResult = (
  sandboxId: string,
  policy: ExecutionSandboxPolicy
): ExecutionSandboxCreateResult =>
  new ExecutionSandboxCreateResult({ sandboxId, policy, state: "created" })

const runResult = (sandboxId: string): ExecutionSandboxRunResult =>
  new ExecutionSandboxRunResult({
    sandboxId,
    runId: "run-1",
    status: "completed",
    exitCode: 0,
    stdout: "",
    stderr: ""
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
