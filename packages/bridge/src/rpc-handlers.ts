import { Cause, Clock, Deferred, Effect, Exit, Fiber, Layer, Queue, Scope, Stream } from "effect"
import { Rpc, RpcGroup, RpcServer } from "effect/unstable/rpc"

import { type BridgeClientResponse } from "./client.js"
import {
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  RendererOriginAuth
} from "./runtime.js"
import {
  type DesktopTransportRun,
  type DesktopTransportSend,
  type HostProtocolEnvelope,
  type HostProtocolError,
  HostProtocolCancelByRequestEnvelope,
  HostProtocolCancelledError,
  HostProtocolMethodNotFoundError,
  HostProtocolRequestEnvelope,
  makeDesktopServerProtocol,
  makeHostProtocolInvalidStateError,
  makeHostProtocolOriginInvalidError
} from "./protocol.js"
import {
  BridgeInspectorEvent,
  type BridgeInspector,
  emitBridgeInspectorEvent,
  hostProtocolErrorTag
} from "./inspector.js"

const DEFAULT_TERMINAL_STATE_TTL_MS = 30_000

type RpcGroupWithRequests<Rpcs extends Rpc.Any> = RpcGroup.RpcGroup<Rpcs> & {
  readonly requests: ReadonlyMap<string, Rpcs>
}

type RpcServerLayerRequirements<Rpcs extends Rpc.Any> = Rpc.ToHandler<Rpcs> | Rpc.Middleware<Rpcs>

type RpcServerRuntimeEnvironment<Rpcs extends Rpc.Any, R> = R | Rpc.ServicesServer<Rpcs>

type TerminalStateEntry = {
  readonly state: "Completed" | "Failed" | "Canceled" | "TimedOut"
  readonly recordedAt: number
}

type PendingCall = {
  fiber: Fiber.Fiber<BridgeClientResponse, unknown> | undefined
  cancel: ((request: HostProtocolCancelByRequestEnvelope) => Effect.Effect<void>) | undefined
  cancelledBy: "renderer" | "runtime" | "host" | undefined
  cancelRequested: boolean
}

interface ResolvedDesktopRpcHandlerOptions {
  readonly now?: (() => number) | undefined
  readonly onState: NonNullable<BridgeHandlerRuntimeOptions["onState"]>
  readonly originAuth: RendererOriginAuth
  readonly terminalStateTtlMs: number
  readonly nextTraceId?: (() => string) | undefined
  readonly inspector: BridgeInspector | undefined
}

export const makeDesktopRpcHandlerRuntime = <
  Rpcs extends Rpc.Any,
  E extends HostProtocolError = never,
  R = never
>(
  group: RpcGroupWithRequests<Rpcs>,
  handlers: Layer.Layer<RpcServerLayerRequirements<Rpcs>, E, R>,
  options: BridgeHandlerRuntimeOptions & { readonly nextTraceId?: () => string } = {}
): BridgeHandlerRuntime<RpcServerRuntimeEnvironment<Rpcs, R>> => {
  const resolved = resolveOptions(options)
  const terminalStates = new Map<string, TerminalStateEntry>()
  const pendingCalls = new Map<string, PendingCall>()

  return Object.freeze({
    dispatch: (request: HostProtocolRequestEnvelope) =>
      dispatch(group, handlers, terminalStates, pendingCalls, resolved, request),
    cancel: (request: HostProtocolCancelByRequestEnvelope) => cancel(pendingCalls, request)
  } satisfies BridgeHandlerRuntime<RpcServerRuntimeEnvironment<Rpcs, R>>)
}

const dispatch = <Rpcs extends Rpc.Any, E extends HostProtocolError, R>(
  group: RpcGroupWithRequests<Rpcs>,
  handlers: Layer.Layer<RpcServerLayerRequirements<Rpcs>, E, R>,
  terminalStates: Map<string, TerminalStateEntry>,
  pendingCalls: Map<string, PendingCall>,
  options: ResolvedDesktopRpcHandlerOptions,
  request: HostProtocolRequestEnvelope
): Effect.Effect<
  BridgeClientResponse,
  HostProtocolError | E,
  RpcServerRuntimeEnvironment<Rpcs, R>
> =>
  Effect.scoped(
    Effect.gen(function* () {
      const startedAt = yield* currentTimeMillis(options)
      purgeExpiredTerminalStates(terminalStates, startedAt, options.terminalStateTtlMs)

      const priorTerminalState = terminalStates.get(request.id)?.state
      if (priorTerminalState !== undefined) {
        yield* options.onState({
          tag: "RejectedLateFrame",
          id: request.id,
          method: request.method,
          terminalState: priorTerminalState
        })
        return yield* Effect.fail(
          makeHostProtocolInvalidStateError(priorTerminalState, "dispatch", request.method)
        )
      }

      if (pendingCalls.has(request.id)) {
        return yield* Effect.fail(
          makeHostProtocolInvalidStateError("Pending", "dispatch", request.method)
        )
      }

      const pending: PendingCall = {
        fiber: undefined,
        cancel: undefined,
        cancelledBy: undefined,
        cancelRequested: false
      }
      pendingCalls.set(request.id, pending)
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (pendingCalls.get(request.id) === pending) {
            pendingCalls.delete(request.id)
          }
        })
      )

      yield* options.onState({
        tag: "Pending",
        id: request.id,
        traceId: request.traceId,
        startedAt
      })
      yield* emitBridgeInspectorEvent(
        options.inspector,
        new BridgeInspectorEvent({
          kind: "rpc.request",
          boundary: "runtime",
          direction: "inbound",
          method: request.method,
          requestId: request.id,
          traceId: request.traceId,
          timestamp: startedAt
        })
      )

      const originExit = yield* Effect.exit(options.originAuth.verify(request))
      if (originExit._tag === "Failure") {
        const error = originFailure(request.method)
        yield* failCall(terminalStates, options, request.id, error)
        return yield* Effect.fail(error)
      }

      if (!group.requests.has(request.method)) {
        const error = methodNotFound(request.method)
        yield* failCall(terminalStates, options, request.id, error)
        return yield* Effect.fail(error)
      }

      let canceledBy: "renderer" | "runtime" | "host" = "runtime"
      const fiber = yield* Effect.forkScoped(
        runDispatch(group, handlers, terminalStates, pending, options, request)
      )
      pending.fiber = fiber
      if (pending.cancelRequested) {
        yield* Fiber.interrupt(fiber)
      }

      const exit = yield* Effect.exit(Fiber.join(fiber)).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            canceledBy = pending.cancelledBy ?? "runtime"
          })
        )
      )

      if (Exit.isSuccess(exit)) {
        return exit.value
      }

      const canceled = cancelledFromCause(request.method, exit.cause, canceledBy)
      if (canceled !== undefined) {
        yield* recordTerminalState(terminalStates, request.id, "Canceled", options)
        yield* options.onState({
          tag: "Canceled",
          id: request.id,
          canceledBy
        })
        return yield* Effect.fail(canceled)
      }

      return yield* Effect.fail(Cause.squash(exit.cause) as HostProtocolError | E)
    })
  )

const runDispatch = <Rpcs extends Rpc.Any, E extends HostProtocolError, R>(
  group: RpcGroupWithRequests<Rpcs>,
  handlers: Layer.Layer<RpcServerLayerRequirements<Rpcs>, E, R>,
  terminalStates: Map<string, TerminalStateEntry>,
  pending: PendingCall,
  options: ResolvedDesktopRpcHandlerOptions,
  request: HostProtocolRequestEnvelope
): Effect.Effect<
  BridgeClientResponse,
  HostProtocolError | E,
  RpcServerRuntimeEnvironment<Rpcs, R> | Scope.Scope
> =>
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<HostProtocolEnvelope>()
    const response = yield* Deferred.make<BridgeClientResponse, HostProtocolError>()
    const transport = desktopRpcHandlerTransport(queue, response)
    pending.cancel = (cancelRequest) =>
      Queue.offer(
        queue,
        new HostProtocolCancelByRequestEnvelope({
          kind: "cancel",
          id: request.id,
          timestamp: cancelRequest.timestamp,
          traceId: cancelRequest.traceId
        })
      ).pipe(Effect.asVoid)
    const protocol = yield* makeDesktopServerProtocol(transport, {
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.nextTraceId === undefined ? {} : { nextTraceId: options.nextTraceId })
    })

    yield* Layer.build(
      RpcServer.layer(group).pipe(
        Layer.provide(handlers),
        Layer.provide(Layer.succeed(RpcServer.Protocol)(protocol))
      )
    )

    yield* options.onState({
      tag: "Running",
      id: request.id,
      handler: request.method
    })
    yield* Queue.offer(
      queue,
      new HostProtocolRequestEnvelope({
        kind: "request",
        id: request.id,
        method: request.method,
        timestamp: request.timestamp,
        traceId: request.traceId,
        ...(request.windowId === undefined ? {} : { windowId: request.windowId }),
        ...(request.originToken === undefined ? {} : { originToken: request.originToken }),
        ...(request.payload === undefined ? {} : { payload: request.payload })
      })
    )
    const result = yield* Deferred.await(response)
    if (result.kind === "success") {
      const completedAt = yield* currentTimeMillis(options)
      yield* recordTerminalState(terminalStates, request.id, "Completed", options)
      yield* options.onState({
        tag: "Completed",
        id: request.id,
        completedAt
      })
      yield* emitBridgeInspectorEvent(
        options.inspector,
        new BridgeInspectorEvent({
          kind: "rpc.response",
          boundary: "runtime",
          direction: "outbound",
          method: request.method,
          requestId: request.id,
          traceId: request.traceId,
          timestamp: completedAt
        })
      )
    } else {
      if (isHostProtocolCancelledError(result.error)) {
        yield* recordTerminalState(terminalStates, request.id, "Canceled", options)
        yield* options.onState({
          tag: "Canceled",
          id: request.id,
          canceledBy: pending.cancelledBy ?? "runtime"
        })
        return yield* Effect.fail(result.error)
      }
      const failedAt = yield* currentTimeMillis(options)
      yield* recordTerminalState(terminalStates, request.id, "Failed", options)
      yield* options.onState({
        tag: "Failed",
        id: request.id,
        error: result.error
      })
      yield* emitBridgeInspectorEvent(
        options.inspector,
        new BridgeInspectorEvent({
          kind: "rpc.failure",
          boundary: "runtime",
          direction: "outbound",
          method: request.method,
          requestId: request.id,
          traceId: request.traceId,
          timestamp: failedAt,
          errorTag: hostProtocolErrorTag(result.error)
        })
      )
    }
    return result
  })

const cancel = (
  pendingCalls: Map<string, PendingCall>,
  request: HostProtocolCancelByRequestEnvelope
): Effect.Effect<void, HostProtocolError, never> =>
  Effect.gen(function* () {
    const pending = pendingCalls.get(request.id)
    if (pending === undefined) {
      return yield* Effect.fail(makeHostProtocolInvalidStateError("Missing", "cancel", request.id))
    }

    pending.cancelledBy = "renderer"
    pending.cancelRequested = true
    if (pending.cancel !== undefined) {
      return yield* pending.cancel(request)
    }
    if (pending.fiber !== undefined) {
      yield* Fiber.interrupt(pending.fiber)
    }
  })

const desktopRpcHandlerTransport = (
  queue: Queue.Queue<HostProtocolEnvelope>,
  response: Deferred.Deferred<BridgeClientResponse, HostProtocolError>
): DesktopTransportSend & DesktopTransportRun =>
  Object.freeze({
    send: (envelope: HostProtocolEnvelope) => {
      if (envelope.kind === "response") {
        return Deferred.done(
          response,
          envelope.error === undefined
            ? Exit.succeed({ kind: "success", payload: envelope.payload } as const)
            : Exit.succeed({ kind: "failure", error: envelope.error } as const)
        )
      }
      if (envelope.kind === "stream") {
        if (envelope.error !== undefined) {
          return Deferred.done(
            response,
            Exit.succeed({ kind: "failure", error: envelope.error } as const)
          )
        }
        return Effect.void
      }
      return Effect.void
    },
    run: (onEnvelope: (envelope: HostProtocolEnvelope) => Effect.Effect<void>) =>
      Stream.fromQueue(queue).pipe(Stream.runForEach(onEnvelope), Effect.andThen(Effect.never))
  })

const failCall = (
  terminalStates: Map<string, TerminalStateEntry>,
  options: ResolvedDesktopRpcHandlerOptions,
  id: string,
  error: HostProtocolError
): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* recordTerminalState(terminalStates, id, "Failed", options)
    yield* options.onState({
      tag: "Failed",
      id,
      error
    })
  })

const recordTerminalState = (
  terminalStates: Map<string, TerminalStateEntry>,
  id: string,
  state: TerminalStateEntry["state"],
  options: ResolvedDesktopRpcHandlerOptions
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const recordedAt = yield* currentTimeMillis(options)
    terminalStates.set(id, {
      state,
      recordedAt
    })
  })

const currentTimeMillis = (
  options: ResolvedDesktopRpcHandlerOptions
): Effect.Effect<number, never, never> =>
  options.now === undefined ? Clock.currentTimeMillis : Effect.sync(options.now)

const purgeExpiredTerminalStates = (
  terminalStates: Map<string, TerminalStateEntry>,
  now: number,
  ttlMs: number
): void => {
  if (ttlMs === 0) {
    terminalStates.clear()
    return
  }

  const cutoff = now - ttlMs
  for (const [id, entry] of terminalStates) {
    if (entry.recordedAt < cutoff) {
      terminalStates.delete(id)
    }
  }
}

const cancelledFromCause = (
  operation: string,
  cause: Cause.Cause<unknown>,
  source: "renderer" | "runtime" | "host"
): HostProtocolCancelledError | undefined =>
  cause.reasons.some(Cause.isInterruptReason) ? makeCancelledError(operation, source) : undefined

const makeCancelledError = (
  operation: string,
  source: "renderer" | "runtime" | "host"
): HostProtocolCancelledError =>
  new HostProtocolCancelledError({
    tag: "Cancelled",
    source,
    message: `bridge call canceled by ${source}`,
    operation,
    recoverable: true
  })

const isHostProtocolCancelledError = (error: unknown): error is HostProtocolCancelledError =>
  typeof error === "object" && error !== null && "tag" in error && error.tag === "Cancelled"

const methodNotFound = (method: string): HostProtocolMethodNotFoundError =>
  new HostProtocolMethodNotFoundError({
    tag: "MethodNotFound",
    method,
    message: `method not found: ${method}`,
    operation: method,
    recoverable: false
  })

const originFailure = (operation: string): HostProtocolError =>
  makeHostProtocolOriginInvalidError(operation, "renderer origin verifier rejected request")

const resolveOptions = (
  options: BridgeHandlerRuntimeOptions & { readonly nextTraceId?: () => string }
): ResolvedDesktopRpcHandlerOptions => ({
  now: options.now,
  onState: options.onState ?? (() => Effect.void),
  originAuth: options.originAuth ?? defaultRendererOriginAuth,
  terminalStateTtlMs: options.terminalStateTtlMs ?? DEFAULT_TERMINAL_STATE_TTL_MS,
  nextTraceId: options.nextTraceId,
  inspector: options.inspector
})

const defaultRendererOriginAuth: RendererOriginAuth = Object.freeze({
  verify: (request: HostProtocolRequestEnvelope) =>
    Effect.fail(
      makeHostProtocolOriginInvalidError(
        request.method,
        "renderer origin verifier is not configured"
      )
    )
})
