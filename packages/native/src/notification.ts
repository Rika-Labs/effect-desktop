import {
  BridgeRpc,
  Client,
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeRpcGroup,
  type BridgeRpcSpec,
  type BridgeRpcHandlers,
  type BridgeRpcLayer,
  type BridgeResourceHandle,
  BridgeResourceHandleShape,
  HostProtocolError as HostProtocolErrorSchema,
  HostProtocolUnsupportedError,
  makeHostProtocolInvalidArgumentError,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { Context, Effect, Layer, Schema, Stream } from "effect"

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

export const NotificationRpcSpec = Object.freeze({
  show: {
    input: NotificationShowInput,
    output: NotificationResource,
    error: HostProtocolErrorSchema,
    permission: "native.invoke:Notification.show"
  },
  close: {
    input: NotificationCloseInput,
    output: Schema.Void,
    error: HostProtocolErrorSchema,
    permission: "native.invoke:Notification.close"
  },
  isSupported: {
    input: Schema.Void,
    output: NotificationSupportedResult,
    error: HostProtocolErrorSchema,
    permission: "none"
  },
  requestPermission: {
    input: Schema.Void,
    output: NotificationPermissionResult,
    error: HostProtocolErrorSchema,
    permission: "native.invoke:Notification.requestPermission"
  },
  getPermissionStatus: {
    input: Schema.Void,
    output: NotificationPermissionResult,
    error: HostProtocolErrorSchema,
    permission: "none"
  }
}) satisfies BridgeRpcSpec

export type NotificationRpcSpec = typeof NotificationRpcSpec

export const NotificationRpcEvents = Object.freeze({
  Click: { payload: NotificationClickEvent },
  Action: { payload: NotificationActionEvent }
})

export type NotificationRpcEvents = typeof NotificationRpcEvents

export const NotificationRpcs: BridgeRpcGroup<
  "Notification",
  NotificationRpcSpec,
  NotificationRpcEvents
> = BridgeRpc.group("Notification", NotificationRpcSpec, NotificationRpcEvents)

export const NotificationMethodNames = Object.freeze(
  Object.keys(NotificationRpcSpec) as ReadonlyArray<keyof NotificationRpcSpec>
)

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
): Layer.Layer<NotificationClient> =>
  Layer.succeed(NotificationClient)(makeNotificationBridgeClient(exchange, options))

export const makeHostNotificationBridgeRpcLayer = <
  Handlers extends BridgeRpcHandlers<NotificationRpcSpec>
>(
  handlers: Handlers
): BridgeRpcLayer<"Notification", NotificationRpcSpec, Handlers, NotificationRpcEvents> =>
  BridgeRpc.layer(NotificationRpcs)(handlers)

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

const makeNotificationBridgeClient = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): NotificationClientApi => {
  const client = Client({ Notification: NotificationRpcs }, exchange, options).Notification

  const notificationClient: NotificationClientApi = {
    show: (input) =>
      decodeNotificationShowInput(toNotificationShowInput(input)).pipe(Effect.flatMap(client.show)),
    close: (notification) =>
      client.close(
        new NotificationCloseInput({ notification: toNotificationHandle(notification) })
      ),
    isSupported: () => client.isSupported(),
    requestPermission: () => client.requestPermission(),
    getPermissionStatus: () => client.getPermissionStatus(),
    onClick: () => client.events.Click,
    onAction: () => client.events.Action
  }

  return Object.freeze(notificationClient)
}

export const makeUnsupportedNotificationClient = (): NotificationClientApi => {
  const unsupportedEffect = <A>(method: string): Effect.Effect<A, NotificationError, never> =>
    Effect.fail(unsupportedError(method))
  const unsupportedStream = <A>(method: string): Stream.Stream<A, NotificationError, never> =>
    Stream.fail(unsupportedError(method))

  const client: NotificationClientApi = {
    show: () => unsupportedEffect<NotificationHandle>("Notification.show"),
    close: () => unsupportedEffect<void>("Notification.close"),
    isSupported: () => Effect.succeed(new NotificationSupportedResult({ supported: false })),
    requestPermission: () =>
      unsupportedEffect<NotificationPermissionResult>("Notification.requestPermission"),
    getPermissionStatus: () =>
      unsupportedEffect<NotificationPermissionResult>("Notification.getPermissionStatus"),
    onClick: () => unsupportedStream<NotificationClickEvent>("Notification.Click"),
    onAction: () => unsupportedStream<NotificationActionEvent>("Notification.Action")
  }

  return Object.freeze(client)
}

const unsupportedError = (method: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: "host Notification platform adapter is not implemented yet",
    message: `unsupported Notification method: ${method}`,
    operation: method,
    recoverable: false
  })

const toNotificationShowInput = (input: NotificationShowOptions): unknown => ({
  title: input.title,
  body: input.body,
  ...(input.actions === undefined ? {} : { actions: input.actions }),
  ...(input.ownerWindow === undefined
    ? {}
    : { ownerWindow: toWindowHandle(input.ownerWindow as WindowHandle) })
})

const toWindowHandle = (handle: WindowHandle): BridgeResourceHandle<"window", "open"> =>
  new BridgeResourceHandleShape({
    kind: handle.kind,
    id: handle.id,
    generation: handle.generation,
    ownerScope: handle.ownerScope,
    state: handle.state
  }) as BridgeResourceHandle<"window", "open">

const toNotificationHandle = (handle: NotificationHandle): NotificationHandle =>
  new BridgeResourceHandleShape({
    kind: handle.kind,
    id: handle.id,
    generation: handle.generation,
    ownerScope: handle.ownerScope,
    state: handle.state
  }) as NotificationHandle

const decodeNotificationShowInput = (
  input: unknown
): Effect.Effect<NotificationShowInput, NotificationError, never> =>
  decodeInput(NotificationShowInput, input, "Notification.show") as Effect.Effect<
    NotificationShowInput,
    NotificationError,
    never
  >

const decodeInput = (
  schema: Schema.Schema<unknown>,
  input: unknown,
  operation: string
): Effect.Effect<unknown, NotificationError, never> =>
  Effect.mapError(
    Schema.decodeUnknownEffect(schema)(input, StrictParseOptions) as Effect.Effect<
      unknown,
      unknown,
      never
    >,
    (error) => makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
  )

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
