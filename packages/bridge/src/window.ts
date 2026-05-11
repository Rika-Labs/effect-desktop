import { Effect, Schema } from "effect"

import {
  HostProtocolRequestEnvelope,
  HostProtocolResponseEnvelope,
  WINDOW_CREATE_METHOD,
  WINDOW_DESTROY_METHOD,
  makeHostProtocolInvalidArgumentError,
  makeHostProtocolInvalidOutputError,
  type HostProtocolError
} from "./protocol.js"

const StrictParseOptions = { onExcessProperty: "error" } as const
const PositiveFiniteNumber = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0))
const NonNegativeFiniteNumber = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0)
)
const WindowTitleBarStyle = Schema.Literals([
  "default",
  "hidden",
  "hiddenInset",
  "customButtonsOnHover"
])
const WindowVibrancyMaterial = Schema.Literals([
  "appearanceBased",
  "appearance-based",
  "contentBackground",
  "content-background",
  "headerView",
  "header-view",
  "hudWindow",
  "hud-window",
  "menu",
  "popover",
  "selection",
  "sidebar",
  "titlebar",
  "windowBackground",
  "window-background"
])
const WindowTrafficLights = Schema.Struct({
  x: NonNegativeFiniteNumber,
  y: NonNegativeFiniteNumber
})

export class WindowCreatePayload extends Schema.Class<WindowCreatePayload>("WindowCreatePayload")({
  title: Schema.optionalKey(Schema.NonEmptyString),
  width: Schema.optionalKey(PositiveFiniteNumber),
  height: Schema.optionalKey(PositiveFiniteNumber),
  titleBarStyle: Schema.optionalKey(WindowTitleBarStyle),
  vibrancy: Schema.optionalKey(WindowVibrancyMaterial),
  trafficLights: Schema.optionalKey(WindowTrafficLights)
}) {}

export class WindowCreateResponse extends Schema.Class<WindowCreateResponse>(
  "WindowCreateResponse"
)({
  windowId: Schema.String
}) {}

export class WindowDestroyPayload extends Schema.Class<WindowDestroyPayload>(
  "WindowDestroyPayload"
)({
  windowId: Schema.String
}) {}

export interface WindowCreateInput {
  readonly title?: string
  readonly width?: number
  readonly height?: number
  readonly titleBarStyle?: Schema.Schema.Type<typeof WindowTitleBarStyle>
  readonly vibrancy?: Schema.Schema.Type<typeof WindowVibrancyMaterial>
  readonly trafficLights?: Schema.Schema.Type<typeof WindowTrafficLights>
}

export interface HostWindowExchange {
  readonly request: (
    request: HostProtocolRequestEnvelope
  ) => Effect.Effect<HostProtocolResponseEnvelope, HostProtocolError, never>
}

export interface HostWindowClient {
  readonly create: (
    input?: WindowCreateInput
  ) => Effect.Effect<WindowCreateResponse, HostProtocolError, never>
  readonly destroy: (windowId: string) => Effect.Effect<void, HostProtocolError, never>
}

export interface HostWindowClientOptions {
  readonly nextRequestId?: () => string
  readonly nextTraceId?: () => string
  readonly now?: () => number
}

interface ResolvedHostWindowClientOptions {
  readonly nextRequestId: () => string
  readonly nextTraceId: () => string
  readonly now: () => number
}

export const makeHostWindowClient = (
  exchange: HostWindowExchange,
  options: HostWindowClientOptions = {}
): HostWindowClient => {
  const resolved = resolveOptions(options)

  return {
    create: (input = {}) =>
      Effect.gen(function* () {
        const payload = yield* encodeCreatePayload(input)
        const request = makeRequest(WINDOW_CREATE_METHOD, resolved, payload)
        const response = yield* requireSuccess(
          yield* requireMatchingResponse(request, yield* exchange.request(request))
        )

        return yield* decodeCreateResponse(response.payload)
      }),
    destroy: (windowId) =>
      Effect.gen(function* () {
        const payload = yield* encodeDestroyPayload(windowId)
        const request = makeRequest(WINDOW_DESTROY_METHOD, resolved, payload)
        yield* requireSuccess(
          yield* requireMatchingResponse(request, yield* exchange.request(request))
        )
      })
  }
}

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
): Effect.Effect<HostProtocolResponseEnvelope, HostProtocolError, never> => {
  if (response.error !== undefined) {
    return Effect.fail(response.error)
  }

  return Effect.succeed(response)
}

const decodeUnknownWindowCreatePayload = Schema.decodeUnknownSync(WindowCreatePayload)
const decodeUnknownWindowCreateResponse = Schema.decodeUnknownSync(WindowCreateResponse)
const decodeUnknownWindowDestroyPayload = Schema.decodeUnknownSync(WindowDestroyPayload)

const encodeCreatePayload = (
  input: WindowCreateInput
): Effect.Effect<WindowCreatePayload, HostProtocolError, never> =>
  Effect.try({
    try: () => decodeUnknownWindowCreatePayload(input, StrictParseOptions),
    catch: (error) => invalidArgument("payload", error, WINDOW_CREATE_METHOD)
  })

const encodeDestroyPayload = (
  windowId: string
): Effect.Effect<WindowDestroyPayload, HostProtocolError, never> =>
  Effect.try({
    try: () => decodeUnknownWindowDestroyPayload({ windowId }, StrictParseOptions),
    catch: (error) => invalidArgument("windowId", error, WINDOW_DESTROY_METHOD)
  })

const decodeCreateResponse = (
  payload: unknown
): Effect.Effect<WindowCreateResponse, HostProtocolError, never> =>
  Effect.try({
    try: () => decodeUnknownWindowCreateResponse(payload, StrictParseOptions),
    catch: (error) =>
      makeHostProtocolInvalidOutputError(WINDOW_CREATE_METHOD, formatUnknownError(error))
  })

const makeRequest = (
  method: string,
  options: ResolvedHostWindowClientOptions,
  payload: unknown
): HostProtocolRequestEnvelope =>
  new HostProtocolRequestEnvelope({
    kind: "request",
    id: options.nextRequestId(),
    method,
    timestamp: options.now(),
    traceId: options.nextTraceId(),
    payload
  })

const resolveOptions = (options: HostWindowClientOptions): ResolvedHostWindowClientOptions => ({
  nextRequestId: options.nextRequestId ?? (() => `request-${globalThis.crypto.randomUUID()}`),
  nextTraceId: options.nextTraceId ?? (() => `trace-${globalThis.crypto.randomUUID()}`),
  now: options.now ?? Date.now
})

const invalidArgument = (field: string, error: unknown, operation: string) =>
  makeHostProtocolInvalidArgumentError(field, formatUnknownError(error), operation)

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
