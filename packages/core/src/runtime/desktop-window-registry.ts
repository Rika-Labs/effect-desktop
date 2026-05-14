import { Context, Effect, Layer, type Scope } from "effect"

import type { WindowSpec } from "./desktop-app.js"

/**
 * Tactical scaffolding (not a deep module).
 *
 * `DesktopWindowRegistry` is the chokepoint that lets `Desktop.window(id, spec, services?)`
 * self-register into a `Layer` without forcing the user to maintain a `Record<string, WindowSpec>`
 * keyed by window id. The implementation wraps an array push and a frozen snapshot. It owns no
 * durable desktop policy on its own (no per-window scope wiring, no host-side mutation, no audit).
 *
 * The thing that earns this module's place in the framework is not the registry — it is the
 * `services?: Layer<never, never, ...Scope.Scope...>` channel on each registration. That channel
 * lets the spine build per-window scoped resources INSIDE the window's lifetime so they die when
 * the window closes. That is the durable lifecycle policy. Without it, this module would be
 * pure cosmetic symmetry with `desktop-rpc-registry.ts` and would fail the AGENTS.md
 * "earn-its-place" check.
 */
export interface DesktopWindowRegistration {
  readonly id: string
  readonly spec: WindowSpec
  readonly services: Layer.Layer<never, never, Scope.Scope> | undefined
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
