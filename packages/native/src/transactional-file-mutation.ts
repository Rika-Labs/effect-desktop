import {
  type BridgeClientExchange,
  HostProtocolPermissionDeniedError,
  HostProtocolUnsupportedError,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidStateError,
  makeHostProtocolNotFoundError,
  type HostProtocolError,
  type RpcCapabilityMetadata,
  RpcGroup
} from "@orika/bridge"
import {
  type AuditEventsApi,
  type DesktopRpcClient,
  emitAuditEvent,
  makeResourceId,
  type NormalizedCapability,
  P,
  PermissionActor,
  PermissionContext,
  PermissionDeniedError,
  PermissionRegistry,
  type PermissionRegistryApi,
  type PermissionRegistryError,
  permissionAuditEvent,
  type ResourceId,
  ResourceRegistry,
  type ResourceRegistryApi
} from "@orika/core"
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
import { decodeNativeInput, runNativeRpc, runNativeRpcStream } from "./native-client.js"
import { NativeSurface } from "./native-surface.js"
import type { NativeRpcHandlers } from "./native-surface.js"

const Surface = "TransactionalFileMutation"
const UnsupportedReason = "host-adapter-unimplemented"

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

const TransactionalFileMutationEventStream = NativeSurface.event(Surface, "Event", {
  payload: TransactionalFileMutationEvent,
  support: NativeSurface.support.supported
})

const TransactionalFileMutationRpcGroup = RpcGroup.make(
  TransactionalFileMutationPrepare,
  TransactionalFileMutationCommit,
  TransactionalFileMutationRollback,
  TransactionalFileMutationIsSupported,
  TransactionalFileMutationEventStream
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
>()("@orika/native/TransactionalFileMutationClient") {}

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
  readonly resources?: ResourceRegistryApi
  readonly audit?: AuditEventsApi
  readonly nextMutationId?: () => string
  readonly nextTraceId?: () => string
}

export class TransactionalFileMutation extends Context.Service<
  TransactionalFileMutation,
  TransactionalFileMutationServiceApi
>()("@orika/native/TransactionalFileMutation") {
  static readonly layer = Layer.effect(TransactionalFileMutation)(
    Effect.gen(function* () {
      const client = yield* TransactionalFileMutationClient
      const permissions = yield* PermissionRegistry
      const resources = yield* ResourceRegistry
      return yield* makeTransactionalFileMutationService(client, { permissions, resources })
    })
  )
}

export const makeTransactionalFileMutationServiceLayer = (
  client: TransactionalFileMutationClientApi,
  options: TransactionalFileMutationServiceOptions
): Layer.Layer<TransactionalFileMutation> =>
  Layer.effect(TransactionalFileMutation)(makeTransactionalFileMutationService(client, options))

export type TransactionalFileMutationRpc = RpcGroup.Rpcs<typeof TransactionalFileMutationRpcGroup>

export type TransactionalFileMutationRpcHandlers<R = never> = NativeRpcHandlers<
  typeof TransactionalFileMutationRpcGroup,
  R
>

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
    }),
  "TransactionalFileMutation.events.Event": () =>
    Stream.unwrap(
      Effect.gen(function* () {
        const service = yield* TransactionalFileMutation
        return service.events()
      })
    )
})

export const TransactionalFileMutationSurface = NativeSurface.make(
  Surface,
  TransactionalFileMutationRpcGroup,
  {
    service: TransactionalFileMutationClient,
    capabilities: TransactionalFileMutationCapabilityMethods,
    handlers: TransactionalFileMutationHandlersLive,
    client: (client) => transactionalFileMutationClientFromRpcClient(client),
    bridgeClient: (client, exchange) =>
      transactionalFileMutationBridgeClientFromRpcClient(client, exchange)
  }
)

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
  readonly ownerScope: string
  readonly state: "prepared" | "committing" | "rolling-back" | "conflicted"
  readonly resourceId?: ResourceId
  readonly sourceHash: string
  readonly replacementHash: string
  readonly replacementBytes: Uint8Array
  readonly diff: TransactionalFileMutationDiff
}

interface MemoryState {
  readonly files: ReadonlyMap<string, Uint8Array>
  readonly mutations: ReadonlyMap<string, PreparedMutation>
}

type MemoryPrepareResult =
  | { readonly _tag: "success" }
  | { readonly _tag: "failure"; readonly error: TransactionalFileMutationError }

type MemoryCommitResult =
  | { readonly _tag: "committed"; readonly prepared: PreparedMutation }
  | {
      readonly _tag: "conflicted"
      readonly prepared: PreparedMutation
      readonly currentHash: string
    }
  | { readonly _tag: "failure"; readonly error: TransactionalFileMutationError }

type MemoryRollbackResult =
  | { readonly _tag: "rolled-back"; readonly prepared: PreparedMutation }
  | { readonly _tag: "failure"; readonly error: TransactionalFileMutationError }

type ClaimMutationResult =
  | { readonly _tag: "success"; readonly prepared: PreparedMutation }
  | { readonly _tag: "failure"; readonly error: TransactionalFileMutationError }

type ServicePrepareResult =
  | { readonly _tag: "success"; readonly prepared: PreparedMutation }
  | { readonly _tag: "failure"; readonly error: TransactionalFileMutationError }

type RestoreClaimResult = { readonly _tag: "restored" } | { readonly _tag: "ownerClosed" }

export const makeTransactionalFileMutationMemoryClient = (
  options: TransactionalFileMutationMemoryClientOptions = {}
): Effect.Effect<TransactionalFileMutationClientApi, never, never> =>
  Effect.gen(function* () {
    const state = yield* Ref.make<MemoryState>({
      files: normalizeFiles(options.files),
      mutations: new Map()
    })
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
                const current = yield* Ref.get(state)
                const path = normalizePath(valid.path)
                const ownerScope = mutationOwnerScope(valid.actor, valid.ownerScope)
                const source = current.files.get(path)
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
                const prepareResult = yield* Ref.modify(
                  state,
                  (currentState): readonly [MemoryPrepareResult, MemoryState] => {
                    if (currentState.mutations.has(mutationId)) {
                      return [
                        {
                          _tag: "failure",
                          error: makeHostProtocolInvalidArgumentError(
                            "mutationId",
                            "must identify a mutation that is not already prepared",
                            "TransactionalFileMutation.prepare"
                          )
                        },
                        currentState
                      ] as const
                    }
                    return [
                      { _tag: "success" },
                      {
                        ...currentState,
                        mutations: new Map(currentState.mutations).set(mutationId, {
                          actor: valid.actor,
                          path,
                          ownerScope,
                          state: "prepared",
                          sourceHash,
                          replacementHash,
                          replacementBytes,
                          diff
                        })
                      }
                    ] as const
                  }
                )
                if (prepareResult._tag === "failure") {
                  return yield* Effect.fail(prepareResult.error)
                }
                yield* publishEvent(pubsub, mutationId, "prepared", {
                  path,
                  state: "prepared",
                  sourceHash,
                  replacementHash,
                  diff
                })
                return new TransactionalFileMutationPrepareResult({
                  mutationId,
                  path,
                  state: "prepared",
                  ownerScope,
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
                const commitResult = yield* Ref.modify(
                  state,
                  (currentState): readonly [MemoryCommitResult, MemoryState] => {
                    const prepared = currentState.mutations.get(valid.mutationId)
                    if (prepared === undefined) {
                      return [
                        {
                          _tag: "failure" as const,
                          error: mutationNotFoundError(
                            valid.mutationId,
                            "TransactionalFileMutation.commit"
                          )
                        },
                        currentState
                      ] as const
                    }
                    const actorError = actorMismatch({
                      actor: valid.actor,
                      expected: prepared.actor,
                      operation: "TransactionalFileMutation.commit"
                    })
                    if (actorError !== undefined) {
                      return [
                        { _tag: "failure" as const, error: actorError },
                        currentState
                      ] as const
                    }
                    if (prepared.state !== "prepared") {
                      return [
                        {
                          _tag: "failure" as const,
                          error: invalidStateError(
                            prepared.state,
                            "prepared",
                            "TransactionalFileMutation.commit"
                          )
                        },
                        currentState
                      ] as const
                    }
                    if (
                      valid.expectedSourceHash !== undefined &&
                      valid.expectedSourceHash !== prepared.sourceHash
                    ) {
                      return [
                        {
                          _tag: "failure" as const,
                          error: invalidStateError(
                            prepared.sourceHash,
                            valid.expectedSourceHash,
                            "TransactionalFileMutation.commit"
                          )
                        },
                        currentState
                      ] as const
                    }
                    const currentSource = currentState.files.get(prepared.path)
                    const currentHash =
                      currentSource === undefined ? "missing" : hashBytes(currentSource)
                    if (currentHash !== prepared.sourceHash) {
                      const nextMutations = new Map(currentState.mutations)
                      nextMutations.set(valid.mutationId, { ...prepared, state: "conflicted" })
                      return [
                        { _tag: "conflicted" as const, prepared, currentHash },
                        { ...currentState, mutations: nextMutations }
                      ] as const
                    }
                    const nextFiles = new Map(currentState.files)
                    nextFiles.set(prepared.path, copyBytes(prepared.replacementBytes))
                    const nextMutations = new Map(currentState.mutations)
                    nextMutations.delete(valid.mutationId)
                    return [
                      { _tag: "committed" as const, prepared },
                      { files: nextFiles, mutations: nextMutations }
                    ] as const
                  }
                )
                if (commitResult._tag === "failure") {
                  return yield* Effect.fail(commitResult.error)
                }
                if (commitResult._tag === "conflicted") {
                  yield* publishEvent(pubsub, valid.mutationId, "conflicted", {
                    path: commitResult.prepared.path,
                    state: "conflicted",
                    sourceHash: commitResult.currentHash,
                    replacementHash: commitResult.prepared.replacementHash
                  })
                  return yield* conflict(
                    commitResult.currentHash,
                    commitResult.prepared.sourceHash,
                    "TransactionalFileMutation.commit"
                  )
                }
                yield* publishEvent(pubsub, valid.mutationId, "committed", {
                  path: commitResult.prepared.path,
                  state: "committed",
                  sourceHash: commitResult.prepared.sourceHash,
                  replacementHash: commitResult.prepared.replacementHash
                })
                return new TransactionalFileMutationCommitResult({
                  mutationId: valid.mutationId,
                  path: commitResult.prepared.path,
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
                const rollbackResult = yield* Ref.modify(
                  state,
                  (currentState): readonly [MemoryRollbackResult, MemoryState] => {
                    const prepared = currentState.mutations.get(valid.mutationId)
                    if (prepared === undefined) {
                      return [
                        {
                          _tag: "failure" as const,
                          error: mutationNotFoundError(
                            valid.mutationId,
                            "TransactionalFileMutation.rollback"
                          )
                        },
                        currentState
                      ] as const
                    }
                    const actorError = actorMismatch({
                      actor: valid.actor,
                      expected: prepared.actor,
                      operation: "TransactionalFileMutation.rollback"
                    })
                    if (actorError !== undefined) {
                      return [
                        { _tag: "failure" as const, error: actorError },
                        currentState
                      ] as const
                    }
                    const next = new Map(currentState.mutations)
                    next.delete(valid.mutationId)
                    return [
                      { _tag: "rolled-back" as const, prepared },
                      { ...currentState, mutations: next }
                    ] as const
                  }
                )
                if (rollbackResult._tag === "failure") {
                  return yield* Effect.fail(rollbackResult.error)
                }
                const { prepared } = rollbackResult
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
      events: () => Stream.fail(unsupportedError("TransactionalFileMutation.events.Event"))
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
          const traceId = operationTraceId(
            options,
            request.traceId,
            "TransactionalFileMutation.prepare"
          )
          const ownerScope = mutationOwnerScope(request.actor, request.ownerScope)
          if (request.mutationId !== undefined) {
            yield* ensureMutationIdAvailable(
              mutations,
              request.mutationId,
              "TransactionalFileMutation.prepare"
            )
          }
          yield* authorizePrepare(options, request.actor, path, traceId)
          yield* emitPrepareUseAudit(options, request.actor, path, traceId)
          return yield* Effect.uninterruptible(
            Effect.gen(function* () {
              const result = yield* client.prepare(
                new TransactionalFileMutationPrepareInput({
                  actor: request.actor,
                  path,
                  replacementBytes: request.replacementBytes,
                  ...(request.expectedSourceHash === undefined
                    ? {}
                    : { expectedSourceHash: request.expectedSourceHash }),
                  ...(request.mutationId === undefined ? {} : { mutationId: request.mutationId }),
                  ownerScope,
                  traceId
                })
              )
              const resourceId =
                options.resources === undefined
                  ? undefined
                  : makeResourceId(`transactional-file-mutation-${result.mutationId}`)
              const prepared = {
                actor: request.actor,
                path,
                ownerScope,
                state: "prepared" as const,
                ...(resourceId === undefined ? {} : { resourceId }),
                sourceHash: result.sourceHash,
                replacementHash: result.replacementHash,
                replacementBytes: copyBytes(request.replacementBytes),
                diff: result.diff
              }
              const prepareResult = yield* Ref.modify(
                mutations,
                (
                  current
                ): readonly [ServicePrepareResult, ReadonlyMap<string, PreparedMutation>] => {
                  if (current.has(result.mutationId)) {
                    return [
                      {
                        _tag: "failure",
                        error: makeHostProtocolInvalidArgumentError(
                          "mutationId",
                          "must identify a mutation that is not already prepared",
                          "TransactionalFileMutation.prepare"
                        )
                      },
                      current
                    ] as const
                  }
                  return [
                    { _tag: "success", prepared },
                    new Map(current).set(result.mutationId, prepared)
                  ] as const
                }
              )
              if (prepareResult._tag === "failure") {
                yield* rollbackHostMutation(client, request.actor, result.mutationId, traceId)
                return yield* Effect.fail(prepareResult.error)
              }
              yield* registerPreparedMutation(
                options,
                result.mutationId,
                prepareResult.prepared,
                mutations,
                client
              ).pipe(
                Effect.tapError(() => removePreparedMutation(mutations, result.mutationId)),
                Effect.tapError(() =>
                  rollbackHostMutation(client, request.actor, result.mutationId, traceId)
                )
              )
              const publicResult = new TransactionalFileMutationPrepareResult({
                mutationId: result.mutationId,
                path: result.path,
                state: "prepared",
                ownerScope,
                sourceHash: result.sourceHash,
                replacementHash: result.replacementHash,
                diff: result.diff
              })
              yield* publishEvent(events, result.mutationId, "prepared", {
                path,
                state: "prepared",
                sourceHash: result.sourceHash,
                replacementHash: result.replacementHash,
                diff: result.diff
              })
              return publicResult
            })
          )
        }),
      commit: (input) =>
        Effect.gen(function* () {
          const request = yield* validateCommitRequest(input)
          const traceId = operationTraceId(
            options,
            request.traceId,
            "TransactionalFileMutation.commit"
          )
          const prepared = yield* claimPreparedMutation(
            mutations,
            request.actor,
            request.mutationId,
            "committing",
            "TransactionalFileMutation.commit"
          )
          yield* Effect.gen(function* () {
            yield* authorizeCommit(options, request.actor, prepared.path, traceId).pipe(
              Effect.tapError(() =>
                restoreClaimedMutation(
                  mutations,
                  request.mutationId,
                  prepared,
                  "prepared",
                  rollbackHostMutation(client, request.actor, request.mutationId, traceId)
                )
              )
            )
            yield* emitCommitUseAudit(
              options,
              request.actor,
              prepared.path,
              request.mutationId,
              traceId
            ).pipe(
              Effect.tapError(() =>
                restoreClaimedMutation(
                  mutations,
                  request.mutationId,
                  prepared,
                  "prepared",
                  rollbackHostMutation(client, request.actor, request.mutationId, traceId)
                )
              )
            )
            yield* publishEvent(events, request.mutationId, "commit-started", {
              path: prepared.path,
              state: "committing"
            })
          }).pipe(
            Effect.onInterrupt(() =>
              restoreClaimedMutation(
                mutations,
                request.mutationId,
                prepared,
                "prepared",
                rollbackHostMutation(client, request.actor, request.mutationId, traceId)
              )
            )
          )
          return yield* Effect.uninterruptible(
            Effect.gen(function* () {
              const result = yield* client
                .commit(
                  new TransactionalFileMutationCommitInput({
                    actor: request.actor,
                    mutationId: request.mutationId,
                    ...(request.expectedSourceHash === undefined
                      ? {}
                      : { expectedSourceHash: request.expectedSourceHash }),
                    traceId
                  })
                )
                .pipe(
                  Effect.catch((error: TransactionalFileMutationError) =>
                    restoreAfterCommitFailure(
                      mutations,
                      request.mutationId,
                      prepared,
                      error,
                      rollbackHostMutation(client, request.actor, request.mutationId, traceId)
                    ).pipe(
                      Effect.andThen(
                        publishCommitFailureEvent(events, request.mutationId, prepared, error)
                      )
                    )
                  )
                )
              yield* removePreparedMutation(mutations, request.mutationId)
              yield* disposePreparedResource(options, prepared)
              yield* publishEvent(events, request.mutationId, "committed", {
                path: result.path,
                state: "committed",
                sourceHash: prepared.sourceHash,
                replacementHash: prepared.replacementHash
              })
              return result
            })
          )
        }),
      rollback: (input) =>
        Effect.gen(function* () {
          const request = yield* validateRollbackRequest(input)
          const traceId = operationTraceId(
            options,
            request.traceId,
            "TransactionalFileMutation.rollback"
          )
          const prepared = yield* claimPreparedMutation(
            mutations,
            request.actor,
            request.mutationId,
            "rolling-back",
            "TransactionalFileMutation.rollback"
          )
          yield* Effect.gen(function* () {
            yield* checkPermission(
              options,
              P.nativeInvoke({ primitive: Surface, methods: ["rollback"] }),
              request.actor,
              `mutation:${request.mutationId}:rollback`,
              request.mutationId,
              "TransactionalFileMutation.rollback",
              traceId
            ).pipe(
              Effect.tapError(() =>
                restoreClaimedMutation(
                  mutations,
                  request.mutationId,
                  prepared,
                  prepared.state,
                  rollbackHostMutation(client, request.actor, request.mutationId, traceId)
                )
              )
            )
            yield* emitMutationAudit(
              options,
              "permission-used",
              P.nativeInvoke({ primitive: Surface, methods: ["rollback"] }),
              request.actor,
              request.mutationId,
              traceId,
              "TransactionalFileMutation.rollback",
              { mutationId: request.mutationId, path: prepared.path }
            ).pipe(
              Effect.tapError(() =>
                restoreClaimedMutation(
                  mutations,
                  request.mutationId,
                  prepared,
                  prepared.state,
                  rollbackHostMutation(client, request.actor, request.mutationId, traceId)
                )
              )
            )
            yield* publishEvent(events, request.mutationId, "rollback-started", {
              path: prepared.path,
              state: "rolling-back"
            })
          }).pipe(
            Effect.onInterrupt(() =>
              restoreClaimedMutation(
                mutations,
                request.mutationId,
                prepared,
                prepared.state,
                rollbackHostMutation(client, request.actor, request.mutationId, traceId)
              )
            )
          )
          return yield* Effect.uninterruptible(
            Effect.gen(function* () {
              const result = yield* client
                .rollback(
                  new TransactionalFileMutationRollbackInput({
                    actor: request.actor,
                    mutationId: request.mutationId,
                    traceId
                  })
                )
                .pipe(
                  Effect.tapError(() =>
                    restoreClaimedMutation(
                      mutations,
                      request.mutationId,
                      prepared,
                      prepared.state,
                      Effect.void
                    )
                  )
                )
              yield* removePreparedMutation(mutations, request.mutationId)
              yield* disposePreparedResource(options, prepared)
              yield* publishEvent(events, request.mutationId, "rolled-back", {
                path: result.path,
                state: "rolled-back"
              })
              return result
            })
          )
        }),
      isSupported: () => client.isSupported(),
      events: () => Stream.fromPubSub(events)
    } satisfies TransactionalFileMutationServiceApi)
  })

const transactionalFileMutationClientFromRpcClient = (
  client: DesktopRpcClient<TransactionalFileMutationRpc>
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
      runTransactionalFileMutationRpcStream(
        client["TransactionalFileMutation.events.Event"](undefined),
        "TransactionalFileMutation.events.Event"
      )
  } satisfies TransactionalFileMutationClientApi)

const transactionalFileMutationBridgeClientFromRpcClient = (
  client: DesktopRpcClient<TransactionalFileMutationRpc>,
  exchange: BridgeClientExchange
): TransactionalFileMutationClientApi =>
  Object.freeze({
    ...transactionalFileMutationClientFromRpcClient(client),
    events: () => NativeSurface.subscribeEvent(exchange, TransactionalFileMutationEventStream)
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
    support: NativeSurface.support.supported
  })
}

const runTransactionalFileMutationRpc = <A, E>(
  effect: Effect.Effect<A, E, never>,
  operation: string
): Effect.Effect<A, TransactionalFileMutationError, never> =>
  runNativeRpc(effect, operation, Surface)

const runTransactionalFileMutationRpcStream = <A, E>(
  stream: Stream.Stream<A, E, never>,
  operation: string
): Stream.Stream<A, TransactionalFileMutationError, never> =>
  runNativeRpcStream(stream, operation, Surface)

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
      if (input.ownerScope !== undefined) {
        yield* validateNonBlank("ownerScope", input.ownerScope, operation)
      }
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
  traceId: string
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
  traceId: string
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
  traceId: string
): Effect.Effect<void, TransactionalFileMutationError, never> =>
  options.permissions
    .check(
      capability,
      new PermissionContext({
        actor: permissionActor(actor),
        resource,
        traceId
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

const operationTraceId = (
  options: TransactionalFileMutationServiceOptions,
  traceId: string | undefined,
  operation: string
): string => traceId ?? options.nextTraceId?.() ?? operation

const mutationOwnerScope = (actor: TransactionalFileMutationActor, ownerScope?: string): string =>
  ownerScope ?? `transactional-file-mutation-${actor.kind}-${actor.id}`

const ensureMutationIdAvailable = (
  mutations: Ref.Ref<ReadonlyMap<string, PreparedMutation>>,
  mutationId: string,
  operation: string
): Effect.Effect<void, TransactionalFileMutationError, never> =>
  Ref.get(mutations).pipe(
    Effect.flatMap((current) =>
      current.has(mutationId)
        ? Effect.fail(
            makeHostProtocolInvalidArgumentError(
              "mutationId",
              "must identify a mutation that is not already prepared",
              operation
            )
          )
        : Effect.void
    )
  )

const claimPreparedMutation = (
  mutations: Ref.Ref<ReadonlyMap<string, PreparedMutation>>,
  actor: TransactionalFileMutationActor,
  mutationId: string,
  nextState: PreparedMutation["state"],
  operation: string
): Effect.Effect<PreparedMutation, TransactionalFileMutationError, never> =>
  Effect.gen(function* () {
    const result = yield* Ref.modify(
      mutations,
      (current): readonly [ClaimMutationResult, ReadonlyMap<string, PreparedMutation>] => {
        const prepared = current.get(mutationId)
        if (prepared === undefined) {
          return [
            { _tag: "failure", error: mutationNotFoundError(mutationId, operation) },
            current
          ] as const
        }
        const actorError = actorMismatch({ actor, expected: prepared.actor, operation })
        if (actorError !== undefined) {
          return [{ _tag: "failure", error: actorError }, current] as const
        }
        if (!canClaimMutation(prepared.state, nextState)) {
          return [
            {
              _tag: "failure",
              error: invalidStateError(prepared.state, nextState, operation)
            },
            current
          ] as const
        }
        const next = new Map(current)
        next.set(mutationId, { ...prepared, state: nextState })
        return [{ _tag: "success", prepared }, next] as const
      }
    )
    if (result._tag === "failure") {
      return yield* Effect.fail(result.error)
    }
    return result.prepared
  })

const canClaimMutation = (
  current: PreparedMutation["state"],
  next: PreparedMutation["state"]
): boolean => {
  if (next === "committing") {
    return current === "prepared"
  }
  if (next === "rolling-back") {
    return current === "prepared" || current === "conflicted"
  }
  return false
}

const restoreClaimedMutation = (
  mutations: Ref.Ref<ReadonlyMap<string, PreparedMutation>>,
  mutationId: string,
  prepared: PreparedMutation,
  state: PreparedMutation["state"],
  whenOwnerClosed: Effect.Effect<void, never, never>
): Effect.Effect<void, never, never> =>
  Ref.modify(
    mutations,
    (current): readonly [RestoreClaimResult, ReadonlyMap<string, PreparedMutation>] => {
      const currentPrepared = current.get(mutationId)
      if (currentPrepared === undefined) {
        return [{ _tag: "ownerClosed" }, current] as const
      }
      if (
        currentPrepared.resourceId !== prepared.resourceId ||
        (currentPrepared.state !== "committing" && currentPrepared.state !== "rolling-back")
      ) {
        return [{ _tag: "restored" }, current] as const
      }

      const next = new Map(current)
      next.set(mutationId, { ...prepared, state })
      return [{ _tag: "restored" }, next] as const
    }
  ).pipe(
    Effect.flatMap((result) => (result._tag === "ownerClosed" ? whenOwnerClosed : Effect.void))
  )

const restoreAfterCommitFailure = (
  mutations: Ref.Ref<ReadonlyMap<string, PreparedMutation>>,
  mutationId: string,
  prepared: PreparedMutation,
  error: TransactionalFileMutationError,
  whenOwnerClosed: Effect.Effect<void, never, never>
): Effect.Effect<void, never, never> =>
  restoreClaimedMutation(
    mutations,
    mutationId,
    prepared,
    error.tag === "InvalidState" ? "conflicted" : "prepared",
    whenOwnerClosed
  )

const removePreparedMutation = (
  mutations: Ref.Ref<ReadonlyMap<string, PreparedMutation>>,
  mutationId: string
): Effect.Effect<void, never, never> =>
  Ref.update(mutations, (current) => {
    const next = new Map(current)
    next.delete(mutationId)
    return next
  })

const registerPreparedMutation = (
  options: TransactionalFileMutationServiceOptions,
  mutationId: string,
  prepared: PreparedMutation,
  mutations: Ref.Ref<ReadonlyMap<string, PreparedMutation>>,
  client: TransactionalFileMutationClientApi
): Effect.Effect<void, TransactionalFileMutationError, never> => {
  if (options.resources === undefined || prepared.resourceId === undefined) {
    return Effect.void
  }
  return options.resources
    .register({
      kind: "transactional-file-mutation",
      id: prepared.resourceId,
      ownerScope: prepared.ownerScope,
      state: "prepared",
      dispose: cleanupPreparedMutation(mutations, mutationId, client)
    })
    .pipe(
      Effect.flatMap((handle) =>
        Ref.update(mutations, (current) => {
          const currentPrepared = current.get(mutationId)
          if (currentPrepared === undefined || currentPrepared.resourceId !== prepared.resourceId) {
            return current
          }
          return new Map(current).set(mutationId, {
            ...currentPrepared,
            resourceId: handle.id
          })
        })
      ),
      Effect.mapError((error) =>
        makeHostProtocolInternalError(
          `failed to register transactional file mutation resource: ${error.message}`,
          "TransactionalFileMutation.prepare"
        )
      )
    )
}

const cleanupPreparedMutation = (
  mutations: Ref.Ref<ReadonlyMap<string, PreparedMutation>>,
  mutationId: string,
  client: TransactionalFileMutationClientApi
): Effect.Effect<void, never, never> =>
  Ref.modify(mutations, (current) => {
    const prepared = current.get(mutationId)
    if (prepared === undefined) {
      return [undefined, current] as const
    }
    if (prepared.state !== "prepared" && prepared.state !== "conflicted") {
      const next = new Map(current)
      next.delete(mutationId)
      return [undefined, next] as const
    }
    const next = new Map(current)
    next.delete(mutationId)
    return [prepared, next] as const
  }).pipe(
    Effect.flatMap((prepared) =>
      prepared === undefined
        ? Effect.void
        : client
            .rollback(
              new TransactionalFileMutationRollbackInput({
                actor: prepared.actor,
                mutationId
              })
            )
            .pipe(Effect.ignore)
    )
  )

const rollbackHostMutation = (
  client: TransactionalFileMutationClientApi,
  actor: TransactionalFileMutationActor,
  mutationId: string,
  traceId: string
): Effect.Effect<void, never, never> =>
  client
    .rollback(
      new TransactionalFileMutationRollbackInput({
        actor,
        mutationId,
        traceId
      })
    )
    .pipe(Effect.ignore)

const disposePreparedResource = (
  options: TransactionalFileMutationServiceOptions,
  prepared: PreparedMutation
): Effect.Effect<void, never, never> => {
  if (options.resources === undefined || prepared.resourceId === undefined) {
    return Effect.void
  }
  return options.resources.dispose(prepared.resourceId).pipe(Effect.ignore)
}

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

const actorMismatch = (options: {
  readonly actor: TransactionalFileMutationActor
  readonly expected: TransactionalFileMutationActor
  readonly operation: string
}): TransactionalFileMutationError | undefined =>
  options.expected.kind === options.actor.kind && options.expected.id === options.actor.id
    ? undefined
    : makeHostProtocolInvalidArgumentError(
        "actor",
        "must match the actor that prepared the mutation",
        options.operation
      )

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
  process.platform === "win32" ? WindowsAbsolutePath.test(path) : path.startsWith("/")

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

const validateNonBlank = (
  field: string,
  value: string,
  operation: string
): Effect.Effect<void, TransactionalFileMutationError, never> =>
  value.trim().length > 0 ? Effect.void : invalid(field, "must be non-empty", operation)

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

const invalidStateError = (
  current: string,
  attempted: string,
  operation: string
): TransactionalFileMutationError =>
  makeHostProtocolInvalidStateError(current, attempted, operation)

const mutationNotFoundError = (
  mutationId: string,
  operation: string
): TransactionalFileMutationError =>
  makeHostProtocolNotFoundError(`TransactionalFileMutation:${mutationId}`, operation)

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
