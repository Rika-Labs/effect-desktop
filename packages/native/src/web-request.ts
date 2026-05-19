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

import type { SessionProfileHandle } from "./contracts/session-profile.js"
import {
  WebRequestBeforeRequestInput,
  WebRequestEvent,
  WebRequestHeadersReceivedInput,
  type WebRequestInterceptorHandle,
  WebRequestInterceptorSnapshot,
  WebRequestRemoveListenerInput,
  WebRequestSupportedResult,
  type WebRequestAction,
  type WebRequestPhase
} from "./contracts/web-request.js"
import { subscribeNativeEvent } from "./event-stream.js"
import { decodeNativeInput, runNativeRpc } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"

export * from "./contracts/web-request.js"

const Surface = "WebRequest"
const UnsupportedReason = "host-web-request-unavailable"
const EventMethod = "WebRequest.Event"
const UnsupportedSupport = NativeSurface.support.unsupported(UnsupportedReason, {
  platforms: [
    { platform: "macos", status: "unsupported", reason: UnsupportedReason },
    { platform: "windows", status: "unsupported", reason: UnsupportedReason },
    { platform: "linux", status: "unsupported", reason: UnsupportedReason }
  ]
})

export type WebRequestError = HostProtocolError

export const WebRequestOnBeforeRequest = NativeSurface.rpc(Surface, "onBeforeRequest", {
  payload: WebRequestBeforeRequestInput,
  success: WebRequestInterceptorSnapshot,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["onBeforeRequest"] })
  ),
  endpoint: "mutation",
  support: UnsupportedSupport
})
export const WebRequestOnHeadersReceived = NativeSurface.rpc(Surface, "onHeadersReceived", {
  payload: WebRequestHeadersReceivedInput,
  success: WebRequestInterceptorSnapshot,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["onHeadersReceived"] })
  ),
  endpoint: "mutation",
  support: UnsupportedSupport
})
export const WebRequestRemoveListener = NativeSurface.rpc(Surface, "removeListener", {
  payload: WebRequestRemoveListenerInput,
  success: Schema.Void,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["removeListener"] })
  ),
  endpoint: "mutation",
  support: UnsupportedSupport
})
export const WebRequestIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: WebRequestSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

export const WebRequestRpcEvents = Object.freeze({
  Event: { payload: WebRequestEvent }
})

const WebRequestRpcGroup = RpcGroup.make(
  WebRequestOnBeforeRequest,
  WebRequestOnHeadersReceived,
  WebRequestRemoveListener,
  WebRequestIsSupported
)

export const WebRequestRpcs: RpcGroup.RpcGroup<WebRequestRpc> = WebRequestRpcGroup

export const WebRequestMethodNames = Object.freeze([
  "onBeforeRequest",
  "onHeadersReceived",
  "removeListener",
  "isSupported"
] as const)

const WebRequestCapabilityMethods = Object.freeze([
  "onBeforeRequest",
  "onHeadersReceived",
  "removeListener"
] as const satisfies readonly (typeof WebRequestMethodNames)[number][])

export interface WebRequestClientApi {
  readonly onBeforeRequest: (
    input: WebRequestBeforeRequestInput
  ) => Effect.Effect<WebRequestInterceptorSnapshot, WebRequestError, never>
  readonly onHeadersReceived: (
    input: WebRequestHeadersReceivedInput
  ) => Effect.Effect<WebRequestInterceptorSnapshot, WebRequestError, never>
  readonly removeListener: (
    input: WebRequestRemoveListenerInput
  ) => Effect.Effect<void, WebRequestError, never>
  readonly isSupported: () => Effect.Effect<WebRequestSupportedResult, WebRequestError, never>
  readonly events: (
    profile?: SessionProfileHandle
  ) => Stream.Stream<WebRequestEvent, WebRequestError, never>
}

export class WebRequestClient extends Context.Service<WebRequestClient, WebRequestClientApi>()(
  "@effect-desktop/native/WebRequestClient"
) {}

export interface WebRequestServiceApi {
  readonly onBeforeRequest: (
    profile: SessionProfileHandle,
    urlPattern: string,
    action: "allow" | "block" | "redirect",
    options?: {
      readonly redirectUrl?: string
      readonly ownerScope?: string
      readonly traceId?: string
    }
  ) => Effect.Effect<WebRequestInterceptorSnapshot, WebRequestError, never>
  readonly onHeadersReceived: (
    profile: SessionProfileHandle,
    urlPattern: string,
    responseHeaders: readonly { readonly name: string; readonly value: string }[],
    options?: { readonly ownerScope?: string; readonly traceId?: string }
  ) => Effect.Effect<WebRequestInterceptorSnapshot, WebRequestError, never>
  readonly removeListener: (
    interceptor: WebRequestInterceptorHandle,
    options?: { readonly traceId?: string }
  ) => Effect.Effect<void, WebRequestError, never>
  readonly isSupported: () => Effect.Effect<WebRequestSupportedResult, WebRequestError, never>
  readonly events: (
    profile?: SessionProfileHandle
  ) => Stream.Stream<WebRequestEvent, WebRequestError, never>
}

export interface WebRequestServiceOptions {
  readonly permissions: PermissionRegistryApi
  readonly resources: ResourceRegistryApi
}

export class WebRequest extends Context.Service<WebRequest, WebRequestServiceApi>()(
  "@effect-desktop/native/WebRequest"
) {
  static readonly layer = Layer.effect(WebRequest)(
    Effect.gen(function* () {
      const client = yield* WebRequestClient
      const permissions = yield* PermissionRegistry
      const resources = yield* ResourceRegistry
      return makeWebRequestService(client, { permissions, resources })
    })
  )
}

export const WebRequestLive = WebRequest.layer

export const makeWebRequestClientLayer = (
  client: WebRequestClientApi
): Layer.Layer<WebRequestClient> => Layer.succeed(WebRequestClient)(client)

export const makeWebRequestServiceLayer = (
  client: WebRequestClientApi,
  options: WebRequestServiceOptions
): Layer.Layer<WebRequest> => Layer.succeed(WebRequest)(makeWebRequestService(client, options))

export const makeWebRequestBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<WebRequestClient> => WebRequestSurface.bridgeClientLayer(exchange, options)

export type WebRequestRpc = RpcGroup.Rpcs<typeof WebRequestRpcGroup>
export type WebRequestRpcHandlers = RpcGroup.HandlersFrom<WebRequestRpc>

export const WebRequestHandlersLive = WebRequestRpcGroup.toLayer({
  "WebRequest.onBeforeRequest": (input) =>
    Effect.gen(function* () {
      const webRequest = yield* WebRequest
      return yield* webRequest.onBeforeRequest(input.profile, input.urlPattern, input.action, {
        ...(input.redirectUrl === undefined ? {} : { redirectUrl: input.redirectUrl }),
        ...(input.ownerScope === undefined ? {} : { ownerScope: input.ownerScope }),
        ...(input.traceId === undefined ? {} : { traceId: input.traceId })
      })
    }),
  "WebRequest.onHeadersReceived": (input) =>
    Effect.gen(function* () {
      const webRequest = yield* WebRequest
      return yield* webRequest.onHeadersReceived(
        input.profile,
        input.urlPattern,
        input.responseHeaders,
        {
          ...(input.ownerScope === undefined ? {} : { ownerScope: input.ownerScope }),
          ...(input.traceId === undefined ? {} : { traceId: input.traceId })
        }
      )
    }),
  "WebRequest.removeListener": (input) =>
    Effect.gen(function* () {
      const webRequest = yield* WebRequest
      return yield* webRequest.removeListener(
        input.interceptor,
        input.traceId === undefined ? {} : { traceId: input.traceId }
      )
    }),
  "WebRequest.isSupported": () =>
    Effect.gen(function* () {
      const webRequest = yield* WebRequest
      return yield* webRequest.isSupported()
    })
})

export const WebRequestSurface = NativeSurface.make(Surface, WebRequestRpcGroup, {
  service: WebRequestClient,
  capabilities: WebRequestCapabilityMethods,
  handlers: WebRequestHandlersLive,
  client: (client) => webRequestClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => webRequestClientFromRpcClient(client, exchange)
})

export const makeHostWebRequestRpcRuntime = (
  handlers: WebRequestRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry | ResourceRegistry> =>
  WebRequestSurface.hostRuntime(handlers, runtimeOptions)

export interface WebRequestMemoryClientOptions {
  readonly failure?: Partial<
    Record<"onBeforeRequest" | "onHeadersReceived" | "removeListener", WebRequestError>
  >
}

export const makeWebRequestMemoryClient = (
  options: WebRequestMemoryClientOptions = {}
): Effect.Effect<WebRequestClientApi, never, never> =>
  Effect.gen(function* () {
    const clock = yield* Clock.Clock
    const pubsub = yield* PubSub.bounded<WebRequestEvent>({ capacity: 256, replay: 128 })
    const interceptors = yield* Ref.make<ReadonlyMap<string, WebRequestInterceptorSnapshot>>(
      new Map()
    )
    const nextId = yield* Ref.make(0)

    return Object.freeze({
      onBeforeRequest: (input) =>
        validateBeforeRequestInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.onBeforeRequest,
              registerInterceptor(interceptors, nextId, pubsub, clock, {
                action: valid.action,
                phase: "before-request",
                profile: valid.profile,
                urlPattern: valid.urlPattern,
                ...(valid.ownerScope === undefined ? {} : { ownerScope: valid.ownerScope }),
                ...(valid.redirectUrl === undefined ? {} : { redirectUrl: valid.redirectUrl })
              })
            )
          )
        ),
      onHeadersReceived: (input) =>
        validateHeadersReceivedInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.onHeadersReceived,
              registerInterceptor(interceptors, nextId, pubsub, clock, {
                action: "modify-headers",
                phase: "headers-received",
                profile: valid.profile,
                responseHeaders: valid.responseHeaders,
                urlPattern: valid.urlPattern,
                ...(valid.ownerScope === undefined ? {} : { ownerScope: valid.ownerScope })
              })
            )
          )
        ),
      removeListener: (input) =>
        validateRemoveListenerInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.removeListener,
              Effect.gen(function* () {
                const removed = yield* Ref.modify(interceptors, (current) => {
                  const snapshot = current.get(valid.interceptor.id)
                  if (snapshot === undefined) {
                    return [undefined, current] as const
                  }
                  const next = new Map(current)
                  next.delete(valid.interceptor.id)
                  return [snapshot, next] as const
                })
                if (removed === undefined) {
                  return yield* Effect.fail(
                    makeHostProtocolInvalidStateError(
                      "missing-web-request-interceptor",
                      valid.interceptor.id,
                      "WebRequest.removeListener"
                    )
                  )
                }
                yield* publishEvent(pubsub, clock, removed, "removed")
              })
            )
          )
        ),
      isSupported: () => Effect.succeed(new WebRequestSupportedResult({ supported: true })),
      events: (profile) =>
        Stream.fromPubSub(pubsub).pipe(
          Stream.filter((event) => profile === undefined || event.profile.id === profile.id)
        )
    } satisfies WebRequestClientApi)
  })

export const makeWebRequestUnsupportedClient = (): WebRequestClientApi =>
  Object.freeze({
    onBeforeRequest: (input) =>
      validateBeforeRequestInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("WebRequest.onBeforeRequest")))
      ),
    onHeadersReceived: (input) =>
      validateHeadersReceivedInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("WebRequest.onHeadersReceived")))
      ),
    removeListener: (input) =>
      validateRemoveListenerInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("WebRequest.removeListener")))
      ),
    isSupported: () =>
      Effect.succeed(
        new WebRequestSupportedResult({ supported: false, reason: UnsupportedReason })
      ),
    events: () => Stream.fail(unsupportedError(EventMethod))
  } satisfies WebRequestClientApi)

const makeWebRequestService = (
  client: WebRequestClientApi,
  options: WebRequestServiceOptions
): WebRequestServiceApi => {
  const explicitlyRemovedInterceptors = new Set<string>()
  const service: WebRequestServiceApi = {
    onBeforeRequest: (profile, urlPattern, action, requestOptions) =>
      Effect.gen(function* () {
        const request = yield* validateBeforeRequestInput({
          profile,
          urlPattern,
          action,
          ...(requestOptions?.redirectUrl === undefined
            ? {}
            : { redirectUrl: requestOptions.redirectUrl }),
          ...(requestOptions?.ownerScope === undefined
            ? {}
            : { ownerScope: requestOptions.ownerScope }),
          ...(requestOptions?.traceId === undefined ? {} : { traceId: requestOptions.traceId })
        })
        yield* authorize(
          options.permissions,
          "onBeforeRequest",
          request.profile.id,
          request.traceId
        )
        const snapshot = yield* client.onBeforeRequest(request)
        return yield* registerResource(
          options.resources,
          client,
          snapshot,
          explicitlyRemovedInterceptors
        )
      }),
    onHeadersReceived: (profile, urlPattern, responseHeaders, requestOptions) =>
      Effect.gen(function* () {
        const request = yield* validateHeadersReceivedInput({
          profile,
          urlPattern,
          responseHeaders,
          ...(requestOptions?.ownerScope === undefined
            ? {}
            : { ownerScope: requestOptions.ownerScope }),
          ...(requestOptions?.traceId === undefined ? {} : { traceId: requestOptions.traceId })
        })
        yield* authorize(
          options.permissions,
          "onHeadersReceived",
          request.profile.id,
          request.traceId
        )
        const snapshot = yield* client.onHeadersReceived(request)
        return yield* registerResource(
          options.resources,
          client,
          snapshot,
          explicitlyRemovedInterceptors
        )
      }),
    removeListener: (interceptor, requestOptions) =>
      validateRemoveListenerInput({
        interceptor,
        ...(requestOptions?.traceId === undefined ? {} : { traceId: requestOptions.traceId })
      }).pipe(
        Effect.flatMap((valid) =>
          authorize(
            options.permissions,
            "removeListener",
            valid.interceptor.id,
            valid.traceId
          ).pipe(
            Effect.andThen(client.removeListener(valid)),
            Effect.tap(() =>
              Effect.sync(() => explicitlyRemovedInterceptors.add(valid.interceptor.id))
            ),
            Effect.tap(() => options.resources.dispose(makeResourceId(valid.interceptor.id))),
            Effect.ensuring(
              Effect.sync(() => explicitlyRemovedInterceptors.delete(valid.interceptor.id))
            )
          )
        )
      ),
    isSupported: () => client.isSupported(),
    events: (profile) => client.events(profile)
  }

  return Object.freeze(service)
}

const webRequestClientFromRpcClient = (
  client: DesktopRpcClient<WebRequestRpc>,
  exchange: BridgeClientExchange | undefined
): WebRequestClientApi =>
  Object.freeze({
    onBeforeRequest: (input) =>
      validateBeforeRequestInput(input).pipe(
        Effect.flatMap((valid) =>
          runWebRequestRpc(
            client["WebRequest.onBeforeRequest"](valid),
            "WebRequest.onBeforeRequest"
          )
        )
      ),
    onHeadersReceived: (input) =>
      validateHeadersReceivedInput(input).pipe(
        Effect.flatMap((valid) =>
          runWebRequestRpc(
            client["WebRequest.onHeadersReceived"](valid),
            "WebRequest.onHeadersReceived"
          )
        )
      ),
    removeListener: (input) =>
      validateRemoveListenerInput(input).pipe(
        Effect.flatMap((valid) =>
          runWebRequestRpc(client["WebRequest.removeListener"](valid), "WebRequest.removeListener")
        )
      ),
    isSupported: () =>
      runWebRequestRpc(client["WebRequest.isSupported"](undefined), "WebRequest.isSupported"),
    events: (profile) =>
      subscribeNativeEvent(exchange, EventMethod, WebRequestEvent).pipe(
        Stream.filter((event) => profile === undefined || event.profile.id === profile.id)
      )
  } satisfies WebRequestClientApi)

const validateBeforeRequestInput = (input: unknown) =>
  decodeNativeInput(WebRequestBeforeRequestInput, input, "WebRequest.onBeforeRequest").pipe(
    Effect.flatMap(validateBeforeRequestShape)
  )
const validateHeadersReceivedInput = (input: unknown) =>
  decodeNativeInput(WebRequestHeadersReceivedInput, input, "WebRequest.onHeadersReceived")
const validateRemoveListenerInput = (input: unknown) =>
  decodeNativeInput(WebRequestRemoveListenerInput, input, "WebRequest.removeListener")

const runWebRequestRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, WebRequestError, never> => runNativeRpc(effect, operation, Surface)

const validateBeforeRequestShape = (
  input: WebRequestBeforeRequestInput
): Effect.Effect<WebRequestBeforeRequestInput, WebRequestError, never> =>
  input.action === "redirect" && input.redirectUrl === undefined
    ? Effect.fail(
        makeHostProtocolInvalidArgumentError(
          "redirectUrl",
          "is required when redirecting a request",
          "WebRequest.onBeforeRequest"
        )
      )
    : input.action !== "redirect" && input.redirectUrl !== undefined
      ? Effect.fail(
          makeHostProtocolInvalidArgumentError(
            "redirectUrl",
            "is only valid when redirecting a request",
            "WebRequest.onBeforeRequest"
          )
        )
      : Effect.succeed(input)

const registerResource = (
  resources: ResourceRegistryApi,
  client: WebRequestClientApi,
  snapshot: WebRequestInterceptorSnapshot,
  explicitlyRemovedInterceptors: Set<string>
): Effect.Effect<WebRequestInterceptorSnapshot, WebRequestError, never> =>
  resources
    .register({
      kind: "web-request-interceptor",
      id: makeResourceId(snapshot.interceptor.id),
      ownerScope: snapshot.interceptor.ownerScope,
      state: "open",
      dispose: Effect.suspend(() =>
        explicitlyRemovedInterceptors.has(snapshot.interceptor.id)
          ? Effect.void
          : client
              .removeListener(
                new WebRequestRemoveListenerInput({ interceptor: snapshot.interceptor })
              )
              .pipe(Effect.ignore)
      )
    })
    .pipe(
      Effect.map((registered) =>
        withInterceptorHandle(snapshot, {
          kind: "web-request-interceptor",
          id: registered.id,
          generation: registered.generation,
          ownerScope: registered.ownerScope,
          state: "open"
        })
      ),
      Effect.mapError((error) =>
        makeHostProtocolInternalError(
          `failed to register web request interceptor resource: ${error.message}`,
          `WebRequest.${methodFromPhase(snapshot.phase)}`
        )
      )
    )

const registerInterceptor = (
  interceptors: Ref.Ref<ReadonlyMap<string, WebRequestInterceptorSnapshot>>,
  nextId: Ref.Ref<number>,
  pubsub: PubSub.PubSub<WebRequestEvent>,
  clock: Clock.Clock,
  input: {
    readonly action: WebRequestAction
    readonly ownerScope?: string
    readonly phase: WebRequestPhase
    readonly profile: SessionProfileHandle
    readonly redirectUrl?: string
    readonly responseHeaders?: readonly { readonly name: string; readonly value: string }[]
    readonly urlPattern: string
  }
): Effect.Effect<WebRequestInterceptorSnapshot, WebRequestError, never> =>
  Effect.gen(function* () {
    const order = yield* Ref.updateAndGet(nextId, (current) => current + 1)
    const snapshot = new WebRequestInterceptorSnapshot({
      interceptor: interceptorHandle(
        `web-request-interceptor:${order}`,
        input.ownerScope ?? input.profile.ownerScope
      ),
      profile: input.profile,
      phase: input.phase,
      urlPattern: input.urlPattern,
      action: input.action,
      order,
      ...(input.redirectUrl === undefined ? {} : { redirectUrl: input.redirectUrl }),
      ...(input.responseHeaders === undefined
        ? {}
        : { responseHeaders: [...input.responseHeaders] })
    })
    yield* Ref.update(interceptors, (current) =>
      new Map(current).set(snapshot.interceptor.id, snapshot)
    )
    yield* publishEvent(pubsub, clock, snapshot, "registered")
    return snapshot
  })

const publishEvent = (
  pubsub: PubSub.PubSub<WebRequestEvent>,
  clock: Clock.Clock,
  snapshot: WebRequestInterceptorSnapshot,
  phase: "registered" | "removed"
): Effect.Effect<void, never, never> =>
  PubSub.publish(
    pubsub,
    new WebRequestEvent({
      type: "web-request-event",
      timestamp: clock.currentTimeMillisUnsafe(),
      phase,
      interceptor: snapshot.interceptor,
      profile: snapshot.profile,
      requestPhase: snapshot.phase,
      urlPattern: snapshot.urlPattern,
      action: snapshot.action,
      order: snapshot.order
    })
  ).pipe(Effect.asVoid)

const withInterceptorHandle = (
  snapshot: WebRequestInterceptorSnapshot,
  interceptor: WebRequestInterceptorHandle
): WebRequestInterceptorSnapshot =>
  new WebRequestInterceptorSnapshot({
    interceptor,
    profile: snapshot.profile,
    phase: snapshot.phase,
    urlPattern: snapshot.urlPattern,
    action: snapshot.action,
    order: snapshot.order,
    ...(snapshot.redirectUrl === undefined ? {} : { redirectUrl: snapshot.redirectUrl }),
    ...(snapshot.responseHeaders === undefined ? {} : { responseHeaders: snapshot.responseHeaders })
  })

const interceptorHandle = (id: string, ownerScope: string): WebRequestInterceptorHandle => ({
  kind: "web-request-interceptor",
  id: makeResourceId(id),
  generation: 0,
  ownerScope,
  state: "open"
})

const methodFromPhase = (phase: WebRequestPhase): "onBeforeRequest" | "onHeadersReceived" =>
  phase === "before-request" ? "onBeforeRequest" : "onHeadersReceived"

const capability = (method: "onBeforeRequest" | "onHeadersReceived" | "removeListener") =>
  P.nativeInvoke({ primitive: Surface, methods: [method] })

const authorize = (
  permissions: PermissionRegistryApi,
  method: "onBeforeRequest" | "onHeadersReceived" | "removeListener",
  resource: string,
  traceId: string | undefined
): Effect.Effect<void, WebRequestError, never> =>
  permissions
    .check(
      capability(method),
      new PermissionContext({
        actor: new PermissionActor({ kind: "app", id: "app" }),
        resource,
        traceId: traceId ?? `WebRequest.${method}`
      })
    )
    .pipe(
      Effect.asVoid,
      Effect.catch((error: PermissionRegistryError) =>
        error instanceof PermissionDeniedError
          ? Effect.fail(permissionDeniedError(capability(method), error, `WebRequest.${method}`))
          : Effect.fail(
              makeHostProtocolInternalError(
                `web request permission registry failure: ${error._tag}`,
                `WebRequest.${method}`
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
  failure: WebRequestError | undefined,
  effect: Effect.Effect<A, WebRequestError, never>
): Effect.Effect<A, WebRequestError, never> =>
  failure === undefined ? effect : Effect.fail(failure)
