import { Clock, Effect, Encoding, Result, Schema } from "effect"

import {
  HostProtocolRequestEnvelope,
  HostProtocolResponseEnvelope,
  PTY_DISPOSE_METHOD,
  PTY_FORCE_KILL_TREE_METHOD,
  PTY_KILL_METHOD,
  PTY_OPEN_METHOD,
  PTY_READ_METHOD,
  PTY_RESIZE_METHOD,
  PTY_TERMINATE_TREE_METHOD,
  PTY_WAIT_METHOD,
  PTY_WRITE_METHOD,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  type HostProtocolError
} from "./protocol.js"

const StrictParseOptions = { onExcessProperty: "error" } as const
const UInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const UInt32 = UInt.check(Schema.isLessThanOrEqualTo(4_294_967_295))
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))
const UInt16Positive = PositiveInt.check(Schema.isLessThanOrEqualTo(65_535))
const StringRecord = Schema.Record(Schema.String, Schema.String)
const OptionalString = Schema.optionalKey(Schema.String)
const PtySignalPayload = Schema.Union([Schema.String, PositiveInt])

export class HostPtyOpenPayload extends Schema.Class<HostPtyOpenPayload>("HostPtyOpenPayload")({
  command: Schema.NonEmptyString,
  args: Schema.Array(Schema.String),
  rows: UInt16Positive,
  cols: UInt16Positive,
  cwd: OptionalString,
  env: Schema.optionalKey(StringRecord)
}) {}

export class HostPtyOpenResult extends Schema.Class<HostPtyOpenResult>("HostPtyOpenResult")({
  ptyId: Schema.NonEmptyString,
  pid: Schema.optionalKey(UInt32)
}) {}

export class HostPtyIdPayload extends Schema.Class<HostPtyIdPayload>("HostPtyIdPayload")({
  ptyId: Schema.NonEmptyString
}) {}

export class HostPtyReadPayload extends Schema.Class<HostPtyReadPayload>("HostPtyReadPayload")({
  ptyId: Schema.NonEmptyString,
  maxBytes: PositiveInt
}) {}

export class HostPtyReadWireResult extends Schema.Class<HostPtyReadWireResult>(
  "HostPtyReadWireResult"
)({
  bytesBase64: Schema.String,
  done: Schema.Boolean
}) {}

export interface HostPtyReadResult {
  readonly bytes: Uint8Array
  readonly done: boolean
}

export class HostPtyWritePayload extends Schema.Class<HostPtyWritePayload>("HostPtyWritePayload")({
  ptyId: Schema.NonEmptyString,
  bytesBase64: Schema.String
}) {}

export class HostPtyResizePayload extends Schema.Class<HostPtyResizePayload>(
  "HostPtyResizePayload"
)({
  ptyId: Schema.NonEmptyString,
  rows: UInt16Positive,
  cols: UInt16Positive
}) {}

export class HostPtyKillPayload extends Schema.Class<HostPtyKillPayload>("HostPtyKillPayload")({
  ptyId: Schema.NonEmptyString,
  signal: Schema.optionalKey(PtySignalPayload)
}) {}

export class HostPtyExitStatus extends Schema.Class<HostPtyExitStatus>("HostPtyExitStatus")({
  code: UInt32,
  signal: OptionalString
}) {}

export interface HostPtyExchange {
  readonly request: (
    request: HostProtocolRequestEnvelope
  ) => Effect.Effect<HostProtocolResponseEnvelope, HostProtocolError, never>
}

export interface HostPtyClient {
  readonly open: (
    input: HostPtyOpenInput
  ) => Effect.Effect<HostPtyOpenResult, HostProtocolError, never>
  readonly read: (
    ptyId: string,
    maxBytes: number
  ) => Effect.Effect<HostPtyReadResult, HostProtocolError, never>
  readonly write: (
    ptyId: string,
    bytes: Uint8Array
  ) => Effect.Effect<void, HostProtocolError, never>
  readonly resize: (
    ptyId: string,
    size: HostPtyResizeInput
  ) => Effect.Effect<void, HostProtocolError, never>
  readonly kill: (
    ptyId: string,
    signal?: string | number
  ) => Effect.Effect<void, HostProtocolError, never>
  readonly terminateTree: (ptyId: string) => Effect.Effect<void, HostProtocolError, never>
  readonly forceKillTree: (ptyId: string) => Effect.Effect<void, HostProtocolError, never>
  readonly wait: (ptyId: string) => Effect.Effect<HostPtyExitStatus, HostProtocolError, never>
  readonly dispose: (ptyId: string) => Effect.Effect<void, HostProtocolError, never>
}

export interface HostPtyOpenInput {
  readonly command: string
  readonly args: readonly string[]
  readonly rows: number
  readonly cols: number
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string>>
}

export interface HostPtyResizeInput {
  readonly rows: number
  readonly cols: number
}

export interface HostPtyClientOptions {
  readonly nextRequestId?: () => string
  readonly nextTraceId?: () => string
  readonly now?: () => number
}

interface ResolvedHostPtyClientOptions {
  readonly nextRequestId: () => string
  readonly nextTraceId: () => string
  readonly now: (() => number) | undefined
}

export const makeHostPtyClient = (
  exchange: HostPtyExchange,
  options: HostPtyClientOptions = {}
): HostPtyClient => {
  const resolved = resolveOptions(options)

  return Object.freeze({
    open: (input) =>
      Effect.gen(function* () {
        const payload = yield* decodePayload(
          HostPtyOpenPayload,
          {
            command: input.command,
            args: input.args,
            rows: input.rows,
            cols: input.cols,
            ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
            ...(input.env === undefined ? {} : { env: input.env })
          },
          PTY_OPEN_METHOD
        )
        const response = yield* requestSuccess(exchange, resolved, PTY_OPEN_METHOD, payload)
        return yield* decodeResponse(HostPtyOpenResult, response.payload, PTY_OPEN_METHOD)
      }),
    read: (ptyId, maxBytes) =>
      Effect.gen(function* () {
        const payload = yield* decodePayload(
          HostPtyReadPayload,
          { ptyId, maxBytes },
          PTY_READ_METHOD
        )
        const response = yield* requestSuccess(exchange, resolved, PTY_READ_METHOD, payload)
        const result = yield* decodeResponse(
          HostPtyReadWireResult,
          response.payload,
          PTY_READ_METHOD
        )
        const bytes = yield* decodeBase64(result.bytesBase64, PTY_READ_METHOD)
        return { bytes, done: result.done } satisfies HostPtyReadResult
      }),
    write: (ptyId, bytes) =>
      Effect.gen(function* () {
        const payload = yield* decodePayload(
          HostPtyWritePayload,
          { ptyId, bytesBase64: Encoding.encodeBase64(bytes) },
          PTY_WRITE_METHOD
        )
        yield* requestSuccess(exchange, resolved, PTY_WRITE_METHOD, payload)
      }),
    resize: (ptyId, size) =>
      Effect.gen(function* () {
        const payload = yield* decodePayload(
          HostPtyResizePayload,
          { ptyId, rows: size.rows, cols: size.cols },
          PTY_RESIZE_METHOD
        )
        yield* requestSuccess(exchange, resolved, PTY_RESIZE_METHOD, payload)
      }),
    kill: (ptyId, signal) =>
      Effect.gen(function* () {
        const payload = yield* decodePayload(
          HostPtyKillPayload,
          { ptyId, ...(signal === undefined ? {} : { signal }) },
          PTY_KILL_METHOD
        )
        yield* requestSuccess(exchange, resolved, PTY_KILL_METHOD, payload)
      }),
    terminateTree: (ptyId) => requestPtyId(exchange, resolved, PTY_TERMINATE_TREE_METHOD, ptyId),
    forceKillTree: (ptyId) => requestPtyId(exchange, resolved, PTY_FORCE_KILL_TREE_METHOD, ptyId),
    wait: (ptyId) =>
      Effect.gen(function* () {
        const payload = yield* decodePayload(HostPtyIdPayload, { ptyId }, PTY_WAIT_METHOD)
        const response = yield* requestSuccess(exchange, resolved, PTY_WAIT_METHOD, payload)
        return yield* decodeResponse(HostPtyExitStatus, response.payload, PTY_WAIT_METHOD)
      }),
    dispose: (ptyId) => requestPtyId(exchange, resolved, PTY_DISPOSE_METHOD, ptyId)
  } satisfies HostPtyClient)
}

const requestPtyId = (
  exchange: HostPtyExchange,
  options: ResolvedHostPtyClientOptions,
  method: string,
  ptyId: string
): Effect.Effect<void, HostProtocolError, never> =>
  Effect.gen(function* () {
    const payload = yield* decodePayload(HostPtyIdPayload, { ptyId }, method)
    yield* requestSuccess(exchange, options, method, payload)
  })

const requestSuccess = (
  exchange: HostPtyExchange,
  options: ResolvedHostPtyClientOptions,
  method: string,
  payload: unknown
): Effect.Effect<HostProtocolResponseEnvelope, HostProtocolError, never> =>
  Effect.gen(function* () {
    const request = yield* makeRequest(method, payload, options)
    const response = yield* requireMatchingResponse(request, yield* exchange.request(request))
    return yield* requireSuccess(response)
  })

const decodePayload = <A>(
  schema: Schema.Codec<A, unknown, never, never>,
  value: unknown,
  operation: string
): Effect.Effect<A, HostProtocolError, never> =>
  Schema.decodeUnknownEffect(schema)(value, StrictParseOptions).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )

const decodeResponse = <A>(
  schema: Schema.Codec<A, unknown, never, never>,
  value: unknown,
  operation: string
): Effect.Effect<A, HostProtocolError, never> =>
  Schema.decodeUnknownEffect(schema)(value, StrictParseOptions).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
    )
  )

const decodeBase64 = (
  value: string,
  operation: string
): Effect.Effect<Uint8Array, HostProtocolError, never> =>
  Result.match(Encoding.decodeBase64(value), {
    onSuccess: (bytes) => Effect.succeed(bytes),
    onFailure: (error) =>
      Effect.fail(makeHostProtocolInvalidOutputError(operation, formatUnknownError(error)))
  })

const requireMatchingResponse = (
  request: HostProtocolRequestEnvelope,
  response: HostProtocolResponseEnvelope
): Effect.Effect<HostProtocolResponseEnvelope, HostProtocolError, never> => {
  if (response.id !== request.id) {
    return Effect.fail(
      makeHostProtocolInvalidOutputError(
        request.method,
        `response id ${response.id} does not match request id ${request.id}`
      )
    )
  }
  if (response.traceId !== request.traceId) {
    return Effect.fail(
      makeHostProtocolInvalidOutputError(
        request.method,
        `response traceId ${response.traceId} does not match request traceId ${request.traceId}`
      )
    )
  }
  return Effect.succeed(response)
}

const requireSuccess = (
  response: HostProtocolResponseEnvelope
): Effect.Effect<HostProtocolResponseEnvelope, HostProtocolError, never> =>
  response.error === undefined ? Effect.succeed(response) : Effect.fail(response.error)

const makeRequest = (
  method: string,
  payload: unknown,
  options: ResolvedHostPtyClientOptions
): Effect.Effect<HostProtocolRequestEnvelope, HostProtocolError, never> =>
  Effect.gen(function* () {
    const timestamp = yield* currentTimeMillis(options.now)
    const id = yield* validateNonEmpty("id", options.nextRequestId(), method)
    const traceId = yield* validateNonEmpty("traceId", options.nextTraceId(), method)
    return new HostProtocolRequestEnvelope({
      kind: "request",
      id,
      method,
      timestamp,
      traceId,
      payload
    })
  })

const validateNonEmpty = (
  field: string,
  value: string,
  operation: string
): Effect.Effect<string, HostProtocolError, never> =>
  value.length > 0
    ? Effect.succeed(value)
    : Effect.fail(makeHostProtocolInvalidArgumentError(field, "must be non-empty", operation))

const currentTimeMillis = (now: (() => number) | undefined): Effect.Effect<number, never, never> =>
  now === undefined ? Clock.currentTimeMillis : Effect.sync(now)

let hostPtyRequestSeq = 0
let hostPtyTraceSeq = 0

const resolveOptions = (options: HostPtyClientOptions): ResolvedHostPtyClientOptions => ({
  nextRequestId: options.nextRequestId ?? (() => `request-pty-${++hostPtyRequestSeq}`),
  nextTraceId: options.nextTraceId ?? (() => `trace-pty-${++hostPtyTraceSeq}`),
  now: options.now
})

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}
