import {
  disabledNativeHostInspectorCollector,
  makePermissionInterceptorLayer,
  NativeHostEvent,
  type NativeHostInspectorCollectorApi,
  PermissionInterceptor,
  PermissionRegistry
} from "@orika/core"
import {
  type BridgeCallState,
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  type HostProtocolError,
  makeDesktopRpcHandlerRuntime,
  type Rpc,
  type RpcGroup
} from "@orika/bridge"
import { Clock, Effect, Layer } from "effect"

type NativeRpcGroup<Rpcs extends Rpc.Any> = RpcGroup.RpcGroup<Rpcs> & {
  readonly requests: ReadonlyMap<string, Rpcs>
}

export const makeNativeHostRpcRuntime = <Rpcs extends Rpc.Any, E extends HostProtocolError = never>(
  group: NativeRpcGroup<Rpcs>,
  handlers: Layer.Layer<
    Rpc.ToHandler<Rpc.AddMiddleware<Rpcs, typeof PermissionInterceptor>>,
    E,
    unknown
  >,
  options: BridgeHandlerRuntimeOptions & {
    readonly nativeHostInspector?: NativeHostInspectorCollectorApi
    readonly nextTraceId?: () => string
  } = {}
): BridgeHandlerRuntime<PermissionRegistry> => {
  const runtime = makeDesktopRpcHandlerRuntime(
    group.middleware(PermissionInterceptor),
    Layer.merge(handlers, makePermissionInterceptorLayer()),
    {
      ...options,
      onState: (state) =>
        Effect.all(
          [
            nativeHostInspectorState(options.nativeHostInspector, options.now, state),
            options.onState?.(state) ?? Effect.void
          ],
          { discard: true }
        )
    }
  )
  return runtime as BridgeHandlerRuntime<PermissionRegistry>
}

const nativeHostInspectorState = (
  inspector: NativeHostInspectorCollectorApi | undefined,
  now: (() => number) | undefined,
  state: BridgeCallState
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const timestamp =
      "completedAt" in state
        ? state.completedAt
        : now === undefined
          ? yield* Clock.currentTimeMillis
          : yield* Effect.sync(now)

    yield* (inspector ?? disabledNativeHostInspectorCollector).publish(
      nativeHostEventFromState(state, timestamp)
    )
  })

const nativeHostEventFromState = (state: BridgeCallState, timestamp: number): NativeHostEvent =>
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
    timestamp
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
