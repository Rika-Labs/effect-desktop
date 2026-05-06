import { expect, test } from "bun:test"
import { Cause, Deferred, Effect, Exit, Schema, Stream } from "effect"

import {
  JobCanceledError,
  JobInvalidArgumentError,
  JobTimedOutError,
  makeJob,
  type JobApi
} from "./job.js"
import { makeResourceRegistry, type ResourceRegistryApi } from "./resources.js"

const Progress = Schema.Struct({
  step: Schema.Number,
  token: Schema.optionalKey(Schema.String)
})

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
  options: { readonly progressBufferSize?: number } = {}
): Promise<Fixture> => {
  let id = 0
  const registry = await Effect.runPromise(
    makeResourceRegistry({
      now: () => id++,
      nextId: (timestamp) => `resource-${timestamp}` as never
    })
  )
  const service = await Effect.runPromise(makeJob(registry, { now: () => id++, ...options }))
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
