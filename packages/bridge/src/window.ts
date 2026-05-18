import { Clock, Effect, Schema } from "effect"

import {
  HostProtocolRequestEnvelope,
  HostProtocolResponseEnvelope,
  WINDOW_CENTER_METHOD,
  WINDOW_CREATE_METHOD,
  WINDOW_CANCEL_ATTENTION_METHOD,
  WINDOW_DESTROY_METHOD,
  WINDOW_FOCUS_METHOD,
  WINDOW_GET_BOUNDS_METHOD,
  WINDOW_GET_STATE_METHOD,
  WINDOW_HIDE_METHOD,
  WINDOW_MAXIMIZE_METHOD,
  WINDOW_MINIMIZE_METHOD,
  WINDOW_RESTORE_METHOD,
  WINDOW_REQUEST_ATTENTION_METHOD,
  WINDOW_SET_ALWAYS_ON_TOP_METHOD,
  WINDOW_SET_BOUNDS_METHOD,
  WINDOW_SET_DECORATIONS_METHOD,
  WINDOW_SET_FULLSCREEN_METHOD,
  WINDOW_SET_PROGRESS_METHOD,
  WINDOW_SET_RESIZABLE_METHOD,
  WINDOW_SET_TITLE_METHOD,
  WINDOW_SHOW_METHOD,
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
const WindowProgressState = Schema.Literals(["none", "normal", "indeterminate", "paused", "error"])
const WindowAttentionType = Schema.Literals(["critical", "informational"])

export class WindowCreatePayload extends Schema.Class<WindowCreatePayload>("WindowCreatePayload")({
  title: Schema.optionalKey(Schema.NonEmptyString),
  width: Schema.optionalKey(PositiveFiniteNumber),
  height: Schema.optionalKey(PositiveFiniteNumber),
  parentWindowId: Schema.optionalKey(Schema.NonEmptyString),
  titleBarStyle: Schema.optionalKey(WindowTitleBarStyle),
  vibrancy: Schema.optionalKey(WindowVibrancyMaterial),
  trafficLights: Schema.optionalKey(WindowTrafficLights)
}) {}

export class WindowCreateResponse extends Schema.Class<WindowCreateResponse>(
  "WindowCreateResponse"
)({
  windowId: Schema.NonEmptyString
}) {}

export class WindowDestroyPayload extends Schema.Class<WindowDestroyPayload>(
  "WindowDestroyPayload"
)({
  windowId: Schema.NonEmptyString
}) {}

export class WindowBoundsPayload extends Schema.Class<WindowBoundsPayload>("WindowBoundsPayload")({
  x: Schema.Number.check(Schema.isFinite()),
  y: Schema.Number.check(Schema.isFinite()),
  width: PositiveFiniteNumber,
  height: PositiveFiniteNumber
}) {}

export class WindowSetBoundsPayload extends Schema.Class<WindowSetBoundsPayload>(
  "WindowSetBoundsPayload"
)({
  windowId: Schema.NonEmptyString,
  bounds: WindowBoundsPayload
}) {}

export class WindowSetTitlePayload extends Schema.Class<WindowSetTitlePayload>(
  "WindowSetTitlePayload"
)({
  windowId: Schema.NonEmptyString,
  title: Schema.String
}) {}

export class WindowSetResizablePayload extends Schema.Class<WindowSetResizablePayload>(
  "WindowSetResizablePayload"
)({
  windowId: Schema.NonEmptyString,
  resizable: Schema.Boolean
}) {}

export class WindowSetDecorationsPayload extends Schema.Class<WindowSetDecorationsPayload>(
  "WindowSetDecorationsPayload"
)({
  windowId: Schema.NonEmptyString,
  decorations: Schema.Boolean
}) {}

export class WindowSetAlwaysOnTopPayload extends Schema.Class<WindowSetAlwaysOnTopPayload>(
  "WindowSetAlwaysOnTopPayload"
)({
  windowId: Schema.NonEmptyString,
  alwaysOnTop: Schema.Boolean
}) {}

export class WindowSetProgressPayload extends Schema.Class<WindowSetProgressPayload>(
  "WindowSetProgressPayload"
)({
  windowId: Schema.NonEmptyString,
  state: Schema.optionalKey(WindowProgressState),
  progress: Schema.optionalKey(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(100))
  ),
  desktopFilename: Schema.optionalKey(Schema.NonEmptyString)
}) {}

export class WindowRequestAttentionPayload extends Schema.Class<WindowRequestAttentionPayload>(
  "WindowRequestAttentionPayload"
)({
  windowId: Schema.NonEmptyString,
  requestType: WindowAttentionType
}) {}

export class WindowSetFullscreenPayload extends Schema.Class<WindowSetFullscreenPayload>(
  "WindowSetFullscreenPayload"
)({
  windowId: Schema.NonEmptyString,
  fullscreen: Schema.Boolean
}) {}

export class WindowStatePayload extends Schema.Class<WindowStatePayload>("WindowStatePayload")({
  minimized: Schema.Boolean,
  maximized: Schema.Boolean,
  fullscreen: Schema.Boolean
}) {}

export interface WindowCreateInput {
  readonly title?: string
  readonly width?: number
  readonly height?: number
  readonly parentWindowId?: string
  readonly titleBarStyle?: Schema.Schema.Type<typeof WindowTitleBarStyle>
  readonly vibrancy?: Schema.Schema.Type<typeof WindowVibrancyMaterial>
  readonly trafficLights?: Schema.Schema.Type<typeof WindowTrafficLights>
}

export interface WindowBoundsInput {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface WindowProgressInput {
  readonly state?: Schema.Schema.Type<typeof WindowProgressState>
  readonly progress?: number
  readonly desktopFilename?: string
}

export type WindowAttentionTypeInput = Schema.Schema.Type<typeof WindowAttentionType>

export interface HostWindowExchange {
  readonly request: (
    request: HostProtocolRequestEnvelope
  ) => Effect.Effect<HostProtocolResponseEnvelope, HostProtocolError, never>
}

export interface HostWindowClient {
  readonly create: (
    input?: WindowCreateInput
  ) => Effect.Effect<WindowCreateResponse, HostProtocolError, never>
  readonly show: (windowId: string) => Effect.Effect<void, HostProtocolError, never>
  readonly hide: (windowId: string) => Effect.Effect<void, HostProtocolError, never>
  readonly focus: (windowId: string) => Effect.Effect<void, HostProtocolError, never>
  readonly getBounds: (
    windowId: string
  ) => Effect.Effect<WindowBoundsPayload, HostProtocolError, never>
  readonly setBounds: (
    windowId: string,
    bounds: WindowBoundsInput
  ) => Effect.Effect<void, HostProtocolError, never>
  readonly center: (windowId: string) => Effect.Effect<void, HostProtocolError, never>
  readonly setTitle: (
    windowId: string,
    title: string
  ) => Effect.Effect<void, HostProtocolError, never>
  readonly setResizable: (
    windowId: string,
    resizable: boolean
  ) => Effect.Effect<void, HostProtocolError, never>
  readonly setDecorations: (
    windowId: string,
    decorations: boolean
  ) => Effect.Effect<void, HostProtocolError, never>
  readonly setAlwaysOnTop: (
    windowId: string,
    alwaysOnTop: boolean
  ) => Effect.Effect<void, HostProtocolError, never>
  readonly setProgress: (
    windowId: string,
    input: WindowProgressInput
  ) => Effect.Effect<void, HostProtocolError, never>
  readonly requestAttention: (
    windowId: string,
    requestType: WindowAttentionTypeInput
  ) => Effect.Effect<void, HostProtocolError, never>
  readonly cancelAttention: (windowId: string) => Effect.Effect<void, HostProtocolError, never>
  readonly minimize: (windowId: string) => Effect.Effect<void, HostProtocolError, never>
  readonly maximize: (windowId: string) => Effect.Effect<void, HostProtocolError, never>
  readonly restore: (windowId: string) => Effect.Effect<void, HostProtocolError, never>
  readonly setFullscreen: (
    windowId: string,
    fullscreen: boolean
  ) => Effect.Effect<void, HostProtocolError, never>
  readonly getState: (
    windowId: string
  ) => Effect.Effect<WindowStatePayload, HostProtocolError, never>
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
  readonly now?: (() => number) | undefined
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
        const request = yield* makeRequest(WINDOW_CREATE_METHOD, resolved, payload)
        const response = yield* requireSuccess(
          yield* requireMatchingResponse(request, yield* exchange.request(request))
        )

        return yield* decodeCreateResponse(response.payload)
      }),
    show: (windowId) =>
      sendWindowLifecycleCommand(windowId, WINDOW_SHOW_METHOD, exchange, resolved),
    hide: (windowId) =>
      sendWindowLifecycleCommand(windowId, WINDOW_HIDE_METHOD, exchange, resolved),
    focus: (windowId) =>
      sendWindowLifecycleCommand(windowId, WINDOW_FOCUS_METHOD, exchange, resolved),
    getBounds: (windowId) =>
      Effect.gen(function* () {
        const payload = yield* encodeWindowIdPayload(windowId, WINDOW_GET_BOUNDS_METHOD)
        const request = yield* makeRequest(WINDOW_GET_BOUNDS_METHOD, resolved, payload)
        const response = yield* requireSuccess(
          yield* requireMatchingResponse(request, yield* exchange.request(request))
        )
        return yield* decodeBoundsResponse(response.payload, WINDOW_GET_BOUNDS_METHOD)
      }),
    setBounds: (windowId, bounds) =>
      Effect.gen(function* () {
        const payload = yield* encodeSetBoundsPayload(windowId, bounds)
        const request = yield* makeRequest(WINDOW_SET_BOUNDS_METHOD, resolved, payload)
        yield* requireSuccess(
          yield* requireMatchingResponse(request, yield* exchange.request(request))
        )
      }),
    center: (windowId) =>
      sendWindowLifecycleCommand(windowId, WINDOW_CENTER_METHOD, exchange, resolved),
    setTitle: (windowId, title) =>
      Effect.gen(function* () {
        const payload = yield* encodeSetTitlePayload(windowId, title)
        const request = yield* makeRequest(WINDOW_SET_TITLE_METHOD, resolved, payload)
        yield* requireSuccess(
          yield* requireMatchingResponse(request, yield* exchange.request(request))
        )
      }),
    setResizable: (windowId, resizable) =>
      Effect.gen(function* () {
        const payload = yield* encodeSetResizablePayload(windowId, resizable)
        const request = yield* makeRequest(WINDOW_SET_RESIZABLE_METHOD, resolved, payload)
        yield* requireSuccess(
          yield* requireMatchingResponse(request, yield* exchange.request(request))
        )
      }),
    setDecorations: (windowId, decorations) =>
      Effect.gen(function* () {
        const payload = yield* encodeSetDecorationsPayload(windowId, decorations)
        const request = yield* makeRequest(WINDOW_SET_DECORATIONS_METHOD, resolved, payload)
        yield* requireSuccess(
          yield* requireMatchingResponse(request, yield* exchange.request(request))
        )
      }),
    setAlwaysOnTop: (windowId, alwaysOnTop) =>
      Effect.gen(function* () {
        const payload = yield* encodeSetAlwaysOnTopPayload(windowId, alwaysOnTop)
        const request = yield* makeRequest(WINDOW_SET_ALWAYS_ON_TOP_METHOD, resolved, payload)
        yield* requireSuccess(
          yield* requireMatchingResponse(request, yield* exchange.request(request))
        )
      }),
    setProgress: (windowId, input) =>
      Effect.gen(function* () {
        const payload = yield* encodeSetProgressPayload(windowId, input)
        const request = yield* makeRequest(WINDOW_SET_PROGRESS_METHOD, resolved, payload)
        yield* requireSuccess(
          yield* requireMatchingResponse(request, yield* exchange.request(request))
        )
      }),
    requestAttention: (windowId, requestType) =>
      Effect.gen(function* () {
        const payload = yield* encodeRequestAttentionPayload(windowId, requestType)
        const request = yield* makeRequest(WINDOW_REQUEST_ATTENTION_METHOD, resolved, payload)
        yield* requireSuccess(
          yield* requireMatchingResponse(request, yield* exchange.request(request))
        )
      }),
    cancelAttention: (windowId) =>
      sendWindowLifecycleCommand(windowId, WINDOW_CANCEL_ATTENTION_METHOD, exchange, resolved),
    minimize: (windowId) =>
      sendWindowLifecycleCommand(windowId, WINDOW_MINIMIZE_METHOD, exchange, resolved),
    maximize: (windowId) =>
      sendWindowLifecycleCommand(windowId, WINDOW_MAXIMIZE_METHOD, exchange, resolved),
    restore: (windowId) =>
      sendWindowLifecycleCommand(windowId, WINDOW_RESTORE_METHOD, exchange, resolved),
    setFullscreen: (windowId, fullscreen) =>
      Effect.gen(function* () {
        const payload = yield* encodeSetFullscreenPayload(windowId, fullscreen)
        const request = yield* makeRequest(WINDOW_SET_FULLSCREEN_METHOD, resolved, payload)
        yield* requireSuccess(
          yield* requireMatchingResponse(request, yield* exchange.request(request))
        )
      }),
    getState: (windowId) =>
      Effect.gen(function* () {
        const payload = yield* encodeWindowIdPayload(windowId, WINDOW_GET_STATE_METHOD)
        const request = yield* makeRequest(WINDOW_GET_STATE_METHOD, resolved, payload)
        const response = yield* requireSuccess(
          yield* requireMatchingResponse(request, yield* exchange.request(request))
        )
        return yield* decodeStateResponse(response.payload, WINDOW_GET_STATE_METHOD)
      }),
    destroy: (windowId) =>
      Effect.gen(function* () {
        const payload = yield* encodeDestroyPayload(windowId)
        const request = yield* makeRequest(WINDOW_DESTROY_METHOD, resolved, payload)
        yield* requireSuccess(
          yield* requireMatchingResponse(request, yield* exchange.request(request))
        )
      })
  }
}

const sendWindowLifecycleCommand = (
  windowId: string,
  method: string,
  exchange: HostWindowExchange,
  options: ResolvedHostWindowClientOptions
): Effect.Effect<void, HostProtocolError, never> =>
  Effect.gen(function* () {
    const payload = yield* encodeWindowIdPayload(windowId, method)
    const request = yield* makeRequest(method, options, payload)
    yield* requireSuccess(yield* requireMatchingResponse(request, yield* exchange.request(request)))
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
): Effect.Effect<HostProtocolResponseEnvelope, HostProtocolError, never> => {
  if (response.error !== undefined) {
    return Effect.fail(response.error)
  }

  return Effect.succeed(response)
}

const decodeUnknownWindowCreatePayload = Schema.decodeUnknownSync(WindowCreatePayload)
const decodeUnknownWindowCreateResponse = Schema.decodeUnknownSync(WindowCreateResponse)
const decodeUnknownWindowDestroyPayload = Schema.decodeUnknownSync(WindowDestroyPayload)
const decodeUnknownWindowBoundsPayload = Schema.decodeUnknownSync(WindowBoundsPayload)
const decodeUnknownWindowSetBoundsPayload = Schema.decodeUnknownSync(WindowSetBoundsPayload)
const decodeUnknownWindowSetTitlePayload = Schema.decodeUnknownSync(WindowSetTitlePayload)
const decodeUnknownWindowSetResizablePayload = Schema.decodeUnknownSync(WindowSetResizablePayload)
const decodeUnknownWindowSetDecorationsPayload = Schema.decodeUnknownSync(
  WindowSetDecorationsPayload
)
const decodeUnknownWindowSetAlwaysOnTopPayload = Schema.decodeUnknownSync(
  WindowSetAlwaysOnTopPayload
)
const decodeUnknownWindowSetProgressPayload = Schema.decodeUnknownSync(WindowSetProgressPayload)
const decodeUnknownWindowRequestAttentionPayload = Schema.decodeUnknownSync(
  WindowRequestAttentionPayload
)
const decodeUnknownWindowSetFullscreenPayload = Schema.decodeUnknownSync(WindowSetFullscreenPayload)
const decodeUnknownWindowStatePayload = Schema.decodeUnknownSync(WindowStatePayload)

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

const encodeWindowIdPayload = (
  windowId: string,
  method: string
): Effect.Effect<WindowDestroyPayload, HostProtocolError, never> =>
  Effect.try({
    try: () => decodeUnknownWindowDestroyPayload({ windowId }, StrictParseOptions),
    catch: (error) => invalidArgument("windowId", error, method)
  })

const encodeSetBoundsPayload = (
  windowId: string,
  bounds: WindowBoundsInput
): Effect.Effect<WindowSetBoundsPayload, HostProtocolError, never> =>
  Effect.try({
    try: () => decodeUnknownWindowSetBoundsPayload({ windowId, bounds }, StrictParseOptions),
    catch: (error) => invalidArgument("payload", error, WINDOW_SET_BOUNDS_METHOD)
  })

const encodeSetTitlePayload = (
  windowId: string,
  title: string
): Effect.Effect<WindowSetTitlePayload, HostProtocolError, never> =>
  Effect.try({
    try: () => decodeUnknownWindowSetTitlePayload({ windowId, title }, StrictParseOptions),
    catch: (error) => invalidArgument("payload", error, WINDOW_SET_TITLE_METHOD)
  })

const encodeSetResizablePayload = (
  windowId: string,
  resizable: boolean
): Effect.Effect<WindowSetResizablePayload, HostProtocolError, never> =>
  Effect.try({
    try: () => decodeUnknownWindowSetResizablePayload({ windowId, resizable }, StrictParseOptions),
    catch: (error) => invalidArgument("payload", error, WINDOW_SET_RESIZABLE_METHOD)
  })

const encodeSetDecorationsPayload = (
  windowId: string,
  decorations: boolean
): Effect.Effect<WindowSetDecorationsPayload, HostProtocolError, never> =>
  Effect.try({
    try: () =>
      decodeUnknownWindowSetDecorationsPayload({ windowId, decorations }, StrictParseOptions),
    catch: (error) => invalidArgument("payload", error, WINDOW_SET_DECORATIONS_METHOD)
  })

const encodeSetAlwaysOnTopPayload = (
  windowId: string,
  alwaysOnTop: boolean
): Effect.Effect<WindowSetAlwaysOnTopPayload, HostProtocolError, never> =>
  Effect.try({
    try: () =>
      decodeUnknownWindowSetAlwaysOnTopPayload({ windowId, alwaysOnTop }, StrictParseOptions),
    catch: (error) => invalidArgument("payload", error, WINDOW_SET_ALWAYS_ON_TOP_METHOD)
  })

const encodeSetProgressPayload = (
  windowId: string,
  input: WindowProgressInput
): Effect.Effect<WindowSetProgressPayload, HostProtocolError, never> =>
  Effect.try({
    try: () =>
      decodeUnknownWindowSetProgressPayload(
        {
          windowId,
          ...(input.state === undefined ? {} : { state: input.state }),
          ...(input.progress === undefined ? {} : { progress: input.progress }),
          ...(input.desktopFilename === undefined ? {} : { desktopFilename: input.desktopFilename })
        },
        StrictParseOptions
      ),
    catch: (error) => invalidArgument("payload", error, WINDOW_SET_PROGRESS_METHOD)
  })

const encodeRequestAttentionPayload = (
  windowId: string,
  requestType: WindowAttentionTypeInput
): Effect.Effect<WindowRequestAttentionPayload, HostProtocolError, never> =>
  Effect.try({
    try: () =>
      decodeUnknownWindowRequestAttentionPayload({ windowId, requestType }, StrictParseOptions),
    catch: (error) => invalidArgument("payload", error, WINDOW_REQUEST_ATTENTION_METHOD)
  })

const encodeSetFullscreenPayload = (
  windowId: string,
  fullscreen: boolean
): Effect.Effect<WindowSetFullscreenPayload, HostProtocolError, never> =>
  Effect.try({
    try: () =>
      decodeUnknownWindowSetFullscreenPayload({ windowId, fullscreen }, StrictParseOptions),
    catch: (error) => invalidArgument("payload", error, WINDOW_SET_FULLSCREEN_METHOD)
  })

const decodeCreateResponse = (
  payload: unknown
): Effect.Effect<WindowCreateResponse, HostProtocolError, never> =>
  Effect.try({
    try: () => decodeUnknownWindowCreateResponse(payload, StrictParseOptions),
    catch: (error) =>
      makeHostProtocolInvalidOutputError(WINDOW_CREATE_METHOD, formatUnknownError(error))
  })

const decodeBoundsResponse = (
  payload: unknown,
  operation: string
): Effect.Effect<WindowBoundsPayload, HostProtocolError, never> =>
  Effect.try({
    try: () => decodeUnknownWindowBoundsPayload(payload, StrictParseOptions),
    catch: (error) => makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
  })

const decodeStateResponse = (
  payload: unknown,
  operation: string
): Effect.Effect<WindowStatePayload, HostProtocolError, never> =>
  Effect.try({
    try: () => decodeUnknownWindowStatePayload(payload, StrictParseOptions),
    catch: (error) => makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
  })

const makeRequest = (
  method: string,
  options: ResolvedHostWindowClientOptions,
  payload: unknown
): Effect.Effect<HostProtocolRequestEnvelope, never, never> =>
  currentTimeMillis(options.now).pipe(
    Effect.map(
      (timestamp) =>
        new HostProtocolRequestEnvelope({
          kind: "request",
          id: options.nextRequestId(),
          method,
          timestamp,
          traceId: options.nextTraceId(),
          payload
        })
    )
  )

const resolveOptions = (options: HostWindowClientOptions): ResolvedHostWindowClientOptions => ({
  nextRequestId: options.nextRequestId ?? (() => `request-${globalThis.crypto.randomUUID()}`),
  nextTraceId: options.nextTraceId ?? (() => `trace-${globalThis.crypto.randomUUID()}`),
  now: options.now
})

const currentTimeMillis = (now: (() => number) | undefined): Effect.Effect<number, never, never> =>
  now === undefined ? Clock.currentTimeMillis : Effect.sync(now)

const invalidArgument = (field: string, error: unknown, operation: string) =>
  makeHostProtocolInvalidArgumentError(field, formatUnknownError(error), operation)

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
