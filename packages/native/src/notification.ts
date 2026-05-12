import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  type HostProtocolEventEnvelope,
  HostProtocolError as HostProtocolErrorSchema,
  HostProtocolUnsupportedError,
  makeDesktopClientProtocol,
  makeDesktopRpcHandlerRuntime,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  makeUnaryDesktopTransportFromBridgeClientExchange,
  Rpc,
  RpcClient,
  RpcCapability,
  RpcGroup,
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

export const NotificationShow = notificationRpc(
  "show",
  NotificationShowInput,
  NotificationResource,
  "native.invoke:Notification.show"
)
export const NotificationClose = notificationRpc(
  "close",
  NotificationCloseInput,
  Schema.Void,
  "native.invoke:Notification.close"
)
export const NotificationIsSupported = notificationRpc(
  "isSupported",
  Schema.Void,
  NotificationSupportedResult,
  "none"
)
export const NotificationRequestPermission = notificationRpc(
  "requestPermission",
  Schema.Void,
  NotificationPermissionResult,
  "native.invoke:Notification.requestPermission"
)
export const NotificationGetPermissionStatus = notificationRpc(
  "getPermissionStatus",
  Schema.Void,
  NotificationPermissionResult,
  "none"
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

export type NotificationRpc = RpcGroup.Rpcs<typeof NotificationRpcGroup>

export type NotificationRpcHandlers = Parameters<typeof NotificationRpcGroup.toLayer>[0]

export const makeHostNotificationRpcRuntime = (
  handlers: NotificationRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<unknown> =>
  makeDesktopRpcHandlerRuntime(
    NotificationRpcGroup,
    NotificationRpcGroup.toLayer(handlers),
    runtimeOptions
  )

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
  const notificationClient: NotificationClientApi = {
    show: (input) =>
      decodeNotificationShowInput(toNotificationShowInput(input)).pipe(
        Effect.flatMap((decoded) =>
          withNotificationRpcClient(exchange, options, (client) =>
            runNotificationRpc(client["Notification.show"](decoded), "Notification.show")
          )
        )
      ),
    close: (notification) =>
      withNotificationRpcClient(exchange, options, (client) =>
        runNotificationRpc(
          client["Notification.close"](
            new NotificationCloseInput({ notification: toNotificationHandle(notification) })
          ),
          "Notification.close"
        )
      ),
    isSupported: () =>
      withNotificationRpcClient(exchange, options, (client) =>
        runNotificationRpc(
          client["Notification.isSupported"](undefined),
          "Notification.isSupported"
        )
      ),
    requestPermission: () =>
      withNotificationRpcClient(exchange, options, (client) =>
        runNotificationRpc(
          client["Notification.requestPermission"](undefined),
          "Notification.requestPermission"
        )
      ),
    getPermissionStatus: () =>
      withNotificationRpcClient(exchange, options, (client) =>
        runNotificationRpc(
          client["Notification.getPermissionStatus"](undefined),
          "Notification.getPermissionStatus"
        )
      ),
    onClick: () =>
      subscribeNotificationEvent(exchange, "Notification.Click", NotificationClickEvent),
    onAction: () =>
      subscribeNotificationEvent(exchange, "Notification.Action", NotificationActionEvent)
  }

  return Object.freeze(notificationClient)
}

const makeNotificationBridgeProtocolLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions
): Layer.Layer<RpcClient.Protocol> =>
  Layer.effect(RpcClient.Protocol)(
    makeUnaryDesktopTransportFromBridgeClientExchange(exchange, options).pipe(
      Effect.flatMap((transport) => makeDesktopClientProtocol(transport, options))
    )
  )

const withNotificationRpcClient = <A>(
  exchange: BridgeClientExchange,
  options: BridgeClientOptions,
  use: (client: NotificationGeneratedClient) => Effect.Effect<A, NotificationError, never>
): Effect.Effect<A, NotificationError, never> =>
  Effect.scoped(
    RpcClient.make(NotificationRpcGroup).pipe(
      Effect.map((client) => client as unknown as NotificationGeneratedClient),
      Effect.flatMap(use),
      Effect.provide(makeNotificationBridgeProtocolLayer(exchange, options))
    )
  )

const subscribeNotificationEvent = <A>(
  exchange: BridgeClientExchange,
  method: string,
  schema: Schema.Schema<A>
): Stream.Stream<A, NotificationError, never> => {
  if (exchange.subscribe === undefined) {
    return Stream.fail(
      makeHostProtocolInvalidOutputError(method, "event exchange does not support subscriptions")
    )
  }

  return exchange
    .subscribe(method)
    .pipe(Stream.mapEffect((envelope) => decodeNotificationEventEnvelope(method, schema, envelope)))
}

const decodeNotificationEventEnvelope = <A>(
  operation: string,
  schema: Schema.Schema<A>,
  envelope: HostProtocolEventEnvelope
): Effect.Effect<A, NotificationError, never> => {
  if (envelope.method !== operation) {
    return Effect.fail(
      makeHostProtocolInvalidOutputError(operation, `unexpected event method: ${envelope.method}`)
    )
  }

  return Effect.mapError(
    Schema.decodeUnknownEffect(schema)(envelope.payload) as Effect.Effect<A, unknown, never>,
    (error) => makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
  )
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

function notificationRpc<
  Payload extends Schema.Schema<unknown>,
  Success extends Schema.Schema<unknown>
>(method: string, payload: Payload, success: Success, capability: string) {
  return Rpc.make(`Notification.${method}`, {
    payload,
    success,
    error: HostProtocolErrorSchema
  }).pipe(RpcCapability({ kind: capability }))
}

interface NotificationGeneratedClient {
  readonly "Notification.show": (
    input: NotificationShowInput
  ) => Effect.Effect<NotificationHandle, unknown, never>
  readonly "Notification.close": (
    input: NotificationCloseInput
  ) => Effect.Effect<void, unknown, never>
  readonly "Notification.isSupported": (
    input: void
  ) => Effect.Effect<NotificationSupportedResult, unknown, never>
  readonly "Notification.requestPermission": (
    input: void
  ) => Effect.Effect<NotificationPermissionResult, unknown, never>
  readonly "Notification.getPermissionStatus": (
    input: void
  ) => Effect.Effect<NotificationPermissionResult, unknown, never>
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
