import {
  type HostProtocolError,
  HostProtocolInternalError,
  HostProtocolUnsupportedError,
  RpcGroup
} from "@orika/bridge"
import { type DesktopRpcClient, P } from "@orika/core"
import { Context, Effect, Schema, Stream } from "effect"

import {
  TransientWindowRoleEvent,
  TransientWindowRoleSupportedResult
} from "./contracts/transient-window-role.js"
import { runNativeRpc, runNativeRpcStream } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"
import type { NativeRpcHandlers } from "./native-surface.js"

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

export type TransientWindowRoleError = HostProtocolError

export const TransientWindowRoleIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: TransientWindowRoleSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

const transientWindowRoleCapabilityFact = (method: "open" | "reposition" | "dismiss") =>
  NativeSurface.capabilityFact(Surface, method, {
    authority: NativeSurface.authority.custom(
      P.nativeInvoke({ primitive: Surface, methods: [method] })
    ),
    support: UnsupportedSupport
  })

export const TransientWindowRoleCapabilityFacts = Object.freeze([
  transientWindowRoleCapabilityFact("open"),
  transientWindowRoleCapabilityFact("reposition"),
  transientWindowRoleCapabilityFact("dismiss")
])

const TransientWindowRoleEventStream = NativeSurface.event(Surface, "Event", {
  payload: TransientWindowRoleEvent,
  support: UnsupportedSupport
})

const TransientWindowRoleRpcGroup = RpcGroup.make(
  TransientWindowRoleIsSupported,
  TransientWindowRoleEventStream
)

export type TransientWindowRoleRpc = RpcGroup.Rpcs<typeof TransientWindowRoleRpcGroup>
export type TransientWindowRoleRpcHandlers<R = never> = NativeRpcHandlers<
  typeof TransientWindowRoleRpcGroup,
  R
>
export const TransientWindowRoleRpcs: RpcGroup.RpcGroup<TransientWindowRoleRpc> =
  TransientWindowRoleRpcGroup

export const TransientWindowRoleMethodNames = Object.freeze(["isSupported"] as const)

export interface TransientWindowRoleClientApi {
  readonly isSupported: () => Effect.Effect<
    TransientWindowRoleSupportedResult,
    TransientWindowRoleError,
    never
  >
  readonly events: () => Stream.Stream<TransientWindowRoleEvent, TransientWindowRoleError, never>
}

export class TransientWindowRole extends Context.Service<
  TransientWindowRole,
  TransientWindowRoleClientApi
>()("@orika/native/TransientWindowRole") {}

export const TransientWindowRoleHandlersLive = TransientWindowRoleRpcGroup.toLayer({
  "TransientWindowRole.isSupported": () =>
    Effect.gen(function* () {
      const service = yield* TransientWindowRole
      return yield* service.isSupported()
    }),
  "TransientWindowRole.events.Event": () =>
    Stream.unwrap(
      Effect.gen(function* () {
        const service = yield* TransientWindowRole
        return service.events()
      })
    )
})

export const TransientWindowRoleSurface = NativeSurface.make(Surface, TransientWindowRoleRpcGroup, {
  service: TransientWindowRole,
  handlers: TransientWindowRoleHandlersLive,
  capabilityFacts: TransientWindowRoleCapabilityFacts,
  client: (client) => transientWindowRoleClientFromRpcClient(client),
  bridgeClient: (client) => transientWindowRoleBridgeClientFromRpcClient(client)
})

export const makeTransientWindowRoleMemoryClient = (): Effect.Effect<
  TransientWindowRoleClientApi,
  never,
  never
> =>
  Effect.succeed(
    Object.freeze({
      isSupported: () =>
        Effect.succeed(new TransientWindowRoleSupportedResult({ supported: true })),
      events: () => Stream.empty
    } satisfies TransientWindowRoleClientApi)
  )

export const makeTransientWindowRoleUnsupportedClient = (): TransientWindowRoleClientApi =>
  Object.freeze({
    isSupported: () =>
      Effect.succeed(
        new TransientWindowRoleSupportedResult({ supported: false, reason: UnsupportedReason })
      ),
    events: () => Stream.fail(unsupportedError(EventMethod))
  } satisfies TransientWindowRoleClientApi)

const transientWindowRoleClientFromRpcClient = (
  client: DesktopRpcClient<TransientWindowRoleRpc>
): TransientWindowRoleClientApi =>
  Object.freeze({
    isSupported: () =>
      runTransientWindowRoleRpc(
        client["TransientWindowRole.isSupported"](undefined),
        "TransientWindowRole.isSupported"
      ),
    events: () =>
      runTransientWindowRoleRpcStream(
        client["TransientWindowRole.events.Event"](undefined),
        "TransientWindowRole.events.Event"
      )
  } satisfies TransientWindowRoleClientApi)

const transientWindowRoleBridgeClientFromRpcClient = (
  client: DesktopRpcClient<TransientWindowRoleRpc>
): TransientWindowRoleClientApi =>
  Object.freeze({
    isSupported: () =>
      runTransientWindowRoleRpc(
        client["TransientWindowRole.isSupported"](undefined),
        "TransientWindowRole.isSupported"
      ),
    events: () => Stream.fail(unsupportedError(EventMethod))
  } satisfies TransientWindowRoleClientApi)

const runTransientWindowRoleRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, TransientWindowRoleError, never> =>
  runNativeRpc(effect, operation, Surface).pipe(Effect.mapError(narrowTransientWindowRoleError))

const runTransientWindowRoleRpcStream = <A, E>(
  stream: Stream.Stream<A, E, never>,
  operation: string
): Stream.Stream<A, TransientWindowRoleError, never> =>
  runNativeRpcStream(stream, operation, Surface).pipe(
    Stream.mapError(narrowTransientWindowRoleError)
  )

const unsupportedError = (operation: string): HostProtocolError =>
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
  return new HostProtocolInternalError({
    tag: "Internal",
    message: `unexpected transient window role host failure: ${error.tag}`,
    operation: error.operation,
    recoverable: false
  })
}
