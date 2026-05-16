import { Effect, Option, Schema, Stream, SubscriptionRef } from "effect"

import { HostProtocolStreamByRequestEnvelope } from "./protocol.js"
import type { BackpressureSpec } from "./contracts.js"

export type HostProtocolStreamEnvelope = HostProtocolStreamByRequestEnvelope

export class BridgeStreamDataFrame extends Schema.Class<BridgeStreamDataFrame>(
  "BridgeStreamDataFrame"
)({
  type: Schema.Literal("data"),
  chunk: Schema.Unknown
}) {}

export class BridgeStreamErrorFrame extends Schema.Class<BridgeStreamErrorFrame>(
  "BridgeStreamErrorFrame"
)({
  type: Schema.Literal("error"),
  error: Schema.Unknown
}) {}

export class BridgeStreamCompleteFrame extends Schema.Class<BridgeStreamCompleteFrame>(
  "BridgeStreamCompleteFrame"
)({
  type: Schema.Literal("complete")
}) {}

export class BridgeStreamClosedFrame extends Schema.Class<BridgeStreamClosedFrame>(
  "BridgeStreamClosedFrame"
)({
  type: Schema.Literal("closed")
}) {}

export const BridgeStreamFrame = Schema.Union([
  BridgeStreamDataFrame,
  BridgeStreamErrorFrame,
  BridgeStreamCompleteFrame,
  BridgeStreamClosedFrame
])

export type BridgeStreamFrame = typeof BridgeStreamFrame.Type

type BridgeStreamRegistryState = {
  readonly entries: ReadonlyMap<string, BridgeStreamRegistryEntry>
  readonly generations: ReadonlyMap<string, number>
}

export type BridgeStreamTerminalType = "complete" | "error" | "closed"

export interface BridgeStreamRegistryEntry {
  readonly streamId: string
  readonly generation: number
  readonly state: "open" | "terminal"
  readonly terminal?: BridgeStreamTerminalType
  readonly terminalAt?: number
  readonly backpressure?: BridgeStreamBackpressureMetrics
}

export interface BridgeStreamBackpressureMetrics {
  readonly evictedFrames: number
  readonly overflow: NonNullable<BackpressureSpec["overflow"]>
  readonly queueCapacity: number
  readonly queueDepth: number
}

export interface BridgeStreamRegistry {
  readonly register: (streamId: string) => Effect.Effect<BridgeStreamRegistryEntry, never, never>
  readonly terminate: (
    streamId: string,
    terminal: BridgeStreamTerminalType,
    now: number
  ) => Effect.Effect<boolean, never, never>
  readonly isTerminal: (streamId: string) => Effect.Effect<boolean, never, never>
  readonly gcExpired: (now: number) => Effect.Effect<number, never, never>
  readonly updateBackpressure: (
    streamId: string,
    metrics: BridgeStreamBackpressureMetrics
  ) => Effect.Effect<void, never, never>
  readonly snapshot: () => Effect.Effect<ReadonlyArray<BridgeStreamRegistryEntry>, never, never>
  readonly observe: () => Stream.Stream<ReadonlyArray<BridgeStreamRegistryEntry>, never, never>
}

export const makeBridgeStreamRegistry = (
  cleanupGraceMs = 30_000
): Effect.Effect<BridgeStreamRegistry, never, never> =>
  Effect.gen(function* () {
    const state = yield* SubscriptionRef.make<BridgeStreamRegistryState>({
      entries: new Map(),
      generations: new Map()
    })

    const registry: BridgeStreamRegistry = {
      register: (streamId) =>
        SubscriptionRef.modify(state, (current) => {
          const previousGeneration = current.generations.get(streamId)
          const generation = previousGeneration === undefined ? 0 : previousGeneration + 1
          const entry = { streamId, generation, state: "open" } satisfies BridgeStreamRegistryEntry
          const entries = new Map(current.entries)
          const generations = new Map(current.generations)
          entries.set(streamId, entry)
          generations.set(streamId, generation)
          return [entry, { entries, generations }] as const
        }),
      terminate: (streamId, terminal, now) =>
        SubscriptionRef.modifySome(state, (current) => {
          const entry = current.entries.get(streamId)
          if (entry?.state === "terminal") {
            return [false, Option.none()] as const
          }
          const generation = entry?.generation ?? 0
          const entries = new Map(current.entries)
          const generations = new Map(current.generations)
          entries.set(streamId, {
            generation,
            state: "terminal",
            streamId,
            terminal,
            terminalAt: now
          })
          generations.set(streamId, generation)
          return [true, Option.some({ entries, generations })] as const
        }),
      isTerminal: (streamId) =>
        SubscriptionRef.get(state).pipe(
          Effect.map((current) => current.entries.get(streamId)?.state === "terminal")
        ),
      updateBackpressure: (streamId, metrics) =>
        SubscriptionRef.modifySome(state, (current) => {
          const entry = current.entries.get(streamId)
          if (entry === undefined) {
            return [undefined, Option.none()] as const
          }
          const entries = new Map(current.entries)
          entries.set(streamId, {
            ...entry,
            backpressure: metrics
          })
          return [undefined, Option.some({ ...current, entries })] as const
        }),
      gcExpired: (now) =>
        SubscriptionRef.modifySome(state, (current) => {
          let removed = 0
          const entries = new Map(current.entries)
          for (const [streamId, entry] of current.entries) {
            if (
              entry.state === "terminal" &&
              entry.terminalAt !== undefined &&
              now - entry.terminalAt >= cleanupGraceMs
            ) {
              entries.delete(streamId)
              removed += 1
            }
          }
          if (removed === 0) {
            return [0, Option.none()] as const
          }
          return [removed, Option.some({ ...current, entries })] as const
        }),
      snapshot: () => SubscriptionRef.get(state).pipe(Effect.map(registrySnapshot)),
      observe: () => SubscriptionRef.changes(state).pipe(Stream.map(registrySnapshot))
    }

    return Object.freeze(registry)
  })

const registrySnapshot = (
  state: BridgeStreamRegistryState
): ReadonlyArray<BridgeStreamRegistryEntry> => Array.from(state.entries.values())
