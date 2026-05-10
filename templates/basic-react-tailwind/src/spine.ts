import { Desktop } from "@effect-desktop/core"
import { Effect } from "effect"

import { AppRpc } from "./contract.js"

const greetLayer = AppRpc.toLayer({
  Greet: ({ name }) => Effect.succeed({ message: `Hello from Effect Desktop, ${name}!` })
})

export const TemplateApp = Desktop.make({
  id: "basic-react-tailwind",
  windows: {
    main: {
      title: "Effect Desktop",
      width: 960,
      height: 640,
      renderer: "/"
    }
  }
}).pipe(Desktop.provide(Desktop.Rpcs.layer(AppRpc, greetLayer)))

export const MainLayer = Desktop.toLayer(TemplateApp)
