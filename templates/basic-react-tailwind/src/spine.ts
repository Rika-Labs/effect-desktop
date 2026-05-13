import { Desktop } from "@effect-desktop/core"
import {
  Window,
  WindowClient,
  WindowLive,
  type WindowError,
  makeWindowServiceLayer
} from "@effect-desktop/native"
import {
  WindowResource,
  type WindowCreateOptions,
  type WindowHandle
} from "@effect-desktop/native/contracts"
import { Effect, Layer, Schema } from "effect"

import { AppRpc } from "./contract.js"
import { TEMPLATE_WINDOW_TITLE } from "./App.js"

const greetLayer = AppRpc.toLayer({
  Greet: ({ name }) => Effect.succeed({ message: `Hello from Effect Desktop, ${name}!` })
})

export const templateWindowOptions: WindowCreateOptions = Object.freeze({
  title: TEMPLATE_WINDOW_TITLE,
  width: 960,
  height: 640
})

export const OpenTemplateWindow = Effect.gen(function* () {
  const window = yield* Window
  return yield* window.create(templateWindowOptions)
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
  },
  rpcs: [Desktop.Rpcs.layer(AppRpc, greetLayer)]
})

export const MainLayer = Desktop.app(TemplateApp)
export const AppLive = Layer.mergeAll(MainLayer, WindowLive)

const defaultTestWindowHandle = Schema.decodeUnknownSync(
  WindowResource
)({
  kind: "window",
  id: "template-window-001",
  generation: 0,
  ownerScope: "template-test",
  state: "open"
})

export const makeTemplateProductionLayer = <E, R>(
  windowClientLayer: Layer.Layer<WindowClient, E, R>
): Layer.Layer<
  Window | Layer.Success<typeof MainLayer>,
  WindowError | Layer.Error<typeof MainLayer> | E,
  R
> =>
  Layer.provide(AppLive, windowClientLayer)

export const makeTemplateTestLayer = (
  handle: WindowHandle = defaultTestWindowHandle
): Layer.Layer<Window> =>
  makeWindowServiceLayer({
    create: () => Effect.succeed(handle),
    close: () => Effect.void
  })

export const AppTest = makeTemplateTestLayer()
