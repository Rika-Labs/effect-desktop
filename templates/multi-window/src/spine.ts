import { Desktop } from "@effect-desktop/core"
import { Effect, Layer } from "effect"

import { AppRpc } from "./contract.js"

const pingLayer = AppRpc.toLayer({
  Ping: ({ message }) => Effect.succeed({ reply: `pong: ${message}` })
})

export const MainLayer: Layer.Layer<never, never, never> = Desktop.app().pipe(
  Layer.merge(pingLayer)
)
