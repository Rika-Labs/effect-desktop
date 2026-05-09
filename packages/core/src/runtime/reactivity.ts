import type { Layer } from "effect"
import { Reactivity as ReactivityNS } from "effect/unstable/reactivity"

export type Reactivity = ReactivityNS.Reactivity
export const ReactivityLayer: Layer.Layer<ReactivityNS.Reactivity> = ReactivityNS.layer
export const mutation = ReactivityNS.mutation
export const stream = ReactivityNS.stream
export const invalidate = ReactivityNS.invalidate
