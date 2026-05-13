import { Cause, Effect, Exit, Fiber, Queue, Schema, Stream } from "effect"

import {
  type BridgeContract,
  type BridgeContractEvents,
  type BridgeContractSpec,
  type BridgeContractCodec,
  type BridgeContractCodecType,
  type BridgeEventSpec,
  type BridgeMethodSpec,
  type BridgeStreamSpec,
  isStreamSpec
} from "./contracts.js"
import {
  HostProtocolCancelByRequestEnvelope,
  HostProtocolEventEnvelope,
  HostProtocolError as HostProtocolErrorSchema,
  HostProtocolRequestEnvelope,
  HostProtocolResponseEnvelope,
  HostProtocolStreamClosedError,
  makeHostProtocolInternalError,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  validateHostProtocolNonEmptyString,
  validateOptionalHostProtocolNonEmptyString,
  validateHostProtocolTimestamp,
  type DesktopTransportRun,
  type DesktopTransportSend,
  type HostProtocolEnvelope,
  type HostProtocolError
} from "./protocol.js"
import {
  BridgeStreamClosedFrame,
  BridgeStreamCompleteFrame,
  BridgeStreamDataFrame,
  BridgeStreamErrorFrame,
  BridgeStreamFrame,
  type HostProtocolStreamEnvelope
} from "./streams.js"

const StrictParseOptions = { onExcessProperty: "error" } as const
const CancelDispatchGrace = "50 millis" as const

export interface BridgeClientExchange {
  readonly request: (
    request: HostProtocolRequestEnvelope
  ) => Effect.Effect<BridgeClientResponse, HostProtocolError, never>
  readonly subscribe?: (
    method: string
  ) => Stream.Stream<HostProtocolEventEnvelope, HostProtocolError, never>
  readonly stream?: (
    request: HostProtocolRequestEnvelope
  ) => Stream.Stream<HostProtocolStreamEnvelope, HostProtocolError, never>
  /**
   * Sends a best-effort protocol cancel envelope. Implementations must stay bounded and
   * interruption-friendly; cancellation cleanup starts this effect in the background.
   */
  readonly cancel?: (
    request: HostProtocolCancelByRequestEnvelope
  ) => Effect.Effect<void, HostProtocolError, never>
}

export type BridgeClientResponse = BridgeClientSuccessResponse | BridgeClientErrorResponse

export interface BridgeClientSuccessResponse {
  readonly kind: "success"
  readonly payload: unknown
}

export interface BridgeClientErrorResponse {
  readonly kind: "failure"
  readonly error: unknown
}

export interface BridgeClientOptions {
  readonly nextRequestId?: () => string
  readonly nextTraceId?: () => string
  readonly now?: () => number
  readonly windowId?: string
  readonly originToken?: string
}

export interface UnaryDesktopTransportFromBridgeClientExchangeOptions extends Pick<
  BridgeClientOptions,
  "nextTraceId" | "now"
> {
  readonly normalizeRequest?: (request: HostProtocolRequestEnvelope) => HostProtocolRequestEnvelope
}

export const makeUnaryDesktopTransportFromBridgeClientExchange = (
  exchange: BridgeClientExchange,
  options: UnaryDesktopTransportFromBridgeClientExchangeOptions = {}
): Effect.Effect<DesktopTransportSend & DesktopTransportRun> =>
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<HostProtocolEnvelope>()
    const now = options.now ?? Date.now
    const nextTraceId = options.nextTraceId ?? (() => `trace-${globalThis.crypto.randomUUID()}`)
    const normalizeRequest = options.normalizeRequest ?? ((request) => request)

    return Object.freeze({
      send: (envelope) => {
        if (envelope.kind === "request") {
          return exchange.request(normalizeRequest(envelope)).pipe(
            Effect.catch((error) =>
              Effect.succeed({
                kind: "failure" as const,
                error
              } satisfies BridgeClientResponse)
            ),
            Effect.flatMap((response) =>
              Queue.offer(queue, bridgeResponseEnvelope(envelope, response, now, nextTraceId))
            ),
            Effect.asVoid
          )
        }
        if (
          envelope.kind === "cancel" &&
          "id" in envelope &&
          envelope.id !== undefined &&
          exchange.cancel !== undefined
        ) {
          return exchange
            .cancel(
              new HostProtocolCancelByRequestEnvelope({
                kind: "cancel",
                id: envelope.id,
                timestamp: envelope.timestamp,
                traceId: envelope.traceId
              })
            )
            .pipe(Effect.catch(() => Effect.void))
        }
        return Effect.void
      },
      run: (onEnvelope) => Effect.forever(Queue.take(queue).pipe(Effect.flatMap(onEnvelope)))
    } satisfies DesktopTransportSend & DesktopTransportRun)
  })

interface ResolvedBridgeClientOptions {
  readonly nextRequestId: () => string
  readonly nextTraceId: () => string
  readonly now: () => number
  readonly windowId: string | undefined
  readonly originToken: string | undefined
}

const decodeUnknownHostProtocolError = Schema.decodeUnknownSync(HostProtocolErrorSchema)

const bridgeResponseEnvelope = (
  request: HostProtocolRequestEnvelope,
  response: BridgeClientResponse,
  now: () => number,
  nextTraceId: () => string
): HostProtocolResponseEnvelope => {
  const fields: {
    readonly kind: "response"
    readonly id: string
    readonly timestamp: number
    readonly traceId: string
    readonly payload?: unknown
    readonly error?: HostProtocolError
  } = {
    kind: "response",
    id: request.id,
    timestamp: now(),
    traceId: request.traceId === "" ? nextTraceId() : request.traceId
  }

  return new HostProtocolResponseEnvelope(
    response.kind === "success"
      ? { ...fields, payload: response.payload === undefined ? null : response.payload }
      : { ...fields, error: bridgeFailureError(response.error, request.method) }
  )
}

const bridgeFailureError = (error: unknown, operation: string): HostProtocolError => {
  try {
    return decodeUnknownHostProtocolError(error)
  } catch {
    return makeHostProtocolInternalError("bridge exchange failed", operation)
  }
}

export type BridgeClientMethod<Spec extends BridgeMethodSpec> =
  Spec["output"] extends BridgeStreamSpec
    ? undefined extends BridgeContractCodecType<Spec["input"]>
      ? (
          input?: BridgeContractCodecType<Spec["input"]>
        ) => Stream.Stream<
          BridgeContractCodecType<Spec["output"]["chunk"]>,
          BridgeContractCodecType<Spec["output"]["error"]> | HostProtocolError,
          never
        >
      : (
          input: BridgeContractCodecType<Spec["input"]>
        ) => Stream.Stream<
          BridgeContractCodecType<Spec["output"]["chunk"]>,
          BridgeContractCodecType<Spec["output"]["error"]> | HostProtocolError,
          never
        >
    : undefined extends BridgeContractCodecType<Spec["input"]>
      ? (
          input?: BridgeContractCodecType<Spec["input"]>
        ) => Effect.Effect<
          BridgeContractCodecType<Extract<Spec["output"], BridgeContractCodec>>,
          BridgeContractCodecType<Spec["error"]> | HostProtocolError,
          never
        >
      : (
          input: BridgeContractCodecType<Spec["input"]>
        ) => Effect.Effect<
          BridgeContractCodecType<Extract<Spec["output"], BridgeContractCodec>>,
          BridgeContractCodecType<Spec["error"]> | HostProtocolError,
          never
        >

export type BridgeClientEvent<Spec extends BridgeEventSpec> = Stream.Stream<
  BridgeContractCodecType<Spec["payload"]>,
  HostProtocolError,
  never
>

type BridgeUnaryMethodSpec = BridgeMethodSpec<
  BridgeContractCodec,
  BridgeContractCodec,
  BridgeContractCodec
>

export type BridgeClientFor<Contract extends BridgeContract> =
  Contract extends BridgeContract<string, infer Spec, infer Events>
    ? { readonly [Method in keyof Spec]: BridgeClientMethod<Spec[Method]> } & {
        readonly events: { readonly [Event in keyof Events]: BridgeClientEvent<Events[Event]> }
      }
    : never

export type BridgeClient<Contracts extends Readonly<Record<string, BridgeContract>>> = {
  readonly [Namespace in keyof Contracts]: BridgeClientFor<Contracts[Namespace]>
}

export const Client = <Contracts extends Readonly<Record<string, BridgeContract>>>(
  contracts: Contracts,
  exchange: BridgeClientExchange,
  options: BridgeClientOptions = {}
): BridgeClient<Contracts> => {
  const resolved = resolveOptions(options)
  const namespaces = Object.entries(contracts).map(([namespace, contract]) => [
    namespace,
    makeContractClient(contract, exchange, resolved)
  ])

  return Object.freeze(Object.fromEntries(namespaces)) as BridgeClient<Contracts>
}

const makeContractClient = <Tag extends string, Spec extends BridgeContractSpec>(
  contract: BridgeContract<Tag, Spec>,
  exchange: BridgeClientExchange,
  options: ResolvedBridgeClientOptions
): BridgeClientFor<BridgeContract<Tag, Spec>> => {
  const methods = {} as { [Method in keyof Spec]?: BridgeClientMethod<Spec[Method]> }
  const contractEvents = (contract.events ?? {}) as BridgeContractEvents
  const events = {} as Record<string, BridgeClientEvent<BridgeEventSpec>>

  for (const [method, methodSpec] of Object.entries(contract.spec) as Array<
    [Extract<keyof Spec, string>, Spec[Extract<keyof Spec, string>]]
  >) {
    methods[method] = ((
      input: BridgeContractCodecType<Spec[typeof method]["input"]>
    ): Effect.Effect<unknown, unknown, never> | Stream.Stream<unknown, unknown, never> =>
      isStreamSpec(methodSpec.output)
        ? streamContractMethod(
            contract.tag,
            method,
            methodSpec as Spec[typeof method] & { readonly output: BridgeStreamSpec },
            input,
            exchange,
            options
          )
        : requestContractMethod(
            contract.tag,
            method,
            methodSpec as Extract<Spec[typeof method], BridgeUnaryMethodSpec>,
            input,
            exchange,
            options
          )) as BridgeClientMethod<Spec[typeof method]> | undefined
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
  }) as BridgeClientFor<BridgeContract<Tag, Spec, typeof contractEvents>>
}

const requestContractMethod = <Spec extends BridgeUnaryMethodSpec>(
  tag: string,
  method: string,
  spec: Spec,
  input: BridgeContractCodecType<Spec["input"]>,
  exchange: BridgeClientExchange,
  options: ResolvedBridgeClientOptions
): Effect.Effect<
  BridgeContractCodecType<Spec["output"]>,
  BridgeContractCodecType<Spec["error"]> | HostProtocolError,
  never
> =>
  Effect.gen(function* () {
    const operation = methodName(tag, method)
    const payload = yield* encodeInput(operation, spec.input, input)
    const request = yield* makeRequest(operation, payload, options)
    const response = yield* runRequestWithInterruption(exchange, request, options.now)
    const responseKind = (response as { readonly kind?: unknown }).kind

    if (responseKind === "failure") {
      const failureResponse = response as Extract<
        BridgeClientResponse,
        { readonly kind: "failure" }
      >
      return yield* decodeContractError(operation, spec.error, failureResponse.error)
    }
    if (responseKind !== "success") {
      return yield* Effect.fail(
        makeHostProtocolInvalidOutputError(
          operation,
          `unknown response kind: ${String(responseKind)}`
        )
      )
    }
    const successResponse = response as Extract<BridgeClientResponse, { readonly kind: "success" }>

    return yield* decodeOutput(operation, spec.output, successResponse.payload)
  })

const encodeInput = <Type, Encoded>(
  operation: string,
  schema: BridgeContractCodec<Type, Encoded>,
  input: Type
): Effect.Effect<Encoded, HostProtocolError, never> =>
  Schema.encodeEffect(schema)(input, StrictParseOptions).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

const decodeOutput = <Type, Encoded>(
  operation: string,
  schema: BridgeContractCodec<Type, Encoded>,
  payload: unknown
): Effect.Effect<Type, HostProtocolError, never> =>
  Schema.decodeUnknownEffect(schema)(payload, StrictParseOptions).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
    )
  )

const decodeContractError = <Type, Encoded>(
  operation: string,
  schema: BridgeContractCodec<Type, Encoded>,
  error: unknown
): Effect.Effect<never, Type | HostProtocolError, never> =>
  Effect.flatMap(
    Schema.decodeUnknownEffect(schema)(error, StrictParseOptions).pipe(
      Effect.mapError((schemaError) =>
        makeHostProtocolInvalidOutputError(operation, formatUnknownError(schemaError))
      )
    ),
    (decoded) => Effect.fail(decoded)
  )

const subscribeContractEvent = <Spec extends BridgeEventSpec>(
  tag: string,
  event: string,
  spec: Spec,
  exchange: BridgeClientExchange
): BridgeClientEvent<Spec> => {
  const operation = eventName(tag, event)

  if (exchange.subscribe === undefined) {
    return Stream.fail(
      makeHostProtocolInvalidOutputError(operation, "event exchange does not support subscriptions")
    )
  }

  return exchange
    .subscribe(operation)
    .pipe(Stream.mapEffect((envelope) => decodeEventEnvelope(operation, spec, envelope)))
}

const streamContractMethod = <
  Spec extends BridgeMethodSpec & { readonly output: BridgeStreamSpec }
>(
  tag: string,
  method: string,
  spec: Spec,
  input: BridgeContractCodecType<Spec["input"]>,
  exchange: BridgeClientExchange,
  options: ResolvedBridgeClientOptions
): Stream.Stream<
  BridgeContractCodecType<Spec["output"]["chunk"]>,
  BridgeContractCodecType<Spec["output"]["error"]> | HostProtocolError,
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
      const payload = yield* encodeInput(operation, spec.input, input)
      const request = yield* makeRequest(operation, payload, options)
      let terminal = false

      return stream(request).pipe(
        Stream.takeUntilEffect((envelope) =>
          isTerminalStreamEnvelope(operation, request.id, envelope)
        ),
        Stream.flatMap((envelope) =>
          decodeStreamEnvelope(operation, request.id, spec.output, envelope, () => {
            terminal = true
          })
        ),
        Stream.ensuring(
          Effect.suspend(() =>
            terminal ? Effect.void : startCancelByRequest(exchange, request, options.now)
          )
        )
      )
    })
  )
}

const isTerminalStreamEnvelope = (
  operation: string,
  requestId: string,
  envelope: HostProtocolStreamEnvelope
): Effect.Effect<boolean, HostProtocolError, never> => {
  const routeFailure = validateStreamEnvelopeRequestId(operation, requestId, envelope)
  if (routeFailure !== undefined) {
    return Effect.fail(routeFailure)
  }

  if (envelope.error !== undefined) {
    return Effect.succeed(true)
  }

  return decodeStreamFrame(operation, envelope.payload).pipe(
    Effect.map(
      (frame) =>
        frame instanceof BridgeStreamErrorFrame ||
        frame instanceof BridgeStreamCompleteFrame ||
        frame instanceof BridgeStreamClosedFrame
    )
  )
}

const decodeStreamEnvelope = <Spec extends BridgeStreamSpec>(
  operation: string,
  requestId: string,
  spec: Spec,
  envelope: HostProtocolStreamEnvelope,
  onTerminal: () => void = () => {}
): Stream.Stream<
  BridgeContractCodecType<Spec["chunk"]>,
  BridgeContractCodecType<Spec["error"]> | HostProtocolError,
  never
> => {
  const routeFailure = validateStreamEnvelopeRequestId(operation, requestId, envelope)
  if (routeFailure !== undefined) {
    return Stream.fail(routeFailure)
  }

  if (envelope.error !== undefined) {
    onTerminal()
    return Stream.fail(envelope.error)
  }

  return Stream.fromEffect(decodeStreamFrame(operation, envelope.payload)).pipe(
    Stream.flatMap((frame) => {
      if (frame instanceof BridgeStreamDataFrame) {
        return Stream.fromEffect(decodeStreamChunk(operation, spec.chunk, frame.chunk))
      }
      if (frame instanceof BridgeStreamErrorFrame) {
        onTerminal()
        return Stream.fromEffect(decodeStreamError(operation, spec.error, frame.error))
      }
      if (frame instanceof BridgeStreamCompleteFrame) {
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

const validateStreamEnvelopeRequestId = (
  operation: string,
  requestId: string,
  envelope: HostProtocolStreamEnvelope
): HostProtocolError | undefined => {
  if (envelope.id === requestId) {
    return undefined
  }

  return makeHostProtocolInvalidOutputError(
    operation,
    `expected stream request id ${requestId}; got ${envelope.id ?? "<missing>"}`
  )
}

const decodeEventEnvelope = <Spec extends BridgeEventSpec>(
  operation: string,
  spec: Spec,
  envelope: HostProtocolEventEnvelope
): Effect.Effect<BridgeContractCodecType<Spec["payload"]>, HostProtocolError, never> => {
  if (envelope.method !== operation) {
    return Effect.fail(
      makeHostProtocolInvalidOutputError(
        operation,
        `expected event method ${operation}; got ${envelope.method}`
      )
    )
  }

  return decodeEventPayload(operation, spec.payload, envelope.payload)
}

const decodeEventPayload = <Type, Encoded>(
  operation: string,
  schema: BridgeContractCodec<Type, Encoded>,
  payload: unknown
): Effect.Effect<Type, HostProtocolError, never> =>
  Schema.decodeUnknownEffect(schema)(payload, StrictParseOptions).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
    )
  )

const decodeStreamFrame = (
  operation: string,
  payload: unknown
): Effect.Effect<BridgeStreamFrame, HostProtocolError, never> =>
  Schema.decodeUnknownEffect(BridgeStreamFrame)(payload, StrictParseOptions).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
    )
  )

const decodeStreamChunk = <Type, Encoded>(
  operation: string,
  schema: BridgeContractCodec<Type, Encoded>,
  chunk: unknown
): Effect.Effect<Type, HostProtocolError, never> =>
  Schema.decodeUnknownEffect(schema)(chunk, StrictParseOptions).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
    )
  )

const decodeStreamError = <Type, Encoded>(
  operation: string,
  schema: BridgeContractCodec<Type, Encoded>,
  error: unknown
): Effect.Effect<never, Type | HostProtocolError, never> =>
  Effect.flatMap(
    Schema.decodeUnknownEffect(schema)(error, StrictParseOptions).pipe(
      Effect.mapError((schemaError) =>
        makeHostProtocolInvalidOutputError(operation, formatUnknownError(schemaError))
      )
    ),
    (decoded) => Effect.fail(decoded)
  )

const sendCancelByRequest = (
  exchange: BridgeClientExchange,
  request: HostProtocolRequestEnvelope,
  now: () => number
): Effect.Effect<void, never, never> =>
  exchange.cancel === undefined
    ? Effect.void
    : makeCancelRequest(request, now).pipe(Effect.flatMap(exchange.cancel), Effect.ignore)

const startCancelByRequest = (
  exchange: BridgeClientExchange,
  request: HostProtocolRequestEnvelope,
  now: () => number
): Effect.Effect<void, never, never> =>
  sendCancelByRequest(exchange, request, now).pipe(
    Effect.timeoutOption(CancelDispatchGrace),
    Effect.ignore,
    Effect.forkDetach({ startImmediately: true }),
    Effect.asVoid
  )

const runRequestWithInterruption = (
  exchange: BridgeClientExchange,
  request: HostProtocolRequestEnvelope,
  now: () => number
): Effect.Effect<BridgeClientResponse, HostProtocolError, never> =>
  Effect.acquireUseRelease(
    exchange.request(request).pipe(Effect.forkDetach({ startImmediately: true })),
    (requestFiber) => Fiber.join(requestFiber),
    (requestFiber, exit) =>
      Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)
        ? startCancelByRequest(exchange, request, now).pipe(
            Effect.andThen(
              (exchange.cancel === undefined
                ? Fiber.interrupt(requestFiber)
                : Effect.sleep(CancelDispatchGrace).pipe(
                    Effect.andThen(Fiber.interrupt(requestFiber))
                  )
              ).pipe(Effect.ignore, Effect.forkDetach({ startImmediately: true }), Effect.asVoid)
            )
          )
        : Effect.void
  )

const makeCancelRequest = (
  request: HostProtocolRequestEnvelope,
  now: () => number
): Effect.Effect<HostProtocolCancelByRequestEnvelope, HostProtocolError, never> =>
  Effect.gen(function* () {
    const timestamp = yield* validateHostProtocolTimestamp(now(), request.method)

    return new HostProtocolCancelByRequestEnvelope({
      kind: "cancel",
      id: request.id,
      timestamp,
      traceId: request.traceId
    })
  })

const makeRequest = (
  method: string,
  payload: unknown,
  options: ResolvedBridgeClientOptions
): Effect.Effect<HostProtocolRequestEnvelope, HostProtocolError, never> =>
  Effect.gen(function* () {
    const timestamp = yield* validateHostProtocolTimestamp(options.now(), method)
    const traceId = yield* validateHostProtocolNonEmptyString(
      "traceId",
      options.nextTraceId(),
      method
    )
    const windowId = yield* validateOptionalHostProtocolNonEmptyString(
      "windowId",
      options.windowId,
      method
    )
    const originToken = yield* validateOptionalHostProtocolNonEmptyString(
      "originToken",
      options.originToken,
      method
    )
    const requestId = yield* validateHostProtocolNonEmptyString(
      "id",
      options.nextRequestId(),
      method
    )
    const request = {
      kind: "request",
      id: requestId,
      method,
      timestamp,
      traceId
    } as const

    return new HostProtocolRequestEnvelope({
      ...request,
      ...(payload === undefined ? {} : { payload }),
      ...(windowId === undefined ? {} : { windowId }),
      ...(originToken === undefined ? {} : { originToken })
    })
  })

const resolveOptions = (options: BridgeClientOptions): ResolvedBridgeClientOptions => ({
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
