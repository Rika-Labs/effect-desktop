import { Cause, Effect, Exit, Schema } from "effect"

import {
  type ApiContractClass,
  type ApiContractSpec,
  type ApiLayer,
  type ApiMethodSpec
} from "./contracts.js"
import { type ApiClientResponse } from "./client.js"
import {
  HostProtocolMethodNotFoundError,
  HostProtocolRequestEnvelope,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  type HostProtocolError
} from "./protocol.js"

const StrictParseOptions = { onExcessProperty: "error" } as const

export interface ApiHandlerRuntime<Env = never> {
  readonly dispatch: (
    request: HostProtocolRequestEnvelope
  ) => Effect.Effect<ApiClientResponse, HostProtocolError, Env>
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

export const Handlers = <Layers extends readonly AnyApiLayer[]>(
  ...layers: Layers
): ApiHandlerRuntime<ApiLayerEnvironment<Layers[number]>> => {
  const table = new Map<string, BoundHandler>()

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
      dispatch(table, request) as Effect.Effect<
        ApiClientResponse,
        HostProtocolError,
        ApiLayerEnvironment<Layers[number]>
      >
  }) as ApiHandlerRuntime<ApiLayerEnvironment<Layers[number]>>
}

const dispatch = (
  table: ReadonlyMap<string, BoundHandler>,
  request: HostProtocolRequestEnvelope
): Effect.Effect<ApiClientResponse, HostProtocolError, unknown> =>
  Effect.gen(function* () {
    const bound = table.get(request.method)

    if (bound === undefined) {
      return yield* Effect.fail(makeMethodNotFoundError(request.method))
    }

    const input = yield* decodeInput(request.method, bound.spec, request.payload)
    const exit = yield* Effect.exit(bound.handler(input))

    if (Exit.isFailure(exit)) {
      const error = yield* encodeContractError(request.method, bound.spec, exit.cause)
      return {
        kind: "failure",
        error
      } as const
    }

    const payload = yield* encodeOutput(request.method, bound.spec, exit.value)
    return {
      kind: "success",
      payload
    } as const
  })

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
): Effect.Effect<Schema.Codec.Encoded<Spec["output"]>, HostProtocolError, never> =>
  Effect.mapError(
    Schema.encodeUnknownEffect(spec.output)(output, StrictParseOptions) as Effect.Effect<
      Schema.Codec.Encoded<Spec["output"]>,
      unknown,
      never
    >,
    (error) => makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
  )

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

const methodName = (tag: string, method: string): string => `${tag}.${method}`

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
