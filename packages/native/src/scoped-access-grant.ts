import { type HostProtocolError, HostProtocolUnsupportedError, RpcGroup } from "@orika/bridge"
import { type DesktopRpcClient, P } from "@orika/core"
import { Context, Effect, Schema, Stream } from "effect"

import { runNativeRpc, runNativeRpcStream } from "./native-client.js"
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

const UnsupportedCapabilityFacts = Object.freeze([
  scopedAccessGrantCapabilityFact("grant"),
  scopedAccessGrantCapabilityFact("resolve"),
  scopedAccessGrantCapabilityFact("revoke")
])

const ScopedAccessGrantEventStream = NativeSurface.event(Surface, "Event", {
  payload: ScopedAccessGrantEvent,
  support: UnsupportedSupport
})

const ScopedAccessGrantRpcGroup = RpcGroup.make(
  ScopedAccessGrantIsSupported,
  ScopedAccessGrantEventStream
)

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

export class ScopedAccessGrant extends Context.Service<
  ScopedAccessGrant,
  ScopedAccessGrantClientApi
>()("@orika/native/ScopedAccessGrant") {}

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
    }),
  "ScopedAccessGrant.events.Event": () =>
    Stream.unwrap(
      Effect.gen(function* () {
        const service = yield* ScopedAccessGrant
        return service.events()
      })
    )
})

export const ScopedAccessGrantSurface = NativeSurface.make(Surface, ScopedAccessGrantRpcGroup, {
  service: ScopedAccessGrant,
  handlers: ScopedAccessGrantHandlersLive,
  capabilityFacts: UnsupportedCapabilityFacts,
  client: (client) => scopedAccessGrantClientFromRpcClient(client),
  bridgeClient: (client) => scopedAccessGrantBridgeClientFromRpcClient(client)
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

const scopedAccessGrantClientFromRpcClient = (
  client: DesktopRpcClient<ScopedAccessGrantRpc>
): ScopedAccessGrantClientApi =>
  Object.freeze({
    isSupported: () =>
      runScopedAccessGrantRpc(
        client["ScopedAccessGrant.isSupported"](undefined),
        "ScopedAccessGrant.isSupported"
      ),
    events: () =>
      runScopedAccessGrantRpcStream(
        client["ScopedAccessGrant.events.Event"](undefined),
        "ScopedAccessGrant.events.Event"
      )
  } satisfies ScopedAccessGrantClientApi)

const scopedAccessGrantBridgeClientFromRpcClient = (
  client: DesktopRpcClient<ScopedAccessGrantRpc>
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

const runScopedAccessGrantRpcStream = <A, E>(
  stream: Stream.Stream<A, E, never>,
  operation: string
): Stream.Stream<A, ScopedAccessGrantError, never> => runNativeRpcStream(stream, operation, Surface)

const unsupportedError = (operation: string): HostProtocolError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: `unsupported ScopedAccessGrant method: ${operation}`,
    operation,
    recoverable: false
  })
