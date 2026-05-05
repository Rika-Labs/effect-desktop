import { Cause, Effect, Exit, Schema } from "effect"

import {
  type ApiContractClass,
  type ApiContractSpec,
  type ApiLayer,
  type ApiMethodSpec,
  isStreamSpec
} from "./contracts.js"
import { type ApiClientResponse } from "./client.js"
import {
  HostProtocolMethodNotFoundError,
  HostProtocolRequestEnvelope,
  HostProtocolCancelledError,
  HostProtocolTimeoutError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  makeHostProtocolInvalidStateError,
  type HostProtocolError
} from "./protocol.js"

const StrictParseOptions = { onExcessProperty: "error" } as const
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_TERMINAL_STATE_TTL_MS = 30_000

export interface ApiHandlerRuntime<Env = never> {
  readonly dispatch: (
    request: HostProtocolRequestEnvelope
  ) => Effect.Effect<ApiClientResponse, HostProtocolError, Env>
}

export type BridgeCallTerminalState = "Completed" | "Failed" | "Canceled" | "TimedOut"

export type BridgeCallState =
  | {
      readonly tag: "Pending"
      readonly id: string
      readonly traceId: string
      readonly startedAt: number
    }
  | { readonly tag: "Authorized"; readonly id: string; readonly capability: string }
  | { readonly tag: "Running"; readonly id: string; readonly handler: string }
  | { readonly tag: "Completed"; readonly id: string; readonly completedAt: number }
  | { readonly tag: "Failed"; readonly id: string; readonly error: unknown }
  | {
      readonly tag: "Canceled"
      readonly id: string
      readonly canceledBy: "renderer" | "runtime" | "host"
    }
  | { readonly tag: "TimedOut"; readonly id: string; readonly timeoutMs: number }
  | {
      readonly tag: "RejectedLateFrame"
      readonly id: string
      readonly method: string
      readonly terminalState: BridgeCallTerminalState
    }

export interface ApiHandlerRuntimeOptions {
  readonly now?: () => number
  readonly onState?: (state: BridgeCallState) => Effect.Effect<void, never, never>
  readonly terminalStateTtlMs?: number
}

interface ResolvedApiHandlerRuntimeOptions {
  readonly now: () => number
  readonly onState: (state: BridgeCallState) => Effect.Effect<void, never, never>
  readonly terminalStateTtlMs: number
}

export type ApiLayerEnvironment<Layer> =
  Layer extends ApiLayer<string, infer Spec, infer Handlers>
    ? {
        readonly [Method in keyof Spec]: HandlerEnvironment<Handlers[Method]>
      }[keyof Spec]
    : never

type HandlerEnvironment<Handler> = Handler extends (
  ...args: infer _Args
) => Effect.Effect<unknown, unknown, infer Env>
  ? Env
  : never

type AnyApiLayer = {
  readonly contract: ApiContractClass<string, ApiContractSpec>
  readonly handlers: object
}

type BoundHandler = {
  readonly spec: ApiMethodSpec
  readonly handler: (input: unknown) => Effect.Effect<unknown, unknown, unknown>
}

type TerminalStateEntry = {
  readonly state: BridgeCallTerminalState
  readonly recordedAt: number
}

const makeHandlers = <Layers extends readonly AnyApiLayer[]>(
  ...layers: Layers
): ApiHandlerRuntime<ApiLayerEnvironment<Layers[number]>> => makeHandlersWithOptions({}, ...layers)

const makeHandlersWithOptions = <Layers extends readonly AnyApiLayer[]>(
  options: ApiHandlerRuntimeOptions,
  ...layers: Layers
): ApiHandlerRuntime<ApiLayerEnvironment<Layers[number]>> => {
  const table = new Map<string, BoundHandler>()
  const terminalStates = new Map<string, TerminalStateEntry>()
  const resolved = resolveOptions(options)

  for (const layer of layers) {
    for (const [method, spec] of Object.entries(layer.contract.spec)) {
      const operation = methodName(layer.contract.tag, method)
      const handler = Reflect.get(layer.handlers, method) as (
        this: object,
        input: unknown
      ) => Effect.Effect<unknown, unknown, unknown>

      table.set(operation, {
        spec,
        handler: (input) => handler.call(layer.handlers, input)
      })
    }
  }

  return Object.freeze({
    dispatch: (request: HostProtocolRequestEnvelope) =>
      dispatch(table, terminalStates, resolved, request) as Effect.Effect<
        ApiClientResponse,
        HostProtocolError,
        ApiLayerEnvironment<Layers[number]>
      >
  }) as ApiHandlerRuntime<ApiLayerEnvironment<Layers[number]>>
}

export const Handlers = Object.assign(makeHandlers, {
  withOptions: makeHandlersWithOptions
})

const dispatch = (
  table: ReadonlyMap<string, BoundHandler>,
  terminalStates: Map<string, TerminalStateEntry>,
  options: ResolvedApiHandlerRuntimeOptions,
  request: HostProtocolRequestEnvelope
): Effect.Effect<ApiClientResponse, HostProtocolError, unknown> =>
  Effect.gen(function* () {
    const now = options.now()
    purgeExpiredTerminalStates(terminalStates, now, options.terminalStateTtlMs)

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
      startedAt: now
    })

    const bound = table.get(request.method)

    if (bound === undefined) {
      const error = makeMethodNotFoundError(request.method)
      yield* failCall(terminalStates, options, request.id, error)
      return yield* Effect.fail(error)
    }

    const inputExit = yield* Effect.exit(decodeInput(request.method, bound.spec, request.payload))
    if (Exit.isFailure(inputExit)) {
      const error = yield* hostProtocolErrorFromCause(request.method, inputExit.cause)
      yield* failCall(terminalStates, options, request.id, error)
      return yield* Effect.fail(error)
    }

    yield* options.onState({
      tag: "Authorized",
      id: request.id,
      capability: bound.spec.permission ?? "public"
    })
    yield* options.onState({
      tag: "Running",
      id: request.id,
      handler: request.method
    })

    const handlerEffect = runWithTimeout(bound, request.method, inputExit.value)
    const exit = yield* Effect.exit(handlerEffect)

    if (Exit.isFailure(exit)) {
      const timeout = timeoutFromCause(exit.cause)
      if (timeout !== undefined) {
        recordTerminalState(terminalStates, request.id, "TimedOut", options)
        yield* options.onState({
          tag: "TimedOut",
          id: request.id,
          timeoutMs: timeout.timeoutMs
        })
        return yield* Effect.fail(timeout.error)
      }

      const canceled = cancelledFromCause(request.method, exit.cause)
      if (canceled !== undefined) {
        recordTerminalState(terminalStates, request.id, "Canceled", options)
        yield* options.onState({
          tag: "Canceled",
          id: request.id,
          canceledBy: "runtime"
        })
        return yield* Effect.fail(canceled)
      }

      const error = yield* encodeContractError(request.method, bound.spec, exit.cause)
      recordTerminalState(terminalStates, request.id, "Failed", options)
      yield* options.onState({
        tag: "Failed",
        id: request.id,
        error
      })
      return {
        kind: "failure",
        error
      } as const
    }

    const outputExit = yield* Effect.exit(encodeOutput(request.method, bound.spec, exit.value))
    if (Exit.isFailure(outputExit)) {
      const error = yield* hostProtocolErrorFromCause(request.method, outputExit.cause)
      yield* failCall(terminalStates, options, request.id, error)
      return yield* Effect.fail(error)
    }

    recordTerminalState(terminalStates, request.id, "Completed", options)
    yield* options.onState({
      tag: "Completed",
      id: request.id,
      completedAt: options.now()
    })
    return {
      kind: "success",
      payload: outputExit.value
    } as const
  })

const runWithTimeout = (
  bound: BoundHandler,
  operation: string,
  input: unknown
): Effect.Effect<unknown, unknown, unknown> => {
  const effect = bound.handler(input)
  const timeoutMs = bound.spec.timeoutMs ?? DEFAULT_TIMEOUT_MS

  if (bound.spec.cancellable === false || timeoutMs === 0) {
    return effect
  }

  return Effect.mapError(Effect.timeout(effect, timeoutMs), (error) =>
    isEffectTimeoutError(error) ? makeTimeoutError(operation, timeoutMs) : error
  )
}

const decodeInput = <Spec extends ApiMethodSpec>(
  operation: string,
  spec: Spec,
  payload: unknown
): Effect.Effect<Schema.Schema.Type<Spec["input"]>, HostProtocolError, never> =>
  Effect.mapError(
    Schema.decodeUnknownEffect(spec.input)(payload, StrictParseOptions) as Effect.Effect<
      Schema.Schema.Type<Spec["input"]>,
      unknown,
      never
    >,
    (error) => makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
  )

const encodeOutput = <Spec extends ApiMethodSpec>(
  operation: string,
  spec: Spec,
  output: unknown
): Effect.Effect<
  Schema.Codec.Encoded<Extract<Spec["output"], Schema.Schema<unknown>>>,
  HostProtocolError,
  never
> => {
  if (isStreamSpec(spec.output)) {
    return Effect.fail(
      makeHostProtocolInvalidOutputError(operation, "stream output is not a response")
    )
  }

  return Effect.mapError(
    Schema.encodeUnknownEffect(spec.output)(output, StrictParseOptions) as Effect.Effect<
      Schema.Codec.Encoded<Extract<Spec["output"], Schema.Schema<unknown>>>,
      unknown,
      never
    >,
    (error) => makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
  )
}

const encodeContractError = <Spec extends ApiMethodSpec>(
  operation: string,
  spec: Spec,
  cause: Cause.Cause<unknown>
): Effect.Effect<Schema.Codec.Encoded<Spec["error"]>, HostProtocolError, never> =>
  Effect.gen(function* () {
    const failure = cause.reasons.find(Cause.isFailReason)

    if (failure === undefined) {
      return yield* Effect.fail(makeHostProtocolInvalidOutputError(operation, String(cause)))
    }

    return yield* Effect.mapError(
      Schema.encodeUnknownEffect(spec.error)(failure.error, StrictParseOptions) as Effect.Effect<
        Schema.Codec.Encoded<Spec["error"]>,
        unknown,
        never
      >,
      (error) => makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
    )
  })

const makeMethodNotFoundError = (method: string): HostProtocolMethodNotFoundError =>
  new HostProtocolMethodNotFoundError({
    tag: "MethodNotFound",
    method,
    message: `method not found: ${method}`,
    operation: method,
    recoverable: false
  })

const makeTimeoutError = (operation: string, timeoutMs: number): HostProtocolTimeoutError =>
  new HostProtocolTimeoutError({
    tag: "Timeout",
    timeoutMs,
    message: `bridge call timed out after ${timeoutMs}ms`,
    operation,
    recoverable: true
  })

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

const failCall = (
  terminalStates: Map<string, TerminalStateEntry>,
  options: ResolvedApiHandlerRuntimeOptions,
  id: string,
  error: HostProtocolError
): Effect.Effect<void, never, never> =>
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
  state: BridgeCallTerminalState,
  options: ResolvedApiHandlerRuntimeOptions
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

const hostProtocolErrorFromCause = (
  operation: string,
  cause: Cause.Cause<HostProtocolError>
): Effect.Effect<HostProtocolError, never, never> =>
  Effect.sync(() => {
    const fail = cause.reasons.find(Cause.isFailReason)
    return fail?.error ?? makeHostProtocolInvalidOutputError(operation, String(cause))
  })

const timeoutFromCause = (
  cause: Cause.Cause<unknown>
): { readonly error: HostProtocolTimeoutError; readonly timeoutMs: number } | undefined => {
  const fail = cause.reasons.find(Cause.isFailReason)
  return isHostProtocolTimeoutError(fail?.error)
    ? {
        error: fail.error,
        timeoutMs: fail.error.timeoutMs
      }
    : undefined
}

const cancelledFromCause = (
  operation: string,
  cause: Cause.Cause<unknown>
): HostProtocolCancelledError | undefined =>
  cause.reasons.some(Cause.isInterruptReason) ? makeCancelledError(operation, "runtime") : undefined

const isEffectTimeoutError = (error: unknown): boolean => Cause.isTimeoutError(error)

const isHostProtocolTimeoutError = (error: unknown): error is HostProtocolTimeoutError =>
  typeof error === "object" && error !== null && "tag" in error && error.tag === "Timeout"

const resolveOptions = (options: ApiHandlerRuntimeOptions): ResolvedApiHandlerRuntimeOptions => ({
  now: options.now ?? Date.now,
  onState: options.onState ?? (() => Effect.void),
  terminalStateTtlMs: options.terminalStateTtlMs ?? DEFAULT_TERMINAL_STATE_TTL_MS
})

const methodName = (tag: string, method: string): string => `${tag}.${method}`

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
