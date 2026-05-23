import {
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  HostProtocolUnsupportedError,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  type RpcCapabilityMetadata,
  type RpcSupportMetadata,
  RpcGroup,
  type HostProtocolError
} from "@orika/bridge"
import { type PermissionRegistry, P, type DesktopRpcClient } from "@orika/core"
import { Context, Effect, Layer, Schema } from "effect"

import { NativeSurface } from "./native-surface.js"
import {
  type DockMethod,
  DockIsSupportedInput,
  DockRequestAttentionInput,
  DockSetBadgeCountInput,
  DockSetBadgeTextInput,
  DockSetProgressInput,
  DockSupportedResult
} from "./contracts/dock.js"

const StrictParseOptions = { onExcessProperty: "error" } as const

export type DockError = HostProtocolError

type DockMethodName =
  | "setBadgeCount"
  | "setBadgeText"
  | "setProgress"
  | "requestAttention"
  | "isSupported"

type DockCapabilityMethod = "setMenu" | "setJumpList"

const DOCK_PLATFORM_VARIANCE_REASON = "dock behavior is platform-specific"
const DOCK_UNSUPPORTED_REASON = "host adapter does not implement this Dock method on any platform"
const DOCK_WINDOWS_BADGE_REASON = "Windows taskbar badges require jump-list/taskbar integration"
const DOCK_LINUX_BADGE_REASON = "Linux launcher badge labels are not wired in the host adapter"
const DOCK_LINUX_BADGE_TEXT_REASON = "Linux host only exposes numeric launcher badge labels"

const DockSupportByMethod = Object.freeze({
  setBadgeCount: NativeSurface.support.partial(DOCK_PLATFORM_VARIANCE_REASON, {
    platforms: [
      { platform: "macos", status: "supported" },
      { platform: "linux", status: "unsupported", reason: DOCK_LINUX_BADGE_REASON },
      { platform: "windows", status: "unsupported", reason: DOCK_WINDOWS_BADGE_REASON }
    ]
  }),
  setBadgeText: NativeSurface.support.partial(DOCK_PLATFORM_VARIANCE_REASON, {
    platforms: [
      { platform: "macos", status: "supported" },
      { platform: "linux", status: "unsupported", reason: DOCK_LINUX_BADGE_TEXT_REASON },
      { platform: "windows", status: "unsupported", reason: DOCK_WINDOWS_BADGE_REASON }
    ]
  }),
  setProgress: NativeSurface.support.supported,
  requestAttention: NativeSurface.support.supported,
  isSupported: NativeSurface.support.supported
} satisfies Record<DockMethodName, RpcSupportMetadata>)

const DockUnsupportedSupport = NativeSurface.support.unsupported(DOCK_UNSUPPORTED_REASON, {
  platforms: [
    { platform: "macos", status: "unsupported", reason: DOCK_UNSUPPORTED_REASON },
    { platform: "linux", status: "unsupported", reason: DOCK_UNSUPPORTED_REASON },
    { platform: "windows", status: "unsupported", reason: DOCK_UNSUPPORTED_REASON }
  ]
})

export const DockSetBadgeCount = dockRpc(
  "setBadgeCount",
  DockSetBadgeCountInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Dock", methods: ["setBadgeCount"] })
)
export const DockSetBadgeText = dockRpc(
  "setBadgeText",
  DockSetBadgeTextInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Dock", methods: ["setBadgeText"] })
)
export const DockSetProgress = dockRpc(
  "setProgress",
  DockSetProgressInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Dock", methods: ["setProgress"] })
)
export const DockRequestAttention = dockRpc(
  "requestAttention",
  DockRequestAttentionInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Dock", methods: ["requestAttention"] })
)
export const DockIsSupported = dockRpc("isSupported", DockIsSupportedInput, DockSupportedResult, {
  kind: "none"
})

const dockCapabilityFact = (method: DockCapabilityMethod) =>
  NativeSurface.capabilityFact("Dock", method, {
    authority: NativeSurface.authority.custom(
      P.nativeInvoke({ primitive: "Dock", methods: [method] })
    ),
    support: DockUnsupportedSupport
  })

export const DockCapabilityFacts = Object.freeze([
  dockCapabilityFact("setMenu"),
  dockCapabilityFact("setJumpList")
])

export const DockRpcEvents = Object.freeze({})

export type DockRpcEvents = typeof DockRpcEvents

const DockRpcGroup = RpcGroup.make(
  DockSetBadgeCount,
  DockSetBadgeText,
  DockSetProgress,
  DockRequestAttention,
  DockIsSupported
)

export const DockRpcs: RpcGroup.RpcGroup<DockRpc> = DockRpcGroup

export const DockMethodNames = Object.freeze([
  "setBadgeCount",
  "setBadgeText",
  "setProgress",
  "requestAttention",
  "isSupported"
] as const satisfies readonly DockMethodName[])

const DockCapabilityMethods = Object.freeze([
  "setBadgeCount",
  "setBadgeText",
  "setProgress",
  "requestAttention"
] as const satisfies readonly (typeof DockMethodNames)[number][])

export interface DockClientApi {
  readonly setBadgeCount: (count: number) => Effect.Effect<void, DockError, never>
  readonly setBadgeText: (text: string | null) => Effect.Effect<void, DockError, never>
  readonly setProgress: (
    value: number | null,
    options?: { readonly state?: "normal" | "indeterminate" | "error" | "paused" }
  ) => Effect.Effect<void, DockError, never>
  readonly requestAttention: (options?: {
    readonly critical?: boolean
  }) => Effect.Effect<void, DockError, never>
  readonly isSupported: (method: DockMethod) => Effect.Effect<DockSupportedResult, DockError, never>
}

export class DockClient extends Context.Service<DockClient, DockClientApi>()(
  "@orika/native/DockClient"
) {}

export interface DockServiceApi extends Omit<DockClientApi, "isSupported"> {
  readonly isSupported: (method: DockMethod) => Effect.Effect<boolean, DockError, never>
}

export class Dock extends Context.Service<Dock, DockServiceApi>()("@orika/native/Dock") {
  static readonly layer = Layer.effect(Dock)(
    Effect.gen(function* () {
      const client = yield* DockClient
      return Dock.of({
        setBadgeCount: (count) => client.setBadgeCount(count),
        setBadgeText: (text) => client.setBadgeText(text),
        setProgress: (value, options) => client.setProgress(value, options),
        requestAttention: (options) => client.requestAttention(options),
        isSupported: (method) =>
          client.isSupported(method).pipe(Effect.map((result) => result.supported))
      } satisfies DockServiceApi)
    })
  )
}

export const DockLive = Dock.layer

export type DockRpc = RpcGroup.Rpcs<typeof DockRpcGroup>

export type DockRpcHandlers = RpcGroup.HandlersFrom<DockRpc>

export const DockHandlersLive = DockRpcGroup.toLayer({
  "Dock.setBadgeCount": (input) =>
    Effect.gen(function* () {
      const dock = yield* Dock
      yield* dock.setBadgeCount(input.count)
    }),
  "Dock.setBadgeText": (input) =>
    Effect.gen(function* () {
      const dock = yield* Dock
      yield* dock.setBadgeText(input.text)
    }),
  "Dock.setProgress": (input) =>
    Effect.gen(function* () {
      const dock = yield* Dock
      yield* dock.setProgress(input.value, input.options)
    }),
  "Dock.requestAttention": (input) =>
    Effect.gen(function* () {
      const dock = yield* Dock
      yield* dock.requestAttention(input)
    }),
  "Dock.isSupported": (input) =>
    Effect.gen(function* () {
      const dock = yield* Dock
      const supported = yield* dock.isSupported(input.method)
      return new DockSupportedResult({ supported })
    })
})

export const DockSurface = NativeSurface.make("Dock", DockRpcGroup, {
  service: DockClient,
  capabilities: DockCapabilityMethods,
  handlers: DockHandlersLive,
  capabilityFacts: DockCapabilityFacts,
  client: (client) => dockClientFromRpcClient(client)
})

export const makeHostDockRpcRuntime = (
  handlers: DockRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> => DockSurface.hostRuntime(handlers, runtimeOptions)

const dockClientFromRpcClient = (client: DesktopRpcClient<DockRpc>): DockClientApi => {
  return Object.freeze({
    setBadgeCount: (count) =>
      decodeDockSetBadgeCountInput({ count }).pipe(
        Effect.flatMap((decoded) =>
          runDockRpc(client["Dock.setBadgeCount"](decoded), "Dock.setBadgeCount")
        )
      ),
    setBadgeText: (text) =>
      decodeDockSetBadgeTextInput({ text }).pipe(
        Effect.flatMap((decoded) =>
          runDockRpc(client["Dock.setBadgeText"](decoded), "Dock.setBadgeText")
        )
      ),
    setProgress: (value, options) =>
      decodeDockSetProgressInput({
        value,
        ...(options?.state === undefined ? {} : { options })
      }).pipe(
        Effect.flatMap((decoded) =>
          runDockRpc(client["Dock.setProgress"](decoded), "Dock.setProgress")
        )
      ),
    requestAttention: (options) =>
      decodeDockRequestAttentionInput(options ?? {}).pipe(
        Effect.flatMap((decoded) =>
          runDockRpc(client["Dock.requestAttention"](decoded), "Dock.requestAttention")
        )
      ),
    isSupported: (method) =>
      decodeDockIsSupportedInput({ method }).pipe(
        Effect.flatMap((decoded) =>
          runDockRpc(client["Dock.isSupported"](decoded), "Dock.isSupported")
        )
      )
  } satisfies DockClientApi)
}

export const makeLinuxDockClient = (): DockClientApi => {
  const unsupportedEffect = <A>(
    method: string,
    reason: string
  ): Effect.Effect<A, DockError, never> => Effect.fail(unsupportedError(method, reason))
  return Object.freeze({
    setBadgeCount: () =>
      unsupportedEffect<void>("Dock.setBadgeCount", "launcher badge API is not connected yet"),
    setBadgeText: () =>
      unsupportedEffect<void>("Dock.setBadgeText", "no portable badge text on Linux"),
    setProgress: () =>
      unsupportedEffect<void>("Dock.setProgress", "launcher progress API is not connected yet"),
    requestAttention: () => Effect.void,
    isSupported: (method) =>
      Effect.succeed(new DockSupportedResult({ supported: method === "requestAttention" }))
  } satisfies DockClientApi)
}

const unsupportedError = (method: string, reason: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason,
    message: `unsupported Dock method: ${method}`,
    operation: method,
    recoverable: false
  })

const decodeDockSetBadgeCountInput = (
  input: unknown
): Effect.Effect<DockSetBadgeCountInput, DockError, never> =>
  decodeInput(DockSetBadgeCountInput, input, "Dock.setBadgeCount")

const decodeDockSetBadgeTextInput = (
  input: unknown
): Effect.Effect<DockSetBadgeTextInput, DockError, never> =>
  decodeInput(DockSetBadgeTextInput, input, "Dock.setBadgeText")

const decodeDockSetProgressInput = (
  input: unknown
): Effect.Effect<DockSetProgressInput, DockError, never> =>
  decodeInput(DockSetProgressInput, input, "Dock.setProgress")

const decodeDockRequestAttentionInput = (
  input: unknown
): Effect.Effect<DockRequestAttentionInput, DockError, never> =>
  decodeInput(DockRequestAttentionInput, input, "Dock.requestAttention")

const decodeDockIsSupportedInput = (
  input: unknown
): Effect.Effect<DockIsSupportedInput, DockError, never> =>
  decodeInput(DockIsSupportedInput, input, "Dock.isSupported")

const decodeInput = <A>(
  schema: Schema.Codec<A, unknown, never, never>,
  input: unknown,
  operation: string
): Effect.Effect<A, DockError, never> =>
  Schema.decodeUnknownEffect(schema)(input, StrictParseOptions).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

function dockRpc<
  const Method extends DockMethodName,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(method: Method, payload: Payload, success: Success, capability: RpcCapabilityMetadata) {
  return NativeSurface.rpc("Dock", method, {
    payload,
    success,
    authority: NativeSurface.authority.custom(capability),
    endpoint: "mutation",
    support: DockSupportByMethod[method]
  })
}

const runDockRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, DockError, never> =>
  effect.pipe(
    Effect.mapError(mapDockRpcClientError),
    Effect.catchDefect((defect) =>
      Effect.fail(makeHostProtocolInvalidOutputError(operation, formatUnknownError(defect)))
    )
  )

const mapDockRpcClientError = (error: unknown): DockError =>
  isDockError(error) ? error : makeHostProtocolInternalError("Dock RPC client failed", "Dock")

const isDockError = (error: unknown): error is DockError =>
  typeof error === "object" &&
  error !== null &&
  "tag" in error &&
  "operation" in error &&
  "recoverable" in error

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return String(error)
}
