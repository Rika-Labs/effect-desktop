import type {
  BridgeStreamRegistry,
  BridgeStreamRegistryEntry,
  ResourceLifecycleEvent
} from "@orika/core"
import { ResourceRegistry } from "@orika/core"
import {
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FiberMap,
  Layer,
  PubSub,
  Scope,
  Stream
} from "effect"

export type ResourceEvent = Extract<
  ResourceLifecycleEvent,
  | { readonly _tag: "ResourceRegistered" }
  | { readonly _tag: "ResourceShared" }
  | { readonly _tag: "ResourceDisposed" }
  | { readonly _tag: "ResourceStale" }
>

export type ScopeEvent = Extract<
  ResourceLifecycleEvent,
  | { readonly _tag: "ScopeDeclared" }
  | { readonly _tag: "ScopeClosing" }
  | { readonly _tag: "ScopeClosed" }
>

export type FiberEvent =
  | {
      readonly _tag: "FiberStarted"
      readonly key: string
      readonly fiberId: number
    }
  | {
      readonly _tag: "FiberCompleted"
      readonly key: string
      readonly fiberId: number
      readonly exit: "success" | "failure"
    }

export type StreamEvent =
  | {
      readonly _tag: "StreamOpened"
      readonly streamId: string
      readonly generation: number
    }
  | {
      readonly _tag: "StreamBackpressureChanged"
      readonly streamId: string
      readonly generation: number
      readonly queueDepth: number
      readonly queueCapacity: number
      readonly overflow: string
    }
  | {
      readonly _tag: "StreamTerminated"
      readonly streamId: string
      readonly generation: number
      readonly terminal: string
    }

export interface ResourceInspectorCollectorApi {
  readonly events: () => Stream.Stream<ResourceEvent, never, never>
}

export interface ScopeInspectorCollectorApi {
  readonly events: () => Stream.Stream<ScopeEvent, never, never>
}

export interface FiberInspectorCollectorApi {
  readonly run: <A, E, R>(
    key: string,
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<Fiber.Fiber<void, never>, never, R>
  readonly events: () => Stream.Stream<FiberEvent, never, never>
}

export interface StreamInspectorCollectorApi {
  readonly events: () => Stream.Stream<StreamEvent, never, never>
}

export class ResourceInspectorCollector extends Context.Service<
  ResourceInspectorCollector,
  ResourceInspectorCollectorApi
>()("@orika/devtools/lifecycle-collectors/ResourceInspectorCollector") {}

export class ScopeInspectorCollector extends Context.Service<
  ScopeInspectorCollector,
  ScopeInspectorCollectorApi
>()("@orika/devtools/lifecycle-collectors/ScopeInspectorCollector") {}

export class FiberInspectorCollector extends Context.Service<
  FiberInspectorCollector,
  FiberInspectorCollectorApi
>()("@orika/devtools/lifecycle-collectors/FiberInspectorCollector") {}

export class StreamInspectorCollector extends Context.Service<
  StreamInspectorCollector,
  StreamInspectorCollectorApi
>()("@orika/devtools/lifecycle-collectors/StreamInspectorCollector") {}

export const ResourceInspectorCollectorLive: Layer.Layer<
  ResourceInspectorCollector,
  never,
  ResourceRegistry
> = Layer.effect(ResourceInspectorCollector)(
  Effect.gen(function* () {
    const registry = yield* ResourceRegistry
    return ResourceInspectorCollector.of({
      events: () => registry.observeLifecycle().pipe(Stream.filter(isResourceEvent))
    })
  })
)

export const ScopeInspectorCollectorLive: Layer.Layer<
  ScopeInspectorCollector,
  never,
  ResourceRegistry
> = Layer.effect(ScopeInspectorCollector)(
  Effect.gen(function* () {
    const registry = yield* ResourceRegistry
    return ScopeInspectorCollector.of({
      events: () => registry.observeLifecycle().pipe(Stream.filter(isScopeEvent))
    })
  })
)

export const FiberInspectorCollectorLive: Layer.Layer<FiberInspectorCollector, never, never> =
  Layer.effect(FiberInspectorCollector)(
    Effect.acquireRelease(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const fibers = yield* FiberMap.make<string, void, never>().pipe(Scope.provide(scope))
        const events = yield* PubSub.unbounded<FiberEvent>()
        return {
          fibers,
          events,
          scope
        }
      }),
      ({ scope }) => Scope.close(scope, Exit.void)
    ).pipe(
      Effect.map(({ events, fibers }) => {
        const publish = (event: FiberEvent): Effect.Effect<void, never, never> =>
          PubSub.publish(events, event).pipe(Effect.asVoid)

        const run = <A, E, R>(
          key: string,
          effect: Effect.Effect<A, E, R>
        ): Effect.Effect<Fiber.Fiber<void, never>, never, R> =>
          Effect.gen(function* () {
            let fiberId = -1
            const started = yield* Deferred.make<void, never>()
            const fiber = yield* FiberMap.run(
              fibers,
              key,
              Effect.gen(function* () {
                yield* Deferred.await(started)
                const exit = yield* Effect.exit(effect)
                yield* publish({
                  _tag: "FiberCompleted",
                  key,
                  fiberId,
                  exit: Exit.isSuccess(exit) ? "success" : "failure"
                })
              })
            )
            fiberId = fiber.id
            yield* publish({
              _tag: "FiberStarted",
              key,
              fiberId: fiber.id
            })
            yield* Deferred.succeed(started, undefined)
            return fiber
          })

        return FiberInspectorCollector.of({
          run,
          events: () => Stream.fromPubSub(events)
        })
      })
    )
  )

export const StreamInspectorCollectorLive = (
  registry: BridgeStreamRegistry
): Layer.Layer<StreamInspectorCollector, never, never> =>
  Layer.succeed(
    StreamInspectorCollector,
    StreamInspectorCollector.of({
      events: () => registry.observe().pipe(snapshotStreamEvents)
    })
  )

const isResourceEvent = (event: ResourceLifecycleEvent): event is ResourceEvent => {
  switch (event._tag) {
    case "ResourceRegistered":
    case "ResourceShared":
    case "ResourceDisposed":
    case "ResourceStale":
      return true
    case "ScopeDeclared":
    case "ScopeClosing":
    case "ScopeClosed":
      return false
  }
}

const isScopeEvent = (event: ResourceLifecycleEvent): event is ScopeEvent => {
  switch (event._tag) {
    case "ScopeDeclared":
    case "ScopeClosing":
    case "ScopeClosed":
      return true
    case "ResourceRegistered":
    case "ResourceShared":
    case "ResourceDisposed":
    case "ResourceStale":
      return false
  }
}

const snapshotStreamEvents = (
  snapshots: Stream.Stream<readonly BridgeStreamRegistryEntry[], never, never>
): Stream.Stream<StreamEvent, never, never> => {
  let previous = new Map<string, BridgeStreamRegistryEntry>()
  return snapshots.pipe(
    Stream.flatMap((entries) => {
      const next = new Map(entries.map((entry) => [entry.streamId, entry] as const))
      const events = entries.flatMap((entry) =>
        streamEventsForEntry(previous.get(entry.streamId), entry)
      )
      previous = next
      return Stream.fromIterable(events)
    })
  )
}

const streamEventsForEntry = (
  previous: BridgeStreamRegistryEntry | undefined,
  current: BridgeStreamRegistryEntry
): readonly StreamEvent[] => {
  const events: StreamEvent[] = []
  if (previous === undefined && current.state === "open") {
    events.push({
      _tag: "StreamOpened",
      streamId: current.streamId,
      generation: current.generation
    })
  }
  if (
    current.backpressure !== undefined &&
    (previous?.backpressure === undefined ||
      previous.backpressure.queueDepth !== current.backpressure.queueDepth ||
      previous.backpressure.queueCapacity !== current.backpressure.queueCapacity ||
      previous.backpressure.overflow !== current.backpressure.overflow)
  ) {
    events.push({
      _tag: "StreamBackpressureChanged",
      streamId: current.streamId,
      generation: current.generation,
      queueDepth: current.backpressure.queueDepth,
      queueCapacity: current.backpressure.queueCapacity,
      overflow: current.backpressure.overflow
    })
  }
  if (previous?.state !== "terminal" && current.state === "terminal") {
    events.push({
      _tag: "StreamTerminated",
      streamId: current.streamId,
      generation: current.generation,
      terminal: current.terminal ?? "closed"
    })
  }
  return events
}
