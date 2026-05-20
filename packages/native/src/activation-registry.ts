import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  type HostProtocolError,
  HostProtocolInternalError,
  HostProtocolPermissionDeniedError,
  HostProtocolUnsupportedError,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
  type RpcCapabilityMetadata,
  RpcGroup
} from "@effect-desktop/bridge"
import {
  type AuditEventsApi,
  CommandRegistry,
  type CommandRegistryError,
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
import { Clock, Context, Effect, Layer, PubSub, Ref, Schema, Stream } from "effect"

import {
  ActivationActor,
  ActivationEvent,
  type ActivationEventPhase,
  ActivationPermissionContext,
  ActivationRouteRequest,
  ActivationRouteResult,
  ActivationSupportedResult,
  ActivationSurfaceResource,
  type ActivationSurfaceHandle,
  ActivationSurfaceList,
  ActivationSurfaceRegistration,
  ActivationSurfaceRequest
} from "./contracts/activation-registry.js"
import { subscribeNativeEvent } from "./event-stream.js"
import { decodeNativeInput, runNativeRpc } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"

export * from "./contracts/activation-registry.js"

const Surface = "ActivationRegistry"
const UnsupportedReason = "host-adapter-unimplemented"
const EventMethod = "ActivationRegistry.Event"

export type ActivationRegistryError = HostProtocolError | CommandRegistryError

export const ActivationRegistryRegisterSurface = activationRpc(
  "registerSurface",
  ActivationSurfaceRegistration,
  ActivationSurfaceResource,
  P.nativeInvoke({ primitive: Surface, methods: ["registerSurface"] })
)
export const ActivationRegistryUnregisterSurface = activationRpc(
  "unregisterSurface",
  ActivationSurfaceRequest,
  Schema.Void,
  P.nativeInvoke({ primitive: Surface, methods: ["unregisterSurface"] })
)
export const ActivationRegistryListSurfaces = NativeSurface.rpc(Surface, "listSurfaces", {
  payload: Schema.Void,
  success: ActivationSurfaceList,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})
export const ActivationRegistryIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: ActivationSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

export const ActivationRegistryRpcEvents = Object.freeze({
  Event: { payload: ActivationEvent }
})

const ActivationRegistryRpcGroup = RpcGroup.make(
  ActivationRegistryRegisterSurface,
  ActivationRegistryUnregisterSurface,
  ActivationRegistryListSurfaces,
  ActivationRegistryIsSupported
)

export type ActivationRegistryRpc = RpcGroup.Rpcs<typeof ActivationRegistryRpcGroup>
export type ActivationRegistryRpcHandlers = RpcGroup.HandlersFrom<ActivationRegistryRpc>
export const ActivationRegistryRpcs: RpcGroup.RpcGroup<ActivationRegistryRpc> =
  ActivationRegistryRpcGroup

export const ActivationRegistryMethodNames = Object.freeze([
  "registerSurface",
  "unregisterSurface",
  "listSurfaces",
  "isSupported"
] as const)

const ActivationRegistryCapabilityMethods = Object.freeze([
  "registerSurface",
  "unregisterSurface"
] as const satisfies readonly (typeof ActivationRegistryMethodNames)[number][])

export interface ActivationRegistryClientApi {
  readonly registerSurface: (
    input: ActivationSurfaceRegistration
  ) => Effect.Effect<ActivationSurfaceHandle, HostProtocolError, never>
  readonly unregisterSurface: (
    input: ActivationSurfaceRequest
  ) => Effect.Effect<void, HostProtocolError, never>
  readonly listSurfaces: () => Effect.Effect<ActivationSurfaceList, HostProtocolError, never>
  readonly isSupported: () => Effect.Effect<ActivationSupportedResult, HostProtocolError, never>
  readonly events: () => Stream.Stream<ActivationEvent, HostProtocolError, never>
}

export class ActivationRegistryClient extends Context.Service<
  ActivationRegistryClient,
  ActivationRegistryClientApi
>()("@effect-desktop/native/activation-registry/ActivationRegistryClient") {}

export interface ActivationRegistryServiceApi {
  readonly registerSurface: (
    input: ActivationSurfaceRegistration
  ) => Effect.Effect<ActivationSurfaceHandle, HostProtocolError, never>
  readonly unregisterSurface: (
    input: ActivationSurfaceRequest
  ) => Effect.Effect<void, HostProtocolError, never>
  readonly routeActivation: (
    input: ActivationRouteRequest
  ) => Effect.Effect<ActivationRouteResult, ActivationRegistryError, never>
  readonly listSurfaces: () => Effect.Effect<ActivationSurfaceList, HostProtocolError, never>
  readonly isSupported: () => Effect.Effect<ActivationSupportedResult, HostProtocolError, never>
  readonly events: () => Stream.Stream<ActivationEvent, HostProtocolError, never>
}

export interface ActivationRegistryServiceOptions {
  readonly permissions: PermissionRegistryApi
  readonly resources: ResourceRegistryApi
  readonly commands: CommandRegistry["Service"]
  readonly audit?: AuditEventsApi
}

interface ActivationSurfaceState {
  readonly registration: ActivationSurfaceRegistration
  readonly handle: ActivationSurfaceHandle
}

export class ActivationRegistry extends Context.Service<
  ActivationRegistry,
  ActivationRegistryServiceApi
>()("@effect-desktop/native/activation-registry/ActivationRegistry") {
  static readonly layer = Layer.effect(ActivationRegistry)(
    Effect.gen(function* () {
      const client = yield* ActivationRegistryClient
      const permissions = yield* PermissionRegistry
      const resources = yield* ResourceRegistry
      const commands = yield* CommandRegistry
      return yield* makeActivationRegistryService(client, { permissions, resources, commands })
    })
  )
}

export const ActivationRegistryLive = ActivationRegistry.layer

export const makeActivationRegistryClientLayer = (
  client: ActivationRegistryClientApi
): Layer.Layer<ActivationRegistryClient> => Layer.succeed(ActivationRegistryClient)(client)

export const makeActivationRegistryServiceLayer = (
  client: ActivationRegistryClientApi,
  options: ActivationRegistryServiceOptions
): Layer.Layer<ActivationRegistry> =>
  Layer.effect(ActivationRegistry)(makeActivationRegistryService(client, options))

export const makeActivationRegistryBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<ActivationRegistryClient> =>
  ActivationRegistrySurface.bridgeClientLayer(exchange, options)

export const ActivationRegistryHandlersLive = ActivationRegistryRpcGroup.toLayer({
  "ActivationRegistry.registerSurface": (input) =>
    Effect.gen(function* () {
      const service = yield* ActivationRegistry
      return yield* service.registerSurface(input)
    }),
  "ActivationRegistry.unregisterSurface": (input) =>
    Effect.gen(function* () {
      const service = yield* ActivationRegistry
      return yield* service.unregisterSurface(input)
    }),
  "ActivationRegistry.listSurfaces": () =>
    Effect.gen(function* () {
      const service = yield* ActivationRegistry
      return yield* service.listSurfaces()
    }),
  "ActivationRegistry.isSupported": () =>
    Effect.gen(function* () {
      const service = yield* ActivationRegistry
      return yield* service.isSupported()
    })
})

export const ActivationRegistrySurface = NativeSurface.make(Surface, ActivationRegistryRpcGroup, {
  service: ActivationRegistryClient,
  capabilities: ActivationRegistryCapabilityMethods,
  handlers: ActivationRegistryHandlersLive,
  client: (client) => activationRegistryClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => activationRegistryClientFromRpcClient(client, exchange)
})

export const makeHostActivationRegistryRpcRuntime = (
  handlers: ActivationRegistryRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry | ResourceRegistry | CommandRegistry> =>
  ActivationRegistrySurface.hostRuntime(handlers, runtimeOptions)

export interface ActivationRegistryMemoryClientOptions {
  readonly failure?: Partial<Record<"registerSurface" | "unregisterSurface", HostProtocolError>>
}

export const makeActivationRegistryMemoryClient = (
  options: ActivationRegistryMemoryClientOptions = {}
): Effect.Effect<ActivationRegistryClientApi, never, never> =>
  Effect.gen(function* () {
    const surfaces = yield* Ref.make<ReadonlyMap<string, ActivationSurfaceRegistration>>(new Map())
    const pubsub = yield* PubSub.bounded<ActivationEvent>({ capacity: 256, replay: 64 })

    return Object.freeze({
      registerSurface: (input) =>
        validateSurfaceRegistration(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.registerSurface,
              Ref.update(surfaces, (current) => new Map(current).set(valid.surfaceId, valid)).pipe(
                Effect.andThen(
                  Effect.succeed({
                    kind: "activation-surface",
                    id: makeResourceId(valid.surfaceId),
                    generation: 0,
                    ownerScope: valid.ownerScope ?? scopeForActor(valid.actor),
                    state: "registered"
                  } satisfies ActivationSurfaceHandle)
                )
              )
            )
          )
        ),
      unregisterSurface: (input) =>
        validateSurfaceRequest(input, "ActivationRegistry.unregisterSurface").pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.unregisterSurface,
              Ref.update(surfaces, (current) => {
                const next = new Map(current)
                next.delete(valid.surfaceId)
                return next
              })
            )
          )
        ),
      listSurfaces: () =>
        Ref.get(surfaces).pipe(
          Effect.map((current) => new ActivationSurfaceList({ surfaces: [...current.values()] }))
        ),
      isSupported: () => Effect.succeed(new ActivationSupportedResult({ supported: true })),
      events: () => Stream.fromPubSub(pubsub)
    } satisfies ActivationRegistryClientApi)
  })

export const makeActivationRegistryUnsupportedClient = (): ActivationRegistryClientApi =>
  Object.freeze({
    registerSurface: (input) =>
      validateSurfaceRegistration(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("ActivationRegistry.registerSurface")))
      ),
    unregisterSurface: (input) =>
      validateSurfaceRequest(input, "ActivationRegistry.unregisterSurface").pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("ActivationRegistry.unregisterSurface")))
      ),
    listSurfaces: () => Effect.fail(unsupportedError("ActivationRegistry.listSurfaces")),
    isSupported: () =>
      Effect.succeed(
        new ActivationSupportedResult({ supported: false, reason: UnsupportedReason })
      ),
    events: () => Stream.fail(unsupportedError("ActivationRegistry.events"))
  } satisfies ActivationRegistryClientApi)

const makeActivationRegistryService = (
  client: ActivationRegistryClientApi,
  options: ActivationRegistryServiceOptions
): Effect.Effect<ActivationRegistryServiceApi, never, never> =>
  Effect.gen(function* () {
    const surfaces = yield* Ref.make<ReadonlyMap<string, ActivationSurfaceState>>(new Map())
    const events = yield* PubSub.bounded<ActivationEvent>({ capacity: 256, replay: 64 })

    return Object.freeze({
      registerSurface: (input) => registerSurface(client, options, surfaces, events, input),
      unregisterSurface: (input) => unregisterSurface(client, options, surfaces, events, input),
      routeActivation: (input) => routeActivation(options, surfaces, events, input),
      listSurfaces: () => client.listSurfaces(),
      isSupported: () => client.isSupported(),
      events: () => Stream.merge(Stream.fromPubSub(events), client.events())
    } satisfies ActivationRegistryServiceApi)
  })

const registerSurface = (
  client: ActivationRegistryClientApi,
  options: ActivationRegistryServiceOptions,
  surfaces: Ref.Ref<ReadonlyMap<string, ActivationSurfaceState>>,
  events: PubSub.PubSub<ActivationEvent>,
  input: unknown
): Effect.Effect<ActivationSurfaceHandle, HostProtocolError, never> =>
  Effect.gen(function* () {
    const registration = yield* validateSurfaceRegistration(input)
    const operation = "ActivationRegistry.registerSurface"
    yield* authorize(options, registration.actor, "registerSurface", registration.traceId)
    const ownerScope = registration.ownerScope ?? scopeForActor(registration.actor)
    const id = makeResourceId(registration.surfaceId)
    const handle = yield* options.resources
      .register({
        kind: "activation-surface",
        id,
        ownerScope,
        state: "registered",
        reusableId: true,
        dispose: Effect.suspend(() =>
          cleanupSurface(client, surfaces, events, registration, "resource-dispose")
        )
      })
      .pipe(Effect.mapError((error) => invalidArgument(error.field, error.message, operation)))
    const publicHandle = toActivationSurfaceHandle(handle)
    let hostRegistered = false
    yield* client.registerSurface(registration).pipe(
      Effect.flatMap((result) =>
        Effect.sync(() => {
          hostRegistered = true
          return result
        }).pipe(
          Effect.flatMap((registeredHandle) =>
            registeredHandle.id === publicHandle.id
              ? Effect.succeed(registeredHandle)
              : Effect.fail(
                  makeHostProtocolInternalError("activation surface handle id mismatch", operation)
                )
          )
        )
      ),
      Effect.tapError(() =>
        cleanupFailedRegistration(client, options, registration, publicHandle.id, hostRegistered)
      ),
      Effect.onInterrupt(() =>
        cleanupFailedRegistration(client, options, registration, publicHandle.id, hostRegistered)
      )
    )
    yield* Ref.update(surfaces, (current) =>
      new Map(current).set(registration.surfaceId, { registration, handle: publicHandle })
    )
    yield* publishActivationEvent(events, registration, "registered", undefined)
    yield* emitActivationAudit(options, "registered", capability("registerSurface"), registration, {
      surfaceId: registration.surfaceId,
      source: registration.source
    }).pipe(Effect.ignore)
    return publicHandle
  })

const unregisterSurface = (
  client: ActivationRegistryClientApi,
  options: ActivationRegistryServiceOptions,
  surfaces: Ref.Ref<ReadonlyMap<string, ActivationSurfaceState>>,
  events: PubSub.PubSub<ActivationEvent>,
  input: unknown
): Effect.Effect<void, HostProtocolError, never> =>
  Effect.gen(function* () {
    const request = yield* validateSurfaceRequest(input, "ActivationRegistry.unregisterSurface")
    const current = yield* Ref.get(surfaces)
    const surface = current.get(request.surfaceId)
    if (surface === undefined) {
      const supported = yield* client.isSupported()
      if (!supported.supported) {
        yield* client.unregisterSurface(request)
      }
      return yield* Effect.fail(
        invalidArgument(
          "surfaceId",
          "must reference a registered activation surface",
          "ActivationRegistry.unregisterSurface"
        )
      )
    }
    yield* authorize(options, surface.registration.actor, "unregisterSurface", request.traceId)
    yield* client.unregisterSurface(request)
    yield* Ref.update(surfaces, (latest) => {
      const next = new Map(latest)
      next.delete(request.surfaceId)
      return next
    })
    yield* options.resources.dispose(surface.handle.id)
    yield* publishActivationEvent(events, surface.registration, "unregistered", undefined)
    yield* emitActivationAudit(
      options,
      "unregistered",
      capability("unregisterSurface"),
      surface.registration,
      {
        surfaceId: request.surfaceId
      }
    ).pipe(Effect.ignore)
  })

const cleanupFailedRegistration = (
  client: ActivationRegistryClientApi,
  options: ActivationRegistryServiceOptions,
  registration: ActivationSurfaceRegistration,
  id: ActivationSurfaceHandle["id"],
  hostRegistered: boolean
): Effect.Effect<void, never, never> =>
  Effect.all(
    [
      hostRegistered
        ? client
            .unregisterSurface(new ActivationSurfaceRequest({ surfaceId: registration.surfaceId }))
            .pipe(Effect.ignore)
        : Effect.void,
      options.resources.dispose(id)
    ],
    { discard: true }
  )

const cleanupSurface = (
  client: ActivationRegistryClientApi,
  surfaces: Ref.Ref<ReadonlyMap<string, ActivationSurfaceState>>,
  events: PubSub.PubSub<ActivationEvent>,
  registration: ActivationSurfaceRegistration,
  reason: string
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const removed = yield* Ref.modify(surfaces, (current) => {
      if (!current.has(registration.surfaceId)) {
        return [false, current] as const
      }
      const next = new Map(current)
      next.delete(registration.surfaceId)
      return [true, next] as const
    })
    if (!removed) {
      return
    }
    yield* client
      .unregisterSurface(new ActivationSurfaceRequest({ surfaceId: registration.surfaceId }))
      .pipe(Effect.ignore)
    yield* publishActivationEvent(events, registration, "unregistered", undefined, reason)
  })

const routeActivation = (
  options: ActivationRegistryServiceOptions,
  surfaces: Ref.Ref<ReadonlyMap<string, ActivationSurfaceState>>,
  events: PubSub.PubSub<ActivationEvent>,
  input: unknown
): Effect.Effect<ActivationRouteResult, ActivationRegistryError, never> =>
  Effect.gen(function* () {
    const request = yield* validateRouteRequest(input)
    const current = yield* Ref.get(surfaces)
    const surface = current.get(request.surfaceId)
    if (surface === undefined) {
      return yield* Effect.fail(
        invalidArgument(
          "surfaceId",
          "must reference a registered activation surface",
          "ActivationRegistry.routeActivation"
        )
      )
    }
    if (!sameActor(request.actor, request.permissionContext.actor)) {
      return yield* Effect.fail(
        invalidArgument(
          "permissionContext.actor",
          "must match activation actor",
          "ActivationRegistry.routeActivation"
        )
      )
    }
    const context = permissionContext(request.permissionContext)
    yield* emitActivationAudit(
      options,
      "routed",
      P.nativeInvoke({ primitive: Surface, methods: ["routeActivation"] }),
      surface.registration,
      {
        surfaceId: request.surfaceId,
        source: surface.registration.source
      }
    ).pipe(Effect.ignore)
    yield* options.commands.invoke(surface.registration.commandId, request.payload, context)
    const result = new ActivationRouteResult({
      surfaceId: request.surfaceId,
      commandId: surface.registration.commandId,
      routed: true
    })
    yield* publishActivationEvent(events, surface.registration, "routed", request)
    return result
  }).pipe(
    Effect.tapError((error) =>
      Effect.gen(function* () {
        const request = yield* validateRouteRequest(input).pipe(Effect.option)
        if (request._tag === "Some") {
          const current = yield* Ref.get(surfaces)
          const surface = current.get(request.value.surfaceId)
          if (surface !== undefined) {
            yield* publishActivationEvent(
              events,
              surface.registration,
              "failed",
              request.value,
              errorTag(error)
            )
          }
        }
      })
    )
  )

const activationRegistryClientFromRpcClient = (
  client: DesktopRpcClient<ActivationRegistryRpc>,
  exchange: BridgeClientExchange | undefined
): ActivationRegistryClientApi =>
  Object.freeze({
    registerSurface: (input) =>
      validateSurfaceRegistration(input).pipe(
        Effect.flatMap((valid) =>
          runActivationRpc(
            client["ActivationRegistry.registerSurface"](valid),
            "ActivationRegistry.registerSurface"
          )
        )
      ),
    unregisterSurface: (input) =>
      validateSurfaceRequest(input, "ActivationRegistry.unregisterSurface").pipe(
        Effect.flatMap((valid) =>
          runActivationRpc(
            client["ActivationRegistry.unregisterSurface"](valid),
            "ActivationRegistry.unregisterSurface"
          )
        )
      ),
    listSurfaces: () =>
      runActivationRpc(
        client["ActivationRegistry.listSurfaces"](undefined),
        "ActivationRegistry.listSurfaces"
      ),
    isSupported: () =>
      runActivationRpc(
        client["ActivationRegistry.isSupported"](undefined),
        "ActivationRegistry.isSupported"
      ),
    events: () =>
      subscribeNativeEvent(exchange, EventMethod, ActivationEvent).pipe(
        Stream.mapError(narrowActivationError)
      )
  } satisfies ActivationRegistryClientApi)

function activationRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(method: Method, payload: Payload, success: Success, cap: RpcCapabilityMetadata) {
  return NativeSurface.rpc(Surface, method, {
    payload,
    success,
    authority: NativeSurface.authority.custom(cap),
    endpoint: "mutation",
    support: NativeSurface.support.supported
  })
}

const validateSurfaceRegistration = (
  input: unknown
): Effect.Effect<ActivationSurfaceRegistration, HostProtocolError, never> =>
  decodeNativeInput(ActivationSurfaceRegistration, input, "ActivationRegistry.registerSurface")

const validateSurfaceRequest = (
  input: unknown,
  operation: string
): Effect.Effect<ActivationSurfaceRequest, HostProtocolError, never> =>
  decodeNativeInput(ActivationSurfaceRequest, input, operation)

const validateRouteRequest = (
  input: unknown
): Effect.Effect<ActivationRouteRequest, HostProtocolError, never> =>
  decodeNativeInput(ActivationRouteRequest, input, "ActivationRegistry.routeActivation")

const runActivationRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, HostProtocolError, never> =>
  runNativeRpc(effect, operation, Surface).pipe(Effect.mapError(narrowActivationError))

const authorize = (
  options: ActivationRegistryServiceOptions,
  actor: ActivationActor,
  method: "registerSurface" | "unregisterSurface",
  traceId: string | undefined
): Effect.Effect<void, HostProtocolError, never> =>
  options.permissions
    .check(
      capability(method),
      new PermissionContext({
        actor: permissionActor(actor),
        resource: "activation-registry",
        traceId: traceId ?? `ActivationRegistry.${method}`
      })
    )
    .pipe(
      Effect.asVoid,
      Effect.tapError((error) =>
        error instanceof PermissionDeniedError
          ? emitPermissionDeniedAudit(options, actor, method, error)
          : Effect.void
      ),
      Effect.mapError((error: PermissionRegistryError): HostProtocolError => {
        if (error instanceof PermissionDeniedError) {
          return new HostProtocolPermissionDeniedError({
            tag: "PermissionDenied",
            message: `permission denied for ${capability(method).kind}`,
            operation: `ActivationRegistry.${method}`,
            capability: capability(method).kind,
            resource: error.traceId,
            recoverable: false
          })
        }
        return internalError(
          `activation registry permission failure: ${error._tag}`,
          `ActivationRegistry.${method}`
        )
      })
    )

const emitPermissionDeniedAudit = (
  options: ActivationRegistryServiceOptions,
  actor: ActivationActor,
  method: "registerSurface" | "unregisterSurface",
  error: PermissionDeniedError
): Effect.Effect<void, never, never> =>
  emitAuditEvent(
    options.audit,
    permissionAuditEvent({
      kind: "permission-denied",
      source: `ActivationRegistry.${method}`,
      traceId: error.traceId,
      outcome: "denied",
      normalizedCapability: capability(method),
      actor: permissionActor(actor),
      resource: "activation-registry",
      details: { surface: "activation-registry", reason: error.reason }
    })
  ).pipe(Effect.ignore)

const emitActivationAudit = (
  options: ActivationRegistryServiceOptions,
  outcome: string,
  cap: NormalizedCapability,
  registration: ActivationSurfaceRegistration,
  details: Record<string, unknown>
): Effect.Effect<void, HostProtocolError, never> =>
  emitAuditEvent(
    options.audit,
    permissionAuditEvent({
      kind: "permission-used",
      source: "ActivationRegistry",
      traceId: registration.traceId ?? registration.surfaceId,
      outcome,
      normalizedCapability: cap,
      actor: permissionActor(registration.actor),
      resource: "activation-registry",
      details: { surface: "activation-registry", ...details }
    })
  ).pipe(
    Effect.mapError((error) =>
      internalError(
        `failed to write activation registry audit event: ${error.message}`,
        "ActivationRegistry.audit"
      )
    )
  )

const publishActivationEvent = (
  events: PubSub.PubSub<ActivationEvent>,
  registration: ActivationSurfaceRegistration,
  phase: ActivationEventPhase,
  request: ActivationRouteRequest | undefined,
  reason?: string
): Effect.Effect<void, never, never> =>
  Clock.currentTimeMillis.pipe(
    Effect.flatMap((timestamp) =>
      PubSub.publish(
        events,
        new ActivationEvent({
          type: "activation-registry-event",
          timestamp,
          phase,
          surfaceId: registration.surfaceId,
          source: registration.source,
          payload: request?.payload ?? activationLifecyclePayload(registration, phase),
          actor: request?.actor ?? registration.actor,
          traceId: request?.traceId ?? registration.traceId ?? registration.surfaceId,
          permissionContext:
            request?.permissionContext ??
            new ActivationPermissionContext({
              actor: registration.actor,
              traceId: registration.traceId ?? registration.surfaceId
            }),
          ...(reason === undefined ? {} : { reason })
        })
      )
    ),
    Effect.asVoid
  )

const activationLifecyclePayload = (
  registration: ActivationSurfaceRegistration,
  phase: ActivationEventPhase
): {
  readonly surfaceId: string
  readonly source: string
  readonly commandId: string
  readonly phase: string
} => ({
  surfaceId: registration.surfaceId,
  source: registration.source,
  commandId: registration.commandId,
  phase
})

const failOr = <A>(
  error: HostProtocolError | undefined,
  effect: Effect.Effect<A, never, never>
): Effect.Effect<A, HostProtocolError, never> => (error === undefined ? effect : Effect.fail(error))

const toActivationSurfaceHandle = (handle: ActivationSurfaceHandle): ActivationSurfaceHandle => ({
  kind: "activation-surface",
  id: handle.id,
  generation: handle.generation,
  ownerScope: handle.ownerScope,
  state: "registered"
})

const permissionContext = (input: ActivationPermissionContext): PermissionContext =>
  new PermissionContext({
    actor: permissionActor(input.actor),
    ...(input.resource === undefined ? {} : { resource: input.resource }),
    traceId: input.traceId
  })

const permissionActor = (actor: ActivationActor): PermissionActor =>
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

const scopeForActor = (actor: ActivationActor): string => `${actor.kind}:${actor.id}`

const sameActor = (left: ActivationActor, right: ActivationActor): boolean =>
  left.kind === right.kind && left.id === right.id

const capability = (method: "registerSurface" | "unregisterSurface"): NormalizedCapability =>
  P.nativeInvoke({ primitive: Surface, methods: [method] })

const invalidArgument = (field: string, message: string, operation: string): HostProtocolError =>
  makeHostProtocolInvalidArgumentError(field, message, operation)

const unsupportedError = (operation: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: `unsupported ActivationRegistry method: ${operation}`,
    operation,
    recoverable: false
  })

const narrowActivationError = (error: HostProtocolError): HostProtocolError => error

const internalError = (message: string, operation: string): HostProtocolInternalError =>
  new HostProtocolInternalError({
    tag: "Internal",
    message,
    operation,
    recoverable: false
  })

const errorTag = (error: unknown): string =>
  typeof error === "object" && error !== null && "_tag" in error && typeof error._tag === "string"
    ? error._tag
    : "UnknownError"
