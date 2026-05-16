import {
  Context,
  Data,
  Effect,
  Layer,
  Match,
  Option,
  PubSub,
  Schema,
  Scope,
  Stream,
  SubscriptionRef
} from "effect"

import type { WindowHandle } from "./window.js"

const DEFAULT_APP_EVENT_CHANNEL_CAPACITY = 16
const DEFAULT_APP_EVENT_AUDIT_REPLAY_CAPACITY = 16
const APP_EVENT_NAMES = [
  "onOpenFile",
  "onOpenUrl",
  "onSecondInstance",
  "onActivated",
  "onWillQuit",
  "onAppearanceChanged",
  "GlobalShortcut.press",
  "Tray.activation",
  "Notification.interaction"
] as const

export type AppEventName = (typeof APP_EVENT_NAMES)[number]

const AppEventNameSchema = Schema.Literals(APP_EVENT_NAMES)
const WindowEntrySchema = Schema.Struct({
  windowId: Schema.NonEmptyString,
  ownerScope: Schema.NonEmptyString
})
const AppEventEnvelopeSchema = Schema.Struct({
  event: AppEventNameSchema,
  payload: Schema.Unknown
})
const PendingWindowEventsSchema = Schema.Struct({
  windowId: Schema.NonEmptyString,
  events: Schema.Array(AppEventEnvelopeSchema)
})

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
  readonly subscribe: (
    windowId: string,
    event: AppEventName
  ) => Stream.Stream<RoutedAppEvent, AppEventRoutingError, never>
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
  readonly observeState: () => Stream.Stream<AppEventRouterState, never, never>
}

export interface AppEventRouterOptions {
  readonly eventChannelCapacity?: number
  readonly auditReplayCapacity?: number
}

export class AppEventRouter extends Context.Service<AppEventRouter, AppEventRouterApi>()(
  "@effect-desktop/native/AppEventRouter"
) {}

export const AppEventRouterLive = Layer.effect(AppEventRouter)(makeAppEventRouter())

export const firstResponderRoute: AppEventRoute = Object.freeze({ _tag: "firstResponder" })
export const broadcastRoute: AppEventRoute = Object.freeze({ _tag: "broadcast" })
const NulByte = String.fromCharCode(0)
const UnitSeparatorByte = String.fromCharCode(31)
const DeleteByte = String.fromCharCode(127)
const WindowIdString = new RegExp(`^[^${NulByte}-${UnitSeparatorByte}${DeleteByte}]+$`, "u")
const validateWindowId = (windowId: string): string => {
  if (windowId.length === 0 || !WindowIdString.test(windowId)) {
    throw new RangeError("AppEventRouter requires a printable non-empty window id")
  }

  return windowId
}

export const targetedRoute = (windowId: string): AppEventRoute =>
  Object.freeze({ _tag: "targeted", windowId: validateWindowId(windowId) })

export const windowScope = (windowId: string): string => `window:${windowId}`

export class AppEventRouterState extends Schema.Class<AppEventRouterState>("AppEventRouterState")({
  windows: Schema.Array(WindowEntrySchema),
  focusedWindowId: Schema.Option(Schema.String),
  bufferedFirstResponder: Schema.Array(AppEventEnvelopeSchema),
  pendingWindowEvents: Schema.Array(PendingWindowEventsSchema)
}) {}

export function makeAppEventRouter(
  options: AppEventRouterOptions = {}
): Effect.Effect<AppEventRouterApi, never, Scope.Scope> {
  return Effect.gen(function* () {
    const eventChannelCapacity = resolveCapacity(
      options.eventChannelCapacity,
      DEFAULT_APP_EVENT_CHANNEL_CAPACITY
    )
    const auditReplayCapacity = resolveCapacity(
      options.auditReplayCapacity,
      DEFAULT_APP_EVENT_AUDIT_REPLAY_CAPACITY
    )

    const state = yield* SubscriptionRef.make(initialRouterState())
    const eventChannels = new Map<string, EventChannels>()
    const auditEvents = yield* PubSub.sliding<AppEventAudit>({
      capacity: auditReplayCapacity,
      replay: auditReplayCapacity
    })
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        yield* PubSub.shutdown(auditEvents)
        const channels = Array.from(eventChannels.values())
        eventChannels.clear()
        yield* Effect.forEach(
          channels,
          (eventChannel) =>
            Effect.forEach(eventChannel.values(), PubSub.shutdown, { discard: true }),
          { discard: true }
        )
      })
    )

    const emitAudit = (audit: AppEventAudit): Effect.Effect<void, never, never> =>
      PubSub.publish(auditEvents, audit).pipe(Effect.asVoid)

    const channelFor = (
      windowId: string,
      event: AppEventName
    ): PubSub.PubSub<RoutedAppEvent> | undefined => eventChannels.get(windowId)?.get(event)

    const publishToChannel = (event: RoutedAppEvent): Effect.Effect<void, never, never> => {
      const channel = channelFor(event.windowId, event.event)
      return channel === undefined
        ? Effect.void
        : PubSub.publish(channel, event).pipe(Effect.asVoid)
    }

    const windowOpened = (window: WindowHandle): Effect.Effect<void, never, never> =>
      Effect.gen(function* () {
        validateWindowId(window.id)

        if (!eventChannels.has(window.id)) {
          eventChannels.set(window.id, yield* makeEventChannels(eventChannelCapacity))
        }

        yield* SubscriptionRef.update(state, (current) => {
          const existing = current.windows.find((entry) => entry.windowId === window.id)
          const entry = {
            windowId: window.id,
            ownerScope: window.ownerScope
          } satisfies WindowEntry
          const windows =
            existing === undefined
              ? [...current.windows, entry]
              : current.windows.map((item) => (item.windowId === window.id ? entry : item))
          const buffered = current.bufferedFirstResponder
          const pendingWindowEvents =
            buffered.length > 0
              ? setPendingWindowEvents(current.pendingWindowEvents, window.id, buffered)
              : current.pendingWindowEvents

          return new AppEventRouterState({
            windows,
            focusedWindowId: Option.isNone(current.focusedWindowId)
              ? Option.some(window.id)
              : current.focusedWindowId,
            bufferedFirstResponder: [],
            pendingWindowEvents
          })
        })
      })

    const windowFocused = (windowId: string): Effect.Effect<void, AppEventRoutingError, never> =>
      Effect.gen(function* () {
        const current = yield* SubscriptionRef.get(state)
        if (!hasWindow(current, windowId)) {
          return yield* Effect.fail(new AppEventWindowNotOpen({ windowId }))
        }

        yield* SubscriptionRef.update(
          state,
          (latest) =>
            new AppEventRouterState({
              windows: latest.windows,
              focusedWindowId: Option.some(windowId),
              bufferedFirstResponder: latest.bufferedFirstResponder,
              pendingWindowEvents: latest.pendingWindowEvents
            })
        )
      })

    const takePendingEvents = (
      windowId: string,
      event: AppEventName
    ): Effect.Effect<readonly RoutedAppEvent[], never, never> =>
      SubscriptionRef.modify(state, (current) => {
        const pendingEvents = pendingEventsFor(current, windowId)
        const matching = pendingEvents.filter((item) => item.event === event)
        const remaining = pendingEvents.filter((item) => item.event !== event)
        const ownerScope = findWindow(current, windowId)?.ownerScope ?? windowScope(windowId)

        return [
          matching.map((item) => routedEvent({ windowId, ownerScope }, item)),
          new AppEventRouterState({
            windows: current.windows,
            focusedWindowId: current.focusedWindowId,
            bufferedFirstResponder: current.bufferedFirstResponder,
            pendingWindowEvents: setPendingWindowEvents(
              current.pendingWindowEvents,
              windowId,
              remaining
            )
          })
        ] as const
      })

    const windowClosed = (windowId: string): Effect.Effect<void, never, never> =>
      Effect.gen(function* () {
        const channels = eventChannels.get(windowId)
        eventChannels.delete(windowId)

        yield* SubscriptionRef.update(state, (current) => {
          const windows = current.windows.filter((entry) => entry.windowId !== windowId)
          const focusedWindowId =
            Option.isSome(current.focusedWindowId) && current.focusedWindowId.value === windowId
              ? Option.fromUndefinedOr(windows[0]?.windowId)
              : current.focusedWindowId

          return new AppEventRouterState({
            windows,
            focusedWindowId,
            bufferedFirstResponder: current.bufferedFirstResponder,
            pendingWindowEvents: setPendingWindowEvents(current.pendingWindowEvents, windowId, [])
          })
        })

        if (channels !== undefined) {
          yield* Effect.forEach(channels.values(), PubSub.shutdown, { discard: true })
        }
      })

    const subscribe = (
      windowId: string,
      event: AppEventName
    ): Stream.Stream<RoutedAppEvent, AppEventRoutingError, never> =>
      Stream.unwrap(
        Effect.gen(function* () {
          const current = yield* SubscriptionRef.get(state)
          if (!hasWindow(current, windowId)) {
            return yield* Effect.fail(new AppEventWindowNotOpen({ windowId }))
          }

          const channel = channelFor(windowId, event)
          if (channel === undefined) {
            return yield* Effect.fail(new AppEventWindowNotOpen({ windowId }))
          }

          return Stream.fromEffect(
            Effect.gen(function* () {
              const subscription = yield* PubSub.subscribe(channel)
              const pending = yield* takePendingEvents(windowId, event)
              return { pending, subscription }
            })
          ).pipe(
            Stream.scoped,
            Stream.flatMap(({ pending, subscription }) =>
              Stream.fromIterable(pending).pipe(
                Stream.concat(Stream.fromSubscription(subscription))
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
        const current = yield* SubscriptionRef.get(state)
        const envelope = {
          event: input.event,
          payload: input.payload
        } satisfies AppEventEnvelope
        const targets = routeTargets(current, input.route)

        if (targets._tag === "buffer") {
          const evicted = current.bufferedFirstResponder.find((item) => item.event === input.event)
          yield* SubscriptionRef.update(
            state,
            (latest) =>
              new AppEventRouterState({
                windows: latest.windows,
                focusedWindowId: latest.focusedWindowId,
                bufferedFirstResponder: upsertBufferedFirstResponder(
                  latest.bufferedFirstResponder,
                  envelope
                ),
                pendingWindowEvents: latest.pendingWindowEvents
              })
          )
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
      }) => dispatch(input, (event) => publishToChannel(event).pipe(Effect.as("continue"))),
      dispatch,
      audit: () => Stream.fromPubSub(auditEvents),
      observeState: () => SubscriptionRef.changes(state)
    })
  })
}

type RouterState = AppEventRouterState

interface WindowEntry {
  readonly windowId: string
  readonly ownerScope: string
}

type EventChannels = Map<AppEventName, PubSub.PubSub<RoutedAppEvent>>

type RouteTargets =
  | { readonly _tag: "targets"; readonly targets: readonly WindowEntry[] }
  | { readonly _tag: "buffer" }
  | { readonly _tag: "drop" }

const routeTargets = (state: RouterState, route: AppEventRoute): RouteTargets =>
  Match.value(route).pipe(
    Match.tag("firstResponder", () => {
      const focused = Option.isNone(state.focusedWindowId)
        ? undefined
        : findWindow(state, state.focusedWindowId.value)
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

const initialRouterState = (): AppEventRouterState =>
  new AppEventRouterState({
    windows: [],
    focusedWindowId: Option.none(),
    bufferedFirstResponder: [],
    pendingWindowEvents: []
  })

const makeEventChannels = (capacity: number): Effect.Effect<EventChannels, never, never> =>
  Effect.gen(function* () {
    const entries: Array<readonly [AppEventName, PubSub.PubSub<RoutedAppEvent>]> = []
    for (const event of APP_EVENT_NAMES) {
      const channel = yield* PubSub.sliding<RoutedAppEvent>({ capacity, replay: 0 })
      entries.push([event, channel])
    }
    return new Map(entries)
  })

const pendingEventsFor = (state: RouterState, windowId: string): readonly AppEventEnvelope[] =>
  state.pendingWindowEvents.find((entry) => entry.windowId === windowId)?.events ?? []

const setPendingWindowEvents = (
  entries: readonly { readonly windowId: string; readonly events: readonly AppEventEnvelope[] }[],
  windowId: string,
  events: readonly AppEventEnvelope[]
): readonly { readonly windowId: string; readonly events: readonly AppEventEnvelope[] }[] => {
  const remaining = entries.filter((entry) => entry.windowId !== windowId)
  return events.length === 0 ? remaining : [...remaining, { windowId, events }]
}

const upsertBufferedFirstResponder = (
  events: readonly AppEventEnvelope[],
  envelope: AppEventEnvelope
): readonly AppEventEnvelope[] => [
  ...events.filter((event) => event.event !== envelope.event),
  envelope
]

const resolveCapacity = (value: number | undefined, fallback: number): number =>
  value === undefined ? fallback : Number.isSafeInteger(value) && value > 0 ? value : fallback
