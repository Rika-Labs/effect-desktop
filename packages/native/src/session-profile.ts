import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  type HostProtocolError,
  HostProtocolUnsupportedError,
  RpcGroup
} from "@orika/bridge"
import { type DesktopRpcClient, makeResourceId, P, type PermissionRegistry } from "@orika/core"
import { Context, Effect, Layer, Schema, Stream } from "effect"

import {
  type SessionProfileFromPartitionOptions,
  SessionProfileFromPartitionInput,
  type SessionProfileHandle,
  SessionProfileHandleInput,
  SessionProfileEvent,
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
const SessionProfileSupport = NativeSurface.support.supported

export type SessionProfileError = HostProtocolError

export const SessionProfileFromPartition = NativeSurface.rpc(Surface, "fromPartition", {
  payload: SessionProfileFromPartitionInput,
  success: SessionProfileResource,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["fromPartition"] })
  ),
  endpoint: "mutation",
  support: SessionProfileSupport
})

export const SessionProfileDestroy = NativeSurface.rpc(Surface, "destroy", {
  payload: SessionProfileHandleInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["destroy"] })
  ),
  endpoint: "mutation",
  support: SessionProfileSupport
})

export const SessionProfileListProfiles = NativeSurface.rpc(Surface, "list", {
  payload: Schema.Void,
  success: SessionProfileList,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["list"] })
  ),
  endpoint: "query",
  support: SessionProfileSupport
})

export const SessionProfileIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: SessionProfileSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: SessionProfileSupport
})

export const SessionProfileCapabilityFacts = Object.freeze([])

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
  "list"
] as const)

export interface SessionProfileClientApi {
  readonly fromPartition: (
    input: SessionProfileFromPartitionOptions
  ) => Effect.Effect<SessionProfileHandle, SessionProfileError, never>
  readonly destroy: (
    profile: SessionProfileHandle
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
>()("@orika/native/SessionProfileClient") {}

export interface SessionProfileServiceApi {
  readonly fromPartition: (
    input: SessionProfileFromPartitionOptions
  ) => Effect.Effect<SessionProfileHandle, SessionProfileError, never>
  readonly destroy: (
    profile: SessionProfileHandle
  ) => Effect.Effect<void, SessionProfileError, never>
  readonly list: () => Effect.Effect<SessionProfileList, SessionProfileError, never>
  readonly isSupported: () => Effect.Effect<
    SessionProfileSupportedResult,
    SessionProfileError,
    never
  >
  readonly events: () => Stream.Stream<SessionProfileEvent, SessionProfileError, never>
}

export class SessionProfile extends Context.Service<SessionProfile, SessionProfileServiceApi>()(
  "@orika/native/SessionProfile"
) {
  static readonly layer = Layer.effect(SessionProfile)(
    Effect.gen(function* () {
      const client = yield* SessionProfileClient
      return makeSessionProfileService(client)
    })
  )
}

export const SessionProfileLive = SessionProfile.layer

export const makeSessionProfileClientLayer = (
  client: SessionProfileClientApi
): Layer.Layer<SessionProfileClient> => Layer.succeed(SessionProfileClient)(client)

export const makeSessionProfileServiceLayer = (
  client: SessionProfileClientApi
): Layer.Layer<SessionProfile> => Layer.succeed(SessionProfile)(makeSessionProfileService(client))

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
      return yield* profiles.fromPartition(input)
    }),
  "SessionProfile.destroy": (input) =>
    Effect.gen(function* () {
      const profiles = yield* SessionProfile
      yield* profiles.destroy(input.profile)
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
  capabilities: SessionProfileMethodNames,
  handlers: SessionProfileHandlersLive,
  capabilityFacts: SessionProfileCapabilityFacts,
  client: (client) => sessionProfileClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => sessionProfileClientFromRpcClient(client, exchange)
})

export const makeHostSessionProfileRpcRuntime = (
  handlers: SessionProfileRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> =>
  SessionProfileSurface.hostRuntime(handlers, runtimeOptions)

export const makeSessionProfileMemoryClient = (): Effect.Effect<
  SessionProfileClientApi,
  never,
  never
> =>
  Effect.sync(() => {
    const profiles = new Map<string, SessionProfileHandle>()
    return Object.freeze({
      fromPartition: (input) =>
        decodeSessionProfileFromPartitionInput(input, "SessionProfile.fromPartition").pipe(
          Effect.map((valid) => {
            const id = `session-profile:${valid.partition}`
            const profile =
              profiles.get(id) ??
              Object.freeze({
                kind: "session-profile",
                id: makeResourceId(id),
                generation: 0,
                ownerScope: valid.ownerScope ?? "app",
                state: "open"
              } satisfies SessionProfileHandle)
            profiles.set(id, profile)
            return profile
          })
        ),
      destroy: (profile) =>
        decodeSessionProfileHandleInput({ profile }, "SessionProfile.destroy").pipe(
          Effect.map((valid) => {
            profiles.delete(valid.profile.id)
          })
        ),
      list: () =>
        Effect.succeed(new SessionProfileList({ profiles: Array.from(profiles.values()) })),
      isSupported: () => Effect.succeed(new SessionProfileSupportedResult({ supported: true })),
      events: () => Stream.empty
    } satisfies SessionProfileClientApi)
  })

export const makeSessionProfileUnsupportedClient = (): SessionProfileClientApi =>
  Object.freeze({
    fromPartition: () => Effect.fail(unsupportedError("SessionProfile.fromPartition")),
    destroy: () => Effect.fail(unsupportedError("SessionProfile.destroy")),
    list: () => Effect.fail(unsupportedError("SessionProfile.list")),
    isSupported: () =>
      Effect.succeed(
        new SessionProfileSupportedResult({ supported: false, reason: UnsupportedReason })
      ),
    events: () => Stream.fail(unsupportedError(EventMethod))
  } satisfies SessionProfileClientApi)

const makeSessionProfileService = (client: SessionProfileClientApi): SessionProfileServiceApi =>
  Object.freeze({
    fromPartition: (input) => client.fromPartition(input),
    destroy: (profile) => client.destroy(profile),
    list: () => client.list(),
    isSupported: () => client.isSupported(),
    events: () => client.events()
  } satisfies SessionProfileServiceApi)

const sessionProfileClientFromRpcClient = (
  client: DesktopRpcClient<SessionProfileRpc>,
  exchange: BridgeClientExchange | undefined
): SessionProfileClientApi =>
  Object.freeze({
    fromPartition: (input) =>
      decodeSessionProfileFromPartitionInput(input, "SessionProfile.fromPartition").pipe(
        Effect.flatMap((decoded) =>
          runSessionProfileRpc(
            client["SessionProfile.fromPartition"](decoded),
            "SessionProfile.fromPartition"
          )
        )
      ),
    destroy: (profile) =>
      decodeSessionProfileHandleInput({ profile }, "SessionProfile.destroy").pipe(
        Effect.flatMap((decoded) =>
          runSessionProfileRpc(client["SessionProfile.destroy"](decoded), "SessionProfile.destroy")
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

const decodeSessionProfileFromPartitionInput = (
  input: unknown,
  operation: string
): Effect.Effect<SessionProfileFromPartitionInput, SessionProfileError, never> =>
  decodeNativeInput(SessionProfileFromPartitionInput, input, operation)

const decodeSessionProfileHandleInput = (
  input: unknown,
  operation: string
): Effect.Effect<SessionProfileHandleInput, SessionProfileError, never> =>
  decodeNativeInput(SessionProfileHandleInput, input, operation)

const runSessionProfileRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, SessionProfileError, never> => runNativeRpc(effect, operation, Surface)

const unsupportedError = (operation: string): HostProtocolError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: UnsupportedReason,
    operation,
    recoverable: false
  })
