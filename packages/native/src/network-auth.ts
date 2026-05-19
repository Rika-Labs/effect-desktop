import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  HostProtocolPermissionDeniedError,
  HostProtocolUnsupportedError,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
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
  NetworkAuthCertificateInput,
  NetworkAuthDecision,
  NetworkAuthDecisionRecord,
  NetworkAuthEvent,
  NetworkAuthHttpAuthInput,
  NetworkAuthProxyMode,
  NetworkAuthProxyResult,
  NetworkAuthSetProxyInput,
  NetworkAuthSupportedResult
} from "./contracts/network-auth.js"
import type { SessionProfileHandle } from "./contracts/session-profile.js"
import { subscribeNativeEvent } from "./event-stream.js"
import { decodeNativeInput, runNativeRpc } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"

export * from "./contracts/network-auth.js"

const Surface = "NetworkAuth"
const UnsupportedReason = "host-network-auth-unavailable"
const EventMethod = "NetworkAuth.Event"
const UnsupportedSupport = NativeSurface.support.unsupported(UnsupportedReason, {
  platforms: [
    { platform: "macos", status: "unsupported", reason: UnsupportedReason },
    { platform: "windows", status: "unsupported", reason: UnsupportedReason },
    { platform: "linux", status: "unsupported", reason: UnsupportedReason }
  ]
})

export type NetworkAuthError = HostProtocolError

export const NetworkAuthSetProxy = NativeSurface.rpc(Surface, "setProxy", {
  payload: NetworkAuthSetProxyInput,
  success: NetworkAuthProxyResult,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["setProxy"] })
  ),
  endpoint: "mutation",
  support: UnsupportedSupport
})
export const NetworkAuthHandleAuth = NativeSurface.rpc(Surface, "handleAuth", {
  payload: NetworkAuthHttpAuthInput,
  success: NetworkAuthDecisionRecord,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["handleAuth"] })
  ),
  endpoint: "mutation",
  support: UnsupportedSupport
})
export const NetworkAuthHandleCertificate = NativeSurface.rpc(Surface, "handleCertificate", {
  payload: NetworkAuthCertificateInput,
  success: NetworkAuthDecisionRecord,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["handleCertificate"] })
  ),
  endpoint: "mutation",
  support: UnsupportedSupport
})
export const NetworkAuthIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: NetworkAuthSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

export const NetworkAuthRpcEvents = Object.freeze({
  Event: { payload: NetworkAuthEvent }
})

const NetworkAuthRpcGroup = RpcGroup.make(
  NetworkAuthSetProxy,
  NetworkAuthHandleAuth,
  NetworkAuthHandleCertificate,
  NetworkAuthIsSupported
)

export const NetworkAuthRpcs: RpcGroup.RpcGroup<NetworkAuthRpc> = NetworkAuthRpcGroup

export const NetworkAuthMethodNames = Object.freeze([
  "setProxy",
  "handleAuth",
  "handleCertificate",
  "isSupported"
] as const)

const NetworkAuthCapabilityMethods = Object.freeze([
  "setProxy",
  "handleAuth",
  "handleCertificate"
] as const satisfies readonly (typeof NetworkAuthMethodNames)[number][])

export interface NetworkAuthClientApi {
  readonly setProxy: (
    input: NetworkAuthSetProxyInput
  ) => Effect.Effect<NetworkAuthProxyResult, NetworkAuthError, never>
  readonly handleAuth: (
    input: NetworkAuthHttpAuthInput
  ) => Effect.Effect<NetworkAuthDecisionRecord, NetworkAuthError, never>
  readonly handleCertificate: (
    input: NetworkAuthCertificateInput
  ) => Effect.Effect<NetworkAuthDecisionRecord, NetworkAuthError, never>
  readonly isSupported: () => Effect.Effect<NetworkAuthSupportedResult, NetworkAuthError, never>
  readonly events: (
    profile?: SessionProfileHandle
  ) => Stream.Stream<NetworkAuthEvent, NetworkAuthError, never>
}

export class NetworkAuthClient extends Context.Service<NetworkAuthClient, NetworkAuthClientApi>()(
  "@effect-desktop/native/NetworkAuthClient"
) {}

export interface NetworkAuthServiceApi {
  readonly setProxy: (
    profile: SessionProfileHandle,
    mode: NetworkAuthProxyMode,
    options?: {
      readonly server?: string
      readonly bypass?: readonly string[]
      readonly traceId?: string
    }
  ) => Effect.Effect<NetworkAuthProxyResult, NetworkAuthError, never>
  readonly handleAuth: (
    profile: SessionProfileHandle,
    requestId: string,
    origin: string,
    decision: NetworkAuthDecision,
    options?: {
      readonly realm?: string
      readonly username?: string
      readonly password?: string
      readonly traceId?: string
    }
  ) => Effect.Effect<NetworkAuthDecisionRecord, NetworkAuthError, never>
  readonly handleCertificate: (
    profile: SessionProfileHandle,
    requestId: string,
    origin: string,
    fingerprintSha256: string,
    decision: NetworkAuthDecision,
    options?: { readonly traceId?: string }
  ) => Effect.Effect<NetworkAuthDecisionRecord, NetworkAuthError, never>
  readonly isSupported: () => Effect.Effect<NetworkAuthSupportedResult, NetworkAuthError, never>
  readonly events: (
    profile?: SessionProfileHandle
  ) => Stream.Stream<NetworkAuthEvent, NetworkAuthError, never>
}

export interface NetworkAuthServiceOptions {
  readonly permissions: PermissionRegistryApi
}

export class NetworkAuth extends Context.Service<NetworkAuth, NetworkAuthServiceApi>()(
  "@effect-desktop/native/NetworkAuth"
) {
  static readonly layer = Layer.effect(NetworkAuth)(
    Effect.gen(function* () {
      const client = yield* NetworkAuthClient
      const permissions = yield* PermissionRegistry
      return makeNetworkAuthService(client, { permissions })
    })
  )
}

export const NetworkAuthLive = NetworkAuth.layer

export const makeNetworkAuthClientLayer = (
  client: NetworkAuthClientApi
): Layer.Layer<NetworkAuthClient> => Layer.succeed(NetworkAuthClient)(client)

export const makeNetworkAuthServiceLayer = (
  client: NetworkAuthClientApi,
  options: NetworkAuthServiceOptions
): Layer.Layer<NetworkAuth> => Layer.succeed(NetworkAuth)(makeNetworkAuthService(client, options))

export const makeNetworkAuthBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<NetworkAuthClient> => NetworkAuthSurface.bridgeClientLayer(exchange, options)

export type NetworkAuthRpc = RpcGroup.Rpcs<typeof NetworkAuthRpcGroup>
export type NetworkAuthRpcHandlers = RpcGroup.HandlersFrom<NetworkAuthRpc>

export const NetworkAuthHandlersLive = NetworkAuthRpcGroup.toLayer({
  "NetworkAuth.setProxy": (input) =>
    Effect.gen(function* () {
      const networkAuth = yield* NetworkAuth
      return yield* networkAuth.setProxy(input.profile, input.mode, {
        ...(input.server === undefined ? {} : { server: input.server }),
        ...(input.bypass === undefined ? {} : { bypass: input.bypass }),
        ...(input.traceId === undefined ? {} : { traceId: input.traceId })
      })
    }),
  "NetworkAuth.handleAuth": (input) =>
    Effect.gen(function* () {
      const networkAuth = yield* NetworkAuth
      return yield* networkAuth.handleAuth(
        input.profile,
        input.requestId,
        input.origin,
        input.decision,
        {
          ...(input.realm === undefined ? {} : { realm: input.realm }),
          ...(input.username === undefined ? {} : { username: input.username }),
          ...(input.password === undefined ? {} : { password: input.password }),
          ...(input.traceId === undefined ? {} : { traceId: input.traceId })
        }
      )
    }),
  "NetworkAuth.handleCertificate": (input) =>
    Effect.gen(function* () {
      const networkAuth = yield* NetworkAuth
      return yield* networkAuth.handleCertificate(
        input.profile,
        input.requestId,
        input.origin,
        input.fingerprintSha256,
        input.decision,
        input.traceId === undefined ? {} : { traceId: input.traceId }
      )
    }),
  "NetworkAuth.isSupported": () =>
    Effect.gen(function* () {
      const networkAuth = yield* NetworkAuth
      return yield* networkAuth.isSupported()
    })
})

export const NetworkAuthSurface = NativeSurface.make(Surface, NetworkAuthRpcGroup, {
  service: NetworkAuthClient,
  capabilities: NetworkAuthCapabilityMethods,
  handlers: NetworkAuthHandlersLive,
  client: (client) => networkAuthClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => networkAuthClientFromRpcClient(client, exchange)
})

export const makeHostNetworkAuthRpcRuntime = (
  handlers: NetworkAuthRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> =>
  NetworkAuthSurface.hostRuntime(handlers, runtimeOptions)

export interface NetworkAuthMemoryClientOptions {
  readonly failure?: Partial<
    Record<"setProxy" | "handleAuth" | "handleCertificate", NetworkAuthError>
  >
}

export const makeNetworkAuthMemoryClient = (
  options: NetworkAuthMemoryClientOptions = {}
): Effect.Effect<NetworkAuthClientApi, never, never> =>
  Effect.gen(function* () {
    const clock = yield* Clock.Clock
    const pubsub = yield* PubSub.bounded<NetworkAuthEvent>({ capacity: 256, replay: 128 })
    const proxyByProfile = yield* Ref.make<ReadonlyMap<string, NetworkAuthProxyResult>>(new Map())
    const decisions = yield* Ref.make<readonly NetworkAuthDecisionRecord[]>([])

    return Object.freeze({
      setProxy: (input) =>
        validateSetProxyInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.setProxy,
              Effect.gen(function* () {
                const result = new NetworkAuthProxyResult({
                  profile: valid.profile,
                  mode: valid.mode,
                  ...(valid.server === undefined ? {} : { server: valid.server }),
                  bypass: [...(valid.bypass ?? [])]
                })
                yield* Ref.update(proxyByProfile, (current) =>
                  new Map(current).set(valid.profile.id, result)
                )
                yield* publishEvent(pubsub, clock, {
                  phase: "proxy-updated",
                  profile: valid.profile
                })
                return result
              })
            )
          )
        ),
      handleAuth: (input) =>
        validateHttpAuthInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.handleAuth,
              Effect.gen(function* () {
                const record = decisionRecord(
                  clock,
                  valid.profile,
                  valid.requestId,
                  valid.origin,
                  "http-auth",
                  valid.decision
                )
                yield* Ref.update(decisions, (current) => [...current, record])
                yield* publishEvent(pubsub, clock, {
                  phase: "auth-decided",
                  profile: valid.profile,
                  requestId: valid.requestId,
                  origin: valid.origin,
                  decision: valid.decision
                })
                return record
              })
            )
          )
        ),
      handleCertificate: (input) =>
        validateCertificateInput(input).pipe(
          Effect.flatMap((valid) =>
            valid.decision === "deny"
              ? Effect.fail(certificateDeniedError(valid.fingerprintSha256))
              : failOr(
                  options.failure?.handleCertificate,
                  Effect.gen(function* () {
                    const record = decisionRecord(
                      clock,
                      valid.profile,
                      valid.requestId,
                      valid.origin,
                      "certificate",
                      valid.decision
                    )
                    yield* Ref.update(decisions, (current) => [...current, record])
                    yield* publishEvent(pubsub, clock, {
                      phase: "certificate-decided",
                      profile: valid.profile,
                      requestId: valid.requestId,
                      origin: valid.origin,
                      decision: valid.decision
                    })
                    return record
                  })
                )
          )
        ),
      isSupported: () => Effect.succeed(new NetworkAuthSupportedResult({ supported: true })),
      events: (profile) =>
        Stream.fromPubSub(pubsub).pipe(
          Stream.filter((event) => profile === undefined || event.profile.id === profile.id)
        )
    } satisfies NetworkAuthClientApi)
  })

export const makeNetworkAuthUnsupportedClient = (): NetworkAuthClientApi =>
  Object.freeze({
    setProxy: (input) =>
      validateSetProxyInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("NetworkAuth.setProxy")))
      ),
    handleAuth: (input) =>
      validateHttpAuthInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("NetworkAuth.handleAuth")))
      ),
    handleCertificate: (input) =>
      validateCertificateInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("NetworkAuth.handleCertificate")))
      ),
    isSupported: () =>
      Effect.succeed(
        new NetworkAuthSupportedResult({ supported: false, reason: UnsupportedReason })
      ),
    events: () => Stream.fail(unsupportedError(EventMethod))
  } satisfies NetworkAuthClientApi)

const makeNetworkAuthService = (
  client: NetworkAuthClientApi,
  options: NetworkAuthServiceOptions
): NetworkAuthServiceApi => {
  const service: NetworkAuthServiceApi = {
    setProxy: (profile, mode, requestOptions) =>
      validateSetProxyInput({
        profile,
        mode,
        ...(requestOptions?.server === undefined ? {} : { server: requestOptions.server }),
        ...(requestOptions?.bypass === undefined ? {} : { bypass: requestOptions.bypass }),
        ...(requestOptions?.traceId === undefined ? {} : { traceId: requestOptions.traceId })
      }).pipe(
        Effect.flatMap((valid) =>
          authorize(options.permissions, "setProxy", valid.profile.id, valid.traceId).pipe(
            Effect.andThen(client.setProxy(valid))
          )
        )
      ),
    handleAuth: (profile, requestId, origin, decision, requestOptions) =>
      validateHttpAuthInput({
        profile,
        requestId,
        origin,
        decision,
        ...(requestOptions?.realm === undefined ? {} : { realm: requestOptions.realm }),
        ...(requestOptions?.username === undefined ? {} : { username: requestOptions.username }),
        ...(requestOptions?.password === undefined ? {} : { password: requestOptions.password }),
        ...(requestOptions?.traceId === undefined ? {} : { traceId: requestOptions.traceId })
      }).pipe(
        Effect.flatMap((valid) =>
          authorize(options.permissions, "handleAuth", valid.profile.id, valid.traceId).pipe(
            Effect.andThen(client.handleAuth(valid))
          )
        )
      ),
    handleCertificate: (profile, requestId, origin, fingerprintSha256, decision, requestOptions) =>
      validateCertificateInput({
        profile,
        requestId,
        origin,
        fingerprintSha256,
        decision,
        ...(requestOptions?.traceId === undefined ? {} : { traceId: requestOptions.traceId })
      }).pipe(
        Effect.flatMap((valid) =>
          authorize(options.permissions, "handleCertificate", valid.profile.id, valid.traceId).pipe(
            Effect.andThen(client.handleCertificate(valid))
          )
        )
      ),
    isSupported: () => client.isSupported(),
    events: (profile) => client.events(profile)
  }

  return Object.freeze(service)
}

const networkAuthClientFromRpcClient = (
  client: DesktopRpcClient<NetworkAuthRpc>,
  exchange: BridgeClientExchange | undefined
): NetworkAuthClientApi =>
  Object.freeze({
    setProxy: (input) =>
      validateSetProxyInput(input).pipe(
        Effect.flatMap((valid) =>
          runNetworkAuthRpc(client["NetworkAuth.setProxy"](valid), "NetworkAuth.setProxy")
        )
      ),
    handleAuth: (input) =>
      validateHttpAuthInput(input).pipe(
        Effect.flatMap((valid) =>
          runNetworkAuthRpc(client["NetworkAuth.handleAuth"](valid), "NetworkAuth.handleAuth")
        )
      ),
    handleCertificate: (input) =>
      validateCertificateInput(input).pipe(
        Effect.flatMap((valid) =>
          runNetworkAuthRpc(
            client["NetworkAuth.handleCertificate"](valid),
            "NetworkAuth.handleCertificate"
          )
        )
      ),
    isSupported: () =>
      runNetworkAuthRpc(client["NetworkAuth.isSupported"](undefined), "NetworkAuth.isSupported"),
    events: (profile) =>
      subscribeNativeEvent(exchange, EventMethod, NetworkAuthEvent).pipe(
        Stream.filter((event) => profile === undefined || event.profile.id === profile.id)
      )
  } satisfies NetworkAuthClientApi)

const validateSetProxyInput = (input: unknown) =>
  decodeNativeInput(NetworkAuthSetProxyInput, input, "NetworkAuth.setProxy").pipe(
    Effect.flatMap(validateProxyShape)
  )
const validateHttpAuthInput = (input: unknown) =>
  decodeNativeInput(NetworkAuthHttpAuthInput, input, "NetworkAuth.handleAuth").pipe(
    Effect.flatMap(validateAuthShape)
  )
const validateCertificateInput = (input: unknown) =>
  decodeNativeInput(NetworkAuthCertificateInput, input, "NetworkAuth.handleCertificate")

const runNetworkAuthRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, NetworkAuthError, never> => runNativeRpc(effect, operation, Surface)

const validateProxyShape = (
  input: NetworkAuthSetProxyInput
): Effect.Effect<NetworkAuthSetProxyInput, NetworkAuthError, never> =>
  input.mode === "fixed" && input.server === undefined
    ? Effect.fail(
        makeHostProtocolInvalidArgumentError(
          "server",
          "is required for fixed proxy",
          "NetworkAuth.setProxy"
        )
      )
    : input.mode !== "fixed" && input.server !== undefined
      ? Effect.fail(
          makeHostProtocolInvalidArgumentError(
            "server",
            "is only valid for fixed proxy",
            "NetworkAuth.setProxy"
          )
        )
      : Effect.succeed(input)

const validateAuthShape = (
  input: NetworkAuthHttpAuthInput
): Effect.Effect<NetworkAuthHttpAuthInput, NetworkAuthError, never> =>
  input.decision === "allow" && (input.username === undefined || input.password === undefined)
    ? Effect.fail(
        makeHostProtocolInvalidArgumentError(
          "credentials",
          "are required when allowing HTTP auth",
          "NetworkAuth.handleAuth"
        )
      )
    : input.decision === "deny" && (input.username !== undefined || input.password !== undefined)
      ? Effect.fail(
          makeHostProtocolInvalidArgumentError(
            "credentials",
            "must be omitted when denying HTTP auth",
            "NetworkAuth.handleAuth"
          )
        )
      : Effect.succeed(input)

const authorize = (
  permissions: PermissionRegistryApi,
  method: "setProxy" | "handleAuth" | "handleCertificate",
  resource: string,
  traceId: string | undefined
): Effect.Effect<void, NetworkAuthError, never> =>
  permissions
    .check(
      capability(method),
      new PermissionContext({
        actor: new PermissionActor({ kind: "app", id: "app" }),
        resource,
        traceId: traceId ?? `NetworkAuth.${method}`
      })
    )
    .pipe(
      Effect.asVoid,
      Effect.catch((error: PermissionRegistryError) =>
        error instanceof PermissionDeniedError
          ? Effect.fail(permissionDeniedError(capability(method), error, `NetworkAuth.${method}`))
          : Effect.fail(
              makeHostProtocolInternalError(
                `network auth permission registry failure: ${error._tag}`,
                `NetworkAuth.${method}`
              )
            )
      )
    )

const decisionRecord = (
  clock: Clock.Clock,
  profile: SessionProfileHandle,
  requestId: string,
  origin: string,
  kind: "http-auth" | "certificate",
  decision: NetworkAuthDecision
): NetworkAuthDecisionRecord =>
  new NetworkAuthDecisionRecord({
    profile,
    requestId,
    origin,
    kind,
    decision,
    decidedAt: clock.currentTimeMillisUnsafe()
  })

const publishEvent = (
  pubsub: PubSub.PubSub<NetworkAuthEvent>,
  clock: Clock.Clock,
  input: {
    readonly phase: "proxy-updated" | "auth-decided" | "certificate-decided"
    readonly profile: SessionProfileHandle
    readonly requestId?: string
    readonly origin?: string
    readonly decision?: NetworkAuthDecision
  }
): Effect.Effect<void, never, never> =>
  PubSub.publish(
    pubsub,
    new NetworkAuthEvent({
      type: "network-auth-event",
      timestamp: clock.currentTimeMillisUnsafe(),
      phase: input.phase,
      profile: input.profile,
      ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
      ...(input.origin === undefined ? {} : { origin: input.origin }),
      ...(input.decision === undefined ? {} : { decision: input.decision })
    })
  ).pipe(Effect.asVoid)

const capability = (method: "setProxy" | "handleAuth" | "handleCertificate") =>
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

const certificateDeniedError = (fingerprint: string): HostProtocolPermissionDeniedError =>
  new HostProtocolPermissionDeniedError({
    tag: "PermissionDenied",
    capability: JSON.stringify(capability("handleCertificate")),
    resource: fingerprint,
    message: "certificate decision denied",
    operation: "NetworkAuth.handleCertificate",
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
  failure: NetworkAuthError | undefined,
  effect: Effect.Effect<A, NetworkAuthError, never>
): Effect.Effect<A, NetworkAuthError, never> =>
  failure === undefined ? effect : Effect.fail(failure)
