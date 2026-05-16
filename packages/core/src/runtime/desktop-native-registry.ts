import { Context, Effect, Layer } from "effect"

import type { DesktopRpcsLayer } from "./desktop-app.js"
import type { DesktopRpcContractLaw, DesktopRpcSchemaDoc } from "./desktop-rpc-surface.js"

export interface DesktopNativeRegistration<E = unknown, R = unknown> {
  readonly tag: string
  readonly serverLayer: DesktopRpcsLayer<E, R>
  readonly schemaDocs: readonly DesktopRpcSchemaDoc[]
  readonly contractLaws: readonly DesktopRpcContractLaw[]
}

export type AnyDesktopNativeRegistration = DesktopNativeRegistration<unknown, unknown>

export interface DesktopNativeRegistryApi {
  readonly register: (registration: AnyDesktopNativeRegistration) => Effect.Effect<void>
  readonly snapshot: Effect.Effect<ReadonlyArray<AnyDesktopNativeRegistration>>
}

export class DesktopNativeRegistry extends Context.Service<
  DesktopNativeRegistry,
  DesktopNativeRegistryApi
>()("@effect-desktop/core/DesktopNativeRegistry") {}

export const makeDesktopNativeRegistry = (): DesktopNativeRegistryApi => {
  const entries: AnyDesktopNativeRegistration[] = []
  return {
    register: (registration) =>
      Effect.sync(() => {
        entries.push(registration)
      }),
    snapshot: Effect.sync(() => Object.freeze([...entries]))
  }
}

export const DesktopNativeRegistryLive: Layer.Layer<DesktopNativeRegistry> = Layer.effect(
  DesktopNativeRegistry,
  Effect.sync(makeDesktopNativeRegistry)
)
