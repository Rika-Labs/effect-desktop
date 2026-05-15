import { Context, Effect, Layer } from "effect"

import type { WindowSpec } from "./desktop-app.js"

export interface DesktopWindowRegistration {
  readonly id: string
  readonly spec: WindowSpec
  readonly services: Layer.Layer<never, unknown, unknown> | undefined
}

export interface DesktopWindowRegistryApi {
  readonly register: (registration: DesktopWindowRegistration) => Effect.Effect<void>
  readonly snapshot: Effect.Effect<ReadonlyArray<DesktopWindowRegistration>>
}

export class DesktopWindowRegistry extends Context.Service<
  DesktopWindowRegistry,
  DesktopWindowRegistryApi
>()("@effect-desktop/core/DesktopWindowRegistry") {}

export const makeDesktopWindowRegistry = (): DesktopWindowRegistryApi => {
  const entries: DesktopWindowRegistration[] = []
  return {
    register: (registration) =>
      Effect.sync(() => {
        entries.push(registration)
      }),
    snapshot: Effect.sync(() => Object.freeze([...entries]))
  }
}

export const DesktopWindowRegistryLive: Layer.Layer<DesktopWindowRegistry> = Layer.effect(
  DesktopWindowRegistry,
  Effect.sync(makeDesktopWindowRegistry)
)

export const RESERVED_WINDOW_IDS: ReadonlySet<string> = Object.freeze(
  new Set(["__proto__", "constructor", "prototype"])
)

export const isSafeWindowId = (id: string): boolean => id.length > 0 && !RESERVED_WINDOW_IDS.has(id)
