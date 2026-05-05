import { Context, Effect, Layer, Option, Schema, Stream, SubscriptionRef } from "effect"

export type ResourceId = string & { readonly ResourceId: unique symbol }
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
  readonly dispose: () => Effect.Effect<void, never, never>
}

export class ResourceHandleShape extends Schema.Class<ResourceHandleShape>("ResourceHandle")({
  kind: Schema.String,
  id: Schema.String,
  generation: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  ownerScope: Schema.String,
  state: Schema.String
}) {}

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

export interface ResourceRegistryApi {
  readonly register: <Kind extends ResourceKind, State extends ResourceState>(
    input: RegisterResourceInput<Kind, State>
  ) => Effect.Effect<ResourceHandle<Kind, State>, never, never>
  readonly get: (id: ResourceId) => Effect.Effect<Option.Option<ResourceEntry>, never, never>
  readonly list: () => Effect.Effect<RegistrySnapshot, never, never>
  readonly dispose: (id: ResourceId) => Effect.Effect<void, never, never>
  readonly observe: () => Stream.Stream<RegistrySnapshot, never, never>
  readonly declareScope: (scope: ScopeId, parent?: ScopeId) => Effect.Effect<void, never, never>
  readonly closeScope: (scope: ScopeId) => Effect.Effect<void, never, never>
  readonly share: <Kind extends ResourceKind, State extends ResourceState>(
    handle: ResourceHandle<Kind, State>,
    targetScope: ScopeId
  ) => Effect.Effect<ResourceHandle<Kind, State>, StaleHandle, never>
  readonly assertFresh: <Kind extends ResourceKind, State extends ResourceState>(
    handle: ResourceHandle<Kind, State>
  ) => Effect.Effect<ResourceEntry<Kind, State>, StaleHandle, never>
}

export interface ResourceRegistryOptions {
  readonly now?: () => number
  readonly nextId?: (now: number) => ResourceId
}

export const makeResourceRegistry = (
  options: ResourceRegistryOptions = {}
): Effect.Effect<ResourceRegistryApi, never, never> =>
  Effect.gen(function* () {
    const now = options.now ?? Date.now
    const nextId = options.nextId ?? generateUuidV7
    const entries = yield* SubscriptionRef.make(new Map<ResourceId, StoredResourceEntry>())
    const disposedGenerations = new Map<ResourceId, DisposedGeneration>()
    const scopeParents = new Map<ScopeId, ScopeId>()
    const cleanupGroups = new Map<ResourceId, CleanupGroup>()

    const snapshot = (): Effect.Effect<RegistrySnapshot, never, never> =>
      Effect.map(SubscriptionRef.get(entries), snapshotFromMap)

    const takeEntry = (
      id: ResourceId
    ): Effect.Effect<StoredResourceEntry | undefined, never, never> =>
      SubscriptionRef.modify(entries, (current) => {
        const entry = current.get(id)
        if (entry === undefined) {
          return [undefined, current] as const
        }

        const next = new Map(current)
        next.delete(id)

        return [entry, next] as const
      })

    const markDisposed = (id: ResourceId, entry: StoredResourceEntry): void => {
      disposedGenerations.set(id, {
        kind: entry.handle.kind,
        generation: entry.reusableId ? entry.handle.generation + 1 : -1,
        reusableId: entry.reusableId
      })
    }

    const dispose = (id: ResourceId): Effect.Effect<void, never, never> =>
      Effect.gen(function* () {
        const entry = yield* takeEntry(id)

        if (entry !== undefined) {
          markDisposed(id, entry)
          yield* releaseCleanup(entry.cleanupGroupId, cleanupGroups)
        }
      })

    const disposeForScopeClose = (entry: StoredResourceEntry): Effect.Effect<void, never, never> =>
      Effect.gen(function* () {
        const removed = yield* takeEntry(entry.handle.id)
        if (removed !== undefined) {
          markDisposed(entry.handle.id, removed)
          yield* Effect.asVoid(
            Effect.timeoutOption(
              releaseCleanup(removed.cleanupGroupId, cleanupGroups),
              `${removed.disposalGraceMs} millis`
            )
          )
        }
      })

    const register = <Kind extends ResourceKind, State extends ResourceState>(
      input: RegisterResourceInput<Kind, State>
    ): Effect.Effect<ResourceHandle<Kind, State>, never, never> => {
      return registerWithCleanupGroup(input, undefined, input.dispose ?? Effect.void)
    }

    const registerWithCleanupGroup = <Kind extends ResourceKind, State extends ResourceState>(
      input: RegisterResourceInput<Kind, State>,
      existingCleanupGroupId: ResourceId | undefined,
      cleanup: Effect.Effect<void, never, never>
    ): Effect.Effect<ResourceHandle<Kind, State>, never, never> =>
      Effect.gen(function* () {
        const createdAt = now()
        const handle = yield* SubscriptionRef.modify(entries, (current) => {
          const id = availableRegistrationId(input.id, createdAt, nextId, current)
          const cleanupGroupId = existingCleanupGroupId ?? id
          if (existingCleanupGroupId === undefined) {
            cleanupGroups.set(cleanupGroupId, {
              remaining: 1,
              dispose: cleanup
            })
          }
          const generation = generationForRegistration(
            id,
            input.kind,
            input.reusableId,
            disposedGenerations
          )
          const handle: ResourceHandle<Kind, State> = {
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
            cleanupGroupId
          }
          const next = new Map(current)
          next.set(id, stored)
          return [handle, next] as const
        })

        return handle
      })

    const assertFresh = <Kind extends ResourceKind, State extends ResourceState>(
      handle: ResourceHandle<Kind, State>
    ): Effect.Effect<ResourceEntry<Kind, State>, StaleHandle, never> =>
      Effect.flatMap(SubscriptionRef.get(entries), (current) => {
        const entry = current.get(handle.id)
        if (
          entry !== undefined &&
          entry.handle.kind === handle.kind &&
          entry.handle.generation === handle.generation
        ) {
          return Effect.succeed(publicEntry(entry) as ResourceEntry<Kind, State>)
        }

        const disposed = disposedGenerations.get(handle.id)
        return Effect.fail(
          new StaleHandle({
            tag: "StaleHandle",
            kind: handle.kind,
            id: handle.id,
            expectedGeneration: handle.generation,
            actualGeneration: disposed?.generation ?? entry?.handle.generation ?? -1
          })
        )
      })

    const declareScope = (scope: ScopeId, parent?: ScopeId): Effect.Effect<void, never, never> =>
      Effect.sync(() => {
        if (parent === undefined) {
          scopeParents.delete(scope)
        } else {
          scopeParents.set(scope, parent)
        }
      })

    const closeScope = (scope: ScopeId): Effect.Effect<void, never, never> =>
      Effect.gen(function* () {
        const current = yield* SubscriptionRef.get(entries)
        const scopes = descendantScopes(scope, scopeParents)
        const entriesToDispose = entriesInDependencyOrder(current, scopes, scopeParents)

        for (const entry of entriesToDispose) {
          yield* disposeForScopeClose(entry)
        }
      })

    const share = <Kind extends ResourceKind, State extends ResourceState>(
      handle: ResourceHandle<Kind, State>,
      targetScope: ScopeId
    ): Effect.Effect<ResourceHandle<Kind, State>, StaleHandle, never> =>
      Effect.gen(function* () {
        yield* assertFresh(handle)
        const current = yield* SubscriptionRef.get(entries)
        const stored = current.get(handle.id)
        if (stored === undefined) {
          return yield* Effect.fail(
            new StaleHandle({
              tag: "StaleHandle",
              kind: handle.kind,
              id: handle.id,
              expectedGeneration: handle.generation,
              actualGeneration: -1
            })
          )
        }
        incrementCleanup(stored.cleanupGroupId, cleanupGroups)

        return yield* registerWithCleanupGroup(
          {
            kind: handle.kind,
            ownerScope: targetScope,
            state: handle.state,
            reusableId: false
          },
          stored.cleanupGroupId,
          Effect.void
        )
      })

    return {
      register,
      get: (id) =>
        Effect.map(SubscriptionRef.get(entries), (current) => publicEntryOption(current.get(id))),
      list: snapshot,
      dispose,
      observe: () => SubscriptionRef.changes(entries).pipe(Stream.map(snapshotFromMap)),
      declareScope,
      closeScope,
      share,
      assertFresh
    }
  })

export class ResourceRegistry extends Context.Service<ResourceRegistry, ResourceRegistryApi>()(
  "ResourceRegistry"
) {}

export const ResourceRegistryLive = Layer.effect(ResourceRegistry)(makeResourceRegistry())

interface StoredResourceEntry extends ResourceEntry {
  readonly reusableId: boolean
  readonly disposalGraceMs: number
  readonly cleanupGroupId: ResourceId
}

interface CleanupGroup {
  remaining: number
  readonly dispose: Effect.Effect<void, never, never>
}

const DEFAULT_DISPOSAL_GRACE_MS = 5_000

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

const nextGenerationAfter = (generation: number): number => {
  return generation < 0 ? 1 : generation + 1
}

const incrementCleanup = (
  cleanupGroupId: ResourceId,
  cleanupGroups: Map<ResourceId, CleanupGroup>
): void => {
  const group = cleanupGroups.get(cleanupGroupId)
  if (group !== undefined) {
    group.remaining += 1
  }
}

const releaseCleanup = (
  cleanupGroupId: ResourceId,
  cleanupGroups: Map<ResourceId, CleanupGroup>
): Effect.Effect<void, never, never> => {
  const group = cleanupGroups.get(cleanupGroupId)
  if (group === undefined) {
    return Effect.void
  }

  group.remaining -= 1
  if (group.remaining > 0) {
    return Effect.void
  }

  cleanupGroups.delete(cleanupGroupId)
  return group.dispose
}

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
  return current.has(candidate) ? generateUuidV7(createdAt) : candidate
}

const publicEntry = (entry: StoredResourceEntry): ResourceEntry => ({
  handle: entry.handle,
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
): readonly StoredResourceEntry[] => {
  return Array.from(entries.values())
    .filter((entry) => scopes.has(entry.handle.ownerScope))
    .sort((left, right) => {
      const depthDifference =
        scopeDepth(right.handle.ownerScope, scopeParents) -
        scopeDepth(left.handle.ownerScope, scopeParents)

      return depthDifference === 0 ? right.createdAt - left.createdAt : depthDifference
    })
}

const scopeDepth = (scope: ScopeId, scopeParents: ReadonlyMap<ScopeId, ScopeId>): number => {
  let depth = 0
  let current: ScopeId | undefined = scope

  while (current !== undefined) {
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
): RegistrySnapshot => {
  return {
    entries: Array.from(entries.values()).map((entry) => ({
      handle: entry.handle,
      createdAt: entry.createdAt
    }))
  }
}

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
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20
  )}-${hex.slice(20)}` as ResourceId
}
