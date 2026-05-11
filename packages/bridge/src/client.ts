import { Effect, Schema, Stream } from "effect"

import {
  type ApiContractClass,
  type ApiContractEvents,
  type ApiContractSpec,
  type ApiEventSpec,
  type ApiMethodSpec,
  type ApiResourceHandle,
  type ApiResourceSpec,
  type ApiStreamSpec,
  isResourceSpec,
  isStreamSpec
} from "./contracts.js"
import {
  HostProtocolCancelByRequestEnvelope,
  HostProtocolCancelledError,
  HostProtocolEventEnvelope,
  HostProtocolRequestEnvelope,
  HostProtocolStreamClosedError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  type HostProtocolError
} from "./protocol.js"
import { type ApiResourceExchange, type ApiResourceProxy, makeResourceProxy } from "./resources.js"
import {
  ApiStreamClosedFrame,
  ApiStreamCompleteFrame,
  ApiStreamDataFrame,
  ApiStreamErrorFrame,
  ApiStreamFrame,
  type HostProtocolStreamEnvelope
} from "./streams.js"

const StrictParseOptions = { onExcessProperty: "error" } as const

export interface ApiClientExchange {
  readonly request: (
    request: HostProtocolRequestEnvelope
  ) => Effect.Effect<ApiClientResponse, HostProtocolError, never>
  readonly subscribe?: (
    method: string
  ) => Stream.Stream<HostProtocolEventEnvelope, HostProtocolError, never>
  readonly stream?: (
    request: HostProtocolRequestEnvelope
  ) => Stream.Stream<HostProtocolStreamEnvelope, HostProtocolError, never>
  readonly cancel?: (
    request: HostProtocolCancelByRequestEnvelope
  ) => Effect.Effect<void, HostProtocolError, never>
  readonly resource?: ApiResourceExchange
}

export type ApiClientResponse = ApiClientSuccessResponse | ApiClientErrorResponse

export interface ApiClientSuccessResponse {
  readonly kind: "success"
  readonly payload: unknown
}

export interface ApiClientErrorResponse {
  readonly kind: "failure"
  readonly error: unknown
}

export interface ApiClientOptions {
  readonly nextRequestId?: () => string
  readonly nextTraceId?: () => string
  readonly now?: () => number
  readonly windowId?: string
  readonly originToken?: string
}

export interface ApiClientCallOptions {
  readonly signal?: AbortSignal
}

interface ResolvedApiClientOptions {
  readonly nextRequestId: () => string
  readonly nextTraceId: () => string
  readonly now: () => number
  readonly windowId: string | undefined
  readonly originToken: string | undefined
}

export type ApiClientMethod<Spec extends ApiMethodSpec> = Spec["output"] extends ApiStreamSpec
  ? undefined extends Schema.Schema.Type<Spec["input"]>
    ? (
        input?: Schema.Schema.Type<Spec["input"]>,
        options?: ApiClientCallOptions
      ) => Stream.Stream<
        Schema.Schema.Type<Spec["output"]["chunk"]>,
        Schema.Schema.Type<Spec["output"]["error"]> | HostProtocolError,
        never
      >
    : (
        input: Schema.Schema.Type<Spec["input"]>,
        options?: ApiClientCallOptions
      ) => Stream.Stream<
        Schema.Schema.Type<Spec["output"]["chunk"]>,
        Schema.Schema.Type<Spec["output"]["error"]> | HostProtocolError,
        never
      >
  : Spec["output"] extends ApiResourceSpec
    ? undefined extends Schema.Schema.Type<Spec["input"]>
      ? (
          input?: Schema.Schema.Type<Spec["input"]>,
          options?: ApiClientCallOptions
        ) => Effect.Effect<
          ApiResourceProxy<Spec["output"]["kind"], Spec["output"]["state"]>,
          Schema.Schema.Type<Spec["error"]> | HostProtocolError,
          never
        >
      : (
          input: Schema.Schema.Type<Spec["input"]>,
          options?: ApiClientCallOptions
        ) => Effect.Effect<
          ApiResourceProxy<Spec["output"]["kind"], Spec["output"]["state"]>,
          Schema.Schema.Type<Spec["error"]> | HostProtocolError,
          never
        >
    : undefined extends Schema.Schema.Type<Spec["input"]>
      ? (
          input?: Schema.Schema.Type<Spec["input"]>,
          options?: ApiClientCallOptions
        ) => Effect.Effect<
          Schema.Schema.Type<Extract<Spec["output"], Schema.Schema<unknown>>>,
          Schema.Schema.Type<Spec["error"]> | HostProtocolError,
          never
        >
      : (
          input: Schema.Schema.Type<Spec["input"]>,
          options?: ApiClientCallOptions
        ) => Effect.Effect<
          Schema.Schema.Type<Extract<Spec["output"], Schema.Schema<unknown>>>,
          Schema.Schema.Type<Spec["error"]> | HostProtocolError,
          never
        >

export type ApiClientEvent<Spec extends ApiEventSpec> = Stream.Stream<
  Schema.Schema.Type<Spec["payload"]>,
  HostProtocolError,
  never
>

export type ApiClientFor<Contract extends ApiContractClass> =
  Contract extends ApiContractClass<string, infer Spec, infer Events>
    ? { readonly [Method in keyof Spec]: ApiClientMethod<Spec[Method]> } & {
        readonly events: { readonly [Event in keyof Events]: ApiClientEvent<Events[Event]> }
      }
    : never

export type ApiClient<Contracts extends Readonly<Record<string, ApiContractClass>>> = {
  readonly [Namespace in keyof Contracts]: ApiClientFor<Contracts[Namespace]>
}

export const Client = <Contracts extends Readonly<Record<string, ApiContractClass>>>(
  contracts: Contracts,
  exchange: ApiClientExchange,
  options: ApiClientOptions = {}
): ApiClient<Contracts> => {
  const resolved = resolveOptions(options)
  const namespaces = Object.entries(contracts).map(([namespace, contract]) => [
    namespace,
    makeContractClient(contract, exchange, resolved)
  ])

  return Object.freeze(Object.fromEntries(namespaces)) as ApiClient<Contracts>
}

const makeContractClient = <Tag extends string, Spec extends ApiContractSpec>(
  contract: ApiContractClass<Tag, Spec>,
  exchange: ApiClientExchange,
  options: ResolvedApiClientOptions
): ApiClientFor<ApiContractClass<Tag, Spec>> => {
  const methods = {} as { [Method in keyof Spec]?: ApiClientMethod<Spec[Method]> }
  const contractEvents = (contract.events ?? {}) as ApiContractEvents
  const events = {} as Record<string, ApiClientEvent<ApiEventSpec>>

  for (const [method, methodSpec] of Object.entries(contract.spec) as Array<
    [Extract<keyof Spec, string>, Spec[Extract<keyof Spec, string>]]
  >) {
    methods[method] = ((
      input: Schema.Schema.Type<Spec[typeof method]["input"]>,
      callOptions?: ApiClientCallOptions
    ): Effect.Effect<unknown, unknown, never> | Stream.Stream<unknown, unknown, never> =>
      isStreamSpec(methodSpec.output)
        ? streamContractMethod(
            contract.tag,
            method,
            methodSpec as Spec[typeof method] & { readonly output: ApiStreamSpec },
            input,
            exchange,
            options,
            callOptions
          )
        : requestContractMethod(
            contract.tag,
            method,
            methodSpec,
            input,
            exchange,
            options,
            callOptions
          )) as ApiClientMethod<Spec[typeof method]> | undefined
  }

  for (const [event, eventSpec] of Object.entries(contractEvents) as Array<
    [
      Extract<keyof typeof contractEvents, string>,
      (typeof contractEvents)[Extract<keyof typeof contractEvents, string>]
    ]
  >) {
    events[event] = subscribeContractEvent(contract.tag, event, eventSpec, exchange)
  }

  return Object.freeze({
    ...methods,
    events: Object.freeze(events)
  }) as ApiClientFor<ApiContractClass<Tag, Spec, typeof contractEvents>>
}

const requestContractMethod = <Spec extends ApiMethodSpec>(
  tag: string,
  method: string,
  spec: Spec,
  input: Schema.Schema.Type<Spec["input"]>,
  exchange: ApiClientExchange,
  options: ResolvedApiClientOptions,
  callOptions: ApiClientCallOptions = {}
): Effect.Effect<unknown, Schema.Schema.Type<Spec["error"]> | HostProtocolError, never> =>
  Effect.gen(function* () {
    const operation = methodName(tag, method)
    const payload = yield* encodeInput(operation, spec, input)
    const request = makeRequest(operation, payload, options)
    const response = yield* runRequestWithCancellation(
      exchange,
      request,
      callOptions,
      operation,
      options.now
    )

    if (response.kind === "failure") {
      return yield* decodeContractError(operation, spec, response.error)
    }

    if (isResourceSpec(spec.output)) {
      return yield* decodeResourceOutput(operation, spec.output, response.payload, exchange)
    }

    return yield* decodeOutput(operation, spec, response.payload)
  })

const encodeInput = <Spec extends ApiMethodSpec>(
  operation: string,
  spec: Spec,
  input: Schema.Schema.Type<Spec["input"]>
): Effect.Effect<Schema.Codec.Encoded<Spec["input"]>, HostProtocolError, never> =>
  Effect.mapError(
    Schema.encodeEffect(spec.input)(input, StrictParseOptions) as Effect.Effect<
      Schema.Codec.Encoded<Spec["input"]>,
      unknown,
      never
    >,
    (error) => makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
  )

const decodeOutput = <Spec extends ApiMethodSpec>(
  operation: string,
  spec: Spec,
  payload: unknown
): Effect.Effect<
  Schema.Schema.Type<Extract<Spec["output"], Schema.Schema<unknown>>>,
  HostProtocolError,
  never
> =>
  Effect.mapError(
    Schema.decodeUnknownEffect(spec.output as Schema.Schema<unknown>)(
      payload,
      StrictParseOptions
    ) as Effect.Effect<
      Schema.Schema.Type<Extract<Spec["output"], Schema.Schema<unknown>>>,
      unknown,
      never
    >,
    (error) => makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
  )

const decodeResourceOutput = <Spec extends ApiResourceSpec>(
  operation: string,
  spec: Spec,
  payload: unknown,
  exchange: ApiClientExchange
): Effect.Effect<ApiResourceProxy<Spec["kind"], Spec["state"]>, HostProtocolError, never> =>
  Effect.gen(function* () {
    if (exchange.resource === undefined) {
      return yield* Effect.fail(
        makeHostProtocolInvalidOutputError(operation, "resource exchange does not support handles")
      )
    }

    const handle = yield* Effect.mapError(
      Schema.decodeUnknownEffect(spec.schema)(payload, StrictParseOptions) as Effect.Effect<
        ApiResourceHandle,
        unknown,
        never
      >,
      (error) => makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
    )

    if (handle.kind !== spec.kind || handle.state !== spec.state) {
      return yield* Effect.fail(
        makeHostProtocolInvalidOutputError(
          operation,
          `resource handle kind/state mismatch: expected ${spec.kind}:${spec.state}, received ${handle.kind}:${handle.state}`
        )
      )
    }

    return makeResourceProxy(
      spec,
      handle as ApiResourceHandle<Spec["kind"], Spec["state"]>,
      exchange.resource
    )
  })

const decodeContractError = <Spec extends ApiMethodSpec>(
  operation: string,
  spec: Spec,
  error: unknown
): Effect.Effect<never, Schema.Schema.Type<Spec["error"]> | HostProtocolError, never> =>
  Effect.flatMap(
    Effect.mapError(
      Schema.decodeUnknownEffect(spec.error)(error, StrictParseOptions) as Effect.Effect<
        Schema.Schema.Type<Spec["error"]>,
        unknown,
        never
      >,
      (schemaError) =>
        makeHostProtocolInvalidOutputError(operation, formatUnknownError(schemaError))
    ),
    (decoded) => Effect.fail(decoded)
  )

const subscribeContractEvent = <Spec extends ApiEventSpec>(
  tag: string,
  event: string,
  spec: Spec,
  exchange: ApiClientExchange
): ApiClientEvent<Spec> => {
  const operation = eventName(tag, event)

  if (exchange.subscribe === undefined) {
    return Stream.fail(
      makeHostProtocolInvalidOutputError(operation, "event exchange does not support subscriptions")
    )
  }

  return exchange
    .subscribe(operation)
    .pipe(Stream.mapEffect((envelope) => decodeEventPayload(operation, spec, envelope.payload)))
}

const streamContractMethod = <Spec extends ApiMethodSpec & { readonly output: ApiStreamSpec }>(
  tag: string,
  method: string,
  spec: Spec,
  input: Schema.Schema.Type<Spec["input"]>,
  exchange: ApiClientExchange,
  options: ResolvedApiClientOptions,
  callOptions: ApiClientCallOptions = {}
): Stream.Stream<
  Schema.Schema.Type<Spec["output"]["chunk"]>,
  Schema.Schema.Type<Spec["output"]["error"]> | HostProtocolError,
  never
> => {
  const operation = methodName(tag, method)

  const stream = exchange.stream
  if (stream === undefined) {
    return Stream.fail(
      makeHostProtocolInvalidOutputError(operation, "stream exchange does not support streams")
    )
  }

  return Stream.unwrap(
    Effect.gen(function* () {
      const payload = yield* encodeInput(operation, spec, input)
      const request = makeRequest(operation, payload, options)
      yield* failIfAlreadyAborted(request, callOptions)
      let terminal = false
      const removeAbortListener = yield* installAbortCancellation(
        exchange,
        request,
        callOptions,
        options.now
      )
      let cancelSent = false
      const cancelRequest = () => {
        if (cancelSent || exchange.cancel === undefined) {
          return
        }
        cancelSent = true
        Effect.runFork(exchange.cancel(makeCancelRequest(request, options.now)))
      }

      return stream(request).pipe(
        Stream.takeUntilEffect((envelope) => isTerminalStreamEnvelope(operation, envelope)),
        Stream.flatMap((envelope) =>
          decodeStreamEnvelope(operation, spec.output, envelope, () => {
            terminal = true
          })
        ),
        Stream.ensuring(
          Effect.sync(() => {
            removeAbortListener()
            if (!terminal) {
              cancelRequest()
            }
          })
        )
      )
    })
  ) as Stream.Stream<
    Schema.Schema.Type<Spec["output"]["chunk"]>,
    Schema.Schema.Type<Spec["output"]["error"]> | HostProtocolError,
    never
  >
}

const isTerminalStreamEnvelope = (
  operation: string,
  envelope: HostProtocolStreamEnvelope
): Effect.Effect<boolean, HostProtocolError, never> => {
  if (envelope.error !== undefined) {
    return Effect.succeed(true)
  }

  return decodeStreamFrame(operation, envelope.payload).pipe(
    Effect.map(
      (frame) =>
        frame instanceof ApiStreamErrorFrame ||
        frame instanceof ApiStreamCompleteFrame ||
        frame instanceof ApiStreamClosedFrame
    )
  )
}

const decodeStreamEnvelope = <Spec extends ApiStreamSpec>(
  operation: string,
  spec: Spec,
  envelope: HostProtocolStreamEnvelope,
  onTerminal: () => void = () => {}
): Stream.Stream<
  Schema.Schema.Type<Spec["chunk"]>,
  Schema.Schema.Type<Spec["error"]> | HostProtocolError,
  never
> => {
  if (envelope.error !== undefined) {
    onTerminal()
    return Stream.fail(envelope.error)
  }

  return Stream.fromEffect(decodeStreamFrame(operation, envelope.payload)).pipe(
    Stream.flatMap((frame) => {
      if (frame instanceof ApiStreamDataFrame) {
        return Stream.fromEffect(decodeStreamChunk(operation, spec, frame.chunk))
      }
      if (frame instanceof ApiStreamErrorFrame) {
        onTerminal()
        return Stream.fromEffect(decodeStreamError(operation, spec, frame.error))
      }
      if (frame instanceof ApiStreamCompleteFrame) {
        onTerminal()
        return Stream.empty
      }

      onTerminal()
      return Stream.fail(
        new HostProtocolStreamClosedError({
          tag: "StreamClosed",
          streamId: envelope.resourceId ?? envelope.id,
          message: "stream was closed",
          operation,
          recoverable: false
        })
      )
    })
  )
}

const decodeEventPayload = <Spec extends ApiEventSpec>(
  operation: string,
  spec: Spec,
  payload: unknown
): Effect.Effect<Schema.Schema.Type<Spec["payload"]>, HostProtocolError, never> =>
  Effect.mapError(
    Schema.decodeUnknownEffect(spec.payload)(payload, StrictParseOptions) as Effect.Effect<
      Schema.Schema.Type<Spec["payload"]>,
      unknown,
      never
    >,
    (error) => makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
  )

const decodeStreamFrame = (
  operation: string,
  payload: unknown
): Effect.Effect<ApiStreamFrame, HostProtocolError, never> =>
  Effect.mapError(
    Schema.decodeUnknownEffect(ApiStreamFrame)(payload, StrictParseOptions) as Effect.Effect<
      ApiStreamFrame,
      unknown,
      never
    >,
    (error) => makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
  )

const decodeStreamChunk = <Spec extends ApiStreamSpec>(
  operation: string,
  spec: Spec,
  chunk: unknown
): Effect.Effect<Schema.Schema.Type<Spec["chunk"]>, HostProtocolError, never> =>
  Effect.mapError(
    Schema.decodeUnknownEffect(spec.chunk)(chunk, StrictParseOptions) as Effect.Effect<
      Schema.Schema.Type<Spec["chunk"]>,
      unknown,
      never
    >,
    (error) => makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
  )

const decodeStreamError = <Spec extends ApiStreamSpec>(
  operation: string,
  spec: Spec,
  error: unknown
): Effect.Effect<never, Schema.Schema.Type<Spec["error"]> | HostProtocolError, never> =>
  Effect.flatMap(
    Effect.mapError(
      Schema.decodeUnknownEffect(spec.error)(error, StrictParseOptions) as Effect.Effect<
        Schema.Schema.Type<Spec["error"]>,
        unknown,
        never
      >,
      (schemaError) =>
        makeHostProtocolInvalidOutputError(operation, formatUnknownError(schemaError))
    ),
    (decoded) => Effect.fail(decoded)
  )

const runRequestWithCancellation = (
  exchange: ApiClientExchange,
  request: HostProtocolRequestEnvelope,
  options: ApiClientCallOptions,
  operation: string,
  now: () => number
): Effect.Effect<ApiClientResponse, HostProtocolError, never> =>
  Effect.gen(function* () {
    yield* failIfAlreadyAborted(request, options)
    if (options.signal === undefined) {
      return yield* exchange.request(request)
    }

    const cancelRequest = () => {
      if (exchange.cancel === undefined) {
        return
      }
      Effect.runFork(exchange.cancel(makeCancelRequest(request, now)))
    }

    const failWithCancel = makeCancelledError(operation)
    const signal = options.signal
    let removeAbortListener = () => {}
    const abortEffect = Effect.callback<never, HostProtocolError, never>((resume) => {
      const cancelInFlight = () => {
        cancelRequest()
        resume(Effect.fail(failWithCancel))
      }

      if (signal.aborted) {
        cancelInFlight()
        return Effect.void
      }

      const onAbort = () => {
        cancelInFlight()
        removeAbortListener()
      }

      signal.addEventListener("abort", onAbort, { once: true })
      removeAbortListener = () => signal.removeEventListener("abort", onAbort)
      return Effect.sync(removeAbortListener)
    })

    return yield* Effect.raceFirst(exchange.request(request), abortEffect).pipe(
      Effect.ensuring(Effect.sync(removeAbortListener))
    )
  })

const failIfAlreadyAborted = (
  request: HostProtocolRequestEnvelope,
  options: ApiClientCallOptions
): Effect.Effect<void, HostProtocolError, never> =>
  Effect.sync(() => {
    return options.signal?.aborted === true
      ? Effect.fail(makeCancelledError(request.method))
      : Effect.void
  }).pipe(Effect.flatten)

const installAbortCancellation = (
  exchange: ApiClientExchange,
  request: HostProtocolRequestEnvelope,
  options: ApiClientCallOptions,
  now: () => number
): Effect.Effect<() => void, HostProtocolError, never> =>
  Effect.sync(() => {
    if (options.signal === undefined || exchange.cancel === undefined) {
      return () => {
        return
      }
    }

    const signal = options.signal
    const cancelRequest = exchange.cancel
    const cancel = (): void => {
      Effect.runFork(cancelRequest(makeCancelRequest(request, now)))
    }

    if (signal.aborted) {
      cancel()
      return () => {
        return
      }
    }

    signal.addEventListener("abort", cancel, { once: true })
    return () => {
      signal.removeEventListener("abort", cancel)
    }
  })

const makeCancelRequest = (
  request: HostProtocolRequestEnvelope,
  now: () => number
): HostProtocolCancelByRequestEnvelope =>
  new HostProtocolCancelByRequestEnvelope({
    kind: "cancel",
    id: request.id,
    timestamp: now(),
    traceId: request.traceId
  })

const makeCancelledError = (operation: string): HostProtocolCancelledError =>
  new HostProtocolCancelledError({
    tag: "Cancelled",
    source: "renderer",
    message: "bridge call canceled by renderer",
    operation,
    recoverable: true
  })

const makeRequest = (
  method: string,
  payload: unknown,
  options: ResolvedApiClientOptions
): HostProtocolRequestEnvelope => {
  const request = {
    kind: "request",
    id: options.nextRequestId(),
    method,
    timestamp: options.now(),
    traceId: options.nextTraceId()
  } as const

  return new HostProtocolRequestEnvelope({
    ...request,
    ...(payload === undefined ? {} : { payload }),
    ...(options.windowId === undefined ? {} : { windowId: options.windowId }),
    ...(options.originToken === undefined ? {} : { originToken: options.originToken })
  })
}

const resolveOptions = (options: ApiClientOptions): ResolvedApiClientOptions => ({
  nextRequestId: options.nextRequestId ?? (() => `request-${globalThis.crypto.randomUUID()}`),
  nextTraceId: options.nextTraceId ?? (() => `trace-${globalThis.crypto.randomUUID()}`),
  now: options.now ?? Date.now,
  windowId: options.windowId,
  originToken: options.originToken
})

const methodName = (tag: string, method: string): string => `${tag}.${method}`
const eventName = (tag: string, event: string): string => `${tag}.${event}`

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
