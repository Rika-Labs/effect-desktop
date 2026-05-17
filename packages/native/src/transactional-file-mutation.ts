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
  makeHostProtocolNotFoundError,
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
  permissionAuditEvent
} from "@effect-desktop/core"
import { Clock, Context, Effect, Layer, PubSub, Ref, Schema, Stream } from "effect"

import {
  TransactionalFileMutationActor,
  TransactionalFileMutationCommitInput,
  TransactionalFileMutationCommitRequest,
  TransactionalFileMutationCommitResult,
  TransactionalFileMutationDiff,
  TransactionalFileMutationEvent,
  type TransactionalFileMutationEventPhase,
  TransactionalFileMutationPrepareInput,
  TransactionalFileMutationPrepareRequest,
  TransactionalFileMutationPrepareResult,
  TransactionalFileMutationRollbackInput,
  TransactionalFileMutationRollbackRequest,
  TransactionalFileMutationRollbackResult,
  TransactionalFileMutationSupportedResult
} from "./contracts/transactional-file-mutation.js"
import { subscribeNativeEvent } from "./event-stream.js"
import { decodeNativeInput, runNativeRpc } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"

const Surface = "TransactionalFileMutation"
const UnsupportedReason = "host-adapter-unimplemented"
const TransactionalFileMutationEventMethod = "TransactionalFileMutation.Event"
const UnsupportedSupport = NativeSurface.support.unsupported(UnsupportedReason, {
  platforms: [
    { platform: "macos", status: "unsupported", reason: UnsupportedReason },
    { platform: "windows", status: "unsupported", reason: UnsupportedReason },
    { platform: "linux", status: "unsupported", reason: UnsupportedReason }
  ]
})

const IdentifierPattern = /^[A-Za-z0-9._-]+$/
const WindowsAbsolutePath = /^[A-Za-z]:[\\/]/u
const Text = new TextDecoder()

export type TransactionalFileMutationError = HostProtocolError

export const TransactionalFileMutationPrepare = transactionalFileMutationRpc(
  "prepare",
  TransactionalFileMutationPrepareInput,
  TransactionalFileMutationPrepareResult,
  P.nativeInvoke({ primitive: Surface, methods: ["prepare"] })
)
export const TransactionalFileMutationCommit = transactionalFileMutationRpc(
  "commit",
  TransactionalFileMutationCommitInput,
  TransactionalFileMutationCommitResult,
  P.nativeInvoke({ primitive: Surface, methods: ["commit"] })
)
export const TransactionalFileMutationRollback = transactionalFileMutationRpc(
  "rollback",
  TransactionalFileMutationRollbackInput,
  TransactionalFileMutationRollbackResult,
  P.nativeInvoke({ primitive: Surface, methods: ["rollback"] })
)
export const TransactionalFileMutationIsSupported = NativeSurface.rpc(Surface, "isSupported", {
  payload: Schema.Void,
  success: TransactionalFileMutationSupportedResult,
  authority: NativeSurface.authority.none,
  endpoint: "query",
  support: NativeSurface.support.supported
})

export const TransactionalFileMutationRpcEvents = Object.freeze({
  Event: { payload: TransactionalFileMutationEvent }
})

export type TransactionalFileMutationRpcEvents = typeof TransactionalFileMutationRpcEvents

const TransactionalFileMutationRpcGroup = RpcGroup.make(
  TransactionalFileMutationPrepare,
  TransactionalFileMutationCommit,
  TransactionalFileMutationRollback,
  TransactionalFileMutationIsSupported
)

export const TransactionalFileMutationRpcs: RpcGroup.RpcGroup<TransactionalFileMutationRpc> =
  TransactionalFileMutationRpcGroup

export const TransactionalFileMutationMethodNames = Object.freeze([
  "prepare",
  "commit",
  "rollback",
  "isSupported"
] as const)

const TransactionalFileMutationCapabilityMethods = Object.freeze([
  "prepare",
  "commit",
  "rollback"
] as const satisfies readonly (typeof TransactionalFileMutationMethodNames)[number][])

export interface TransactionalFileMutationClientApi {
  readonly prepare: (
    input: TransactionalFileMutationPrepareInput
  ) => Effect.Effect<TransactionalFileMutationPrepareResult, TransactionalFileMutationError, never>
  readonly commit: (
    input: TransactionalFileMutationCommitInput
  ) => Effect.Effect<TransactionalFileMutationCommitResult, TransactionalFileMutationError, never>
  readonly rollback: (
    input: TransactionalFileMutationRollbackInput
  ) => Effect.Effect<TransactionalFileMutationRollbackResult, TransactionalFileMutationError, never>
  readonly isSupported: () => Effect.Effect<
    TransactionalFileMutationSupportedResult,
    TransactionalFileMutationError,
    never
  >
  readonly events: () => Stream.Stream<
    TransactionalFileMutationEvent,
    TransactionalFileMutationError,
    never
  >
}

export class TransactionalFileMutationClient extends Context.Service<
  TransactionalFileMutationClient,
  TransactionalFileMutationClientApi
>()("@effect-desktop/native/TransactionalFileMutationClient") {}

export interface TransactionalFileMutationServiceApi {
  readonly prepare: (
    input: TransactionalFileMutationPrepareRequest
  ) => Effect.Effect<TransactionalFileMutationPrepareResult, TransactionalFileMutationError, never>
  readonly commit: (
    input: TransactionalFileMutationCommitRequest
  ) => Effect.Effect<TransactionalFileMutationCommitResult, TransactionalFileMutationError, never>
  readonly rollback: (
    input: TransactionalFileMutationRollbackRequest
  ) => Effect.Effect<TransactionalFileMutationRollbackResult, TransactionalFileMutationError, never>
  readonly isSupported: () => Effect.Effect<
    TransactionalFileMutationSupportedResult,
    TransactionalFileMutationError,
    never
  >
  readonly events: () => Stream.Stream<
    TransactionalFileMutationEvent,
    TransactionalFileMutationError,
    never
  >
}

export interface TransactionalFileMutationServiceOptions {
  readonly permissions: PermissionRegistryApi
  readonly audit?: AuditEventsApi
  readonly nextMutationId?: () => string
  readonly nextTraceId?: () => string
}

export class TransactionalFileMutation extends Context.Service<
  TransactionalFileMutation,
  TransactionalFileMutationServiceApi
>()("@effect-desktop/native/TransactionalFileMutation") {
  static readonly layer = Layer.effect(TransactionalFileMutation)(
    Effect.gen(function* () {
      const client = yield* TransactionalFileMutationClient
      const permissions = yield* PermissionRegistry
      return yield* makeTransactionalFileMutationService(client, { permissions })
    })
  )
}

export const TransactionalFileMutationLive = TransactionalFileMutation.layer

export const makeTransactionalFileMutationClientLayer = (
  client: TransactionalFileMutationClientApi
): Layer.Layer<TransactionalFileMutationClient> =>
  Layer.succeed(TransactionalFileMutationClient)(client)

export const makeTransactionalFileMutationServiceLayer = (
  client: TransactionalFileMutationClientApi,
  options: TransactionalFileMutationServiceOptions
): Layer.Layer<TransactionalFileMutation> =>
  Layer.effect(TransactionalFileMutation)(makeTransactionalFileMutationService(client, options))

export const makeTransactionalFileMutationBridgeClientLayer = (
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): Layer.Layer<TransactionalFileMutationClient> =>
  TransactionalFileMutationSurface.bridgeClientLayer(exchange, options)

export type TransactionalFileMutationRpc = RpcGroup.Rpcs<typeof TransactionalFileMutationRpcGroup>

export type TransactionalFileMutationRpcHandlers =
  RpcGroup.HandlersFrom<TransactionalFileMutationRpc>

export const TransactionalFileMutationHandlersLive = TransactionalFileMutationRpcGroup.toLayer({
  "TransactionalFileMutation.prepare": (input) =>
    Effect.gen(function* () {
      const service = yield* TransactionalFileMutation
      return yield* service.prepare(input)
    }),
  "TransactionalFileMutation.commit": (input) =>
    Effect.gen(function* () {
      const service = yield* TransactionalFileMutation
      return yield* service.commit(input)
    }),
  "TransactionalFileMutation.rollback": (input) =>
    Effect.gen(function* () {
      const service = yield* TransactionalFileMutation
      return yield* service.rollback(input)
    }),
  "TransactionalFileMutation.isSupported": () =>
    Effect.gen(function* () {
      const service = yield* TransactionalFileMutation
      return yield* service.isSupported()
    })
})

export const TransactionalFileMutationSurface = NativeSurface.make(
  Surface,
  TransactionalFileMutationRpcGroup,
  {
    service: TransactionalFileMutationClient,
    capabilities: TransactionalFileMutationCapabilityMethods,
    handlers: TransactionalFileMutationHandlersLive,
    client: (client) => transactionalFileMutationClientFromRpcClient(client, undefined),
    bridgeClient: (client, exchange) =>
      transactionalFileMutationClientFromRpcClient(client, exchange)
  }
)

export const makeHostTransactionalFileMutationRpcRuntime = (
  handlers: TransactionalFileMutationRpcHandlers,
  runtimeOptions: BridgeHandlerRuntimeOptions = {}
): BridgeHandlerRuntime<PermissionRegistry> =>
  TransactionalFileMutationSurface.hostRuntime(handlers, runtimeOptions)

export interface TransactionalFileMutationMemoryClientOptions {
  readonly files?: ReadonlyMap<string, Uint8Array> | Record<string, Uint8Array | string>
  readonly failure?: Partial<
    Record<"prepare" | "commit" | "rollback", TransactionalFileMutationError>
  >
  readonly nextMutationId?: () => string
}

interface PreparedMutation {
  readonly actor: TransactionalFileMutationActor
  readonly path: string
  readonly sourceHash: string
  readonly replacementHash: string
  readonly replacementBytes: Uint8Array
  readonly diff: TransactionalFileMutationDiff
}

export const makeTransactionalFileMutationMemoryClient = (
  options: TransactionalFileMutationMemoryClientOptions = {}
): Effect.Effect<TransactionalFileMutationClientApi, never, never> =>
  Effect.gen(function* () {
    const files = yield* Ref.make<ReadonlyMap<string, Uint8Array>>(normalizeFiles(options.files))
    const mutations = yield* Ref.make<ReadonlyMap<string, PreparedMutation>>(new Map())
    const pubsub = yield* PubSub.bounded<TransactionalFileMutationEvent>({
      capacity: 256,
      replay: 64
    })
    const nextMutationId = yield* makeIdGenerator(options.nextMutationId, "file-mutation")

    return Object.freeze({
      prepare: (input) =>
        validatePrepareInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.prepare,
              Effect.gen(function* () {
                const current = yield* Ref.get(files)
                const source = current.get(normalizePath(valid.path))
                if (source === undefined) {
                  return yield* Effect.fail(
                    makeHostProtocolNotFoundError(valid.path, "TransactionalFileMutation.prepare")
                  )
                }
                const sourceHash = hashBytes(source)
                if (
                  valid.expectedSourceHash !== undefined &&
                  valid.expectedSourceHash !== sourceHash
                ) {
                  return yield* conflict(
                    sourceHash,
                    valid.expectedSourceHash,
                    "TransactionalFileMutation.prepare"
                  )
                }
                const mutationId = valid.mutationId ?? (yield* nextMutationId())
                const replacementBytes = copyBytes(valid.replacementBytes)
                const replacementHash = hashBytes(replacementBytes)
                const diff = makeDiff(valid.path, source, replacementBytes)
                yield* Ref.update(mutations, (currentMutations) =>
                  new Map(currentMutations).set(mutationId, {
                    actor: valid.actor,
                    path: normalizePath(valid.path),
                    sourceHash,
                    replacementHash,
                    replacementBytes,
                    diff
                  })
                )
                yield* publishEvent(pubsub, mutationId, "prepared", {
                  path: normalizePath(valid.path),
                  state: "prepared",
                  sourceHash,
                  replacementHash,
                  diff
                })
                return new TransactionalFileMutationPrepareResult({
                  mutationId,
                  path: normalizePath(valid.path),
                  state: "prepared",
                  sourceHash,
                  replacementHash,
                  diff
                })
              })
            )
          )
        ),
      commit: (input) =>
        validateCommitInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.commit,
              Effect.gen(function* () {
                const currentMutations = yield* Ref.get(mutations)
                const prepared = currentMutations.get(valid.mutationId)
                if (prepared === undefined) {
                  return yield* mutationNotFound(
                    valid.mutationId,
                    "TransactionalFileMutation.commit"
                  )
                }
                yield* validateActorMatch(
                  prepared.actor,
                  valid.actor,
                  "TransactionalFileMutation.commit"
                )
                if (
                  valid.expectedSourceHash !== undefined &&
                  valid.expectedSourceHash !== prepared.sourceHash
                ) {
                  return yield* conflict(
                    prepared.sourceHash,
                    valid.expectedSourceHash,
                    "TransactionalFileMutation.commit"
                  )
                }
                const currentFiles = yield* Ref.get(files)
                const currentSource = currentFiles.get(prepared.path)
                const currentHash =
                  currentSource === undefined ? "missing" : hashBytes(currentSource)
                if (currentHash !== prepared.sourceHash) {
                  yield* publishEvent(pubsub, valid.mutationId, "conflicted", {
                    path: prepared.path,
                    state: "conflicted",
                    sourceHash: currentHash,
                    replacementHash: prepared.replacementHash
                  })
                  return yield* conflict(
                    currentHash,
                    prepared.sourceHash,
                    "TransactionalFileMutation.commit"
                  )
                }
                yield* Ref.update(files, (currentFiles) =>
                  new Map(currentFiles).set(prepared.path, copyBytes(prepared.replacementBytes))
                )
                yield* Ref.update(mutations, (currentMutations) => {
                  const next = new Map(currentMutations)
                  next.delete(valid.mutationId)
                  return next
                })
                yield* publishEvent(pubsub, valid.mutationId, "committed", {
                  path: prepared.path,
                  state: "committed",
                  sourceHash: prepared.sourceHash,
                  replacementHash: prepared.replacementHash
                })
                return new TransactionalFileMutationCommitResult({
                  mutationId: valid.mutationId,
                  path: prepared.path,
                  state: "committed",
                  committed: true
                })
              })
            )
          )
        ),
      rollback: (input) =>
        validateRollbackInput(input).pipe(
          Effect.flatMap((valid) =>
            failOr(
              options.failure?.rollback,
              Effect.gen(function* () {
                const prepared = (yield* Ref.get(mutations)).get(valid.mutationId)
                if (prepared === undefined) {
                  return yield* mutationNotFound(
                    valid.mutationId,
                    "TransactionalFileMutation.rollback"
                  )
                }
                yield* validateActorMatch(
                  prepared.actor,
                  valid.actor,
                  "TransactionalFileMutation.rollback"
                )
                yield* Ref.update(mutations, (currentMutations) => {
                  const next = new Map(currentMutations)
                  next.delete(valid.mutationId)
                  return next
                })
                yield* publishEvent(pubsub, valid.mutationId, "rolled-back", {
                  path: prepared.path,
                  state: "rolled-back"
                })
                return new TransactionalFileMutationRollbackResult({
                  mutationId: valid.mutationId,
                  path: prepared.path,
                  state: "rolled-back",
                  rolledBack: true
                })
              })
            )
          )
        ),
      isSupported: () =>
        Effect.succeed(new TransactionalFileMutationSupportedResult({ supported: true })),
      events: () => Stream.fromPubSub(pubsub)
    } satisfies TransactionalFileMutationClientApi)
  })

export const makeTransactionalFileMutationUnsupportedClient =
  (): TransactionalFileMutationClientApi =>
    Object.freeze({
      prepare: (input) =>
        validatePrepareInput(input).pipe(
          Effect.flatMap(() => Effect.fail(unsupportedError("TransactionalFileMutation.prepare")))
        ),
      commit: (input) =>
        validateCommitInput(input).pipe(
          Effect.flatMap(() => Effect.fail(unsupportedError("TransactionalFileMutation.commit")))
        ),
      rollback: (input) =>
        validateRollbackInput(input).pipe(
          Effect.flatMap(() => Effect.fail(unsupportedError("TransactionalFileMutation.rollback")))
        ),
      isSupported: () =>
        Effect.succeed(
          new TransactionalFileMutationSupportedResult({
            supported: false,
            reason: UnsupportedReason
          })
        ),
      events: () => Stream.fail(unsupportedError("TransactionalFileMutation.events"))
    } satisfies TransactionalFileMutationClientApi)

const makeTransactionalFileMutationService = (
  client: TransactionalFileMutationClientApi,
  options: TransactionalFileMutationServiceOptions
): Effect.Effect<TransactionalFileMutationServiceApi, never, never> =>
  Effect.gen(function* () {
    const mutations = yield* Ref.make<ReadonlyMap<string, PreparedMutation>>(new Map())
    const events = yield* PubSub.bounded<TransactionalFileMutationEvent>({
      capacity: 256,
      replay: 64
    })

    return Object.freeze({
      prepare: (input) =>
        Effect.gen(function* () {
          const request = yield* validatePrepareRequest(input)
          const path = normalizePath(request.path)
          yield* authorizePrepare(options, request.actor, path, request.traceId)
          yield* emitPrepareUseAudit(options, request.actor, path, request.traceId ?? path)
          const result = yield* client.prepare(
            new TransactionalFileMutationPrepareInput({
              actor: request.actor,
              path,
              replacementBytes: request.replacementBytes,
              ...(request.expectedSourceHash === undefined
                ? {}
                : { expectedSourceHash: request.expectedSourceHash }),
              ...(request.mutationId === undefined ? {} : { mutationId: request.mutationId }),
              ...(request.traceId === undefined ? {} : { traceId: request.traceId })
            })
          )
          yield* Ref.update(mutations, (current) =>
            new Map(current).set(result.mutationId, {
              actor: request.actor,
              path,
              sourceHash: result.sourceHash,
              replacementHash: result.replacementHash,
              replacementBytes: copyBytes(request.replacementBytes),
              diff: result.diff
            })
          )
          yield* publishEvent(events, result.mutationId, "prepared", {
            path,
            state: "prepared",
            sourceHash: result.sourceHash,
            replacementHash: result.replacementHash,
            diff: result.diff
          })
          return result
        }),
      commit: (input) =>
        Effect.gen(function* () {
          const request = yield* validateCommitRequest(input)
          const current = yield* Ref.get(mutations)
          const prepared = current.get(request.mutationId)
          if (prepared === undefined) {
            return yield* mutationNotFound(request.mutationId, "TransactionalFileMutation.commit")
          }
          yield* validateActorMatch(
            prepared.actor,
            request.actor,
            "TransactionalFileMutation.commit"
          )
          yield* authorizeCommit(options, request.actor, prepared.path, request.traceId)
          yield* emitCommitUseAudit(
            options,
            request.actor,
            prepared.path,
            request.mutationId,
            request.traceId ?? request.mutationId
          )
          yield* publishEvent(events, request.mutationId, "commit-started", {
            path: prepared.path,
            state: "committing"
          })
          const result = yield* client
            .commit(
              new TransactionalFileMutationCommitInput({
                actor: request.actor,
                mutationId: request.mutationId,
                ...(request.expectedSourceHash === undefined
                  ? {}
                  : { expectedSourceHash: request.expectedSourceHash }),
                ...(request.traceId === undefined ? {} : { traceId: request.traceId })
              })
            )
            .pipe(
              Effect.catch((error: TransactionalFileMutationError) =>
                publishCommitFailureEvent(events, request.mutationId, prepared, error)
              )
            )
          yield* Ref.update(mutations, (currentMutations) => {
            const next = new Map(currentMutations)
            next.delete(request.mutationId)
            return next
          })
          yield* publishEvent(events, request.mutationId, "committed", {
            path: result.path,
            state: "committed",
            sourceHash: prepared.sourceHash,
            replacementHash: prepared.replacementHash
          })
          return result
        }),
      rollback: (input) =>
        Effect.gen(function* () {
          const request = yield* validateRollbackRequest(input)
          const current = yield* Ref.get(mutations)
          const prepared = current.get(request.mutationId)
          if (prepared === undefined) {
            return yield* mutationNotFound(request.mutationId, "TransactionalFileMutation.rollback")
          }
          yield* validateActorMatch(
            prepared.actor,
            request.actor,
            "TransactionalFileMutation.rollback"
          )
          yield* checkPermission(
            options,
            P.nativeInvoke({ primitive: Surface, methods: ["rollback"] }),
            request.actor,
            `mutation:${request.mutationId}:rollback`,
            request.mutationId,
            "TransactionalFileMutation.rollback",
            request.traceId
          )
          yield* emitMutationAudit(
            options,
            "permission-used",
            P.nativeInvoke({ primitive: Surface, methods: ["rollback"] }),
            request.actor,
            request.mutationId,
            request.traceId ?? request.mutationId,
            "TransactionalFileMutation.rollback",
            { mutationId: request.mutationId, path: prepared.path }
          )
          yield* publishEvent(events, request.mutationId, "rollback-started", {
            path: prepared.path,
            state: "rolling-back"
          })
          const result = yield* client.rollback(
            new TransactionalFileMutationRollbackInput({
              actor: request.actor,
              mutationId: request.mutationId,
              ...(request.traceId === undefined ? {} : { traceId: request.traceId })
            })
          )
          yield* Ref.update(mutations, (currentMutations) => {
            const next = new Map(currentMutations)
            next.delete(request.mutationId)
            return next
          })
          yield* publishEvent(events, request.mutationId, "rolled-back", {
            path: result.path,
            state: "rolled-back"
          })
          return result
        }),
      isSupported: () => client.isSupported(),
      events: () => Stream.fromPubSub(events)
    } satisfies TransactionalFileMutationServiceApi)
  })

const transactionalFileMutationClientFromRpcClient = (
  client: DesktopRpcClient<TransactionalFileMutationRpc>,
  exchange: BridgeClientExchange | undefined
): TransactionalFileMutationClientApi =>
  Object.freeze({
    prepare: (input) =>
      validatePrepareInput(input).pipe(
        Effect.flatMap((valid) =>
          runTransactionalFileMutationRpc(
            client["TransactionalFileMutation.prepare"](valid),
            "TransactionalFileMutation.prepare"
          )
        )
      ),
    commit: (input) =>
      validateCommitInput(input).pipe(
        Effect.flatMap((valid) =>
          runTransactionalFileMutationRpc(
            client["TransactionalFileMutation.commit"](valid),
            "TransactionalFileMutation.commit"
          )
        )
      ),
    rollback: (input) =>
      validateRollbackInput(input).pipe(
        Effect.flatMap((valid) =>
          runTransactionalFileMutationRpc(
            client["TransactionalFileMutation.rollback"](valid),
            "TransactionalFileMutation.rollback"
          )
        )
      ),
    isSupported: () =>
      runTransactionalFileMutationRpc(
        client["TransactionalFileMutation.isSupported"](undefined),
        "TransactionalFileMutation.isSupported"
      ),
    events: () =>
      subscribeNativeEvent(
        exchange,
        TransactionalFileMutationEventMethod,
        TransactionalFileMutationEvent
      )
  } satisfies TransactionalFileMutationClientApi)

function transactionalFileMutationRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(method: Method, payload: Payload, success: Success, capability: RpcCapabilityMetadata) {
  return NativeSurface.rpc(Surface, method, {
    payload,
    success,
    authority: NativeSurface.authority.custom(capability),
    endpoint: "mutation",
    support: UnsupportedSupport
  })
}

const runTransactionalFileMutationRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, TransactionalFileMutationError, never> =>
  runNativeRpc(effect, operation, Surface)

const validatePrepareRequest = (
  input: unknown
): Effect.Effect<TransactionalFileMutationPrepareRequest, TransactionalFileMutationError, never> =>
  decodeNativeInput(
    TransactionalFileMutationPrepareRequest,
    input,
    "TransactionalFileMutation.prepare"
  ).pipe(Effect.tap(validatePreparePayload("TransactionalFileMutation.prepare")))

const validatePrepareInput = (
  input: unknown
): Effect.Effect<TransactionalFileMutationPrepareInput, TransactionalFileMutationError, never> =>
  decodeNativeInput(
    TransactionalFileMutationPrepareInput,
    input,
    "TransactionalFileMutation.prepare"
  ).pipe(Effect.tap(validatePreparePayload("TransactionalFileMutation.prepare")))

const validateCommitRequest = (
  input: unknown
): Effect.Effect<TransactionalFileMutationCommitRequest, TransactionalFileMutationError, never> =>
  decodeNativeInput(
    TransactionalFileMutationCommitRequest,
    input,
    "TransactionalFileMutation.commit"
  ).pipe(Effect.tap(validateCommitPayload("TransactionalFileMutation.commit")))

const validateCommitInput = (
  input: unknown
): Effect.Effect<TransactionalFileMutationCommitInput, TransactionalFileMutationError, never> =>
  decodeNativeInput(
    TransactionalFileMutationCommitInput,
    input,
    "TransactionalFileMutation.commit"
  ).pipe(Effect.tap(validateCommitPayload("TransactionalFileMutation.commit")))

const validateRollbackRequest = (
  input: unknown
): Effect.Effect<TransactionalFileMutationRollbackRequest, TransactionalFileMutationError, never> =>
  decodeNativeInput(
    TransactionalFileMutationRollbackRequest,
    input,
    "TransactionalFileMutation.rollback"
  ).pipe(Effect.tap(validateRollbackPayload("TransactionalFileMutation.rollback")))

const validateRollbackInput = (
  input: unknown
): Effect.Effect<TransactionalFileMutationRollbackInput, TransactionalFileMutationError, never> =>
  decodeNativeInput(
    TransactionalFileMutationRollbackInput,
    input,
    "TransactionalFileMutation.rollback"
  ).pipe(Effect.tap(validateRollbackPayload("TransactionalFileMutation.rollback")))

const validatePreparePayload =
  (operation: string) =>
  (
    input: TransactionalFileMutationPrepareRequest | TransactionalFileMutationPrepareInput
  ): Effect.Effect<void, TransactionalFileMutationError, never> =>
    Effect.gen(function* () {
      yield* validateIdentifier("actor.id", input.actor.id, operation)
      yield* validatePath("path", input.path, operation)
    })

const validateCommitPayload =
  (operation: string) =>
  (
    input: TransactionalFileMutationCommitRequest | TransactionalFileMutationCommitInput
  ): Effect.Effect<void, TransactionalFileMutationError, never> =>
    validateIdentifier("actor.id", input.actor.id, operation)

const validateRollbackPayload =
  (operation: string) =>
  (
    input: TransactionalFileMutationRollbackRequest | TransactionalFileMutationRollbackInput
  ): Effect.Effect<void, TransactionalFileMutationError, never> =>
    validateIdentifier("actor.id", input.actor.id, operation)

const authorizePrepare = (
  options: TransactionalFileMutationServiceOptions,
  actor: TransactionalFileMutationActor,
  path: string,
  traceId: string | undefined
): Effect.Effect<void, TransactionalFileMutationError, never> =>
  Effect.gen(function* () {
    yield* checkPermission(
      options,
      P.nativeInvoke({ primitive: Surface, methods: ["prepare"] }),
      actor,
      `file:${path}:prepare`,
      path,
      "TransactionalFileMutation.prepare",
      traceId
    )
    yield* checkPermission(
      options,
      filesystemReadCapability(path),
      actor,
      path,
      path,
      "TransactionalFileMutation.prepare",
      traceId
    )
    yield* checkPermission(
      options,
      filesystemWriteCapability(path),
      actor,
      path,
      path,
      "TransactionalFileMutation.prepare",
      traceId
    )
  })

const authorizeCommit = (
  options: TransactionalFileMutationServiceOptions,
  actor: TransactionalFileMutationActor,
  path: string,
  traceId: string | undefined
): Effect.Effect<void, TransactionalFileMutationError, never> =>
  Effect.gen(function* () {
    yield* checkPermission(
      options,
      P.nativeInvoke({ primitive: Surface, methods: ["commit"] }),
      actor,
      `file:${path}:commit`,
      path,
      "TransactionalFileMutation.commit",
      traceId
    )
    yield* checkPermission(
      options,
      filesystemReadCapability(path),
      actor,
      path,
      path,
      "TransactionalFileMutation.commit",
      traceId
    )
    yield* checkPermission(
      options,
      filesystemWriteCapability(path),
      actor,
      path,
      path,
      "TransactionalFileMutation.commit",
      traceId
    )
  })

const checkPermission = (
  options: TransactionalFileMutationServiceOptions,
  capability: NormalizedCapability,
  actor: TransactionalFileMutationActor,
  resource: string,
  auditResource: string,
  operation: string,
  traceId: string | undefined
): Effect.Effect<void, TransactionalFileMutationError, never> =>
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
              `transactional file mutation permission registry failure: ${error._tag}`,
              operation
            )
          )
        }
        return emitMutationAudit(
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

const filesystemReadCapability = (path: string): NormalizedCapability =>
  P.filesystemRead({ roots: [normalizePath(path)] })

const filesystemWriteCapability = (path: string): NormalizedCapability =>
  P.filesystemWrite({ roots: [normalizePath(path)] })

const normalizeFiles = (
  files: ReadonlyMap<string, Uint8Array> | Record<string, Uint8Array | string> | undefined
): ReadonlyMap<string, Uint8Array> => {
  if (files === undefined) {
    return new Map()
  }
  if (isFileMap(files)) {
    const entries: [string, Uint8Array][] = []
    for (const [path, bytes] of files.entries()) {
      entries.push([normalizePath(path), copyBytes(bytes)])
    }
    return new Map(entries)
  }
  const entries: [string, Uint8Array][] = []
  for (const [path, value] of Object.entries(files)) {
    entries.push([
      normalizePath(path),
      typeof value === "string" ? new TextEncoder().encode(value) : copyBytes(value)
    ])
  }
  return new Map(entries)
}

const isFileMap = (
  files: ReadonlyMap<string, Uint8Array> | Record<string, Uint8Array | string>
): files is ReadonlyMap<string, Uint8Array> => files instanceof Map

const makeDiff = (
  path: string,
  sourceBytes: Uint8Array,
  replacementBytes: Uint8Array
): TransactionalFileMutationDiff => {
  const sourceLines = Text.decode(sourceBytes).split("\n")
  const replacementLines = Text.decode(replacementBytes).split("\n")
  const body = [
    `--- ${path}`,
    `+++ ${path}`,
    `@@ -1,${sourceLines.length} +1,${replacementLines.length} @@`,
    ...sourceLines.map((line) => `-${line}`),
    ...replacementLines.map((line) => `+${line}`)
  ].join("\n")
  return new TransactionalFileMutationDiff({
    format: "unified",
    text: body,
    additions: replacementLines.length,
    deletions: sourceLines.length
  })
}

const hashBytes = (bytes: Uint8Array): string => {
  let hash = 2166136261
  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`
}

const copyBytes = (bytes: Uint8Array): Uint8Array => new Uint8Array(bytes)

const validateActorMatch = (
  expected: TransactionalFileMutationActor,
  actual: TransactionalFileMutationActor,
  operation: string
): Effect.Effect<void, TransactionalFileMutationError, never> =>
  expected.kind === actual.kind && expected.id === actual.id
    ? Effect.void
    : invalid("actor", "must match the actor that prepared the mutation", operation)

const validatePath = (
  field: string,
  path: string,
  operation: string
): Effect.Effect<void, TransactionalFileMutationError, never> => {
  if (!isAbsolutePath(path)) {
    return invalid(field, "must be an absolute path", operation)
  }
  if (hasDotPathSegment(path)) {
    return invalid(field, "must not include dot path segments", operation)
  }
  return Effect.void
}

const normalizePath = (path: string): string => path.replaceAll("\\", "/").replace(/\/+/gu, "/")

const hasDotPathSegment = (path: string): boolean =>
  normalizePath(path)
    .split("/")
    .some((segment) => segment === "." || segment === "..")

const isAbsolutePath = (path: string): boolean =>
  path.startsWith("/") || WindowsAbsolutePath.test(path)

const validateIdentifier = (
  field: string,
  value: string,
  operation: string
): Effect.Effect<void, TransactionalFileMutationError, never> => {
  if (!IdentifierPattern.test(value)) {
    return invalid(field, "must contain only letters, numbers, dot, underscore, or dash", operation)
  }
  return Effect.void
}

const failOr = <A>(
  error: TransactionalFileMutationError | undefined,
  effect: Effect.Effect<A, TransactionalFileMutationError, never>
): Effect.Effect<A, TransactionalFileMutationError, never> =>
  error === undefined ? effect : Effect.fail(error)

const makeIdGenerator = (
  nextId: (() => string) | undefined,
  prefix: string
): Effect.Effect<() => Effect.Effect<string, never, never>, never, never> =>
  Effect.gen(function* () {
    const sequence = yield* Ref.make(0)
    if (nextId !== undefined) {
      return () => Effect.sync(nextId)
    }
    return () =>
      Ref.updateAndGet(sequence, (current) => current + 1).pipe(
        Effect.map((current) => `${prefix}-${current}`)
      )
  })

const publishEvent = (
  events: PubSub.PubSub<TransactionalFileMutationEvent>,
  mutationId: string,
  phase: TransactionalFileMutationEventPhase,
  options: {
    readonly path?: string
    readonly state?:
      | "prepared"
      | "committing"
      | "committed"
      | "rolling-back"
      | "rolled-back"
      | "conflicted"
    readonly sourceHash?: string
    readonly replacementHash?: string
    readonly diff?: TransactionalFileMutationDiff
  } = {}
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const timestamp = yield* Clock.currentTimeMillis
    yield* PubSub.publish(
      events,
      new TransactionalFileMutationEvent({
        type: "transactional-file-mutation-event",
        timestamp,
        mutationId,
        phase,
        ...(options.path === undefined ? {} : { path: options.path }),
        ...(options.state === undefined ? {} : { state: options.state }),
        ...(options.sourceHash === undefined ? {} : { sourceHash: options.sourceHash }),
        ...(options.replacementHash === undefined
          ? {}
          : { replacementHash: options.replacementHash }),
        ...(options.diff === undefined ? {} : { diff: options.diff })
      })
    )
  }).pipe(Effect.asVoid)

const publishCommitFailureEvent = (
  events: PubSub.PubSub<TransactionalFileMutationEvent>,
  mutationId: string,
  prepared: PreparedMutation,
  error: TransactionalFileMutationError
): Effect.Effect<never, TransactionalFileMutationError, never> => {
  if (error.tag !== "InvalidState") {
    return Effect.fail(error)
  }
  return publishEvent(events, mutationId, "conflicted", {
    path: prepared.path,
    state: "conflicted",
    sourceHash: error.current,
    replacementHash: prepared.replacementHash
  }).pipe(Effect.andThen(Effect.fail(error)))
}

const emitPrepareUseAudit = (
  options: TransactionalFileMutationServiceOptions,
  actor: TransactionalFileMutationActor,
  path: string,
  traceId: string
): Effect.Effect<void, TransactionalFileMutationError, never> =>
  Effect.all(
    [
      emitMutationAudit(
        options,
        "permission-used",
        P.nativeInvoke({ primitive: Surface, methods: ["prepare"] }),
        actor,
        path,
        traceId,
        "TransactionalFileMutation.prepare",
        { path }
      ),
      emitMutationAudit(
        options,
        "permission-used",
        filesystemReadCapability(path),
        actor,
        path,
        traceId,
        "TransactionalFileMutation.prepare",
        { path }
      ),
      emitMutationAudit(
        options,
        "permission-used",
        filesystemWriteCapability(path),
        actor,
        path,
        traceId,
        "TransactionalFileMutation.prepare",
        { path }
      )
    ],
    { concurrency: 1, discard: true }
  )

const emitCommitUseAudit = (
  options: TransactionalFileMutationServiceOptions,
  actor: TransactionalFileMutationActor,
  path: string,
  mutationId: string,
  traceId: string
): Effect.Effect<void, TransactionalFileMutationError, never> =>
  Effect.all(
    [
      emitMutationAudit(
        options,
        "permission-used",
        P.nativeInvoke({ primitive: Surface, methods: ["commit"] }),
        actor,
        path,
        traceId,
        "TransactionalFileMutation.commit",
        { mutationId, path }
      ),
      emitMutationAudit(
        options,
        "permission-used",
        filesystemReadCapability(path),
        actor,
        path,
        traceId,
        "TransactionalFileMutation.commit",
        { mutationId, path }
      ),
      emitMutationAudit(
        options,
        "permission-used",
        filesystemWriteCapability(path),
        actor,
        path,
        traceId,
        "TransactionalFileMutation.commit",
        { mutationId, path }
      )
    ],
    { concurrency: 1, discard: true }
  )

const emitMutationAudit = (
  options: TransactionalFileMutationServiceOptions,
  kind: "permission-denied" | "permission-used",
  capability: NormalizedCapability,
  actor: TransactionalFileMutationActor,
  resource: string,
  traceId: string,
  operation: string,
  details: unknown
): Effect.Effect<void, TransactionalFileMutationError, never> => {
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
        `failed to write transactional file mutation audit event: ${error.message}`,
        operation
      )
    )
  )
}

const permissionActor = (actor: TransactionalFileMutationActor): PermissionActor =>
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

const invalid = (
  field: string,
  message: string,
  operation: string
): Effect.Effect<never, TransactionalFileMutationError, never> =>
  Effect.fail(makeHostProtocolInvalidArgumentError(field, message, operation))

const conflict = (
  current: string,
  attempted: string,
  operation: string
): Effect.Effect<never, TransactionalFileMutationError, never> =>
  Effect.fail(makeHostProtocolInvalidStateError(current, attempted, operation))

const mutationNotFound = (
  mutationId: string,
  operation: string
): Effect.Effect<never, TransactionalFileMutationError, never> =>
  Effect.fail(makeHostProtocolNotFoundError(`TransactionalFileMutation:${mutationId}`, operation))

const permissionDeniedError = (
  capability: NormalizedCapability,
  error: PermissionDeniedError,
  operation: string
): HostProtocolPermissionDeniedError =>
  new HostProtocolPermissionDeniedError({
    tag: "PermissionDenied",
    capability: capability.kind,
    message: `transactional file mutation denied ${capability.kind}: ${error.reason}`,
    operation,
    recoverable: false
  })

const unsupportedError = (operation: string): HostProtocolUnsupportedError =>
  new HostProtocolUnsupportedError({
    tag: "Unsupported",
    reason: UnsupportedReason,
    message: `unsupported TransactionalFileMutation method: ${operation}`,
    operation,
    recoverable: false
  })
