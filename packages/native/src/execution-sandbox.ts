import { type HostProtocolError, HostProtocolUnsupportedError, RpcGroup } from "@orika/bridge"
import { type DesktopRpcClient, P } from "@orika/core"
import { Context, Effect, Schema, Stream } from "effect"

import { runNativeRpc, runNativeRpcStream } from "./native-client.js"
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

const UnsupportedCapabilityFacts = Object.freeze([
  executionSandboxCapabilityFact("create"),
  executionSandboxCapabilityFact("run"),
  executionSandboxCapabilityFact("destroy")
])

const ExecutionSandboxEventStream = NativeSurface.event(Surface, "Event", {
  payload: ExecutionSandboxEvent,
  support: UnsupportedSupport
})

const ExecutionSandboxRpcGroup = RpcGroup.make(
  ExecutionSandboxIsSupported,
  ExecutionSandboxEventStream
)

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

export class ExecutionSandbox extends Context.Service<
  ExecutionSandbox,
  ExecutionSandboxClientApi
>()("@orika/native/ExecutionSandbox") {}

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
    }),
  "ExecutionSandbox.events.Event": () =>
    Stream.unwrap(
      Effect.gen(function* () {
        const sandbox = yield* ExecutionSandbox
        return sandbox.events()
      })
    )
})

export const ExecutionSandboxSurface = NativeSurface.make(Surface, ExecutionSandboxRpcGroup, {
  service: ExecutionSandbox,
  handlers: ExecutionSandboxHandlersLive,
  capabilityFacts: UnsupportedCapabilityFacts,
  client: (client) => executionSandboxClientFromRpcClient(client),
  bridgeClient: (client) => executionSandboxBridgeClientFromRpcClient(client)
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

const executionSandboxClientFromRpcClient = (
  client: DesktopRpcClient<ExecutionSandboxRpc>
): ExecutionSandboxClientApi =>
  Object.freeze({
    isSupported: () =>
      runExecutionSandboxRpc(
        client["ExecutionSandbox.isSupported"](undefined),
        "ExecutionSandbox.isSupported"
      ),
    events: () =>
      runExecutionSandboxRpcStream(
        client["ExecutionSandbox.events.Event"](undefined),
        "ExecutionSandbox.events.Event"
      )
  } satisfies ExecutionSandboxClientApi)

const executionSandboxBridgeClientFromRpcClient = (
  client: DesktopRpcClient<ExecutionSandboxRpc>
): ExecutionSandboxClientApi =>
  Object.freeze({
    ...executionSandboxClientFromRpcClient(client),
    events: () => Stream.fail(unsupportedError(ExecutionSandboxEventMethod))
  } satisfies ExecutionSandboxClientApi)

const runExecutionSandboxRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, ExecutionSandboxError, never> => runNativeRpc(effect, operation, Surface)

const runExecutionSandboxRpcStream = <A, E>(
  stream: Stream.Stream<A, E, never>,
  operation: string
): Stream.Stream<A, ExecutionSandboxError, never> => runNativeRpcStream(stream, operation, Surface)

const unsupportedError = (operation: string): HostProtocolError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: `unsupported ExecutionSandbox method: ${operation}`,
    operation,
    recoverable: false
  })
