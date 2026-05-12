import { Cause, Deferred, Effect, Exit, Fiber, Layer, Queue } from "effect"
import { Rpc, RpcGroup, RpcServer } from "effect/unstable/rpc"

import { type BridgeClientResponse } from "./client.js"
import {
  type BridgeHandlerRuntime,
  type BridgeHandlerRuntimeOptions,
  RendererOriginAuth
} from "./handlers.js"
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

const DEFAULT_TERMINAL_STATE_TTL_MS = 30_000

type RpcGroupWithRequests<Rpcs extends Rpc.Any> = RpcGroup.RpcGroup<Rpcs> & {
  readonly requests: ReadonlyMap<string, Rpcs>
}

type TerminalStateEntry = {
  readonly state: "Completed" | "Failed" | "Canceled" | "TimedOut"
  readonly recordedAt: number
}

type PendingCall = {
  fiber: Fiber.Fiber<BridgeClientResponse, unknown> | undefined
  cancel: ((request: HostProtocolCancelByRequestEnvelope) => Effect.Effect<void>) | undefined
  cancelledBy: "renderer" | "runtime" | "host" | undefined
}

interface ResolvedDesktopRpcHandlerOptions {
  readonly now: () => number
  readonly onState: NonNullable<BridgeHandlerRuntimeOptions["onState"]>
  readonly originAuth: RendererOriginAuth
  readonly terminalStateTtlMs: number
  readonly nextTraceId?: (() => string) | undefined
}

export const makeDesktopRpcHandlerRuntime = <Rpcs extends Rpc.Any, E = never, R = never>(
  group: RpcGroupWithRequests<Rpcs>,
  handlers: Layer.Layer<Rpc.ToHandler<Rpcs>, E, R>,
  options: BridgeHandlerRuntimeOptions & { readonly nextTraceId?: () => string } = {}
): BridgeHandlerRuntime<R> => {
  const resolved = resolveOptions(options)
  const terminalStates = new Map<string, TerminalStateEntry>()
  const pendingCalls = new Map<string, PendingCall>()

  return Object.freeze({
    dispatch: (request: HostProtocolRequestEnvelope) =>
      dispatch(group, handlers, terminalStates, pendingCalls, resolved, request) as Effect.Effect<
        BridgeClientResponse,
        HostProtocolError | E,
        R
      >,
    cancel: (request: HostProtocolCancelByRequestEnvelope) => cancel(pendingCalls, request)
  }) as BridgeHandlerRuntime<R>
}

const dispatch = <Rpcs extends Rpc.Any, E, R>(
  group: RpcGroupWithRequests<Rpcs>,
  handlers: Layer.Layer<Rpc.ToHandler<Rpcs>, E, R>,
  terminalStates: Map<string, TerminalStateEntry>,
  pendingCalls: Map<string, PendingCall>,
  options: ResolvedDesktopRpcHandlerOptions,
  request: HostProtocolRequestEnvelope
): Effect.Effect<BridgeClientResponse, HostProtocolError | E, any> =>
  Effect.scoped(
    Effect.gen(function* () {
      const startedAt = options.now()
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

      yield* options.onState({
        tag: "Pending",
        id: request.id,
        traceId: request.traceId,
        startedAt
      })

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
      const exit = yield* Effect.gen(function* () {
        const pending: PendingCall = {
          fiber: undefined,
          cancel: undefined,
          cancelledBy: undefined
        }
        const fiber = yield* Effect.forkScoped(
          runDispatch(group, handlers, terminalStates, pending, options, request)
        )
        pending.fiber = fiber
        pendingCalls.set(request.id, pending)

        return yield* Effect.exit(Fiber.join(fiber)).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              canceledBy = pending.cancelledBy ?? "runtime"
              pendingCalls.delete(request.id)
            })
          )
        )
      })

      if (Exit.isSuccess(exit)) {
        return exit.value
      }

      const canceled = cancelledFromCause(request.method, exit.cause, canceledBy)
      if (canceled !== undefined) {
        recordTerminalState(terminalStates, request.id, "Canceled", options)
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

const runDispatch = <Rpcs extends Rpc.Any, E, R>(
  group: RpcGroupWithRequests<Rpcs>,
  handlers: Layer.Layer<Rpc.ToHandler<Rpcs>, E, R>,
  terminalStates: Map<string, TerminalStateEntry>,
  pending: PendingCall,
  options: ResolvedDesktopRpcHandlerOptions,
  request: HostProtocolRequestEnvelope
): Effect.Effect<BridgeClientResponse, HostProtocolError | E, any> =>
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
      now: options.now,
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
      recordTerminalState(terminalStates, request.id, "Completed", options)
      yield* options.onState({
        tag: "Completed",
        id: request.id,
        completedAt: options.now()
      })
    } else {
      if (isHostProtocolCancelledError(result.error)) {
        recordTerminalState(terminalStates, request.id, "Canceled", options)
        yield* options.onState({
          tag: "Canceled",
          id: request.id,
          canceledBy: pending.cancelledBy ?? "runtime"
        })
        return yield* Effect.fail(result.error)
      }
      recordTerminalState(terminalStates, request.id, "Failed", options)
      yield* options.onState({
        tag: "Failed",
        id: request.id,
        error: result.error
      })
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
      Effect.forever(Queue.take(queue).pipe(Effect.flatMap(onEnvelope)))
  })

const failCall = (
  terminalStates: Map<string, TerminalStateEntry>,
  options: ResolvedDesktopRpcHandlerOptions,
  id: string,
  error: HostProtocolError
): Effect.Effect<void> =>
  Effect.gen(function* () {
    recordTerminalState(terminalStates, id, "Failed", options)
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
): void => {
  terminalStates.set(id, {
    state,
    recordedAt: options.now()
  })
}

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
  now: options.now ?? Date.now,
  onState: options.onState ?? (() => Effect.void),
  originAuth: options.originAuth ?? defaultRendererOriginAuth,
  terminalStateTtlMs: options.terminalStateTtlMs ?? DEFAULT_TERMINAL_STATE_TTL_MS,
  nextTraceId: options.nextTraceId
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
