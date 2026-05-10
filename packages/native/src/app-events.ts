import { Context, Data, Effect, Layer, Match, Queue, Ref, Stream } from "effect"

import type { WindowHandle } from "./window.js"

const DEFAULT_APP_EVENT_SUBSCRIPTION_QUEUE_CAPACITY = 16
const DEFAULT_APP_EVENT_AUDIT_QUEUE_CAPACITY = 16

export type AppEventName =
  | "onOpenFile"
  | "onOpenUrl"
  | "onSecondInstance"
  | "onActivated"
  | "onWillQuit"
  | "onAppearanceChanged"
  | "GlobalShortcut.press"
  | "Tray.activation"
  | "Notification.interaction"

export type AppEventRoute =
  | { readonly _tag: "firstResponder" }
  | { readonly _tag: "broadcast" }
  | { readonly _tag: "targeted"; readonly windowId: string }

export type AppEventDeliveryDecision = "continue" | "refuse"

export interface AppEventEnvelope<Payload = unknown> {
  readonly event: AppEventName
  readonly payload: Payload
}

export interface RoutedAppEvent<Payload = unknown> extends AppEventEnvelope<Payload> {
  readonly windowId: string
  readonly ownerScope: string
}

export type AppEventAudit =
  | {
      readonly _tag: "EventBufferEvicted"
      readonly event: AppEventName
      readonly dropped: AppEventEnvelope
    }
  | {
      readonly _tag: "EventDroppedTargetClosed"
      readonly event: AppEventName
      readonly windowId: string
      readonly dropped: AppEventEnvelope
    }

export class AppEventWindowNotOpen extends Data.TaggedError("AppEventWindowNotOpen")<{
  readonly windowId: string
}> {}

export type AppEventRoutingError = AppEventWindowNotOpen

export interface AppEventRouterApi {
  readonly windowOpened: (window: WindowHandle) => Effect.Effect<void, never, never>
  readonly windowFocused: (windowId: string) => Effect.Effect<void, AppEventRoutingError, never>
  readonly windowClosed: (windowId: string) => Effect.Effect<void, never, never>
  readonly subscribe: <Payload>(
    windowId: string,
    event: AppEventName
  ) => Stream.Stream<RoutedAppEvent<Payload>, AppEventRoutingError, never>
  readonly publish: <Payload>(input: {
    readonly event: AppEventName
    readonly payload: Payload
    readonly route: AppEventRoute
  }) => Effect.Effect<void, never, never>
  readonly dispatch: <Payload, Error>(
    input: {
      readonly event: AppEventName
      readonly payload: Payload
      readonly route: AppEventRoute
    },
    deliver: (
      event: RoutedAppEvent<Payload>
    ) => Effect.Effect<AppEventDeliveryDecision, Error, never>
  ) => Effect.Effect<AppEventDeliveryDecision, Error, never>
  readonly audit: () => Stream.Stream<AppEventAudit, never, never>
}

export interface AppEventRouterOptions {
  readonly subscriptionQueueCapacity?: number
  readonly auditQueueCapacity?: number
}

export class AppEventRouter extends Context.Service<AppEventRouter, AppEventRouterApi>()(
  "@effect-desktop/native/AppEventRouter"
) {}

export const AppEventRouterLive = Layer.effect(AppEventRouter)(makeAppEventRouter())

export const firstResponderRoute: AppEventRoute = Object.freeze({ _tag: "firstResponder" })
export const broadcastRoute: AppEventRoute = Object.freeze({ _tag: "broadcast" })
const WindowIdString = /^[^\x00-\x1f\x7f]+$/
const validateWindowId = (windowId: string): string => {
  if (windowId.length === 0 || !WindowIdString.test(windowId)) {
    throw new RangeError("AppEventRouter requires a printable non-empty window id")
  }

  return windowId
}

export const targetedRoute = (windowId: string): AppEventRoute =>
  Object.freeze({ _tag: "targeted", windowId: validateWindowId(windowId) })

export const windowScope = (windowId: string): string => `window:${windowId}`

export function makeAppEventRouter(
  options: AppEventRouterOptions = {}
): Effect.Effect<AppEventRouterApi, never, never> {
  return Effect.gen(function* () {
    const subscriptionQueueCapacity = resolveQueueCapacity(
      options.subscriptionQueueCapacity,
      DEFAULT_APP_EVENT_SUBSCRIPTION_QUEUE_CAPACITY
    )
    const auditQueueCapacity = resolveQueueCapacity(
      options.auditQueueCapacity,
      DEFAULT_APP_EVENT_AUDIT_QUEUE_CAPACITY
    )

    const state = yield* Ref.make<RouterState>({
      windows: [],
      focusedWindowId: undefined,
      bufferedFirstResponder: new Map(),
      pendingWindowEvents: new Map(),
      subscriptions: new Map()
    })
    const auditQueue = yield* Queue.sliding<AppEventAudit>(auditQueueCapacity)

    const emitAudit = (audit: AppEventAudit): Effect.Effect<void, never, never> =>
      Effect.asVoid(Queue.offer(auditQueue, audit))

    const deliverToSubscribers = <Payload>(
      event: RoutedAppEvent<Payload>
    ): Effect.Effect<void, never, never> =>
      Effect.gen(function* () {
        const current = yield* Ref.get(state)
        const subscriptions = subscriptionsFor(current, event.windowId, event.event)

        yield* Effect.forEach(subscriptions, (subscription) => subscription.offer(event), {
          discard: true
        })
      })

    const windowOpened = (window: WindowHandle): Effect.Effect<void, never, never> =>
      Effect.gen(function* () {
        validateWindowId(window.id)

        const replay = yield* Ref.modify(state, (current) => {
          const existing = current.windows.find((entry) => entry.windowId === window.id)
          const entry = {
            windowId: window.id,
            ownerScope: window.ownerScope
          } satisfies WindowEntry
          const windows =
            existing === undefined
              ? [...current.windows, entry]
              : current.windows.map((item) => (item.windowId === window.id ? entry : item))
          const buffered = Array.from(current.bufferedFirstResponder.values())
          const pendingWindowEvents = new Map(current.pendingWindowEvents)
          if (buffered.length > 0) {
            pendingWindowEvents.set(window.id, buffered)
          }

          return [
            buffered.map((event) => routedEvent(entry, event)),
            {
              ...current,
              windows,
              focusedWindowId: current.focusedWindowId ?? window.id,
              bufferedFirstResponder: new Map(),
              pendingWindowEvents
            }
          ] as const
        })

        yield* Effect.forEach(replay, deliverToSubscribers, { discard: true })
      })

    const windowFocused = (windowId: string): Effect.Effect<void, AppEventRoutingError, never> =>
      Effect.gen(function* () {
        const current = yield* Ref.get(state)
        if (!hasWindow(current, windowId)) {
          return yield* Effect.fail(new AppEventWindowNotOpen({ windowId }))
        }

        yield* Ref.update(state, (latest) => ({
          ...latest,
          focusedWindowId: windowId
        }))
      })

    const takePendingEvents = (
      windowId: string,
      event: AppEventName
    ): Effect.Effect<readonly RoutedAppEvent[], never, never> =>
      Ref.modify(state, (current) => {
        const pendingEvents = current.pendingWindowEvents.get(windowId) ?? []
        const matching = pendingEvents.filter((item) => item.event === event)
        const remaining = pendingEvents.filter((item) => item.event !== event)
        const pendingWindowEvents = new Map(current.pendingWindowEvents)
        if (remaining.length === 0) {
          pendingWindowEvents.delete(windowId)
        } else {
          pendingWindowEvents.set(windowId, remaining)
        }

        const ownerScope = findWindow(current, windowId)?.ownerScope ?? windowScope(windowId)

        return [
          matching.map((item) => routedEvent({ windowId, ownerScope }, item)),
          {
            ...current,
            pendingWindowEvents
          }
        ] as const
      })

    const windowClosed = (windowId: string): Effect.Effect<void, never, never> =>
      Effect.gen(function* () {
        const queues = yield* Ref.modify(state, (current) => {
          const windows = current.windows.filter((entry) => entry.windowId !== windowId)
          const focusedWindowId =
            current.focusedWindowId === windowId ? windows[0]?.windowId : current.focusedWindowId
          const subscriptions = new Map(current.subscriptions)
          const closed = subscriptions.get(windowId) ?? []
          subscriptions.delete(windowId)
          const pendingWindowEvents = new Map(current.pendingWindowEvents)
          pendingWindowEvents.delete(windowId)

          return [
            closed,
            {
              ...current,
              windows,
              focusedWindowId,
              subscriptions,
              pendingWindowEvents
            }
          ] as const
        })

        yield* Effect.forEach(queues, (subscription) => subscription.interrupt, { discard: true })
      })

    const subscribe = <Payload>(
      windowId: string,
      event: AppEventName
    ): Stream.Stream<RoutedAppEvent<Payload>, AppEventRoutingError, never> =>
      Stream.unwrap(
        Effect.gen(function* () {
          const queue = yield* Queue.sliding<RoutedAppEvent<Payload>>(subscriptionQueueCapacity)
          const subscription: EventSubscription = {
            event,
            offer: (item) => Queue.offer(queue, item as RoutedAppEvent<Payload>),
            interrupt: Queue.interrupt(queue)
          }
          const current = yield* Ref.get(state)
          if (!hasWindow(current, windowId)) {
            return yield* Effect.fail(new AppEventWindowNotOpen({ windowId }))
          }

          const pending = yield* takePendingEvents(windowId, event)
          yield* Ref.update(state, (latest) => {
            const existing = latest.subscriptions.get(windowId) ?? []
            const subscriptions = new Map(latest.subscriptions)
            subscriptions.set(windowId, [...existing, subscription])

            return {
              ...latest,
              subscriptions
            }
          })
          yield* Effect.forEach(
            pending,
            (item) => Queue.offer(queue, item as RoutedAppEvent<Payload>),
            {
              discard: true
            }
          )

          return Stream.fromQueue(queue).pipe(
            Stream.ensuring(
              Effect.andThen(
                Ref.update(state, (current) => removeSubscription(current, windowId, subscription)),
                Queue.interrupt(queue)
              )
            )
          )
        })
      )

    const dispatch: AppEventRouterApi["dispatch"] = <Payload, Error>(
      input: {
        readonly event: AppEventName
        readonly payload: Payload
        readonly route: AppEventRoute
      },
      deliver: (
        event: RoutedAppEvent<Payload>
      ) => Effect.Effect<AppEventDeliveryDecision, Error, never>
    ) =>
      Effect.gen(function* () {
        if (input.route._tag === "targeted") {
          validateWindowId(input.route.windowId)
        }
        const current = yield* Ref.get(state)
        const envelope = {
          event: input.event,
          payload: input.payload
        } satisfies AppEventEnvelope
        const targets = routeTargets(current, input.route)

        if (targets._tag === "buffer") {
          const evicted = current.bufferedFirstResponder.get(input.event)
          yield* Ref.update(state, (latest) => {
            const bufferedFirstResponder = new Map(latest.bufferedFirstResponder)
            bufferedFirstResponder.set(input.event, envelope)

            return {
              ...latest,
              bufferedFirstResponder
            }
          })
          if (evicted !== undefined) {
            yield* emitAudit({ _tag: "EventBufferEvicted", event: input.event, dropped: evicted })
          }
          return "continue"
        }

        if (targets._tag === "drop") {
          yield* emitAudit({
            _tag: "EventDroppedTargetClosed",
            event: input.event,
            windowId: input.route._tag === "targeted" ? input.route.windowId : "",
            dropped: envelope
          })
          return "continue"
        }

        for (const target of targets.targets) {
          const decision = yield* deliver(routedEvent(target, envelope))
          if (decision === "refuse") {
            return "refuse"
          }
        }

        return "continue"
      })

    return Object.freeze({
      windowOpened,
      windowFocused,
      windowClosed,
      subscribe,
      publish: <Payload>(input: {
        readonly event: AppEventName
        readonly payload: Payload
        readonly route: AppEventRoute
      }) => dispatch(input, (event) => Effect.as(deliverToSubscribers(event), "continue")),
      dispatch,
      audit: () => Stream.fromQueue(auditQueue)
    })
  })
}

interface RouterState {
  readonly windows: readonly WindowEntry[]
  readonly focusedWindowId: string | undefined
  readonly bufferedFirstResponder: ReadonlyMap<AppEventName, AppEventEnvelope>
  readonly pendingWindowEvents: ReadonlyMap<string, readonly AppEventEnvelope[]>
  readonly subscriptions: ReadonlyMap<string, readonly EventSubscription[]>
}

interface WindowEntry {
  readonly windowId: string
  readonly ownerScope: string
}

interface EventSubscription {
  readonly event: AppEventName
  readonly offer: (event: RoutedAppEvent) => Effect.Effect<void, never, never>
  readonly interrupt: Effect.Effect<void, never, never>
}

type RouteTargets =
  | { readonly _tag: "targets"; readonly targets: readonly WindowEntry[] }
  | { readonly _tag: "buffer" }
  | { readonly _tag: "drop" }

const routeTargets = (state: RouterState, route: AppEventRoute): RouteTargets =>
  Match.value(route).pipe(
    Match.tag("firstResponder", () => {
      const focused =
        state.focusedWindowId === undefined ? undefined : findWindow(state, state.focusedWindowId)
      return focused === undefined
        ? ({ _tag: "buffer" } as const)
        : ({ _tag: "targets", targets: [focused] } as const)
    }),
    Match.tag("broadcast", () => ({ _tag: "targets", targets: state.windows }) as const),
    Match.tag("targeted", (r) => {
      const target = findWindow(state, r.windowId)
      return target === undefined
        ? ({ _tag: "drop" } as const)
        : ({ _tag: "targets", targets: [target] } as const)
    }),
    Match.exhaustive
  )

const routedEvent = <Payload>(
  target: WindowEntry,
  event: AppEventEnvelope<Payload>
): RoutedAppEvent<Payload> => ({
  windowId: target.windowId,
  ownerScope: target.ownerScope,
  event: event.event,
  payload: event.payload
})

const hasWindow = (state: RouterState, windowId: string): boolean =>
  state.windows.some((window) => window.windowId === windowId)

const findWindow = (state: RouterState, windowId: string): WindowEntry | undefined =>
  state.windows.find((window) => window.windowId === windowId)

const subscriptionsFor = (
  state: RouterState,
  windowId: string,
  event: AppEventName
): readonly EventSubscription[] =>
  (state.subscriptions.get(windowId) ?? []).filter((subscription) => subscription.event === event)

const removeSubscription = (
  state: RouterState,
  windowId: string,
  subscription: EventSubscription
): RouterState => {
  const existing = state.subscriptions.get(windowId) ?? []
  const remaining = existing.filter((item) => item !== subscription)
  const subscriptions = new Map(state.subscriptions)

  if (remaining.length === 0) {
    subscriptions.delete(windowId)
  } else {
    subscriptions.set(windowId, remaining)
  }

  return {
    ...state,
    subscriptions
  }
}

const resolveQueueCapacity = (value: number | undefined, fallback: number): number =>
  value === undefined ? fallback : Number.isSafeInteger(value) && value > 0 ? value : fallback
