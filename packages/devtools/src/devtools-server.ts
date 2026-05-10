import { Layer } from "effect"
import { DevTools } from "effect/unstable/devtools"

export interface DevtoolsTracerOptions {
  readonly webSocketUrl?: string
}

export const makeDevtoolsTracerLayer = (options: DevtoolsTracerOptions = {}): Layer.Layer<never> =>
  DevTools.layer(options.webSocketUrl ?? "ws://localhost:34437")

export const DevtoolsTracerLayerNoOp: Layer.Layer<never> = Layer.empty
