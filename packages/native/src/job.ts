import {
  type BridgeClientExchange,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  HostProtocolAlreadyExistsError,
  HostProtocolPermissionDeniedError,
  HostProtocolUnsupportedError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidStateError,
  makeHostProtocolInternalError,
  type HostProtocolError,
  type RpcCapabilityMetadata,
  RpcGroup
} from "@orika/bridge"
import {
  type AuditEventsApi,
  type DesktopRpcClient,
  emitAuditEvent,
  P,
  PermissionActor,
  PermissionContext,
  PermissionDeniedError,
  PermissionRegistry,
  type PermissionRegistryApi,
  type PermissionRegistryError,
  permissionAuditEvent,
  ResourceRegistry,
  type ResourceRegistryApi,
  makeResourceId
} from "@orika/core"
import {
  Cause,
  Clock,
  Context,
  Effect,
  FiberMap,
  Layer,
  PubSub,
  Random,
  Ref,
  Schema,
  Stream
} from "effect"
import * as EventJournal from "effect/unstable/eventlog/EventJournal"

import {
  JobControlRequest,
  JobEvent,
  JobGetRequest,
  JobHandle,
  JobProgress,
  JobProgressRequest,
  JobSnapshot,
  JobStartRequest,
  JobSupportedResult,
  type JobEventPhase,
  type JobState
} from "./contracts/job.js"
import { decodeNativeInput, runNativeRpc } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"
import type { NativeRpcHandlers } from "./native-surface.js"

export * from "./contracts/job.js"

const Surface = "Job"
const UnsupportedReason = "host-adapter-unimplemented"
const OwnerScope = "native-job"

export type JobError = HostProtocolError

export const JobStart = jobRpc(
  "start",
  JobStartRequest,
  JobSnapshot,
  P.nativeInvoke({ primitive: Surface, methods: ["start"] })
)
export const JobPause = jobRpc(
  "pause",
  JobControlRequest,
  JobSnapshot,
  P.nativeInvoke({ primitive: Surface, methods: ["pause"] })
)
export const JobResume = jobRpc(
  "resume",
  JobControlRequest,
  JobSnapshot,
  P.nativeInvoke({ primitive: Surface, methods: ["resume"] })
)
export const JobRetry = jobRpc(
  "retry",
  JobControlRequest,
  JobSnapshot,
  P.nativeInvoke({ primitive: Surface, methods: ["retry"] })
)
export const JobInterrupt = jobRpc(
  "interrupt",
  JobControlRequest,
  JobSnapshot,
  P.nativeInvoke({ primitive: Surface, methods: ["interrupt"] })
)
export const JobSucceed = jobRpc(
  "succeed",
  JobControlRequest,
  JobSnapshot,
  P.nativeInvoke({ primitive: Surface, methods: ["succeed"] })
)
export const JobFail = jobRpc(
  "fail",
  JobControlRequest,
  JobSnapshot,
  P.nativeInvoke({ primitive: Surface, methods: ["fail"] })
)
export const JobReportProgress = jobRpc(
  "reportProgress",
  JobProgressRequest,
  JobSnapshot,
  P.nativeInvoke({ primitive: Surface, methods: ["reportProgress"] })
)
export const JobGet = jobRpc(
  "get",
  JobGetRequest,
  JobSnapshot,
  P.nativeInvoke({ primitive: Surface, methods: ["get"] })
)
export const JobIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: JobSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

const JobEventStream = NativeSurface.event(Surface, "Event", {
  payload: JobEvent,
  support: NativeSurface.support.supported
})

const JobRpcGroup = RpcGroup.make(
  JobStart,
  JobPause,
  JobResume,
  JobRetry,
  JobInterrupt,
  JobSucceed,
  JobFail,
  JobReportProgress,
  JobGet,
  JobIsSupported,
  JobEventStream
)

export type JobRpc = RpcGroup.Rpcs<typeof JobRpcGroup>
export type JobRpcHandlers<R = never> = NativeRpcHandlers<typeof JobRpcGroup, R>
export const JobRpcs: RpcGroup.RpcGroup<JobRpc> = JobRpcGroup
export const JobMethodNames = Object.freeze([
  "start",
  "pause",
  "resume",
  "retry",
  "interrupt",
  "succeed",
  "fail",
  "reportProgress",
  "get",
  "isSupported"
] as const)

const JobCapabilityMethods = Object.freeze([
  "start",
  "pause",
  "resume",
  "retry",
  "interrupt",
  "succeed",
  "fail",
  "reportProgress",
  "get"
] as const satisfies readonly (typeof JobMethodNames)[number][])

export interface JobClientApi {
  readonly start: (input: JobStartRequest) => Effect.Effect<JobSnapshot, JobError, never>
  readonly pause: (input: JobControlRequest) => Effect.Effect<JobSnapshot, JobError, never>
  readonly resume: (input: JobControlRequest) => Effect.Effect<JobSnapshot, JobError, never>
  readonly retry: (input: JobControlRequest) => Effect.Effect<JobSnapshot, JobError, never>
  readonly interrupt: (input: JobControlRequest) => Effect.Effect<JobSnapshot, JobError, never>
  readonly succeed: (input: JobControlRequest) => Effect.Effect<JobSnapshot, JobError, never>
  readonly fail: (input: JobControlRequest) => Effect.Effect<JobSnapshot, JobError, never>
  readonly reportProgress: (
    input: JobProgressRequest
  ) => Effect.Effect<JobSnapshot, JobError, never>
  readonly get: (input: JobGetRequest) => Effect.Effect<JobSnapshot, JobError, never>
  readonly isSupported: () => Effect.Effect<JobSupportedResult, JobError, never>
  readonly events: () => Stream.Stream<JobEvent, JobError, never>
}

export class JobClient extends Context.Service<JobClient, JobClientApi>()(
  "@orika/native/job/JobClient"
) {}

export interface JobServiceApi extends JobClientApi {}

export interface JobRuntimeApi {
  readonly run: <A, E, R>(
    input: JobStartRequest,
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<JobSnapshot, JobError, Job | R>
  readonly interrupt: (input: JobControlRequest) => Effect.Effect<JobSnapshot, JobError, Job>
  readonly activeCount: () => Effect.Effect<number, never, never>
  readonly awaitIdle: () => Effect.Effect<void, never, never>
}

export interface JobServiceOptions {
  readonly permissions: PermissionRegistryApi
  readonly resources?: ResourceRegistryApi
  readonly journal?: EventJournal.EventJournal["Service"]
  readonly audit?: AuditEventsApi
  readonly nextJobId?: () => string
}

export class Job extends Context.Service<Job, JobServiceApi>()("@orika/native/job") {
  static readonly layer = Layer.effect(Job)(
    Effect.gen(function* () {
      const client = yield* JobClient
      const permissions = yield* PermissionRegistry
      const resources = yield* ResourceRegistry
      return yield* makeJobService(client, { permissions, resources })
    })
  )
}

export const JobLive = Job.layer

export class JobRuntime extends Context.Service<JobRuntime, JobRuntimeApi>()(
  "@orika/native/job/JobRuntime"
) {
  static readonly layer = Layer.effect(JobRuntime)(makeJobRuntime())
}

export const JobRuntimeLive = JobRuntime.layer

export const makeJobServiceLayer = (
  client: JobClientApi,
  options: JobServiceOptions
): Layer.Layer<Job> => Layer.effect(Job)(makeJobService(client, options))

export const JobHandlersLive = JobRpcGroup.toLayer({
  "Job.start": (input) =>
    Effect.gen(function* () {
      const job = yield* Job
      return yield* job.start(input)
    }),
  "Job.pause": (input) =>
    Effect.gen(function* () {
      const job = yield* Job
      return yield* job.pause(input)
    }),
  "Job.resume": (input) =>
    Effect.gen(function* () {
      const job = yield* Job
      return yield* job.resume(input)
    }),
  "Job.retry": (input) =>
    Effect.gen(function* () {
      const job = yield* Job
      return yield* job.retry(input)
    }),
  "Job.interrupt": (input) =>
    Effect.gen(function* () {
      const job = yield* Job
      return yield* job.interrupt(input)
    }),
  "Job.succeed": (input) =>
    Effect.gen(function* () {
      const job = yield* Job
      return yield* job.succeed(input)
    }),
  "Job.fail": (input) =>
    Effect.gen(function* () {
      const job = yield* Job
      return yield* job.fail(input)
    }),
  "Job.reportProgress": (input) =>
    Effect.gen(function* () {
      const job = yield* Job
      return yield* job.reportProgress(input)
    }),
  "Job.get": (input) =>
    Effect.gen(function* () {
      const job = yield* Job
      return yield* job.get(input)
    }),
  "Job.isSupported": () =>
    Effect.gen(function* () {
      const job = yield* Job
      return yield* job.isSupported()
    }),
  "Job.events.Event": () =>
    Stream.unwrap(
      Effect.gen(function* () {
        const job = yield* Job
        return job.events()
      })
    )
})

export const JobSurface = NativeSurface.make(Surface, JobRpcGroup, {
  service: JobClient,
  capabilities: JobCapabilityMethods,
  handlers: JobHandlersLive,
  client: (client) => jobClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => jobClientFromRpcClient(client, exchange)
})

export const makeHostJobRpcRuntime = (
  handlers: JobRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> => JobSurface.hostRuntime(handlers, runtimeOptions)

export interface JobMemoryClientOptions {
  readonly failure?: Partial<
    Record<
      | "start"
      | "pause"
      | "resume"
      | "retry"
      | "interrupt"
      | "succeed"
      | "fail"
      | "reportProgress"
      | "get",
      JobError
    >
  >
  readonly nextJobId?: () => string
}

export const makeJobMemoryClient = (
  options: JobMemoryClientOptions = {}
): Effect.Effect<JobClientApi, never, never> =>
  Effect.gen(function* () {
    const events = yield* PubSub.bounded<JobEvent>({ capacity: 512, replay: 128 })
    const jobs = yield* Ref.make<ReadonlyMap<string, JobSnapshot>>(new Map())

    return Object.freeze({
      start: (input) =>
        validateStart(input).pipe(
          Effect.flatMap((request) =>
            failOr(
              options.failure?.start,
              Effect.gen(function* () {
                const now = yield* Clock.currentTimeMillis
                const id =
                  request.jobId ?? options.nextJobId?.() ?? `job-${yield* Random.nextUUIDv4}`
                const current = yield* Ref.get(jobs)
                if (current.has(id)) {
                  return yield* Effect.fail(
                    new HostProtocolAlreadyExistsError({
                      tag: "AlreadyExists",
                      resource: id,
                      message: `resource already exists: ${id}`,
                      operation: "Job.start",
                      recoverable: false
                    })
                  )
                }
                const snapshot = makeSnapshot(id, request.name, "running", 0, now)
                yield* Ref.update(jobs, (current) => new Map(current).set(id, snapshot))
                yield* publishEvent(events, "started", snapshot)
                return snapshot
              })
            )
          )
        ),
      pause: (input) =>
        control(jobs, events, "paused", "paused", "Job.pause", input, options.failure?.pause),
      resume: (input) =>
        control(jobs, events, "running", "resumed", "Job.resume", input, options.failure?.resume),
      retry: (input) =>
        control(jobs, events, "running", "retried", "Job.retry", input, options.failure?.retry),
      interrupt: (input) =>
        control(
          jobs,
          events,
          "interrupted",
          "interrupted",
          "Job.interrupt",
          input,
          options.failure?.interrupt
        ),
      succeed: (input) =>
        control(
          jobs,
          events,
          "succeeded",
          "succeeded",
          "Job.succeed",
          input,
          options.failure?.succeed
        ),
      fail: (input) =>
        control(jobs, events, "failed", "failed", "Job.fail", input, options.failure?.fail),
      reportProgress: (input) =>
        validateProgress(input).pipe(
          Effect.flatMap((request) =>
            failOr(
              options.failure?.reportProgress,
              Effect.gen(function* () {
                const current = yield* getExisting(jobs, request.jobId, "Job.reportProgress")
                yield* assertMutable(current, "progress", "Job.reportProgress")
                const now = yield* Clock.currentTimeMillis
                const snapshot = withProgress(current, request, now)
                yield* Ref.update(jobs, (state) => new Map(state).set(request.jobId, snapshot))
                yield* publishEvent(events, "progress", snapshot)
                return snapshot
              })
            )
          )
        ),
      get: (input) =>
        validateGet(input).pipe(
          Effect.flatMap((request) =>
            failOr(options.failure?.get, getExisting(jobs, request.jobId, "Job.get"))
          )
        ),
      isSupported: () => Effect.succeed(new JobSupportedResult({ supported: true })),
      events: () => Stream.fromPubSub(events)
    } satisfies JobClientApi)
  })

export const makeJobUnsupportedClient = (): JobClientApi =>
  Object.freeze({
    start: (input) =>
      validateStart(input).pipe(Effect.flatMap(() => Effect.fail(unsupportedError("Job.start")))),
    pause: (input) =>
      validateControl(input, "Job.pause").pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("Job.pause")))
      ),
    resume: (input) =>
      validateControl(input, "Job.resume").pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("Job.resume")))
      ),
    retry: (input) =>
      validateControl(input, "Job.retry").pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("Job.retry")))
      ),
    interrupt: (input) =>
      validateControl(input, "Job.interrupt").pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("Job.interrupt")))
      ),
    succeed: (input) =>
      validateControl(input, "Job.succeed").pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("Job.succeed")))
      ),
    fail: (input) =>
      validateControl(input, "Job.fail").pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("Job.fail")))
      ),
    reportProgress: (input) =>
      validateProgress(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("Job.reportProgress")))
      ),
    get: (input) =>
      validateGet(input).pipe(Effect.flatMap(() => Effect.fail(unsupportedError("Job.get")))),
    isSupported: () =>
      Effect.succeed(new JobSupportedResult({ supported: false, reason: UnsupportedReason })),
    events: () => Stream.fail(unsupportedError("Job.events"))
  } satisfies JobClientApi)

const makeJobService = (
  client: JobClientApi,
  options: JobServiceOptions
): Effect.Effect<JobServiceApi, never, never> =>
  Effect.succeed(
    Object.freeze({
      start: (input) =>
        validateStart(input).pipe(
          Effect.flatMap((request) =>
            authorize(options, "start", request.traceId).pipe(
              Effect.andThen(client.start(request)),
              Effect.tap((snapshot) => registerJobResource(options, client, snapshot)),
              Effect.tap((snapshot) => appendJobJournal(options, "started", snapshot)),
              Effect.tap((snapshot) => emitUseAudit(options, "start", snapshot, request.traceId)),
              Effect.tapError((error) => emitFailureAudit(options, "start", request.jobId, error))
            )
          )
        ),
      pause: (input) => controlService(client.pause, options, "pause", input),
      resume: (input) => controlService(client.resume, options, "resume", input),
      retry: (input) => controlService(client.retry, options, "retry", input),
      interrupt: (input) => controlService(client.interrupt, options, "interrupt", input),
      succeed: (input) => controlService(client.succeed, options, "succeed", input),
      fail: (input) => controlService(client.fail, options, "fail", input),
      reportProgress: (input) =>
        validateProgress(input).pipe(
          Effect.flatMap((request) =>
            authorize(options, "reportProgress", request.traceId).pipe(
              Effect.andThen(client.reportProgress(request)),
              Effect.tap((snapshot) => appendJobJournal(options, "progress", snapshot)),
              Effect.tap((snapshot) =>
                emitUseAudit(options, "reportProgress", snapshot, request.traceId)
              ),
              Effect.tapError((error) =>
                emitFailureAudit(options, "reportProgress", request.jobId, error)
              )
            )
          )
        ),
      get: (input) =>
        validateGet(input).pipe(
          Effect.flatMap((request) =>
            authorize(options, "get", request.traceId).pipe(
              Effect.andThen(client.get(request)),
              Effect.tap((snapshot) => emitUseAudit(options, "get", snapshot, request.traceId)),
              Effect.tapError((error) => emitFailureAudit(options, "get", request.jobId, error))
            )
          )
        ),
      isSupported: () => client.isSupported(),
      events: () => client.events()
    } satisfies JobServiceApi)
  )

const controlService = (
  method: (input: JobControlRequest) => Effect.Effect<JobSnapshot, JobError, never>,
  options: JobServiceOptions,
  name: "pause" | "resume" | "retry" | "interrupt" | "succeed" | "fail",
  input: JobControlRequest
): Effect.Effect<JobSnapshot, JobError, never> =>
  validateControl(input, `Job.${name}`).pipe(
    Effect.flatMap((request) =>
      authorize(options, name, request.traceId).pipe(
        Effect.andThen(method(request)),
        Effect.tap((snapshot) => appendJobJournal(options, phaseFromMethod(name), snapshot)),
        Effect.tap((snapshot) => disposeTerminalJobResource(options, snapshot)),
        Effect.tap((snapshot) => emitUseAudit(options, name, snapshot, request.traceId)),
        Effect.tapError((error) => emitFailureAudit(options, name, request.jobId, error))
      )
    )
  )

const jobClientFromRpcClient = (
  client: DesktopRpcClient<JobRpc>,
  exchange: BridgeClientExchange | undefined
): JobClientApi =>
  Object.freeze({
    start: (input) =>
      validateStart(input).pipe(
        Effect.flatMap((valid) => runJobRpc(client["Job.start"](valid), "Job.start"))
      ),
    pause: (input) =>
      validateControl(input, "Job.pause").pipe(
        Effect.flatMap((valid) => runJobRpc(client["Job.pause"](valid), "Job.pause"))
      ),
    resume: (input) =>
      validateControl(input, "Job.resume").pipe(
        Effect.flatMap((valid) => runJobRpc(client["Job.resume"](valid), "Job.resume"))
      ),
    retry: (input) =>
      validateControl(input, "Job.retry").pipe(
        Effect.flatMap((valid) => runJobRpc(client["Job.retry"](valid), "Job.retry"))
      ),
    interrupt: (input) =>
      validateControl(input, "Job.interrupt").pipe(
        Effect.flatMap((valid) => runJobRpc(client["Job.interrupt"](valid), "Job.interrupt"))
      ),
    succeed: (input) =>
      validateControl(input, "Job.succeed").pipe(
        Effect.flatMap((valid) => runJobRpc(client["Job.succeed"](valid), "Job.succeed"))
      ),
    fail: (input) =>
      validateControl(input, "Job.fail").pipe(
        Effect.flatMap((valid) => runJobRpc(client["Job.fail"](valid), "Job.fail"))
      ),
    reportProgress: (input) =>
      validateProgress(input).pipe(
        Effect.flatMap((valid) =>
          runJobRpc(client["Job.reportProgress"](valid), "Job.reportProgress")
        )
      ),
    get: (input) =>
      validateGet(input).pipe(
        Effect.flatMap((valid) => runJobRpc(client["Job.get"](valid), "Job.get"))
      ),
    isSupported: () => runJobRpc(client["Job.isSupported"](undefined), "Job.isSupported"),
    events: () => NativeSurface.subscribeEvent(exchange, JobEventStream)
  } satisfies JobClientApi)

function makeJobRuntime() {
  return Effect.gen(function* () {
    const jobs = yield* Job
    const fibers = yield* FiberMap.make<string, void, never>()

    return Object.freeze({
      run: <A, E, R>(input: JobStartRequest, effect: Effect.Effect<A, E, R>) =>
        jobs.start(input).pipe(
          Effect.tap((snapshot) =>
            FiberMap.run(
              fibers,
              snapshot.handle.id,
              effect.pipe(
                Effect.matchCauseEffect({
                  onFailure: (cause) =>
                    jobs
                      .fail({
                        jobId: snapshot.handle.id,
                        reason: Cause.pretty(cause)
                      })
                      .pipe(Effect.asVoid),
                  onSuccess: () => jobs.succeed({ jobId: snapshot.handle.id }).pipe(Effect.asVoid)
                }),
                Effect.catchCause(() => Effect.void)
              )
            )
          )
        ),
      interrupt: (input) =>
        validateControl(input, "Job.interrupt").pipe(
          Effect.flatMap((request) =>
            FiberMap.remove(fibers, request.jobId).pipe(Effect.andThen(jobs.interrupt(request)))
          )
        ),
      activeCount: () => FiberMap.size(fibers),
      awaitIdle: () => FiberMap.awaitEmpty(fibers)
    } satisfies JobRuntimeApi)
  })
}

function jobRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(method: Method, payload: Payload, success: Success, capability: RpcCapabilityMetadata) {
  return NativeSurface.rpc(Surface, method, {
    payload,
    success,
    authority: NativeSurface.authority.custom(capability),
    endpoint: "mutation",
    support: NativeSurface.support.supported
  })
}

const runJobRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, JobError, never> => runNativeRpc(effect, operation, Surface)

const validateStart = (input: unknown): Effect.Effect<JobStartRequest, JobError, never> =>
  decodeNativeInput(JobStartRequest, input, "Job.start")

const validateControl = (
  input: unknown,
  operation: string
): Effect.Effect<JobControlRequest, JobError, never> =>
  decodeNativeInput(JobControlRequest, input, operation)

const validateProgress = (input: unknown): Effect.Effect<JobProgressRequest, JobError, never> =>
  decodeNativeInput(JobProgressRequest, input, "Job.reportProgress")

const validateGet = (input: unknown): Effect.Effect<JobGetRequest, JobError, never> =>
  decodeNativeInput(JobGetRequest, input, "Job.get")

const control = (
  jobs: Ref.Ref<ReadonlyMap<string, JobSnapshot>>,
  events: PubSub.PubSub<JobEvent>,
  state: JobState,
  phase: JobEventPhase,
  operation: string,
  input: unknown,
  failure: JobError | undefined
): Effect.Effect<JobSnapshot, JobError, never> =>
  validateControl(input, operation).pipe(
    Effect.flatMap((request) =>
      failOr(
        failure,
        Effect.gen(function* () {
          const current = yield* getExisting(jobs, request.jobId, operation)
          yield* assertMutable(current, state, operation)
          const now = yield* Clock.currentTimeMillis
          const snapshot = withState(current, state, now, request.reason)
          yield* Ref.update(jobs, (store) => new Map(store).set(request.jobId, snapshot))
          yield* publishEvent(events, phase, snapshot)
          return snapshot
        })
      )
    )
  )

const getExisting = (
  jobs: Ref.Ref<ReadonlyMap<string, JobSnapshot>>,
  jobId: string,
  operation: string
): Effect.Effect<JobSnapshot, JobError, never> =>
  Ref.get(jobs).pipe(
    Effect.flatMap((state) => {
      const snapshot = state.get(jobId)
      return snapshot === undefined
        ? Effect.fail(
            makeHostProtocolInvalidArgumentError("jobId", `job not found: ${jobId}`, operation)
          )
        : Effect.succeed(snapshot)
    })
  )

const registerJobResource = (
  options: JobServiceOptions,
  client: JobClientApi,
  snapshot: JobSnapshot
): Effect.Effect<void, JobError, never> => {
  if (options.resources === undefined) {
    return Effect.void
  }
  const jobId = snapshot.handle.id
  return options.resources
    .register({
      kind: "job",
      id: jobResourceId(jobId),
      ownerScope: snapshot.handle.ownerScope,
      state: snapshot.state,
      dispose: client.interrupt({ jobId, reason: "resource-disposed" }).pipe(Effect.ignore)
    })
    .pipe(
      Effect.asVoid,
      Effect.mapError((error) =>
        makeHostProtocolInternalError(
          `failed to register job resource: ${error.message}`,
          "Job.start"
        )
      )
    )
}

const disposeTerminalJobResource = (
  options: JobServiceOptions,
  snapshot: JobSnapshot
): Effect.Effect<void, never, never> => {
  if (options.resources === undefined || !isTerminal(snapshot.state)) {
    return Effect.void
  }
  return options.resources.dispose(jobResourceId(snapshot.handle.id)).pipe(Effect.ignore)
}

const jobResourceId = (jobId: string) => makeResourceId(`job:${jobId}`)

const appendJobJournal = (
  options: JobServiceOptions,
  phase: JobEventPhase,
  snapshot: JobSnapshot
): Effect.Effect<void, JobError, never> => {
  if (options.journal === undefined) {
    return Effect.void
  }
  return options.journal
    .write({
      event: `Job.${phase}`,
      primaryKey: snapshot.handle.id,
      payload: new TextEncoder().encode(JSON.stringify(snapshot)),
      effect: () => Effect.void
    })
    .pipe(
      Effect.mapError((error) =>
        makeHostProtocolInternalError(
          `failed to write job journal entry: ${String(error.cause)}`,
          "Job.journal"
        )
      )
    )
}

const phaseFromMethod = (
  method: "pause" | "resume" | "retry" | "interrupt" | "succeed" | "fail"
): JobEventPhase => {
  switch (method) {
    case "pause":
      return "paused"
    case "resume":
      return "resumed"
    case "retry":
      return "retried"
    case "interrupt":
      return "interrupted"
    case "succeed":
      return "succeeded"
    case "fail":
      return "failed"
  }
}

const assertMutable = (
  snapshot: JobSnapshot,
  attempted: JobState | "progress",
  operation: string
): Effect.Effect<void, JobError, never> =>
  isTerminal(snapshot.state)
    ? Effect.fail(makeHostProtocolInvalidStateError(snapshot.state, attempted, operation))
    : Effect.void

const isTerminal = (state: JobState): boolean =>
  state === "interrupted" || state === "succeeded" || state === "failed"

const makeSnapshot = (
  id: string,
  name: string,
  state: JobState,
  generation: number,
  timestamp: number,
  reason?: string
): JobSnapshot =>
  new JobSnapshot({
    handle: new JobHandle({ kind: "job", id, generation, ownerScope: OwnerScope, state }),
    name,
    state,
    startedAt: timestamp,
    updatedAt: timestamp,
    ...(reason === undefined ? {} : { reason })
  })

const withState = (
  snapshot: JobSnapshot,
  state: JobState,
  timestamp: number,
  reason?: string
): JobSnapshot =>
  new JobSnapshot({
    handle: new JobHandle({
      kind: "job",
      id: snapshot.handle.id,
      generation: snapshot.handle.generation + 1,
      ownerScope: snapshot.handle.ownerScope,
      state
    }),
    name: snapshot.name,
    state,
    startedAt: snapshot.startedAt,
    updatedAt: timestamp,
    ...(snapshot.progress === undefined ? {} : { progress: snapshot.progress }),
    ...(reason === undefined ? {} : { reason })
  })

const withProgress = (
  snapshot: JobSnapshot,
  progress: JobProgressRequest,
  timestamp: number
): JobSnapshot =>
  new JobSnapshot({
    handle: new JobHandle({
      kind: "job",
      id: snapshot.handle.id,
      generation: snapshot.handle.generation + 1,
      ownerScope: snapshot.handle.ownerScope,
      state: snapshot.state
    }),
    name: snapshot.name,
    state: snapshot.state,
    startedAt: snapshot.startedAt,
    updatedAt: timestamp,
    progress: new JobProgress({
      completed: progress.completed,
      ...(progress.total === undefined ? {} : { total: progress.total }),
      ...(progress.message === undefined ? {} : { message: progress.message }),
      updatedAt: timestamp
    }),
    ...(snapshot.reason === undefined ? {} : { reason: snapshot.reason })
  })

const publishEvent = (
  events: PubSub.PubSub<JobEvent>,
  phase: JobEventPhase,
  snapshot: JobSnapshot
): Effect.Effect<void, never, never> =>
  PubSub.publish(
    events,
    new JobEvent({ type: "job-event", timestamp: snapshot.updatedAt, phase, job: snapshot })
  ).pipe(Effect.asVoid)

const authorize = (
  options: JobServiceOptions,
  method: (typeof JobCapabilityMethods)[number],
  traceId: string | undefined
): Effect.Effect<void, JobError, never> =>
  options.permissions
    .check(
      P.nativeInvoke({ primitive: Surface, methods: [method] }),
      new PermissionContext({
        actor: new PermissionActor({ kind: "app", id: "app" }),
        resource: "job",
        traceId: traceId ?? `Job.${method}`
      })
    )
    .pipe(
      Effect.asVoid,
      Effect.tapError((error) =>
        error instanceof PermissionDeniedError
          ? emitDeniedAudit(options, method, error, traceId)
          : Effect.void
      ),
      Effect.mapError((error: PermissionRegistryError): JobError => {
        if (error instanceof PermissionDeniedError) {
          return new HostProtocolPermissionDeniedError({
            tag: "PermissionDenied",
            message: "permission denied for native.invoke",
            operation: `Job.${method}`,
            capability: P.nativeInvoke({ primitive: Surface, methods: [method] }).kind,
            resource: error.traceId,
            recoverable: false
          })
        }
        return makeHostProtocolInternalError(
          `job permission failure: ${error._tag}`,
          `Job.${method}`
        )
      })
    )

const emitDeniedAudit = (
  options: JobServiceOptions,
  method: string,
  error: PermissionDeniedError,
  traceId: string | undefined
): Effect.Effect<void, never, never> =>
  emitAuditEvent(
    options.audit,
    permissionAuditEvent({
      kind: "permission-denied",
      source: `Job.${method}`,
      traceId: traceId ?? error.traceId,
      outcome: "denied",
      normalizedCapability: P.nativeInvoke({ primitive: Surface, methods: [method] }),
      actor: new PermissionActor({ kind: "app", id: "app" }),
      resource: "job",
      details: { reason: error.reason }
    })
  ).pipe(Effect.ignore)

const emitUseAudit = (
  options: JobServiceOptions,
  method: string,
  snapshot: JobSnapshot,
  traceId: string | undefined
): Effect.Effect<void, JobError, never> =>
  emitAuditEvent(
    options.audit,
    permissionAuditEvent({
      kind: "permission-used",
      source: `Job.${method}`,
      traceId: traceId ?? snapshot.handle.id,
      outcome: snapshot.state,
      normalizedCapability: P.nativeInvoke({ primitive: Surface, methods: [method] }),
      actor: new PermissionActor({ kind: "app", id: "app" }),
      resource: snapshot.handle.id,
      details: { generation: snapshot.handle.generation, state: snapshot.state }
    })
  ).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInternalError(
        `failed to write job audit event: ${error.message}`,
        `Job.${method}`
      )
    )
  )

const emitFailureAudit = (
  options: JobServiceOptions,
  method: string,
  jobId: string | undefined,
  error: JobError
): Effect.Effect<void, never, never> =>
  emitAuditEvent(
    options.audit,
    permissionAuditEvent({
      kind: "permission-used",
      source: `Job.${method}`,
      traceId: jobId ?? `Job.${method}`,
      outcome: "failed",
      normalizedCapability: P.nativeInvoke({ primitive: Surface, methods: [method] }),
      actor: new PermissionActor({ kind: "app", id: "app" }),
      resource: jobId ?? "job",
      details: { reason: error.tag, operation: error.operation }
    })
  ).pipe(Effect.ignore)

const failOr = <A>(
  error: JobError | undefined,
  effect: Effect.Effect<A, JobError, never>
): Effect.Effect<A, JobError, never> => (error === undefined ? effect : Effect.fail(error))

const unsupportedError = (operation: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: `unsupported Job method: ${operation}`,
    operation,
    recoverable: false
  })
