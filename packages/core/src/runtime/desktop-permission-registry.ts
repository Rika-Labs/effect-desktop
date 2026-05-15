import { Context, Effect, Layer } from "effect"

import type { NormalizedCapability } from "./permission-registry.js"

export interface DesktopPermissionRegistryApi {
  readonly register: (capability: NormalizedCapability) => Effect.Effect<void>
  readonly snapshot: Effect.Effect<ReadonlyArray<NormalizedCapability>>
}

export class DesktopPermissionRegistry extends Context.Service<
  DesktopPermissionRegistry,
  DesktopPermissionRegistryApi
>()("@effect-desktop/core/DesktopPermissionRegistry") {}

export const makeDesktopPermissionRegistry = (): DesktopPermissionRegistryApi => {
  const entries: NormalizedCapability[] = []
  return {
    register: (capability) =>
      Effect.sync(() => {
        entries.push(capability)
      }),
    snapshot: Effect.sync(() => Object.freeze([...entries]))
  }
}

export const DesktopPermissionRegistryLive: Layer.Layer<DesktopPermissionRegistry> = Layer.effect(
  DesktopPermissionRegistry,
  Effect.sync(makeDesktopPermissionRegistry)
)
