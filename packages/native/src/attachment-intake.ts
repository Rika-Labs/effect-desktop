import {
  type BridgeClientExchange,
  HostProtocolPermissionDeniedError,
  HostProtocolUnsupportedError,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
  type HostProtocolError,
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

import { subscribeNativeEvent } from "./event-stream.js"
import { decodeNativeInput, runNativeRpc } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"
import type { NativeRpcHandlers } from "./native-surface.js"
import {
  AttachmentIntakeActor,
  AttachmentIntakeDisposeInput,
  AttachmentIntakeDisposeRequest,
  AttachmentIntakeDisposeResult,
  AttachmentIntakeEvent,
  type AttachmentIntakeFailureReason,
  AttachmentIntakeIngestInput,
  AttachmentIntakeIngestRequest,
  AttachmentIntakeIngestResult,
  AttachmentIntakeInspectInput,
  AttachmentIntakeInspectRequest,
  AttachmentIntakeInspectResult,
  AttachmentIntakeItem,
  AttachmentIntakeItemInput,
  AttachmentIntakeSupportedResult
} from "./contracts/attachment-intake.js"

export * from "./contracts/attachment-intake.js"

const Surface = "AttachmentIntake"
const UnsupportedReason = "host-adapter-unimplemented"
const AttachmentIntakeEventMethod = "AttachmentIntake.Event"

export type AttachmentIntakeError = HostProtocolError

export const AttachmentIntakeIngest = attachmentIntakeRpc(
  "ingest",
  AttachmentIntakeIngestInput,
  AttachmentIntakeIngestResult,
  P.nativeInvoke({ primitive: Surface, methods: ["ingest"] })
)
export const AttachmentIntakeInspect = attachmentIntakeRpc(
  "inspect",
  AttachmentIntakeInspectInput,
  AttachmentIntakeInspectResult,
  P.nativeInvoke({ primitive: Surface, methods: ["inspect"] })
)
export const AttachmentIntakeDispose = attachmentIntakeRpc(
  "dispose",
  AttachmentIntakeDisposeInput,
  AttachmentIntakeDisposeResult,
  P.nativeInvoke({ primitive: Surface, methods: ["dispose"] })
)
export const AttachmentIntakeIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: AttachmentIntakeSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

export const AttachmentIntakeRpcEvents = Object.freeze({
  Event: { payload: AttachmentIntakeEvent }
})

const AttachmentIntakeRpcGroup = RpcGroup.make(
  AttachmentIntakeIngest,
  AttachmentIntakeInspect,
  AttachmentIntakeDispose,
  AttachmentIntakeIsSupported
)

export const AttachmentIntakeRpcs: RpcGroup.RpcGroup<AttachmentIntakeRpc> = AttachmentIntakeRpcGroup

export const AttachmentIntakeMethodNames = Object.freeze([
  "ingest",
  "inspect",
  "dispose",
  "isSupported"
] as const)

const AttachmentIntakeCapabilityMethods = Object.freeze([
  "ingest",
  "inspect",
  "dispose"
] as const satisfies readonly (typeof AttachmentIntakeMethodNames)[number][])

export interface AttachmentIntakeClientApi {
  readonly ingest: (
    input: AttachmentIntakeIngestInput
  ) => Effect.Effect<AttachmentIntakeIngestResult, AttachmentIntakeError, never>
  readonly inspect: (
    input: AttachmentIntakeInspectInput
  ) => Effect.Effect<AttachmentIntakeInspectResult, AttachmentIntakeError, never>
  readonly dispose: (
    input: AttachmentIntakeDisposeInput
  ) => Effect.Effect<AttachmentIntakeDisposeResult, AttachmentIntakeError, never>
  readonly isSupported: () => Effect.Effect<
    AttachmentIntakeSupportedResult,
    AttachmentIntakeError,
    never
  >
  readonly events: () => Stream.Stream<AttachmentIntakeEvent, AttachmentIntakeError, never>
}

export class AttachmentIntakeClient extends Context.Service<
  AttachmentIntakeClient,
  AttachmentIntakeClientApi
>()("@orika/native/AttachmentIntakeClient") {}

export interface AttachmentIntakeServiceApi {
  readonly ingest: (
    input: AttachmentIntakeIngestRequest
  ) => Effect.Effect<AttachmentIntakeIngestResult, AttachmentIntakeError, never>
  readonly inspect: (
    input: AttachmentIntakeInspectRequest
  ) => Effect.Effect<AttachmentIntakeInspectResult, AttachmentIntakeError, never>
  readonly dispose: (
    input: AttachmentIntakeDisposeRequest
  ) => Effect.Effect<AttachmentIntakeDisposeResult, AttachmentIntakeError, never>
  readonly isSupported: () => Effect.Effect<
    AttachmentIntakeSupportedResult,
    AttachmentIntakeError,
    never
  >
  readonly events: () => Stream.Stream<AttachmentIntakeEvent, AttachmentIntakeError, never>
}

export interface AttachmentIntakeServiceOptions {
  readonly permissions: PermissionRegistryApi
  readonly audit?: AuditEventsApi
  readonly nextIntakeId?: () => string
  readonly nextItemId?: () => string
  readonly nextTraceId?: () => string
}

interface IntakeState {
  readonly actor: AttachmentIntakeActor
  readonly items: readonly AttachmentIntakeItem[]
  readonly expiresAt: number
  readonly state: "ingested" | "disposed"
}

export class AttachmentIntake extends Context.Service<
  AttachmentIntake,
  AttachmentIntakeServiceApi
>()("@orika/native/AttachmentIntake") {
  static readonly layer = Layer.effect(AttachmentIntake)(
    Effect.gen(function* () {
      const client = yield* AttachmentIntakeClient
      const permissions = yield* PermissionRegistry
      return yield* makeAttachmentIntakeService(client, { permissions })
    })
  )
}

export const AttachmentIntakeLive = AttachmentIntake.layer

export const makeAttachmentIntakeServiceLayer = (
  client: AttachmentIntakeClientApi,
  options: AttachmentIntakeServiceOptions
): Layer.Layer<AttachmentIntake> =>
  Layer.effect(AttachmentIntake)(makeAttachmentIntakeService(client, options))

export type AttachmentIntakeRpc = RpcGroup.Rpcs<typeof AttachmentIntakeRpcGroup>
export type AttachmentIntakeRpcHandlers<R = never> = NativeRpcHandlers<
  typeof AttachmentIntakeRpcGroup,
  R
>

export const AttachmentIntakeHandlersLive = AttachmentIntakeRpcGroup.toLayer({
  "AttachmentIntake.ingest": (input) =>
    Effect.gen(function* () {
      const service = yield* AttachmentIntake
      return yield* service.ingest(input)
    }),
  "AttachmentIntake.inspect": (input) =>
    Effect.gen(function* () {
      const service = yield* AttachmentIntake
      return yield* service.inspect(input)
    }),
  "AttachmentIntake.dispose": (input) =>
    Effect.gen(function* () {
      const service = yield* AttachmentIntake
      return yield* service.dispose(input)
    }),
  "AttachmentIntake.isSupported": () =>
    Effect.gen(function* () {
      const service = yield* AttachmentIntake
      return yield* service.isSupported()
    })
})

export const AttachmentIntakeSurface = NativeSurface.make(Surface, AttachmentIntakeRpcGroup, {
  service: AttachmentIntakeClient,
  capabilities: AttachmentIntakeCapabilityMethods,
  handlers: AttachmentIntakeHandlersLive,
  client: (client) => attachmentIntakeClientFromRpcClient(client, undefined),
  bridgeClient: (client, exchange) => attachmentIntakeClientFromRpcClient(client, exchange)
})

export interface AttachmentIntakeMemoryClientOptions {
  readonly failure?: Partial<Record<"ingest" | "inspect" | "dispose", AttachmentIntakeError>>
  readonly nextIntakeId?: () => string
  readonly nextItemId?: () => string
}

export const makeAttachmentIntakeMemoryClient = (
  options: AttachmentIntakeMemoryClientOptions = {}
): Effect.Effect<AttachmentIntakeClientApi, never, never> =>
  Effect.gen(function* () {
    const intakes = yield* Ref.make<ReadonlyMap<string, IntakeState>>(new Map())
    const pubsub = yield* PubSub.bounded<AttachmentIntakeEvent>({ capacity: 256, replay: 64 })
    const nextIntakeId = yield* makeIdGenerator(options.nextIntakeId, "attachment-intake")
    const nextItemId = yield* makeIdGenerator(options.nextItemId, "attachment-item")

    return Object.freeze({
      ingest: (input) =>
        validateIngestInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.ingest,
              Effect.gen(function* () {
                const intakeId = valid.intakeId ?? (yield* nextIntakeId())
                const items = yield* materializeItems(valid.items, nextItemId)
                const now = yield* Clock.currentTimeMillis
                const expiresAt = now + valid.policy.lifetimeMillis
                yield* Ref.update(intakes, (current) =>
                  new Map(current).set(intakeId, {
                    actor: valid.actor,
                    items,
                    expiresAt,
                    state: "ingested"
                  })
                )
                yield* publishEvent(pubsub, "ingested", intakeId, items.length)
                return new AttachmentIntakeIngestResult({
                  intakeId,
                  items,
                  state: "ingested",
                  expiresAt
                })
              })
            )
          )
        ),
      inspect: (input) =>
        validateInspectInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.inspect,
              Effect.gen(function* () {
                const now = yield* Clock.currentTimeMillis
                const state = (yield* Ref.get(intakes)).get(valid.intakeId)
                if (state === undefined) {
                  return yield* invalid(
                    "intakeId",
                    "must reference an active attachment intake",
                    "AttachmentIntake.inspect"
                  )
                }
                if (now >= state.expiresAt) {
                  yield* Ref.update(intakes, (current) => {
                    const next = new Map(current)
                    next.delete(valid.intakeId)
                    return next
                  })
                  yield* publishEvent(
                    pubsub,
                    "failed",
                    valid.intakeId,
                    undefined,
                    "invalid-input",
                    "attachment intake expired"
                  )
                  return yield* invalid(
                    "intakeId",
                    "attachment intake lifetime has expired",
                    "AttachmentIntake.inspect"
                  )
                }
                return new AttachmentIntakeInspectResult({
                  intakeId: valid.intakeId,
                  items: state.items,
                  state: state.state,
                  expiresAt: state.expiresAt
                })
              })
            )
          )
        ),
      dispose: (input) =>
        validateDisposeInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.dispose,
              Effect.gen(function* () {
                const removed = yield* Ref.modify(intakes, (current) => {
                  const next = new Map(current)
                  const existed = next.delete(valid.intakeId)
                  return [existed, next] as const
                })
                yield* publishEvent(pubsub, "disposed", valid.intakeId)
                return new AttachmentIntakeDisposeResult({
                  intakeId: valid.intakeId,
                  disposed: removed
                })
              })
            )
          )
        ),
      isSupported: () => Effect.succeed(new AttachmentIntakeSupportedResult({ supported: true })),
      events: () => Stream.fromPubSub(pubsub)
    } satisfies AttachmentIntakeClientApi)
  })

export const makeAttachmentIntakeUnsupportedClient = (): AttachmentIntakeClientApi =>
  Object.freeze({
    ingest: (input) =>
      validateIngestInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("AttachmentIntake.ingest")))
      ),
    inspect: (input) =>
      validateInspectInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("AttachmentIntake.inspect")))
      ),
    dispose: (input) =>
      validateDisposeInput(input).pipe(
        Effect.flatMap(() => Effect.fail(unsupportedError("AttachmentIntake.dispose")))
      ),
    isSupported: () =>
      Effect.succeed(
        new AttachmentIntakeSupportedResult({ supported: false, reason: UnsupportedReason })
      ),
    events: () => Stream.fail(unsupportedError("AttachmentIntake.events"))
  } satisfies AttachmentIntakeClientApi)

const makeAttachmentIntakeService = (
  client: AttachmentIntakeClientApi,
  options: AttachmentIntakeServiceOptions
): Effect.Effect<AttachmentIntakeServiceApi, never, never> =>
  Effect.gen(function* () {
    const intakes = yield* Ref.make<ReadonlyMap<string, AttachmentIntakeActor>>(new Map())
    const nextIntakeId = yield* makeIdGenerator(options.nextIntakeId, "attachment-intake")

    return Object.freeze({
      ingest: (input) =>
        Effect.gen(function* () {
          const request = yield* validateIngestRequest(input)
          const intakeId = request.intakeId ?? (yield* nextIntakeId())
          yield* checkPermission(
            options,
            P.nativeInvoke({ primitive: Surface, methods: ["ingest"] }),
            request.actor,
            `intake:${intakeId}:ingest`,
            intakeId,
            "AttachmentIntake.ingest",
            request.traceId
          )
          const result = yield* client.ingest(
            new AttachmentIntakeIngestInput({
              actor: request.actor,
              policy: request.policy,
              items: request.items,
              intakeId,
              ...(request.traceId === undefined ? {} : { traceId: request.traceId })
            })
          )
          yield* Ref.update(intakes, (current) =>
            new Map(current).set(result.intakeId, request.actor)
          )
          yield* emitIntakeAudit(
            options,
            "permission-used",
            P.nativeInvoke({ primitive: Surface, methods: ["ingest"] }),
            request.actor,
            result.intakeId,
            request.traceId ?? result.intakeId,
            "AttachmentIntake.ingest",
            { itemCount: result.items.length }
          )
          return result
        }),
      inspect: (input) =>
        Effect.gen(function* () {
          const request = yield* validateInspectRequest(input)
          const actor = yield* intakeActor(intakes, request.intakeId, "AttachmentIntake.inspect")
          yield* checkPermission(
            options,
            P.nativeInvoke({ primitive: Surface, methods: ["inspect"] }),
            actor,
            `intake:${request.intakeId}:inspect`,
            request.intakeId,
            "AttachmentIntake.inspect",
            request.traceId
          )
          const result = yield* client.inspect(
            new AttachmentIntakeInspectInput({
              intakeId: request.intakeId,
              ...(request.traceId === undefined ? {} : { traceId: request.traceId })
            })
          )
          yield* emitIntakeAudit(
            options,
            "permission-used",
            P.nativeInvoke({ primitive: Surface, methods: ["inspect"] }),
            actor,
            request.intakeId,
            request.traceId ?? request.intakeId,
            "AttachmentIntake.inspect",
            { itemCount: result.items.length }
          )
          return result
        }),
      dispose: (input) =>
        Effect.gen(function* () {
          const request = yield* validateDisposeRequest(input)
          const actor = yield* intakeActor(intakes, request.intakeId, "AttachmentIntake.dispose")
          yield* checkPermission(
            options,
            P.nativeInvoke({ primitive: Surface, methods: ["dispose"] }),
            actor,
            `intake:${request.intakeId}:dispose`,
            request.intakeId,
            "AttachmentIntake.dispose",
            request.traceId
          )
          const result = yield* client.dispose(
            new AttachmentIntakeDisposeInput({
              intakeId: request.intakeId,
              ...(request.traceId === undefined ? {} : { traceId: request.traceId })
            })
          )
          yield* Ref.update(intakes, (current) => {
            const next = new Map(current)
            next.delete(request.intakeId)
            return next
          })
          yield* emitIntakeAudit(
            options,
            "permission-used",
            P.nativeInvoke({ primitive: Surface, methods: ["dispose"] }),
            actor,
            request.intakeId,
            request.traceId ?? request.intakeId,
            "AttachmentIntake.dispose"
          )
          return result
        }),
      isSupported: () => client.isSupported(),
      events: () => client.events()
    } satisfies AttachmentIntakeServiceApi)
  })

const attachmentIntakeClientFromRpcClient = (
  client: DesktopRpcClient<AttachmentIntakeRpc>,
  exchange: BridgeClientExchange | undefined
): AttachmentIntakeClientApi =>
  Object.freeze({
    ingest: (input) =>
      validateIngestInput(input).pipe(
        Effect.flatMap((valid) =>
          runAttachmentIntakeRpc(
            client["AttachmentIntake.ingest"](valid),
            "AttachmentIntake.ingest"
          )
        )
      ),
    inspect: (input) =>
      validateInspectInput(input).pipe(
        Effect.flatMap((valid) =>
          runAttachmentIntakeRpc(
            client["AttachmentIntake.inspect"](valid),
            "AttachmentIntake.inspect"
          )
        )
      ),
    dispose: (input) =>
      validateDisposeInput(input).pipe(
        Effect.flatMap((valid) =>
          runAttachmentIntakeRpc(
            client["AttachmentIntake.dispose"](valid),
            "AttachmentIntake.dispose"
          )
        )
      ),
    isSupported: () =>
      runAttachmentIntakeRpc(
        client["AttachmentIntake.isSupported"](undefined),
        "AttachmentIntake.isSupported"
      ),
    events: () => subscribeNativeEvent(exchange, AttachmentIntakeEventMethod, AttachmentIntakeEvent)
  } satisfies AttachmentIntakeClientApi)

function attachmentIntakeRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(method: Method, payload: Payload, success: Success, capability: RpcCapabilityMetadata) {
  return NativeSurface.rpc(Surface, method, {
    payload,
    success,
    authority: NativeSurface.authority.custom(capability),
    endpoint: "mutation",
    support: NativeSurface.support.supported
  })
}

const runAttachmentIntakeRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, AttachmentIntakeError, never> => runNativeRpc(effect, operation, Surface)

const validateIngestRequest = (
  input: unknown
): Effect.Effect<AttachmentIntakeIngestRequest, AttachmentIntakeError, never> =>
  decodeNativeInput(AttachmentIntakeIngestRequest, input, "AttachmentIntake.ingest").pipe(
    Effect.tap(validateIngestPayload("AttachmentIntake.ingest"))
  )

const validateIngestInput = (
  input: unknown
): Effect.Effect<AttachmentIntakeIngestInput, AttachmentIntakeError, never> =>
  decodeNativeInput(AttachmentIntakeIngestInput, input, "AttachmentIntake.ingest").pipe(
    Effect.tap(validateIngestPayload("AttachmentIntake.ingest"))
  )

const validateInspectRequest = (
  input: unknown
): Effect.Effect<AttachmentIntakeInspectRequest, AttachmentIntakeError, never> =>
  decodeNativeInput(AttachmentIntakeInspectRequest, input, "AttachmentIntake.inspect")

const validateInspectInput = (
  input: unknown
): Effect.Effect<AttachmentIntakeInspectInput, AttachmentIntakeError, never> =>
  decodeNativeInput(AttachmentIntakeInspectInput, input, "AttachmentIntake.inspect")

const validateDisposeRequest = (
  input: unknown
): Effect.Effect<AttachmentIntakeDisposeRequest, AttachmentIntakeError, never> =>
  decodeNativeInput(AttachmentIntakeDisposeRequest, input, "AttachmentIntake.dispose")

const validateDisposeInput = (
  input: unknown
): Effect.Effect<AttachmentIntakeDisposeInput, AttachmentIntakeError, never> =>
  decodeNativeInput(AttachmentIntakeDisposeInput, input, "AttachmentIntake.dispose")

const validateIngestPayload =
  (operation: string) =>
  (
    input: AttachmentIntakeIngestRequest | AttachmentIntakeIngestInput
  ): Effect.Effect<void, AttachmentIntakeError, never> =>
    Effect.gen(function* () {
      if (input.items.length === 0) {
        return yield* invalid("items", "must include at least one attachment item", operation)
      }
      if (input.items.length > input.policy.maxItems) {
        return yield* invalid("items", "exceeds policy maxItems", operation)
      }
      if (input.policy.allowedMimeTypes.length === 0) {
        return yield* invalid(
          "policy.allowedMimeTypes",
          "must include at least one MIME type",
          operation
        )
      }
      let totalBytes = 0
      for (const [index, item] of input.items.entries()) {
        if (!isAllowedMime(input.policy.allowedMimeTypes, item.mimeType)) {
          return yield* invalid(`items[${index}].mimeType`, "is not allowed by policy", operation)
        }
        if (item.bytes.byteLength > input.policy.maxBytesPerItem) {
          return yield* invalid(
            `items[${index}].bytes`,
            "exceeds policy maxBytesPerItem",
            operation
          )
        }
        totalBytes += item.bytes.byteLength
        if (totalBytes > input.policy.maxTotalBytes) {
          return yield* invalid("items", "exceeds policy maxTotalBytes", operation)
        }
      }
    })

const materializeItems = (
  items: readonly AttachmentIntakeItemInput[],
  nextItemId: () => Effect.Effect<string, never, never>
): Effect.Effect<readonly AttachmentIntakeItem[], never, never> =>
  Effect.forEach(items, (item) =>
    Effect.gen(function* () {
      const itemId = item.itemId ?? (yield* nextItemId())
      return new AttachmentIntakeItem({
        itemId,
        ...(item.name === undefined ? {} : { name: item.name }),
        mimeType: item.mimeType,
        source: item.source,
        sizeBytes: item.bytes.byteLength
      })
    })
  )

const intakeActor = (
  intakes: Ref.Ref<ReadonlyMap<string, AttachmentIntakeActor>>,
  intakeId: string,
  operation: string
): Effect.Effect<AttachmentIntakeActor, AttachmentIntakeError, never> =>
  Ref.get(intakes).pipe(
    Effect.flatMap((current) => {
      const actor = current.get(intakeId)
      return actor === undefined
        ? invalid("intakeId", "must reference an active attachment intake", operation)
        : Effect.succeed(actor)
    })
  )

const checkPermission = (
  options: AttachmentIntakeServiceOptions,
  capability: NormalizedCapability,
  actor: AttachmentIntakeActor,
  resource: string,
  auditResource: string,
  operation: string,
  traceId: string | undefined
): Effect.Effect<void, AttachmentIntakeError, never> =>
  options.permissions
    .check(
      capability,
      new PermissionContext({
        actor: permissionActor(actor),
        resource,
        traceId: traceId ?? options.nextTraceId?.() ?? operation
      })
    )
    .pipe(
      Effect.asVoid,
      Effect.catch((error: PermissionRegistryError) => {
        if (!(error instanceof PermissionDeniedError)) {
          return Effect.fail(
            makeHostProtocolInternalError(
              `attachment intake permission registry failure: ${error._tag}`,
              operation
            )
          )
        }
        return emitIntakeAudit(
          options,
          "permission-denied",
          capability,
          actor,
          auditResource,
          error.traceId,
          operation,
          { reason: error.reason }
        ).pipe(Effect.andThen(Effect.fail(permissionDeniedError(capability, error, operation))))
      })
    )

const publishEvent = (
  pubsub: PubSub.PubSub<AttachmentIntakeEvent>,
  phase: "ingested" | "disposed" | "failed",
  intakeId?: string,
  itemCount?: number,
  reason?: AttachmentIntakeFailureReason,
  message?: string
): Effect.Effect<void, never, never> =>
  Clock.currentTimeMillis.pipe(
    Effect.flatMap((timestamp) =>
      PubSub.publish(
        pubsub,
        new AttachmentIntakeEvent({
          type: "attachment-intake-event",
          timestamp,
          phase,
          ...(phase === "failed" ? {} : { state: phase }),
          ...(intakeId === undefined ? {} : { intakeId }),
          ...(itemCount === undefined ? {} : { itemCount }),
          ...(reason === undefined ? {} : { reason }),
          ...(message === undefined ? {} : { message })
        })
      )
    ),
    Effect.asVoid
  )

const emitIntakeAudit = (
  options: AttachmentIntakeServiceOptions,
  kind: "permission-used" | "permission-denied",
  capability: NormalizedCapability,
  actor: AttachmentIntakeActor,
  resource: string,
  traceId: string,
  operation: string,
  details: Record<string, unknown> = {}
): Effect.Effect<void, AttachmentIntakeError, never> => {
  if (options.audit === undefined) {
    return Effect.void
  }
  return emitAuditEvent(
    options.audit,
    permissionAuditEvent({
      kind,
      source: operation,
      traceId,
      outcome: kind === "permission-denied" ? "denied" : "used",
      normalizedCapability: capability,
      actor: permissionActor(actor),
      resource,
      details
    })
  ).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInternalError(
        `failed to write attachment intake audit event: ${error.message}`,
        operation
      )
    )
  )
}

const permissionActor = (actor: AttachmentIntakeActor): PermissionActor =>
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
  capability: NormalizedCapability,
  error: PermissionDeniedError,
  operation: string
): HostProtocolPermissionDeniedError =>
  new HostProtocolPermissionDeniedError({
    tag: "PermissionDenied",
    message: `permission denied for ${capability.kind}`,
    operation,
    capability: capability.kind,
    resource: error.traceId,
    recoverable: false
  })

const invalid = (
  field: string,
  message: string,
  operation: string
): Effect.Effect<never, AttachmentIntakeError, never> =>
  Effect.fail(makeHostProtocolInvalidArgumentError(field, message, operation))

const unsupportedError = (operation: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: `unsupported AttachmentIntake method: ${operation}`,
    operation,
    recoverable: false
  })

const failOr = <A>(
  error: AttachmentIntakeError | undefined,
  effect: Effect.Effect<A, AttachmentIntakeError, never>
): Effect.Effect<A, AttachmentIntakeError, never> =>
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

const isAllowedMime = (allowed: readonly string[], mimeType: string): boolean =>
  allowed.some(
    (entry) =>
      entry === mimeType || (entry.endsWith("/*") && mimeType.startsWith(entry.slice(0, -1)))
  )
