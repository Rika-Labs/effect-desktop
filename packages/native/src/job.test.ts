/** @effect-diagnostics asyncFunction:off strictEffectProvide:off multipleEffectProvide:off */
import { expect, test } from "bun:test"
import {
  type BridgeClientExchange,
  HostProtocolEventEnvelope,
  HostProtocolInternalError,
  HostProtocolInvalidOutputError,
  HostProtocolRequestEnvelope,
  type HostProtocolRequestEnvelope as HostProtocolRequestEnvelopeShape,
  RendererOriginAuth
} from "@orika/bridge"
import {
  type AuditEvent,
  type AuditEventsApi,
  makePermissionRegistry,
  makeResourceId,
  makeResourceRegistry,
  PermissionRegistry,
  P
} from "@orika/core"
import { Cause, Effect, Exit, Layer, Option, Schema, Stream } from "effect"
import * as EventJournal from "effect/unstable/eventlog/EventJournal"

import {
  Job,
  JobClient,
  JobEvent,
  JobHandle,
  JobProgress,
  JobSnapshot,
  JobRuntime,
  JobRuntimeLive,
  JobSupportedResult,
  type JobClientApi,
  makeJobBridgeClientLayer,
  makeHostJobRpcRuntime,
  makeJobMemoryClient,
  makeJobServiceLayer,
  makeJobUnsupportedClient
} from "./job.js"

test("Job contracts reject completed progress greater than total progress", async () => {
  const progressExit = Effect.runSyncExit(
    Schema.decodeUnknownEffect(JobProgress)({
      completed: 20,
      total: 10,
      updatedAt: 1_710_000_000_000
    })
  )
  const unknownTotalExit = Effect.runSyncExit(
    Schema.decodeUnknownEffect(JobProgress)({
      completed: 20,
      updatedAt: 1_710_000_000_000
    })
  )
  const snapshotExit = Effect.runSyncExit(
    Schema.decodeUnknownEffect(JobSnapshot)(jobSnapshotPayload(invalidProgressPayload()))
  )
  const eventExit = Effect.runSyncExit(
    Schema.decodeUnknownEffect(JobEvent)({
      type: "job-event",
      timestamp: 1_710_000_000_000,
      phase: "progress",
      job: jobSnapshotPayload(invalidProgressPayload())
    })
  )

  expect(unknownTotalExit._tag).toBe("Success")
  expect(progressExit._tag).toBe("Failure")
  expect(snapshotExit._tag).toBe("Failure")
  expect(eventExit._tag).toBe("Failure")
})

test("Job bridge client rejects invalid progress from host output and events", async () => {
  const exchange: BridgeClientExchange = {
    request: () =>
      Effect.succeed({
        kind: "success",
        payload: jobSnapshotPayload(invalidProgressPayload())
      }),
    subscribe: (method) =>
      Stream.make(
        new HostProtocolEventEnvelope({
          kind: "event",
          method,
          timestamp: 1_710_000_000_000,
          traceId: "job-event-trace",
          payload: {
            type: "job-event",
            timestamp: 1_710_000_000_000,
            phase: "progress",
            job: jobSnapshotPayload(invalidProgressPayload())
          }
        })
      )
  }

  const resultExit = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* JobClient
      return yield* Effect.exit(client.get({ jobId: "job-1" }))
    }).pipe(Effect.provide(makeJobBridgeClientLayer(exchange)))
  )
  const eventExit = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* JobClient
      return yield* Effect.exit(client.events().pipe(Stream.runHead, Effect.map(Option.getOrThrow)))
    }).pipe(Effect.provide(makeJobBridgeClientLayer(exchange)))
  )

  expectInvalidOutput(resultExit)
  expectInvalidOutput(eventExit)
})

test("Job starts, records progress, controls terminal states, and emits events", async () => {
  const rows: AuditEvent[] = []
  const permissions = await configuredPermissions()
  const client = await Effect.runPromise(makeJobMemoryClient({ nextJobId: () => "job-1" }))

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const jobs = yield* Job
      const started = yield* jobs.start({ name: "Index workspace", traceId: "trace-job" })
      const progressed = yield* jobs.reportProgress({
        jobId: started.handle.id,
        completed: 4,
        total: 10,
        message: "indexed 4 files"
      })
      yield* jobs.pause({ jobId: started.handle.id, reason: "user" })
      yield* jobs.resume({ jobId: started.handle.id })
      yield* jobs.retry({ jobId: started.handle.id, reason: "retry requested" })
      const failed = yield* jobs.fail({ jobId: started.handle.id, reason: "terminal failure" })
      const event = yield* jobs.events().pipe(Stream.runHead)
      return { event, failed, progressed, started }
    }).pipe(Effect.provide(makeJobServiceLayer(client, { permissions, audit: memoryAudit(rows) })))
  )

  expect(result.started.handle).toMatchObject({ id: "job-1", generation: 0, state: "running" })
  expect(result.progressed.progress).toMatchObject({ completed: 4, total: 10 })
  expect(result.failed.handle).toMatchObject({ id: "job-1", state: "failed" })
  expect(result.event._tag).toBe("Some")
  expect(rows.some((row) => row.kind === "permission-used")).toBe(true)
})

test("Job rejects duplicate ids and terminal state mutation", async () => {
  const permissions = await configuredPermissions()
  const client = await Effect.runPromise(makeJobMemoryClient())

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const jobs = yield* Job
      const started = yield* jobs.start({ jobId: "job-duplicate", name: "One" })
      const duplicate = yield* Effect.exit(jobs.start({ jobId: started.handle.id, name: "Two" }))
      yield* jobs.succeed({ jobId: started.handle.id })
      const terminalControl = yield* Effect.exit(
        jobs.interrupt({ jobId: started.handle.id, reason: "too late" })
      )
      const terminalProgress = yield* Effect.exit(
        jobs.reportProgress({ jobId: started.handle.id, completed: 1 })
      )
      const missing = yield* Effect.exit(jobs.get({ jobId: "missing-job" }))
      return { duplicate, missing, terminalControl, terminalProgress }
    }).pipe(Effect.provide(makeJobServiceLayer(client, { permissions })))
  )

  expectExitFailure(result.duplicate, (error) => {
    expect(error).toMatchObject({ tag: "AlreadyExists", operation: "Job.start" })
  })
  expectExitFailure(result.terminalControl, (error) => {
    expect(error).toMatchObject({ tag: "InvalidState", operation: "Job.interrupt" })
  })
  expectExitFailure(result.terminalProgress, (error) => {
    expect(error).toMatchObject({ tag: "InvalidState", operation: "Job.reportProgress" })
  })
  expectExitFailure(result.missing, (error) => {
    expect(error).toMatchObject({ tag: "InvalidArgument", operation: "Job.get" })
  })
})

test("JobRuntime tracks live job fibers and writes terminal state", async () => {
  const permissions = await configuredPermissions()
  const client = await Effect.runPromise(makeJobMemoryClient({ nextJobId: () => "job-runtime-1" }))

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const runtime = yield* JobRuntime
      const jobs = yield* Job
      const started = yield* runtime.run({ name: "Runtime job" }, Effect.succeed("done"))
      yield* runtime.awaitIdle()
      const terminal = yield* jobs.get({ jobId: started.handle.id })
      const active = yield* runtime.activeCount()
      return { active, started, terminal }
    }).pipe(
      Effect.provide(JobRuntimeLive),
      Effect.provide(makeJobServiceLayer(client, { permissions }))
    )
  )

  expect(result.started.handle).toMatchObject({ id: "job-runtime-1", state: "running" })
  expect(result.terminal.handle).toMatchObject({ id: "job-runtime-1", state: "succeeded" })
  expect(result.active).toBe(0)
})

test("JobRuntime interruption cancels the live fiber and cleans up resources", async () => {
  const permissions = await configuredPermissions()
  const client = await Effect.runPromise(makeJobMemoryClient({ nextJobId: () => "job-runtime-2" }))

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const runtime = yield* JobRuntime
      const jobs = yield* Job
      const started = yield* runtime.run({ name: "Interruptible job" }, Effect.never)
      const activeBeforeInterrupt = yield* runtime.activeCount()
      const interrupted = yield* runtime.interrupt({
        jobId: started.handle.id,
        reason: "user cancelled"
      })
      yield* runtime.awaitIdle()
      const activeAfterInterrupt = yield* runtime.activeCount()
      const terminal = yield* jobs.get({ jobId: started.handle.id })
      return { activeAfterInterrupt, activeBeforeInterrupt, interrupted, started, terminal }
    }).pipe(
      Effect.provide(JobRuntimeLive),
      Effect.provide(makeJobServiceLayer(client, { permissions }))
    )
  )

  expect(result.activeBeforeInterrupt).toBe(1)
  expect(result.activeAfterInterrupt).toBe(0)
  expect(result.interrupted.handle).toMatchObject({ id: "job-runtime-2", state: "interrupted" })
  expect(result.terminal.handle).toMatchObject({ id: "job-runtime-2", state: "interrupted" })
  expect(result.terminal.reason).toBe("user cancelled")
})

test("Job registers handles as resources and disposes terminal jobs exactly once", async () => {
  const permissions = await configuredPermissions()
  const resources = await Effect.runPromise(makeResourceRegistry())
  const baseClient = await Effect.runPromise(
    makeJobMemoryClient({ nextJobId: () => "job-resource" })
  )
  let cleanupCalls = 0
  const client: JobClientApi = {
    ...baseClient,
    interrupt: (input) =>
      Effect.sync(() => {
        cleanupCalls += 1
      }).pipe(Effect.andThen(baseClient.interrupt(input)))
  }

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const jobs = yield* Job
      const started = yield* jobs.start({ name: "Resource job" })
      const active = yield* resources.list()
      yield* jobs.succeed({ jobId: started.handle.id })
      const afterTerminal = yield* resources.list()
      yield* resources.dispose(makeResourceId(`job:${started.handle.id}`))
      return { active, afterTerminal, started }
    }).pipe(Effect.provide(makeJobServiceLayer(client, { permissions, resources })))
  )

  expect(result.active.entries).toHaveLength(1)
  expect(result.active.entries[0]?.handle).toMatchObject({
    id: "job:job-resource",
    kind: "job",
    ownerScope: "native-job",
    state: "running"
  })
  expect(result.afterTerminal.entries).toHaveLength(0)
  expect(cleanupCalls).toBe(1)
})

test("Job writes lifecycle entries to an Effect-native journal", async () => {
  const permissions = await configuredPermissions()
  const journal = await Effect.runPromise(EventJournal.makeMemory)
  const client = await Effect.runPromise(makeJobMemoryClient({ nextJobId: () => "job-journal" }))

  const entries = await Effect.runPromise(
    Effect.gen(function* () {
      const jobs = yield* Job
      const started = yield* jobs.start({ name: "Journaled job" })
      yield* jobs.reportProgress({ jobId: started.handle.id, completed: 1, total: 2 })
      yield* jobs.succeed({ jobId: started.handle.id })
      return yield* journal.entries
    }).pipe(Effect.provide(makeJobServiceLayer(client, { journal, permissions })))
  )

  expect(entries.map((entry) => [entry.event, entry.primaryKey])).toEqual([
    ["Job.started", "job-journal"],
    ["Job.progress", "job-journal"],
    ["Job.succeeded", "job-journal"]
  ])
})

test("Job denies before host work", async () => {
  const rows: AuditEvent[] = []
  const permissions = await Effect.runPromise(makePermissionRegistry())
  const baseClient = await Effect.runPromise(makeJobMemoryClient())
  let calls = 0
  const client: JobClientApi = {
    ...baseClient,
    start: (input) =>
      Effect.sync(() => {
        calls += 1
      }).pipe(Effect.andThen(baseClient.start(input)))
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const jobs = yield* Job
      return yield* Effect.exit(jobs.start({ name: "Denied job" }))
    }).pipe(Effect.provide(makeJobServiceLayer(client, { permissions, audit: memoryAudit(rows) })))
  )

  expect(calls).toBe(0)
  expect(rows.some((row) => row.kind === "permission-denied")).toBe(true)
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "PermissionDenied", operation: "Job.start" })
  })
})

test("Job host RPC runtime denies protected calls before handlers run", async () => {
  const calls: string[] = []
  const snapshot = new JobSnapshot({
    handle: new JobHandle({
      kind: "job",
      id: "job-denied",
      generation: 0,
      ownerScope: "native-job",
      state: "running"
    }),
    name: "Denied job",
    state: "running",
    startedAt: 171_000_000_000,
    updatedAt: 171_000_000_000
  })
  const handler = (method: string) =>
    Effect.sync(() => {
      calls.push(method)
      return snapshot
    })
  const runtime = makeHostJobRpcRuntime(
    {
      "Job.start": () => handler("start"),
      "Job.pause": () => handler("pause"),
      "Job.resume": () => handler("resume"),
      "Job.retry": () => handler("retry"),
      "Job.interrupt": () => handler("interrupt"),
      "Job.succeed": () => handler("succeed"),
      "Job.fail": () => handler("fail"),
      "Job.reportProgress": () => handler("reportProgress"),
      "Job.get": () => handler("get"),
      "Job.isSupported": () => Effect.succeed(new JobSupportedResult({ supported: true }))
    },
    { originAuth: RendererOriginAuth.unsafeDisabledForTests }
  )

  const response = await Effect.runPromise(
    runtime
      .dispatch(
        new HostProtocolRequestEnvelope({
          kind: "request",
          id: "job-denied",
          method: "Job.start",
          timestamp: 171_000_000_000,
          traceId: "trace-job-denied",
          payload: { name: "Denied job" }
        })
      )
      .pipe(Effect.provide(Layer.effect(PermissionRegistry, makePermissionRegistry())))
  )

  expect(response.kind).toBe("failure")
  if (response.kind === "failure") {
    expect(response.error).toMatchObject({ tag: "PermissionDenied" })
  }
  expect(calls).toEqual([])
})

test("Job bridge client rejects invalid progress before transport", async () => {
  const requests: HostProtocolRequestEnvelopeShape[] = []
  const exchange: BridgeClientExchange = {
    request: (request) => {
      requests.push(request)
      return Effect.succeed({ kind: "success", payload: {} })
    },
    subscribe: () => Stream.empty
  }

  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* JobClient
      return yield* Effect.exit(client.reportProgress({ jobId: "job-1", completed: 11, total: 10 }))
    }).pipe(Effect.provide(makeJobBridgeClientLayer(exchange)))
  )

  expect(requests).toEqual([])
  expectExitFailure(exit, (error) => {
    expect(error).toMatchObject({ tag: "InvalidArgument", operation: "Job.reportProgress" })
  })
})

test("Job returns typed unsupported and host failures", async () => {
  const permissions = await configuredPermissions()
  const unsupported = await Effect.runPromise(
    Effect.gen(function* () {
      const jobs = yield* Job
      return yield* Effect.exit(jobs.start({ name: "Unsupported job" }))
    }).pipe(Effect.provide(makeJobServiceLayer(makeJobUnsupportedClient(), { permissions })))
  )
  expectExitFailure(unsupported, (error) => {
    expect(error).toMatchObject({ tag: "Unsupported", operation: "Job.start" })
  })

  const rows: AuditEvent[] = []
  const failure = new HostProtocolInternalError({
    tag: "Internal",
    operation: "Job.start",
    message: "host failed",
    recoverable: false
  })
  const failing = await Effect.runPromise(makeJobMemoryClient({ failure: { start: failure } }))
  const failed = await Effect.runPromise(
    Effect.gen(function* () {
      const jobs = yield* Job
      return yield* Effect.exit(jobs.start({ name: "Failing job" }))
    }).pipe(Effect.provide(makeJobServiceLayer(failing, { permissions, audit: memoryAudit(rows) })))
  )
  expect(rows.some((row) => row.kind === "permission-used" && row.outcome === "failed")).toBe(true)
  expectExitFailure(failed, (error) => {
    expect(error).toMatchObject({ tag: "Internal", operation: "Job.start" })
  })
})

const configuredPermissions = async () => {
  const permissions = await Effect.runPromise(makePermissionRegistry())
  for (const method of [
    "start",
    "pause",
    "resume",
    "retry",
    "interrupt",
    "succeed",
    "fail",
    "reportProgress",
    "get"
  ]) {
    await Effect.runPromise(
      permissions.declare(P.nativeInvoke({ primitive: "Job", methods: [method] }))
    )
  }
  return permissions
}

const memoryAudit = (rows: AuditEvent[]): AuditEventsApi => ({
  emit: (event: AuditEvent) =>
    Effect.sync(() => {
      rows.push(event)
    }),
  observe: () => Stream.fromIterable(rows)
})

const invalidProgressPayload = () =>
  ({
    completed: 20,
    total: 10,
    updatedAt: 1_710_000_000_000
  }) as const

const jobSnapshotPayload = (progress: ReturnType<typeof invalidProgressPayload>) =>
  ({
    handle: {
      kind: "job",
      id: "job-1",
      generation: 0,
      ownerScope: "native-job",
      state: "running"
    },
    name: "Invalid progress job",
    state: "running",
    startedAt: 1_710_000_000_000,
    updatedAt: 1_710_000_000_000,
    progress
  }) as const

const expectInvalidOutput = <A>(exit: Exit.Exit<A, unknown>): void => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    expect(Cause.squash(exit.cause)).toBeInstanceOf(HostProtocolInvalidOutputError)
  }
}

const expectExitFailure = <A>(exit: Exit.Exit<A, unknown>, assert: (error: unknown) => void) => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    assert(Cause.squash(exit.cause))
  }
}
