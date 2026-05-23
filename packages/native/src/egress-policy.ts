import {
  type BridgeClientExchange,
  HostProtocolPermissionDeniedError,
  HostProtocolUnsupportedError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInternalError,
  type HostProtocolError,
  type RpcCapabilityMetadata,
  type RpcSupportMetadata,
  RpcGroup
} from "@orika/bridge"
import {
  type AuditEventsApi,
  type DesktopRpcClient,
  emitAuditEvent,
  PermissionDeniedError,
  PermissionRegistry,
  type PermissionRegistryApi,
  P,
  PermissionActor,
  PermissionContext,
  permissionAuditEvent
} from "@orika/core"
import { Clock, Context, Effect, Layer, PubSub, Ref, Schema, Stream } from "effect"

import { subscribeNativeEvent } from "./event-stream.js"
import { decodeNativeInput, runNativeRpc } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"
import type { NativeRpcHandlers } from "./native-surface.js"
import {
  EgressPolicyDecisionInput,
  EgressPolicyDecisionRequest,
  EgressPolicyDecisionRecordedEvent,
  type EgressPolicyEvent,
  EgressPolicyDecisionResult,
  EgressPolicyRecordInput,
  EgressPolicyRecordRequest,
  EgressPolicyRecordResult,
  EgressPolicyRule,
  EgressPolicySupportedResult,
  type EgressPolicyActor,
  type EgressPolicyDestination
} from "./contracts/egress-policy.js"

const Surface = "EgressPolicy"
const UnsupportedReason = "host-adapter-unimplemented"
const RuntimeProbedSupportReason = "host-decision-log-runtime-probed"
const RuntimeProbedSupport = NativeSurface.support.partial(RuntimeProbedSupportReason, {
  platforms: [
    { platform: "macos", status: "partial", reason: RuntimeProbedSupportReason },
    { platform: "windows", status: "partial", reason: RuntimeProbedSupportReason },
    { platform: "linux", status: "partial", reason: RuntimeProbedSupportReason }
  ]
}) satisfies RpcSupportMetadata
const DefaultDenyRule = new EgressPolicyRule({
  id: "default-deny",
  effect: "deny",
  hosts: ["*"],
  reason: "no matching egress allow rule"
})
const EgressPolicyEventMethod = "EgressPolicy.DecisionRecorded"
const IssuedDecisionLimit = 4096
const IssuedDecisionTtlMillis = 5 * 60 * 1000

interface IssuedDecisionEntry {
  readonly decision: EgressPolicyDecisionResult
  readonly expiresAt: number
}

export type EgressPolicyError = HostProtocolError

export const EgressPolicyDecide = egressPolicyRpc(
  "decide",
  EgressPolicyDecisionInput,
  EgressPolicyDecisionResult,
  P.nativeInvoke({ primitive: Surface, methods: ["decide"] })
)
export const EgressPolicyRecord = egressPolicyRpc(
  "record",
  EgressPolicyRecordInput,
  EgressPolicyRecordResult,
  P.nativeInvoke({ primitive: Surface, methods: ["record"] })
)
export const EgressPolicyIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: EgressPolicySupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: RuntimeProbedSupport
})

export const EgressPolicyRpcEvents = Object.freeze({
  DecisionRecorded: { payload: EgressPolicyDecisionRecordedEvent }
})

export type EgressPolicyRpcEvents = typeof EgressPolicyRpcEvents

const EgressPolicyRpcGroup = RpcGroup.make(
  EgressPolicyDecide,
  EgressPolicyRecord,
  EgressPolicyIsSupported
)

export const EgressPolicyRpcs: RpcGroup.RpcGroup<EgressPolicyRpc> = EgressPolicyRpcGroup

export const EgressPolicyMethodNames = Object.freeze(["decide", "record", "isSupported"] as const)

const EgressPolicyCapabilityMethods = Object.freeze([
  "decide",
  "record"
] as const satisfies readonly (typeof EgressPolicyMethodNames)[number][])

export interface EgressPolicyClientApi {
  readonly decide: (
    input: EgressPolicyDecisionInput
  ) => Effect.Effect<EgressPolicyDecisionResult, EgressPolicyError, never>
  readonly record: (
    input: EgressPolicyRecordInput
  ) => Effect.Effect<EgressPolicyRecordResult, EgressPolicyError, never>
  readonly isSupported: () => Effect.Effect<EgressPolicySupportedResult, EgressPolicyError, never>
  readonly events: () => Stream.Stream<EgressPolicyEvent, EgressPolicyError, never>
}

export class EgressPolicyClient extends Context.Service<
  EgressPolicyClient,
  EgressPolicyClientApi
>()("@orika/native/EgressPolicyClient") {}

export interface EgressPolicyServiceApi {
  readonly decide: (
    input: EgressPolicyDecisionRequest
  ) => Effect.Effect<EgressPolicyDecisionResult, EgressPolicyError, never>
  readonly record: (
    input: EgressPolicyRecordRequest
  ) => Effect.Effect<EgressPolicyRecordResult, EgressPolicyError, never>
  readonly isSupported: () => Effect.Effect<EgressPolicySupportedResult, EgressPolicyError, never>
  readonly events: () => Stream.Stream<EgressPolicyEvent, EgressPolicyError, never>
}

export interface EgressPolicyServiceOptions {
  readonly permissions: PermissionRegistryApi
  readonly audit?: AuditEventsApi
  readonly rules?: readonly EgressPolicyRule[]
  readonly nextTraceId?: () => string
}

export class EgressPolicy extends Context.Service<EgressPolicy, EgressPolicyServiceApi>()(
  "@orika/native/EgressPolicy"
) {
  static readonly layer = Layer.effect(EgressPolicy)(
    Effect.gen(function* () {
      const client = yield* EgressPolicyClient
      const permissions = yield* PermissionRegistry
      return yield* makeEgressPolicyService(client, { permissions })
    })
  )
}

export const EgressPolicyLive = EgressPolicy.layer

export const makeEgressPolicyServiceLayer = (
  client: EgressPolicyClientApi,
  options: EgressPolicyServiceOptions
): Layer.Layer<EgressPolicy> => Layer.effect(EgressPolicy)(makeEgressPolicyService(client, options))

export type EgressPolicyRpc = RpcGroup.Rpcs<typeof EgressPolicyRpcGroup>

export type EgressPolicyRpcHandlers<R = never> = NativeRpcHandlers<typeof EgressPolicyRpcGroup, R>

export const EgressPolicyHandlersLive = EgressPolicyRpcGroup.toLayer({
  "EgressPolicy.decide": (input) =>
    Effect.gen(function* () {
      const policy = yield* EgressPolicy
      return yield* policy.decide(
        new EgressPolicyDecisionRequest({
          actor: input.actor,
          destination: input.destination,
          ...(input.traceId === undefined ? {} : { traceId: input.traceId })
        })
      )
    }),
  "EgressPolicy.record": (input) =>
    Effect.gen(function* () {
      const policy = yield* EgressPolicy
      return yield* policy.record(
        new EgressPolicyRecordRequest({
          decisionId: input.decisionId,
          ...(input.traceId === undefined ? {} : { traceId: input.traceId })
        })
      )
    }),
  "EgressPolicy.isSupported": () =>
    Effect.gen(function* () {
      const policy = yield* EgressPolicy
      return yield* policy.isSupported()
    })
})

export const EgressPolicySurface = NativeSurface.make(Surface, EgressPolicyRpcGroup, {
  service: EgressPolicyClient,
  capabilities: EgressPolicyCapabilityMethods,
  handlers: EgressPolicyHandlersLive,
  client: (client) => egressPolicyClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => egressPolicyClientFromRpcClient(client, exchange)
})

export interface EgressPolicyMemoryClientOptions {
  readonly failure?: Partial<Record<"decide" | "record", EgressPolicyError>>
  readonly nextDecisionId?: () => string
}

export const makeEgressPolicyMemoryClient = (
  options: EgressPolicyMemoryClientOptions = {}
): Effect.Effect<EgressPolicyClientApi, never, never> =>
  Effect.gen(function* () {
    const pubsub = yield* PubSub.bounded<EgressPolicyEvent>({ capacity: 256, replay: 64 })
    const issued = yield* Ref.make<ReadonlyMap<string, IssuedDecisionEntry>>(new Map())
    const nextDecisionId = yield* makeDecisionIdGenerator(options.nextDecisionId)

    return Object.freeze({
      decide: (input) =>
        validateDecisionInput(input, "EgressPolicy.decide").pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.decide,
              Effect.gen(function* () {
                const decision = decideEgress(valid, [], yield* nextDecisionId())
                const now = yield* Clock.currentTimeMillis
                yield* Ref.update(issued, (current) =>
                  rememberIssuedDecision(current, decision, now)
                )
                return decision
              })
            )
          )
        ),
      record: (input) =>
        validateRecordInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.record,
              Effect.gen(function* () {
                const now = yield* Clock.currentTimeMillis
                const claimed = yield* claimIssuedDecision(
                  issued,
                  valid,
                  now,
                  "EgressPolicy.record"
                )
                yield* publishDecisionEvent(pubsub, claimed.decision)
                return new EgressPolicyRecordResult({
                  decisionId: claimed.decision.decisionId,
                  recorded: true
                })
              })
            )
          )
        ),
      isSupported: () => Effect.succeed(new EgressPolicySupportedResult({ supported: true })),
      events: () => Stream.fromPubSub(pubsub)
    } satisfies EgressPolicyClientApi)
  })

export const makeEgressPolicyUnsupportedClient = (): EgressPolicyClientApi =>
  Object.freeze({
    decide: (input) =>
      validateDecisionInput(input, "EgressPolicy.decide").pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("EgressPolicy.decide")))
      ),
    record: (input) =>
      validateRecordInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("EgressPolicy.record")))
      ),
    isSupported: () =>
      Effect.succeed(
        new EgressPolicySupportedResult({
          supported: false,
          reason: UnsupportedReason
        })
      ),
    events: () => Stream.fail(unsupportedError("EgressPolicy.events"))
  } satisfies EgressPolicyClientApi)

const makeEgressPolicyService = (
  client: EgressPolicyClientApi,
  options: EgressPolicyServiceOptions
): Effect.Effect<EgressPolicyServiceApi, never, never> =>
  Effect.gen(function* () {
    const issued = yield* Ref.make<ReadonlyMap<string, IssuedDecisionEntry>>(new Map())
    const recorded = yield* Ref.make<ReadonlyMap<string, IssuedDecisionEntry>>(new Map())
    const trustedRules = options.rules ?? []

    return Object.freeze({
      decide: (input) =>
        Effect.gen(function* () {
          const request = yield* validateDecisionRequest(input, "EgressPolicy.decide")
          const valid = new EgressPolicyDecisionInput({
            actor: request.actor,
            destination: request.destination,
            ...(request.traceId === undefined ? {} : { traceId: request.traceId })
          })
          yield* checkEgressPermission(options, valid)
          const hostDecision = yield* client.decide(valid)
          const decision = decideEgress(valid, trustedRules, hostDecision.decisionId)
          yield* emitDecisionAudit(options, decision, "EgressPolicy.decide")
          if (decision.outcome === "denied") {
            return yield* Effect.fail(deniedError(decision, "EgressPolicy.decide"))
          }
          const now = yield* Clock.currentTimeMillis
          yield* Ref.update(issued, (current) => rememberIssuedDecision(current, decision, now))
          return decision
        }),
      record: (input) =>
        Effect.gen(function* () {
          const valid = yield* validateRecordRequest(input)
          return yield* Effect.uninterruptible(
            Effect.gen(function* () {
              const now = yield* Clock.currentTimeMillis
              const claimed = yield* claimIssuedDecisionById(
                issued,
                valid.decisionId,
                now,
                "EgressPolicy.record"
              )
              yield* Ref.update(recorded, (current) =>
                rememberIssuedDecision(current, claimed.decision, now)
              )
              return yield* client
                .record(
                  new EgressPolicyRecordInput({
                    decisionId: claimed.decision.decisionId,
                    actor: claimed.decision.actor,
                    destination: claimed.decision.destination,
                    ...(valid.traceId === undefined ? {} : { traceId: valid.traceId })
                  })
                )
                .pipe(
                  Effect.catch((error) =>
                    removeIssuedDecision(recorded, claimed.decision.decisionId).pipe(
                      Effect.andThen(restoreIssuedDecision(issued, claimed, now)),
                      Effect.andThen(Effect.fail(error))
                    )
                  )
                )
            })
          )
        }),
      isSupported: () => client.isSupported(),
      events: () =>
        client.events().pipe(Stream.mapEffect((event) => mapRecordedEvent(recorded, event)))
    } satisfies EgressPolicyServiceApi)
  })

const egressPolicyClientFromRpcClient = (
  client: DesktopRpcClient<EgressPolicyRpc>,
  exchange: BridgeClientExchange | undefined
): EgressPolicyClientApi =>
  Object.freeze({
    decide: (input) =>
      validateDecisionInput(input, "EgressPolicy.decide").pipe(
        Effect.flatMap((valid) =>
          runEgressPolicyRpc(client["EgressPolicy.decide"](valid), "EgressPolicy.decide")
        )
      ),
    record: (input) =>
      validateRecordInput(input).pipe(
        Effect.flatMap((valid) =>
          runEgressPolicyRpc(client["EgressPolicy.record"](valid), "EgressPolicy.record")
        )
      ),
    isSupported: () =>
      runEgressPolicyRpc(client["EgressPolicy.isSupported"](undefined), "EgressPolicy.isSupported"),
    events: () =>
      subscribeNativeEvent(exchange, EgressPolicyEventMethod, EgressPolicyDecisionRecordedEvent)
  } satisfies EgressPolicyClientApi)

function egressPolicyRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(method: Method, payload: Payload, success: Success, capability: RpcCapabilityMetadata) {
  return NativeSurface.rpc(Surface, method, {
    payload,
    success,
    authority: NativeSurface.authority.custom(capability),
    endpoint: "mutation",
    support: RuntimeProbedSupport
  })
}

const runEgressPolicyRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, EgressPolicyError, never> => runNativeRpc(effect, operation, Surface)

const validateDecisionInput = (
  input: unknown,
  operation: string
): Effect.Effect<EgressPolicyDecisionInput, EgressPolicyError, never> =>
  decodeNativeInput(EgressPolicyDecisionInput, input, operation)

const validateDecisionRequest = (
  input: unknown,
  operation: string
): Effect.Effect<EgressPolicyDecisionRequest, EgressPolicyError, never> =>
  decodeNativeInput(EgressPolicyDecisionRequest, input, operation)

const validateRecordRequest = (
  input: unknown
): Effect.Effect<EgressPolicyRecordRequest, EgressPolicyError, never> =>
  decodeNativeInput(EgressPolicyRecordRequest, input, "EgressPolicy.record")

const validateRecordInput = (
  input: unknown
): Effect.Effect<EgressPolicyRecordInput, EgressPolicyError, never> =>
  decodeNativeInput(EgressPolicyRecordInput, input, "EgressPolicy.record")

const failOr = <A>(
  error: EgressPolicyError | undefined,
  effect: Effect.Effect<A, EgressPolicyError, never>
): Effect.Effect<A, EgressPolicyError, never> => (error === undefined ? effect : Effect.fail(error))

const makeDecisionIdGenerator = (
  nextDecisionId: (() => string) | undefined
): Effect.Effect<() => Effect.Effect<string, never, never>, never, never> =>
  Effect.gen(function* () {
    const sequence = yield* Ref.make(0)
    if (nextDecisionId !== undefined) {
      return () => Effect.sync(nextDecisionId)
    }
    return () =>
      Ref.updateAndGet(sequence, (current) => current + 1).pipe(
        Effect.map((current) => `egress-decision-${current}`)
      )
  })

const decideEgress = (
  input: EgressPolicyDecisionInput,
  rules: readonly EgressPolicyRule[],
  decisionId: string
): EgressPolicyDecisionResult => {
  const rule = rules.find((candidate) => ruleMatches(candidate, input)) ?? DefaultDenyRule
  const reason =
    rule.reason ?? (rule.effect === "allow" ? "matching egress allow rule" : "egress denied")
  return new EgressPolicyDecisionResult({
    decisionId,
    outcome: rule.effect === "allow" ? "allowed" : "denied",
    actor: input.actor,
    destination: input.destination,
    rule,
    reason
  })
}

const ruleMatches = (rule: EgressPolicyRule, input: EgressPolicyDecisionInput): boolean =>
  (rule.actor === undefined || sameActor(rule.actor, input.actor)) &&
  matchesOne(rule.hosts, input.destination.host) &&
  (rule.protocols === undefined ||
    rule.protocols.length === 0 ||
    rule.protocols.includes(input.destination.protocol)) &&
  (rule.ports === undefined ||
    rule.ports.length === 0 ||
    (input.destination.port !== undefined && rule.ports.includes(input.destination.port)))

const matchesOne = (patterns: readonly string[], value: string): boolean =>
  patterns.some((pattern) => pattern === "*" || pattern === value)

const sameActor = (left: EgressPolicyActor, right: EgressPolicyActor): boolean =>
  left.kind === right.kind && left.id === right.id

const sameDestination = (left: EgressPolicyDestination, right: EgressPolicyDestination): boolean =>
  left.protocol === right.protocol &&
  left.host === right.host &&
  left.port === right.port &&
  left.path === right.path

interface IssuedDecisionClaim {
  readonly decisionId: string
  readonly actor: EgressPolicyActor
  readonly destination: EgressPolicyDestination
}

const rememberIssuedDecision = (
  current: ReadonlyMap<string, IssuedDecisionEntry>,
  decision: EgressPolicyDecisionResult,
  now: number
): ReadonlyMap<string, IssuedDecisionEntry> => {
  const next = new Map(pruneIssuedDecisions(current, now))
  while (next.size >= IssuedDecisionLimit) {
    const oldest = next.keys().next().value
    if (oldest === undefined) {
      break
    }
    next.delete(oldest)
  }
  next.set(decision.decisionId, {
    decision,
    expiresAt: now + IssuedDecisionTtlMillis
  })
  return next
}

const claimIssuedDecisionById = (
  issued: Ref.Ref<ReadonlyMap<string, IssuedDecisionEntry>>,
  decisionId: string,
  now: number,
  operation: string
): Effect.Effect<IssuedDecisionEntry, EgressPolicyError, never> =>
  Ref.modify(issued, (current) => {
    const pruned = pruneIssuedDecisions(current, now)
    const entry = pruned.get(decisionId)
    if (entry === undefined) {
      return [undefined, pruned] as const
    }
    const next = new Map(pruned)
    next.delete(decisionId)
    return [entry, next] as const
  }).pipe(
    Effect.flatMap((entry) =>
      entry === undefined
        ? Effect.fail(
            makeHostProtocolInvalidArgumentError(
              "decisionId",
              "must reference an issued egress decision",
              operation
            )
          )
        : Effect.succeed(entry)
    )
  )

const claimIssuedDecision = (
  issued: Ref.Ref<ReadonlyMap<string, IssuedDecisionEntry>>,
  claim: IssuedDecisionClaim,
  now: number,
  operation: string
): Effect.Effect<IssuedDecisionEntry, EgressPolicyError, never> =>
  Effect.gen(function* () {
    const entry = yield* claimIssuedDecisionById(issued, claim.decisionId, now, operation)
    if (!sameActor(entry.decision.actor, claim.actor)) {
      yield* restoreIssuedDecision(issued, entry, now)
      return yield* Effect.fail(
        makeHostProtocolInvalidArgumentError(
          "actor",
          "must match issued egress decision actor",
          operation
        )
      )
    }
    if (!sameDestination(entry.decision.destination, claim.destination)) {
      yield* restoreIssuedDecision(issued, entry, now)
      return yield* Effect.fail(
        makeHostProtocolInvalidArgumentError(
          "destination",
          "must match issued egress decision destination",
          operation
        )
      )
    }
    return entry
  })

const mapRecordedEvent = (
  recorded: Ref.Ref<ReadonlyMap<string, IssuedDecisionEntry>>,
  event: EgressPolicyEvent
): Effect.Effect<EgressPolicyEvent, never, never> =>
  Clock.currentTimeMillis.pipe(
    Effect.flatMap((now) =>
      Ref.modify(recorded, (current) => {
        const pruned = pruneIssuedDecisions(current, now)
        const entry = pruned.get(event.decision.decisionId)
        if (entry === undefined) {
          return [event, pruned] as const
        }
        const mapped = new EgressPolicyDecisionRecordedEvent({
          type: event.type,
          timestamp: event.timestamp,
          decision: entry.decision
        })
        return [mapped, pruned] as const
      })
    )
  )

const restoreIssuedDecision = (
  issued: Ref.Ref<ReadonlyMap<string, IssuedDecisionEntry>>,
  entry: IssuedDecisionEntry,
  now: number
): Effect.Effect<void, never, never> =>
  Ref.update(issued, (current) => rememberIssuedDecision(current, entry.decision, now)).pipe(
    Effect.asVoid
  )

const removeIssuedDecision = (
  issued: Ref.Ref<ReadonlyMap<string, IssuedDecisionEntry>>,
  decisionId: string
): Effect.Effect<void, never, never> =>
  Ref.update(issued, (current) => {
    const next = new Map(current)
    next.delete(decisionId)
    return next
  }).pipe(Effect.asVoid)

const pruneIssuedDecisions = (
  current: ReadonlyMap<string, IssuedDecisionEntry>,
  now: number
): ReadonlyMap<string, IssuedDecisionEntry> => {
  const next = new Map<string, IssuedDecisionEntry>()
  for (const [decisionId, entry] of current) {
    if (entry.expiresAt > now) {
      next.set(decisionId, entry)
    }
  }
  return next
}

const publishDecisionEvent = (
  pubsub: PubSub.PubSub<EgressPolicyEvent>,
  decision: EgressPolicyDecisionResult
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const timestamp = yield* Clock.currentTimeMillis
    yield* PubSub.publish(
      pubsub,
      new EgressPolicyDecisionRecordedEvent({
        type: "decision-recorded",
        timestamp,
        decision
      })
    )
  }).pipe(Effect.asVoid)

const checkEgressPermission = (
  options: EgressPolicyServiceOptions,
  input: EgressPolicyDecisionInput
): Effect.Effect<void, EgressPolicyError, never> => {
  const permissionDeniedDecision = (reason: string): EgressPolicyDecisionResult =>
    new EgressPolicyDecisionResult({
      decisionId: input.traceId ?? "permission-denied",
      outcome: "denied",
      actor: input.actor,
      destination: input.destination,
      rule: new EgressPolicyRule({
        id: "permission-registry",
        effect: "deny",
        hosts: [input.destination.host],
        reason
      }),
      reason: "permission registry denied egress"
    })

  return options.permissions
    .check(
      P.networkConnect({ hosts: [input.destination.host], askUnknownHosts: false }),
      new PermissionContext({
        actor: permissionActor(input.actor),
        resource: destinationResource(input.destination),
        traceId: input.traceId ?? options.nextTraceId?.() ?? "egress-policy"
      })
    )
    .pipe(
      Effect.asVoid,
      Effect.catch((error) => {
        if (!(error instanceof PermissionDeniedError)) {
          return Effect.fail(
            makeHostProtocolInternalError(
              `egress permission registry failure: ${error._tag}`,
              "EgressPolicy.decide"
            )
          )
        }
        const decision = permissionDeniedDecision(error._tag)
        return emitDecisionAudit(options, decision, "EgressPolicy.decide").pipe(
          Effect.andThen(Effect.fail(deniedError(decision, "EgressPolicy.decide")))
        )
      })
    )
}

const emitDecisionAudit = (
  options: EgressPolicyServiceOptions,
  decision: EgressPolicyDecisionResult,
  operation: string
): Effect.Effect<void, EgressPolicyError, never> => {
  if (options.audit === undefined) {
    return Effect.void
  }
  const kind = decision.outcome === "denied" ? "permission-denied" : "permission-used"
  return emitAuditEvent(
    options.audit,
    permissionAuditEvent({
      kind,
      source: operation,
      traceId: options.nextTraceId?.() ?? decision.decisionId,
      outcome: decision.outcome,
      normalizedCapability: P.networkConnect({
        hosts: [decision.destination.host],
        askUnknownHosts: false
      }),
      actor: permissionActor(decision.actor),
      resource: destinationResource(decision.destination),
      details: {
        actor: decision.actor,
        destination: decision.destination,
        rule: decision.rule
      }
    })
  ).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInternalError(
        `failed to write egress policy audit event: ${error.message}`,
        operation
      )
    )
  )
}

const permissionActor = (actor: EgressPolicyActor): PermissionActor =>
  new PermissionActor({
    kind:
      actor.kind === "app" || actor.kind === "window" || actor.kind === "process"
        ? actor.kind
        : "resource",
    id:
      actor.kind === "app" || actor.kind === "window" || actor.kind === "process"
        ? actor.id
        : `${actor.kind}:${actor.id}`
  })

const destinationResource = (destination: EgressPolicyDestination): string => {
  const port = destination.port === undefined ? "" : `:${destination.port}`
  const path = destination.path ?? ""
  return `${destination.protocol}://${destination.host}${port}${path}`
}

const deniedError = (
  decision: EgressPolicyDecisionResult,
  operation: string
): HostProtocolPermissionDeniedError =>
  new HostProtocolPermissionDeniedError({
    tag: "PermissionDenied",
    capability: "network.connect",
    message: `egress denied by ${decision.rule.id}: ${decision.reason}`,
    operation,
    recoverable: false
  })

const unsupportedError = (operation: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: `unsupported EgressPolicy method: ${operation}`,
    operation,
    recoverable: false
  })
