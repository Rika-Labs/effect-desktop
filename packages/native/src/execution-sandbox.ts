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
  ExecutionSandboxEvent,
  ExecutionSandboxSupportedResult
} from "./contracts/execution-sandbox.js"

const Surface = "ExecutionSandbox"
const UnsupportedReason = "host-adapter-unimplemented"
const ExecutionSandboxEventMethod = "ExecutionSandbox.Event"
const UnsupportedSupport = NativeSurface.support.unsupported(UnsupportedReason, {
  platforms: [
    { platform: "macos", status: "unsupported", reason: UnsupportedReason },
    { platform: "windows", status: "unsupported", reason: UnsupportedReason },
    { platform: "linux", status: "unsupported", reason: UnsupportedReason }
  ]
})

export type ExecutionSandboxError = HostProtocolError

export const ExecutionSandboxIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: ExecutionSandboxSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

const executionSandboxCapabilityFact = (method: "create" | "run" | "destroy") =>
  NativeSurface.capabilityFact(Surface, method, {
    authority: NativeSurface.authority.custom(
      P.nativeInvoke({ primitive: Surface, methods: [method] })
    ),
    support: UnsupportedSupport
  })

export const ExecutionSandboxCapabilityFacts = Object.freeze([
  executionSandboxCapabilityFact("create"),
  executionSandboxCapabilityFact("run"),
  executionSandboxCapabilityFact("destroy")
])

export const ExecutionSandboxRpcEvents = Object.freeze({
  Event: { payload: ExecutionSandboxEvent }
})

export type ExecutionSandboxRpcEvents = typeof ExecutionSandboxRpcEvents

const ExecutionSandboxRpcGroup = RpcGroup.make(ExecutionSandboxIsSupported)

export const ExecutionSandboxRpcs: RpcGroup.RpcGroup<ExecutionSandboxRpc> = ExecutionSandboxRpcGroup

export const ExecutionSandboxMethodNames = Object.freeze(["isSupported"] as const)

export interface ExecutionSandboxClientApi {
  readonly isSupported: () => Effect.Effect<
    ExecutionSandboxSupportedResult,
    ExecutionSandboxError,
    never
  >
  readonly events: () => Stream.Stream<ExecutionSandboxEvent, ExecutionSandboxError, never>
}

export class ExecutionSandboxClient extends Context.Service<
  ExecutionSandboxClient,
  ExecutionSandboxClientApi
>()("@orika/native/ExecutionSandboxClient") {}

export interface ExecutionSandboxServiceApi {
  readonly isSupported: () => Effect.Effect<
    ExecutionSandboxSupportedResult,
    ExecutionSandboxError,
    never
  >
  readonly events: () => Stream.Stream<ExecutionSandboxEvent, ExecutionSandboxError, never>
}

export class ExecutionSandbox extends Context.Service<
  ExecutionSandbox,
  ExecutionSandboxServiceApi
>()("@orika/native/ExecutionSandbox") {
  static readonly layer = Layer.effect(ExecutionSandbox)(
    Effect.gen(function* () {
      const client = yield* ExecutionSandboxClient
      return makeExecutionSandboxService(client)
    })
  )
}

export const ExecutionSandboxLive = ExecutionSandbox.layer

export type ExecutionSandboxRpc = RpcGroup.Rpcs<typeof ExecutionSandboxRpcGroup>

export type ExecutionSandboxRpcHandlers<R = never> = NativeRpcHandlers<
  typeof ExecutionSandboxRpcGroup,
  R
>

export const ExecutionSandboxHandlersLive = ExecutionSandboxRpcGroup.toLayer({
  "ExecutionSandbox.isSupported": () =>
    Effect.gen(function* () {
      const sandbox = yield* ExecutionSandbox
      return yield* sandbox.isSupported()
    })
})

export const ExecutionSandboxSurface = NativeSurface.make(Surface, ExecutionSandboxRpcGroup, {
  service: ExecutionSandboxClient,
  handlers: ExecutionSandboxHandlersLive,
  capabilityFacts: ExecutionSandboxCapabilityFacts,
  client: (client) => executionSandboxClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => executionSandboxClientFromRpcClient(client, exchange)
})

export const makeExecutionSandboxMemoryClient = (): Effect.Effect<
  ExecutionSandboxClientApi,
  never,
  never
> =>
  Effect.succeed(
    Object.freeze({
      isSupported: () => Effect.succeed(new ExecutionSandboxSupportedResult({ supported: true })),
      events: () => Stream.empty
    } satisfies ExecutionSandboxClientApi)
  )

export const makeExecutionSandboxUnsupportedClient = (): ExecutionSandboxClientApi =>
  Object.freeze({
    isSupported: () =>
      Effect.succeed(
        new ExecutionSandboxSupportedResult({
          supported: false,
          reason: UnsupportedReason
        })
      ),
    events: () => Stream.fail(unsupportedError(ExecutionSandboxEventMethod))
  } satisfies ExecutionSandboxClientApi)

const makeExecutionSandboxService = (
  client: ExecutionSandboxClientApi
): ExecutionSandboxServiceApi =>
  Object.freeze({
    isSupported: () => client.isSupported(),
    events: () => client.events()
  } satisfies ExecutionSandboxServiceApi)

const executionSandboxClientFromRpcClient = (
  client: DesktopRpcClient<ExecutionSandboxRpc>,
  _exchange: BridgeClientExchange | undefined
): ExecutionSandboxClientApi =>
  Object.freeze({
    isSupported: () =>
      runExecutionSandboxRpc(
        client["ExecutionSandbox.isSupported"](undefined),
        "ExecutionSandbox.isSupported"
      ),
    events: () => Stream.fail(unsupportedError(ExecutionSandboxEventMethod))
  } satisfies ExecutionSandboxClientApi)

const runExecutionSandboxRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, ExecutionSandboxError, never> => runNativeRpc(effect, operation, Surface)

const unsupportedError = (operation: string): HostProtocolError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: `unsupported ExecutionSandbox method: ${operation}`,
    operation,
    recoverable: false
  })
