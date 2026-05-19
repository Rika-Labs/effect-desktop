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
  type RpcCapabilityMetadata,
  RpcGroup
} from "@effect-desktop/bridge"
import {
  type AuditEventsApi,
  type DesktopRpcClient,
  emitAuditEvent,
  type NormalizedCapability,
  P,
  PermissionActor,
  PermissionContext,
  PermissionDeniedError,
  PermissionRegistry,
  type PermissionRegistryApi,
  type PermissionRegistryError,
  permissionAuditEvent
} from "@effect-desktop/core"
import { Clock, Context, Effect, Layer, PubSub, Ref, Schema, Stream } from "effect"

import { decodeNativeInput, runNativeRpc } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"
import {
  ScopedAccessGrantActor,
  ScopedAccessGrantEvent,
  ScopedAccessGrantGrantInput,
  ScopedAccessGrantGrantRequest,
  ScopedAccessGrantGrantResult,
  ScopedAccessGrantResolveInput,
  ScopedAccessGrantResolveRequest,
  ScopedAccessGrantResolveResult,
  ScopedAccessGrantRevokeInput,
  ScopedAccessGrantRevokeRequest,
  ScopedAccessGrantRevokeResult,
  ScopedAccessGrantScope,
  ScopedAccessGrantSupportedResult
} from "./contracts/scoped-access-grant.js"

export * from "./contracts/scoped-access-grant.js"

const Surface = "ScopedAccessGrant"
const UnsupportedReason = "host-adapter-unimplemented"
const ScopedAccessGrantEventMethod = "ScopedAccessGrant.Event"
const UnsupportedSupport = NativeSurface.support.unsupported(UnsupportedReason, {
  platforms: [
    { platform: "macos", status: "unsupported", reason: UnsupportedReason },
    { platform: "windows", status: "unsupported", reason: UnsupportedReason },
    { platform: "linux", status: "unsupported", reason: UnsupportedReason }
  ]
})

export type ScopedAccessGrantError = HostProtocolError

export const ScopedAccessGrantGrant = scopedAccessGrantRpc(
  "grant",
  ScopedAccessGrantGrantInput,
  ScopedAccessGrantGrantResult,
  P.nativeInvoke({ primitive: Surface, methods: ["grant"] })
)
export const ScopedAccessGrantResolve = scopedAccessGrantRpc(
  "resolve",
  ScopedAccessGrantResolveInput,
  ScopedAccessGrantResolveResult,
  P.nativeInvoke({ primitive: Surface, methods: ["resolve"] })
)
export const ScopedAccessGrantRevoke = scopedAccessGrantRpc(
  "revoke",
  ScopedAccessGrantRevokeInput,
  ScopedAccessGrantRevokeResult,
  P.nativeInvoke({ primitive: Surface, methods: ["revoke"] })
)
export const ScopedAccessGrantIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: ScopedAccessGrantSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

export const ScopedAccessGrantRpcEvents = Object.freeze({
  Event: { payload: ScopedAccessGrantEvent }
})

const ScopedAccessGrantRpcGroup = RpcGroup.make(
  ScopedAccessGrantGrant,
  ScopedAccessGrantResolve,
  ScopedAccessGrantRevoke,
  ScopedAccessGrantIsSupported
)

export const ScopedAccessGrantRpcs: RpcGroup.RpcGroup<ScopedAccessGrantRpc> =
  ScopedAccessGrantRpcGroup

export const ScopedAccessGrantMethodNames = Object.freeze([
  "grant",
  "resolve",
  "revoke",
  "isSupported"
] as const)

const ScopedAccessGrantCapabilityMethods = Object.freeze([
  "grant",
  "resolve",
  "revoke"
] as const satisfies readonly (typeof ScopedAccessGrantMethodNames)[number][])

export interface ScopedAccessGrantClientApi {
  readonly grant: (
    input: ScopedAccessGrantGrantInput
  ) => Effect.Effect<ScopedAccessGrantGrantResult, ScopedAccessGrantError, never>
  readonly resolve: (
    input: ScopedAccessGrantResolveInput
  ) => Effect.Effect<ScopedAccessGrantResolveResult, ScopedAccessGrantError, never>
  readonly revoke: (
    input: ScopedAccessGrantRevokeInput
  ) => Effect.Effect<ScopedAccessGrantRevokeResult, ScopedAccessGrantError, never>
  readonly isSupported: () => Effect.Effect<
    ScopedAccessGrantSupportedResult,
    ScopedAccessGrantError,
    never
  >
  readonly events: () => Stream.Stream<ScopedAccessGrantEvent, ScopedAccessGrantError, never>
}

export class ScopedAccessGrantClient extends Context.Service<
  ScopedAccessGrantClient,
  ScopedAccessGrantClientApi
>()("@effect-desktop/native/ScopedAccessGrantClient") {}

export interface ScopedAccessGrantServiceApi {
  readonly grant: (
    input: ScopedAccessGrantGrantRequest
  ) => Effect.Effect<ScopedAccessGrantGrantResult, ScopedAccessGrantError, never>
  readonly resolve: (
    input: ScopedAccessGrantResolveRequest
  ) => Effect.Effect<ScopedAccessGrantResolveResult, ScopedAccessGrantError, never>
  readonly revoke: (
    input: ScopedAccessGrantRevokeRequest
  ) => Effect.Effect<ScopedAccessGrantRevokeResult, ScopedAccessGrantError, never>
  readonly isSupported: () => Effect.Effect<
    ScopedAccessGrantSupportedResult,
    ScopedAccessGrantError,
    never
  >
  readonly events: () => Stream.Stream<ScopedAccessGrantEvent, ScopedAccessGrantError, never>
}

export interface ScopedAccessGrantServiceOptions {
  readonly permissions: PermissionRegistryApi
  readonly audit?: AuditEventsApi
  readonly nextGrantId?: () => string
  readonly nextTraceId?: () => string
}

export class ScopedAccessGrant extends Context.Service<
  ScopedAccessGrant,
  ScopedAccessGrantServiceApi
>()("@effect-desktop/native/ScopedAccessGrant") {
  static readonly layer = Layer.effect(ScopedAccessGrant)(
    Effect.gen(function* () {
      const client = yield* ScopedAccessGrantClient
      const permissions = yield* PermissionRegistry
      return yield* makeScopedAccessGrantService(client, { permissions })
    })
  )
}

export const ScopedAccessGrantLive = ScopedAccessGrant.layer

export const makeScopedAccessGrantClientLayer = (
  client: ScopedAccessGrantClientApi
): Layer.Layer<ScopedAccessGrantClient> => Layer.succeed(ScopedAccessGrantClient)(client)

export const makeScopedAccessGrantServiceLayer = (
  client: ScopedAccessGrantClientApi,
  options: ScopedAccessGrantServiceOptions
): Layer.Layer<ScopedAccessGrant> =>
  Layer.effect(ScopedAccessGrant)(makeScopedAccessGrantService(client, options))

export const makeScopedAccessGrantBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<ScopedAccessGrantClient> =>
  ScopedAccessGrantSurface.bridgeClientLayer(exchange, options)

export type ScopedAccessGrantRpc = RpcGroup.Rpcs<typeof ScopedAccessGrantRpcGroup>

export type ScopedAccessGrantRpcHandlers = RpcGroup.HandlersFrom<ScopedAccessGrantRpc>

export const ScopedAccessGrantHandlersLive = ScopedAccessGrantRpcGroup.toLayer({
  "ScopedAccessGrant.grant": (input) =>
    Effect.gen(function* () {
      const service = yield* ScopedAccessGrant
      return yield* service.grant(input)
    }),
  "ScopedAccessGrant.resolve": (input) =>
    Effect.gen(function* () {
      const service = yield* ScopedAccessGrant
      return yield* service.resolve(input)
    }),
  "ScopedAccessGrant.revoke": (input) =>
    Effect.gen(function* () {
      const service = yield* ScopedAccessGrant
      return yield* service.revoke(input)
    }),
  "ScopedAccessGrant.isSupported": () =>
    Effect.gen(function* () {
      const service = yield* ScopedAccessGrant
      return yield* service.isSupported()
    })
})

export const ScopedAccessGrantSurface = NativeSurface.make(Surface, ScopedAccessGrantRpcGroup, {
  service: ScopedAccessGrantClient,
  capabilities: ScopedAccessGrantCapabilityMethods,
  handlers: ScopedAccessGrantHandlersLive,
  client: (client) => scopedAccessGrantClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => scopedAccessGrantClientFromRpcClient(client, exchange)
})

export const makeHostScopedAccessGrantRpcRuntime = (
  handlers: ScopedAccessGrantRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> =>
  ScopedAccessGrantSurface.hostRuntime(handlers, runtimeOptions)

export interface ScopedAccessGrantMemoryClientOptions {
  readonly failure?: Partial<Record<"grant" | "resolve" | "revoke", ScopedAccessGrantError>>
  readonly nextGrantId?: () => string
}

interface GrantState {
  readonly actor: ScopedAccessGrantActor
  readonly scope: ScopedAccessGrantScope
}

export const makeScopedAccessGrantMemoryClient = (
  options: ScopedAccessGrantMemoryClientOptions = {}
): Effect.Effect<ScopedAccessGrantClientApi, never, never> =>
  Effect.gen(function* () {
    const grants = yield* Ref.make<ReadonlyMap<string, GrantState>>(new Map())
    const pubsub = yield* PubSub.bounded<ScopedAccessGrantEvent>({ capacity: 256, replay: 64 })
    const nextGrantId = yield* makeIdGenerator(options.nextGrantId, "scoped-access-grant")

    return Object.freeze({
      grant: (input) =>
        validateGrantInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.grant,
              Effect.gen(function* () {
                const grantId = valid.grantId ?? (yield* nextGrantId())
                const scope = normalizeScope(valid.scope)
                yield* Ref.update(grants, (current) =>
                  new Map(current).set(grantId, { actor: valid.actor, scope })
                )
                yield* publishEvent(pubsub, grantId, "granted", scope.path)
                return new ScopedAccessGrantGrantResult({ grantId, scope, state: "granted" })
              })
            )
          )
        ),
      resolve: (input) =>
        validateResolveInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.resolve,
              Effect.gen(function* () {
                const state = (yield* Ref.get(grants)).get(valid.grantId)
                if (state === undefined) {
                  return yield* invalid(
                    "grantId",
                    "must reference an active scoped access grant",
                    "ScopedAccessGrant.resolve"
                  )
                }
                yield* publishEvent(pubsub, valid.grantId, "resolved", state.scope.path)
                return new ScopedAccessGrantResolveResult({
                  grantId: valid.grantId,
                  scope: state.scope,
                  state: "resolved",
                  revalidated: true
                })
              })
            )
          )
        ),
      revoke: (input) =>
        validateRevokeInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.revoke,
              Effect.gen(function* () {
                const removed = yield* Ref.modify(grants, (current) => {
                  const next = new Map(current)
                  const existed = next.delete(valid.grantId)
                  return [existed, next] as const
                })
                yield* publishEvent(pubsub, valid.grantId, "revoked")
                return new ScopedAccessGrantRevokeResult({
                  grantId: valid.grantId,
                  revoked: removed
                })
              })
            )
          )
        ),
      isSupported: () => Effect.succeed(new ScopedAccessGrantSupportedResult({ supported: true })),
      events: () => Stream.fromPubSub(pubsub)
    } satisfies ScopedAccessGrantClientApi)
  })

export const makeScopedAccessGrantUnsupportedClient = (): ScopedAccessGrantClientApi =>
  Object.freeze({
    grant: (input) =>
      validateGrantInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("ScopedAccessGrant.grant")))
      ),
    resolve: (input) =>
      validateResolveInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("ScopedAccessGrant.resolve")))
      ),
    revoke: (input) =>
      validateRevokeInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("ScopedAccessGrant.revoke")))
      ),
    isSupported: () =>
      Effect.succeed(
        new ScopedAccessGrantSupportedResult({ supported: false, reason: UnsupportedReason })
      ),
    events: () => Stream.fail(unsupportedError("ScopedAccessGrant.events"))
  } satisfies ScopedAccessGrantClientApi)

const makeScopedAccessGrantService = (
  client: ScopedAccessGrantClientApi,
  options: ScopedAccessGrantServiceOptions
): Effect.Effect<ScopedAccessGrantServiceApi, never, never> =>
  Effect.gen(function* () {
    const grants = yield* Ref.make<ReadonlyMap<string, GrantState>>(new Map())
    const nextGrantId = yield* makeIdGenerator(options.nextGrantId, "scoped-access-grant")

    return Object.freeze({
      grant: (input) =>
        Effect.gen(function* () {
          const request = yield* validateGrantRequest(input)
          const grantId = request.grantId ?? (yield* nextGrantId())
          const scope = normalizeScope(request.scope)
          yield* authorizeGrant(options, request.actor, scope, request.traceId)
          const result = yield* client.grant(
            new ScopedAccessGrantGrantInput({
              actor: request.actor,
              scope,
              grantId,
              ...(request.traceId === undefined ? {} : { traceId: request.traceId })
            })
          )
          yield* Ref.update(grants, (current) =>
            new Map(current).set(result.grantId, { actor: request.actor, scope: result.scope })
          )
          yield* emitGrantAudit(
            options,
            "permission-used",
            filesystemCapability(scope),
            request.actor,
            scope.path,
            request.traceId ?? grantId,
            "ScopedAccessGrant.grant"
          )
          return result
        }),
      resolve: (input) =>
        Effect.gen(function* () {
          const request = yield* validateResolveRequest(input)
          const actor = new ScopedAccessGrantActor({ kind: "native", id: "host-revalidated" })
          yield* checkPermission(
            options,
            P.nativeInvoke({ primitive: Surface, methods: ["resolve"] }),
            actor,
            `grant:${request.grantId}:resolve`,
            request.grantId,
            "ScopedAccessGrant.resolve",
            request.traceId
          )
          const result = yield* client.resolve(
            new ScopedAccessGrantResolveInput({
              grantId: request.grantId,
              ...(request.traceId === undefined ? {} : { traceId: request.traceId })
            })
          )
          if (!result.revalidated) {
            return yield* Effect.fail(
              makeHostProtocolInternalError(
                "scoped access grant host returned an unvalidated persistent grant",
                "ScopedAccessGrant.resolve"
              )
            )
          }
          yield* Ref.update(grants, (current) =>
            new Map(current).set(request.grantId, { actor, scope: result.scope })
          )
          yield* emitGrantAudit(
            options,
            "permission-used",
            P.nativeInvoke({ primitive: Surface, methods: ["resolve"] }),
            actor,
            request.grantId,
            request.traceId ?? request.grantId,
            "ScopedAccessGrant.resolve"
          )
          return result
        }),
      revoke: (input) =>
        Effect.gen(function* () {
          const request = yield* validateRevokeRequest(input)
          const state = (yield* Ref.get(grants)).get(request.grantId)
          if (state === undefined) {
            return yield* invalid(
              "grantId",
              "must reference an active scoped access grant",
              "ScopedAccessGrant.revoke"
            )
          }
          yield* checkPermission(
            options,
            P.nativeInvoke({ primitive: Surface, methods: ["revoke"] }),
            state.actor,
            `grant:${request.grantId}:revoke`,
            request.grantId,
            "ScopedAccessGrant.revoke",
            request.traceId
          )
          const result = yield* client.revoke(
            new ScopedAccessGrantRevokeInput({
              grantId: request.grantId,
              ...(request.traceId === undefined ? {} : { traceId: request.traceId })
            })
          )
          yield* emitGrantAudit(
            options,
            "permission-used",
            P.nativeInvoke({ primitive: Surface, methods: ["revoke"] }),
            state.actor,
            request.grantId,
            request.traceId ?? request.grantId,
            "ScopedAccessGrant.revoke"
          )
          yield* Ref.update(grants, (current) => {
            const next = new Map(current)
            next.delete(request.grantId)
            return next
          })
          return result
        }),
      isSupported: () => client.isSupported(),
      events: () => client.events()
    } satisfies ScopedAccessGrantServiceApi)
  })

const scopedAccessGrantClientFromRpcClient = (
  client: DesktopRpcClient<ScopedAccessGrantRpc>,
  _exchange: BridgeClientExchange | undefined
): ScopedAccessGrantClientApi =>
  Object.freeze({
    grant: (input) =>
      validateGrantInput(input).pipe(
        Effect.flatMap((valid) =>
          runScopedAccessGrantRpc(
            client["ScopedAccessGrant.grant"](valid),
            "ScopedAccessGrant.grant"
          )
        )
      ),
    resolve: (input) =>
      validateResolveInput(input).pipe(
        Effect.flatMap((valid) =>
          runScopedAccessGrantRpc(
            client["ScopedAccessGrant.resolve"](valid),
            "ScopedAccessGrant.resolve"
          )
        )
      ),
    revoke: (input) =>
      validateRevokeInput(input).pipe(
        Effect.flatMap((valid) =>
          runScopedAccessGrantRpc(
            client["ScopedAccessGrant.revoke"](valid),
            "ScopedAccessGrant.revoke"
          )
        )
      ),
    isSupported: () =>
      runScopedAccessGrantRpc(
        client["ScopedAccessGrant.isSupported"](undefined),
        "ScopedAccessGrant.isSupported"
      ),
    events: () => Stream.fail(unsupportedError(ScopedAccessGrantEventMethod))
  } satisfies ScopedAccessGrantClientApi)

function scopedAccessGrantRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(method: Method, payload: Payload, success: Success, capability: RpcCapabilityMetadata) {
  return NativeSurface.rpc(Surface, method, {
    payload,
    success,
    authority: NativeSurface.authority.custom(capability),
    endpoint: "mutation",
    support: UnsupportedSupport
  })
}

const runScopedAccessGrantRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, ScopedAccessGrantError, never> => runNativeRpc(effect, operation, Surface)

const validateGrantRequest = (
  input: unknown
): Effect.Effect<ScopedAccessGrantGrantRequest, ScopedAccessGrantError, never> =>
  decodeNativeInput(ScopedAccessGrantGrantRequest, input, "ScopedAccessGrant.grant").pipe(
    Effect.tap(validateGrantPayload("ScopedAccessGrant.grant"))
  )

const validateGrantInput = (
  input: unknown
): Effect.Effect<ScopedAccessGrantGrantInput, ScopedAccessGrantError, never> =>
  decodeNativeInput(ScopedAccessGrantGrantInput, input, "ScopedAccessGrant.grant").pipe(
    Effect.tap(validateGrantPayload("ScopedAccessGrant.grant"))
  )

const validateResolveRequest = (
  input: unknown
): Effect.Effect<ScopedAccessGrantResolveRequest, ScopedAccessGrantError, never> =>
  decodeNativeInput(ScopedAccessGrantResolveRequest, input, "ScopedAccessGrant.resolve")

const validateResolveInput = (
  input: unknown
): Effect.Effect<ScopedAccessGrantResolveInput, ScopedAccessGrantError, never> =>
  decodeNativeInput(ScopedAccessGrantResolveInput, input, "ScopedAccessGrant.resolve")

const validateRevokeRequest = (
  input: unknown
): Effect.Effect<ScopedAccessGrantRevokeRequest, ScopedAccessGrantError, never> =>
  decodeNativeInput(ScopedAccessGrantRevokeRequest, input, "ScopedAccessGrant.revoke")

const validateRevokeInput = (
  input: unknown
): Effect.Effect<ScopedAccessGrantRevokeInput, ScopedAccessGrantError, never> =>
  decodeNativeInput(ScopedAccessGrantRevokeInput, input, "ScopedAccessGrant.revoke")

const validateGrantPayload =
  (operation: string) =>
  (
    input: ScopedAccessGrantGrantRequest | ScopedAccessGrantGrantInput
  ): Effect.Effect<void, ScopedAccessGrantError, never> =>
    Effect.gen(function* () {
      if (!isAbsolutePath(input.scope.path)) {
        return yield* invalid("scope.path", "must be an absolute path", operation)
      }
      if (hasDotPathSegment(input.scope.path)) {
        return yield* invalid("scope.path", "must not include dot path segments", operation)
      }
    })

const authorizeGrant = (
  options: ScopedAccessGrantServiceOptions,
  actor: ScopedAccessGrantActor,
  scope: ScopedAccessGrantScope,
  traceId: string | undefined
): Effect.Effect<void, ScopedAccessGrantError, never> =>
  Effect.gen(function* () {
    yield* checkPermission(
      options,
      P.nativeInvoke({ primitive: Surface, methods: ["grant"] }),
      actor,
      `grant:${scope.path}`,
      scope.path,
      "ScopedAccessGrant.grant",
      traceId
    )
    yield* checkPermission(
      options,
      P.filesystemRead({ roots: [scope.path] }),
      actor,
      scope.path,
      scope.path,
      "ScopedAccessGrant.grant",
      traceId
    )
    if (scope.access !== "read") {
      yield* checkPermission(
        options,
        P.filesystemWrite({ roots: [scope.path] }),
        actor,
        scope.path,
        scope.path,
        "ScopedAccessGrant.grant",
        traceId
      )
    }
  })

const checkPermission = (
  options: ScopedAccessGrantServiceOptions,
  capability: NormalizedCapability,
  actor: ScopedAccessGrantActor,
  resource: string,
  auditResource: string,
  operation: string,
  traceId: string | undefined
): Effect.Effect<void, ScopedAccessGrantError, never> =>
  options.permissions
    .check(
      capability,
      new PermissionContext({
        actor: permissionActor(actor),
        resource,
        traceId: traceId ?? options.nextTraceId?.() ?? operation
      })
    )
    .pipe(
      Effect.asVoid,
      Effect.catch((error: PermissionRegistryError) => {
        if (!(error instanceof PermissionDeniedError)) {
          return Effect.fail(
            makeHostProtocolInternalError(
              `scoped access grant permission registry failure: ${error._tag}`,
              operation
            )
          )
        }
        return emitGrantAudit(
          options,
          "permission-denied",
          capability,
          actor,
          auditResource,
          error.traceId,
          operation,
          { reason: error.reason }
        ).pipe(Effect.andThen(Effect.fail(permissionDeniedError(capability, error, operation))))
      })
    )

const filesystemCapability = (scope: ScopedAccessGrantScope): NormalizedCapability =>
  scope.access === "read"
    ? P.filesystemRead({ roots: [scope.path] })
    : P.filesystemWrite({ roots: [scope.path] })

const normalizeScope = (scope: ScopedAccessGrantScope): ScopedAccessGrantScope =>
  new ScopedAccessGrantScope({
    path: normalizedPath(scope.path),
    kind: scope.kind,
    access: scope.access
  })

const permissionActor = (actor: ScopedAccessGrantActor): PermissionActor =>
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

const publishEvent = (
  pubsub: PubSub.PubSub<ScopedAccessGrantEvent>,
  grantId: string,
  phase: "granted" | "resolved" | "revoked",
  path?: string
): Effect.Effect<void, never, never> =>
  Clock.currentTimeMillis.pipe(
    Effect.flatMap((timestamp) =>
      PubSub.publish(
        pubsub,
        new ScopedAccessGrantEvent({
          type: "scoped-access-grant-event",
          timestamp,
          grantId,
          phase,
          state: phase,
          ...(path === undefined ? {} : { path })
        })
      )
    ),
    Effect.asVoid
  )

const emitGrantAudit = (
  options: ScopedAccessGrantServiceOptions,
  type: "permission-used" | "permission-denied",
  capability: NormalizedCapability,
  actor: ScopedAccessGrantActor,
  resource: string,
  traceId: string,
  operation: string,
  details: Record<string, unknown> = {}
): Effect.Effect<void, ScopedAccessGrantError, never> => {
  if (options.audit === undefined) {
    return Effect.void
  }
  return emitAuditEvent(
    options.audit,
    permissionAuditEvent({
      kind: type,
      source: operation,
      traceId,
      outcome: type === "permission-denied" ? "denied" : "used",
      normalizedCapability: capability,
      actor: permissionActor(actor),
      resource,
      details
    })
  ).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInternalError(
        `failed to write scoped access grant audit event: ${error.message}`,
        operation
      )
    )
  )
}

const permissionDeniedError = (
  capability: NormalizedCapability,
  error: PermissionDeniedError,
  operation: string
): HostProtocolPermissionDeniedError =>
  new HostProtocolPermissionDeniedError({
    tag: "PermissionDenied",
    message: `permission denied for ${capability.kind}`,
    operation,
    capability: capability.kind,
    resource: error.traceId,
    recoverable: false
  })

const invalid = (
  field: string,
  message: string,
  operation: string
): Effect.Effect<never, ScopedAccessGrantError, never> =>
  Effect.fail(makeHostProtocolInvalidArgumentError(field, message, operation))

const unsupportedError = (operation: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: `unsupported ScopedAccessGrant method: ${operation}`,
    operation,
    recoverable: false
  })

const failOr = <A>(
  error: ScopedAccessGrantError | undefined,
  effect: Effect.Effect<A, ScopedAccessGrantError, never>
): Effect.Effect<A, ScopedAccessGrantError, never> =>
  error === undefined ? effect : Effect.fail(error)

const makeIdGenerator = (
  next: (() => string) | undefined,
  prefix: string
): Effect.Effect<() => Effect.Effect<string, never, never>, never, never> =>
  Effect.gen(function* () {
    const counter = yield* Ref.make(0)
    return () =>
      next === undefined
        ? Ref.modify(counter, (current) => [`${prefix}-${current + 1}`, current + 1] as const)
        : Effect.sync(next)
  })

const WindowsAbsolutePath = /^[A-Za-z]:[\\/]/u

const isAbsolutePath = (path: string): boolean =>
  path.startsWith("/") || path.startsWith("\\\\") || WindowsAbsolutePath.test(path)

const normalizedPath = (path: string): string => path.replace(/\\/g, "/")

const hasDotPathSegment = (path: string): boolean => {
  const normalized = normalizedPath(path)
  return (
    normalized === "." ||
    normalized === ".." ||
    normalized.includes("/../") ||
    normalized.includes("/./")
  )
}
