import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  HostProtocolPermissionDeniedError,
  HostProtocolUnsupportedError,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidStateError,
  type HostProtocolError,
  RpcGroup
} from "@effect-desktop/bridge"
import {
  type DesktopRpcClient,
  P,
  PermissionActor,
  PermissionContext,
  PermissionDeniedError,
  PermissionRegistry,
  type PermissionRegistryApi,
  type PermissionRegistryError,
  ResourceRegistry,
  type ResourceRegistryApi,
  makeResourceId
} from "@effect-desktop/core"
import { Clock, Context, Effect, Layer, Option, PubSub, Ref, Schema, Stream } from "effect"

import {
  NativeNetworkEvent,
  NativeNetworkFetchInput,
  NativeNetworkFetchResult,
  type NativeNetworkEventPhase,
  NativeNetworkLocalhostUrlInput,
  NativeNetworkLocalhostUrlResult,
  type NativeNetworkRequestHandle,
  NativeNetworkSupportedResult,
  NativeNetworkUploadInput,
  NativeNetworkUploadResult,
  NativeNetworkWebSocketConnectInput,
  type NativeNetworkWebSocketHandle,
  NativeNetworkWebSocketHandleInput,
  NativeNetworkWebSocketSnapshot
} from "./contracts/native-network.js"
import { subscribeNativeEvent } from "./event-stream.js"
import { decodeNativeInput, runNativeRpc } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"

export * from "./contracts/native-network.js"

const Surface = "NativeNetwork"
const UnsupportedReason = "host-native-network-unavailable"
const EventMethod = "NativeNetwork.Event"
const UnsupportedSupport = NativeSurface.support.unsupported(UnsupportedReason, {
  platforms: [
    { platform: "macos", status: "unsupported", reason: UnsupportedReason },
    { platform: "windows", status: "unsupported", reason: UnsupportedReason },
    { platform: "linux", status: "unsupported", reason: UnsupportedReason }
  ]
})

export type NativeNetworkError = HostProtocolError

export const NativeNetworkFetch = NativeSurface.rpc(Surface, "fetch", {
  payload: NativeNetworkFetchInput,
  success: NativeNetworkFetchResult,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["fetch"] })
  ),
  endpoint: "mutation",
  support: UnsupportedSupport
})
export const NativeNetworkUpload = NativeSurface.rpc(Surface, "upload", {
  payload: NativeNetworkUploadInput,
  success: NativeNetworkUploadResult,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["upload"] })
  ),
  endpoint: "mutation",
  support: UnsupportedSupport
})
export const NativeNetworkConnectWebSocket = NativeSurface.rpc(Surface, "connectWebSocket", {
  payload: NativeNetworkWebSocketConnectInput,
  success: NativeNetworkWebSocketSnapshot,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["connectWebSocket"] })
  ),
  endpoint: "mutation",
  support: UnsupportedSupport
})
export const NativeNetworkCloseWebSocket = NativeSurface.rpc(Surface, "closeWebSocket", {
  payload: NativeNetworkWebSocketHandleInput,
  success: NativeNetworkWebSocketSnapshot,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["closeWebSocket"] })
  ),
  endpoint: "mutation",
  support: UnsupportedSupport
})
export const NativeNetworkLocalhostUrl = NativeSurface.rpc(Surface, "localhostUrl", {
  payload: NativeNetworkLocalhostUrlInput,
  success: NativeNetworkLocalhostUrlResult,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["localhostUrl"] })
  ),
  endpoint: "query",
  support: UnsupportedSupport
})
export const NativeNetworkIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: NativeNetworkSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

export const NativeNetworkRpcEvents = Object.freeze({
  Event: { payload: NativeNetworkEvent }
})

const NativeNetworkRpcGroup = RpcGroup.make(
  NativeNetworkFetch,
  NativeNetworkUpload,
  NativeNetworkConnectWebSocket,
  NativeNetworkCloseWebSocket,
  NativeNetworkLocalhostUrl,
  NativeNetworkIsSupported
)

export const NativeNetworkRpcs: RpcGroup.RpcGroup<NativeNetworkRpc> = NativeNetworkRpcGroup

export const NativeNetworkMethodNames = Object.freeze([
  "fetch",
  "upload",
  "connectWebSocket",
  "closeWebSocket",
  "localhostUrl",
  "isSupported"
] as const)

const NativeNetworkCapabilityMethods = Object.freeze([
  "fetch",
  "upload",
  "connectWebSocket",
  "closeWebSocket",
  "localhostUrl"
] as const satisfies readonly (typeof NativeNetworkMethodNames)[number][])

export interface NativeNetworkClientApi {
  readonly fetch: (
    input: NativeNetworkFetchInput
  ) => Effect.Effect<NativeNetworkFetchResult, NativeNetworkError, never>
  readonly upload: (
    input: NativeNetworkUploadInput
  ) => Effect.Effect<NativeNetworkUploadResult, NativeNetworkError, never>
  readonly connectWebSocket: (
    input: NativeNetworkWebSocketConnectInput
  ) => Effect.Effect<NativeNetworkWebSocketSnapshot, NativeNetworkError, never>
  readonly closeWebSocket: (
    input: NativeNetworkWebSocketHandleInput
  ) => Effect.Effect<NativeNetworkWebSocketSnapshot, NativeNetworkError, never>
  readonly localhostUrl: (
    input: NativeNetworkLocalhostUrlInput
  ) => Effect.Effect<NativeNetworkLocalhostUrlResult, NativeNetworkError, never>
  readonly isSupported: () => Effect.Effect<NativeNetworkSupportedResult, NativeNetworkError, never>
  readonly events: () => Stream.Stream<NativeNetworkEvent, NativeNetworkError, never>
}

export class NativeNetworkClient extends Context.Service<
  NativeNetworkClient,
  NativeNetworkClientApi
>()("@effect-desktop/native/NativeNetworkClient") {}

export interface NativeNetworkServiceApi {
  readonly fetch: (
    url: string,
    options?: {
      readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD"
      readonly headers?: readonly { readonly name: string; readonly value: string }[]
      readonly body?: string
      readonly ownerScope?: string
      readonly traceId?: string
    }
  ) => Effect.Effect<NativeNetworkFetchResult, NativeNetworkError, never>
  readonly upload: (
    url: string,
    body: string,
    options?: {
      readonly method?: "POST" | "PUT" | "PATCH"
      readonly headers?: readonly { readonly name: string; readonly value: string }[]
      readonly fileName?: string
      readonly ownerScope?: string
      readonly traceId?: string
    }
  ) => Effect.Effect<NativeNetworkUploadResult, NativeNetworkError, never>
  readonly connectWebSocket: (
    url: string,
    options?: {
      readonly protocols?: readonly string[]
      readonly ownerScope?: string
      readonly traceId?: string
    }
  ) => Effect.Effect<NativeNetworkWebSocketSnapshot, NativeNetworkError, never>
  readonly closeWebSocket: (
    socket: NativeNetworkWebSocketHandle,
    options?: { readonly traceId?: string }
  ) => Effect.Effect<NativeNetworkWebSocketSnapshot, NativeNetworkError, never>
  readonly localhostUrl: (
    port: number,
    options?: { readonly path?: string; readonly secure?: boolean; readonly traceId?: string }
  ) => Effect.Effect<NativeNetworkLocalhostUrlResult, NativeNetworkError, never>
  readonly isSupported: () => Effect.Effect<NativeNetworkSupportedResult, NativeNetworkError, never>
  readonly events: () => Stream.Stream<NativeNetworkEvent, NativeNetworkError, never>
}

export interface NativeNetworkServiceOptions {
  readonly permissions: PermissionRegistryApi
  readonly resources: ResourceRegistryApi
}

export class NativeNetwork extends Context.Service<NativeNetwork, NativeNetworkServiceApi>()(
  "@effect-desktop/native/NativeNetwork"
) {
  static readonly layer = Layer.effect(NativeNetwork)(
    Effect.gen(function* () {
      const client = yield* NativeNetworkClient
      const permissions = yield* PermissionRegistry
      const resources = yield* ResourceRegistry
      return makeNativeNetworkService(client, { permissions, resources })
    })
  )
}

export const NativeNetworkLive = NativeNetwork.layer

export const makeNativeNetworkClientLayer = (
  client: NativeNetworkClientApi
): Layer.Layer<NativeNetworkClient> => Layer.succeed(NativeNetworkClient)(client)

export const makeNativeNetworkServiceLayer = (
  client: NativeNetworkClientApi,
  options: NativeNetworkServiceOptions
): Layer.Layer<NativeNetwork> =>
  Layer.succeed(NativeNetwork)(makeNativeNetworkService(client, options))

export const makeNativeNetworkBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<NativeNetworkClient> => NativeNetworkSurface.bridgeClientLayer(exchange, options)

export type NativeNetworkRpc = RpcGroup.Rpcs<typeof NativeNetworkRpcGroup>
export type NativeNetworkRpcHandlers = RpcGroup.HandlersFrom<NativeNetworkRpc>

export const NativeNetworkHandlersLive = NativeNetworkRpcGroup.toLayer({
  "NativeNetwork.fetch": (input) =>
    Effect.gen(function* () {
      const network = yield* NativeNetwork
      return yield* network.fetch(input.url, {
        method: input.method,
        ...(input.headers === undefined ? {} : { headers: input.headers }),
        ...(input.body === undefined ? {} : { body: input.body }),
        ...(input.ownerScope === undefined ? {} : { ownerScope: input.ownerScope }),
        ...(input.traceId === undefined ? {} : { traceId: input.traceId })
      })
    }),
  "NativeNetwork.upload": (input) =>
    Effect.gen(function* () {
      const network = yield* NativeNetwork
      return yield* network.upload(input.url, input.body, {
        ...(input.method === undefined ? {} : { method: input.method }),
        ...(input.headers === undefined ? {} : { headers: input.headers }),
        ...(input.fileName === undefined ? {} : { fileName: input.fileName }),
        ...(input.ownerScope === undefined ? {} : { ownerScope: input.ownerScope }),
        ...(input.traceId === undefined ? {} : { traceId: input.traceId })
      })
    }),
  "NativeNetwork.connectWebSocket": (input) =>
    Effect.gen(function* () {
      const network = yield* NativeNetwork
      return yield* network.connectWebSocket(input.url, {
        ...(input.protocols === undefined ? {} : { protocols: input.protocols }),
        ...(input.ownerScope === undefined ? {} : { ownerScope: input.ownerScope }),
        ...(input.traceId === undefined ? {} : { traceId: input.traceId })
      })
    }),
  "NativeNetwork.closeWebSocket": (input) =>
    Effect.gen(function* () {
      const network = yield* NativeNetwork
      return yield* network.closeWebSocket(
        input.socket,
        input.traceId === undefined ? {} : { traceId: input.traceId }
      )
    }),
  "NativeNetwork.localhostUrl": (input) =>
    Effect.gen(function* () {
      const network = yield* NativeNetwork
      return yield* network.localhostUrl(input.port, {
        ...(input.path === undefined ? {} : { path: input.path }),
        ...(input.secure === undefined ? {} : { secure: input.secure }),
        ...(input.traceId === undefined ? {} : { traceId: input.traceId })
      })
    }),
  "NativeNetwork.isSupported": () =>
    Effect.gen(function* () {
      const network = yield* NativeNetwork
      return yield* network.isSupported()
    })
})

export const NativeNetworkSurface = NativeSurface.make(Surface, NativeNetworkRpcGroup, {
  service: NativeNetworkClient,
  capabilities: NativeNetworkCapabilityMethods,
  handlers: NativeNetworkHandlersLive,
  client: (client) => nativeNetworkClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => nativeNetworkClientFromRpcClient(client, exchange)
})

export const makeHostNativeNetworkRpcRuntime = (
  handlers: NativeNetworkRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry | ResourceRegistry> =>
  NativeNetworkSurface.hostRuntime(handlers, runtimeOptions)

export interface NativeNetworkMemoryClientOptions {
  readonly failure?: Partial<
    Record<
      "fetch" | "upload" | "connectWebSocket" | "closeWebSocket" | "localhostUrl",
      NativeNetworkError
    >
  >
}

export const makeNativeNetworkMemoryClient = (
  options: NativeNetworkMemoryClientOptions = {}
): Effect.Effect<NativeNetworkClientApi, never, never> =>
  Effect.gen(function* () {
    const clock = yield* Clock.Clock
    const pubsub = yield* PubSub.bounded<NativeNetworkEvent>({ capacity: 256, replay: 128 })
    const sockets = yield* Ref.make<ReadonlyMap<string, NativeNetworkWebSocketSnapshot>>(new Map())
    const nextRequestId = yield* Ref.make(0)
    const nextSocketId = yield* Ref.make(0)

    return Object.freeze({
      fetch: (input) =>
        validateFetchInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.fetch,
              Effect.gen(function* () {
                const request = requestHandle(
                  yield* nextId(nextRequestId, "native-network-request"),
                  valid.ownerScope ?? "native-network"
                )
                yield* publishEvent(pubsub, clock, {
                  phase: "fetch-started",
                  request,
                  url: valid.url
                })
                const result = new NativeNetworkFetchResult({
                  request,
                  url: valid.url,
                  method: valid.method,
                  status: 200,
                  responseHeaders: [],
                  body: ""
                })
                yield* publishEvent(pubsub, clock, {
                  phase: "fetch-completed",
                  request,
                  url: valid.url
                })
                return result
              })
            )
          )
        ),
      upload: (input) =>
        validateUploadInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.upload,
              Effect.gen(function* () {
                const request = requestHandle(
                  yield* nextId(nextRequestId, "native-network-request"),
                  valid.ownerScope ?? "native-network"
                )
                const sentBytes = new TextEncoder().encode(valid.body).byteLength
                yield* publishEvent(pubsub, clock, {
                  phase: "upload-started",
                  request,
                  url: valid.url,
                  sentBytes: 0,
                  totalBytes: sentBytes
                })
                yield* publishEvent(pubsub, clock, {
                  phase: "upload-progress",
                  request,
                  url: valid.url,
                  sentBytes,
                  totalBytes: sentBytes
                })
                yield* publishEvent(pubsub, clock, {
                  phase: "upload-completed",
                  request,
                  url: valid.url,
                  sentBytes,
                  totalBytes: sentBytes
                })
                return new NativeNetworkUploadResult({
                  request,
                  url: valid.url,
                  status: 200,
                  sentBytes,
                  responseHeaders: []
                })
              })
            )
          )
        ),
      connectWebSocket: (input) =>
        validateConnectWebSocketInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.connectWebSocket,
              Effect.gen(function* () {
                const socket = socketHandle(
                  yield* nextId(nextSocketId, "native-network-websocket"),
                  valid.ownerScope ?? "native-network"
                )
                const snapshot = new NativeNetworkWebSocketSnapshot({
                  socket,
                  url: valid.url,
                  state: "open",
                  ...(valid.protocols?.[0] === undefined ? {} : { protocol: valid.protocols[0] })
                })
                yield* Ref.update(sockets, (current) => new Map(current).set(socket.id, snapshot))
                yield* publishEvent(pubsub, clock, {
                  phase: "websocket-opened",
                  socket,
                  url: valid.url
                })
                return snapshot
              })
            )
          )
        ),
      closeWebSocket: (input) =>
        validateWebSocketHandleInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.closeWebSocket,
              Effect.gen(function* () {
                const snapshot = yield* Ref.modify(sockets, (current) => {
                  const existing = current.get(valid.socket.id)
                  if (existing === undefined) {
                    return [undefined, current] as const
                  }
                  const next = new Map(current)
                  next.delete(valid.socket.id)
                  return [existing, next] as const
                })
                if (snapshot === undefined) {
                  return yield* Effect.fail(
                    makeHostProtocolInvalidStateError(
                      "missing-native-network-websocket",
                      valid.socket.id,
                      "NativeNetwork.closeWebSocket"
                    )
                  )
                }
                const closed = new NativeNetworkWebSocketSnapshot({
                  socket: snapshot.socket,
                  url: snapshot.url,
                  state: "closed"
                })
                yield* publishEvent(pubsub, clock, {
                  phase: "websocket-closed",
                  socket: snapshot.socket,
                  url: snapshot.url
                })
                return closed
              })
            )
          )
        ),
      localhostUrl: (input) =>
        validateLocalhostUrlInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.localhostUrl,
              Effect.succeed(
                new NativeNetworkLocalhostUrlResult({
                  url: `${valid.secure === true ? "https" : "http"}://127.0.0.1:${valid.port}${valid.path ?? "/"}`
                })
              )
            )
          )
        ),
      isSupported: () => Effect.succeed(new NativeNetworkSupportedResult({ supported: true })),
      events: () => Stream.fromPubSub(pubsub)
    } satisfies NativeNetworkClientApi)
  })

export const makeNativeNetworkUnsupportedClient = (): NativeNetworkClientApi =>
  Object.freeze({
    fetch: (input) =>
      validateFetchInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("NativeNetwork.fetch")))
      ),
    upload: (input) =>
      validateUploadInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("NativeNetwork.upload")))
      ),
    connectWebSocket: (input) =>
      validateConnectWebSocketInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("NativeNetwork.connectWebSocket")))
      ),
    closeWebSocket: (input) =>
      validateWebSocketHandleInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("NativeNetwork.closeWebSocket")))
      ),
    localhostUrl: (input) =>
      validateLocalhostUrlInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("NativeNetwork.localhostUrl")))
      ),
    isSupported: () =>
      Effect.succeed(
        new NativeNetworkSupportedResult({ supported: false, reason: UnsupportedReason })
      ),
    events: () => Stream.fail(unsupportedError(EventMethod))
  } satisfies NativeNetworkClientApi)

const makeNativeNetworkService = (
  client: NativeNetworkClientApi,
  options: NativeNetworkServiceOptions
): NativeNetworkServiceApi => {
  const explicitlyClosedSockets = new Set<string>()
  return Object.freeze({
    fetch: (url, requestOptions) =>
      validateFetchInput({
        url,
        method: requestOptions?.method ?? "GET",
        ...(requestOptions?.headers === undefined ? {} : { headers: requestOptions.headers }),
        ...(requestOptions?.body === undefined ? {} : { body: requestOptions.body }),
        ...(requestOptions?.ownerScope === undefined
          ? {}
          : { ownerScope: requestOptions.ownerScope }),
        ...(requestOptions?.traceId === undefined ? {} : { traceId: requestOptions.traceId })
      }).pipe(
        Effect.flatMap((valid) =>
          authorize(
            options.permissions,
            "fetch",
            destinationResource(valid.url),
            valid.traceId
          ).pipe(Effect.andThen(client.fetch(valid)))
        )
      ),
    upload: (url, body, requestOptions) =>
      validateUploadInput({
        url,
        body,
        ...(requestOptions?.method === undefined ? {} : { method: requestOptions.method }),
        ...(requestOptions?.headers === undefined ? {} : { headers: requestOptions.headers }),
        ...(requestOptions?.fileName === undefined ? {} : { fileName: requestOptions.fileName }),
        ...(requestOptions?.ownerScope === undefined
          ? {}
          : { ownerScope: requestOptions.ownerScope }),
        ...(requestOptions?.traceId === undefined ? {} : { traceId: requestOptions.traceId })
      }).pipe(
        Effect.flatMap((valid) =>
          authorize(
            options.permissions,
            "upload",
            destinationResource(valid.url),
            valid.traceId
          ).pipe(Effect.andThen(client.upload(valid)))
        )
      ),
    connectWebSocket: (url, requestOptions) =>
      Effect.gen(function* () {
        const request = yield* validateConnectWebSocketInput({
          url,
          ...(requestOptions?.protocols === undefined
            ? {}
            : { protocols: requestOptions.protocols }),
          ...(requestOptions?.ownerScope === undefined
            ? {}
            : { ownerScope: requestOptions.ownerScope }),
          ...(requestOptions?.traceId === undefined ? {} : { traceId: requestOptions.traceId })
        })
        yield* authorize(
          options.permissions,
          "connectWebSocket",
          destinationResource(request.url),
          request.traceId
        )
        const snapshot = yield* client.connectWebSocket(request)
        const registered = yield* options.resources
          .register({
            kind: "native-network-websocket",
            id: makeResourceId(snapshot.socket.id),
            ownerScope: request.ownerScope ?? snapshot.socket.ownerScope,
            state: "open",
            dispose: Effect.suspend(() =>
              explicitlyClosedSockets.has(snapshot.socket.id)
                ? Effect.void
                : client
                    .closeWebSocket(
                      new NativeNetworkWebSocketHandleInput({ socket: snapshot.socket })
                    )
                    .pipe(Effect.ignore)
            )
          })
          .pipe(
            Effect.mapError((error) =>
              makeHostProtocolInternalError(
                `failed to register native network websocket resource: ${error.message}`,
                "NativeNetwork.connectWebSocket"
              )
            )
          )
        return withSocketHandle(snapshot, {
          kind: "native-network-websocket",
          id: registered.id,
          generation: registered.generation,
          ownerScope: registered.ownerScope,
          state: "open"
        })
      }),
    closeWebSocket: (socket, requestOptions) =>
      validateWebSocketHandleInput({
        socket,
        ...(requestOptions?.traceId === undefined ? {} : { traceId: requestOptions.traceId })
      }).pipe(
        Effect.flatMap((valid) =>
          authorize(options.permissions, "closeWebSocket", valid.socket.id, valid.traceId).pipe(
            Effect.andThen(client.closeWebSocket(valid)),
            Effect.tap(() => Effect.sync(() => explicitlyClosedSockets.add(valid.socket.id))),
            Effect.tap(() => options.resources.dispose(makeResourceId(valid.socket.id))),
            Effect.ensuring(Effect.sync(() => explicitlyClosedSockets.delete(valid.socket.id)))
          )
        )
      ),
    localhostUrl: (port, requestOptions) =>
      validateLocalhostUrlInput({
        port,
        ...(requestOptions?.path === undefined ? {} : { path: requestOptions.path }),
        ...(requestOptions?.secure === undefined ? {} : { secure: requestOptions.secure }),
        ...(requestOptions?.traceId === undefined ? {} : { traceId: requestOptions.traceId })
      }).pipe(
        Effect.flatMap((valid) =>
          authorize(
            options.permissions,
            "localhostUrl",
            `127.0.0.1:${valid.port}`,
            valid.traceId
          ).pipe(Effect.andThen(client.localhostUrl(valid)))
        )
      ),
    isSupported: () => client.isSupported(),
    events: () => client.events()
  } satisfies NativeNetworkServiceApi)
}

const nativeNetworkClientFromRpcClient = (
  client: DesktopRpcClient<NativeNetworkRpc>,
  exchange: BridgeClientExchange | undefined
): NativeNetworkClientApi =>
  Object.freeze({
    fetch: (input) =>
      validateFetchInput(input).pipe(
        Effect.flatMap((valid) =>
          runNativeNetworkRpc(client["NativeNetwork.fetch"](valid), "NativeNetwork.fetch")
        )
      ),
    upload: (input) =>
      validateUploadInput(input).pipe(
        Effect.flatMap((valid) =>
          runNativeNetworkRpc(client["NativeNetwork.upload"](valid), "NativeNetwork.upload")
        )
      ),
    connectWebSocket: (input) =>
      validateConnectWebSocketInput(input).pipe(
        Effect.flatMap((valid) =>
          runNativeNetworkRpc(
            client["NativeNetwork.connectWebSocket"](valid),
            "NativeNetwork.connectWebSocket"
          )
        )
      ),
    closeWebSocket: (input) =>
      validateWebSocketHandleInput(input).pipe(
        Effect.flatMap((valid) =>
          runNativeNetworkRpc(
            client["NativeNetwork.closeWebSocket"](valid),
            "NativeNetwork.closeWebSocket"
          )
        )
      ),
    localhostUrl: (input) =>
      validateLocalhostUrlInput(input).pipe(
        Effect.flatMap((valid) =>
          runNativeNetworkRpc(
            client["NativeNetwork.localhostUrl"](valid),
            "NativeNetwork.localhostUrl"
          )
        )
      ),
    isSupported: () =>
      runNativeNetworkRpc(
        client["NativeNetwork.isSupported"](undefined),
        "NativeNetwork.isSupported"
      ),
    events: () => subscribeNativeEvent(exchange, EventMethod, NativeNetworkEvent)
  } satisfies NativeNetworkClientApi)

const validateFetchInput = (input: unknown) =>
  decodeNativeInput(NativeNetworkFetchInput, input, "NativeNetwork.fetch").pipe(
    Effect.flatMap(validateFetchShape)
  )
const validateUploadInput = (input: unknown) =>
  decodeNativeInput(NativeNetworkUploadInput, input, "NativeNetwork.upload")
const validateConnectWebSocketInput = (input: unknown) =>
  decodeNativeInput(NativeNetworkWebSocketConnectInput, input, "NativeNetwork.connectWebSocket")
const validateWebSocketHandleInput = (input: unknown) =>
  decodeNativeInput(NativeNetworkWebSocketHandleInput, input, "NativeNetwork.closeWebSocket")
const validateLocalhostUrlInput = (input: unknown) =>
  decodeNativeInput(NativeNetworkLocalhostUrlInput, input, "NativeNetwork.localhostUrl")

const validateFetchShape = (
  input: NativeNetworkFetchInput
): Effect.Effect<NativeNetworkFetchInput, NativeNetworkError, never> =>
  input.method === "GET" && input.body !== undefined
    ? Effect.fail(
        makeHostProtocolInvalidArgumentError(
          "body",
          "must be omitted for GET requests",
          "NativeNetwork.fetch"
        )
      )
    : Effect.succeed(input)

const runNativeNetworkRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, NativeNetworkError, never> => runNativeRpc(effect, operation, Surface)

const publishEvent = (
  pubsub: PubSub.PubSub<NativeNetworkEvent>,
  clock: Clock.Clock,
  input: {
    readonly phase: NativeNetworkEventPhase
    readonly request?: NativeNetworkRequestHandle
    readonly socket?: NativeNetworkWebSocketHandle
    readonly url?: string
    readonly sentBytes?: number
    readonly totalBytes?: number
  }
): Effect.Effect<void, never, never> =>
  PubSub.publish(
    pubsub,
    new NativeNetworkEvent({
      type: "native-network-event",
      timestamp: clock.currentTimeMillisUnsafe(),
      phase: input.phase,
      ...(input.request === undefined ? {} : { request: input.request }),
      ...(input.socket === undefined ? {} : { socket: input.socket }),
      ...(input.url === undefined ? {} : { url: input.url }),
      ...(input.sentBytes === undefined ? {} : { sentBytes: input.sentBytes }),
      ...(input.totalBytes === undefined ? {} : { totalBytes: input.totalBytes })
    })
  ).pipe(Effect.asVoid)

const requestHandle = (id: string, ownerScope: string) => ({
  kind: "native-network-request" as const,
  id: makeResourceId(id),
  generation: 0,
  ownerScope,
  state: "open" as const
})

const socketHandle = (id: string, ownerScope: string) => ({
  kind: "native-network-websocket" as const,
  id: makeResourceId(id),
  generation: 0,
  ownerScope,
  state: "open" as const
})

const withSocketHandle = (
  snapshot: NativeNetworkWebSocketSnapshot,
  socket: NativeNetworkWebSocketHandle
): NativeNetworkWebSocketSnapshot =>
  new NativeNetworkWebSocketSnapshot({
    socket,
    url: snapshot.url,
    state: snapshot.state,
    ...(snapshot.protocol === undefined ? {} : { protocol: snapshot.protocol }),
    ...(snapshot.message === undefined ? {} : { message: snapshot.message })
  })

const nextId = (ref: Ref.Ref<number>, prefix: string): Effect.Effect<string, never, never> =>
  Ref.modify(ref, (current) => [`${prefix}:${current + 1}`, current + 1])

const destinationResource = (url: string): string => {
  const parsed = new URL(url)
  return `${parsed.protocol}//${parsed.host}`
}

const capability = (
  method: "fetch" | "upload" | "connectWebSocket" | "closeWebSocket" | "localhostUrl"
) => P.nativeInvoke({ primitive: Surface, methods: [method] })

const authorize = (
  permissions: PermissionRegistryApi,
  method: "fetch" | "upload" | "connectWebSocket" | "closeWebSocket" | "localhostUrl",
  resource: string,
  traceId: string | undefined
): Effect.Effect<void, NativeNetworkError, never> =>
  permissions
    .check(
      capability(method),
      new PermissionContext({
        actor: new PermissionActor({ kind: "app", id: "app" }),
        resource,
        traceId: traceId ?? `NativeNetwork.${method}`
      })
    )
    .pipe(
      Effect.asVoid,
      Effect.catch((error: PermissionRegistryError) =>
        error instanceof PermissionDeniedError
          ? Effect.fail(permissionDeniedError(capability(method), error, `NativeNetwork.${method}`))
          : Effect.fail(
              makeHostProtocolInternalError(
                `native network permission registry failure: ${error._tag}`,
                `NativeNetwork.${method}`
              )
            )
      )
    )

const permissionDeniedError = (
  cap: ReturnType<typeof capability>,
  error: PermissionDeniedError,
  operation: string
): HostProtocolPermissionDeniedError =>
  new HostProtocolPermissionDeniedError({
    tag: "PermissionDenied",
    capability: JSON.stringify(cap),
    ...(Option.isNone(error.resource) ? {} : { resource: error.resource.value }),
    message: error.message,
    operation,
    recoverable: false
  })

const unsupportedError = (operation: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: UnsupportedReason,
    operation,
    recoverable: false
  })

const failOr = <A>(
  failure: NativeNetworkError | undefined,
  effect: Effect.Effect<A, NativeNetworkError, never>
): Effect.Effect<A, NativeNetworkError, never> =>
  failure === undefined ? effect : Effect.fail(failure)
