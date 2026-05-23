import {
  type BridgeClientExchange,
  type HostProtocolError,
  HostProtocolUnsupportedError,
  RpcGroup
} from "@orika/bridge"
import { type DesktopRpcClient, P } from "@orika/core"
import { Context, Effect, Layer, Schema, Stream } from "effect"

import { runNativeRpc } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"
import type { NativeRpcHandlers } from "./native-surface.js"
import {
  ScopedAccessGrantEvent,
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

export const ScopedAccessGrantIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: ScopedAccessGrantSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

const scopedAccessGrantCapabilityFact = (method: "grant" | "resolve" | "revoke") =>
  NativeSurface.capabilityFact(Surface, method, {
    authority: NativeSurface.authority.custom(
      P.nativeInvoke({ primitive: Surface, methods: [method] })
    ),
    support: UnsupportedSupport
  })

export const ScopedAccessGrantCapabilityFacts = Object.freeze([
  scopedAccessGrantCapabilityFact("grant"),
  scopedAccessGrantCapabilityFact("resolve"),
  scopedAccessGrantCapabilityFact("revoke")
])

export const ScopedAccessGrantRpcEvents = Object.freeze({
  Event: { payload: ScopedAccessGrantEvent }
})

const ScopedAccessGrantRpcGroup = RpcGroup.make(ScopedAccessGrantIsSupported)

export const ScopedAccessGrantRpcs: RpcGroup.RpcGroup<ScopedAccessGrantRpc> =
  ScopedAccessGrantRpcGroup

export const ScopedAccessGrantMethodNames = Object.freeze(["isSupported"] as const)

export interface ScopedAccessGrantClientApi {
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
>()("@orika/native/ScopedAccessGrantClient") {}

export interface ScopedAccessGrantServiceApi {
  readonly isSupported: () => Effect.Effect<
    ScopedAccessGrantSupportedResult,
    ScopedAccessGrantError,
    never
  >
  readonly events: () => Stream.Stream<ScopedAccessGrantEvent, ScopedAccessGrantError, never>
}

export class ScopedAccessGrant extends Context.Service<
  ScopedAccessGrant,
  ScopedAccessGrantServiceApi
>()("@orika/native/ScopedAccessGrant") {
  static readonly layer = Layer.effect(ScopedAccessGrant)(
    Effect.gen(function* () {
      const client = yield* ScopedAccessGrantClient
      return makeScopedAccessGrantService(client)
    })
  )
}

export const ScopedAccessGrantLive = ScopedAccessGrant.layer

export type ScopedAccessGrantRpc = RpcGroup.Rpcs<typeof ScopedAccessGrantRpcGroup>

export type ScopedAccessGrantRpcHandlers<R = never> = NativeRpcHandlers<
  typeof ScopedAccessGrantRpcGroup,
  R
>

export const ScopedAccessGrantHandlersLive = ScopedAccessGrantRpcGroup.toLayer({
  "ScopedAccessGrant.isSupported": () =>
    Effect.gen(function* () {
      const service = yield* ScopedAccessGrant
      return yield* service.isSupported()
    })
})

export const ScopedAccessGrantSurface = NativeSurface.make(Surface, ScopedAccessGrantRpcGroup, {
  service: ScopedAccessGrantClient,
  handlers: ScopedAccessGrantHandlersLive,
  capabilityFacts: ScopedAccessGrantCapabilityFacts,
  client: (client) => scopedAccessGrantClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => scopedAccessGrantClientFromRpcClient(client, exchange)
})

export const makeScopedAccessGrantMemoryClient = (): Effect.Effect<
  ScopedAccessGrantClientApi,
  never,
  never
> =>
  Effect.succeed(
    Object.freeze({
      isSupported: () => Effect.succeed(new ScopedAccessGrantSupportedResult({ supported: true })),
      events: () => Stream.empty
    } satisfies ScopedAccessGrantClientApi)
  )

export const makeScopedAccessGrantUnsupportedClient = (): ScopedAccessGrantClientApi =>
  Object.freeze({
    isSupported: () =>
      Effect.succeed(
        new ScopedAccessGrantSupportedResult({ supported: false, reason: UnsupportedReason })
      ),
    events: () => Stream.fail(unsupportedError(ScopedAccessGrantEventMethod))
  } satisfies ScopedAccessGrantClientApi)

const makeScopedAccessGrantService = (
  client: ScopedAccessGrantClientApi
): ScopedAccessGrantServiceApi =>
  Object.freeze({
    isSupported: () => client.isSupported(),
    events: () => client.events()
  } satisfies ScopedAccessGrantServiceApi)

const scopedAccessGrantClientFromRpcClient = (
  client: DesktopRpcClient<ScopedAccessGrantRpc>,
  _exchange: BridgeClientExchange | undefined
): ScopedAccessGrantClientApi =>
  Object.freeze({
    isSupported: () =>
      runScopedAccessGrantRpc(
        client["ScopedAccessGrant.isSupported"](undefined),
        "ScopedAccessGrant.isSupported"
      ),
    events: () => Stream.fail(unsupportedError(ScopedAccessGrantEventMethod))
  } satisfies ScopedAccessGrantClientApi)

const runScopedAccessGrantRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, ScopedAccessGrantError, never> => runNativeRpc(effect, operation, Surface)

const unsupportedError = (operation: string): HostProtocolError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: `unsupported ScopedAccessGrant method: ${operation}`,
    operation,
    recoverable: false
  })
