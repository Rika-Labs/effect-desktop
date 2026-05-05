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

    const snapshot = (): Effect.Effect<RegistrySnapshot, never, never> =>
      Effect.map(SubscriptionRef.get(entries), snapshotFromMap)

    const dispose = (id: ResourceId): Effect.Effect<void, never, never> =>
      Effect.gen(function* () {
        const entry = yield* SubscriptionRef.modify(entries, (current) => {
          const entry = current.get(id)
          if (entry === undefined) {
            return [undefined, current] as const
          }

          const next = new Map(current)
          next.delete(id)

          return [entry, next] as const
        })

        if (entry !== undefined) {
          disposedGenerations.set(id, {
            kind: entry.handle.kind,
            generation: entry.reusableId ? entry.handle.generation + 1 : -1,
            reusableId: entry.reusableId
          })
          yield* entry.dispose
        }
      })

    const register = <Kind extends ResourceKind, State extends ResourceState>(
      input: RegisterResourceInput<Kind, State>
    ): Effect.Effect<ResourceHandle<Kind, State>, never, never> =>
      Effect.gen(function* () {
        const createdAt = now()
        const id = input.id ?? nextId(createdAt)
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
          dispose: input.dispose ?? Effect.void
        }

        yield* SubscriptionRef.update(entries, (current) => {
          const next = new Map(current)
          next.set(id, stored)
          return next
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

    return {
      register,
      get: (id) =>
        Effect.map(SubscriptionRef.get(entries), (current) => publicEntryOption(current.get(id))),
      list: snapshot,
      dispose,
      observe: () => SubscriptionRef.changes(entries).pipe(Stream.map(snapshotFromMap)),
      assertFresh
    }
  })

export class ResourceRegistry extends Context.Service<ResourceRegistry, ResourceRegistryApi>()(
  "ResourceRegistry"
) {}

export const ResourceRegistryLive = Layer.effect(ResourceRegistry)(makeResourceRegistry())

interface StoredResourceEntry extends ResourceEntry {
  readonly reusableId: boolean
  readonly dispose: Effect.Effect<void, never, never>
}

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
    : 0
}

const publicEntry = (entry: StoredResourceEntry): ResourceEntry => ({
  handle: entry.handle,
  createdAt: entry.createdAt
})

const publicEntryOption = (entry: StoredResourceEntry | undefined): Option.Option<ResourceEntry> =>
  entry === undefined ? Option.none() : Option.some(publicEntry(entry))

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
