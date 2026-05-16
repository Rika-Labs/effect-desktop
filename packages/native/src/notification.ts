import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  type RpcCapabilityMetadata,
  RpcGroup,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { type PermissionRegistry, P, type DesktopRpcClient } from "@effect-desktop/core"
import { Context, Effect, Layer, Schema, Stream } from "effect"

import { subscribeNativeEvent } from "./event-stream.js"
import { NativeSurface } from "./native-surface.js"
import {
  NotificationActionEvent,
  NotificationClickEvent,
  NotificationCloseInput,
  type NotificationHandle,
  NotificationPermissionResult,
  NotificationResource,
  NotificationShowInput,
  type NotificationShowOptions,
  NotificationSupportedResult,
  type PermissionState
} from "./contracts/notification.js"
import type { WindowHandle } from "./window.js"

const StrictParseOptions = { onExcessProperty: "error" } as const

export type NotificationError = HostProtocolError

export const NotificationShow = notificationRpc(
  "show",
  NotificationShowInput,
  NotificationResource,
  P.nativeInvoke({ primitive: "Notification", methods: ["show"] })
)
export const NotificationClose = notificationRpc(
  "close",
  NotificationCloseInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Notification", methods: ["close"] })
)
export const NotificationIsSupported = notificationRpc(
  "isSupported",
  Schema.Void,
  NotificationSupportedResult,
  { kind: "none" }
)
export const NotificationRequestPermission = notificationRpc(
  "requestPermission",
  Schema.Void,
  NotificationPermissionResult,
  P.nativeInvoke({ primitive: "Notification", methods: ["requestPermission"] })
)
export const NotificationGetPermissionStatus = notificationRpc(
  "getPermissionStatus",
  Schema.Void,
  NotificationPermissionResult,
  { kind: "none" }
)

export const NotificationRpcEvents = Object.freeze({
  Click: { payload: NotificationClickEvent },
  Action: { payload: NotificationActionEvent }
})

export type NotificationRpcEvents = typeof NotificationRpcEvents

const NotificationRpcGroup = RpcGroup.make(
  NotificationShow,
  NotificationClose,
  NotificationIsSupported,
  NotificationRequestPermission,
  NotificationGetPermissionStatus
)

export const NotificationRpcs: RpcGroup.RpcGroup<NotificationRpc> = NotificationRpcGroup

export const NotificationMethodNames = Object.freeze([
  "show",
  "close",
  "isSupported",
  "requestPermission",
  "getPermissionStatus"
] as const)

const NotificationCapabilityMethods = Object.freeze([
  "show",
  "close",
  "requestPermission"
] as const satisfies readonly (typeof NotificationMethodNames)[number][])

export interface NotificationClientApi {
  readonly show: (
    input: NotificationShowOptions
  ) => Effect.Effect<NotificationHandle, NotificationError, never>
  readonly close: (
    notification: NotificationHandle
  ) => Effect.Effect<void, NotificationError, never>
  readonly isSupported: () => Effect.Effect<NotificationSupportedResult, NotificationError, never>
  readonly requestPermission: () => Effect.Effect<
    NotificationPermissionResult,
    NotificationError,
    never
  >
  readonly getPermissionStatus: () => Effect.Effect<
    NotificationPermissionResult,
    NotificationError,
    never
  >
  readonly onClick: () => Stream.Stream<NotificationClickEvent, NotificationError, never>
  readonly onAction: () => Stream.Stream<NotificationActionEvent, NotificationError, never>
}

export class NotificationClient extends Context.Service<
  NotificationClient,
  NotificationClientApi
>()("@effect-desktop/native/NotificationClient") {}

export interface NotificationServiceApi {
  readonly show: (
    input: NotificationShowOptions
  ) => Effect.Effect<NotificationHandle, NotificationError, never>
  readonly close: (
    notification: NotificationHandle
  ) => Effect.Effect<void, NotificationError, never>
  readonly isSupported: () => Effect.Effect<boolean, NotificationError, never>
  readonly requestPermission: () => Effect.Effect<PermissionState, NotificationError, never>
  readonly getPermissionStatus: () => Effect.Effect<PermissionState, NotificationError, never>
  readonly onClick: () => Stream.Stream<NotificationClickEvent, NotificationError, never>
  readonly onAction: () => Stream.Stream<NotificationActionEvent, NotificationError, never>
}

export class Notification extends Context.Service<Notification, NotificationServiceApi>()(
  "@effect-desktop/native/Notification"
) {}

export const NotificationLive = Layer.effect(Notification)(
  Effect.gen(function* () {
    const client = yield* NotificationClient
    return makeNotificationService(client)
  })
)

export const makeNotificationClientLayer = (
  client: NotificationClientApi
): Layer.Layer<NotificationClient> => Layer.succeed(NotificationClient)(client)

export const makeNotificationServiceLayer = (
  client: NotificationClientApi
): Layer.Layer<Notification> => Layer.provide(NotificationLive, makeNotificationClientLayer(client))

export const makeNotificationBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<NotificationClient> => NotificationSurface.bridgeClientLayer(exchange, options)

export type NotificationRpc = RpcGroup.Rpcs<typeof NotificationRpcGroup>

export type NotificationRpcHandlers = RpcGroup.HandlersFrom<NotificationRpc>

export const NotificationHandlersLive = NotificationRpcGroup.toLayer({
  "Notification.show": (input) =>
    Effect.gen(function* () {
      const notification = yield* Notification
      return yield* notification.show(input)
    }),
  "Notification.close": (input) =>
    Effect.gen(function* () {
      const notification = yield* Notification
      yield* notification.close(input.notification)
    }),
  "Notification.isSupported": () =>
    Effect.gen(function* () {
      const notification = yield* Notification
      const supported = yield* notification.isSupported()
      return new NotificationSupportedResult({ supported })
    }),
  "Notification.requestPermission": () =>
    Effect.gen(function* () {
      const notification = yield* Notification
      const state = yield* notification.requestPermission()
      return new NotificationPermissionResult({ state })
    }),
  "Notification.getPermissionStatus": () =>
    Effect.gen(function* () {
      const notification = yield* Notification
      const state = yield* notification.getPermissionStatus()
      return new NotificationPermissionResult({ state })
    })
})

export const NotificationSurface = NativeSurface.make("Notification", NotificationRpcGroup, {
  service: NotificationClient,
  capabilities: NotificationCapabilityMethods,
  handlers: NotificationHandlersLive,
  bridgeClient: (client, exchange) => notificationClientFromRpcClient(client, exchange),
  client: (client) => notificationClientFromRpcClient(client, undefined)
})

export const makeHostNotificationRpcRuntime = (
  handlers: NotificationRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> =>
  NotificationSurface.hostRuntime(handlers, runtimeOptions)

const makeNotificationService = (client: NotificationClientApi): NotificationServiceApi => {
  const service: NotificationServiceApi = {
    show: (input) => client.show(input),
    close: (notification) => client.close(notification),
    isSupported: () => client.isSupported().pipe(Effect.map((result) => result.supported)),
    requestPermission: () => client.requestPermission().pipe(Effect.map((result) => result.state)),
    getPermissionStatus: () =>
      client.getPermissionStatus().pipe(Effect.map((result) => result.state)),
    onClick: () => client.onClick(),
    onAction: () => client.onAction()
  }

  return Object.freeze(service)
}

const notificationClientFromRpcClient = (
  client: DesktopRpcClient<NotificationRpc>,
  exchange: BridgeClientExchange | undefined
): NotificationClientApi => {
  const notificationClient: NotificationClientApi = {
    show: (input) =>
      decodeNotificationShowInput(toNotificationShowInput(input)).pipe(
        Effect.flatMap((decoded) =>
          runNotificationRpc(client["Notification.show"](decoded), "Notification.show")
        )
      ),
    close: (notification) =>
      runNotificationRpc(
        client["Notification.close"](
          new NotificationCloseInput({ notification: toNotificationHandle(notification) })
        ),
        "Notification.close"
      ),
    isSupported: () =>
      runNotificationRpc(client["Notification.isSupported"](undefined), "Notification.isSupported"),
    requestPermission: () =>
      runNotificationRpc(
        client["Notification.requestPermission"](undefined),
        "Notification.requestPermission"
      ),
    getPermissionStatus: () =>
      runNotificationRpc(
        client["Notification.getPermissionStatus"](undefined),
        "Notification.getPermissionStatus"
      ),
    onClick: () => subscribeNativeEvent(exchange, "Notification.Click", NotificationClickEvent),
    onAction: () => subscribeNativeEvent(exchange, "Notification.Action", NotificationActionEvent)
  }

  return Object.freeze(notificationClient)
}

const toNotificationShowInput = (input: NotificationShowOptions): unknown => ({
  title: input.title,
  body: input.body,
  ...(input.actions === undefined ? {} : { actions: input.actions }),
  ...(input.ownerWindow === undefined
    ? {}
    : { ownerWindow: toWindowHandle(input.ownerWindow as WindowHandle) })
})

const toWindowHandle = (handle: WindowHandle): WindowHandle =>
  Object.freeze({
    kind: handle.kind,
    id: handle.id,
    generation: handle.generation,
    ownerScope: handle.ownerScope,
    state: handle.state
  }) as WindowHandle

const toNotificationHandle = (handle: NotificationHandle): NotificationHandle =>
  Object.freeze({
    kind: handle.kind,
    id: handle.id,
    generation: handle.generation,
    ownerScope: handle.ownerScope,
    state: handle.state
  }) as NotificationHandle

const decodeNotificationShowInput = (
  input: unknown
): Effect.Effect<NotificationShowInput, NotificationError, never> =>
  decodeInput(NotificationShowInput, input, "Notification.show")

const decodeInput = <A>(
  schema: Schema.Codec<A, unknown, never, never>,
  input: unknown,
  operation: string
): Effect.Effect<A, NotificationError, never> =>
  Schema.decodeUnknownEffect(schema)(input, StrictParseOptions).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

function notificationRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(method: Method, payload: Payload, success: Success, capability: RpcCapabilityMetadata) {
  return NativeSurface.rpc("Notification", method, {
    payload,
    success,
    authority: NativeSurface.authority.custom(capability),
    endpoint: "mutation",
    support: NativeSurface.support.supported
  })
}

const runNotificationRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, NotificationError, never> =>
  effect.pipe(
    Effect.mapError(mapNotificationRpcClientError),
    Effect.catchDefect((defect) =>
      Effect.fail(makeHostProtocolInvalidOutputError(operation, formatUnknownError(defect)))
    )
  )

const mapNotificationRpcClientError = (error: unknown): NotificationError =>
  isNotificationError(error)
    ? error
    : makeHostProtocolInternalError("Notification RPC client failed", "Notification")

const isNotificationError = (error: unknown): error is NotificationError =>
  typeof error === "object" &&
  error !== null &&
  "tag" in error &&
  "operation" in error &&
  "recoverable" in error

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
