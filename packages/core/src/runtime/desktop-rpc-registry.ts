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
export type TypedDesktopRpcRegistrationGroup<Rpcs extends Rpc.Any> = RpcGroup.RpcGroup<Rpcs> & {
  readonly requests: ReadonlyMap<string, Rpc.Any>
}

export type DesktopRpcRegistrationGroup = RpcGroup.Any & {
  readonly requests: ReadonlyMap<string, Rpc.Any>
}

export interface DesktopRpcRegistration<Rpcs extends Rpc.Any, E = unknown, R = unknown> {
  readonly group: TypedDesktopRpcRegistrationGroup<Rpcs>
  readonly handlers: Layer.Layer<Rpc.ToHandler<Rpcs>, E, R>
  readonly serverLayer: Layer.Layer<never, unknown, unknown>
}

/**
 * Erased registry snapshot. `register(...)` preserves the typed group/handler
 * relationship at the declaration boundary; once stored with other RPC groups,
 * the concrete `Rpcs` union is existential. `serverLayer` is constructed while
 * `Rpcs` is still concrete, so the runtime spine does not need to rebuild a
 * typed `RpcServer.layer(...)` from erased data.
 */
export interface AnyDesktopRpcRegistration<E = unknown, R = unknown> {
  readonly group: DesktopRpcRegistrationGroup
  readonly handlers: Layer.Layer<never, E, R>
  readonly serverLayer: Layer.Layer<never, unknown, unknown>
}

export interface DesktopRpcRegistryApi {
  readonly register: <Rpcs extends Rpc.Any, E, R>(
    registration: DesktopRpcRegistration<Rpcs, E, R>
  ) => Effect.Effect<void>
  readonly snapshot: Effect.Effect<ReadonlyArray<AnyDesktopRpcRegistration>>
}

export class DesktopRpcRegistry extends Context.Service<
  DesktopRpcRegistry,
  DesktopRpcRegistryApi
>()("@effect-desktop/core/DesktopRpcRegistry") {}

export const makeDesktopRpcRegistry = (): DesktopRpcRegistryApi => {
  const entries: AnyDesktopRpcRegistration[] = []
  return {
    register: (registration) =>
      Effect.sync(() => {
        entries.push(eraseRegistration(registration))
      }),
    snapshot: Effect.sync(() => Object.freeze([...entries]))
  }
}

export const DesktopRpcRegistryLive: Layer.Layer<DesktopRpcRegistry> = Layer.effect(
  DesktopRpcRegistry,
  Effect.sync(makeDesktopRpcRegistry)
)

const eraseRegistration = <Rpcs extends Rpc.Any, E, R>(
  registration: DesktopRpcRegistration<Rpcs, E, R>
): AnyDesktopRpcRegistration =>
  // Registry snapshots are heterogeneous. The typed group/handler relation is
  // preserved inside each object but existential once stored beside other
  // groups; consumers that know their declaration layer E/R can narrow the
  // snapshot at that boundary.
  registration as unknown as AnyDesktopRpcRegistration
