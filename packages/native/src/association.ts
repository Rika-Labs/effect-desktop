import {
  type BridgeClientExchange,
  type BridgeHandlerRuntimeOptions,
  type HostProtocolError,
  RpcGroup
} from "@orika/bridge"
import { type DesktopRpcClient, P } from "@orika/core"
import { Context, Effect, Schema, Stream } from "effect"

import {
  AssociationEvent,
  AssociationFileAssociationsInput,
  type AssociationFileAssociationsOptions,
  AssociationFileAssociationsResult,
  AssociationProtocolInput,
  type AssociationProtocolOptions,
  AssociationProtocolStatus
} from "./contracts/association.js"
import { subscribeNativeEvent } from "./event-stream.js"
import { decodeNativeInput, runNativeRpc } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"
import type { NativeRpcHandlers } from "./native-surface.js"

export * from "./contracts/association.js"

const Surface = "Association"
const UnsupportedReason = "host-adapter-unimplemented"
const AssociationSupport = NativeSurface.support.partial("macos-association-only", {
  platforms: [
    { platform: "macos", status: "supported" },
    { platform: "windows", status: "unsupported", reason: UnsupportedReason },
    { platform: "linux", status: "unsupported", reason: UnsupportedReason }
  ]
})

export type AssociationError = HostProtocolError

export const AssociationIsDefaultProtocolClient = NativeSurface.rpc(
  Surface,
  "isDefaultProtocolClient",
  {
    payload: AssociationProtocolInput,
    success: AssociationProtocolStatus,
    authority: NativeSurface.authority.custom(
      P.nativeInvoke({ primitive: Surface, methods: ["isDefaultProtocolClient"] })
    ),
    endpoint: "query",
    support: AssociationSupport
  }
)
export const AssociationSetDefaultProtocolClient = NativeSurface.rpc(
  Surface,
  "setDefaultProtocolClient",
  {
    payload: AssociationProtocolInput,
    success: Schema.Void,
    authority: NativeSurface.authority.custom(
      P.nativeInvoke({ primitive: Surface, methods: ["setDefaultProtocolClient"] })
    ),
    endpoint: "mutation",
    support: AssociationSupport
  }
)
export const AssociationGetFileAssociations = NativeSurface.rpc(Surface, "getFileAssociations", {
  payload: AssociationFileAssociationsInput,
  success: AssociationFileAssociationsResult,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["getFileAssociations"] })
  ),
  endpoint: "query",
  support: AssociationSupport
})

export const AssociationRpcEvents = Object.freeze({
  Event: { payload: AssociationEvent }
})

const AssociationRpcGroup = RpcGroup.make(
  AssociationIsDefaultProtocolClient,
  AssociationSetDefaultProtocolClient,
  AssociationGetFileAssociations
)

export const AssociationRpcs: RpcGroup.RpcGroup<AssociationRpc> = AssociationRpcGroup

export const AssociationMethodNames = Object.freeze([
  "isDefaultProtocolClient",
  "setDefaultProtocolClient",
  "getFileAssociations"
] as const)

export interface AssociationClientApi {
  readonly isDefaultProtocolClient: (
    input: AssociationProtocolOptions
  ) => Effect.Effect<AssociationProtocolStatus, AssociationError, never>
  readonly setDefaultProtocolClient: (
    input: AssociationProtocolOptions
  ) => Effect.Effect<void, AssociationError, never>
  readonly getFileAssociations: (
    input?: AssociationFileAssociationsOptions
  ) => Effect.Effect<AssociationFileAssociationsResult, AssociationError, never>
  readonly events: () => Stream.Stream<AssociationEvent, AssociationError, never>
}

export class Association extends Context.Service<Association, AssociationClientApi>()(
  "@orika/native/Association"
) {}

export type AssociationRpc = RpcGroup.Rpcs<typeof AssociationRpcGroup>
export type AssociationRpcHandlers<R = never> = NativeRpcHandlers<typeof AssociationRpcGroup, R>

export const AssociationHandlersLive = AssociationRpcGroup.toLayer({
  "Association.isDefaultProtocolClient": (input) =>
    Effect.gen(function* () {
      const association = yield* Association
      return yield* association.isDefaultProtocolClient(input)
    }),
  "Association.setDefaultProtocolClient": (input) =>
    Effect.gen(function* () {
      const association = yield* Association
      yield* association.setDefaultProtocolClient(input)
    }),
  "Association.getFileAssociations": (input) =>
    Effect.gen(function* () {
      const association = yield* Association
      return yield* association.getFileAssociations(input)
    })
})

export const AssociationSurface = NativeSurface.make("Association", AssociationRpcGroup, {
  service: Association,
  capabilities: AssociationMethodNames,
  handlers: AssociationHandlersLive,
  client: (client) => associationClientFromRpcClient(client),
  bridgeClient: (client, exchange) => associationClientFromRpcClient(client, exchange)
})

export const makeHostAssociationRpcRuntime = <R = never>(
  handlers: AssociationRpcHandlers<R>,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
) => AssociationSurface.hostRuntime(handlers, runtimeOptions)

const associationClientFromRpcClient = (
  client: DesktopRpcClient<AssociationRpc>,
  exchange?: BridgeClientExchange
): AssociationClientApi =>
  Object.freeze({
    isDefaultProtocolClient: (input) =>
      decodeAssociationProtocolInput(input, "Association.isDefaultProtocolClient").pipe(
        Effect.flatMap((decoded) =>
          runAssociationRpc(
            client["Association.isDefaultProtocolClient"](decoded),
            "Association.isDefaultProtocolClient"
          )
        )
      ),
    setDefaultProtocolClient: (input) =>
      decodeAssociationProtocolInput(input, "Association.setDefaultProtocolClient").pipe(
        Effect.flatMap((decoded) =>
          runAssociationRpc(
            client["Association.setDefaultProtocolClient"](decoded),
            "Association.setDefaultProtocolClient"
          )
        )
      ),
    getFileAssociations: (input) =>
      decodeAssociationFileAssociationsInput(input ?? {}, "Association.getFileAssociations").pipe(
        Effect.flatMap((decoded) =>
          runAssociationRpc(
            client["Association.getFileAssociations"](decoded),
            "Association.getFileAssociations"
          )
        )
      ),
    events: () => subscribeNativeEvent(exchange, "Association.Event", AssociationEvent)
  } satisfies AssociationClientApi)

const decodeAssociationProtocolInput = (
  input: unknown,
  operation: string
): Effect.Effect<AssociationProtocolInput, AssociationError, never> =>
  decodeNativeInput(AssociationProtocolInput, input, operation)

const decodeAssociationFileAssociationsInput = (
  input: unknown,
  operation: string
): Effect.Effect<AssociationFileAssociationsInput, AssociationError, never> =>
  decodeNativeInput(AssociationFileAssociationsInput, input, operation)

const runAssociationRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, AssociationError, never> => runNativeRpc(effect, operation, Surface)
