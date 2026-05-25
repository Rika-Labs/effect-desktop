import { HostProtocolUnsupportedError, type HostProtocolError, RpcGroup } from "@orika/bridge"
import { type DesktopRpcClient, P } from "@orika/core"
import { Clock, Context, Effect, Schema, Stream } from "effect"

import {
  FocusedApplicationContextEvent,
  FocusedApplicationContextSnapshotInput,
  FocusedApplicationContextSnapshotResult,
  FocusedApplicationContextSupportedResult,
  FocusedApplicationMetadata,
  FocusedDisplayMetadata,
  FocusedWindowMetadata
} from "./contracts/focused-application-context.js"
import { decodeNativeInput, runNativeRpc, runNativeRpcStream } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"
import type { NativeRpcHandlers } from "./native-surface.js"

export * from "./contracts/focused-application-context.js"

const Surface = "FocusedApplicationContext"
const UnsupportedReason = "host-adapter-unimplemented"
const MacOsSnapshotReason = "macos-frontmost-application-only"
const FocusedApplicationContextEventMethod = "FocusedApplicationContext.Event"
const UnsupportedSupport = NativeSurface.support.unsupported(UnsupportedReason, {
  platforms: [
    { platform: "macos", status: "unsupported", reason: UnsupportedReason },
    { platform: "windows", status: "unsupported", reason: UnsupportedReason },
    { platform: "linux", status: "unsupported", reason: UnsupportedReason }
  ]
})
const SnapshotSupport = NativeSurface.support.partial(MacOsSnapshotReason, {
  platforms: [
    { platform: "macos", status: "partial", reason: MacOsSnapshotReason },
    { platform: "windows", status: "unsupported", reason: UnsupportedReason },
    { platform: "linux", status: "unsupported", reason: UnsupportedReason }
  ]
})

export type FocusedApplicationContextError = HostProtocolError

export const FocusedApplicationContextSnapshot = NativeSurface.rpc(Surface, "snapshot", {
  payload: FocusedApplicationContextSnapshotInput,
  success: FocusedApplicationContextSnapshotResult,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["snapshot"] })
  ),
  endpoint: "query",
  support: SnapshotSupport
})
export const FocusedApplicationContextIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: FocusedApplicationContextSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

const focusedApplicationContextCapabilityFact = (method: "watch" | "stopWatching") =>
  NativeSurface.capabilityFact(Surface, method, {
    authority: NativeSurface.authority.custom(
      P.nativeInvoke({ primitive: Surface, methods: [method] })
    ),
    support: UnsupportedSupport
  })

const UnsupportedCapabilityFacts = Object.freeze([
  focusedApplicationContextCapabilityFact("watch"),
  focusedApplicationContextCapabilityFact("stopWatching")
])

const FocusedApplicationContextEventStream = NativeSurface.event(Surface, "Event", {
  payload: FocusedApplicationContextEvent,
  support: UnsupportedSupport
})

const FocusedApplicationContextRpcGroup = RpcGroup.make(
  FocusedApplicationContextSnapshot,
  FocusedApplicationContextIsSupported,
  FocusedApplicationContextEventStream
)

export const FocusedApplicationContextRpcs: RpcGroup.RpcGroup<FocusedApplicationContextRpc> =
  FocusedApplicationContextRpcGroup

export const FocusedApplicationContextMethodNames = Object.freeze([
  "snapshot",
  "isSupported"
] as const)

export interface FocusedApplicationContextClientApi {
  readonly snapshot: (
    input: FocusedApplicationContextSnapshotInput
  ) => Effect.Effect<FocusedApplicationContextSnapshotResult, FocusedApplicationContextError, never>
  readonly isSupported: () => Effect.Effect<
    FocusedApplicationContextSupportedResult,
    FocusedApplicationContextError,
    never
  >
  readonly events: () => Stream.Stream<
    FocusedApplicationContextEvent,
    FocusedApplicationContextError,
    never
  >
}

export class FocusedApplicationContext extends Context.Service<
  FocusedApplicationContext,
  FocusedApplicationContextClientApi
>()("@orika/native/FocusedApplicationContext") {}

export type FocusedApplicationContextRpc = RpcGroup.Rpcs<typeof FocusedApplicationContextRpcGroup>
export type FocusedApplicationContextRpcHandlers<R = never> = NativeRpcHandlers<
  typeof FocusedApplicationContextRpcGroup,
  R
>

export const FocusedApplicationContextHandlersLive = FocusedApplicationContextRpcGroup.toLayer({
  "FocusedApplicationContext.snapshot": (input) =>
    Effect.gen(function* () {
      const service = yield* FocusedApplicationContext
      return yield* service.snapshot(input)
    }),
  "FocusedApplicationContext.isSupported": () =>
    Effect.gen(function* () {
      const service = yield* FocusedApplicationContext
      return yield* service.isSupported()
    }),
  "FocusedApplicationContext.events.Event": () =>
    Stream.unwrap(
      Effect.gen(function* () {
        const service = yield* FocusedApplicationContext
        return service.events()
      })
    )
})

export const FocusedApplicationContextSurface = NativeSurface.make(
  Surface,
  FocusedApplicationContextRpcGroup,
  {
    service: FocusedApplicationContext,
    handlers: FocusedApplicationContextHandlersLive,
    capabilityFacts: UnsupportedCapabilityFacts,
    client: (client) => focusedApplicationContextClientFromRpcClient(client),
    bridgeClient: (client) => focusedApplicationContextBridgeClientFromRpcClient(client)
  }
)

export interface FocusedApplicationContextMemoryClientOptions {
  readonly failure?: Partial<Record<"snapshot", FocusedApplicationContextError>>
}

export const makeFocusedApplicationContextMemoryClient = (
  options: FocusedApplicationContextMemoryClientOptions = {}
): Effect.Effect<FocusedApplicationContextClientApi, never, never> =>
  Effect.succeed(
    Object.freeze({
      snapshot: (input) =>
        validateSnapshotInput(input).pipe(
          Effect.flatMap((valid) => failOr(options.failure?.snapshot, snapshotResult(valid)))
        ),
      isSupported: () =>
        Effect.succeed(new FocusedApplicationContextSupportedResult({ supported: true })),
      events: () => Stream.empty
    } satisfies FocusedApplicationContextClientApi)
  )

export const makeFocusedApplicationContextUnsupportedClient =
  (): FocusedApplicationContextClientApi =>
    Object.freeze({
      snapshot: (input) =>
        validateSnapshotInput(input).pipe(
          Effect.flatMap(() => Effect.fail(unsupportedError("FocusedApplicationContext.snapshot")))
        ),
      isSupported: () =>
        Effect.succeed(
          new FocusedApplicationContextSupportedResult({
            supported: false,
            reason: UnsupportedReason
          })
        ),
      events: () => Stream.fail(unsupportedError(FocusedApplicationContextEventMethod))
    } satisfies FocusedApplicationContextClientApi)

const focusedApplicationContextClientFromRpcClient = (
  client: DesktopRpcClient<FocusedApplicationContextRpc>
): FocusedApplicationContextClientApi =>
  Object.freeze({
    snapshot: (input) =>
      validateSnapshotInput(input).pipe(
        Effect.flatMap((valid) =>
          runFocusedApplicationContextRpc(
            client["FocusedApplicationContext.snapshot"](valid),
            "FocusedApplicationContext.snapshot"
          )
        )
      ),
    isSupported: () =>
      runFocusedApplicationContextRpc(
        client["FocusedApplicationContext.isSupported"](undefined),
        "FocusedApplicationContext.isSupported"
      ),
    events: () =>
      runFocusedApplicationContextRpcStream(
        client["FocusedApplicationContext.events.Event"](undefined),
        "FocusedApplicationContext.events.Event"
      )
  } satisfies FocusedApplicationContextClientApi)

const focusedApplicationContextBridgeClientFromRpcClient = (
  client: DesktopRpcClient<FocusedApplicationContextRpc>
): FocusedApplicationContextClientApi =>
  Object.freeze({
    snapshot: (input) =>
      validateSnapshotInput(input).pipe(
        Effect.flatMap((valid) =>
          runFocusedApplicationContextRpc(
            client["FocusedApplicationContext.snapshot"](valid),
            "FocusedApplicationContext.snapshot"
          )
        )
      ),
    isSupported: () =>
      runFocusedApplicationContextRpc(
        client["FocusedApplicationContext.isSupported"](undefined),
        "FocusedApplicationContext.isSupported"
      ),
    events: () => Stream.fail(unsupportedError(FocusedApplicationContextEventMethod))
  } satisfies FocusedApplicationContextClientApi)

const runFocusedApplicationContextRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, FocusedApplicationContextError, never> =>
  runNativeRpc(effect, operation, Surface)

const runFocusedApplicationContextRpcStream = <A, E>(
  stream: Stream.Stream<A, E, never>,
  operation: string
): Stream.Stream<A, FocusedApplicationContextError, never> =>
  runNativeRpcStream(stream, operation, Surface)

const validateSnapshotInput = (input: unknown) =>
  decodeNativeInput(
    FocusedApplicationContextSnapshotInput,
    input,
    "FocusedApplicationContext.snapshot"
  )

const snapshotResult = (
  _input: FocusedApplicationContextSnapshotInput
): Effect.Effect<FocusedApplicationContextSnapshotResult, never, never> =>
  Clock.currentTimeMillis.pipe(
    Effect.map(
      (observedAt) =>
        new FocusedApplicationContextSnapshotResult({
          application: new FocusedApplicationMetadata({
            applicationId: "memory-app",
            name: "Memory App",
            bundleId: "dev.effect.memory-app",
            processId: 42
          }),
          window: new FocusedWindowMetadata({
            windowId: "memory-window",
            title: "Memory Window",
            displayId: "display-1"
          }),
          display: new FocusedDisplayMetadata({ displayId: "display-1", scaleFactor: 2 }),
          observedAt
        })
    )
  )

const unsupportedError = (operation: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: `unsupported FocusedApplicationContext method: ${operation}`,
    operation,
    recoverable: false
  })

const failOr = <A>(
  error: FocusedApplicationContextError | undefined,
  effect: Effect.Effect<A, FocusedApplicationContextError, never>
): Effect.Effect<A, FocusedApplicationContextError, never> =>
  error === undefined ? effect : Effect.fail(error)
