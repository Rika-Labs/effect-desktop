import { Desktop } from "@effect-desktop/core"
import { Effect, Layer } from "effect"

import { AppRpc } from "./contract.js"

const greetLayer = AppRpc.toLayer({
  Greet: ({ name }) => Effect.succeed({ message: `Hello from Effect Desktop, ${name}!` })
})

export const MainLayer: Layer.Layer<never, never, never> = Desktop.app().pipe(
  Layer.merge(greetLayer)
)
