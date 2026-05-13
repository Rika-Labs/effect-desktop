import {
  disabledNativeHostInspectorCollector,
  makePermissionInterceptorLayer,
  NativeHostEvent,
  type NativeHostInspectorCollectorApi,
  PermissionInterceptor,
  PermissionRegistry
} from "@effect-desktop/core"
import {
  type BridgeCallState,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  makeDesktopRpcHandlerRuntime,
  type Rpc,
  type RpcGroup
} from "@effect-desktop/bridge"
import { Effect, Layer } from "effect"

type NativeRpcGroup<Rpcs extends Rpc.Any> = RpcGroup.RpcGroup<Rpcs> & {
  readonly requests: ReadonlyMap<string, Rpcs>
}

export const makeNativeHostRpcRuntime = <Rpcs extends Rpc.Any, E = never, R = never>(
  group: NativeRpcGroup<Rpcs>,
  handlers: Layer.Layer<Rpc.ToHandler<Rpc.AddMiddleware<Rpcs, typeof PermissionInterceptor>>, E, R>,
  options: BridgeHandlerRuntimeOptions & {
    readonly nativeHostInspector?: NativeHostInspectorCollectorApi
    readonly nextTraceId?: () => string
  } = {}
): BridgeHandlerRuntime<R | PermissionRegistry> =>
  makeDesktopRpcHandlerRuntime(
    group.middleware(PermissionInterceptor),
    Layer.merge(handlers, makePermissionInterceptorLayer()),
    {
      ...options,
      onState: (state) =>
        Effect.all(
          [
            nativeHostInspectorState(options.nativeHostInspector, options.now ?? Date.now, state),
            options.onState?.(state) ?? Effect.void
          ],
          { discard: true }
        )
    }
  )

const nativeHostInspectorState = (
  inspector: NativeHostInspectorCollectorApi | undefined,
  now: () => number,
  state: BridgeCallState
) => (inspector ?? disabledNativeHostInspectorCollector).publish(nativeHostEventFromState(state, now))

const nativeHostEventFromState = (state: BridgeCallState, now: () => number): NativeHostEvent =>
  new NativeHostEvent({
    kind: "host",
    status: nativeHostEventStatus(state),
    operation: "NativeHost.rpc",
    ...("traceId" in state ? { traceId: state.traceId } : {}),
    ...("handler" in state
      ? { method: state.handler }
      : "method" in state
        ? { method: state.method }
        : {}),
    ...(state.tag === "Failed" ? { errorTag: "HostProtocolError" } : {}),
    message: state.tag,
    timestamp: "completedAt" in state ? state.completedAt : now()
  })

const nativeHostEventStatus = (state: BridgeCallState): NativeHostEvent["status"] => {
  switch (state.tag) {
    case "Pending":
    case "Authorized":
    case "Running":
      return "start"
    case "Completed":
      return "success"
    case "Canceled":
      return "interruption"
    case "Failed":
    case "RejectedLateFrame":
    case "TimedOut":
      return "failure"
  }
}
