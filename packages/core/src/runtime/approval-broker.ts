import { randomUUID } from "node:crypto"

import { Cause, Context, Data, Deferred, Effect, Match, Option, Ref, Schema } from "effect"

import { approvalAuditEvent, emitAuditEvent } from "./audit-events.js"
import type { EventLogError, EventLogStore } from "./event-log.js"

const NonEmptyString = Schema.NonEmptyString
const ApprovalMetadataText = Schema.NonEmptyString.check(
  // eslint-disable-next-line no-control-regex
  Schema.isPattern(/^[^\x00-\x1F\x7F]+$/)
)
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))
const ApprovalRisk = Schema.Literals(["low", "medium", "high", "critical"])
export type ApprovalRisk = typeof ApprovalRisk.Type

const ApprovalOutcomeKind = Schema.Literals([
  "approved-once",
  "approved-for-scope",
  "denied-once",
  "denied-for-scope",
  "timed-out",
  "canceled",
  "revoked"
])
export type ApprovalOutcomeKind = typeof ApprovalOutcomeKind.Type

export class ApprovalRequest extends Schema.Class<ApprovalRequest>("ApprovalRequest")({
  id: ApprovalMetadataText,
  operation: ApprovalMetadataText,
  actor: ApprovalMetadataText,
  resource: Schema.optionalKey(ApprovalMetadataText),
  risk: ApprovalRisk,
  summary: NonEmptyString,
  details: Schema.Unknown,
  expiresAt: Schema.optionalKey(Schema.Number),
  traceId: Schema.optionalKey(ApprovalMetadataText)
}) {}

export class ApprovalOutcome extends Schema.Class<ApprovalOutcome>("ApprovalOutcome")({
  requestId: ApprovalMetadataText,
  outcome: ApprovalOutcomeKind,
  traceId: ApprovalMetadataText,
  decidedAt: Schema.Number,
  source: ApprovalMetadataText
}) {}

export class ApprovalBrokerInvalidArgumentError extends Data.TaggedError("InvalidArgument")<{
  readonly operation: string
  readonly field: string
  readonly message: string
  readonly cause: Option.Option<unknown>
}> {}

export class ApprovalBrokerQueueOverflowError extends Data.TaggedError("QueueOverflow")<{
  readonly operation: string
  readonly actor: string
  readonly depth: number
  readonly maxDepth: number
}> {}

export class ApprovalBrokerAuditFailedError extends Data.TaggedError("ApprovalAuditFailed")<{
  readonly operation: string
  readonly request: ApprovalRequest
  readonly outcome: Option.Option<ApprovalOutcome>
  readonly cause: EventLogError
}> {}

export class ApprovalBrokerPromptFailedError extends Data.TaggedError("ApprovalPromptFailed")<{
  readonly operation: string
  readonly request: ApprovalRequest
  readonly cause: unknown
}> {}

export type ApprovalBrokerError =
  | ApprovalBrokerInvalidArgumentError
  | ApprovalBrokerQueueOverflowError
  | ApprovalBrokerAuditFailedError
  | ApprovalBrokerPromptFailedError

export interface ApprovalPromptPort {
  readonly prompt: (
    request: ApprovalRequest
  ) => Effect.Effect<ApprovalOutcome, ApprovalBrokerPromptFailedError, never>
}

export interface ApprovalBrokerOptions {
  readonly prompt: ApprovalPromptPort
  readonly audit?: EventLogStore
  readonly devApproveAll?: boolean
  readonly maxQueueDepthPerActor?: number
  readonly now?: () => number
  readonly traceId?: () => string
}

export interface ApprovalBrokerApi {
  readonly ask: (
    request: ApprovalRequest
  ) => Effect.Effect<ApprovalOutcome, ApprovalBrokerError, never>
}

interface BrokerState {
  readonly actors: ReadonlyMap<string, ActorQueue>
}

interface ActorQueue {
  readonly active: Option.Option<PromptEntry>
  readonly queued: readonly PromptEntry[]
  readonly deniedScopes: ReadonlySet<string>
}

interface PromptEntry {
  readonly key: string
  readonly request: ApprovalRequest
  readonly waiters: readonly Deferred.Deferred<ApprovalOutcome, ApprovalBrokerError>[]
}

type EnqueueResult =
  | { readonly _tag: "Await" }
  | { readonly _tag: "Start"; readonly entry: PromptEntry }
  | { readonly _tag: "Immediate"; readonly outcome: ApprovalOutcome }
  | { readonly _tag: "Overflow"; readonly error: ApprovalBrokerQueueOverflowError }

const EMPTY_STATE: BrokerState = Object.freeze({ actors: new Map() })
const DEFAULT_MAX_QUEUE_DEPTH_PER_ACTOR = 8

export const makeApprovalBroker = (
  options: ApprovalBrokerOptions
): Effect.Effect<ApprovalBrokerApi, ApprovalBrokerInvalidArgumentError, never> =>
  Effect.gen(function* () {
    const maxQueueDepthPerActor = yield* decodeQueueDepth(
      options.maxQueueDepthPerActor ?? DEFAULT_MAX_QUEUE_DEPTH_PER_ACTOR
    )
    const state = yield* Ref.make<BrokerState>(EMPTY_STATE)
    const now = options.now ?? Date.now
    const traceId = options.traceId ?? randomUUID

    return Object.freeze({
      ask: (request) =>
        Effect.gen(function* () {
          const decoded = yield* decodeRequest(request)
          const requestWithTrace = yield* withTraceId(decoded, traceId)
          yield* auditApproval(options.audit, "approval requested", requestWithTrace, Option.none())

          if (options.devApproveAll === true) {
            const outcome = approvalOutcome(requestWithTrace, "approved-once", now(), "dev-bypass")
            yield* auditApproval(
              options.audit,
              "approval granted",
              requestWithTrace,
              Option.some(outcome)
            )
            return outcome
          }

          const waiter = yield* Deferred.make<ApprovalOutcome, ApprovalBrokerError>()
          const result = yield* Ref.modify(state, (current) =>
            enqueue(current, requestWithTrace, waiter, maxQueueDepthPerActor, now())
          )

          return yield* Match.value(result).pipe(
            Match.tag("Await", () => Deferred.await(waiter)),
            Match.tag("Immediate", (r) => Effect.succeed(r.outcome)),
            Match.tag("Overflow", (r) => Effect.fail(r.error)),
            Match.tag("Start", (r) =>
              runPromptLoop(state, options.prompt, options.audit, r.entry).pipe(
                Effect.flatMap(() => Deferred.await(waiter))
              )
            ),
            Match.exhaustive
          )
        }).pipe(
          Effect.withSpan("ApprovalBroker.ask", {
            attributes: { operation: request.operation, actor: request.actor }
          })
        )
    } satisfies ApprovalBrokerApi)
  }).pipe(Effect.withSpan("ApprovalBroker.make"))

export class ApprovalBroker extends Context.Service<ApprovalBroker, ApprovalBrokerApi>()(
  "ApprovalBroker",
  {
    make: Effect.fail(
      new ApprovalBrokerInvalidArgumentError({
        operation: "ApprovalBroker.make",
        field: "prompt",
        message: "ApprovalBroker requires an explicit host prompt port",
        cause: Option.none()
      })
    )
  }
) {}

const enqueue = (
  state: BrokerState,
  request: ApprovalRequest,
  waiter: Deferred.Deferred<ApprovalOutcome, ApprovalBrokerError>,
  maxQueueDepthPerActor: number,
  now: number
): readonly [EnqueueResult, BrokerState] => {
  const actor = actorQueue(state, request.actor)
  const key = approvalKey(request)
  if (actor.deniedScopes.has(key)) {
    return [
      {
        _tag: "Immediate",
        outcome: approvalOutcome(request, "denied-for-scope", now, "scope-cache")
      },
      state
    ]
  }

  const active = Option.getOrUndefined(actor.active)
  if (active !== undefined && active.key === key) {
    return [
      { _tag: "Await" },
      setActorQueue(state, request.actor, {
        ...actor,
        active: Option.some(addWaiter(active, waiter))
      })
    ]
  }

  const queuedIndex = actor.queued.findIndex((entry) => entry.key === key)
  if (queuedIndex >= 0) {
    return [
      { _tag: "Await" },
      setActorQueue(state, request.actor, {
        ...actor,
        queued: actor.queued.map((entry, index) =>
          index === queuedIndex ? addWaiter(entry, waiter) : entry
        )
      })
    ]
  }

  const entry: PromptEntry = { key, request, waiters: [waiter] }
  if (active === undefined) {
    return [
      { _tag: "Start", entry },
      setActorQueue(state, request.actor, { ...actor, active: Option.some(entry) })
    ]
  }

  if (actor.queued.length >= maxQueueDepthPerActor) {
    return [
      {
        _tag: "Overflow",
        error: new ApprovalBrokerQueueOverflowError({
          operation: "ApprovalBroker.ask",
          actor: request.actor,
          depth: actor.queued.length,
          maxDepth: maxQueueDepthPerActor
        })
      },
      state
    ]
  }

  return [
    { _tag: "Await" },
    setActorQueue(state, request.actor, {
      ...actor,
      queued: [...actor.queued, entry]
    })
  ]
}

const runPromptLoop = (
  state: Ref.Ref<BrokerState>,
  prompt: ApprovalPromptPort,
  audit: EventLogStore | undefined,
  entry: PromptEntry
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    let current: Option.Option<PromptEntry> = Option.some(entry)
    while (Option.isSome(current)) {
      const active = current.value
      const exit = yield* prompt
        .prompt(active.request)
        .pipe(Effect.flatMap(decodeOutcome), Effect.exit)
      const completed = yield* currentActiveEntry(state, active)
      if (exit._tag === "Success") {
        const auditExit = yield* auditApproval(
          audit,
          approvalAuditType(exit.value),
          completed.request,
          Option.some(exit.value)
        ).pipe(Effect.exit)
        if (auditExit._tag === "Success") {
          yield* completeSuccess(completed, exit.value)
        } else {
          yield* completeFailure(completed, causeToAuditFailure(auditExit.cause, completed.request))
        }
        current = yield* finishPrompt(state, completed, Option.some(exit.value))
      } else {
        const error = causeToPromptFailure(exit.cause, completed.request)
        yield* completeFailure(completed, error)
        current = yield* finishPrompt(state, completed, Option.none())
      }
    }
  })

const currentActiveEntry = (
  state: Ref.Ref<BrokerState>,
  entry: PromptEntry
): Effect.Effect<PromptEntry, never, never> =>
  Ref.get(state).pipe(
    Effect.map((current) => {
      const active = Option.getOrUndefined(actorQueue(current, entry.request.actor).active)
      return active?.key === entry.key ? active : entry
    })
  )

const finishPrompt = (
  state: Ref.Ref<BrokerState>,
  entry: PromptEntry,
  outcome: Option.Option<ApprovalOutcome>
): Effect.Effect<Option.Option<PromptEntry>, never, never> =>
  Ref.modify(state, (current) => {
    const actor = actorQueue(current, entry.request.actor)
    const [next, ...rest] = actor.queued
    const deniedScopes =
      Option.isSome(outcome) && outcome.value.outcome === "denied-for-scope"
        ? new Set([...actor.deniedScopes, entry.key])
        : actor.deniedScopes
    return [
      next === undefined ? Option.none<PromptEntry>() : Option.some(next),
      setActorQueue(current, entry.request.actor, {
        active: next === undefined ? Option.none() : Option.some(next),
        queued: rest,
        deniedScopes
      })
    ] as const
  })

const completeSuccess = (
  entry: PromptEntry,
  outcome: ApprovalOutcome
): Effect.Effect<void, never, never> =>
  Effect.forEach(entry.waiters, (waiter) => Deferred.succeed(waiter, outcome)).pipe(Effect.asVoid)

const completeFailure = (
  entry: PromptEntry,
  error: ApprovalBrokerError
): Effect.Effect<void, never, never> =>
  Effect.forEach(entry.waiters, (waiter) => Deferred.fail(waiter, error)).pipe(Effect.asVoid)

const auditApproval = (
  audit: EventLogStore | undefined,
  type: "approval requested" | "approval granted" | "approval denied",
  request: ApprovalRequest,
  outcome: Option.Option<ApprovalOutcome>
): Effect.Effect<void, ApprovalBrokerAuditFailedError, never> =>
  emitAuditEvent(
    audit,
    approvalAuditEvent({
      kind: approvalAuditKind(type),
      source: "ApprovalBroker",
      traceId: request.traceId ?? request.id,
      outcome: Option.isNone(outcome) ? "requested" : outcome.value.outcome,
      actor: request.actor,
      ...(request.resource === undefined ? {} : { resource: request.resource }),
      details: {
        request: {
          id: request.id,
          operation: request.operation,
          risk: request.risk,
          summary: request.summary,
          details: request.details,
          ...(request.expiresAt === undefined ? {} : { expiresAt: request.expiresAt })
        },
        ...(Option.isNone(outcome) ? {} : { outcome: outcome.value })
      }
    })
  ).pipe(
    Effect.mapError(
      (cause) =>
        new ApprovalBrokerAuditFailedError({
          operation: "ApprovalBroker.audit",
          request,
          outcome,
          cause
        })
    )
  )

const approvalAuditKind = (
  type: "approval requested" | "approval granted" | "approval denied"
): "approval-requested" | "approval-granted" | "approval-denied" => {
  switch (type) {
    case "approval requested":
      return "approval-requested"
    case "approval granted":
      return "approval-granted"
    case "approval denied":
      return "approval-denied"
  }
}

const approvalAuditType = (outcome: ApprovalOutcome): "approval granted" | "approval denied" =>
  outcome.outcome === "approved-once" || outcome.outcome === "approved-for-scope"
    ? "approval granted"
    : "approval denied"

const causeToPromptFailure = (
  cause: Cause.Cause<ApprovalBrokerPromptFailedError | ApprovalBrokerInvalidArgumentError>,
  request: ApprovalRequest
): ApprovalBrokerPromptFailedError | ApprovalBrokerInvalidArgumentError => {
  const failure = cause.reasons.find(Cause.isFailReason)
  return failure === undefined
    ? new ApprovalBrokerPromptFailedError({
        operation: "ApprovalBroker.ask",
        request,
        cause
      })
    : failure.error
}

const causeToAuditFailure = (
  cause: Cause.Cause<ApprovalBrokerAuditFailedError>,
  request: ApprovalRequest
): ApprovalBrokerError => {
  const failure = cause.reasons.find(Cause.isFailReason)
  return failure === undefined
    ? new ApprovalBrokerPromptFailedError({
        operation: "ApprovalBroker.ask",
        request,
        cause
      })
    : failure.error
}

const actorQueue = (state: BrokerState, actor: string): ActorQueue =>
  state.actors.get(actor) ?? {
    active: Option.none(),
    queued: [],
    deniedScopes: new Set()
  }

const setActorQueue = (state: BrokerState, actor: string, queue: ActorQueue): BrokerState => {
  const actors = new Map(state.actors)
  actors.set(actor, queue)
  return { actors }
}

const addWaiter = (
  entry: PromptEntry,
  waiter: Deferred.Deferred<ApprovalOutcome, ApprovalBrokerError>
): PromptEntry => ({ ...entry, waiters: [...entry.waiters, waiter] })

const approvalKey = (request: ApprovalRequest): string =>
  `${request.operation}\u0000${request.actor}\u0000${request.resource ?? ""}`

const approvalOutcome = (
  request: ApprovalRequest,
  outcome: ApprovalOutcomeKind,
  decidedAt: number,
  source: string
): ApprovalOutcome =>
  new ApprovalOutcome({
    requestId: request.id,
    outcome,
    traceId: request.traceId ?? randomUUID(),
    decidedAt,
    source
  })

const withTraceId = (
  request: ApprovalRequest,
  traceId: () => string
): Effect.Effect<ApprovalRequest, ApprovalBrokerInvalidArgumentError, never> =>
  request.traceId === undefined
    ? Schema.decodeUnknownEffect(ApprovalMetadataText)(traceId()).pipe(
        Effect.map(
          (resolved) =>
            new ApprovalRequest({
              id: request.id,
              operation: request.operation,
              actor: request.actor,
              ...(request.resource === undefined ? {} : { resource: request.resource }),
              risk: request.risk,
              summary: request.summary,
              details: request.details,
              ...(request.expiresAt === undefined ? {} : { expiresAt: request.expiresAt }),
              traceId: resolved
            })
        ),
        Effect.mapError((cause) => invalidArgument("ApprovalBroker.ask", "traceId", cause))
      )
    : Effect.succeed(request)

const decodeRequest = (
  input: unknown
): Effect.Effect<ApprovalRequest, ApprovalBrokerInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(ApprovalRequest)(input).pipe(
    Effect.mapError((cause) => invalidArgument("ApprovalBroker.ask", "request", cause))
  )

const decodeOutcome = (
  input: ApprovalOutcome
): Effect.Effect<ApprovalOutcome, ApprovalBrokerInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(ApprovalOutcome)(input).pipe(
    Effect.mapError((cause) => invalidArgument("ApprovalBroker.ask", "outcome", cause))
  )

const decodeQueueDepth = (
  input: unknown
): Effect.Effect<number, ApprovalBrokerInvalidArgumentError, never> =>
  Schema.decodeUnknownEffect(PositiveInt)(input).pipe(
    Effect.mapError((cause) =>
      invalidArgument("ApprovalBroker.make", "maxQueueDepthPerActor", cause)
    )
  )

const invalidArgument = (
  operation: string,
  field: string,
  cause: unknown
): ApprovalBrokerInvalidArgumentError =>
  new ApprovalBrokerInvalidArgumentError({
    operation,
    field,
    message: formatUnknownError(cause),
    cause: Option.some(cause)
  })

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return String(error)
}
