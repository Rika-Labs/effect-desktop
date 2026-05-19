import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  HostProtocolPermissionDeniedError,
  HostProtocolUnsupportedError,
  makeHostProtocolInternalError,
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
  type PermissionRegistryError,
  ResourceRegistry,
  type ResourceRegistryApi,
  makeResourceId
} from "@effect-desktop/core"
import { Clock, Context, Effect, Layer, Option, PubSub, Ref, Schema, Stream } from "effect"

import {
  SessionProfileEvent,
  type SessionProfileHandle,
  SessionProfileHandleInput,
  SessionProfileFromPartitionInput,
  SessionProfileList,
  SessionProfileResource,
  SessionProfileSupportedResult
} from "./contracts/session-profile.js"
import { subscribeNativeEvent } from "./event-stream.js"
import { decodeNativeInput, runNativeRpc } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"

export * from "./contracts/session-profile.js"

const Surface = "SessionProfile"
const UnsupportedReason = "host-session-profile-routing-unavailable"
const EventMethod = "SessionProfile.Event"
const UnsupportedSupport = NativeSurface.support.unsupported(UnsupportedReason, {
  platforms: [
    { platform: "macos", status: "unsupported", reason: UnsupportedReason },
    { platform: "windows", status: "unsupported", reason: UnsupportedReason },
    { platform: "linux", status: "unsupported", reason: UnsupportedReason }
  ]
})

export type SessionProfileError = HostProtocolError

export const SessionProfileFromPartition = NativeSurface.rpc(Surface, "fromPartition", {
  payload: SessionProfileFromPartitionInput,
  success: SessionProfileResource,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["fromPartition"] })
  ),
  endpoint: "mutation",
  support: UnsupportedSupport
})
export const SessionProfileDestroy = NativeSurface.rpc(Surface, "destroy", {
  payload: SessionProfileHandleInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["destroy"] })
  ),
  endpoint: "mutation",
  support: UnsupportedSupport
})
export const SessionProfileListProfiles = NativeSurface.rpc(Surface, "list", {
  payload: Schema.Void,
  success: SessionProfileList,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["list"] })
  ),
  endpoint: "query",
  support: UnsupportedSupport
})
export const SessionProfileIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: SessionProfileSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

export const SessionProfileRpcEvents = Object.freeze({
  Event: { payload: SessionProfileEvent }
})

const SessionProfileRpcGroup = RpcGroup.make(
  SessionProfileFromPartition,
  SessionProfileDestroy,
  SessionProfileListProfiles,
  SessionProfileIsSupported
)

export const SessionProfileRpcs: RpcGroup.RpcGroup<SessionProfileRpc> = SessionProfileRpcGroup

export const SessionProfileMethodNames = Object.freeze([
  "fromPartition",
  "destroy",
  "list",
  "isSupported"
] as const)

const SessionProfileCapabilityMethods = Object.freeze([
  "fromPartition",
  "destroy",
  "list"
] as const satisfies readonly (typeof SessionProfileMethodNames)[number][])

export interface SessionProfileClientApi {
  readonly fromPartition: (
    input: SessionProfileFromPartitionInput
  ) => Effect.Effect<SessionProfileHandle, SessionProfileError, never>
  readonly destroy: (
    input: SessionProfileHandleInput
  ) => Effect.Effect<void, SessionProfileError, never>
  readonly list: () => Effect.Effect<SessionProfileList, SessionProfileError, never>
  readonly isSupported: () => Effect.Effect<
    SessionProfileSupportedResult,
    SessionProfileError,
    never
  >
  readonly events: () => Stream.Stream<SessionProfileEvent, SessionProfileError, never>
}

export class SessionProfileClient extends Context.Service<
  SessionProfileClient,
  SessionProfileClientApi
>()("@effect-desktop/native/SessionProfileClient") {}

export interface SessionProfileServiceApi {
  readonly fromPartition: (
    partition: string,
    options?: { readonly ownerScope?: string; readonly traceId?: string }
  ) => Effect.Effect<SessionProfileHandle, SessionProfileError, never>
  readonly destroy: (
    profile: SessionProfileHandle,
    options?: { readonly traceId?: string }
  ) => Effect.Effect<void, SessionProfileError, never>
  readonly list: () => Effect.Effect<SessionProfileList, SessionProfileError, never>
  readonly isSupported: () => Effect.Effect<
    SessionProfileSupportedResult,
    SessionProfileError,
    never
  >
  readonly events: () => Stream.Stream<SessionProfileEvent, SessionProfileError, never>
}

export interface SessionProfileServiceOptions {
  readonly permissions: PermissionRegistryApi
  readonly resources: ResourceRegistryApi
}

export class SessionProfile extends Context.Service<SessionProfile, SessionProfileServiceApi>()(
  "@effect-desktop/native/SessionProfile"
) {
  static readonly layer = Layer.effect(SessionProfile)(
    Effect.gen(function* () {
      const client = yield* SessionProfileClient
      const permissions = yield* PermissionRegistry
      const resources = yield* ResourceRegistry
      return makeSessionProfileService(client, { permissions, resources })
    })
  )
}

export const SessionProfileLive = SessionProfile.layer

export const makeSessionProfileClientLayer = (
  client: SessionProfileClientApi
): Layer.Layer<SessionProfileClient> => Layer.succeed(SessionProfileClient)(client)

export const makeSessionProfileServiceLayer = (
  client: SessionProfileClientApi,
  options: SessionProfileServiceOptions
): Layer.Layer<SessionProfile> =>
  Layer.succeed(SessionProfile)(makeSessionProfileService(client, options))

export const makeSessionProfileBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<SessionProfileClient> => SessionProfileSurface.bridgeClientLayer(exchange, options)

export type SessionProfileRpc = RpcGroup.Rpcs<typeof SessionProfileRpcGroup>
export type SessionProfileRpcHandlers = RpcGroup.HandlersFrom<SessionProfileRpc>

export const SessionProfileHandlersLive = SessionProfileRpcGroup.toLayer({
  "SessionProfile.fromPartition": (input) =>
    Effect.gen(function* () {
      const profiles = yield* SessionProfile
      return yield* profiles.fromPartition(input.partition, {
        ...(input.ownerScope === undefined ? {} : { ownerScope: input.ownerScope }),
        ...(input.traceId === undefined ? {} : { traceId: input.traceId })
      })
    }),
  "SessionProfile.destroy": (input) =>
    Effect.gen(function* () {
      const profiles = yield* SessionProfile
      yield* profiles.destroy(
        input.profile,
        input.traceId === undefined ? {} : { traceId: input.traceId }
      )
    }),
  "SessionProfile.list": () =>
    Effect.gen(function* () {
      const profiles = yield* SessionProfile
      return yield* profiles.list()
    }),
  "SessionProfile.isSupported": () =>
    Effect.gen(function* () {
      const profiles = yield* SessionProfile
      return yield* profiles.isSupported()
    })
})

export const SessionProfileSurface = NativeSurface.make(Surface, SessionProfileRpcGroup, {
  service: SessionProfileClient,
  capabilities: SessionProfileCapabilityMethods,
  handlers: SessionProfileHandlersLive,
  client: (client) => sessionProfileClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => sessionProfileClientFromRpcClient(client, exchange)
})

export const makeHostSessionProfileRpcRuntime = (
  handlers: SessionProfileRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry | ResourceRegistry> =>
  SessionProfileSurface.hostRuntime(handlers, runtimeOptions)

export interface SessionProfileMemoryClientOptions {
  readonly failure?: Partial<Record<"fromPartition" | "destroy" | "list", SessionProfileError>>
}

export const makeSessionProfileMemoryClient = (
  options: SessionProfileMemoryClientOptions = {}
): Effect.Effect<SessionProfileClientApi, never, never> =>
  Effect.gen(function* () {
    const clock = yield* Clock.Clock
    const pubsub = yield* PubSub.bounded<SessionProfileEvent>({ capacity: 256, replay: 64 })
    const profiles = yield* Ref.make<ReadonlyMap<string, SessionProfileHandle>>(new Map())

    return Object.freeze({
      fromPartition: (input) =>
        validateFromPartitionInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.fromPartition,
              Effect.gen(function* () {
                const existing = yield* Ref.get(profiles).pipe(
                  Effect.map((current) => current.get(valid.partition))
                )
                if (existing !== undefined) {
                  return existing
                }

                const handle = sessionProfileHandle(valid.partition, valid.ownerScope ?? "app")
                yield* Ref.update(profiles, (current) =>
                  new Map(current).set(valid.partition, handle)
                )
                yield* publishEvent(pubsub, clock, "opened", handle, valid.partition)
                return handle
              })
            )
          )
        ),
      destroy: (input) =>
        validateHandleInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.destroy,
              Effect.gen(function* () {
                const removed = yield* Ref.modify(profiles, (current) => {
                  const next = new Map(current)
                  let removed:
                    | { readonly partition: string; readonly handle: SessionProfileHandle }
                    | undefined
                  for (const [partition, handle] of current) {
                    if (handle.id === valid.profile.id) {
                      removed = { partition, handle }
                      next.delete(partition)
                      break
                    }
                  }
                  return [removed, next] as const
                })
                if (removed !== undefined) {
                  yield* publishEvent(pubsub, clock, "closed", removed.handle, removed.partition)
                }
              })
            )
          )
        ),
      list: () =>
        failOr(
          options.failure?.list,
          Ref.get(profiles).pipe(
            Effect.map(
              (current) => new SessionProfileList({ profiles: Array.from(current.values()) })
            )
          )
        ),
      isSupported: () => Effect.succeed(new SessionProfileSupportedResult({ supported: true })),
      events: () => Stream.fromPubSub(pubsub)
    } satisfies SessionProfileClientApi)
  })

export const makeSessionProfileUnsupportedClient = (): SessionProfileClientApi =>
  Object.freeze({
    fromPartition: (input) =>
      validateFromPartitionInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("SessionProfile.fromPartition")))
      ),
    destroy: (input) =>
      validateHandleInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("SessionProfile.destroy")))
      ),
    list: () => Effect.fail(unsupportedError("SessionProfile.list")),
    isSupported: () =>
      Effect.succeed(
        new SessionProfileSupportedResult({ supported: false, reason: UnsupportedReason })
      ),
    events: () => Stream.fail(unsupportedError(EventMethod))
  } satisfies SessionProfileClientApi)

const makeSessionProfileService = (
  client: SessionProfileClientApi,
  options: SessionProfileServiceOptions
): SessionProfileServiceApi => {
  const explicitlyDestroyedProfiles = new Set<string>()
  const service: SessionProfileServiceApi = {
    fromPartition: (partition, requestOptions) =>
      Effect.gen(function* () {
        const request = yield* validateFromPartitionInput({
          partition,
          ...(requestOptions?.ownerScope === undefined
            ? {}
            : { ownerScope: requestOptions.ownerScope }),
          ...(requestOptions?.traceId === undefined ? {} : { traceId: requestOptions.traceId })
        })
        yield* authorize(options.permissions, "fromPartition", request.partition, request.traceId)
        const existing = yield* existingProfile(options.resources, request.partition)
        if (existing !== undefined) {
          return existing
        }

        const handle = yield* client.fromPartition(request)
        const registered = yield* options.resources
          .register({
            kind: "session-profile",
            id: makeResourceId(handle.id),
            ownerScope: handle.ownerScope,
            state: "open",
            reusableId: true,
            dispose: Effect.suspend(() =>
              explicitlyDestroyedProfiles.has(handle.id)
                ? Effect.void
                : client
                    .destroy(new SessionProfileHandleInput({ profile: handle }))
                    .pipe(Effect.ignore)
            )
          })
          .pipe(
            Effect.mapError((error) =>
              makeHostProtocolInternalError(
                `failed to register session profile resource: ${error.message}`,
                "SessionProfile.fromPartition"
              )
            )
          )
        return {
          kind: "session-profile",
          id: registered.id,
          generation: registered.generation,
          ownerScope: registered.ownerScope,
          state: "open"
        } satisfies SessionProfileHandle
      }),
    destroy: (profile, requestOptions) =>
      validateHandleInput({
        profile,
        ...(requestOptions?.traceId === undefined ? {} : { traceId: requestOptions.traceId })
      }).pipe(
        Effect.flatMap((valid) =>
          authorize(options.permissions, "destroy", valid.profile.id, valid.traceId).pipe(
            Effect.andThen(client.destroy(valid)),
            Effect.andThen(Effect.sync(() => explicitlyDestroyedProfiles.add(valid.profile.id))),
            Effect.andThen(options.resources.dispose(makeResourceId(valid.profile.id))),
            Effect.ensuring(Effect.sync(() => explicitlyDestroyedProfiles.delete(valid.profile.id)))
          )
        )
      ),
    list: () =>
      authorize(options.permissions, "list", "session-profile", undefined).pipe(
        Effect.andThen(client.list())
      ),
    isSupported: () => client.isSupported(),
    events: () => client.events()
  }

  return Object.freeze(service)
}

const sessionProfileClientFromRpcClient = (
  client: DesktopRpcClient<SessionProfileRpc>,
  exchange: BridgeClientExchange | undefined
): SessionProfileClientApi =>
  Object.freeze({
    fromPartition: (input) =>
      validateFromPartitionInput(input).pipe(
        Effect.flatMap((valid) =>
          runSessionProfileRpc(
            client["SessionProfile.fromPartition"](valid),
            "SessionProfile.fromPartition"
          )
        )
      ),
    destroy: (input) =>
      validateHandleInput(input).pipe(
        Effect.flatMap((valid) =>
          runSessionProfileRpc(client["SessionProfile.destroy"](valid), "SessionProfile.destroy")
        )
      ),
    list: () =>
      runSessionProfileRpc(client["SessionProfile.list"](undefined), "SessionProfile.list"),
    isSupported: () =>
      runSessionProfileRpc(
        client["SessionProfile.isSupported"](undefined),
        "SessionProfile.isSupported"
      ),
    events: () => subscribeNativeEvent(exchange, EventMethod, SessionProfileEvent)
  } satisfies SessionProfileClientApi)

const validateFromPartitionInput = (input: unknown) =>
  decodeNativeInput(inputSchemaFromPartition, input, "SessionProfile.fromPartition")
const validateHandleInput = (input: unknown) =>
  decodeNativeInput(SessionProfileHandleInput, input, "SessionProfile.destroy")

const inputSchemaFromPartition = SessionProfileFromPartitionInput

const runSessionProfileRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, SessionProfileError, never> => runNativeRpc(effect, operation, Surface)

const authorize = (
  permissions: PermissionRegistryApi,
  method: "fromPartition" | "destroy" | "list",
  resource: string,
  traceId: string | undefined
): Effect.Effect<void, SessionProfileError, never> =>
  permissions
    .check(
      capability(method),
      new PermissionContext({
        actor: new PermissionActor({ kind: "app", id: "app" }),
        resource,
        traceId: traceId ?? `SessionProfile.${method}`
      })
    )
    .pipe(
      Effect.asVoid,
      Effect.catch((error: PermissionRegistryError) =>
        error instanceof PermissionDeniedError
          ? Effect.fail(
              permissionDeniedError(capability(method), error, `SessionProfile.${method}`)
            )
          : Effect.fail(
              makeHostProtocolInternalError(
                `session profile permission registry failure: ${error._tag}`,
                `SessionProfile.${method}`
              )
            )
      )
    )

const existingProfile = (
  resources: ResourceRegistryApi,
  partition: string
): Effect.Effect<SessionProfileHandle | undefined, never, never> =>
  resources.get(makeResourceId(sessionProfileId(partition))).pipe(
    Effect.map((entry) => {
      if (Option.isNone(entry)) {
        return undefined
      }
      const handle = entry.value.handle
      return handle.kind === "session-profile" && handle.state === "open"
        ? {
            kind: "session-profile",
            id: handle.id,
            generation: handle.generation,
            ownerScope: handle.ownerScope,
            state: "open"
          }
        : undefined
    })
  )

const publishEvent = (
  pubsub: PubSub.PubSub<SessionProfileEvent>,
  clock: Clock.Clock,
  phase: "opened" | "closed",
  profile: SessionProfileHandle,
  partition: string
): Effect.Effect<void, never, never> =>
  PubSub.publish(
    pubsub,
    new SessionProfileEvent({
      type: "session-profile-event",
      timestamp: clock.currentTimeMillisUnsafe(),
      phase,
      profile,
      partition
    })
  ).pipe(Effect.asVoid)

const sessionProfileHandle = (partition: string, ownerScope: string): SessionProfileHandle => ({
  kind: "session-profile",
  id: makeResourceId(sessionProfileId(partition)),
  generation: 0,
  ownerScope,
  state: "open"
})

const sessionProfileId = (partition: string): string => `session-profile:${partition}`

const capability = (method: "fromPartition" | "destroy" | "list") =>
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
  failure: SessionProfileError | undefined,
  effect: Effect.Effect<A, SessionProfileError, never>
): Effect.Effect<A, SessionProfileError, never> =>
  failure === undefined ? effect : Effect.fail(failure)
