import { Cron, Duration, Effect, Ref, Schema } from "effect"
import { ClusterCron, Entity, Singleton } from "effect/unstable/cluster"
import { Rpc } from "effect/unstable/rpc"

const WindowFocus = Rpc.make("WindowFocus")

const WindowSetTitle = Rpc.make("WindowSetTitle", {
  payload: { title: Schema.NonEmptyString }
})

const WindowGetState = Rpc.make("WindowGetState", {
  success: Schema.Struct({
    focused: Schema.Boolean,
    title: Schema.String
  })
})

export const WindowEntity = Entity.make("Window", [WindowFocus, WindowSetTitle, WindowGetState])

type WindowState = {
  readonly focused: boolean
  readonly title: string
}

export const WindowEntityLayer = WindowEntity.toLayer(
  Effect.gen(function* () {
    const state = yield* Ref.make<WindowState>({ focused: false, title: "" })

    return WindowEntity.of({
      WindowFocus: (_req) => Ref.update(state, (s) => ({ ...s, focused: true })),

      WindowSetTitle: (req) => Ref.update(state, (s) => ({ ...s, title: req.payload.title })),

      WindowGetState: (_req) => Ref.get(state)
    })
  }),
  { maxIdleTime: Duration.minutes(5) }
)

export const HealthSingletonLayer = Singleton.make(
  "HealthMonitor",
  Effect.gen(function* () {
    yield* Effect.log("[HealthMonitor] singleton started")
    return yield* Effect.never
  })
)

export const AutoUpdateCronLayer = ClusterCron.make({
  name: "AutoUpdateCheck",
  cron: Cron.parseUnsafe("0 * * * *"),
  execute: Effect.log("[AutoUpdateCheck] checking for updates"),
  skipIfOlderThan: Duration.minutes(30)
})
