import { Desktop } from "@effect-desktop/core"
import { Effect } from "effect"

import { AppRpc } from "./contract.js"

const pingLayer = AppRpc.toLayer({
  Ping: ({ message }) => Effect.succeed({ reply: `pong: ${message}` })
})

export const MultiWindowApp = Desktop.make({
  id: "multi-window",
  windows: {
    main: {
      title: "Multi-window",
      width: 960,
      height: 640,
      renderer: "/"
    }
  }
}).pipe(Desktop.provide(Desktop.Rpcs.layer(AppRpc, pingLayer)))

export const MainLayer = Desktop.toLayer(MultiWindowApp)
