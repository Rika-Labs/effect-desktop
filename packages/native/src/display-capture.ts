import {
  type BridgeClientExchange,
  type BridgeClientOptions,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  type HostProtocolError,
  HostProtocolInternalError,
  type HostProtocolInvalidArgumentError,
  type HostProtocolInvalidOutputError,
  HostProtocolPermissionDeniedError,
  type HostProtocolPermissionRevokedError,
  HostProtocolUnsupportedError,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  type RpcCapabilityMetadata,
  RpcGroup
} from "@orika/bridge"
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
  permissionAuditEvent
} from "@orika/core"
import { Clock, Context, Effect, Layer, PubSub, Ref, Schema, Stream } from "effect"

import {
  DisplayCaptureActor,
  DisplayCaptureDisplayRequest,
  DisplayCaptureEvent,
  DisplayCaptureGrant,
  DisplayCaptureImage,
  DisplayCaptureMetadata,
  DisplayCaptureRequest,
  DisplayCaptureResult,
  DisplayCaptureRegionRequest,
  DisplayCaptureSupportedResult,
  DisplayCaptureWindowRequest,
  type DisplayCaptureSource
} from "./contracts/display-capture.js"
import { isSupportedImageHeader, PNG_HEADER } from "./contracts/image.js"
import { decodeNativeInput, runNativeRpc } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"

export * from "./contracts/display-capture.js"

const Surface = "DisplayCapture"
const UnsupportedReason = "host-adapter-unimplemented"
const MacOsScreencaptureReason = "macos-screencapture-adapter"
const DisplayCaptureEventMethod = "DisplayCapture.Event"
const HostCaptureSupport = NativeSurface.support.partial(MacOsScreencaptureReason, {
  platforms: [
    { platform: "macos", status: "supported" },
    { platform: "windows", status: "unsupported", reason: UnsupportedReason },
    { platform: "linux", status: "unsupported", reason: UnsupportedReason }
  ]
})

export type DisplayCaptureError =
  | HostProtocolPermissionDeniedError
  | HostProtocolPermissionRevokedError
  | HostProtocolUnsupportedError
  | HostProtocolInvalidArgumentError
  | HostProtocolInvalidOutputError
  | HostProtocolInternalError

export const DisplayCaptureCaptureDisplay = displayCaptureRpc(
  "captureDisplay",
  DisplayCaptureDisplayRequest,
  DisplayCaptureResult,
  P.nativeInvoke({ primitive: Surface, methods: ["captureDisplay"] })
)
export const DisplayCaptureCaptureWindow = displayCaptureRpc(
  "captureWindow",
  DisplayCaptureWindowRequest,
  DisplayCaptureResult,
  P.nativeInvoke({ primitive: Surface, methods: ["captureWindow"] })
)
export const DisplayCaptureCaptureRegion = displayCaptureRpc(
  "captureRegion",
  DisplayCaptureRegionRequest,
  DisplayCaptureResult,
  P.nativeInvoke({ primitive: Surface, methods: ["captureRegion"] })
)
export const DisplayCaptureIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: DisplayCaptureSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

export const DisplayCaptureRpcEvents = Object.freeze({
  Event: { payload: DisplayCaptureEvent }
})

const DisplayCaptureRpcGroup = RpcGroup.make(
  DisplayCaptureCaptureDisplay,
  DisplayCaptureCaptureWindow,
  DisplayCaptureCaptureRegion,
  DisplayCaptureIsSupported
)

export const DisplayCaptureRpcs: RpcGroup.RpcGroup<DisplayCaptureRpc> = DisplayCaptureRpcGroup

export const DisplayCaptureMethodNames = Object.freeze([
  "captureDisplay",
  "captureWindow",
  "captureRegion",
  "isSupported"
] as const)

const DisplayCaptureCapabilityMethods = Object.freeze([
  "captureDisplay",
  "captureWindow",
  "captureRegion"
] as const satisfies readonly (typeof DisplayCaptureMethodNames)[number][])

export interface DisplayCaptureClientApi {
  readonly captureDisplay: (
    input: typeof DisplayCaptureDisplayRequest.Type
  ) => Effect.Effect<DisplayCaptureResult, DisplayCaptureError, never>
  readonly captureWindow: (
    input: typeof DisplayCaptureWindowRequest.Type
  ) => Effect.Effect<DisplayCaptureResult, DisplayCaptureError, never>
  readonly captureRegion: (
    input: typeof DisplayCaptureRegionRequest.Type
  ) => Effect.Effect<DisplayCaptureResult, DisplayCaptureError, never>
  readonly isSupported: () => Effect.Effect<
    DisplayCaptureSupportedResult,
    DisplayCaptureError,
    never
  >
  readonly events: () => Stream.Stream<DisplayCaptureEvent, DisplayCaptureError, never>
}

export class DisplayCaptureClient extends Context.Service<
  DisplayCaptureClient,
  DisplayCaptureClientApi
>()("@orika/native/DisplayCaptureClient") {}

export interface DisplayCaptureServiceApi extends DisplayCaptureClientApi {}

export interface DisplayCaptureGrantAuthorityApi {
  readonly verify: (
    grant: DisplayCaptureGrant,
    request: DisplayCaptureRequest
  ) => Effect.Effect<void, DisplayCaptureError, never>
}

export class DisplayCaptureGrantAuthority extends Context.Service<
  DisplayCaptureGrantAuthority,
  DisplayCaptureGrantAuthorityApi
>()("@orika/native/DisplayCaptureGrantAuthority") {}

export interface DisplayCaptureServiceOptions {
  readonly permissions: PermissionRegistryApi
  readonly grants: DisplayCaptureGrantAuthorityApi
  readonly audit?: AuditEventsApi
  readonly nextCaptureId?: () => string
  readonly nextTraceId?: () => string
}

export class DisplayCapture extends Context.Service<DisplayCapture, DisplayCaptureServiceApi>()(
  "@orika/native/DisplayCapture"
) {
  static readonly layer = Layer.effect(DisplayCapture)(
    Effect.gen(function* () {
      const client = yield* DisplayCaptureClient
      const permissions = yield* PermissionRegistry
      const grants = yield* DisplayCaptureGrantAuthority
      return yield* makeDisplayCaptureService(client, { permissions, grants })
    })
  )
}

export const DisplayCaptureLive = DisplayCapture.layer

export const makeDisplayCaptureClientLayer = (
  client: DisplayCaptureClientApi
): Layer.Layer<DisplayCaptureClient> => Layer.succeed(DisplayCaptureClient)(client)

export const makeDisplayCaptureServiceLayer = (
  client: DisplayCaptureClientApi,
  options: DisplayCaptureServiceOptions
): Layer.Layer<DisplayCapture> =>
  Layer.effect(DisplayCapture)(makeDisplayCaptureService(client, options))

export const makeDisplayCaptureGrantAuthority = (
  grants: ReadonlySet<string>
): DisplayCaptureGrantAuthorityApi =>
  DisplayCaptureGrantAuthority.of({
    verify: (grant, _request) =>
      grants.has(`${grant.kind}:${grant.id}`)
        ? Effect.void
        : Effect.fail(
            makeHostProtocolInvalidArgumentError(
              "grant.id",
              "display capture grant is not recognized",
              "DisplayCapture.grant"
            )
          )
  })

export const makeDisplayCaptureGrantAuthorityLayer = (
  grants: ReadonlySet<string>
): Layer.Layer<DisplayCaptureGrantAuthority> =>
  Layer.succeed(DisplayCaptureGrantAuthority, makeDisplayCaptureGrantAuthority(grants))

export const makeDisplayCaptureBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<DisplayCaptureClient> => DisplayCaptureSurface.bridgeClientLayer(exchange, options)

export type DisplayCaptureRpc = RpcGroup.Rpcs<typeof DisplayCaptureRpcGroup>
export type DisplayCaptureRpcHandlers = RpcGroup.HandlersFrom<DisplayCaptureRpc>

export const DisplayCaptureHandlersLive = DisplayCaptureRpcGroup.toLayer({
  "DisplayCapture.captureDisplay": (input) =>
    Effect.gen(function* () {
      const service = yield* DisplayCapture
      return yield* service.captureDisplay(input)
    }),
  "DisplayCapture.captureWindow": (input) =>
    Effect.gen(function* () {
      const service = yield* DisplayCapture
      return yield* service.captureWindow(input)
    }),
  "DisplayCapture.captureRegion": (input) =>
    Effect.gen(function* () {
      const service = yield* DisplayCapture
      return yield* service.captureRegion(input)
    }),
  "DisplayCapture.isSupported": () =>
    Effect.gen(function* () {
      const service = yield* DisplayCapture
      return yield* service.isSupported()
    })
})

export const DisplayCaptureSurface = NativeSurface.make(Surface, DisplayCaptureRpcGroup, {
  service: DisplayCaptureClient,
  capabilities: DisplayCaptureCapabilityMethods,
  handlers: DisplayCaptureHandlersLive,
  client: (client) => displayCaptureClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => displayCaptureClientFromRpcClient(client, exchange)
})

export const makeHostDisplayCaptureRpcRuntime = (
  handlers: DisplayCaptureRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> =>
  DisplayCaptureSurface.hostRuntime(handlers, runtimeOptions)

export interface DisplayCaptureMemoryClientOptions {
  readonly failure?: Partial<
    Record<"captureDisplay" | "captureWindow" | "captureRegion", DisplayCaptureError>
  >
  readonly nextCaptureId?: () => string
}

export const makeDisplayCaptureMemoryClient = (
  options: DisplayCaptureMemoryClientOptions = {}
): Effect.Effect<DisplayCaptureClientApi, never, never> =>
  Effect.gen(function* () {
    const pubsub = yield* PubSub.bounded<DisplayCaptureEvent>({ capacity: 256, replay: 64 })
    const nextCaptureId = yield* makeIdGenerator(options.nextCaptureId, "display-capture")

    const capture = (input: DisplayCaptureRequest, source: DisplayCaptureSource) =>
      validateRequest(input, source).pipe(
        Effect.flatMap((valid) =>
          Effect.gen(function* () {
            const captureId = yield* nextCaptureId()
            const failure = options.failure?.[methodForSource(source)]
            if (failure !== undefined) {
              yield* publishFailureEvent(pubsub, captureId, source, failure.tag)
              return yield* Effect.fail(failure)
            }
            const result = yield* captureResult(valid, captureId, source)
            yield* publishEvent(pubsub, "captured", result.metadata)
            return result
          })
        )
      )

    return Object.freeze({
      captureDisplay: (input) => capture(input, "display"),
      captureWindow: (input) => capture(input, "window"),
      captureRegion: (input) => capture(input, "region"),
      isSupported: () => Effect.succeed(new DisplayCaptureSupportedResult({ supported: true })),
      events: () => Stream.fromPubSub(pubsub)
    } satisfies DisplayCaptureClientApi)
  })

export const makeDisplayCaptureUnsupportedClient = (): DisplayCaptureClientApi =>
  Object.freeze({
    captureDisplay: (input) =>
      validateDisplayRequest(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("DisplayCapture.captureDisplay")))
      ),
    captureWindow: (input) =>
      validateWindowRequest(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("DisplayCapture.captureWindow")))
      ),
    captureRegion: (input) =>
      validateRegionRequest(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("DisplayCapture.captureRegion")))
      ),
    isSupported: () =>
      Effect.succeed(
        new DisplayCaptureSupportedResult({ supported: false, reason: UnsupportedReason })
      ),
    events: () => Stream.fail(unsupportedError(DisplayCaptureEventMethod))
  } satisfies DisplayCaptureClientApi)

const makeDisplayCaptureService = (
  client: DisplayCaptureClientApi,
  options: DisplayCaptureServiceOptions
): Effect.Effect<DisplayCaptureServiceApi, never, never> =>
  Effect.succeed(
    Object.freeze({
      captureDisplay: (input) => captureWithPolicy(client, options, input, "display"),
      captureWindow: (input) => captureWithPolicy(client, options, input, "window"),
      captureRegion: (input) => captureWithPolicy(client, options, input, "region"),
      isSupported: () => client.isSupported(),
      events: () => client.events()
    } satisfies DisplayCaptureServiceApi)
  )

const captureWithPolicy = (
  client: DisplayCaptureClientApi,
  options: DisplayCaptureServiceOptions,
  input: unknown,
  source: DisplayCaptureSource
): Effect.Effect<DisplayCaptureResult, DisplayCaptureError, never> =>
  Effect.gen(function* () {
    const request = yield* validateRequest(input, source)
    const method = methodForSource(source)
    const operation = `DisplayCapture.${method}`
    yield* options.grants.verify(request.grant, request)
    yield* authorize(options, request.actor, method, request.traceId)
    yield* emitAttemptAudit(options, capability(method), request, operation)
    const result = yield* auditFailure(
      options,
      capability(method),
      request.actor,
      operation,
      request.traceId ?? options.nextTraceId?.() ?? operation,
      callClient(client, request).pipe(
        Effect.flatMap((result) => validateImageResult(result, operation))
      )
    )
    yield* emitCaptureAudit(options, capability(method), request, operation, result)
    return result
  })

const displayCaptureClientFromRpcClient = (
  client: DesktopRpcClient<DisplayCaptureRpc>,
  _exchange: BridgeClientExchange | undefined
): DisplayCaptureClientApi =>
  Object.freeze({
    captureDisplay: (input) =>
      validateDisplayRequest(input).pipe(
        Effect.flatMap((valid) =>
          runDisplayCaptureRpc(
            client["DisplayCapture.captureDisplay"](valid),
            "DisplayCapture.captureDisplay"
          ).pipe(
            Effect.flatMap((result) => validateImageResult(result, "DisplayCapture.captureDisplay"))
          )
        )
      ),
    captureWindow: (input) =>
      validateWindowRequest(input).pipe(
        Effect.flatMap((valid) =>
          runDisplayCaptureRpc(
            client["DisplayCapture.captureWindow"](valid),
            "DisplayCapture.captureWindow"
          ).pipe(
            Effect.flatMap((result) => validateImageResult(result, "DisplayCapture.captureWindow"))
          )
        )
      ),
    captureRegion: (input) =>
      validateRegionRequest(input).pipe(
        Effect.flatMap((valid) =>
          runDisplayCaptureRpc(
            client["DisplayCapture.captureRegion"](valid),
            "DisplayCapture.captureRegion"
          ).pipe(
            Effect.flatMap((result) => validateImageResult(result, "DisplayCapture.captureRegion"))
          )
        )
      ),
    isSupported: () =>
      runDisplayCaptureRpc(
        client["DisplayCapture.isSupported"](undefined),
        "DisplayCapture.isSupported"
      ),
    events: () => Stream.fail(unsupportedError(DisplayCaptureEventMethod))
  } satisfies DisplayCaptureClientApi)

function displayCaptureRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(method: Method, payload: Payload, success: Success, cap: RpcCapabilityMetadata) {
  return NativeSurface.rpc(Surface, method, {
    payload,
    success,
    authority: NativeSurface.authority.custom(cap),
    endpoint: "mutation",
    support: HostCaptureSupport
  })
}

const runDisplayCaptureRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, DisplayCaptureError, never> =>
  runNativeRpc(effect, operation, Surface).pipe(Effect.mapError(narrowDisplayCaptureError))

const validateRequest = (
  input: unknown,
  source: DisplayCaptureSource
): Effect.Effect<DisplayCaptureRequest, DisplayCaptureError, never> => {
  switch (source) {
    case "display":
      return validateDisplayRequest(input)
    case "window":
      return validateWindowRequest(input)
    case "region":
      return validateRegionRequest(input)
  }
}

const validateDisplayRequest = (
  input: unknown
): Effect.Effect<typeof DisplayCaptureDisplayRequest.Type, DisplayCaptureError, never> =>
  decodeNativeInput(DisplayCaptureDisplayRequest, input, "DisplayCapture.captureDisplay").pipe(
    Effect.mapError(narrowDisplayCaptureError)
  )

const validateWindowRequest = (
  input: unknown
): Effect.Effect<typeof DisplayCaptureWindowRequest.Type, DisplayCaptureError, never> =>
  decodeNativeInput(DisplayCaptureWindowRequest, input, "DisplayCapture.captureWindow").pipe(
    Effect.mapError(narrowDisplayCaptureError)
  )

const validateRegionRequest = (
  input: unknown
): Effect.Effect<typeof DisplayCaptureRegionRequest.Type, DisplayCaptureError, never> =>
  decodeNativeInput(DisplayCaptureRegionRequest, input, "DisplayCapture.captureRegion").pipe(
    Effect.mapError(narrowDisplayCaptureError)
  )

const authorize = (
  options: DisplayCaptureServiceOptions,
  actor: DisplayCaptureActor,
  method: "captureDisplay" | "captureWindow" | "captureRegion",
  traceId: string | undefined
): Effect.Effect<void, DisplayCaptureError, never> =>
  options.permissions
    .check(
      capability(method),
      new PermissionContext({
        actor: permissionActor(actor),
        resource: "display-capture",
        traceId: traceId ?? options.nextTraceId?.() ?? `DisplayCapture.${method}`
      })
    )
    .pipe(
      Effect.asVoid,
      Effect.catch((error: PermissionRegistryError) => {
        if (!(error instanceof PermissionDeniedError)) {
          return Effect.fail(
            internalError(
              `display capture permission registry failure: ${error._tag}`,
              `DisplayCapture.${method}`
            )
          )
        }
        return emitAudit(
          options,
          "permission-denied",
          capability(method),
          actor,
          `DisplayCapture.${method}`,
          error.traceId,
          { reason: error.reason }
        ).pipe(
          Effect.andThen(
            Effect.fail(
              permissionDeniedError(capability(method), error, `DisplayCapture.${method}`)
            )
          )
        )
      }),
      Effect.mapError(narrowDisplayCaptureError)
    )

const auditFailure = <A>(
  options: DisplayCaptureServiceOptions,
  cap: NormalizedCapability,
  actor: DisplayCaptureActor,
  operation: string,
  traceId: string,
  effect: Effect.Effect<A, DisplayCaptureError, never>
): Effect.Effect<A, DisplayCaptureError, never> =>
  effect.pipe(
    Effect.tapError((error) =>
      emitAudit(options, "permission-used", cap, actor, operation, traceId, {
        outcome: "failed",
        reason: error.tag
      })
    )
  )

const emitAttemptAudit = (
  options: DisplayCaptureServiceOptions,
  cap: NormalizedCapability,
  request: DisplayCaptureRequest,
  operation: string
): Effect.Effect<void, DisplayCaptureError, never> =>
  emitAudit(
    options,
    "permission-used",
    cap,
    request.actor,
    operation,
    request.traceId ?? request.grant.id,
    {
      outcome: "attempted",
      source: request.target.source,
      grantKind: request.grant.kind,
      grantId: request.grant.id
    }
  )

const emitCaptureAudit = (
  options: DisplayCaptureServiceOptions,
  cap: NormalizedCapability,
  request: DisplayCaptureRequest,
  operation: string,
  result: DisplayCaptureResult
): Effect.Effect<void, DisplayCaptureError, never> =>
  emitAudit(
    options,
    "permission-used",
    cap,
    request.actor,
    operation,
    request.traceId ?? result.metadata.captureId,
    {
      outcome: "captured",
      captureId: result.metadata.captureId,
      source: result.metadata.source,
      byteLength: result.metadata.byteLength,
      grantKind: request.grant.kind,
      grantId: request.grant.id
    }
  )

const emitAudit = (
  options: DisplayCaptureServiceOptions,
  kind: "permission-used" | "permission-denied",
  cap: NormalizedCapability,
  actor: DisplayCaptureActor,
  operation: string,
  traceId: string,
  details: Record<string, unknown> = {}
): Effect.Effect<void, DisplayCaptureError, never> => {
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
      resource: "display-capture",
      details: { surface: "display-capture", ...details }
    })
  ).pipe(
    Effect.mapError((error) =>
      narrowDisplayCaptureError(
        makeHostProtocolInternalError(
          `failed to write display capture audit event: ${error.message}`,
          operation
        )
      )
    )
  )
}

const validateImageResult = (
  result: DisplayCaptureResult,
  operation: string
): Effect.Effect<DisplayCaptureResult, DisplayCaptureError, never> => {
  const bytes = Uint8Array.from(result.image.bytes)
  if (bytes.length === 0) {
    return Effect.fail(
      makeHostProtocolInvalidOutputError(operation, "capture bytes must not be empty")
    )
  }
  if (result.metadata.byteLength !== bytes.length) {
    return Effect.fail(
      makeHostProtocolInvalidOutputError(operation, "capture byte length metadata mismatch")
    )
  }
  if (!isSupportedImageHeader(result.image.mime, bytes)) {
    return Effect.fail(
      makeHostProtocolInvalidOutputError(
        operation,
        `declared ${result.image.mime} does not match image header`
      )
    )
  }
  return Effect.succeed(result)
}

const captureResult = (
  request: DisplayCaptureRequest,
  captureId: string,
  source: DisplayCaptureSource
): Effect.Effect<DisplayCaptureResult, never, never> =>
  Clock.currentTimeMillis.pipe(
    Effect.map((observedAt) => {
      const bytes = [...PNG_HEADER, 0, 0, 0, 0]
      return new DisplayCaptureResult({
        image: new DisplayCaptureImage({ mime: "image/png", bytes }),
        metadata: new DisplayCaptureMetadata({
          captureId,
          source,
          ...targetMetadata(request),
          byteLength: bytes.length,
          observedAt
        })
      })
    })
  )

const targetMetadata = (request: DisplayCaptureRequest) => {
  switch (request.target.source) {
    case "display":
      return { displayId: request.target.displayId }
    case "window":
      return { windowId: request.target.windowId }
    case "region":
      return { displayId: request.target.displayId, region: request.target.region }
  }
}

const publishEvent = (
  pubsub: PubSub.PubSub<DisplayCaptureEvent>,
  phase: "captured" | "failed",
  metadata: DisplayCaptureMetadata
): Effect.Effect<void, never, never> =>
  Clock.currentTimeMillis.pipe(
    Effect.flatMap((timestamp) =>
      PubSub.publish(
        pubsub,
        new DisplayCaptureEvent({
          type: "display-capture-event",
          timestamp,
          phase,
          captureId: metadata.captureId,
          source: metadata.source,
          byteLength: metadata.byteLength
        })
      )
    ),
    Effect.asVoid
  )

const publishFailureEvent = (
  pubsub: PubSub.PubSub<DisplayCaptureEvent>,
  captureId: string,
  source: DisplayCaptureSource,
  reason: string
): Effect.Effect<void, never, never> =>
  Clock.currentTimeMillis.pipe(
    Effect.flatMap((timestamp) =>
      PubSub.publish(
        pubsub,
        new DisplayCaptureEvent({
          type: "display-capture-event",
          timestamp,
          phase: "failed",
          captureId,
          source,
          reason
        })
      )
    ),
    Effect.asVoid
  )

const callClient = (
  client: DisplayCaptureClientApi,
  request: DisplayCaptureRequest
): Effect.Effect<DisplayCaptureResult, DisplayCaptureError, never> => {
  switch (request.target.source) {
    case "display":
      return request instanceof DisplayCaptureDisplayRequest
        ? client.captureDisplay(request)
        : Effect.fail(
            makeHostProtocolInvalidArgumentError(
              "target.source",
              "must match capture method",
              "DisplayCapture.captureDisplay"
            )
          )
    case "window":
      return request instanceof DisplayCaptureWindowRequest
        ? client.captureWindow(request)
        : Effect.fail(
            makeHostProtocolInvalidArgumentError(
              "target.source",
              "must match capture method",
              "DisplayCapture.captureWindow"
            )
          )
    case "region":
      return request instanceof DisplayCaptureRegionRequest
        ? client.captureRegion(request)
        : Effect.fail(
            makeHostProtocolInvalidArgumentError(
              "target.source",
              "must match capture method",
              "DisplayCapture.captureRegion"
            )
          )
  }
}

const methodForSource = (
  source: DisplayCaptureSource
): "captureDisplay" | "captureWindow" | "captureRegion" => {
  switch (source) {
    case "display":
      return "captureDisplay"
    case "window":
      return "captureWindow"
    case "region":
      return "captureRegion"
  }
}

const capability = (
  method: "captureDisplay" | "captureWindow" | "captureRegion"
): NormalizedCapability => P.nativeInvoke({ primitive: Surface, methods: [method] })

const permissionActor = (actor: DisplayCaptureActor): PermissionActor =>
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
    message: `unsupported DisplayCapture method: ${operation}`,
    operation,
    recoverable: false
  })

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

const narrowDisplayCaptureError = (error: HostProtocolError): DisplayCaptureError => {
  if (
    error.tag === "PermissionDenied" ||
    error.tag === "PermissionRevoked" ||
    error.tag === "Unsupported" ||
    error.tag === "InvalidArgument" ||
    error.tag === "InvalidOutput" ||
    error.tag === "Internal"
  ) {
    return error
  }
  return internalError(`unexpected display capture host failure: ${error.tag}`, error.operation)
}

const internalError = (message: string, operation: string): HostProtocolInternalError =>
  new HostProtocolInternalError({
    tag: "Internal",
    message,
    operation,
    recoverable: false
  })
