import { Cause, Effect, Exit, Fiber, Schema, Stream, SubscriptionRef } from "effect"

import {
  type ApiContractClass,
  type ApiContractSpec,
  type ApiLayer,
  type ApiMethodSpec,
  isResourceSpec,
  isStreamSpec
} from "./contracts.js"
import { type ApiClientResponse } from "./client.js"
import {
  HostProtocolMethodNotFoundError,
  HostProtocolCancelByRequestEnvelope,
  HostProtocolRequestEnvelope,
  HostProtocolCancelledError,
  HostProtocolTimeoutError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  makeHostProtocolOriginInvalidError,
  makeHostProtocolInvalidStateError,
  type HostProtocolError
} from "./protocol.js"
import { redact } from "./redaction.js"
import type { RedactionFilterOptions } from "./redaction.js"

const StrictParseOptions = { onExcessProperty: "error" } as const
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_TERMINAL_STATE_TTL_MS = 30_000

export interface ApiHandlerRuntime<Env = never> {
  readonly dispatch: (
    request: HostProtocolRequestEnvelope
  ) => Effect.Effect<ApiClientResponse, HostProtocolError, Env>
  readonly cancel: (
    request: HostProtocolCancelByRequestEnvelope
  ) => Effect.Effect<void, HostProtocolError, never>
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

export interface BridgeCallRegistry {
  readonly record: (state: BridgeCallState) => Effect.Effect<void, never, never>
  readonly list: () => Effect.Effect<readonly BridgeCallState[], never, never>
  readonly observe: () => Stream.Stream<readonly BridgeCallState[], never, never>
}

export const makeBridgeCallRegistry = (
  maxEntries = 1_024
): Effect.Effect<BridgeCallRegistry, never, never> =>
  Effect.gen(function* () {
    const states = yield* SubscriptionRef.make<readonly BridgeCallState[]>([])

    return Object.freeze({
      record: (state) =>
        SubscriptionRef.update(states, (current) => [...current, state].slice(-maxEntries)),
      list: () => SubscriptionRef.get(states),
      observe: () => SubscriptionRef.changes(states)
    } satisfies BridgeCallRegistry)
  })

export interface ApiHandlerRuntimeOptions {
  readonly now?: () => number
  readonly onState?: (state: BridgeCallState) => Effect.Effect<void, never, never>
  readonly originAuth?: RendererOriginAuth
  readonly redaction?: RedactionFilterOptions
  readonly terminalStateTtlMs?: number
}

interface ResolvedApiHandlerRuntimeOptions {
  readonly now: () => number
  readonly onState: (state: BridgeCallState) => Effect.Effect<void, never, never>
  readonly originAuth: RendererOriginAuth
  readonly redaction: RedactionFilterOptions
  readonly terminalStateTtlMs: number
}

export interface RendererOriginAuth {
  readonly verify: (
    request: HostProtocolRequestEnvelope
  ) => Effect.Effect<void, HostProtocolError, never>
}

export const RendererOriginAuth = {
  fromCurrentTokens: (tokens: ReadonlyMap<string, string>): RendererOriginAuth =>
    Object.freeze({
      verify: (request: HostProtocolRequestEnvelope) => verifyRendererOrigin(tokens, request)
    }),
  unsafeDisabledForTests: Object.freeze({
    verify: () => Effect.void
  }) satisfies RendererOriginAuth
} as const

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

type PendingCall = {
  readonly fiber: Fiber.Fiber<unknown, unknown>
  readonly cancellable: boolean
  cancelledBy: "renderer" | "runtime" | "host" | undefined
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
  const pendingCalls = new Map<string, PendingCall>()
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
      dispatch(table, terminalStates, pendingCalls, resolved, request) as Effect.Effect<
        ApiClientResponse,
        HostProtocolError,
        ApiLayerEnvironment<Layers[number]>
      >,
    cancel: (request: HostProtocolCancelByRequestEnvelope) =>
      cancel(pendingCalls, resolved, request)
  }) as ApiHandlerRuntime<ApiLayerEnvironment<Layers[number]>>
}

export const Handlers = Object.assign(makeHandlers, {
  withOptions: makeHandlersWithOptions
})

const dispatch = (
  table: ReadonlyMap<string, BoundHandler>,
  terminalStates: Map<string, TerminalStateEntry>,
  pendingCalls: Map<string, PendingCall>,
  options: ResolvedApiHandlerRuntimeOptions,
  request: HostProtocolRequestEnvelope
): Effect.Effect<ApiClientResponse, HostProtocolError, unknown> =>
  Effect.gen(function* () {
    const now = options.now()
    purgeExpiredTerminalStates(terminalStates, now, options.terminalStateTtlMs)
    yield* options.originAuth.verify(request)

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

    let canceledBy: "renderer" | "runtime" | "host" = "runtime"
    const exit = yield* Effect.scoped(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkScoped(
          runWithTimeout(bound, request.method, inputExit.value)
        )
        const pending: PendingCall = {
          fiber,
          cancellable: bound.spec.cancellable !== false,
          cancelledBy: undefined
        }
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
    )

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

      const error = yield* encodeContractError(request.method, bound.spec, exit.cause)
      recordTerminalState(terminalStates, request.id, "Failed", options)
      const redactedError = redactForEmission(error, options)
      yield* options.onState({
        tag: "Failed",
        id: request.id,
        error: redactedError
      })
      return {
        kind: "failure",
        error: redactedError
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
  }).pipe(
    Effect.withSpan("HostProtocol.dispatch", {
      attributes: {
        id: request.id,
        method: request.method,
        traceId: request.traceId
      }
    })
  )

const cancel = (
  pendingCalls: Map<string, PendingCall>,
  _options: ResolvedApiHandlerRuntimeOptions,
  request: HostProtocolCancelByRequestEnvelope
): Effect.Effect<void, HostProtocolError, never> =>
  Effect.gen(function* () {
    const pending = pendingCalls.get(request.id)
    if (pending === undefined) {
      return yield* Effect.fail(makeHostProtocolInvalidStateError("Missing", "cancel", request.id))
    }
    if (!pending.cancellable) {
      return
    }

    pending.cancelledBy = "renderer"
    yield* Fiber.interrupt(pending.fiber)
  })

const runWithTimeout = (
  bound: BoundHandler,
  operation: string,
  input: unknown
): Effect.Effect<unknown, unknown, unknown> => {
  const effect = Effect.try({
    try: () => bound.handler(input),
    catch: (error) => error
  }).pipe(Effect.flatMap((effect) => effect))
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
): Effect.Effect<unknown, HostProtocolError, never> => {
  if (isStreamSpec(spec.output)) {
    return Effect.fail(
      makeHostProtocolInvalidOutputError(operation, "stream output is not a response")
    )
  }

  if (isResourceSpec(spec.output)) {
    return Effect.mapError(
      Schema.encodeUnknownEffect(spec.output.schema)(output, StrictParseOptions) as Effect.Effect<
        unknown,
        unknown,
        never
      >,
      (error) => makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
    )
  }

  return Effect.mapError(
    Schema.encodeUnknownEffect(spec.output)(output, StrictParseOptions) as Effect.Effect<
      unknown,
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

    const encoded = yield* Effect.mapError(
      Schema.encodeUnknownEffect(spec.error)(failure.error, StrictParseOptions) as Effect.Effect<
        Schema.Codec.Encoded<Spec["error"]>,
        unknown,
        never
      >,
      (error) => makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
    )
    return encoded
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
    const redactedError = redactForEmission(error, options)
    yield* options.onState({
      tag: "Failed",
      id,
      error: redactedError
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
  cause: Cause.Cause<unknown>,
  source: "renderer" | "runtime" | "host"
): HostProtocolCancelledError | undefined =>
  cause.reasons.some(Cause.isInterruptReason) ? makeCancelledError(operation, source) : undefined

const isEffectTimeoutError = (error: unknown): boolean => Cause.isTimeoutError(error)

const isHostProtocolTimeoutError = (error: unknown): error is HostProtocolTimeoutError =>
  typeof error === "object" && error !== null && "tag" in error && error.tag === "Timeout"

const resolveOptions = (options: ApiHandlerRuntimeOptions): ResolvedApiHandlerRuntimeOptions => ({
  now: options.now ?? Date.now,
  onState: options.onState ?? (() => Effect.void),
  originAuth: options.originAuth ?? defaultRendererOriginAuth,
  redaction: options.redaction ?? {},
  terminalStateTtlMs: options.terminalStateTtlMs ?? DEFAULT_TERMINAL_STATE_TTL_MS
})

const redactForEmission = <A>(value: A, options: ResolvedApiHandlerRuntimeOptions): A =>
  redact(value, options.redaction)

const defaultRendererOriginAuth: RendererOriginAuth = Object.freeze({
  verify: (request: HostProtocolRequestEnvelope) =>
    Effect.fail(
      makeHostProtocolOriginInvalidError(
        request.method,
        "renderer origin verifier is not configured"
      )
    )
})

const verifyRendererOrigin = (
  tokens: ReadonlyMap<string, string>,
  request: HostProtocolRequestEnvelope
): Effect.Effect<void, HostProtocolError, never> =>
  Effect.gen(function* () {
    if (request.windowId === undefined || request.originToken === undefined) {
      return yield* Effect.fail(
        makeHostProtocolOriginInvalidError(
          request.method,
          "renderer request is missing windowId or originToken"
        )
      )
    }

    const expected = tokens.get(request.windowId)
    if (expected === undefined || expected !== request.originToken) {
      return yield* Effect.fail(
        makeHostProtocolOriginInvalidError(request.method, "renderer origin token did not match")
      )
    }
  })

const methodName = (tag: string, method: string): string => `${tag}.${method}`

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
