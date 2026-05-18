import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  HostProtocolPermissionDeniedError,
  HostProtocolUnsupportedError,
  makeHostProtocolInternalError,
  type HostProtocolError,
  type RpcCapabilityMetadata,
  RpcGroup
} from "@effect-desktop/bridge"
import {
  type AuditEventsApi,
  type DesktopRpcClient,
  emitAuditEvent,
  type NormalizedCapability,
  P,
  PermissionActor,
  PermissionContext,
  PermissionDeniedError,
  PermissionRegistry,
  type PermissionRegistryApi,
  type PermissionRegistryError,
  type ResourceRegistryApi,
  makeResourceId,
  permissionAuditEvent
} from "@effect-desktop/core"
import { Clock, Context, Effect, Layer, PubSub, Ref, Schema, Stream } from "effect"

import {
  SelectionContextActor,
  type SelectionContextAccess,
  SelectionContextDocumentMetadata,
  SelectionContextEvent,
  SelectionContextReadDocumentInput,
  SelectionContextReadDocumentRequest,
  SelectionContextReadDocumentResult,
  SelectionContextReadSelectionInput,
  SelectionContextReadSelectionRequest,
  SelectionContextReadSelectionResult,
  SelectionContextSelectionMetadata,
  SelectionContextStopWatchingInput,
  SelectionContextStopWatchingRequest,
  SelectionContextStopWatchingResult,
  SelectionContextSupportedResult,
  SelectionContextWatchFocusInput,
  SelectionContextWatchFocusRequest,
  SelectionContextWatchFocusResult
} from "./contracts/selection-context.js"
import { subscribeNativeEvent } from "./event-stream.js"
import { decodeNativeInput, runNativeRpc } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"

export * from "./contracts/selection-context.js"

const Surface = "SelectionContext"
const UnsupportedReason = "host-adapter-unimplemented"
const SelectionContextEventMethod = "SelectionContext.Event"
const UnsupportedSupport = NativeSurface.support.unsupported(UnsupportedReason, {
  platforms: [
    { platform: "macos", status: "unsupported", reason: UnsupportedReason },
    { platform: "windows", status: "unsupported", reason: UnsupportedReason },
    { platform: "linux", status: "unsupported", reason: UnsupportedReason }
  ]
})

export type SelectionContextError = HostProtocolError

export const SelectionContextReadSelection = selectionContextRpc(
  "readSelection",
  SelectionContextReadSelectionInput,
  SelectionContextReadSelectionResult,
  P.nativeInvoke({ primitive: Surface, methods: ["readSelection"] })
)
export const SelectionContextReadDocument = selectionContextRpc(
  "readDocumentContext",
  SelectionContextReadDocumentInput,
  SelectionContextReadDocumentResult,
  P.nativeInvoke({ primitive: Surface, methods: ["readDocumentContext"] })
)
export const SelectionContextWatchFocus = selectionContextRpc(
  "watchFocus",
  SelectionContextWatchFocusInput,
  SelectionContextWatchFocusResult,
  P.nativeInvoke({ primitive: Surface, methods: ["watchFocus"] })
)
export const SelectionContextStopWatching = selectionContextRpc(
  "stopWatching",
  SelectionContextStopWatchingInput,
  SelectionContextStopWatchingResult,
  P.nativeInvoke({ primitive: Surface, methods: ["stopWatching"] })
)
export const SelectionContextIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: SelectionContextSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

export const SelectionContextRpcEvents = Object.freeze({
  Event: { payload: SelectionContextEvent }
})

const SelectionContextRpcGroup = RpcGroup.make(
  SelectionContextReadSelection,
  SelectionContextReadDocument,
  SelectionContextWatchFocus,
  SelectionContextStopWatching,
  SelectionContextIsSupported
)

export const SelectionContextRpcs: RpcGroup.RpcGroup<SelectionContextRpc> = SelectionContextRpcGroup

export const SelectionContextMethodNames = Object.freeze([
  "readSelection",
  "readDocumentContext",
  "watchFocus",
  "stopWatching",
  "isSupported"
] as const)

const SelectionContextCapabilityMethods = Object.freeze([
  "readSelection",
  "readDocumentContext",
  "watchFocus",
  "stopWatching"
] as const satisfies readonly (typeof SelectionContextMethodNames)[number][])

export interface SelectionContextClientApi {
  readonly readSelection: (
    input: SelectionContextReadSelectionInput
  ) => Effect.Effect<SelectionContextReadSelectionResult, SelectionContextError, never>
  readonly readDocumentContext: (
    input: SelectionContextReadDocumentInput
  ) => Effect.Effect<SelectionContextReadDocumentResult, SelectionContextError, never>
  readonly watchFocus: (
    input: SelectionContextWatchFocusInput
  ) => Effect.Effect<SelectionContextWatchFocusResult, SelectionContextError, never>
  readonly stopWatching: (
    input: SelectionContextStopWatchingInput
  ) => Effect.Effect<SelectionContextStopWatchingResult, SelectionContextError, never>
  readonly isSupported: () => Effect.Effect<
    SelectionContextSupportedResult,
    SelectionContextError,
    never
  >
  readonly events: () => Stream.Stream<SelectionContextEvent, SelectionContextError, never>
}

export class SelectionContextClient extends Context.Service<
  SelectionContextClient,
  SelectionContextClientApi
>()("@effect-desktop/native/SelectionContextClient") {}

export interface SelectionContextServiceApi {
  readonly readSelection: (
    input: SelectionContextReadSelectionRequest
  ) => Effect.Effect<SelectionContextReadSelectionResult, SelectionContextError, never>
  readonly readDocumentContext: (
    input: SelectionContextReadDocumentRequest
  ) => Effect.Effect<SelectionContextReadDocumentResult, SelectionContextError, never>
  readonly watchFocus: (
    input: SelectionContextWatchFocusRequest
  ) => Effect.Effect<SelectionContextWatchFocusResult, SelectionContextError, never>
  readonly stopWatching: (
    input: SelectionContextStopWatchingRequest
  ) => Effect.Effect<SelectionContextStopWatchingResult, SelectionContextError, never>
  readonly isSupported: () => Effect.Effect<
    SelectionContextSupportedResult,
    SelectionContextError,
    never
  >
  readonly events: () => Stream.Stream<SelectionContextEvent, SelectionContextError, never>
}

export interface SelectionContextServiceOptions {
  readonly permissions: PermissionRegistryApi
  readonly audit?: AuditEventsApi
  readonly resources?: ResourceRegistryApi
  readonly nextWatchId?: () => string
  readonly nextTraceId?: () => string
}

export class SelectionContext extends Context.Service<
  SelectionContext,
  SelectionContextServiceApi
>()("@effect-desktop/native/SelectionContext") {
  static readonly layer = Layer.effect(SelectionContext)(
    Effect.gen(function* () {
      const client = yield* SelectionContextClient
      const permissions = yield* PermissionRegistry
      return yield* makeSelectionContextService(client, { permissions })
    })
  )
}

export const SelectionContextLive = SelectionContext.layer

export const makeSelectionContextClientLayer = (
  client: SelectionContextClientApi
): Layer.Layer<SelectionContextClient> => Layer.succeed(SelectionContextClient)(client)

export const makeSelectionContextServiceLayer = (
  client: SelectionContextClientApi,
  options: SelectionContextServiceOptions
): Layer.Layer<SelectionContext> =>
  Layer.effect(SelectionContext)(makeSelectionContextService(client, options))

export const makeSelectionContextBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<SelectionContextClient> =>
  SelectionContextSurface.bridgeClientLayer(exchange, options)

export type SelectionContextRpc = RpcGroup.Rpcs<typeof SelectionContextRpcGroup>
export type SelectionContextRpcHandlers = RpcGroup.HandlersFrom<SelectionContextRpc>

export const SelectionContextHandlersLive = SelectionContextRpcGroup.toLayer({
  "SelectionContext.readSelection": (input) =>
    Effect.gen(function* () {
      const service = yield* SelectionContext
      return yield* service.readSelection(input)
    }),
  "SelectionContext.readDocumentContext": (input) =>
    Effect.gen(function* () {
      const service = yield* SelectionContext
      return yield* service.readDocumentContext(input)
    }),
  "SelectionContext.watchFocus": (input) =>
    Effect.gen(function* () {
      const service = yield* SelectionContext
      return yield* service.watchFocus(input)
    }),
  "SelectionContext.stopWatching": (input) =>
    Effect.gen(function* () {
      const service = yield* SelectionContext
      return yield* service.stopWatching(input)
    }),
  "SelectionContext.isSupported": () =>
    Effect.gen(function* () {
      const service = yield* SelectionContext
      return yield* service.isSupported()
    })
})

export const SelectionContextSurface = NativeSurface.make(Surface, SelectionContextRpcGroup, {
  service: SelectionContextClient,
  capabilities: SelectionContextCapabilityMethods,
  handlers: SelectionContextHandlersLive,
  client: (client) => selectionContextClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => selectionContextClientFromRpcClient(client, exchange)
})

export const makeHostSelectionContextRpcRuntime = (
  handlers: SelectionContextRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> =>
  SelectionContextSurface.hostRuntime(handlers, runtimeOptions)

export interface SelectionContextMemoryClientOptions {
  readonly failure?: Partial<
    Record<
      "readSelection" | "readDocumentContext" | "watchFocus" | "stopWatching",
      SelectionContextError
    >
  >
  readonly selectionText?: string
  readonly documentText?: string
  readonly nextWatchId?: () => string
}

export const makeSelectionContextMemoryClient = (
  options: SelectionContextMemoryClientOptions = {}
): Effect.Effect<SelectionContextClientApi, never, never> =>
  Effect.gen(function* () {
    const pubsub = yield* PubSub.bounded<SelectionContextEvent>({ capacity: 256, replay: 64 })
    const nextWatchId = yield* makeIdGenerator(options.nextWatchId, "selection-watch")
    const activeWatches = yield* Ref.make<ReadonlySet<string>>(new Set())

    return Object.freeze({
      readSelection: (input) =>
        validateReadSelectionInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.readSelection,
              Effect.succeed(
                selectionResult(valid.access, options.selectionText ?? "selected text")
              )
            )
          )
        ),
      readDocumentContext: (input) =>
        validateReadDocumentInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.readDocumentContext,
              Effect.succeed(documentResult(valid.access, options.documentText ?? "document text"))
            )
          )
        ),
      watchFocus: (input) =>
        validateWatchFocusInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.watchFocus,
              Effect.gen(function* () {
                const watchId = valid.watchId ?? (yield* nextWatchId())
                yield* Ref.update(activeWatches, (current) => new Set(current).add(watchId))
                yield* publishEvent(pubsub, "watch-started", watchId)
                return new SelectionContextWatchFocusResult({
                  watchId,
                  active: true,
                  access: valid.access
                })
              })
            )
          )
        ),
      stopWatching: (input) =>
        validateStopWatchingInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.stopWatching,
              Effect.gen(function* () {
                const stopped = yield* Ref.modify(activeWatches, (current) => {
                  const next = new Set(current)
                  const deleted = next.delete(valid.watchId)
                  return [deleted, next] as const
                })
                if (stopped) {
                  yield* publishEvent(pubsub, "watch-stopped", valid.watchId)
                }
                return new SelectionContextStopWatchingResult({ watchId: valid.watchId, stopped })
              })
            )
          )
        ),
      isSupported: () => Effect.succeed(new SelectionContextSupportedResult({ supported: true })),
      events: () => Stream.fromPubSub(pubsub)
    } satisfies SelectionContextClientApi)
  })

export const makeSelectionContextUnsupportedClient = (): SelectionContextClientApi =>
  Object.freeze({
    readSelection: (input) =>
      validateReadSelectionInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("SelectionContext.readSelection")))
      ),
    readDocumentContext: (input) =>
      validateReadDocumentInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("SelectionContext.readDocumentContext")))
      ),
    watchFocus: (input) =>
      validateWatchFocusInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("SelectionContext.watchFocus")))
      ),
    stopWatching: (input) =>
      validateStopWatchingInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("SelectionContext.stopWatching")))
      ),
    isSupported: () =>
      Effect.succeed(
        new SelectionContextSupportedResult({ supported: false, reason: UnsupportedReason })
      ),
    events: () => Stream.fail(unsupportedError("SelectionContext.events"))
  } satisfies SelectionContextClientApi)

const makeSelectionContextService = (
  client: SelectionContextClientApi,
  options: SelectionContextServiceOptions
): Effect.Effect<SelectionContextServiceApi, never, never> =>
  Effect.gen(function* () {
    const nextWatchId = yield* makeIdGenerator(options.nextWatchId, "selection-watch")

    return Object.freeze({
      readSelection: (input) =>
        Effect.gen(function* () {
          const request = yield* validateReadSelectionRequest(input)
          yield* authorize(options, request.actor, "readSelection", request.access, request.traceId)
          const result = yield* auditFailure(
            options,
            capability("readSelection"),
            request.actor,
            request.access,
            "SelectionContext.readSelection",
            request.traceId ?? "SelectionContext.readSelection",
            client.readSelection(
              new SelectionContextReadSelectionInput({
                actor: request.actor,
                access: request.access,
                ...(request.traceId === undefined ? {} : { traceId: request.traceId })
              })
            )
          )
          yield* emitSelectionAudit(
            options,
            "permission-used",
            capability("readSelection"),
            request.actor,
            request.access,
            "SelectionContext.readSelection",
            request.traceId ?? "SelectionContext.readSelection"
          )
          return result
        }),
      readDocumentContext: (input) =>
        Effect.gen(function* () {
          const request = yield* validateReadDocumentRequest(input)
          yield* authorize(
            options,
            request.actor,
            "readDocumentContext",
            request.access,
            request.traceId
          )
          const result = yield* auditFailure(
            options,
            capability("readDocumentContext"),
            request.actor,
            request.access,
            "SelectionContext.readDocumentContext",
            request.traceId ?? "SelectionContext.readDocumentContext",
            client.readDocumentContext(
              new SelectionContextReadDocumentInput({
                actor: request.actor,
                access: request.access,
                ...(request.traceId === undefined ? {} : { traceId: request.traceId })
              })
            )
          )
          yield* emitSelectionAudit(
            options,
            "permission-used",
            capability("readDocumentContext"),
            request.actor,
            request.access,
            "SelectionContext.readDocumentContext",
            request.traceId ?? "SelectionContext.readDocumentContext"
          )
          return result
        }),
      watchFocus: (input) =>
        Effect.gen(function* () {
          const request = yield* validateWatchFocusRequest(input)
          const watchId = request.watchId ?? (yield* nextWatchId())
          yield* authorize(options, request.actor, "watchFocus", request.access, request.traceId)
          const result = yield* auditFailure(
            options,
            capability("watchFocus"),
            request.actor,
            request.access,
            "SelectionContext.watchFocus",
            request.traceId ?? watchId,
            client.watchFocus(
              new SelectionContextWatchFocusInput({
                actor: request.actor,
                access: request.access,
                watchId,
                ...(request.ownerScope === undefined ? {} : { ownerScope: request.ownerScope }),
                ...(request.traceId === undefined ? {} : { traceId: request.traceId })
              })
            )
          )
          yield* registerWatchResource(options, client, request, result).pipe(
            Effect.tapError(() =>
              client
                .stopWatching(
                  new SelectionContextStopWatchingInput({
                    actor: request.actor,
                    watchId: result.watchId,
                    ...(request.traceId === undefined ? {} : { traceId: request.traceId })
                  })
                )
                .pipe(Effect.ignore)
            )
          )
          yield* emitSelectionAudit(
            options,
            "permission-used",
            capability("watchFocus"),
            request.actor,
            request.access,
            "SelectionContext.watchFocus",
            request.traceId ?? result.watchId
          )
          return result
        }),
      stopWatching: (input) =>
        Effect.gen(function* () {
          const request = yield* validateStopWatchingRequest(input)
          yield* authorize(options, request.actor, "stopWatching", "metadata", request.traceId)
          const result = yield* auditFailure(
            options,
            capability("stopWatching"),
            request.actor,
            "metadata",
            "SelectionContext.stopWatching",
            request.traceId ?? request.watchId,
            client.stopWatching(
              new SelectionContextStopWatchingInput({
                actor: request.actor,
                watchId: request.watchId,
                ...(request.traceId === undefined ? {} : { traceId: request.traceId })
              })
            )
          )
          yield* disposeWatchResource(options, result.watchId)
          yield* emitSelectionAudit(
            options,
            "permission-used",
            capability("stopWatching"),
            request.actor,
            "metadata",
            "SelectionContext.stopWatching",
            request.traceId ?? result.watchId
          )
          return result
        }),
      isSupported: () => client.isSupported(),
      events: () => client.events()
    } satisfies SelectionContextServiceApi)
  })

const selectionContextClientFromRpcClient = (
  client: DesktopRpcClient<SelectionContextRpc>,
  exchange: BridgeClientExchange | undefined
): SelectionContextClientApi =>
  Object.freeze({
    readSelection: (input) =>
      validateReadSelectionInput(input).pipe(
        Effect.flatMap((valid) =>
          runSelectionContextRpc(
            client["SelectionContext.readSelection"](valid),
            "SelectionContext.readSelection"
          )
        )
      ),
    readDocumentContext: (input) =>
      validateReadDocumentInput(input).pipe(
        Effect.flatMap((valid) =>
          runSelectionContextRpc(
            client["SelectionContext.readDocumentContext"](valid),
            "SelectionContext.readDocumentContext"
          )
        )
      ),
    watchFocus: (input) =>
      validateWatchFocusInput(input).pipe(
        Effect.flatMap((valid) =>
          runSelectionContextRpc(
            client["SelectionContext.watchFocus"](valid),
            "SelectionContext.watchFocus"
          )
        )
      ),
    stopWatching: (input) =>
      validateStopWatchingInput(input).pipe(
        Effect.flatMap((valid) =>
          runSelectionContextRpc(
            client["SelectionContext.stopWatching"](valid),
            "SelectionContext.stopWatching"
          )
        )
      ),
    isSupported: () =>
      runSelectionContextRpc(
        client["SelectionContext.isSupported"](undefined),
        "SelectionContext.isSupported"
      ),
    events: () => subscribeNativeEvent(exchange, SelectionContextEventMethod, SelectionContextEvent)
  } satisfies SelectionContextClientApi)

function selectionContextRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(method: Method, payload: Payload, success: Success, cap: RpcCapabilityMetadata) {
  return NativeSurface.rpc(Surface, method, {
    payload,
    success,
    authority: NativeSurface.authority.custom(cap),
    endpoint: method === "readSelection" || method === "readDocumentContext" ? "query" : "mutation",
    support: UnsupportedSupport
  })
}

const runSelectionContextRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, SelectionContextError, never> => runNativeRpc(effect, operation, Surface)

const validateReadSelectionRequest = (input: unknown) =>
  decodeNativeInput(SelectionContextReadSelectionRequest, input, "SelectionContext.readSelection")
const validateReadSelectionInput = (input: unknown) =>
  decodeNativeInput(SelectionContextReadSelectionInput, input, "SelectionContext.readSelection")
const validateReadDocumentRequest = (input: unknown) =>
  decodeNativeInput(
    SelectionContextReadDocumentRequest,
    input,
    "SelectionContext.readDocumentContext"
  )
const validateReadDocumentInput = (input: unknown) =>
  decodeNativeInput(
    SelectionContextReadDocumentInput,
    input,
    "SelectionContext.readDocumentContext"
  )
const validateWatchFocusRequest = (input: unknown) =>
  decodeNativeInput(SelectionContextWatchFocusRequest, input, "SelectionContext.watchFocus")
const validateWatchFocusInput = (input: unknown) =>
  decodeNativeInput(SelectionContextWatchFocusInput, input, "SelectionContext.watchFocus")
const validateStopWatchingRequest = (input: unknown) =>
  decodeNativeInput(SelectionContextStopWatchingRequest, input, "SelectionContext.stopWatching")
const validateStopWatchingInput = (input: unknown) =>
  decodeNativeInput(SelectionContextStopWatchingInput, input, "SelectionContext.stopWatching")

const authorize = (
  options: SelectionContextServiceOptions,
  actor: SelectionContextActor,
  method: "readSelection" | "readDocumentContext" | "watchFocus" | "stopWatching",
  access: SelectionContextAccess,
  traceId: string | undefined
): Effect.Effect<void, SelectionContextError, never> =>
  checkPermission(options, capability(method), actor, access, `SelectionContext.${method}`, traceId)

const checkPermission = (
  options: SelectionContextServiceOptions,
  cap: NormalizedCapability,
  actor: SelectionContextActor,
  access: SelectionContextAccess,
  operation: string,
  traceId: string | undefined
): Effect.Effect<void, SelectionContextError, never> =>
  options.permissions
    .check(
      cap,
      new PermissionContext({
        actor: permissionActor(actor),
        resource: access,
        traceId: traceId ?? options.nextTraceId?.() ?? operation
      })
    )
    .pipe(
      Effect.asVoid,
      Effect.catch((error: PermissionRegistryError) => {
        if (!(error instanceof PermissionDeniedError)) {
          return Effect.fail(
            makeHostProtocolInternalError(
              `selection context permission registry failure: ${error._tag}`,
              operation
            )
          )
        }
        return emitSelectionAudit(
          options,
          "permission-denied",
          cap,
          actor,
          access,
          operation,
          error.traceId,
          { reason: error.reason }
        ).pipe(Effect.andThen(Effect.fail(permissionDeniedError(cap, error, operation))))
      })
    )

const auditFailure = <A>(
  options: SelectionContextServiceOptions,
  cap: NormalizedCapability,
  actor: SelectionContextActor,
  access: SelectionContextAccess,
  operation: string,
  traceId: string,
  effect: Effect.Effect<A, SelectionContextError, never>
): Effect.Effect<A, SelectionContextError, never> =>
  effect.pipe(
    Effect.tapError((error) =>
      emitSelectionAudit(options, "permission-used", cap, actor, access, operation, traceId, {
        outcome: "failed",
        reason: error.tag
      })
    )
  )

const capability = (
  method: "readSelection" | "readDocumentContext" | "watchFocus" | "stopWatching"
): NormalizedCapability => P.nativeInvoke({ primitive: Surface, methods: [method] })

const registerWatchResource = (
  options: SelectionContextServiceOptions,
  client: SelectionContextClientApi,
  request: SelectionContextWatchFocusRequest,
  result: SelectionContextWatchFocusResult
): Effect.Effect<void, SelectionContextError, never> => {
  if (options.resources === undefined) {
    return Effect.void
  }
  const traceId = request.traceId ?? result.watchId
  return options.resources
    .register({
      kind: "selection-context-watch",
      id: makeResourceId(`selection-context-${result.watchId}`),
      ownerScope: request.ownerScope ?? `${request.actor.kind}:${request.actor.id}`,
      state: result.active ? "active" : "closed",
      reusableId: true,
      dispose: client
        .stopWatching(
          new SelectionContextStopWatchingInput({
            actor: request.actor,
            watchId: result.watchId,
            traceId
          })
        )
        .pipe(
          Effect.andThen(
            emitSelectionAudit(
              options,
              "permission-used",
              capability("stopWatching"),
              request.actor,
              request.access,
              "SelectionContext.stopWatching",
              traceId,
              { outcome: "released-by-scope", watchId: result.watchId }
            )
          ),
          Effect.ignore
        )
    })
    .pipe(
      Effect.asVoid,
      Effect.mapError((error) =>
        makeHostProtocolInternalError(
          `failed to register selection context watch resource: ${error.message}`,
          "SelectionContext.watchFocus"
        )
      )
    )
}

const disposeWatchResource = (
  options: SelectionContextServiceOptions,
  watchId: string
): Effect.Effect<void, never, never> =>
  options.resources === undefined
    ? Effect.void
    : options.resources.dispose(makeResourceId(`selection-context-${watchId}`))

const selectionResult = (
  access: SelectionContextAccess,
  text: string
): SelectionContextReadSelectionResult =>
  new SelectionContextReadSelectionResult({
    metadata: new SelectionContextSelectionMetadata({
      sourceApplication: "memory-selection",
      mimeType: "text/plain",
      characterCount: text.length,
      selectionHash: `len-${text.length}`
    }),
    ...(access === "content" ? { text } : {})
  })

const documentResult = (
  access: SelectionContextAccess,
  text: string
): SelectionContextReadDocumentResult =>
  new SelectionContextReadDocumentResult({
    metadata: new SelectionContextDocumentMetadata({
      documentId: "memory-document",
      kind: "editor-buffer",
      title: "Memory Document",
      applicationId: "memory",
      bufferId: "buffer-1"
    }),
    ...(access === "content" ? { text } : {})
  })

const publishEvent = (
  pubsub: PubSub.PubSub<SelectionContextEvent>,
  phase: "watch-started" | "watch-stopped" | "focus-changed" | "selection-changed" | "failed",
  watchId?: string
): Effect.Effect<void, never, never> =>
  Clock.currentTimeMillis.pipe(
    Effect.flatMap((timestamp) =>
      PubSub.publish(
        pubsub,
        new SelectionContextEvent({
          type: "selection-context-event",
          timestamp,
          phase,
          ...(watchId === undefined ? {} : { watchId })
        })
      )
    ),
    Effect.asVoid
  )

const emitSelectionAudit = (
  options: SelectionContextServiceOptions,
  kind: "permission-used" | "permission-denied",
  cap: NormalizedCapability,
  actor: SelectionContextActor,
  access: SelectionContextAccess,
  operation: string,
  traceId: string,
  details: Record<string, unknown> = {}
): Effect.Effect<void, SelectionContextError, never> => {
  if (options.audit === undefined) {
    return Effect.void
  }
  return emitAuditEvent(
    options.audit,
    permissionAuditEvent({
      kind,
      source: operation,
      traceId,
      outcome:
        typeof details["outcome"] === "string"
          ? details["outcome"]
          : kind === "permission-denied"
            ? "denied"
            : "used",
      normalizedCapability: cap,
      actor: permissionActor(actor),
      resource: access,
      details: { access, ...details }
    })
  ).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInternalError(
        `failed to write selection context audit event: ${error.message}`,
        operation
      )
    )
  )
}

const permissionActor = (actor: SelectionContextActor): PermissionActor =>
  new PermissionActor({
    kind:
      actor.kind === "app" || actor.kind === "window" || actor.kind === "process"
        ? actor.kind
        : "resource",
    id:
      actor.kind === "app" || actor.kind === "window" || actor.kind === "process"
        ? actor.id
        : `${actor.kind}:${actor.id}`
  })

const permissionDeniedError = (
  cap: NormalizedCapability,
  error: PermissionDeniedError,
  operation: string
): HostProtocolPermissionDeniedError =>
  new HostProtocolPermissionDeniedError({
    tag: "PermissionDenied",
    message: `permission denied for ${cap.kind}`,
    operation,
    capability: cap.kind,
    resource: error.traceId,
    recoverable: false
  })

const unsupportedError = (operation: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: `unsupported SelectionContext method: ${operation}`,
    operation,
    recoverable: false
  })

const failOr = <A>(
  error: SelectionContextError | undefined,
  effect: Effect.Effect<A, SelectionContextError, never>
): Effect.Effect<A, SelectionContextError, never> =>
  error === undefined ? effect : Effect.fail(error)

const makeIdGenerator = (
  next: (() => string) | undefined,
  prefix: string
): Effect.Effect<() => Effect.Effect<string, never, never>, never, never> =>
  Effect.gen(function* () {
    const counter = yield* Ref.make(0)
    return () =>
      next === undefined
        ? Ref.modify(counter, (current) => [`${prefix}-${current + 1}`, current + 1] as const)
        : Effect.sync(next)
  })
