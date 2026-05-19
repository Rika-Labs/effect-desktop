import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  HostProtocolPermissionDeniedError,
  HostProtocolUnsupportedError,
  makeHostProtocolInternalError,
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
  DownloadEvent,
  type DownloadHandle,
  DownloadHandleInput,
  DownloadListInput,
  DownloadListResult,
  DownloadSnapshot,
  DownloadStartInput,
  DownloadSupportedResult
} from "./contracts/download.js"
import type { SessionProfileHandle } from "./contracts/session-profile.js"
import { subscribeNativeEvent } from "./event-stream.js"
import { decodeNativeInput, runNativeRpc } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"

export * from "./contracts/download.js"

const Surface = "Download"
const UnsupportedReason = "host-download-unavailable"
const EventMethod = "Download.Event"
const UnsupportedSupport = NativeSurface.support.unsupported(UnsupportedReason, {
  platforms: [
    { platform: "macos", status: "unsupported", reason: UnsupportedReason },
    { platform: "windows", status: "unsupported", reason: UnsupportedReason },
    { platform: "linux", status: "unsupported", reason: UnsupportedReason }
  ]
})

export type DownloadError = HostProtocolError

export const DownloadStart = NativeSurface.rpc(Surface, "start", {
  payload: DownloadStartInput,
  success: DownloadSnapshot,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["start"] })
  ),
  endpoint: "mutation",
  support: UnsupportedSupport
})
export const DownloadPause = NativeSurface.rpc(Surface, "pause", {
  payload: DownloadHandleInput,
  success: DownloadSnapshot,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["pause"] })
  ),
  endpoint: "mutation",
  support: UnsupportedSupport
})
export const DownloadResume = NativeSurface.rpc(Surface, "resume", {
  payload: DownloadHandleInput,
  success: DownloadSnapshot,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["resume"] })
  ),
  endpoint: "mutation",
  support: UnsupportedSupport
})
export const DownloadCancel = NativeSurface.rpc(Surface, "cancel", {
  payload: DownloadHandleInput,
  success: DownloadSnapshot,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["cancel"] })
  ),
  endpoint: "mutation",
  support: UnsupportedSupport
})
export const DownloadList = NativeSurface.rpc(Surface, "list", {
  payload: DownloadListInput,
  success: DownloadListResult,
  authority: NativeSurface.authority.custom(
    P.nativeInvoke({ primitive: Surface, methods: ["list"] })
  ),
  endpoint: "query",
  support: UnsupportedSupport
})
export const DownloadIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: DownloadSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

export const DownloadRpcEvents = Object.freeze({
  Event: { payload: DownloadEvent }
})

const DownloadRpcGroup = RpcGroup.make(
  DownloadStart,
  DownloadPause,
  DownloadResume,
  DownloadCancel,
  DownloadList,
  DownloadIsSupported
)

export const DownloadRpcs: RpcGroup.RpcGroup<DownloadRpc> = DownloadRpcGroup

export const DownloadMethodNames = Object.freeze([
  "start",
  "pause",
  "resume",
  "cancel",
  "list",
  "isSupported"
] as const)

const DownloadCapabilityMethods = Object.freeze([
  "start",
  "pause",
  "resume",
  "cancel",
  "list"
] as const satisfies readonly (typeof DownloadMethodNames)[number][])

export interface DownloadClientApi {
  readonly start: (
    input: DownloadStartInput
  ) => Effect.Effect<DownloadSnapshot, DownloadError, never>
  readonly pause: (
    input: DownloadHandleInput
  ) => Effect.Effect<DownloadSnapshot, DownloadError, never>
  readonly resume: (
    input: DownloadHandleInput
  ) => Effect.Effect<DownloadSnapshot, DownloadError, never>
  readonly cancel: (
    input: DownloadHandleInput
  ) => Effect.Effect<DownloadSnapshot, DownloadError, never>
  readonly list: (
    input: DownloadListInput
  ) => Effect.Effect<DownloadListResult, DownloadError, never>
  readonly isSupported: () => Effect.Effect<DownloadSupportedResult, DownloadError, never>
  readonly events: (download?: DownloadHandle) => Stream.Stream<DownloadEvent, DownloadError, never>
}

export class DownloadClient extends Context.Service<DownloadClient, DownloadClientApi>()(
  "@effect-desktop/native/DownloadClient"
) {}

export interface DownloadServiceApi {
  readonly start: (
    profile: SessionProfileHandle,
    url: string,
    options?: {
      readonly destination?: string
      readonly ownerScope?: string
      readonly traceId?: string
    }
  ) => Effect.Effect<DownloadSnapshot, DownloadError, never>
  readonly pause: (
    download: DownloadHandle,
    options?: { readonly traceId?: string }
  ) => Effect.Effect<DownloadSnapshot, DownloadError, never>
  readonly resume: (
    download: DownloadHandle,
    options?: { readonly traceId?: string }
  ) => Effect.Effect<DownloadSnapshot, DownloadError, never>
  readonly cancel: (
    download: DownloadHandle,
    options?: { readonly traceId?: string }
  ) => Effect.Effect<DownloadSnapshot, DownloadError, never>
  readonly list: (options?: {
    readonly profile?: SessionProfileHandle
    readonly traceId?: string
  }) => Effect.Effect<DownloadListResult, DownloadError, never>
  readonly isSupported: () => Effect.Effect<DownloadSupportedResult, DownloadError, never>
  readonly events: (download?: DownloadHandle) => Stream.Stream<DownloadEvent, DownloadError, never>
}

export interface DownloadServiceOptions {
  readonly permissions: PermissionRegistryApi
  readonly resources: ResourceRegistryApi
}

export class Download extends Context.Service<Download, DownloadServiceApi>()(
  "@effect-desktop/native/Download"
) {
  static readonly layer = Layer.effect(Download)(
    Effect.gen(function* () {
      const client = yield* DownloadClient
      const permissions = yield* PermissionRegistry
      const resources = yield* ResourceRegistry
      return makeDownloadService(client, { permissions, resources })
    })
  )
}

export const DownloadLive = Download.layer

export const makeDownloadClientLayer = (client: DownloadClientApi): Layer.Layer<DownloadClient> =>
  Layer.succeed(DownloadClient)(client)

export const makeDownloadServiceLayer = (
  client: DownloadClientApi,
  options: DownloadServiceOptions
): Layer.Layer<Download> => Layer.succeed(Download)(makeDownloadService(client, options))

export const makeDownloadBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<DownloadClient> => DownloadSurface.bridgeClientLayer(exchange, options)

export type DownloadRpc = RpcGroup.Rpcs<typeof DownloadRpcGroup>
export type DownloadRpcHandlers = RpcGroup.HandlersFrom<DownloadRpc>

export const DownloadHandlersLive = DownloadRpcGroup.toLayer({
  "Download.start": (input) =>
    Effect.gen(function* () {
      const download = yield* Download
      return yield* download.start(input.profile, input.url, {
        ...(input.destination === undefined ? {} : { destination: input.destination }),
        ...(input.ownerScope === undefined ? {} : { ownerScope: input.ownerScope }),
        ...(input.traceId === undefined ? {} : { traceId: input.traceId })
      })
    }),
  "Download.pause": (input) =>
    Effect.gen(function* () {
      const download = yield* Download
      return yield* download.pause(
        input.download,
        input.traceId === undefined ? {} : { traceId: input.traceId }
      )
    }),
  "Download.resume": (input) =>
    Effect.gen(function* () {
      const download = yield* Download
      return yield* download.resume(
        input.download,
        input.traceId === undefined ? {} : { traceId: input.traceId }
      )
    }),
  "Download.cancel": (input) =>
    Effect.gen(function* () {
      const download = yield* Download
      return yield* download.cancel(
        input.download,
        input.traceId === undefined ? {} : { traceId: input.traceId }
      )
    }),
  "Download.list": (input) =>
    Effect.gen(function* () {
      const download = yield* Download
      return yield* download.list({
        ...(input.profile === undefined ? {} : { profile: input.profile }),
        ...(input.traceId === undefined ? {} : { traceId: input.traceId })
      })
    }),
  "Download.isSupported": () =>
    Effect.gen(function* () {
      const download = yield* Download
      return yield* download.isSupported()
    })
})

export const DownloadSurface = NativeSurface.make(Surface, DownloadRpcGroup, {
  service: DownloadClient,
  capabilities: DownloadCapabilityMethods,
  handlers: DownloadHandlersLive,
  client: (client) => downloadClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => downloadClientFromRpcClient(client, exchange)
})

export const makeHostDownloadRpcRuntime = (
  handlers: DownloadRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry | ResourceRegistry> =>
  DownloadSurface.hostRuntime(handlers, runtimeOptions)

export interface DownloadMemoryClientOptions {
  readonly failure?: Partial<
    Record<"start" | "pause" | "resume" | "cancel" | "list", DownloadError>
  >
}

export const makeDownloadMemoryClient = (
  options: DownloadMemoryClientOptions = {}
): Effect.Effect<DownloadClientApi, never, never> =>
  Effect.gen(function* () {
    const clock = yield* Clock.Clock
    const pubsub = yield* PubSub.bounded<DownloadEvent>({ capacity: 256, replay: 128 })
    const downloads = yield* Ref.make<ReadonlyMap<string, DownloadSnapshot>>(new Map())
    const nextId = yield* Ref.make(0)

    return Object.freeze({
      start: (input) =>
        validateStartInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.start,
              Effect.gen(function* () {
                const downloadId = yield* nextDownloadId(nextId)
                const snapshot = new DownloadSnapshot({
                  download: downloadHandle(
                    downloadId,
                    valid.ownerScope ?? valid.profile.ownerScope
                  ),
                  profile: valid.profile,
                  url: valid.url,
                  ...(valid.destination === undefined ? {} : { destination: valid.destination }),
                  state: "running",
                  receivedBytes: 0,
                  totalBytes: 1024
                })
                yield* Ref.update(downloads, (current) =>
                  new Map(current).set(snapshot.download.id, snapshot)
                )
                yield* publishEvent(pubsub, clock, snapshot, "started")
                return snapshot
              })
            )
          )
        ),
      pause: (input) =>
        validateHandleInput(input, "Download.pause").pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.pause,
              transition(downloads, pubsub, clock, valid.download, "pause")
            )
          )
        ),
      resume: (input) =>
        validateHandleInput(input, "Download.resume").pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.resume,
              transition(downloads, pubsub, clock, valid.download, "resume")
            )
          )
        ),
      cancel: (input) =>
        validateHandleInput(input, "Download.cancel").pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.cancel,
              transition(downloads, pubsub, clock, valid.download, "cancel")
            )
          )
        ),
      list: (input) =>
        validateListInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.list,
              Ref.get(downloads).pipe(
                Effect.map(
                  (current) =>
                    new DownloadListResult({
                      downloads: Array.from(current.values()).filter(
                        (snapshot) =>
                          valid.profile === undefined || snapshot.profile.id === valid.profile.id
                      )
                    })
                )
              )
            )
          )
        ),
      isSupported: () => Effect.succeed(new DownloadSupportedResult({ supported: true })),
      events: (download) =>
        Stream.fromPubSub(pubsub).pipe(
          Stream.filter((event) => download === undefined || event.download.id === download.id)
        )
    } satisfies DownloadClientApi)
  })

export const makeDownloadUnsupportedClient = (): DownloadClientApi =>
  Object.freeze({
    start: (input) =>
      validateStartInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("Download.start")))
      ),
    pause: (input) =>
      validateHandleInput(input, "Download.pause").pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("Download.pause")))
      ),
    resume: (input) =>
      validateHandleInput(input, "Download.resume").pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("Download.resume")))
      ),
    cancel: (input) =>
      validateHandleInput(input, "Download.cancel").pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("Download.cancel")))
      ),
    list: (input) =>
      validateListInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("Download.list")))
      ),
    isSupported: () =>
      Effect.succeed(new DownloadSupportedResult({ supported: false, reason: UnsupportedReason })),
    events: () => Stream.fail(unsupportedError(EventMethod))
  } satisfies DownloadClientApi)

const makeDownloadService = (
  client: DownloadClientApi,
  options: DownloadServiceOptions
): DownloadServiceApi => {
  const explicitlyCanceledDownloads = new Set<string>()
  const service: DownloadServiceApi = {
    start: (profile, url, requestOptions) =>
      Effect.gen(function* () {
        const request = yield* validateStartInput({
          profile,
          url,
          ...(requestOptions?.destination === undefined
            ? {}
            : { destination: requestOptions.destination }),
          ...(requestOptions?.ownerScope === undefined
            ? {}
            : { ownerScope: requestOptions.ownerScope }),
          ...(requestOptions?.traceId === undefined ? {} : { traceId: requestOptions.traceId })
        })
        yield* authorize(options.permissions, "start", request.profile.id, request.traceId)
        const snapshot = yield* client.start(request)
        const registered = yield* options.resources
          .register({
            kind: "download",
            id: makeResourceId(snapshot.download.id),
            ownerScope: request.ownerScope ?? request.profile.ownerScope,
            state: "open",
            dispose: Effect.suspend(() =>
              explicitlyCanceledDownloads.has(snapshot.download.id)
                ? Effect.void
                : client
                    .cancel(new DownloadHandleInput({ download: snapshot.download }))
                    .pipe(Effect.ignore)
            )
          })
          .pipe(
            Effect.mapError((error) =>
              makeHostProtocolInternalError(
                `failed to register download resource: ${error.message}`,
                "Download.start"
              )
            )
          )
        return withDownloadHandle(snapshot, {
          kind: "download",
          id: registered.id,
          generation: registered.generation,
          ownerScope: registered.ownerScope,
          state: "open"
        })
      }),
    pause: (download, requestOptions) =>
      handleOperation(
        client.pause,
        options.permissions,
        "pause",
        download,
        requestOptions?.traceId
      ),
    resume: (download, requestOptions) =>
      handleOperation(
        client.resume,
        options.permissions,
        "resume",
        download,
        requestOptions?.traceId
      ),
    cancel: (download, requestOptions) =>
      validateHandleInput(
        {
          download,
          ...(requestOptions?.traceId === undefined ? {} : { traceId: requestOptions.traceId })
        },
        "Download.cancel"
      ).pipe(
        Effect.flatMap((valid) =>
          authorize(options.permissions, "cancel", valid.download.id, valid.traceId).pipe(
            Effect.andThen(client.cancel(valid)),
            Effect.tap(() => Effect.sync(() => explicitlyCanceledDownloads.add(valid.download.id))),
            Effect.tap(() => options.resources.dispose(makeResourceId(valid.download.id))),
            Effect.ensuring(
              Effect.sync(() => explicitlyCanceledDownloads.delete(valid.download.id))
            )
          )
        )
      ),
    list: (requestOptions) =>
      validateListInput({
        ...(requestOptions?.profile === undefined ? {} : { profile: requestOptions.profile }),
        ...(requestOptions?.traceId === undefined ? {} : { traceId: requestOptions.traceId })
      }).pipe(
        Effect.flatMap((valid) =>
          authorize(
            options.permissions,
            "list",
            valid.profile?.id ?? "download",
            valid.traceId
          ).pipe(Effect.andThen(client.list(valid)))
        )
      ),
    isSupported: () => client.isSupported(),
    events: (download) => client.events(download)
  }

  return Object.freeze(service)
}

const downloadClientFromRpcClient = (
  client: DesktopRpcClient<DownloadRpc>,
  exchange: BridgeClientExchange | undefined
): DownloadClientApi =>
  Object.freeze({
    start: (input) =>
      validateStartInput(input).pipe(
        Effect.flatMap((valid) => runDownloadRpc(client["Download.start"](valid), "Download.start"))
      ),
    pause: (input) =>
      validateHandleInput(input, "Download.pause").pipe(
        Effect.flatMap((valid) => runDownloadRpc(client["Download.pause"](valid), "Download.pause"))
      ),
    resume: (input) =>
      validateHandleInput(input, "Download.resume").pipe(
        Effect.flatMap((valid) =>
          runDownloadRpc(client["Download.resume"](valid), "Download.resume")
        )
      ),
    cancel: (input) =>
      validateHandleInput(input, "Download.cancel").pipe(
        Effect.flatMap((valid) =>
          runDownloadRpc(client["Download.cancel"](valid), "Download.cancel")
        )
      ),
    list: (input) =>
      validateListInput(input).pipe(
        Effect.flatMap((valid) => runDownloadRpc(client["Download.list"](valid), "Download.list"))
      ),
    isSupported: () =>
      runDownloadRpc(client["Download.isSupported"](undefined), "Download.isSupported"),
    events: (download) =>
      subscribeNativeEvent(exchange, EventMethod, DownloadEvent).pipe(
        Stream.filter((event) => download === undefined || event.download.id === download.id)
      )
  } satisfies DownloadClientApi)

const validateStartInput = (input: unknown) =>
  decodeNativeInput(DownloadStartInput, input, "Download.start")
const validateHandleInput = (input: unknown, operation: string) =>
  decodeNativeInput(DownloadHandleInput, input, operation)
const validateListInput = (input: unknown) =>
  decodeNativeInput(DownloadListInput, input, "Download.list")

const runDownloadRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, DownloadError, never> => runNativeRpc(effect, operation, Surface)

const handleOperation = (
  operation: (input: DownloadHandleInput) => Effect.Effect<DownloadSnapshot, DownloadError, never>,
  permissions: PermissionRegistryApi,
  method: "pause" | "resume",
  download: DownloadHandle,
  traceId: string | undefined
): Effect.Effect<DownloadSnapshot, DownloadError, never> =>
  validateHandleInput(
    {
      download,
      ...(traceId === undefined ? {} : { traceId })
    },
    `Download.${method}`
  ).pipe(
    Effect.flatMap((valid) =>
      authorize(permissions, method, valid.download.id, valid.traceId).pipe(
        Effect.andThen(operation(valid))
      )
    )
  )

const authorize = (
  permissions: PermissionRegistryApi,
  method: "start" | "pause" | "resume" | "cancel" | "list",
  resource: string,
  traceId: string | undefined
): Effect.Effect<void, DownloadError, never> =>
  permissions
    .check(
      capability(method),
      new PermissionContext({
        actor: new PermissionActor({ kind: "app", id: "app" }),
        resource,
        traceId: traceId ?? `Download.${method}`
      })
    )
    .pipe(
      Effect.asVoid,
      Effect.catch((error: PermissionRegistryError) =>
        error instanceof PermissionDeniedError
          ? Effect.fail(permissionDeniedError(capability(method), error, `Download.${method}`))
          : Effect.fail(
              makeHostProtocolInternalError(
                `download permission registry failure: ${error._tag}`,
                `Download.${method}`
              )
            )
      )
    )

const transition = (
  downloads: Ref.Ref<ReadonlyMap<string, DownloadSnapshot>>,
  pubsub: PubSub.PubSub<DownloadEvent>,
  clock: Clock.Clock,
  download: DownloadHandle,
  action: "pause" | "resume" | "cancel"
): Effect.Effect<DownloadSnapshot, DownloadError, never> =>
  Effect.gen(function* () {
    const next = yield* Ref.modify(downloads, (current) => {
      const snapshot = current.get(download.id)
      if (snapshot === undefined) {
        return [undefined, current] as const
      }
      const transitioned = transitionSnapshot(snapshot, action)
      return [transitioned, new Map(current).set(download.id, transitioned)] as const
    })
    if (next === undefined) {
      return yield* Effect.fail(
        makeHostProtocolInvalidStateError("missing-download", action, `Download.${action}`)
      )
    }
    yield* publishEvent(pubsub, clock, next, eventPhase(action))
    return next
  })

const transitionSnapshot = (
  snapshot: DownloadSnapshot,
  action: "pause" | "resume" | "cancel"
): DownloadSnapshot =>
  new DownloadSnapshot({
    download: snapshot.download,
    profile: snapshot.profile,
    url: snapshot.url,
    ...(snapshot.destination === undefined ? {} : { destination: snapshot.destination }),
    state: action === "pause" ? "paused" : action === "resume" ? "running" : "canceled",
    receivedBytes: action === "cancel" ? snapshot.receivedBytes : snapshot.receivedBytes,
    ...(snapshot.totalBytes === undefined ? {} : { totalBytes: snapshot.totalBytes }),
    ...(snapshot.message === undefined ? {} : { message: snapshot.message })
  })

const publishEvent = (
  pubsub: PubSub.PubSub<DownloadEvent>,
  clock: Clock.Clock,
  snapshot: DownloadSnapshot,
  phase: "started" | "paused" | "resumed" | "canceled"
): Effect.Effect<void, never, never> =>
  PubSub.publish(
    pubsub,
    new DownloadEvent({
      type: "download-event",
      timestamp: clock.currentTimeMillisUnsafe(),
      phase,
      download: snapshot.download,
      profile: snapshot.profile,
      url: snapshot.url,
      ...(snapshot.destination === undefined ? {} : { destination: snapshot.destination }),
      receivedBytes: snapshot.receivedBytes,
      ...(snapshot.totalBytes === undefined ? {} : { totalBytes: snapshot.totalBytes }),
      ...(snapshot.message === undefined ? {} : { message: snapshot.message })
    })
  ).pipe(Effect.asVoid)

const eventPhase = (action: "pause" | "resume" | "cancel") =>
  action === "pause" ? "paused" : action === "resume" ? "resumed" : "canceled"

const withDownloadHandle = (snapshot: DownloadSnapshot, download: DownloadHandle) =>
  new DownloadSnapshot({
    download,
    profile: snapshot.profile,
    url: snapshot.url,
    ...(snapshot.destination === undefined ? {} : { destination: snapshot.destination }),
    state: snapshot.state,
    receivedBytes: snapshot.receivedBytes,
    ...(snapshot.totalBytes === undefined ? {} : { totalBytes: snapshot.totalBytes }),
    ...(snapshot.message === undefined ? {} : { message: snapshot.message })
  })

const nextDownloadId = (ref: Ref.Ref<number>): Effect.Effect<string, never, never> =>
  Ref.modify(ref, (current) => [`download:${current + 1}`, current + 1])

const downloadHandle = (id: string, ownerScope: string): DownloadHandle => ({
  kind: "download",
  id: makeResourceId(id),
  generation: 0,
  ownerScope,
  state: "open"
})

const capability = (method: "start" | "pause" | "resume" | "cancel" | "list") =>
  P.nativeInvoke({ primitive: Surface, methods: [method] })

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
  failure: DownloadError | undefined,
  effect: Effect.Effect<A, DownloadError, never>
): Effect.Effect<A, DownloadError, never> => (failure === undefined ? effect : Effect.fail(failure))
