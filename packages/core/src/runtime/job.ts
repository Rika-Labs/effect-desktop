import {
  Cause,
  Context,
  Data,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  PubSub,
  Ref,
  Schema,
  Stream
} from "effect"

import { redact } from "@effect-desktop/bridge"

import { ResourceRegistry, type ResourceHandle, type ResourceRegistryApi } from "./resources.js"

const NonEmptyString = Schema.NonEmptyString
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))
const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const StrictParseOptions = { onExcessProperty: "error" } as const

export class JobRunInput extends Schema.Class<JobRunInput>("JobRunInput")({
  id: Schema.optionalKey(NonEmptyString),
  label: Schema.optionalKey(NonEmptyString),
  ownerScope: NonEmptyString,
  timeoutMs: Schema.optionalKey(PositiveInt)
}) {}

export class JobProgressRecord extends Schema.Class<JobProgressRecord>("JobProgressRecord")({
  jobId: NonEmptyString,
  value: Schema.Unknown,
  emittedAt: NonNegativeInt
}) {}

export class JobSnapshot extends Schema.Class<JobSnapshot>("JobSnapshot")({
  id: NonEmptyString,
  label: NonEmptyString,
  ownerScope: NonEmptyString,
  resourceId: NonEmptyString,
  status: Schema.Literals(["running"]),
  startedAt: NonNegativeInt,
  lastProgress: Schema.optionalKey(JobProgressRecord)
}) {}

export class JobInvalidArgumentError extends Data.TaggedError("InvalidArgument")<{
  readonly operation: string
  readonly field: string
  readonly message: string
  readonly cause: Option.Option<unknown>
}> {}

export class JobFailedError extends Data.TaggedError("JobFailed")<{
  readonly operation: string
  readonly jobId: string
  readonly resourceId: Option.Option<string>
  readonly cause: unknown
}> {}

export class JobCanceledError extends Data.TaggedError("Canceled")<{
  readonly operation: string
  readonly jobId: string
  readonly resourceId: Option.Option<string>
}> {}

export class JobTimedOutError extends Data.TaggedError("JobTimedOut")<{
  readonly operation: string
  readonly jobId: string
  readonly resourceId: Option.Option<string>
  readonly timeoutMs: number
}> {}

export type JobError =
  | JobInvalidArgumentError
  | JobFailedError
  | JobCanceledError
  | JobTimedOutError

export type JobStatus = "running" | "completed" | "failed" | "canceled" | "timed-out"

export interface JobRunOptions<A, P> {
  readonly id?: string
  readonly label?: string
  readonly ownerScope: string
  readonly effect: Effect.Effect<A, unknown, never>
  readonly progress?: Stream.Stream<P, unknown, never>
  readonly progressSchema: Schema.Schema<P>
  readonly timeoutMs?: number
}

export interface JobHandle<A, P> {
  readonly id: string
  readonly resource: ResourceHandle<"job", "running">
  readonly status: Effect.Effect<JobStatus, never, never>
  readonly progress: Stream.Stream<P, JobError, never>
  readonly result: Effect.Effect<A, JobError, never>
  readonly cancel: Effect.Effect<void, never, never>
}

export interface JobApi {
  readonly run: <A, P>(
    options: JobRunOptions<A, P>
  ) => Effect.Effect<JobHandle<A, P>, JobError, never>
  readonly list: () => Effect.Effect<readonly JobSnapshot[], never, never>
}

export interface JobOptions {
  readonly now?: () => number
  readonly nextId?: () => string
  readonly progressBufferSize?: number
}

interface StoredJob {
  readonly id: string
  readonly label: string
  readonly ownerScope: string
  readonly resourceId: string
  readonly resourceGeneration: number
  readonly startedAt: number
  readonly lastProgress?: JobProgressRecord
}

export const makeJob = (
  resources: ResourceRegistryApi,
  options: JobOptions = {}
): Effect.Effect<JobApi, never, never> =>
  Effect.gen(function* () {
    const now = options.now ?? Date.now
    const nextId = options.nextId ?? randomJobId
    const progressBufferSize = options.progressBufferSize ?? 1_024
    const jobs = yield* Ref.make<ReadonlyMap<string, StoredJob>>(new Map())

    return Object.freeze({
      run: <A, P>(options: JobRunOptions<A, P>) =>
        Effect.gen(function* () {
          const input = yield* decodeRunInput(
            {
              ...(options.id === undefined ? {} : { id: options.id }),
              ...(options.label === undefined ? {} : { label: options.label }),
              ownerScope: options.ownerScope,
              ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs })
            },
            "Job.run"
          )
          const id = input.id ?? nextId()
          const label = input.label ?? id
          const startedAt = now()
          const status = yield* Ref.make<JobStatus>("running")
          const progressLog = yield* Ref.make<readonly P[]>([])
          const progressBus = yield* PubSub.sliding<Exit.Exit<P, JobError>>({
            capacity: progressBufferSize,
            replay: 0
          })
          const result = yield* Deferred.make<A, JobError>()
          const fiberRef = yield* Ref.make<Option.Option<Fiber.Fiber<A, JobError>>>(Option.none())
          const progressFiberRef = yield* Ref.make<Option.Option<Fiber.Fiber<void, JobError>>>(
            Option.none()
          )

          const resource = yield* resources.register({
            kind: "job",
            ownerScope: input.ownerScope,
            state: "running",
            dispose: Effect.gen(function* () {
              const fiber = yield* Ref.get(fiberRef)
              const progressFiber = yield* Ref.get(progressFiberRef)
              yield* cancelJob(status, result, id, Option.none(), fiber)
              if (Option.isSome(progressFiber)) {
                yield* Fiber.interrupt(progressFiber.value).pipe(Effect.asVoid)
              }
              yield* PubSub.shutdown(progressBus)
            })
          })
          yield* Ref.update(jobs, (current) =>
            new Map(current).set(id, {
              id,
              label,
              ownerScope: input.ownerScope,
              resourceId: resource.id,
              resourceGeneration: resource.generation,
              startedAt
            })
          )

          const fiber = Effect.runFork(
            runJobEffect(options.effect, input.timeoutMs, id, resource.id, result, status).pipe(
              Effect.ensuring(removeJob(jobs, id, resource))
            )
          )
          const progressFiber =
            options.progress === undefined
              ? undefined
              : Effect.runFork(
                  runProgressProducer(
                    options.progress,
                    options.progressSchema,
                    id,
                    resource.id,
                    progressBus,
                    progressLog,
                    jobs,
                    resource,
                    now,
                    progressBufferSize
                  )
                )
          yield* Ref.set(fiberRef, Option.some(fiber))
          if (progressFiber !== undefined) {
            yield* Ref.set(progressFiberRef, Option.some(progressFiber))
          }

          return makeHandle(
            id,
            resource,
            status,
            progressLog,
            progressBus,
            result,
            fiber,
            progressFiber
          )
        }).pipe(
          Effect.withSpan("Job.run", {
            attributes: { ownerScope: options.ownerScope, id: options.id ?? "" }
          })
        ),
      list: () =>
        Ref.get(jobs).pipe(
          Effect.map((current) =>
            [...current.values()]
              .map(
                (job) =>
                  new JobSnapshot({
                    id: job.id,
                    label: job.label,
                    ownerScope: job.ownerScope,
                    resourceId: job.resourceId,
                    status: "running",
                    startedAt: job.startedAt,
                    ...(job.lastProgress === undefined ? {} : { lastProgress: job.lastProgress })
                  })
              )
              .sort(
                (left, right) => left.startedAt - right.startedAt || left.id.localeCompare(right.id)
              )
          )
        )
    } satisfies JobApi)
  })

export class Job extends Context.Service<Job, JobApi>()("Job") {}

export const JobLive = Layer.effect(
  Job,
  Effect.gen(function* () {
    const resources = yield* ResourceRegistry
    return yield* makeJob(resources)
  })
)

export const JobLayer = (options: JobOptions = {}): Layer.Layer<Job, never, ResourceRegistry> =>
  Layer.effect(
    Job,
    Effect.gen(function* () {
      const resources = yield* ResourceRegistry
      return yield* makeJob(resources, options)
    })
  )

const makeHandle = <A, P>(
  id: string,
  resource: ResourceHandle<"job", "running">,
  status: Ref.Ref<JobStatus>,
  progressLog: Ref.Ref<readonly P[]>,
  progressBus: PubSub.PubSub<Exit.Exit<P, JobError>>,
  result: Deferred.Deferred<A, JobError>,
  fiber: Fiber.Fiber<A, JobError>,
  progressFiber: Fiber.Fiber<void, JobError> | undefined
): JobHandle<A, P> =>
  Object.freeze({
    id,
    resource,
    status: Ref.get(status),
    progress: Stream.scoped(
      Stream.unwrap(
        Effect.gen(function* () {
          const replay = yield* Ref.get(progressLog)
          const subscription = yield* PubSub.subscribe(progressBus)
          return Stream.fromIterable(replay).pipe(
            Stream.concat(
              Stream.fromEffectRepeat(PubSub.take(subscription)).pipe(
                Stream.mapEffect((exit) => exit)
              )
            )
          )
        })
      )
    ),
    result: Deferred.await(result),
    cancel: cancelJob(status, result, id, Option.some(resource.id), Option.some(fiber)).pipe(
      Effect.andThen(
        progressFiber === undefined
          ? Effect.void
          : Fiber.interrupt(progressFiber).pipe(Effect.asVoid)
      )
    )
  })

const runJobEffect = <A>(
  effect: Effect.Effect<A, unknown, never>,
  timeoutMs: number | undefined,
  jobId: string,
  resourceId: string,
  result: Deferred.Deferred<A, JobError>,
  status: Ref.Ref<JobStatus>
): Effect.Effect<A, JobError, never> =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(
      timeoutMs === undefined
        ? effect
        : Effect.timeoutOption(effect, `${timeoutMs} millis`).pipe(
            Effect.flatMap((option) =>
              Option.match(option, {
                onNone: () =>
                  Effect.fail(
                    new JobTimedOutError({
                      operation: "Job.result",
                      jobId,
                      resourceId: Option.some(resourceId),
                      timeoutMs
                    })
                  ),
                onSome: Effect.succeed
              })
            )
          )
    )

    if (Exit.isSuccess(exit)) {
      yield* Ref.set(status, "completed")
      yield* Deferred.succeed(result, exit.value)
      return exit.value
    }

    const currentStatus = yield* Ref.get(status)
    const error =
      currentStatus === "canceled"
        ? new JobCanceledError({
            operation: "Job.cancel",
            jobId,
            resourceId: Option.some(resourceId)
          })
        : jobErrorFromCause(exit.cause, jobId, resourceId)
    yield* Ref.set(status, statusFromError(error))
    yield* Deferred.fail(result, error)
    return yield* Effect.fail(error)
  })

const runProgressProducer = <P>(
  progress: Stream.Stream<P, unknown, never>,
  schema: Schema.Schema<P>,
  jobId: string,
  resourceId: string,
  progressBus: PubSub.PubSub<Exit.Exit<P, JobError>>,
  progressLog: Ref.Ref<readonly P[]>,
  jobs: Ref.Ref<ReadonlyMap<string, StoredJob>>,
  resource: ResourceHandle<"job", "running">,
  now: () => number,
  progressBufferSize: number
): Effect.Effect<void, JobError, never> =>
  progress
    .pipe(
      Stream.runForEach((value) =>
        Effect.gen(function* () {
          const decoded = yield* decodeProgress(value, schema, jobId, resourceId)
          const redacted = redact(decoded) as P
          yield* Ref.update(progressLog, (current) =>
            [...current, redacted].slice(-progressBufferSize)
          )
          const record = new JobProgressRecord({ jobId, value: redacted, emittedAt: now() })
          yield* Ref.update(jobs, (current) => {
            const job = current.get(jobId)
            if (
              job === undefined ||
              job.resourceId !== resource.id ||
              job.resourceGeneration !== resource.generation
            ) {
              return current
            }

            return new Map(current).set(jobId, { ...job, lastProgress: record })
          })
          yield* PubSub.publish(progressBus, Exit.succeed(redacted))
        })
      )
    )
    .pipe(
      Effect.asVoid,
      Effect.catchCause((cause): Effect.Effect<void, JobError, never> => {
        const error = jobErrorFromCause(cause, jobId, resourceId)
        return PubSub.publish(progressBus, Exit.fail(error)).pipe(
          Effect.andThen(Effect.fail(error))
        )
      })
    )

const cancelJob = <A>(
  status: Ref.Ref<JobStatus>,
  result: Deferred.Deferred<A, JobError>,
  jobId: string,
  resourceId: Option.Option<string>,
  fiber: Option.Option<Fiber.Fiber<A, JobError>>
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const shouldCancel = yield* Ref.modify(status, (current) =>
      current === "running" ? [true, "canceled" as JobStatus] : [false, current]
    )
    if (!shouldCancel) {
      return
    }

    yield* Deferred.fail(
      result,
      new JobCanceledError({ operation: "Job.cancel", jobId, resourceId })
    ).pipe(Effect.asVoid)
    if (Option.isSome(fiber)) {
      yield* Fiber.interrupt(fiber.value).pipe(Effect.asVoid)
    }
  }).pipe(Effect.catchCause(() => Effect.void))

const removeJob = (
  jobs: Ref.Ref<ReadonlyMap<string, StoredJob>>,
  jobId: string,
  resource: ResourceHandle<"job", "running">
): Effect.Effect<void, never, never> =>
  Ref.update(jobs, (current) => {
    const job = current.get(jobId)
    if (
      job === undefined ||
      job.resourceId !== resource.id ||
      job.resourceGeneration !== resource.generation
    ) {
      return current
    }

    const next = new Map(current)
    next.delete(jobId)
    return next
  }).pipe(Effect.andThen(resource.dispose()))

const decodeRunInput = (
  input: unknown,
  operation: string
): Effect.Effect<JobRunInput, JobInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(JobRunInput)(input, StrictParseOptions).pipe(
    Effect.mapError(
      (error) =>
        new JobInvalidArgumentError({
          operation,
          field: "payload",
          message: String(error),
          cause: Option.some(error)
        })
    )
  )

const decodeProgress = <P>(
  value: unknown,
  schema: Schema.Schema<P>,
  jobId: string,
  _resourceId: string
): Effect.Effect<P, JobError, never> =>
  Schema.decodeUnknownEffect(schema)(value, StrictParseOptions).pipe(
    Effect.mapError(
      (error) =>
        new JobInvalidArgumentError({
          operation: "Job.progress",
          field: "progress",
          message: `invalid progress for job ${jobId}`,
          cause: Option.some(error)
        })
    )
  ) as Effect.Effect<P, JobError, never>

const jobErrorFromCause = (
  cause: Cause.Cause<unknown>,
  jobId: string,
  resourceId: string
): JobError => {
  const failure = cause.reasons.find(Cause.isFailReason)
  const error = failure?.error
  if (error instanceof JobTimedOutError) {
    return error
  }
  if (error instanceof JobCanceledError) {
    return error
  }
  if (error instanceof JobInvalidArgumentError) {
    return error
  }
  if (error instanceof JobFailedError) {
    return error
  }
  return new JobFailedError({
    operation: "Job.result",
    jobId,
    resourceId: Option.some(resourceId),
    cause
  })
}

const statusFromError = (error: JobError): JobStatus => {
  switch (error._tag) {
    case "Canceled":
      return "canceled"
    case "JobTimedOut":
      return "timed-out"
    case "InvalidArgument":
    case "JobFailed":
      return "failed"
  }
}

const randomJobId = (): string => `job-${crypto.randomUUID()}`
