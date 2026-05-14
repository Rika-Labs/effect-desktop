import { Context, Effect, Layer } from "effect"
import type { Rpc, RpcGroup } from "effect/unstable/rpc"

/**
 * Tactical scaffolding (not a deep module).
 *
 * `DesktopRpcRegistry` is the chokepoint that lets `Desktop.rpc(group, handlers)`
 * self-register into a `Layer` without forcing the user to thread a `(group, layer)`
 * pair through `Desktop.make`. The implementation is intentionally minimal — it
 * wraps an array push and a frozen snapshot. It owns no durable desktop policy
 * (no dedup, no lifecycle, no audit emission, no permission semantics).
 *
 * Per AGENTS.md: a custom abstraction must own durable desktop-specific policy,
 * lifecycle, security, or protocol translation. This registry, in its current
 * shape, satisfies none of those — it is a registration mechanism only. It earns
 * its place by mirroring the cluster `Entity` + `Sharding` registration shape
 * and by letting `Desktop.make({ rpcs })` accept a single composed `Layer`
 * instead of an array of pairs. Future work that wants to deepen this module:
 *
 *   - dedupe-on-conflict registration (today: silent override is impossible
 *     because the registry only appends; conflict surfaces later in
 *     `checkPermissions` as `duplicate-rpc`)
 *   - lifecycle-aware unregister (today: registrations live for the build
 *     scope only)
 *   - audit emission per registration (today: `AuditEvents` fires from
 *     `PermissionInterceptor`, not from registration itself)
 *
 * If any of those become real requirements, this is the file that grows. Until
 * then, treat it as a thin boundary, not as an architectural primitive.
 */
export type DesktopRpcRegistrationGroup = RpcGroup.Any & {
  readonly requests: ReadonlyMap<string, Rpc.Any>
}

export interface DesktopRpcRegistration<E = unknown, R = unknown> {
  readonly group: DesktopRpcRegistrationGroup
  readonly handlers: Layer.Layer<any, E, R>
}

export interface DesktopRpcRegistryApi {
  readonly register: (registration: DesktopRpcRegistration<any, any>) => Effect.Effect<void>
  readonly snapshot: Effect.Effect<ReadonlyArray<DesktopRpcRegistration<any, any>>>
}

export class DesktopRpcRegistry extends Context.Service<
  DesktopRpcRegistry,
  DesktopRpcRegistryApi
>()("@effect-desktop/core/DesktopRpcRegistry") {}

export const makeDesktopRpcRegistry = (): DesktopRpcRegistryApi => {
  const entries: DesktopRpcRegistration<any, any>[] = []
  return {
    register: (registration) =>
      Effect.sync(() => {
        entries.push(registration)
      }),
    snapshot: Effect.sync(() => Object.freeze([...entries]))
  }
}

export const DesktopRpcRegistryLive: Layer.Layer<DesktopRpcRegistry> = Layer.effect(
  DesktopRpcRegistry,
  Effect.sync(makeDesktopRpcRegistry)
)
