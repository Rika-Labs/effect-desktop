import { Context, Effect, Layer } from "effect"
import type { Rpc, RpcGroup } from "effect/unstable/rpc"

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
