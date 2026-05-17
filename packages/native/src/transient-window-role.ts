import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  type HostProtocolError,
  HostProtocolInternalError,
  type HostProtocolInvalidArgumentError,
  type HostProtocolInvalidOutputError,
  HostProtocolPermissionDeniedError,
  type HostProtocolPermissionRevokedError,
  HostProtocolUnsupportedError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  type RpcCapabilityMetadata,
  RpcGroup
} from "@effect-desktop/bridge"
import {
  type AuditEventsApi,
  type DesktopRpcClient,
  emitAuditEvent,
  makeResourceId,
  type NormalizedCapability,
  P,
  PermissionActor,
  PermissionContext,
  PermissionDeniedError,
  PermissionRegistry,
  type PermissionRegistryApi,
  type PermissionRegistryError,
  permissionAuditEvent,
  ResourceRegistry,
  type ResourceRegistryApi
} from "@effect-desktop/core"
import { Clock, Context, Effect, Layer, PubSub, Schema, Stream } from "effect"

import {
  TransientWindowRoleActor,
  TransientWindowRoleEvent,
  TransientWindowRoleHandleRequest,
  TransientWindowRoleOpenRequest,
  TransientWindowRoleRepositionRequest,
  TransientWindowRoleResource,
  TransientWindowRoleSupportedResult,
  type TransientWindowRoleHandle
} from "./contracts/transient-window-role.js"
import { subscribeNativeEvent } from "./event-stream.js"
import { decodeNativeInput, runNativeRpc } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"

export * from "./contracts/transient-window-role.js"

const Surface = "TransientWindowRole"
const UnsupportedReason = "host-adapter-unimplemented"
const EventMethod = "TransientWindowRole.Event"
const UnsupportedSupport = NativeSurface.support.unsupported(UnsupportedReason, {
  platforms: [
    { platform: "macos", status: "unsupported", reason: UnsupportedReason },
    { platform: "windows", status: "unsupported", reason: UnsupportedReason },
    { platform: "linux", status: "unsupported", reason: UnsupportedReason }
  ]
})

export type TransientWindowRoleError =
  | HostProtocolPermissionDeniedError
  | HostProtocolPermissionRevokedError
  | HostProtocolUnsupportedError
  | HostProtocolInvalidArgumentError
  | HostProtocolInvalidOutputError
  | HostProtocolInternalError

export const TransientWindowRoleOpen = transientWindowRoleRpc(
  "open",
  TransientWindowRoleOpenRequest,
  TransientWindowRoleResource,
  P.nativeInvoke({ primitive: Surface, methods: ["open"] })
)
export const TransientWindowRoleReposition = transientWindowRoleRpc(
  "reposition",
  TransientWindowRoleRepositionRequest,
  Schema.Void,
  P.nativeInvoke({ primitive: Surface, methods: ["reposition"] })
)
export const TransientWindowRoleDismiss = transientWindowRoleRpc(
  "dismiss",
  TransientWindowRoleHandleRequest,
  Schema.Void,
  P.nativeInvoke({ primitive: Surface, methods: ["dismiss"] })
)
export const TransientWindowRoleIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: TransientWindowRoleSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

const TransientWindowRoleRpcGroup = RpcGroup.make(
  TransientWindowRoleOpen,
  TransientWindowRoleReposition,
  TransientWindowRoleDismiss,
  TransientWindowRoleIsSupported
)

export type TransientWindowRoleRpc = RpcGroup.Rpcs<typeof TransientWindowRoleRpcGroup>
export type TransientWindowRoleRpcHandlers = RpcGroup.HandlersFrom<TransientWindowRoleRpc>
export const TransientWindowRoleRpcs: RpcGroup.RpcGroup<TransientWindowRoleRpc> =
  TransientWindowRoleRpcGroup

export const TransientWindowRoleRpcEvents = Object.freeze({
  Event: { payload: TransientWindowRoleEvent }
})

export const TransientWindowRoleMethodNames = Object.freeze([
  "open",
  "reposition",
  "dismiss",
  "isSupported"
] as const)

const TransientWindowRoleCapabilityMethods = Object.freeze([
  "open",
  "reposition",
  "dismiss"
] as const satisfies readonly (typeof TransientWindowRoleMethodNames)[number][])

export interface TransientWindowRoleClientApi {
  readonly open: (
    input: typeof TransientWindowRoleOpenRequest.Type
  ) => Effect.Effect<TransientWindowRoleHandle, TransientWindowRoleError, never>
  readonly reposition: (
    input: typeof TransientWindowRoleRepositionRequest.Type
  ) => Effect.Effect<void, TransientWindowRoleError, never>
  readonly dismiss: (
    input: typeof TransientWindowRoleHandleRequest.Type
  ) => Effect.Effect<void, TransientWindowRoleError, never>
  readonly isSupported: () => Effect.Effect<
    TransientWindowRoleSupportedResult,
    TransientWindowRoleError,
    never
  >
  readonly events: () => Stream.Stream<TransientWindowRoleEvent, TransientWindowRoleError, never>
}

export class TransientWindowRoleClient extends Context.Service<
  TransientWindowRoleClient,
  TransientWindowRoleClientApi
>()("@effect-desktop/native/TransientWindowRoleClient") {}

export interface TransientWindowRoleServiceApi extends TransientWindowRoleClientApi {}

export interface TransientWindowRoleServiceOptions {
  readonly permissions: PermissionRegistryApi
  readonly resources: ResourceRegistryApi
  readonly audit?: AuditEventsApi
}

export class TransientWindowRole extends Context.Service<
  TransientWindowRole,
  TransientWindowRoleServiceApi
>()("@effect-desktop/native/TransientWindowRole") {
  static readonly layer = Layer.effect(TransientWindowRole)(
    Effect.gen(function* () {
      const client = yield* TransientWindowRoleClient
      const permissions = yield* PermissionRegistry
      const resources = yield* ResourceRegistry
      return makeTransientWindowRoleService(client, { permissions, resources })
    })
  )
}

export const TransientWindowRoleLive = TransientWindowRole.layer

export const makeTransientWindowRoleClientLayer = (
  client: TransientWindowRoleClientApi
): Layer.Layer<TransientWindowRoleClient> => Layer.succeed(TransientWindowRoleClient)(client)

export const makeTransientWindowRoleServiceLayer = (
  client: TransientWindowRoleClientApi,
  options: TransientWindowRoleServiceOptions
): Layer.Layer<TransientWindowRole> =>
  Layer.succeed(TransientWindowRole, makeTransientWindowRoleService(client, options))

export const makeTransientWindowRoleBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<TransientWindowRoleClient> =>
  TransientWindowRoleSurface.bridgeClientLayer(exchange, options)

export const TransientWindowRoleHandlersLive = TransientWindowRoleRpcGroup.toLayer({
  "TransientWindowRole.open": (input) =>
    Effect.gen(function* () {
      const service = yield* TransientWindowRole
      return yield* service.open(input)
    }),
  "TransientWindowRole.reposition": (input) =>
    Effect.gen(function* () {
      const service = yield* TransientWindowRole
      return yield* service.reposition(input)
    }),
  "TransientWindowRole.dismiss": (input) =>
    Effect.gen(function* () {
      const service = yield* TransientWindowRole
      return yield* service.dismiss(input)
    }),
  "TransientWindowRole.isSupported": () =>
    Effect.gen(function* () {
      const service = yield* TransientWindowRole
      return yield* service.isSupported()
    })
})

export const TransientWindowRoleSurface = NativeSurface.make(Surface, TransientWindowRoleRpcGroup, {
  service: TransientWindowRoleClient,
  capabilities: TransientWindowRoleCapabilityMethods,
  handlers: TransientWindowRoleHandlersLive,
  client: (client) => transientWindowRoleClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => transientWindowRoleClientFromRpcClient(client, exchange)
})

export const makeHostTransientWindowRoleRpcRuntime = (
  handlers: TransientWindowRoleRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry | ResourceRegistry> =>
  TransientWindowRoleSurface.hostRuntime(handlers, runtimeOptions)

export interface TransientWindowRoleMemoryClientOptions {
  readonly failure?: Partial<Record<"open" | "reposition" | "dismiss", TransientWindowRoleError>>
}

export const makeTransientWindowRoleMemoryClient = (
  options: TransientWindowRoleMemoryClientOptions = {}
): Effect.Effect<TransientWindowRoleClientApi, never, never> =>
  Effect.gen(function* () {
    const pubsub = yield* PubSub.bounded<TransientWindowRoleEvent>({ capacity: 256, replay: 64 })
    const active = new Set<string>()

    const failOrContinue = (method: "open" | "reposition" | "dismiss", roleId: string) =>
      Effect.gen(function* () {
        const failure = options.failure?.[method]
        if (failure !== undefined) {
          yield* publishEvent(pubsub, "failed", roleId, failure.tag)
          return yield* Effect.fail(failure)
        }
      })

    return Object.freeze({
      open: (input) =>
        validateOpenRequest(input).pipe(
          Effect.flatMap((valid) =>
            Effect.gen(function* () {
              yield* failOrContinue("open", valid.roleId)
              active.add(valid.roleId)
              yield* publishEvent(pubsub, "opened", valid.roleId)
              return {
                kind: "transient-window-role",
                id: makeResourceId(valid.roleId),
                generation: 0,
                ownerScope: scopeForActor(valid.actor),
                state: "open"
              } satisfies TransientWindowRoleHandle
            })
          )
        ),
      reposition: (input) =>
        validateRepositionRequest(input).pipe(
          Effect.flatMap((valid) =>
            Effect.gen(function* () {
              yield* failOrContinue("reposition", valid.handle.id)
              yield* publishEvent(pubsub, "repositioned", valid.handle.id)
            })
          )
        ),
      dismiss: (input) =>
        validateHandleRequest(input, "TransientWindowRole.dismiss").pipe(
          Effect.flatMap((valid) =>
            Effect.gen(function* () {
              yield* failOrContinue("dismiss", valid.handle.id)
              active.delete(valid.handle.id)
              yield* publishEvent(pubsub, "dismissed", valid.handle.id)
            })
          )
        ),
      isSupported: () =>
        Effect.succeed(new TransientWindowRoleSupportedResult({ supported: true })),
      events: () => Stream.fromPubSub(pubsub)
    } satisfies TransientWindowRoleClientApi)
  })

export const makeTransientWindowRoleUnsupportedClient = (): TransientWindowRoleClientApi =>
  Object.freeze({
    open: (input) =>
      validateOpenRequest(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("TransientWindowRole.open")))
      ),
    reposition: (input) =>
      validateRepositionRequest(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("TransientWindowRole.reposition")))
      ),
    dismiss: (input) =>
      validateHandleRequest(input, "TransientWindowRole.dismiss").pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("TransientWindowRole.dismiss")))
      ),
    isSupported: () =>
      Effect.succeed(
        new TransientWindowRoleSupportedResult({ supported: false, reason: UnsupportedReason })
      ),
    events: () => Stream.fail(unsupportedError("TransientWindowRole.events"))
  } satisfies TransientWindowRoleClientApi)

const makeTransientWindowRoleService = (
  client: TransientWindowRoleClientApi,
  options: TransientWindowRoleServiceOptions
): TransientWindowRoleServiceApi => {
  const explicitlyDismissed = new Set<string>()
  return Object.freeze({
    open: (input) => openWithPolicy(client, options, explicitlyDismissed, input),
    reposition: (input) => repositionWithPolicy(client, options, input),
    dismiss: (input) => dismissWithPolicy(client, options, explicitlyDismissed, input),
    isSupported: () => client.isSupported(),
    events: () => client.events()
  } satisfies TransientWindowRoleServiceApi)
}

const openWithPolicy = (
  client: TransientWindowRoleClientApi,
  options: TransientWindowRoleServiceOptions,
  explicitlyDismissed: Set<string>,
  input: unknown
): Effect.Effect<TransientWindowRoleHandle, TransientWindowRoleError, never> =>
  Effect.gen(function* () {
    const request = yield* validateOpenRequest(input)
    const operation = "TransientWindowRole.open"
    const cap = capability("open")
    yield* authorize(options, request.actor, "open", request.traceId)
    yield* emitRoleAudit(options, "attempted", cap, request.actor, operation, request.roleId)
    const ownerScope = scopeForActor(request.actor)
    const id = makeResourceId(request.roleId)
    let registeredHandle: TransientWindowRoleHandle | undefined
    const handle = yield* options.resources
      .register({
        kind: "transient-window-role",
        id,
        ownerScope,
        state: "open",
        reusableId: true,
        dispose: Effect.gen(function* () {
          if (registeredHandle === undefined) {
            return
          }
          if (explicitlyDismissed.has(registeredHandle.id)) {
            return
          }
          yield* client.dismiss(
            new TransientWindowRoleHandleRequest({
              actor: request.actor,
              handle: registeredHandle,
              ...(request.traceId === undefined ? {} : { traceId: request.traceId })
            })
          )
        }).pipe(Effect.ignore)
      })
      .pipe(Effect.mapError((error) => invalidArgument(error.field, error.message, operation)))
    const publicHandle = toTransientWindowRoleHandle(handle)
    registeredHandle = publicHandle
    const opened = yield* client.open(request).pipe(
      Effect.flatMap((result) => validateHandle(result, operation)),
      Effect.tapError(() => options.resources.dispose(publicHandle.id)),
      Effect.onInterrupt(() => options.resources.dispose(publicHandle.id))
    )
    if (opened.id !== publicHandle.id) {
      yield* client
        .dismiss(
          new TransientWindowRoleHandleRequest({
            actor: request.actor,
            handle: opened,
            ...(request.traceId === undefined ? {} : { traceId: request.traceId })
          })
        )
        .pipe(Effect.ignore)
      yield* options.resources.dispose(publicHandle.id)
      return yield* Effect.fail(
        makeHostProtocolInvalidOutputError(operation, "opened role handle id mismatch")
      )
    }
    yield* emitRoleAudit(options, "opened", cap, request.actor, operation, request.roleId)
    return publicHandle
  })

const repositionWithPolicy = (
  client: TransientWindowRoleClientApi,
  options: TransientWindowRoleServiceOptions,
  input: unknown
): Effect.Effect<void, TransientWindowRoleError, never> =>
  Effect.gen(function* () {
    const request = yield* validateRepositionRequest(input)
    yield* assertHandleOwner(request.actor, request.handle, "TransientWindowRole.reposition")
    yield* options.resources
      .assertFresh(request.handle)
      .pipe(
        Effect.mapError((error) =>
          invalidArgument(
            "handle",
            `stale transient window role handle: ${error.id}`,
            "TransientWindowRole.reposition"
          )
        )
      )
    yield* authorize(options, request.actor, "reposition", request.traceId)
    yield* client.reposition(request)
    yield* emitRoleAudit(
      options,
      "repositioned",
      capability("reposition"),
      request.actor,
      "TransientWindowRole.reposition",
      request.handle.id
    )
  })

const dismissWithPolicy = (
  client: TransientWindowRoleClientApi,
  options: TransientWindowRoleServiceOptions,
  explicitlyDismissed: Set<string>,
  input: unknown
): Effect.Effect<void, TransientWindowRoleError, never> =>
  Effect.gen(function* () {
    const request = yield* validateHandleRequest(input, "TransientWindowRole.dismiss")
    yield* assertHandleOwner(request.actor, request.handle, "TransientWindowRole.dismiss")
    yield* options.resources
      .assertFresh(request.handle)
      .pipe(
        Effect.mapError((error) =>
          invalidArgument(
            "handle",
            `stale transient window role handle: ${error.id}`,
            "TransientWindowRole.dismiss"
          )
        )
      )
    yield* authorize(options, request.actor, "dismiss", request.traceId)
    yield* client.dismiss(request)
    explicitlyDismissed.add(request.handle.id)
    yield* options.resources
      .dispose(request.handle.id)
      .pipe(Effect.ensuring(Effect.sync(() => explicitlyDismissed.delete(request.handle.id))))
    yield* emitRoleAudit(
      options,
      "dismissed",
      capability("dismiss"),
      request.actor,
      "TransientWindowRole.dismiss",
      request.handle.id
    )
  })

const transientWindowRoleClientFromRpcClient = (
  client: DesktopRpcClient<TransientWindowRoleRpc>,
  exchange: BridgeClientExchange | undefined
): TransientWindowRoleClientApi =>
  Object.freeze({
    open: (input) =>
      validateOpenRequest(input).pipe(
        Effect.flatMap((valid) =>
          runTransientWindowRoleRpc(
            client["TransientWindowRole.open"](valid),
            "TransientWindowRole.open"
          ).pipe(Effect.flatMap((result) => validateHandle(result, "TransientWindowRole.open")))
        )
      ),
    reposition: (input) =>
      validateRepositionRequest(input).pipe(
        Effect.flatMap((valid) =>
          runTransientWindowRoleRpc(
            client["TransientWindowRole.reposition"](valid),
            "TransientWindowRole.reposition"
          )
        )
      ),
    dismiss: (input) =>
      validateHandleRequest(input, "TransientWindowRole.dismiss").pipe(
        Effect.flatMap((valid) =>
          runTransientWindowRoleRpc(
            client["TransientWindowRole.dismiss"](valid),
            "TransientWindowRole.dismiss"
          )
        )
      ),
    isSupported: () =>
      runTransientWindowRoleRpc(
        client["TransientWindowRole.isSupported"](undefined),
        "TransientWindowRole.isSupported"
      ),
    events: () =>
      subscribeNativeEvent(exchange, EventMethod, TransientWindowRoleEvent).pipe(
        Stream.mapError(narrowTransientWindowRoleError)
      )
  } satisfies TransientWindowRoleClientApi)

function transientWindowRoleRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(method: Method, payload: Payload, success: Success, cap: RpcCapabilityMetadata) {
  return NativeSurface.rpc(Surface, method, {
    payload,
    success,
    authority: NativeSurface.authority.custom(cap),
    endpoint: "mutation",
    support: UnsupportedSupport
  })
}

const validateOpenRequest = (
  input: unknown
): Effect.Effect<typeof TransientWindowRoleOpenRequest.Type, TransientWindowRoleError, never> =>
  decodeNativeInput(TransientWindowRoleOpenRequest, input, "TransientWindowRole.open").pipe(
    Effect.flatMap((request) => validatePlacement(request, "TransientWindowRole.open")),
    Effect.mapError(narrowTransientWindowRoleError)
  )

const validateRepositionRequest = (
  input: unknown
): Effect.Effect<
  typeof TransientWindowRoleRepositionRequest.Type,
  TransientWindowRoleError,
  never
> =>
  decodeNativeInput(
    TransientWindowRoleRepositionRequest,
    input,
    "TransientWindowRole.reposition"
  ).pipe(
    Effect.flatMap((request) => validatePlacement(request, "TransientWindowRole.reposition")),
    Effect.mapError(narrowTransientWindowRoleError)
  )

const validateHandleRequest = (
  input: unknown,
  operation: string
): Effect.Effect<typeof TransientWindowRoleHandleRequest.Type, TransientWindowRoleError, never> =>
  decodeNativeInput(TransientWindowRoleHandleRequest, input, operation).pipe(
    Effect.mapError(narrowTransientWindowRoleError)
  )

const validatePlacement = <
  A extends { readonly policy?: { readonly placement: unknown }; readonly placement?: unknown }
>(
  input: A,
  operation: string
): Effect.Effect<A, TransientWindowRoleError, never> => {
  const placement =
    "policy" in input && input.policy !== undefined ? input.policy.placement : input.placement
  if (typeof placement !== "object" || placement === null || !("kind" in placement)) {
    return Effect.succeed(input)
  }
  const hasOwnerWindowId = "ownerWindowId" in placement
  const hasDisplayId = "displayId" in placement
  const hasPoint = "point" in placement
  switch (placement.kind) {
    case "centered":
      if (hasOwnerWindowId || hasDisplayId || hasPoint) {
        return Effect.fail(
          invalidArgument(
            "placement",
            "centered placement must not include ownerWindowId, displayId, or point",
            operation
          )
        )
      }
      return Effect.succeed(input)
    case "point":
      if (!hasPoint || hasOwnerWindowId || hasDisplayId) {
        return Effect.fail(
          invalidArgument("placement.point", "point placement requires only point", operation)
        )
      }
      return Effect.succeed(input)
    case "owner-relative":
      if (!hasOwnerWindowId || hasDisplayId || hasPoint) {
        return Effect.fail(
          invalidArgument(
            "placement.ownerWindowId",
            "owner-relative placement requires only ownerWindowId",
            operation
          )
        )
      }
      return Effect.succeed(input)
    case "display-relative":
      if (!hasDisplayId || hasOwnerWindowId || hasPoint) {
        return Effect.fail(
          invalidArgument(
            "placement.displayId",
            "display-relative placement requires only displayId",
            operation
          )
        )
      }
      return Effect.succeed(input)
    default:
      return Effect.succeed(input)
  }
}

const validateHandle = (
  input: unknown,
  operation: string
): Effect.Effect<TransientWindowRoleHandle, TransientWindowRoleError, never> =>
  Schema.decodeUnknownEffect(TransientWindowRoleResource)(input, {
    onExcessProperty: "error"
  }).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidOutputError(
        operation,
        error instanceof Error ? error.message : String(error)
      )
    )
  )

const runTransientWindowRoleRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, TransientWindowRoleError, never> =>
  runNativeRpc(effect, operation, Surface).pipe(Effect.mapError(narrowTransientWindowRoleError))

const authorize = (
  options: TransientWindowRoleServiceOptions,
  actor: TransientWindowRoleActor,
  method: "open" | "reposition" | "dismiss",
  traceId: string | undefined
): Effect.Effect<void, TransientWindowRoleError, never> =>
  options.permissions
    .check(
      capability(method),
      new PermissionContext({
        actor: permissionActor(actor),
        resource: "transient-window-role",
        traceId: traceId ?? `TransientWindowRole.${method}`
      })
    )
    .pipe(
      Effect.tapError((error) =>
        error instanceof PermissionDeniedError
          ? emitPermissionDeniedAudit(options, actor, method, error)
          : Effect.void
      ),
      Effect.asVoid,
      Effect.mapError((error: PermissionRegistryError): TransientWindowRoleError => {
        if (!(error instanceof PermissionDeniedError)) {
          return internalError(
            `transient window role permission registry failure: ${error._tag}`,
            `TransientWindowRole.${method}`
          )
        }
        const cap = capability(method)
        return permissionDeniedError(cap, error, `TransientWindowRole.${method}`)
      })
    )

const emitPermissionDeniedAudit = (
  options: TransientWindowRoleServiceOptions,
  actor: TransientWindowRoleActor,
  method: "open" | "reposition" | "dismiss",
  error: PermissionDeniedError
): Effect.Effect<void, never, never> => {
  if (options.audit === undefined) {
    return Effect.void
  }
  return emitAuditEvent(
    options.audit,
    permissionAuditEvent({
      kind: "permission-denied",
      source: `TransientWindowRole.${method}`,
      traceId: error.traceId,
      outcome: "denied",
      normalizedCapability: capability(method),
      actor: permissionActor(actor),
      resource: "transient-window-role",
      details: { surface: "transient-window-role", reason: error.reason }
    })
  ).pipe(Effect.ignore)
}

const emitRoleAudit = (
  options: TransientWindowRoleServiceOptions,
  outcome: string,
  cap: NormalizedCapability,
  actor: TransientWindowRoleActor,
  operation: string,
  roleId: string
): Effect.Effect<void, TransientWindowRoleError, never> => {
  if (options.audit === undefined) {
    return Effect.void
  }
  return emitAuditEvent(
    options.audit,
    permissionAuditEvent({
      kind: "permission-used",
      source: operation,
      traceId: roleId,
      outcome,
      normalizedCapability: cap,
      actor: permissionActor(actor),
      resource: "transient-window-role",
      details: { surface: "transient-window-role", roleId }
    })
  ).pipe(
    Effect.mapError((error) =>
      internalError(
        `failed to write transient window role audit event: ${error.message}`,
        operation
      )
    )
  )
}

const publishEvent = (
  pubsub: PubSub.PubSub<TransientWindowRoleEvent>,
  phase: "opened" | "repositioned" | "dismissed" | "failed",
  roleId: string,
  reason?: string
): Effect.Effect<void, never, never> =>
  Clock.currentTimeMillis.pipe(
    Effect.flatMap((timestamp) =>
      PubSub.publish(
        pubsub,
        new TransientWindowRoleEvent({
          type: "transient-window-role-event",
          timestamp,
          phase,
          roleId,
          ...(reason === undefined ? {} : { reason })
        })
      )
    ),
    Effect.asVoid
  )

const toTransientWindowRoleHandle = (
  handle: TransientWindowRoleHandle
): TransientWindowRoleHandle => ({
  kind: "transient-window-role",
  id: handle.id,
  generation: handle.generation,
  ownerScope: handle.ownerScope,
  state: "open"
})

const assertHandleOwner = (
  actor: TransientWindowRoleActor,
  handle: TransientWindowRoleHandle,
  operation: string
): Effect.Effect<void, TransientWindowRoleError, never> =>
  handle.ownerScope === scopeForActor(actor)
    ? Effect.void
    : Effect.fail(
        invalidArgument(
          "handle.ownerScope",
          "transient window role handle is not owned by actor",
          operation
        )
      )

const capability = (method: "open" | "reposition" | "dismiss"): NormalizedCapability =>
  P.nativeInvoke({ primitive: Surface, methods: [method] })

const permissionActor = (actor: TransientWindowRoleActor): PermissionActor =>
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

const scopeForActor = (actor: TransientWindowRoleActor): string => `${actor.kind}:${actor.id}`

const invalidArgument = (
  field: string,
  message: string,
  operation: string
): HostProtocolInvalidArgumentError =>
  makeHostProtocolInvalidArgumentError(field, message, operation)

const permissionDeniedError = (
  cap: NormalizedCapability,
  error: PermissionDeniedError,
  operation: string
): HostProtocolPermissionDeniedError =>
  new HostProtocolPermissionDeniedError({
    tag: "PermissionDenied",
    message: `permission denied for ${cap.kind}`,
    operation,
    capability: cap.kind,
    resource: error.traceId,
    recoverable: false
  })

const unsupportedError = (operation: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: `unsupported TransientWindowRole method: ${operation}`,
    operation,
    recoverable: false
  })

const narrowTransientWindowRoleError = (error: HostProtocolError): TransientWindowRoleError => {
  if (
    error.tag === "PermissionDenied" ||
    error.tag === "PermissionRevoked" ||
    error.tag === "Unsupported" ||
    error.tag === "InvalidArgument" ||
    error.tag === "InvalidOutput" ||
    error.tag === "Internal"
  ) {
    return error
  }
  return internalError(
    `unexpected transient window role host failure: ${error.tag}`,
    error.operation
  )
}

const internalError = (message: string, operation: string): HostProtocolInternalError =>
  new HostProtocolInternalError({
    tag: "Internal",
    message,
    operation,
    recoverable: false
  })
