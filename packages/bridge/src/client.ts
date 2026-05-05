import { Effect, Schema, Stream } from "effect"

import {
  type ApiContractClass,
  type ApiContractEvents,
  type ApiContractSpec,
  type ApiEventSpec,
  type ApiMethodSpec
} from "./contracts.js"
import {
  HostProtocolEventEnvelope,
  HostProtocolRequestEnvelope,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  type HostProtocolError
} from "./protocol.js"

const StrictParseOptions = { onExcessProperty: "error" } as const

export interface ApiClientExchange {
  readonly request: (
    request: HostProtocolRequestEnvelope
  ) => Effect.Effect<ApiClientResponse, HostProtocolError, never>
  readonly subscribe?: (
    method: string
  ) => Stream.Stream<HostProtocolEventEnvelope, HostProtocolError, never>
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

interface ResolvedApiClientOptions {
  readonly nextRequestId: () => string
  readonly nextTraceId: () => string
  readonly now: () => number
  readonly windowId: string | undefined
  readonly originToken: string | undefined
}

export type ApiClientMethod<Spec extends ApiMethodSpec> =
  undefined extends Schema.Schema.Type<Spec["input"]>
    ? (
        input?: Schema.Schema.Type<Spec["input"]>
      ) => Effect.Effect<
        Schema.Schema.Type<Spec["output"]>,
        Schema.Schema.Type<Spec["error"]> | HostProtocolError,
        never
      >
    : (
        input: Schema.Schema.Type<Spec["input"]>
      ) => Effect.Effect<
        Schema.Schema.Type<Spec["output"]>,
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
    methods[method] = ((input: Schema.Schema.Type<Spec[typeof method]["input"]>) =>
      requestContractMethod(contract.tag, method, methodSpec, input, exchange, options)) as
      | ApiClientMethod<Spec[typeof method]>
      | undefined
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
  options: ResolvedApiClientOptions
): Effect.Effect<
  Schema.Schema.Type<Spec["output"]>,
  Schema.Schema.Type<Spec["error"]> | HostProtocolError,
  never
> =>
  Effect.gen(function* () {
    const operation = methodName(tag, method)
    const payload = yield* encodeInput(operation, spec, input)
    const response = yield* exchange.request(makeRequest(operation, payload, options))

    if (response.kind === "failure") {
      return yield* decodeContractError(operation, spec, response.error)
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
): Effect.Effect<Schema.Schema.Type<Spec["output"]>, HostProtocolError, never> =>
  Effect.mapError(
    Schema.decodeUnknownEffect(spec.output)(payload, StrictParseOptions) as Effect.Effect<
      Schema.Schema.Type<Spec["output"]>,
      unknown,
      never
    >,
    (error) => makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
  )

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
