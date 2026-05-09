import { expect, test } from "bun:test"
import {
  Cause,
  Data,
  Deferred,
  Duration,
  Effect,
  Exit,
  Option,
  Schema,
  Schedule,
  Stream
} from "effect"

import { EventLogEntry, EventLogFullError, type EventLogStore } from "./event-log.js"
import {
  CrashRetryPolicy,
  JobAuditFailedError,
  JobCanceledError,
  JobInvalidArgumentError,
  JobFailedError,
  JobRetrying,
  JobTimedOutError,
  makeJob,
  type JobApi
} from "./job.js"
import { makeResourceRegistry, type ResourceRegistryApi } from "./resources.js"

const Progress = Schema.Struct({
  step: Schema.Number,
  token: Schema.optionalKey(Schema.String)
})

class PermissionDenied extends Data.TaggedError("PermissionDenied")<{
  readonly operation: string
}> {}

class TransientFailure extends Data.TaggedError("TransientFailure")<{
  readonly attempt: number
}> {}

test("Job run emits typed progress and resolves result", async () => {
  const fixture = await makeFixture()
  const handle = await Effect.runPromise(
    fixture.service.run({
      id: "job-progress",
      ownerScope: "scope-main",
      effect: Effect.succeed("done"),
      progress: Stream.fromIterable([{ step: 1 }, { step: 2 }, { step: 3 }]),
      progressSchema: Progress
    })
  )

  const result = await Effect.runPromise(handle.result)
  const progress = await Effect.runPromise(handle.progress.pipe(Stream.take(3), Stream.runCollect))

  expect(result).toBe("done")
  expect(Array.from(progress)).toEqual([{ step: 1 }, { step: 2 }, { step: 3 }])
})

test("Job cancel interrupts the running fiber and returns Canceled", async () => {
  const fixture = await makeFixture()
  const interrupted = await Effect.runPromise(Deferred.make<void>())
  const handle = await Effect.runPromise(
    fixture.service.run({
      id: "job-cancel",
      ownerScope: "scope-main",
      effect: Effect.never.pipe(Effect.ensuring(Deferred.succeed(interrupted, undefined))),
      progressSchema: Progress
    })
  )

  await Effect.runPromise(handle.cancel)
  await Effect.runPromise(Deferred.await(interrupted))
  const exit = await Effect.runPromiseExit(handle.result)
  const status = await Effect.runPromise(handle.status)

  expectFailure(exit, JobCanceledError)
  expect(status).toBe("canceled")
})

test("Job timeout interrupts the effect and returns JobTimedOut", async () => {
  const fixture = await makeFixture()
  const interrupted = await Effect.runPromise(Deferred.make<void>())
  const handle = await Effect.runPromise(
    fixture.service.run({
      id: "job-timeout",
      ownerScope: "scope-main",
      effect: Effect.never.pipe(Effect.ensuring(Deferred.succeed(interrupted, undefined))),
      progressSchema: Progress,
      timeoutMs: 5
    })
  )

  const exit = await Effect.runPromiseExit(handle.result)
  await Effect.runPromise(Deferred.await(interrupted))

  expectFailure(exit, JobTimedOutError)
})

test("Job list returns running jobs and removes terminal jobs", async () => {
  const fixture = await makeFixture()
  const complete = await Effect.runPromise(Deferred.make<void>())
  const handle = await Effect.runPromise(
    fixture.service.run({
      id: "job-listed",
      label: "Listed job",
      ownerScope: "scope-main",
      effect: Deferred.await(complete),
      progressSchema: Progress
    })
  )
  const running = await Effect.runPromise(fixture.service.list())

  await Effect.runPromise(Deferred.succeed(complete, undefined))
  await Effect.runPromise(handle.result)
  await waitUntil(async () => (await Effect.runPromise(fixture.service.list())).length === 0)

  expect(running.map((job) => job.id)).toEqual(["job-listed"])
  expect(running[0]?.label).toBe("Listed job")
})

test("Job progress redacts secret-shaped fields before replay", async () => {
  const fixture = await makeFixture()
  const handle = await Effect.runPromise(
    fixture.service.run({
      id: "job-redacted",
      ownerScope: "scope-main",
      effect: Effect.succeed("done"),
      progress: Stream.fromIterable([{ step: 1, token: "secret" }]),
      progressSchema: Progress
    })
  )
  const progress = await Effect.runPromise(handle.progress.pipe(Stream.take(1), Stream.runCollect))

  expect(Array.from(progress)).toEqual([{ step: 1, token: "[REDACTED]" }])
})

test("Job progress decode failures return typed stream errors", async () => {
  const fixture = await makeFixture()
  const emitProgress = await Effect.runPromise(Deferred.make<void>())
  const handle = await Effect.runPromise(
    fixture.service.run({
      id: "job-invalid-progress",
      ownerScope: "scope-main",
      effect: Effect.never,
      progress: Stream.fromEffect(Deferred.await(emitProgress)).pipe(
        Stream.map(() => ({ step: "bad" }) as unknown as typeof Progress.Type)
      ),
      progressSchema: Progress
    })
  )
  const progress = Effect.runPromiseExit(handle.progress.pipe(Stream.take(1), Stream.runCollect))

  await Effect.runPromise(Deferred.succeed(emitProgress, undefined))
  const exit = await progress
  await Effect.runPromise(handle.cancel)

  expectFailure(exit, JobInvalidArgumentError)
})

test("Job progress replay keeps a bounded history", async () => {
  const fixture = await makeFixture({ progressBufferSize: 2 })
  const handle = await Effect.runPromise(
    fixture.service.run({
      id: "job-bounded-progress",
      ownerScope: "scope-main",
      effect: Effect.succeed("done"),
      progress: Stream.fromIterable([{ step: 1 }, { step: 2 }, { step: 3 }]),
      progressSchema: Progress
    })
  )

  await Effect.runPromise(handle.result)
  const progress = await Effect.runPromise(handle.progress.pipe(Stream.take(2), Stream.runCollect))

  expect(Array.from(progress)).toEqual([{ step: 2 }, { step: 3 }])
})

test("Job retry policy retries recoverable failures and emits progress plus audit", async () => {
  const auditRows: EventLogEntry[] = []
  const fixture = await makeFixture({ auditRows })
  let attempts = 0
  const handle = await Effect.runPromise(
    fixture.service.run({
      id: "job-retry-success",
      ownerScope: "scope-main",
      effect: Effect.sync(() => {
        attempts += 1
        return attempts
      }).pipe(
        Effect.flatMap((attempt) =>
          attempt < 3
            ? Effect.fail(new TransientFailure({ attempt }))
            : Effect.succeed(`success-${attempt}`)
        )
      ),
      progressSchema: Progress,
      retry: CrashRetryPolicy.fixed({ maxRetries: 3, delay: "0 millis" })
    })
  )

  const result = await Effect.runPromise(handle.result)
  const progress = await Effect.runPromise(handle.progress.pipe(Stream.take(2), Stream.runCollect))

  expect(result).toBe("success-3")
  expect(attempts).toBe(3)
  expect(
    Array.from(progress).map((event) =>
      event instanceof JobRetrying
        ? {
            tag: event._tag,
            jobId: event.jobId,
            attempt: event.attempt,
            error: event.error,
            nextDelayMs: event.nextDelayMs
          }
        : event
    )
  ).toEqual([
    {
      tag: "JobRetrying",
      jobId: "job-retry-success",
      attempt: 1,
      error: new TransientFailure({ attempt: 1 }),
      nextDelayMs: 0
    },
    {
      tag: "JobRetrying",
      jobId: "job-retry-success",
      attempt: 2,
      error: new TransientFailure({ attempt: 2 }),
      nextDelayMs: 0
    }
  ])
  expect(auditRows.map((row) => row.type)).toEqual(["audit/job-retrying", "audit/job-retrying"])
})

test("Job retry policy does not publish retry progress before audit succeeds", async () => {
  let auditCalls = 0
  const fixture = await makeFixture({
    audit: {
      append: () =>
        Effect.sync(() => {
          auditCalls += 1
        }).pipe(
          Effect.andThen(
            Effect.fail(
              new EventLogFullError({
                freeBytes: 0,
                operation: "EventLog.append",
                cause: Option.none()
              })
            )
          )
        ),
      query: () => Effect.succeed([]),
      subscribe: () => Stream.die("unused"),
      close: () => Effect.void
    }
  })
  let attempts = 0
  const handle = await Effect.runPromise(
    fixture.service.run({
      id: "job-retry-audit-fails",
      ownerScope: "scope-main",
      effect: Effect.sync(() => {
        attempts += 1
        return attempts
      }).pipe(Effect.flatMap((attempt) => Effect.fail(new TransientFailure({ attempt })))),
      progressSchema: Progress,
      retry: CrashRetryPolicy.fixed({ maxRetries: 1, delay: "0 millis" })
    })
  )

  const exit = await Effect.runPromiseExit(handle.result)
  const replayExit = await Effect.runPromiseExit(
    handle.progress.pipe(Stream.take(1), Stream.runCollect, Effect.timeout("20 millis"))
  )

  expectFailure(exit, JobAuditFailedError)
  expect(auditCalls).toBe(1)
  expect(attempts).toBe(1)
  expect(Exit.isFailure(replayExit)).toBe(true)
})

test("Job retry policy does not retry non-recoverable failures", async () => {
  const fixture = await makeFixture()
  let attempts = 0
  const handle = await Effect.runPromise(
    fixture.service.run({
      id: "job-no-retry-permission",
      ownerScope: "scope-main",
      effect: Effect.sync(() => {
        attempts += 1
      }).pipe(Effect.andThen(Effect.fail(new PermissionDenied({ operation: "Job.test" })))),
      progressSchema: Progress,
      retry: CrashRetryPolicy.fixed({ maxRetries: 3, delay: "0 millis" })
    })
  )
  const exit = await Effect.runPromiseExit(handle.result)

  expect(attempts).toBe(1)
  expectFailure(exit, JobFailedError)
})

test("Job retry policy exhaustion reports attempts and last error", async () => {
  const fixture = await makeFixture()
  let attempts = 0
  const handle = await Effect.runPromise(
    fixture.service.run({
      id: "job-retry-exhausted",
      ownerScope: "scope-main",
      effect: Effect.sync(() => {
        attempts += 1
        return attempts
      }).pipe(Effect.flatMap((attempt) => Effect.fail(new TransientFailure({ attempt })))),
      progressSchema: Progress,
      retry: CrashRetryPolicy.fixed({ maxRetries: 2, delay: "0 millis" })
    })
  )
  const exit = await Effect.runPromiseExit(handle.result)

  expect(attempts).toBe(3)
  expectJobFailed(exit, 3, new TransientFailure({ attempt: 3 }))
})

test("Job retry policy exhaustion respects max total duration", async () => {
  const fixture = await makeFixture()
  let attempts = 0
  const handle = await Effect.runPromise(
    fixture.service.run({
      id: "job-retry-duration-exhausted",
      ownerScope: "scope-main",
      effect: Effect.sync(() => {
        attempts += 1
        return attempts
      }).pipe(Effect.flatMap((attempt) => Effect.fail(new TransientFailure({ attempt })))),
      progressSchema: Progress,
      retry: CrashRetryPolicy.fixed({
        maxRetries: 3,
        delay: "10 millis",
        maxTotalDuration: "5 millis"
      })
    })
  )
  const exit = await Effect.runPromiseExit(handle.result)

  expect(attempts).toBe(1)
  expectJobFailed(exit, 1, new TransientFailure({ attempt: 1 }))
})

test("CrashRetryPolicy exponentialJittered produces jittered delays", async () => {
  const firstStep = await Effect.runPromise(
    Schedule.toStep(
      CrashRetryPolicy.exponentialJittered({ maxRetries: 1, baseDelay: "100 millis" }).schedule
    )
  )
  const secondStep = await Effect.runPromise(
    Schedule.toStep(
      CrashRetryPolicy.exponentialJittered({ maxRetries: 1, baseDelay: "100 millis" }).schedule
    )
  )
  const first = await Effect.runPromise(firstStep(1_000, new TransientFailure({ attempt: 1 })))
  const second = await Effect.runPromise(secondStep(1_000, new TransientFailure({ attempt: 1 })))

  expect(Duration.toMillis(first[1])).not.toBe(Duration.toMillis(second[1]))
})

test("Job scope close cancels the running job and releases scoped resources", async () => {
  const fixture = await makeFixture()
  const handle = await Effect.runPromise(
    fixture.service.run({
      id: "job-scope",
      ownerScope: "scope-main",
      effect: Effect.never,
      progressSchema: Progress
    })
  )

  await Effect.runPromise(fixture.registry.closeScope("scope-main"))
  const exit = await Effect.runPromiseExit(handle.result)
  const resources = await Effect.runPromise(fixture.registry.list())

  expectFailure(exit, JobCanceledError)
  expect(resources.entries).toEqual([])
})

interface Fixture {
  readonly registry: ResourceRegistryApi
  readonly service: JobApi
}

const makeFixture = async (
  options: {
    readonly progressBufferSize?: number
    readonly auditRows?: EventLogEntry[]
    readonly audit?: EventLogStore
  } = {}
): Promise<Fixture> => {
  let id = 0
  const registry = await Effect.runPromise(
    makeResourceRegistry({
      now: () => id++,
      nextId: (timestamp) => `resource-${timestamp}` as never
    })
  )
  const service = await Effect.runPromise(
    makeJob(registry, {
      now: () => id++,
      ...(options.progressBufferSize === undefined
        ? {}
        : { progressBufferSize: options.progressBufferSize }),
      ...(options.audit === undefined && options.auditRows === undefined
        ? {}
        : { audit: options.audit ?? memoryAudit(options.auditRows ?? []) })
    })
  )
  return { registry, service }
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
  expected: abstract new (...args: never[]) => E
): void => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const failure = exit.cause.reasons.find(Cause.isFailReason)
    expect(failure?.error).toBeInstanceOf(expected)
  }
}

const expectJobFailed = (
  exit: Exit.Exit<unknown, unknown>,
  attempts: number,
  lastError: unknown
): void => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const failure = exit.cause.reasons.find(Cause.isFailReason)
    expect(failure?.error).toBeInstanceOf(JobFailedError)
    if (failure?.error instanceof JobFailedError) {
      expect(failure.error.attempts).toBe(attempts)
      expect(failure.error.lastError.valueOrUndefined).toEqual(lastError)
    }
  }
}

const memoryAudit = (rows: EventLogEntry[]): EventLogStore => ({
  append: (event, options) =>
    Effect.sync(() => {
      rows.push(
        new EventLogEntry({
          id: rows.length,
          type: event.type,
          ...(event.payload === undefined ? {} : { payload: event.payload }),
          timestampMs: 1_000 + rows.length,
          ...(options?.source === undefined ? {} : { source: options.source })
        })
      )
      return rows.length - 1
    }),
  query: () => Effect.succeed(rows),
  subscribe: () => Stream.die("unused"),
  close: () => Effect.void
})
