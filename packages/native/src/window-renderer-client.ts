import {
  HostProtocolError as HostProtocolErrorSchema,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  makeHostProtocolInvalidStateError,
  RpcEndpoint,
  RpcSupport,
  type HostProtocolError
} from "@orika/bridge"
import type {
  DesktopRendererRpcClient,
  DesktopRendererRpcClientMap
} from "@orika/core/runtime/renderer-rpc-client"
import { Effect, Option, Schema } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"

import {
  WindowCreateInput,
  type WindowCreateOptions,
  type WindowHandle,
  WindowHandleInput,
  WindowResource
} from "./contracts/window.js"

const StrictParseOptions = { onExcessProperty: "error" } as const

const WindowRendererCreate = Rpc.make("Window.create", {
  payload: WindowCreateInput,
  success: WindowResource,
  error: HostProtocolErrorSchema
}).pipe(RpcEndpoint.mutation, RpcSupport.supported)

const WindowRendererClose = Rpc.make("Window.close", {
  payload: WindowHandleInput,
  success: Schema.Void,
  error: HostProtocolErrorSchema
}).pipe(RpcEndpoint.mutation, RpcSupport.supported)

const WindowRendererDestroy = Rpc.make("Window.destroy", {
  payload: WindowHandleInput,
  success: Schema.Void,
  error: HostProtocolErrorSchema
}).pipe(RpcEndpoint.mutation, RpcSupport.supported)

const WindowRendererGetCurrent = Rpc.make("Window.getCurrent", {
  payload: Schema.Void,
  success: WindowResource,
  error: HostProtocolErrorSchema
}).pipe(RpcEndpoint.mutation, RpcSupport.supported)

export const WindowRendererRpcs = RpcGroup.make(
  WindowRendererCreate,
  WindowRendererClose,
  WindowRendererDestroy,
  WindowRendererGetCurrent
)

export type WindowRendererRpc = RpcGroup.Rpcs<typeof WindowRendererRpcs>

const WindowRendererRpcTags = Object.freeze([
  "Window.create",
  "Window.close",
  "Window.destroy",
  "Window.getCurrent"
] as const)

type WindowRendererOperation = (typeof WindowRendererRpcTags)[number]

export interface WindowRendererClientApi {
  readonly create: (
    input?: WindowCreateOptions
  ) => Effect.Effect<WindowHandle, HostProtocolError, never>
  readonly close: (window: WindowHandle) => Effect.Effect<void, HostProtocolError, never>
  readonly destroy: (window: WindowHandle) => Effect.Effect<void, HostProtocolError, never>
  readonly getCurrent: () => Effect.Effect<WindowHandle, HostProtocolError, never>
}

export const makeWindowRendererClient = (
  clients: DesktopRendererRpcClientMap
): Option.Option<WindowRendererClientApi> => {
  for (const [group, client] of clients) {
    if (hasWindowRendererRpcs(group) || hasWindowRendererClientMethods(client)) {
      return Option.some(windowRendererClientFromRpcClient(client))
    }
  }

  return Option.none()
}

const hasWindowRendererRpcs = (group: unknown): boolean => {
  if (typeof group !== "object" || group === null || !("requests" in group)) {
    return false
  }
  return WindowRendererRpcTags.every((tag) => hasRequestTag(group.requests, tag))
}

const hasRequestTag = (requests: unknown, tag: string): boolean => {
  if (typeof requests !== "object" || requests === null || !("has" in requests)) {
    return false
  }
  const has = requests.has
  return typeof has === "function" && has.call(requests, tag) === true
}

const hasWindowRendererClientMethods = (client: DesktopRendererRpcClient): boolean =>
  WindowRendererRpcTags.every((tag) => typeof client[tag] === "function")

const windowRendererClientFromRpcClient = (
  client: DesktopRendererRpcClient
): WindowRendererClientApi =>
  Object.freeze({
    create: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(WindowCreateInput)(
          input ?? {},
          StrictParseOptions
        ).pipe(
          Effect.mapError((error) =>
            makeHostProtocolInvalidArgumentError(
              "payload",
              formatUnknownError(error),
              "Window.create"
            )
          )
        )
        const window = yield* runWindowRendererRpc(client, "Window.create", decoded)
        return yield* decodeWindowHandle(window, "Window.create")
      }),
    close: (window) => runWindowRendererHandleRpc(client, "Window.close", window),
    destroy: (window) => runWindowRendererHandleRpc(client, "Window.destroy", window),
    getCurrent: () =>
      Effect.gen(function* () {
        const window = yield* runWindowRendererRpc(client, "Window.getCurrent", undefined)
        return yield* decodeWindowHandle(window, "Window.getCurrent")
      })
  } satisfies WindowRendererClientApi)

const runWindowRendererHandleRpc = (
  client: DesktopRendererRpcClient,
  operation: "Window.close" | "Window.destroy",
  window: WindowHandle
): Effect.Effect<void, HostProtocolError, never> =>
  Effect.gen(function* () {
    const decoded = yield* decodeWindowHandleInput(window, operation)
    yield* runWindowRendererRpc(client, operation, decoded)
  })

const runWindowRendererRpc = (
  client: DesktopRendererRpcClient,
  operation: WindowRendererOperation,
  input: unknown
): Effect.Effect<unknown, HostProtocolError, never> => {
  const method = client[operation]
  if (method === undefined) {
    return Effect.fail(
      makeHostProtocolInvalidStateError(
        `missing renderer RPC client method ${operation}`,
        "call",
        operation
      )
    )
  }

  const result = method(input)
  return Effect.isEffect(result)
    ? result.pipe(Effect.mapError((error) => rendererRpcErrorToHostProtocolError(error, operation)))
    : Effect.fail(makeHostProtocolInvalidStateError("received Stream", "call", operation))
}

const decodeWindowHandleInput = (
  window: WindowHandle,
  operation: string
): Effect.Effect<WindowHandleInput, HostProtocolError, never> =>
  Schema.decodeUnknownEffect(WindowHandleInput)({ window }, StrictParseOptions).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

const decodeWindowHandle = (
  input: unknown,
  operation: string
): Effect.Effect<WindowHandle, HostProtocolError, never> =>
  Schema.decodeUnknownEffect(WindowResource)(input, StrictParseOptions).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
    )
  )

const rendererRpcErrorToHostProtocolError = (
  error: unknown,
  operation: string
): HostProtocolError =>
  isHostProtocolError(error)
    ? error
    : makeHostProtocolInternalError(formatUnknownError(error), operation)

const formatUnknownError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const isHostProtocolError = (error: unknown): error is HostProtocolError =>
  typeof error === "object" &&
  error !== null &&
  "tag" in error &&
  "operation" in error &&
  "recoverable" in error
