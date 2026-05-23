import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type RpcGroup,
  hostProtocolErrorFromRpcClientError,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidOutputError,
  HostProtocolRequestEnvelope,
  type HostProtocolError
} from "@orika/bridge"
import { type DesktopRpcClient } from "@orika/core"
import { Context, Effect, Layer, Schema, Stream } from "effect"

import { NativeSurface } from "./native-surface.js"
import type { NativeRpcHandlers } from "./native-surface.js"
import { subscribeNativeEvent } from "./event-stream.js"
import {
  ScreenDisplay,
  ScreenDisplaysChangedEvent,
  ScreenDisplaysResult,
  ScreenIsSupportedInput,
  type ScreenMethod,
  ScreenPoint,
  ScreenSupportedResult
} from "./contracts/screen.js"
import {
  ScreenCapabilityMethods,
  ScreenRpcEvents as ScreenRpcEventsValue,
  ScreenRpcs
} from "./screen-rpc.js"

export {
  ScreenGetDisplays,
  ScreenGetPointerPoint,
  ScreenGetPrimaryDisplay,
  ScreenIsSupported,
  ScreenMethodNames,
  ScreenRpcs
} from "./screen-rpc.js"

export type ScreenError = HostProtocolError

const ScreenRpcGroup = ScreenRpcs

export const ScreenRpcEvents = ScreenRpcEventsValue
export type ScreenRpcEvents = typeof ScreenRpcEvents

export type ScreenRpc = RpcGroup.Rpcs<typeof ScreenRpcGroup>

export type ScreenBridgeClientOptions = Omit<BridgeClientOptions, "nextRequestId">

export interface ScreenClientApi {
  readonly getDisplays: () => Effect.Effect<ScreenDisplaysResult, ScreenError, never>
  readonly getPrimaryDisplay: () => Effect.Effect<ScreenDisplay, ScreenError, never>
  readonly getPointerPoint: () => Effect.Effect<ScreenPoint, ScreenError, never>
  readonly onDisplaysChanged: () => Stream.Stream<ScreenDisplaysChangedEvent, ScreenError, never>
  readonly isSupported: (
    method: ScreenMethod
  ) => Effect.Effect<ScreenSupportedResult, ScreenError, never>
}

export class ScreenClient extends Context.Service<ScreenClient, ScreenClientApi>()(
  "@orika/native/ScreenClient"
) {}

export interface ScreenServiceApi {
  readonly getDisplays: () => Effect.Effect<ReadonlyArray<ScreenDisplay>, ScreenError, never>
  readonly getPrimaryDisplay: () => Effect.Effect<ScreenDisplay, ScreenError, never>
  readonly getPointerPoint: () => Effect.Effect<ScreenPoint, ScreenError, never>
  readonly onDisplaysChanged: () => Stream.Stream<ScreenDisplaysChangedEvent, ScreenError, never>
  readonly isSupported: (method: ScreenMethod) => Effect.Effect<boolean, ScreenError, never>
}

export class Screen extends Context.Service<Screen, ScreenServiceApi>()("@orika/native/Screen") {
  static readonly layer = Layer.effect(Screen)(
    Effect.gen(function* () {
      const client = yield* ScreenClient
      return Screen.of({
        getDisplays: () => client.getDisplays().pipe(Effect.map((result) => result.displays)),
        getPrimaryDisplay: () => client.getPrimaryDisplay(),
        getPointerPoint: () => client.getPointerPoint(),
        onDisplaysChanged: () => client.onDisplaysChanged(),
        isSupported: (method) =>
          client.isSupported(method).pipe(Effect.map((result) => result.supported))
      } satisfies ScreenServiceApi)
    })
  )
}

export const ScreenLive = Screen.layer

export const ScreenHandlersLive = ScreenRpcGroup.toLayer({
  "Screen.getDisplays": () =>
    Effect.gen(function* () {
      const screen = yield* Screen
      const displays = yield* screen.getDisplays()
      return new ScreenDisplaysResult({ displays })
    }),
  "Screen.getPrimaryDisplay": () =>
    Effect.gen(function* () {
      const screen = yield* Screen
      return yield* screen.getPrimaryDisplay()
    }),
  "Screen.getPointerPoint": () =>
    Effect.gen(function* () {
      const screen = yield* Screen
      return yield* screen.getPointerPoint()
    }),
  "Screen.isSupported": (input) =>
    Effect.gen(function* () {
      const screen = yield* Screen
      const supported = yield* screen.isSupported(input.method)
      return new ScreenSupportedResult({ supported })
    })
})

export const ScreenSurface = NativeSurface.make("Screen", ScreenRpcGroup, {
  service: ScreenClient,
  capabilities: ScreenCapabilityMethods,
  handlers: ScreenHandlersLive,
  client: (client) => screenClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => screenClientFromRpcClient(client, exchange)
})

export const makeScreenBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: ScreenBridgeClientOptions = {}
): Layer.Layer<ScreenClient> =>
  ScreenSurface.bridgeClientLayer(exchange, {
    ...options,
    normalizeRequest: normalizeScreenBridgeRequest
  })

export type ScreenRpcHandlers<R = never> = NativeRpcHandlers<typeof ScreenRpcGroup, R>

const normalizeScreenBridgeRequest = (
  request: HostProtocolRequestEnvelope
): HostProtocolRequestEnvelope => {
  if (
    request.payload !== null ||
    (request.method !== "Screen.getDisplays" &&
      request.method !== "Screen.getPrimaryDisplay" &&
      request.method !== "Screen.getPointerPoint")
  ) {
    return request
  }
  return new HostProtocolRequestEnvelope({
    kind: "request",
    id: request.id,
    method: request.method,
    timestamp: request.timestamp,
    traceId: request.traceId,
    ...(request.windowId === undefined ? {} : { windowId: request.windowId }),
    ...(request.originToken === undefined ? {} : { originToken: request.originToken })
  })
}

const screenClientFromRpcClient = (
  client: DesktopRpcClient<ScreenRpc>,
  exchange: BridgeClientExchange | undefined
): ScreenClientApi =>
  Object.freeze({
    getDisplays: () =>
      runScreenRpc(client["Screen.getDisplays"](undefined)).pipe(
        Effect.flatMap(validateScreenDisplays)
      ),
    getPrimaryDisplay: () =>
      runScreenRpc(client["Screen.getPrimaryDisplay"](undefined), "Screen.getPrimaryDisplay").pipe(
        Effect.flatMap(validatePrimaryScreenDisplay)
      ),
    getPointerPoint: () => runScreenRpc(client["Screen.getPointerPoint"](undefined)),
    onDisplaysChanged: () =>
      subscribeNativeEvent(exchange, "Screen.DisplaysChanged", ScreenDisplaysChangedEvent).pipe(
        Stream.mapEffect(validateScreenDisplaysChangedEvent)
      ),
    isSupported: (method) =>
      runScreenRpc(client["Screen.isSupported"](new ScreenIsSupportedInput({ method })))
  } satisfies ScreenClientApi)

const runScreenRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation = "Screen"
): Effect.Effect<A, ScreenError, never> =>
  effect.pipe(
    Effect.mapError(mapScreenRpcClientError),
    Effect.catchDefect((defect) =>
      Effect.fail(makeHostProtocolInvalidOutputError(operation, formatUnknownError(defect)))
    )
  )

const mapScreenRpcClientError = (error: unknown): ScreenError =>
  isScreenError(error)
    ? error
    : (hostProtocolErrorFromRpcClientError(error) ??
      makeHostProtocolInternalError("Screen RPC client failed", "Screen"))

const isScreenError = (error: unknown): error is ScreenError =>
  typeof error === "object" &&
  error !== null &&
  "tag" in error &&
  "operation" in error &&
  "recoverable" in error

const validateScreenDisplays = (
  result: ScreenDisplaysResult
): Effect.Effect<ScreenDisplaysResult, ScreenError, never> => {
  return validateScreenDisplayList(result.displays, "Screen.getDisplays").pipe(Effect.as(result))
}

const validateScreenDisplaysChangedEvent = (
  event: ScreenDisplaysChangedEvent
): Effect.Effect<ScreenDisplaysChangedEvent, ScreenError, never> =>
  validateScreenDisplayList(event.displays, "Screen.DisplaysChanged").pipe(Effect.as(event))

const validatePrimaryScreenDisplay = (
  display: ScreenDisplay
): Effect.Effect<ScreenDisplay, ScreenError, never> =>
  validateScreenDisplay(display, "Screen.getPrimaryDisplay").pipe(
    Effect.flatMap(() =>
      display.primary
        ? Effect.succeed(display)
        : Effect.fail(
            makeHostProtocolInvalidOutputError(
              "Screen.getPrimaryDisplay",
              "primary screen display payload must be marked primary"
            )
          )
    )
  )

const validateScreenDisplayList = (
  displays: ReadonlyArray<ScreenDisplay>,
  operation: string
): Effect.Effect<void, ScreenError, never> => {
  const primaryCount = displays.filter((display) => display.primary).length
  if (displays.length === 0) {
    return Effect.fail(
      makeHostProtocolInvalidOutputError(
        operation,
        "screen display payload must include at least one display"
      )
    )
  }
  if (primaryCount !== 1) {
    return Effect.fail(
      makeHostProtocolInvalidOutputError(
        operation,
        "screen display payload must include exactly one primary display"
      )
    )
  }
  return Effect.forEach(displays, (display) => validateScreenDisplay(display, operation), {
    discard: true
  })
}

const validateScreenDisplay = (
  display: ScreenDisplay,
  operation: string
): Effect.Effect<void, ScreenError, never> =>
  Schema.decodeUnknownEffect(ScreenDisplay)(display).pipe(
    Effect.asVoid,
    Effect.mapError(() =>
      makeHostProtocolInvalidOutputError(operation, "screen display payload has invalid geometry")
    )
  )

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}
