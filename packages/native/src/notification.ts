import {
  type BridgeClientExchange,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  type RpcCapabilityMetadata,
  type RpcSupportMetadata,
  RpcGroup,
  type HostProtocolError
} from "@orika/bridge"
import {
  P,
  type DesktopRpcClient,
  ResourceRegistry,
  type ResourceRegistryApi,
  ResourceRegistryLive
} from "@orika/core"
import { Context, Effect, Layer, Schema, Stream } from "effect"

import { NativeSurface } from "./native-surface.js"
import type { NativeRpcHandlers } from "./native-surface.js"
import { subscribeNativeEvent } from "./event-stream.js"
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
const NotificationPlatformSupport = NativeSurface.support.partial("host-notification-unavailable", {
  platforms: [
    { platform: "macos", status: "unsupported", reason: "host-notification-unavailable" },
    { platform: "windows", status: "unsupported", reason: "host-notification-unavailable" },
    { platform: "linux", status: "supported" }
  ]
}) satisfies RpcSupportMetadata

export type NotificationError = HostProtocolError

export const NotificationShow = notificationRpc(
  "show",
  NotificationShowInput,
  NotificationResource,
  P.nativeInvoke({ primitive: "Notification", methods: ["show"] }),
  NotificationPlatformSupport
)
export const NotificationClose = notificationRpc(
  "close",
  NotificationCloseInput,
  Schema.Void,
  P.nativeInvoke({ primitive: "Notification", methods: ["close"] }),
  NotificationPlatformSupport
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
  P.nativeInvoke({ primitive: "Notification", methods: ["requestPermission"] }),
  NotificationPlatformSupport
)
export const NotificationGetPermissionStatus = notificationRpc(
  "getPermissionStatus",
  Schema.Void,
  NotificationPermissionResult,
  { kind: "none" },
  NotificationPlatformSupport
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
>()("@orika/native/NotificationClient") {}

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

export interface NotificationServiceOptions {
  readonly resources: ResourceRegistryApi
}

export class Notification extends Context.Service<Notification, NotificationServiceApi>()(
  "@orika/native/Notification"
) {
  static readonly layer = Layer.provide(
    Layer.effect(Notification)(
      Effect.gen(function* () {
        const client = yield* NotificationClient
        const resources = yield* ResourceRegistry
        return makeNotificationService(client, { resources })
      })
    ),
    ResourceRegistryLive
  )
}

export const NotificationLive = Notification.layer

export const makeNotificationServiceLayer = (
  client: NotificationClientApi,
  options?: NotificationServiceOptions
): Layer.Layer<Notification> =>
  options === undefined
    ? Layer.provide(NotificationLive, Layer.succeed(NotificationClient)(client))
    : Layer.succeed(Notification, makeNotificationService(client, options))

export type NotificationRpc = RpcGroup.Rpcs<typeof NotificationRpcGroup>

export type NotificationRpcHandlers<R = never> = NativeRpcHandlers<typeof NotificationRpcGroup, R>

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
  client: (client) => notificationClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => notificationClientFromRpcClient(client, exchange)
})

const makeNotificationService = (
  client: NotificationClientApi,
  options: NotificationServiceOptions
): NotificationServiceApi => {
  const explicitlyClosed = new Set<string>()
  const service: NotificationServiceApi = {
    show: (input) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const shown = yield* client.show(input)
          const handle = yield* options.resources
            .register({
              kind: "notification",
              id: shown.id,
              ownerScope: shown.ownerScope,
              state: "open",
              reusableId: true,
              dispose: Effect.gen(function* () {
                if (explicitlyClosed.has(shown.id)) {
                  return
                }
                yield* client.close(shown)
              }).pipe(Effect.ignore)
            })
            .pipe(
              Effect.tapError(() => client.close(shown).pipe(Effect.ignore)),
              Effect.mapError((error) =>
                makeHostProtocolInvalidArgumentError(
                  error.field,
                  error.message,
                  "Notification.show"
                )
              )
            )
          return toNotificationHandle(handle)
        })
      ),
    close: (notification) =>
      Effect.gen(function* () {
        if (notification.kind !== "notification" || notification.state !== "open") {
          return yield* Effect.fail(
            makeHostProtocolInvalidArgumentError(
              "notification",
              "must be an open notification handle",
              "Notification.close"
            )
          )
        }
        yield* client.close(notification)
        explicitlyClosed.add(notification.id)
        yield* options.resources
          .dispose(notification.id)
          .pipe(Effect.ensuring(Effect.sync(() => explicitlyClosed.delete(notification.id))))
      }),
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
    onClick: () =>
      subscribeNotificationEvent(exchange, "Notification.Click", NotificationClickEvent),
    onAction: () =>
      subscribeNotificationEvent(exchange, "Notification.Action", NotificationActionEvent)
  }

  return Object.freeze(notificationClient)
}

const subscribeNotificationEvent = <A>(
  exchange: BridgeClientExchange | undefined,
  method: string,
  schema: Schema.Codec<A, unknown, never, never>
): Stream.Stream<A, NotificationError, never> => subscribeNativeEvent(exchange, method, schema)

const toNotificationShowInput = (input: NotificationShowOptions): unknown => ({
  title: input.title,
  body: input.body,
  ...(input.actions === undefined ? {} : { actions: input.actions }),
  ...(input.ownerWindow === undefined ? {} : { ownerWindow: toWindowHandle(input.ownerWindow) })
})

const toWindowHandle = (handle: WindowHandle): WindowHandle =>
  Object.freeze({
    kind: handle.kind,
    id: handle.id,
    generation: handle.generation,
    ownerScope: handle.ownerScope,
    state: handle.state
  })

const toNotificationHandle = (handle: NotificationHandle): NotificationHandle =>
  Object.freeze({
    kind: handle.kind,
    id: handle.id,
    generation: handle.generation,
    ownerScope: handle.ownerScope,
    state: handle.state
  })

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
>(
  method: Method,
  payload: Payload,
  success: Success,
  capability: RpcCapabilityMetadata,
  support: RpcSupportMetadata = NativeSurface.support.supported
) {
  return NativeSurface.rpc("Notification", method, {
    payload,
    success,
    authority: NativeSurface.authority.custom(capability),
    endpoint: "mutation",
    support
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
