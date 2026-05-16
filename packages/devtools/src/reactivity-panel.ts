import { Clock, Context, Effect, Layer, Stream, SubscriptionRef } from "effect"

import { positiveRowLimit } from "./panel-options.js"

export interface ReactivityInvalidationRecord {
  readonly keys: readonly string[]
  readonly timestampMs: number
  readonly count: number
}

export interface ReactivityPanelSnapshot {
  readonly invalidations: readonly ReactivityInvalidationRecord[]
  readonly totalInvalidations: number
  readonly uniqueKeys: readonly string[]
}

export interface ReactivityPanelApi {
  readonly list: () => Effect.Effect<ReactivityPanelSnapshot, never, never>
  readonly observe: () => Stream.Stream<ReactivityPanelSnapshot, never, never>
}

export interface ReactivityTrackerApi {
  readonly trackInvalidation: (
    keys: ReadonlyArray<unknown> | Readonly<Record<string, ReadonlyArray<unknown>>>
  ) => Effect.Effect<void, never, never>
  readonly list: () => Effect.Effect<readonly ReactivityInvalidationRecord[], never, never>
  readonly observe: () => Stream.Stream<readonly ReactivityInvalidationRecord[], never, never>
}

export class ReactivityTracker extends Context.Service<ReactivityTracker, ReactivityTrackerApi>()(
  "@effect-desktop/devtools/ReactivityTracker"
) {}

export const makeReactivityTracker = (
  options: { readonly maxRows?: number; readonly now?: () => number } = {}
): Effect.Effect<ReactivityTrackerApi, never, never> =>
  Effect.gen(function* () {
    const maxRows = positiveRowLimit(options.maxRows, 512)
    const ref = yield* SubscriptionRef.make<readonly ReactivityInvalidationRecord[]>([])

    const trackInvalidation = (
      keys: ReadonlyArray<unknown> | Readonly<Record<string, ReadonlyArray<unknown>>>
    ): Effect.Effect<void, never, never> =>
      Effect.gen(function* () {
        const timestampMs = yield* currentTimeMillis(options.now)
        const normalized = normalizeKeys(keys)
        if (normalized.length === 0) {
          return yield* Effect.void
        }
        return yield* SubscriptionRef.update(
          ref,
          (rows: readonly ReactivityInvalidationRecord[]) => {
            const record: ReactivityInvalidationRecord = {
              keys: normalized,
              timestampMs,
              count: 1
            }
            return [...rows, record].slice(-maxRows)
          }
        )
      })

    return Object.freeze({
      trackInvalidation,
      list: () => SubscriptionRef.get(ref),
      observe: () => SubscriptionRef.changes(ref)
    } satisfies ReactivityTrackerApi)
  })

const currentTimeMillis = (now: (() => number) | undefined): Effect.Effect<number, never, never> =>
  now === undefined ? Clock.currentTimeMillis : Effect.sync(now)

export const ReactivityTrackerLive: Layer.Layer<ReactivityTracker> =
  Layer.effect(ReactivityTracker)(makeReactivityTracker())

export interface ReactivityPanelOptions {
  readonly maxRows?: number
}

export class ReactivityPanel extends Context.Service<ReactivityPanel, ReactivityPanelApi>()(
  "@effect-desktop/devtools/ReactivityPanel"
) {}

export const ReactivityPanelLive = (
  options: ReactivityPanelOptions = {}
): Layer.Layer<ReactivityPanel, never, ReactivityTracker> =>
  Layer.effect(ReactivityPanel)(makeReactivityPanel(options))

export const makeReactivityPanel = (
  options: ReactivityPanelOptions = {}
): Effect.Effect<ReactivityPanelApi, never, ReactivityTracker> =>
  Effect.gen(function* () {
    const tracker = yield* ReactivityTracker
    const maxRows = positiveRowLimit(options.maxRows, 256)

    const list = (): Effect.Effect<ReactivityPanelSnapshot, never, never> =>
      Effect.gen(function* () {
        const invalidations = yield* tracker.list()
        const visible = invalidations.slice(-maxRows)
        const allKeys: readonly string[] = [
          ...new Set(visible.flatMap((r: ReactivityInvalidationRecord) => r.keys))
        ].sort()
        return {
          invalidations: visible,
          totalInvalidations: invalidations.length,
          uniqueKeys: allKeys
        } satisfies ReactivityPanelSnapshot
      })

    return Object.freeze({
      list,
      observe: () => tracker.observe().pipe(Stream.mapEffect(() => list()))
    } satisfies ReactivityPanelApi)
  })

const normalizeKeys = (
  keys: ReadonlyArray<unknown> | Readonly<Record<string, ReadonlyArray<unknown>>>
): readonly string[] => {
  if (Array.isArray(keys)) {
    return (keys as ReadonlyArray<unknown>).map((k) => String(k))
  }
  return Object.entries(keys as Record<string, ReadonlyArray<unknown>>).flatMap(([ns, ks]) =>
    ks.map((k) => `${ns}:${String(k)}`)
  )
}
