import {
  Clock,
  Context,
  Data,
  Effect,
  Exit,
  Layer,
  Option,
  PubSub,
  RcMap,
  Schema,
  Semaphore,
  Scope,
  Stream,
  SubscriptionRef
} from "effect"

export const ResourceIdSchema = Schema.NonEmptyString.pipe(Schema.brand("ResourceId"))
export type ResourceId = Schema.Schema.Type<typeof ResourceIdSchema>
const decodeResourceIdSync = Schema.decodeUnknownSync(ResourceIdSchema)
export const makeResourceId = (value: string): ResourceId => decodeResourceIdSync(value)
export type ResourceKind = string
export type ResourceState = string
export type ScopeId = string

export interface ResourceHandle<
  Kind extends ResourceKind = ResourceKind,
  State extends ResourceState = ResourceState
> {
  readonly kind: Kind
  readonly id: ResourceId
  readonly generation: number
  readonly ownerScope: ScopeId
  readonly state: State
}

export interface ManagedResourceHandle<
  Kind extends ResourceKind = ResourceKind,
  State extends ResourceState = ResourceState
> extends ResourceHandle<Kind, State> {
  readonly dispose: () => Effect.Effect<void, never, never>
}

export class ResourceHandleShape extends Schema.Class<ResourceHandleShape>("ResourceHandle")({
  kind: Schema.NonEmptyString,
  id: ResourceIdSchema,
  generation: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  ownerScope: Schema.NonEmptyString,
  state: Schema.NonEmptyString
}) {}

export const ResourceHandleSchema = <Kind extends string, State extends string>(
  kind: Kind,
  state: State
) =>
  Schema.Struct({
    kind: Schema.Literal(kind),
    id: ResourceIdSchema,
    generation: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    ownerScope: Schema.NonEmptyString,
    state: Schema.Literal(state)
  })

export interface ResourceEntry<
  Kind extends ResourceKind = ResourceKind,
  State extends ResourceState = ResourceState
> {
  readonly handle: ResourceHandle<Kind, State>
  readonly createdAt: number
}

export interface RegistrySnapshot {
  readonly entries: readonly ResourceEntry[]
}

export type ResourceLifecycleEvent =
  | {
      readonly _tag: "ResourceRegistered"
      readonly entry: ResourceEntry
    }
  | {
      readonly _tag: "ResourceShared"
      readonly source: ResourceHandle
      readonly entry: ResourceEntry
    }
  | {
      readonly _tag: "ResourceDisposed"
      readonly handle: ResourceHandle
    }
  | {
      readonly _tag: "ResourceStale"
      readonly handle: ResourceHandle
      readonly actualGeneration: number
    }
  | {
      readonly _tag: "ScopeDeclared"
      readonly scope: ScopeId
      readonly parent: Option.Option<ScopeId>
    }
  | {
      readonly _tag: "ScopeClosing"
      readonly scope: ScopeId
      readonly descendants: readonly ScopeId[]
      readonly resources: readonly ResourceHandle[]
    }
  | {
      readonly _tag: "ScopeClosed"
      readonly scope: ScopeId
    }

export interface RegisterResourceInput<
  Kind extends ResourceKind = ResourceKind,
  State extends ResourceState = ResourceState
> {
  readonly kind: Kind
  readonly id?: ResourceId
  readonly ownerScope: ScopeId
  readonly state: State
  readonly reusableId?: boolean
  readonly disposalGraceMs?: number
  readonly dispose?: Effect.Effect<void, never, never>
}

export class StaleHandle extends Schema.Class<StaleHandle>("StaleHandle")({
  tag: Schema.Literal("StaleHandle"),
  kind: Schema.String,
  id: Schema.String,
  expectedGeneration: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  actualGeneration: Schema.Int
}) {
  get _tag(): "StaleHandle" {
    return this.tag
  }
}

export class ResourceInvalidArgumentError extends Data.TaggedError("InvalidArgument")<{
  readonly operation: string
  readonly field: string
  readonly message: string
}> {}

export interface ResourceRegistryApi {
  readonly register: <Kind extends ResourceKind, State extends ResourceState>(
    input: RegisterResourceInput<Kind, State>
  ) => Effect.Effect<ManagedResourceHandle<Kind, State>, ResourceInvalidArgumentError, never>
  readonly get: (id: ResourceId) => Effect.Effect<Option.Option<ResourceEntry>, never, never>
  readonly list: () => Effect.Effect<RegistrySnapshot, never, never>
  readonly dispose: (id: ResourceId) => Effect.Effect<void, never, never>
  readonly observe: () => Stream.Stream<RegistrySnapshot, never, never>
  readonly observeLifecycle: () => Stream.Stream<ResourceLifecycleEvent, never, never>
  readonly declareScope: (
    scope: ScopeId,
    parent?: ScopeId
  ) => Effect.Effect<void, ResourceInvalidArgumentError, never>
  readonly closeScope: (scope: ScopeId) => Effect.Effect<void, never, never>
  readonly share: <Kind extends ResourceKind, State extends ResourceState>(
    handle: ResourceHandle<Kind, State>,
    targetScope: ScopeId
  ) => Effect.Effect<
    ManagedResourceHandle<Kind, State>,
    ResourceInvalidArgumentError | StaleHandle,
    never
  >
  readonly assertFresh: <Kind extends ResourceKind, State extends ResourceState>(
    handle: ResourceHandle<Kind, State>
  ) => Effect.Effect<ResourceEntry<Kind, State>, StaleHandle, never>
  readonly close: () => Effect.Effect<void, never, never>
}

export interface ResourceRegistryOptions {
  readonly now?: () => number
  readonly nextId?: (now: number) => ResourceId
}

interface ResourceRegistryInstance {
  readonly api: ResourceRegistryApi
  readonly close: Effect.Effect<void, never, never>
}

const makeResourceRegistryInstance = (
  options: ResourceRegistryOptions = {}
): Effect.Effect<ResourceRegistryInstance, never, never> =>
  Effect.gen(function* () {
    const clock = yield* Clock.Clock
    const now = options.now ?? (() => clock.currentTimeMillisUnsafe())
    const nextId = options.nextId ?? generateUuidV7
    const entries = yield* SubscriptionRef.make(new Map<ResourceId, StoredResourceEntry>())
    const events = yield* PubSub.unbounded<ResourceLifecycleEvent>()
    const disposedGenerations = new Map<ResourceId, DisposedGeneration>()
    const scopeParents = new Map<ScopeId, ScopeId>()
    const registryScope = yield* Scope.make()
    const lifecycle = yield* Semaphore.make(1)
    const cleanupPlans = new Map<ResourceId, CleanupPlan>()
    const cleanupResources = yield* RcMap.make<ResourceId, ResourceId, never, Scope.Scope>({
      lookup: (cleanupGroupId) =>
        Effect.acquireRelease(Effect.succeed(cleanupGroupId), finalizeCleanup(cleanupPlans))
    }).pipe(Scope.provide(registryScope))

    const snapshot = (): Effect.Effect<RegistrySnapshot, never, never> =>
      Effect.map(SubscriptionRef.get(entries), snapshotFromMap)

    const takeEntry = (
      id: ResourceId
    ): Effect.Effect<StoredResourceEntry | undefined, never, never> =>
      SubscriptionRef.modify(entries, (current) => {
        const entry = current.get(id)
        if (entry === undefined || entry.disposing) {
          return [undefined, current] as const
        }

        const next = new Map(current)
        next.set(id, { ...entry, disposing: true })

        return [entry, next] as const
      })

    const clearEntry = (id: ResourceId): Effect.Effect<void, never, never> =>
      SubscriptionRef.update(entries, (current) => {
        const next = new Map(current)
        next.delete(id)
        return next
      })

    const awaitRemoval = (id: ResourceId): Effect.Effect<void, never, never> =>
      Effect.gen(function* () {
        const current = yield* SubscriptionRef.get(entries)
        if (!current.has(id)) {
          return
        }

        yield* SubscriptionRef.changes(entries).pipe(
          Stream.filter((snapshot) => !snapshot.has(id)),
          Stream.take(1),
          Stream.runDrain
        )
      })

    const reportDisposalFailure = (
      context: CleanupFailureContext,
      reason: unknown
    ): Effect.Effect<void, never, never> =>
      Effect.logWarning("ResourceRegistry.cleanup failed", {
        id: context.id,
        kind: context.kind,
        scope: context.ownerScope,
        reason: String(reason)
      }).pipe(Effect.ignore)

    const disposeEntry = (entry: StoredResourceEntry): Effect.Effect<void, never, never> =>
      Effect.gen(function* () {
        const result = yield* Effect.exit(Scope.close(entry.handleScope, Exit.void))
        if (Exit.isFailure(result)) {
          yield* reportDisposalFailure(cleanupFailureContext(entry), result.cause)
        }

        yield* clearEntry(entry.handle.id)
        yield* publishEvent(events, {
          _tag: "ResourceDisposed",
          handle: publicHandle(entry.handle)
        })
      }).pipe(
        Effect.tapError((cause) => reportDisposalFailure(cleanupFailureContext(entry), cause)),
        Effect.tapDefect((cause) => reportDisposalFailure(cleanupFailureContext(entry), cause)),
        Effect.ignoreCause
      )

    const markDisposed = (id: ResourceId, entry: StoredResourceEntry): void => {
      disposedGenerations.set(id, {
        kind: entry.handle.kind,
        generation: entry.reusableId ? entry.handle.generation + 1 : -1,
        reusableId: entry.reusableId
      })
    }

    const dispose = (id: ResourceId): Effect.Effect<void, never, never> =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const entry = yield* Semaphore.withPermit(
            lifecycle,
            Effect.gen(function* () {
              const taken = yield* takeEntry(id)
              if (taken !== undefined) {
                markDisposed(id, taken)
              }

              return taken
            })
          )

          if (entry !== undefined) {
            yield* disposeEntry(entry)
          }

          yield* awaitRemoval(id)
        })
      )

    const disposeForScopeClose = (entry: StoredResourceEntry): Effect.Effect<void, never, never> =>
      Effect.gen(function* () {
        const removed = yield* takeEntry(entry.handle.id)
        if (removed !== undefined) {
          markDisposed(entry.handle.id, removed)
          yield* disposeEntry(removed)
        }
      })

    const register = <Kind extends ResourceKind, State extends ResourceState>(
      input: RegisterResourceInput<Kind, State>
    ): Effect.Effect<ManagedResourceHandle<Kind, State>, ResourceInvalidArgumentError, never> =>
      Effect.gen(function* () {
        const kind = (yield* validateIdentity(
          input.kind,
          "kind",
          "ResourceRegistry.register"
        )) as Kind
        const ownerScope = yield* validateIdentity(
          input.ownerScope,
          "ownerScope",
          "ResourceRegistry.register"
        )
        const state = (yield* validateIdentity(
          input.state,
          "state",
          "ResourceRegistry.register"
        )) as State
        const createdAt = yield* validateTimestamp(now(), "ResourceRegistry.register")
        return yield* Semaphore.withPermit(
          lifecycle,
          registerWithCleanupGroup(
            { ...input, kind, ownerScope, state },
            undefined,
            input.dispose ?? Effect.void,
            createdAt
          )
        )
      })

    const registerWithCleanupGroup = <Kind extends ResourceKind, State extends ResourceState>(
      input: RegisterResourceInput<Kind, State>,
      existingCleanupGroupId: ResourceId | undefined,
      cleanup: Effect.Effect<void, never, never>,
      createdAt: number
    ): Effect.Effect<ManagedResourceHandle<Kind, State>, never, never> =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const handleScope = yield* Scope.make()
          const allocation = yield* SubscriptionRef.modify(entries, (current) => {
            const id = availableRegistrationId(input.id, createdAt, nextId, current)
            const cleanupGroupId = existingCleanupGroupId ?? id
            const generation = generationForRegistration(
              id,
              input.kind,
              input.reusableId,
              disposedGenerations
            )
            const handle: ManagedResourceHandle<Kind, State> = {
              kind: input.kind,
              id,
              generation,
              ownerScope: input.ownerScope,
              state: input.state,
              dispose: () => dispose(id)
            }
            const stored: StoredResourceEntry = {
              handle,
              createdAt,
              reusableId: input.reusableId === true,
              disposalGraceMs: input.disposalGraceMs ?? DEFAULT_DISPOSAL_GRACE_MS,
              cleanupGroupId,
              handleScope,
              disposing: false
            }
            const cleanupPlan =
              existingCleanupGroupId === undefined
                ? {
                    id: cleanupGroupId,
                    kind: input.kind,
                    ownerScope: input.ownerScope,
                    disposalGraceMs: input.disposalGraceMs ?? DEFAULT_DISPOSAL_GRACE_MS,
                    dispose: cleanup
                  }
                : undefined
            const next = new Map(current)
            next.set(id, stored)
            return [{ cleanupGroupId, cleanupPlan, handle }, next] as const
          })

          if (allocation.cleanupPlan !== undefined) {
            cleanupPlans.set(allocation.cleanupGroupId, allocation.cleanupPlan)
          }

          yield* RcMap.get(cleanupResources, allocation.cleanupGroupId).pipe(
            Scope.provide(handleScope)
          )
          yield* publishEvent(events, {
            _tag: "ResourceRegistered",
            entry: {
              handle: publicHandle(allocation.handle),
              createdAt
            }
          })

          return allocation.handle
        })
      )

    const assertFresh = <Kind extends ResourceKind, State extends ResourceState>(
      handle: ResourceHandle<Kind, State>
    ): Effect.Effect<ResourceEntry<Kind, State>, StaleHandle, never> =>
      Effect.flatMap(SubscriptionRef.get(entries), (current) => {
        const entry = current.get(handle.id)
        if (
          entry !== undefined &&
          entry.handle.kind === handle.kind &&
          entry.handle.state === handle.state &&
          entry.handle.generation === handle.generation &&
          !entry.disposing
        ) {
          return Effect.succeed(publicEntry(entry) as ResourceEntry<Kind, State>)
        }

        const disposed = disposedGenerations.get(handle.id)
        const actualGeneration = disposed?.generation ?? entry?.handle.generation ?? -1
        return publishEvent(events, {
          _tag: "ResourceStale",
          handle: publicHandle(handle),
          actualGeneration
        }).pipe(
          Effect.andThen(
            Effect.fail(
              new StaleHandle({
                tag: "StaleHandle",
                kind: handle.kind,
                id: handle.id,
                expectedGeneration: handle.generation,
                actualGeneration
              })
            )
          )
        )
      })

    const declareScope = (
      scope: ScopeId,
      parent?: ScopeId
    ): Effect.Effect<void, ResourceInvalidArgumentError, never> =>
      Effect.gen(function* () {
        const validScope = yield* validateIdentity(scope, "scope", "ResourceRegistry.declareScope")
        const validParent =
          parent === undefined
            ? undefined
            : yield* validateIdentity(parent, "parent", "ResourceRegistry.declareScope")

        if (validParent === undefined) {
          yield* Semaphore.withPermit(
            lifecycle,
            Effect.sync(() => {
              scopeParents.delete(validScope)
            })
          )
          yield* publishEvent(events, {
            _tag: "ScopeDeclared",
            scope: validScope,
            parent: Option.none()
          })
        } else {
          yield* Semaphore.withPermit(
            lifecycle,
            Effect.sync(() => {
              scopeParents.set(validScope, validParent)
            })
          )
          yield* publishEvent(events, {
            _tag: "ScopeDeclared",
            scope: validScope,
            parent: Option.some(validParent)
          })
        }
      })

    const closeScope = (scope: ScopeId): Effect.Effect<void, never, never> =>
      Semaphore.withPermit(
        lifecycle,
        Effect.uninterruptible(
          Effect.gen(function* () {
            const current = yield* SubscriptionRef.get(entries)
            const scopes = descendantScopes(scope, scopeParents)
            const entriesToDispose = entriesInDependencyOrder(current, scopes, scopeParents)
            yield* publishEvent(events, {
              _tag: "ScopeClosing",
              scope,
              descendants: Array.from(scopes),
              resources: entriesToDispose.map((entry) => publicHandle(entry.handle))
            })

            for (const entry of entriesToDispose) {
              yield* disposeForScopeClose(entry).pipe(
                Effect.tapError((cause) =>
                  reportDisposalFailure(cleanupFailureContext(entry), {
                    phase: "closeScope",
                    scope,
                    cause
                  })
                ),
                Effect.tapDefect((cause) =>
                  reportDisposalFailure(cleanupFailureContext(entry), {
                    phase: "closeScope",
                    scope,
                    cause
                  })
                ),
                Effect.ignoreCause
              )
            }
            yield* publishEvent(events, {
              _tag: "ScopeClosed",
              scope
            })
          })
        )
      )

    const share = <Kind extends ResourceKind, State extends ResourceState>(
      handle: ResourceHandle<Kind, State>,
      targetScope: ScopeId
    ): Effect.Effect<
      ManagedResourceHandle<Kind, State>,
      ResourceInvalidArgumentError | StaleHandle,
      never
    > =>
      Effect.gen(function* () {
        const validTargetScope = yield* validateIdentity(
          targetScope,
          "targetScope",
          "ResourceRegistry.share"
        )
        const createdAt = yield* validateTimestamp(now(), "ResourceRegistry.share")
        return yield* Semaphore.withPermit(
          lifecycle,
          Effect.uninterruptible(
            Effect.gen(function* () {
              const handleScope = yield* Scope.make()
              type ShareResult =
                | { readonly _tag: "stale"; readonly stale: StaleHandle }
                | {
                    readonly _tag: "shared"
                    readonly cleanupGroupId: ResourceId
                    readonly handle: ManagedResourceHandle<Kind, State>
                  }
              const result = yield* SubscriptionRef.modify(
                entries,
                (current): readonly [ShareResult, Map<ResourceId, StoredResourceEntry>] => {
                  const stored = current.get(handle.id)
                  if (
                    stored === undefined ||
                    stored.handle.kind !== handle.kind ||
                    stored.handle.state !== handle.state ||
                    stored.handle.generation !== handle.generation ||
                    stored.disposing
                  ) {
                    const stale = new StaleHandle({
                      tag: "StaleHandle",
                      kind: handle.kind,
                      id: handle.id,
                      expectedGeneration: handle.generation,
                      actualGeneration:
                        disposedGenerations.get(handle.id)?.generation ??
                        stored?.handle.generation ??
                        -1
                    })
                    return [{ _tag: "stale" as const, stale }, current] as const
                  }

                  const id = availableRegistrationId(undefined, createdAt, nextId, current)
                  const generation = generationForRegistration(
                    id,
                    stored.handle.kind,
                    false,
                    disposedGenerations
                  )
                  const cleanupGroupId = stored.cleanupGroupId
                  const sharedHandle: ManagedResourceHandle<Kind, State> = {
                    kind: stored.handle.kind as Kind,
                    id,
                    generation,
                    ownerScope: validTargetScope,
                    state: stored.handle.state as State,
                    dispose: () => dispose(id)
                  }
                  const next = new Map(current)
                  next.set(id, {
                    handle: sharedHandle,
                    createdAt,
                    reusableId: false,
                    disposalGraceMs: DEFAULT_DISPOSAL_GRACE_MS,
                    cleanupGroupId,
                    handleScope,
                    disposing: false
                  })
                  return [
                    { _tag: "shared" as const, cleanupGroupId, handle: sharedHandle },
                    next
                  ] as const
                }
              )

              if (result._tag === "stale") {
                yield* Scope.close(handleScope, Exit.void)
                return yield* Effect.fail(result.stale)
              }

              yield* RcMap.get(cleanupResources, result.cleanupGroupId).pipe(
                Scope.provide(handleScope)
              )
              yield* publishEvent(events, {
                _tag: "ResourceShared",
                source: publicHandle(handle),
                entry: {
                  handle: publicHandle(result.handle),
                  createdAt
                }
              })

              return result.handle
            })
          )
        )
      })

    const close = Semaphore.withPermit(
      lifecycle,
      Effect.uninterruptible(
        Effect.gen(function* () {
          const current = yield* SubscriptionRef.get(entries)
          const scopes = new Set(Array.from(current.values(), (entry) => entry.handle.ownerScope))
          const entriesToDispose = entriesInDependencyOrder(current, scopes, scopeParents)

          for (const entry of entriesToDispose) {
            yield* disposeForScopeClose(entry)
          }

          yield* Scope.close(registryScope, Exit.void)
        })
      )
    )

    return {
      api: {
        register,
        get: (id) =>
          Effect.map(SubscriptionRef.get(entries), (current) => publicEntryOption(current.get(id))),
        list: snapshot,
        dispose,
        observe: () => SubscriptionRef.changes(entries).pipe(Stream.map(snapshotFromMap)),
        observeLifecycle: () => Stream.fromPubSub(events),
        declareScope,
        closeScope,
        share,
        assertFresh,
        close: () => close
      },
      close
    }
  })

export const makeResourceRegistry = (
  options: ResourceRegistryOptions = {}
): Effect.Effect<ResourceRegistryApi, never, never> =>
  Effect.map(makeResourceRegistryInstance(options), (instance) => instance.api)

export class ResourceRegistry extends Context.Service<ResourceRegistry, ResourceRegistryApi>()(
  "@orika/core/runtime/resources/ResourceRegistry"
) {}

export const ResourceRegistryLive = Layer.effect(ResourceRegistry)(
  Effect.acquireRelease(makeResourceRegistryInstance(), (instance) => instance.close).pipe(
    Effect.map((instance) => instance.api)
  )
)

interface StoredResourceEntry extends ResourceEntry {
  readonly handle: ManagedResourceHandle
  readonly reusableId: boolean
  readonly disposalGraceMs: number
  readonly cleanupGroupId: ResourceId
  readonly handleScope: Scope.Closeable
  readonly disposing: boolean
}

interface CleanupPlan extends CleanupFailureContext {
  readonly disposalGraceMs: number
  readonly dispose: Effect.Effect<void, never, never>
}

interface CleanupFailureContext {
  readonly id: ResourceId
  readonly kind: ResourceKind
  readonly ownerScope: ScopeId
}

const DEFAULT_DISPOSAL_GRACE_MS = 5_000

const publishEvent = (
  events: PubSub.PubSub<ResourceLifecycleEvent>,
  event: ResourceLifecycleEvent
): Effect.Effect<void, never, never> => PubSub.publish(events, event).pipe(Effect.asVoid)

const finalizeCleanup =
  (cleanupPlans: Map<ResourceId, CleanupPlan>) =>
  (cleanupGroupId: ResourceId): Effect.Effect<void, never, never> =>
    Effect.gen(function* () {
      const plan = cleanupPlans.get(cleanupGroupId)
      if (plan === undefined) {
        yield* Effect.logWarning("ResourceRegistry.cleanup plan missing", {
          id: cleanupGroupId
        }).pipe(Effect.ignore)
        return
      }

      const result = yield* Effect.exit(
        Effect.timeoutOption(plan.dispose, `${plan.disposalGraceMs} millis`)
      )
      if (Exit.isFailure(result)) {
        yield* Effect.logWarning("ResourceRegistry.cleanup failed", {
          id: plan.id,
          kind: plan.kind,
          scope: plan.ownerScope,
          reason: String(result.cause)
        }).pipe(Effect.ignore)
      } else if (Option.isNone(result.value)) {
        yield* Effect.logWarning("ResourceRegistry.cleanup timed out", {
          id: plan.id,
          kind: plan.kind,
          scope: plan.ownerScope,
          timeout: `${plan.disposalGraceMs} millis`
        }).pipe(Effect.ignore)
      }

      cleanupPlans.delete(cleanupGroupId)
    }).pipe(
      Effect.catchDefect((cause) => {
        const plan = cleanupPlans.get(cleanupGroupId)
        cleanupPlans.delete(cleanupGroupId)
        return Effect.logWarning("ResourceRegistry.cleanup failed", {
          id: plan?.id ?? cleanupGroupId,
          kind: plan?.kind ?? "unknown",
          scope: plan?.ownerScope ?? "unknown",
          reason: String(cause)
        }).pipe(Effect.ignore)
      })
    )

const cleanupFailureContext = (entry: StoredResourceEntry): CleanupFailureContext => ({
  id: entry.handle.id,
  kind: entry.handle.kind,
  ownerScope: entry.handle.ownerScope
})

interface DisposedGeneration {
  readonly kind: ResourceKind
  readonly generation: number
  readonly reusableId: boolean
}

const generationForRegistration = (
  id: ResourceId,
  kind: ResourceKind,
  reusableId: boolean | undefined,
  disposedGenerations: ReadonlyMap<ResourceId, DisposedGeneration>
): number => {
  const disposed = disposedGenerations.get(id)
  if (disposed === undefined) {
    return 0
  }

  return reusableId === true && disposed.reusableId && disposed.kind === kind
    ? disposed.generation
    : nextGenerationAfter(disposed.generation)
}

const nextGenerationAfter = (generation: number): number => (generation < 0 ? 1 : generation + 1)

const availableRegistrationId = (
  requestedId: ResourceId | undefined,
  createdAt: number,
  nextId: (now: number) => ResourceId,
  current: ReadonlyMap<ResourceId, StoredResourceEntry>
): ResourceId => {
  if (requestedId !== undefined && !current.has(requestedId)) {
    return requestedId
  }

  const candidate = nextId(createdAt)
  if (!current.has(candidate)) {
    return candidate
  }

  let attempt = 0
  while (true) {
    const fallback = generateUuidV7(createdAt + attempt)
    if (!current.has(fallback)) {
      return fallback
    }
    attempt += 1
  }
}

const validateTimestamp = (
  timestamp: number,
  operation: string
): Effect.Effect<number, ResourceInvalidArgumentError, never> =>
  Number.isInteger(timestamp) && timestamp >= 0
    ? Effect.succeed(timestamp)
    : Effect.fail(
        new ResourceInvalidArgumentError({
          operation,
          field: "createdAt",
          message: "must be a finite non-negative integer"
        })
      )

const validateIdentity = (
  value: string,
  field: string,
  operation: string
): Effect.Effect<string, ResourceInvalidArgumentError, never> =>
  value.trim().length > 0
    ? Effect.succeed(value)
    : Effect.fail(
        new ResourceInvalidArgumentError({
          operation,
          field,
          message: "must be a non-empty string"
        })
      )

const publicHandle = (handle: ResourceHandle): ResourceHandle => ({
  kind: handle.kind,
  id: handle.id,
  generation: handle.generation,
  ownerScope: handle.ownerScope,
  state: handle.state
})

const publicEntry = (entry: StoredResourceEntry): ResourceEntry => ({
  handle: publicHandle(entry.handle),
  createdAt: entry.createdAt
})

const publicEntryOption = (entry: StoredResourceEntry | undefined): Option.Option<ResourceEntry> =>
  entry === undefined ? Option.none() : Option.some(publicEntry(entry))

const descendantScopes = (
  root: ScopeId,
  scopeParents: ReadonlyMap<ScopeId, ScopeId>
): ReadonlySet<ScopeId> => {
  const result = new Set<ScopeId>([root])
  let changed = true

  while (changed) {
    changed = false
    for (const [scope, parent] of scopeParents) {
      if (!result.has(scope) && result.has(parent)) {
        result.add(scope)
        changed = true
      }
    }
  }

  return result
}

const entriesInDependencyOrder = (
  entries: ReadonlyMap<ResourceId, StoredResourceEntry>,
  scopes: ReadonlySet<ScopeId>,
  scopeParents: ReadonlyMap<ScopeId, ScopeId>
): readonly StoredResourceEntry[] =>
  Array.from(entries.values())
    .filter((entry) => scopes.has(entry.handle.ownerScope))
    .sort((left, right) => {
      const depthDifference =
        scopeDepth(right.handle.ownerScope, scopeParents) -
        scopeDepth(left.handle.ownerScope, scopeParents)
      return depthDifference === 0 ? right.createdAt - left.createdAt : depthDifference
    })

const scopeDepth = (scope: ScopeId, scopeParents: ReadonlyMap<ScopeId, ScopeId>): number => {
  let depth = 0
  let current: ScopeId | undefined = scope
  const visited = new Set<ScopeId>()

  while (current !== undefined) {
    if (visited.has(current)) {
      return depth
    }
    visited.add(current)

    const parent = scopeParents.get(current)
    if (parent === undefined) {
      return depth
    }
    depth += 1
    current = parent
  }

  return depth
}

const snapshotFromMap = (
  entries: ReadonlyMap<ResourceId, StoredResourceEntry>
): RegistrySnapshot => ({
  entries: Array.from(entries.values()).map(publicEntry)
})

const byteAt = (bytes: Uint8Array, index: number): number => {
  const value = bytes[index]
  if (value === undefined) {
    throw new RangeError(`missing UUID random byte at index ${index}`)
  }
  return value
}

const applyRandomUuidBits = (bytes: Uint8Array, random: Uint8Array): void => {
  bytes[6] = 0x70 | (byteAt(random, 0) & 0x0f)
  bytes[7] = byteAt(random, 1)
  bytes[8] = 0x80 | (byteAt(random, 2) & 0x3f)
  bytes[9] = byteAt(random, 3)
  bytes[10] = byteAt(random, 4)
  bytes[11] = byteAt(random, 5)
  bytes[12] = byteAt(random, 6)
  bytes[13] = byteAt(random, 7)
  bytes[14] = byteAt(random, 8)
  bytes[15] = byteAt(random, 9)
}

const writeTimestamp = (bytes: Uint8Array, timestamp: number): void => {
  bytes[0] = Math.floor(timestamp / 0x10000000000) & 0xff
  bytes[1] = Math.floor(timestamp / 0x100000000) & 0xff
  bytes[2] = Math.floor(timestamp / 0x1000000) & 0xff
  bytes[3] = Math.floor(timestamp / 0x10000) & 0xff
  bytes[4] = Math.floor(timestamp / 0x100) & 0xff
  bytes[5] = timestamp & 0xff
}

export const generateUuidV7 = (now: number): ResourceId => {
  const bytes = new Uint8Array(16)
  writeTimestamp(bytes, Math.floor(now))

  const random = new Uint8Array(10)
  globalThis.crypto.getRandomValues(random)
  applyRandomUuidBits(bytes, random)

  return formatUuid(bytes)
}

const formatUuid = (bytes: Uint8Array): ResourceId => {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
  return makeResourceId(
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
      16,
      20
    )}-${hex.slice(20)}`
  )
}
