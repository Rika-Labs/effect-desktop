import {
  makePermissionInterceptorLayer,
  PermissionInterceptor,
  PermissionRegistry
} from "@effect-desktop/core"
import {
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  makeDesktopRpcHandlerRuntime,
  type Rpc,
  type RpcGroup
} from "@effect-desktop/bridge"
import { Layer } from "effect"

type NativeRpcGroup<Rpcs extends Rpc.Any> = RpcGroup.RpcGroup<Rpcs> & {
  readonly requests: ReadonlyMap<string, Rpcs>
}

export const makeNativeHostRpcRuntime = <Rpcs extends Rpc.Any, E = never, R = never>(
  group: NativeRpcGroup<Rpcs>,
  handlers: Layer.Layer<Rpc.ToHandler<Rpc.AddMiddleware<Rpcs, typeof PermissionInterceptor>>, E, R>,
  options: BridgeHandlerRuntimeOptions & { readonly nextTraceId?: () => string } = {}
): BridgeHandlerRuntime<R | PermissionRegistry> =>
  makeDesktopRpcHandlerRuntime(
    group.middleware(PermissionInterceptor),
    Layer.merge(handlers, makePermissionInterceptorLayer()),
    options
  )
