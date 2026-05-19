import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  HostProtocolPermissionDeniedError,
  HostProtocolUnsupportedError,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidStateError,
  type HostProtocolError,
  RpcGroup
} from "@effect-desktop/bridge"
import {
  type DesktopRpcClient,
  P,
  PermissionActor,
  PermissionContext,
  PermissionDeniedError,
  PermissionRegistry,
  type PermissionRegistryApi,
  type PermissionRegistryError
} from "@effect-desktop/core"
import { Clock, Context, Effect, Layer, Option, PubSub, Ref, Schema, Stream } from "effect"

import {
  SessionPermissionDecideInput,
  SessionPermissionDecision,
  SessionPermissionDecisionRecord,
  SessionPermissionEvent,
  SessionPermissionKind,
  SessionPermissionListInput,
  SessionPermissionListResult,
  SessionPermissionRequestInput,
  SessionPermissionRequestResult,
  SessionPermissionSupportedResult
} from "./contracts/session-permission.js"
import type { SessionProfileHandle } from "./contracts/session-profile.js"
import { subscribeNativeEvent } from "./event-stream.js"
import { decodeNativeInput, runNativeRpc } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"

export * from "./contracts/session-permission.js"

const Surface = "SessionPermission"
const UnsupportedReason = "host-session-permission-unavailable"
const EventMethod = "SessionPermission.Event"
const UnsupportedSupport = NativeSurface.support.unsupported(UnsupportedReason, {
  platforms: [
    { platform: "macos", status: "unsupported", reason: UnsupportedReason },
    { platform: "windows", status: "unsupported", reason: UnsupportedReason },
    { platform: "linux", status: "unsupported", reason: UnsupportedReason }
  ]
})

export type SessionPermissionError = HostProtocolError

export const SessionPermissionRequest = NativeSurface.rpc(Surface, "request", {
  payload: SessionPermissionRequestInput,
  success: SessionPermissionRequestResult,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["request"] })
  ),
  endpoint: "mutation",
  support: UnsupportedSupport
})
export const SessionPermissionDecide = NativeSurface.rpc(Surface, "decide", {
  payload: SessionPermissionDecideInput,
  success: SessionPermissionDecisionRecord,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["decide"] })
  ),
  endpoint: "mutation",
  support: UnsupportedSupport
})
export const SessionPermissionListDecisions = NativeSurface.rpc(Surface, "listDecisions", {
  payload: SessionPermissionListInput,
  success: SessionPermissionListResult,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["listDecisions"] })
  ),
  endpoint: "query",
  support: UnsupportedSupport
})
export const SessionPermissionIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: SessionPermissionSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

export const SessionPermissionRpcEvents = Object.freeze({
  Event: { payload: SessionPermissionEvent }
})

const SessionPermissionRpcGroup = RpcGroup.make(
  SessionPermissionRequest,
  SessionPermissionDecide,
  SessionPermissionListDecisions,
  SessionPermissionIsSupported
)

export const SessionPermissionRpcs: RpcGroup.RpcGroup<SessionPermissionRpc> =
  SessionPermissionRpcGroup

export const SessionPermissionMethodNames = Object.freeze([
  "request",
  "decide",
  "listDecisions",
  "isSupported"
] as const)

const SessionPermissionCapabilityMethods = Object.freeze([
  "request",
  "decide",
  "listDecisions"
] as const satisfies readonly (typeof SessionPermissionMethodNames)[number][])

export interface SessionPermissionClientApi {
  readonly request: (
    input: SessionPermissionRequestInput
  ) => Effect.Effect<SessionPermissionRequestResult, SessionPermissionError, never>
  readonly decide: (
    input: SessionPermissionDecideInput
  ) => Effect.Effect<SessionPermissionDecisionRecord, SessionPermissionError, never>
  readonly listDecisions: (
    input: SessionPermissionListInput
  ) => Effect.Effect<SessionPermissionListResult, SessionPermissionError, never>
  readonly isSupported: () => Effect.Effect<
    SessionPermissionSupportedResult,
    SessionPermissionError,
    never
  >
  readonly events: (
    profile?: SessionProfileHandle
  ) => Stream.Stream<SessionPermissionEvent, SessionPermissionError, never>
}

export class SessionPermissionClient extends Context.Service<
  SessionPermissionClient,
  SessionPermissionClientApi
>()("@effect-desktop/native/SessionPermissionClient") {}

export interface SessionPermissionServiceApi {
  readonly request: (
    profile: SessionProfileHandle,
    kind: SessionPermissionKind,
    origin: string,
    options?: { readonly requestId?: string; readonly traceId?: string }
  ) => Effect.Effect<SessionPermissionRequestResult, SessionPermissionError, never>
  readonly decide: (
    profile: SessionProfileHandle,
    requestId: string,
    kind: SessionPermissionKind,
    origin: string,
    decision: SessionPermissionDecision,
    options?: { readonly traceId?: string }
  ) => Effect.Effect<SessionPermissionDecisionRecord, SessionPermissionError, never>
  readonly listDecisions: (
    profile: SessionProfileHandle,
    options?: {
      readonly kind?: SessionPermissionKind
      readonly origin?: string
      readonly traceId?: string
    }
  ) => Effect.Effect<SessionPermissionListResult, SessionPermissionError, never>
  readonly isSupported: () => Effect.Effect<
    SessionPermissionSupportedResult,
    SessionPermissionError,
    never
  >
  readonly events: (
    profile?: SessionProfileHandle
  ) => Stream.Stream<SessionPermissionEvent, SessionPermissionError, never>
}

export interface SessionPermissionServiceOptions {
  readonly permissions: PermissionRegistryApi
}

export class SessionPermission extends Context.Service<
  SessionPermission,
  SessionPermissionServiceApi
>()("@effect-desktop/native/SessionPermission") {
  static readonly layer = Layer.effect(SessionPermission)(
    Effect.gen(function* () {
      const client = yield* SessionPermissionClient
      const permissions = yield* PermissionRegistry
      return makeSessionPermissionService(client, { permissions })
    })
  )
}

export const SessionPermissionLive = SessionPermission.layer

export const makeSessionPermissionClientLayer = (
  client: SessionPermissionClientApi
): Layer.Layer<SessionPermissionClient> => Layer.succeed(SessionPermissionClient)(client)

export const makeSessionPermissionServiceLayer = (
  client: SessionPermissionClientApi,
  options: SessionPermissionServiceOptions
): Layer.Layer<SessionPermission> =>
  Layer.succeed(SessionPermission)(makeSessionPermissionService(client, options))

export const makeSessionPermissionBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<SessionPermissionClient> =>
  SessionPermissionSurface.bridgeClientLayer(exchange, options)

export type SessionPermissionRpc = RpcGroup.Rpcs<typeof SessionPermissionRpcGroup>
export type SessionPermissionRpcHandlers = RpcGroup.HandlersFrom<SessionPermissionRpc>

export const SessionPermissionHandlersLive = SessionPermissionRpcGroup.toLayer({
  "SessionPermission.request": (input) =>
    Effect.gen(function* () {
      const permissions = yield* SessionPermission
      return yield* permissions.request(input.profile, input.kind, input.origin, {
        ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
        ...(input.traceId === undefined ? {} : { traceId: input.traceId })
      })
    }),
  "SessionPermission.decide": (input) =>
    Effect.gen(function* () {
      const permissions = yield* SessionPermission
      return yield* permissions.decide(
        input.profile,
        input.requestId,
        input.kind,
        input.origin,
        input.decision,
        input.traceId === undefined ? {} : { traceId: input.traceId }
      )
    }),
  "SessionPermission.listDecisions": (input) =>
    Effect.gen(function* () {
      const permissions = yield* SessionPermission
      return yield* permissions.listDecisions(input.profile, {
        ...(input.kind === undefined ? {} : { kind: input.kind }),
        ...(input.origin === undefined ? {} : { origin: input.origin }),
        ...(input.traceId === undefined ? {} : { traceId: input.traceId })
      })
    }),
  "SessionPermission.isSupported": () =>
    Effect.gen(function* () {
      const permissions = yield* SessionPermission
      return yield* permissions.isSupported()
    })
})

export const SessionPermissionSurface = NativeSurface.make(Surface, SessionPermissionRpcGroup, {
  service: SessionPermissionClient,
  capabilities: SessionPermissionCapabilityMethods,
  handlers: SessionPermissionHandlersLive,
  client: (client) => sessionPermissionClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => sessionPermissionClientFromRpcClient(client, exchange)
})

export const makeHostSessionPermissionRpcRuntime = (
  handlers: SessionPermissionRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> =>
  SessionPermissionSurface.hostRuntime(handlers, runtimeOptions)

export interface SessionPermissionMemoryClientOptions {
  readonly failure?: Partial<Record<"request" | "decide" | "listDecisions", SessionPermissionError>>
}

interface PendingRequest {
  readonly profile: SessionProfileHandle
  readonly requestId: string
  readonly kind: SessionPermissionKind
  readonly origin: string
}

export const makeSessionPermissionMemoryClient = (
  options: SessionPermissionMemoryClientOptions = {}
): Effect.Effect<SessionPermissionClientApi, never, never> =>
  Effect.gen(function* () {
    const clock = yield* Clock.Clock
    const pubsub = yield* PubSub.bounded<SessionPermissionEvent>({ capacity: 256, replay: 128 })
    const requests = yield* Ref.make<ReadonlyMap<string, PendingRequest>>(new Map())
    const decisions = yield* Ref.make<readonly SessionPermissionDecisionRecord[]>([])
    const nextId = yield* Ref.make(0)

    return Object.freeze({
      request: (input) =>
        validateRequestInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.request,
              Effect.gen(function* () {
                const requestId = valid.requestId ?? (yield* nextRequestId(nextId))
                const request = {
                  profile: valid.profile,
                  requestId,
                  kind: valid.kind,
                  origin: valid.origin
                } satisfies PendingRequest
                yield* Ref.update(requests, (current) => new Map(current).set(requestId, request))
                yield* publishEvent(pubsub, clock, request, "requested")
                return new SessionPermissionRequestResult({ requestId, status: "pending" })
              })
            )
          )
        ),
      decide: (input) =>
        validateDecideInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.decide,
              Effect.gen(function* () {
                const pending = yield* Ref.get(requests).pipe(
                  Effect.map((current) => current.get(valid.requestId))
                )
                if (!matchesPendingRequest(pending, valid)) {
                  return yield* Effect.fail(
                    makeHostProtocolInvalidStateError(
                      "missing-session-permission-request",
                      "decide",
                      "SessionPermission.decide"
                    )
                  )
                }
                const record = new SessionPermissionDecisionRecord({
                  profile: valid.profile,
                  requestId: valid.requestId,
                  kind: valid.kind,
                  origin: valid.origin,
                  decision: valid.decision,
                  decidedAt: clock.currentTimeMillisUnsafe()
                })
                yield* Ref.update(decisions, (current) => [...current, record])
                yield* Ref.update(requests, (current) => {
                  const next = new Map(current)
                  next.delete(valid.requestId)
                  return next
                })
                yield* publishEvent(pubsub, clock, valid, "decided")
                return record
              })
            )
          )
        ),
      listDecisions: (input) =>
        validateListInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.listDecisions,
              Ref.get(decisions).pipe(
                Effect.map(
                  (current) =>
                    new SessionPermissionListResult({
                      decisions: current.filter(
                        (record) =>
                          record.profile.id === valid.profile.id &&
                          (valid.kind === undefined || record.kind === valid.kind) &&
                          (valid.origin === undefined || record.origin === valid.origin)
                      )
                    })
                )
              )
            )
          )
        ),
      isSupported: () => Effect.succeed(new SessionPermissionSupportedResult({ supported: true })),
      events: (profile) =>
        Stream.fromPubSub(pubsub).pipe(
          Stream.filter((event) => profile === undefined || event.profile.id === profile.id)
        )
    } satisfies SessionPermissionClientApi)
  })

export const makeSessionPermissionUnsupportedClient = (): SessionPermissionClientApi =>
  Object.freeze({
    request: (input) =>
      validateRequestInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("SessionPermission.request")))
      ),
    decide: (input) =>
      validateDecideInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("SessionPermission.decide")))
      ),
    listDecisions: (input) =>
      validateListInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("SessionPermission.listDecisions")))
      ),
    isSupported: () =>
      Effect.succeed(
        new SessionPermissionSupportedResult({ supported: false, reason: UnsupportedReason })
      ),
    events: () => Stream.fail(unsupportedError(EventMethod))
  } satisfies SessionPermissionClientApi)

const makeSessionPermissionService = (
  client: SessionPermissionClientApi,
  options: SessionPermissionServiceOptions
): SessionPermissionServiceApi => {
  const service: SessionPermissionServiceApi = {
    request: (profile, kind, origin, requestOptions) =>
      validateRequestInput({
        profile,
        kind,
        origin,
        ...(requestOptions?.requestId === undefined ? {} : { requestId: requestOptions.requestId }),
        ...(requestOptions?.traceId === undefined ? {} : { traceId: requestOptions.traceId })
      }).pipe(
        Effect.flatMap((valid) =>
          authorize(options.permissions, "request", valid.profile.id, valid.traceId).pipe(
            Effect.andThen(client.request(valid))
          )
        )
      ),
    decide: (profile, requestId, kind, origin, decision, requestOptions) =>
      validateDecideInput({
        profile,
        requestId,
        kind,
        origin,
        decision,
        ...(requestOptions?.traceId === undefined ? {} : { traceId: requestOptions.traceId })
      }).pipe(
        Effect.flatMap((valid) =>
          authorize(options.permissions, "decide", valid.profile.id, valid.traceId).pipe(
            Effect.andThen(client.decide(valid))
          )
        )
      ),
    listDecisions: (profile, requestOptions) =>
      validateListInput({
        profile,
        ...(requestOptions?.kind === undefined ? {} : { kind: requestOptions.kind }),
        ...(requestOptions?.origin === undefined ? {} : { origin: requestOptions.origin }),
        ...(requestOptions?.traceId === undefined ? {} : { traceId: requestOptions.traceId })
      }).pipe(
        Effect.flatMap((valid) =>
          authorize(options.permissions, "listDecisions", valid.profile.id, valid.traceId).pipe(
            Effect.andThen(client.listDecisions(valid))
          )
        )
      ),
    isSupported: () => client.isSupported(),
    events: (profile) => client.events(profile)
  }

  return Object.freeze(service)
}

const sessionPermissionClientFromRpcClient = (
  client: DesktopRpcClient<SessionPermissionRpc>,
  exchange: BridgeClientExchange | undefined
): SessionPermissionClientApi =>
  Object.freeze({
    request: (input) =>
      validateRequestInput(input).pipe(
        Effect.flatMap((valid) =>
          runSessionPermissionRpc(
            client["SessionPermission.request"](valid),
            "SessionPermission.request"
          )
        )
      ),
    decide: (input) =>
      validateDecideInput(input).pipe(
        Effect.flatMap((valid) =>
          runSessionPermissionRpc(
            client["SessionPermission.decide"](valid),
            "SessionPermission.decide"
          )
        )
      ),
    listDecisions: (input) =>
      validateListInput(input).pipe(
        Effect.flatMap((valid) =>
          runSessionPermissionRpc(
            client["SessionPermission.listDecisions"](valid),
            "SessionPermission.listDecisions"
          )
        )
      ),
    isSupported: () =>
      runSessionPermissionRpc(
        client["SessionPermission.isSupported"](undefined),
        "SessionPermission.isSupported"
      ),
    events: (profile) =>
      subscribeNativeEvent(exchange, EventMethod, SessionPermissionEvent).pipe(
        Stream.filter((event) => profile === undefined || event.profile.id === profile.id)
      )
  } satisfies SessionPermissionClientApi)

const validateRequestInput = (input: unknown) =>
  decodeNativeInput(SessionPermissionRequestInput, input, "SessionPermission.request")
const validateDecideInput = (input: unknown) =>
  decodeNativeInput(SessionPermissionDecideInput, input, "SessionPermission.decide")
const validateListInput = (input: unknown) =>
  decodeNativeInput(SessionPermissionListInput, input, "SessionPermission.listDecisions")

const runSessionPermissionRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, SessionPermissionError, never> => runNativeRpc(effect, operation, Surface)

const authorize = (
  permissions: PermissionRegistryApi,
  method: "request" | "decide" | "listDecisions",
  resource: string,
  traceId: string | undefined
): Effect.Effect<void, SessionPermissionError, never> =>
  permissions
    .check(
      capability(method),
      new PermissionContext({
        actor: new PermissionActor({ kind: "app", id: "app" }),
        resource,
        traceId: traceId ?? `SessionPermission.${method}`
      })
    )
    .pipe(
      Effect.asVoid,
      Effect.catch((error: PermissionRegistryError) =>
        error instanceof PermissionDeniedError
          ? Effect.fail(
              permissionDeniedError(capability(method), error, `SessionPermission.${method}`)
            )
          : Effect.fail(
              makeHostProtocolInternalError(
                `session permission registry failure: ${error._tag}`,
                `SessionPermission.${method}`
              )
            )
      )
    )

const publishEvent = (
  pubsub: PubSub.PubSub<SessionPermissionEvent>,
  clock: Clock.Clock,
  input: PendingRequest | SessionPermissionDecideInput,
  phase: "requested" | "decided"
): Effect.Effect<void, never, never> =>
  PubSub.publish(
    pubsub,
    new SessionPermissionEvent({
      type: "session-permission-event",
      timestamp: clock.currentTimeMillisUnsafe(),
      phase,
      profile: input.profile,
      requestId: input.requestId,
      kind: input.kind,
      origin: input.origin,
      ...("decision" in input ? { decision: input.decision } : {})
    })
  ).pipe(Effect.asVoid)

const nextRequestId = (ref: Ref.Ref<number>): Effect.Effect<string, never, never> =>
  Ref.modify(ref, (current) => [`session-permission:${current + 1}`, current + 1])

const matchesPendingRequest = (
  pending: PendingRequest | undefined,
  input: SessionPermissionDecideInput
): pending is PendingRequest =>
  pending !== undefined &&
  pending.profile.id === input.profile.id &&
  pending.kind === input.kind &&
  pending.origin === input.origin

const capability = (method: "request" | "decide" | "listDecisions") =>
  P.nativeInvoke({ primitive: Surface, methods: [method] })

const permissionDeniedError = (
  cap: ReturnType<typeof capability>,
  error: PermissionDeniedError,
  operation: string
): HostProtocolPermissionDeniedError =>
  new HostProtocolPermissionDeniedError({
    tag: "PermissionDenied",
    capability: JSON.stringify(cap),
    ...(Option.isNone(error.resource) ? {} : { resource: error.resource.value }),
    message: error.message,
    operation,
    recoverable: false
  })

const unsupportedError = (operation: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: UnsupportedReason,
    operation,
    recoverable: false
  })

const failOr = <A>(
  failure: SessionPermissionError | undefined,
  effect: Effect.Effect<A, SessionPermissionError, never>
): Effect.Effect<A, SessionPermissionError, never> =>
  failure === undefined ? effect : Effect.fail(failure)
