import { Clock, Effect, Schema, Stream } from "effect"

import {
  HostProtocolEventEnvelope,
  HostProtocolRequestEnvelope,
  HostProtocolResponseEnvelope,
  WINDOW_CENTER_METHOD,
  WINDOW_CENTER_ON_DISPLAY_METHOD,
  WINDOW_CREATE_METHOD,
  WINDOW_CANCEL_ATTENTION_METHOD,
  WINDOW_DESTROY_METHOD,
  WINDOW_EVENT_METHOD,
  WINDOW_FOCUS_METHOD,
  WINDOW_GET_BOUNDS_METHOD,
  WINDOW_GET_BY_ID_METHOD,
  WINDOW_GET_CHILDREN_METHOD,
  WINDOW_GET_CURRENT_METHOD,
  WINDOW_GET_PARENT_METHOD,
  WINDOW_GET_STATE_METHOD,
  WINDOW_HIDE_METHOD,
  WINDOW_LIST_METHOD,
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
  WINDOW_SET_SHADOW_METHOD,
  WINDOW_SET_SKIP_TASKBAR_METHOD,
  WINDOW_SET_TITLE_METHOD,
  WINDOW_SET_TRAFFIC_LIGHTS_METHOD,
  WINDOW_SET_VIBRANCY_METHOD,
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
const WindowRegistryEventPhase = Schema.Literals(["opened", "shown", "hidden", "focused", "closed"])
const UInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const WindowResourcePayload = Schema.Struct({
  kind: Schema.Literal("window"),
  id: Schema.NonEmptyString,
  generation: UInt,
  ownerScope: Schema.NonEmptyString,
  state: Schema.Literal("open")
})

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

export class WindowLookupResponse extends Schema.Class<WindowLookupResponse>(
  "WindowLookupResponse"
)({
  windowId: Schema.NonEmptyString
}) {}

export class WindowListResponse extends Schema.Class<WindowListResponse>("WindowListResponse")({
  windows: Schema.Array(WindowLookupResponse)
}) {}

export class WindowParentResponse extends Schema.Class<WindowParentResponse>(
  "WindowParentResponse"
)({
  parentWindowId: Schema.optionalKey(Schema.NonEmptyString)
}) {}

export class WindowChildrenResponse extends Schema.Class<WindowChildrenResponse>(
  "WindowChildrenResponse"
)({
  windows: Schema.Array(WindowLookupResponse)
}) {}

export class WindowRegistryEventPayload extends Schema.Class<WindowRegistryEventPayload>(
  "WindowRegistryEventPayload"
)({
  type: Schema.Literal("window-registry-event"),
  phase: WindowRegistryEventPhase,
  windowId: Schema.NonEmptyString,
  window: Schema.optionalKey(WindowResourcePayload),
  terminal: Schema.Boolean
}) {}

export class WindowStatePayload extends Schema.Class<WindowStatePayload>("WindowStatePayload")({
  minimized: Schema.Boolean,
  maximized: Schema.Boolean,
  fullscreen: Schema.Boolean
}) {}

export class WindowStateEventPayload extends Schema.Class<WindowStateEventPayload>(
  "WindowStateEventPayload"
)({
  type: Schema.Literal("window-state-event"),
  windowId: Schema.NonEmptyString,
  window: Schema.optionalKey(WindowResourcePayload),
  state: WindowStatePayload
}) {}

export const WindowEventPayload = Schema.Union([
  WindowRegistryEventPayload,
  WindowStateEventPayload
])

export type WindowEventPayload = Schema.Schema.Type<typeof WindowEventPayload>

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

export class WindowCenterOnDisplayPayload extends Schema.Class<WindowCenterOnDisplayPayload>(
  "WindowCenterOnDisplayPayload"
)({
  windowId: Schema.NonEmptyString,
  displayId: Schema.NonEmptyString
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

export class WindowSetTrafficLightsPayload extends Schema.Class<WindowSetTrafficLightsPayload>(
  "WindowSetTrafficLightsPayload"
)({
  windowId: Schema.NonEmptyString,
  trafficLights: WindowTrafficLights
}) {}

export class WindowSetVibrancyPayload extends Schema.Class<WindowSetVibrancyPayload>(
  "WindowSetVibrancyPayload"
)({
  windowId: Schema.NonEmptyString,
  material: WindowVibrancyMaterial
}) {}

export class WindowSetShadowPayload extends Schema.Class<WindowSetShadowPayload>(
  "WindowSetShadowPayload"
)({
  windowId: Schema.NonEmptyString,
  hasShadow: Schema.Boolean
}) {}

export class WindowSetAlwaysOnTopPayload extends Schema.Class<WindowSetAlwaysOnTopPayload>(
  "WindowSetAlwaysOnTopPayload"
)({
  windowId: Schema.NonEmptyString,
  alwaysOnTop: Schema.Boolean
}) {}

export class WindowSetSkipTaskbarPayload extends Schema.Class<WindowSetSkipTaskbarPayload>(
  "WindowSetSkipTaskbarPayload"
)({
  windowId: Schema.NonEmptyString,
  skipTaskbar: Schema.Boolean
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

export type WindowVibrancyInput = Schema.Schema.Type<typeof WindowVibrancyMaterial>
export type WindowAttentionTypeInput = Schema.Schema.Type<typeof WindowAttentionType>

export interface HostWindowExchange {
  readonly request: (
    request: HostProtocolRequestEnvelope
  ) => Effect.Effect<HostProtocolResponseEnvelope, HostProtocolError, never>
  readonly subscribe?: (
    method: string
  ) => Stream.Stream<HostProtocolEventEnvelope, HostProtocolError, never>
}

export interface HostWindowClient {
  readonly create: (
    input?: WindowCreateInput
  ) => Effect.Effect<WindowCreateResponse, HostProtocolError, never>
  readonly show: (windowId: string) => Effect.Effect<void, HostProtocolError, never>
  readonly hide: (windowId: string) => Effect.Effect<void, HostProtocolError, never>
  readonly focus: (windowId: string) => Effect.Effect<void, HostProtocolError, never>
  readonly getCurrent: () => Effect.Effect<WindowLookupResponse, HostProtocolError, never>
  readonly getById: (
    windowId: string
  ) => Effect.Effect<WindowLookupResponse, HostProtocolError, never>
  readonly list: () => Effect.Effect<WindowListResponse, HostProtocolError, never>
  readonly getParent: (
    windowId: string
  ) => Effect.Effect<WindowParentResponse, HostProtocolError, never>
  readonly getChildren: (
    windowId: string
  ) => Effect.Effect<WindowChildrenResponse, HostProtocolError, never>
  readonly getBounds: (
    windowId: string
  ) => Effect.Effect<WindowBoundsPayload, HostProtocolError, never>
  readonly setBounds: (
    windowId: string,
    bounds: WindowBoundsInput
  ) => Effect.Effect<void, HostProtocolError, never>
  readonly center: (windowId: string) => Effect.Effect<void, HostProtocolError, never>
  readonly centerOnDisplay: (
    windowId: string,
    displayId: string
  ) => Effect.Effect<void, HostProtocolError, never>
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
  readonly setTrafficLights: (
    windowId: string,
    trafficLights: Schema.Schema.Type<typeof WindowTrafficLights>
  ) => Effect.Effect<void, HostProtocolError, never>
  readonly setVibrancy: (
    windowId: string,
    material: WindowVibrancyInput
  ) => Effect.Effect<void, HostProtocolError, never>
  readonly setShadow: (
    windowId: string,
    hasShadow: boolean
  ) => Effect.Effect<void, HostProtocolError, never>
  readonly setAlwaysOnTop: (
    windowId: string,
    alwaysOnTop: boolean
  ) => Effect.Effect<void, HostProtocolError, never>
  readonly setSkipTaskbar: (
    windowId: string,
    skipTaskbar: boolean
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
  readonly events: () => Stream.Stream<WindowEventPayload, HostProtocolError, never>
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
    getCurrent: () =>
      Effect.gen(function* () {
        const request = yield* makeRequest(WINDOW_GET_CURRENT_METHOD, resolved)
        const response = yield* requireSuccess(
          yield* requireMatchingResponse(request, yield* exchange.request(request))
        )
        return yield* decodeLookupResponse(response.payload, WINDOW_GET_CURRENT_METHOD)
      }),
    getById: (windowId) =>
      Effect.gen(function* () {
        const payload = yield* encodeWindowIdPayload(windowId, WINDOW_GET_BY_ID_METHOD)
        const request = yield* makeRequest(WINDOW_GET_BY_ID_METHOD, resolved, payload)
        const response = yield* requireSuccess(
          yield* requireMatchingResponse(request, yield* exchange.request(request))
        )
        return yield* decodeLookupResponse(response.payload, WINDOW_GET_BY_ID_METHOD)
      }),
    list: () =>
      Effect.gen(function* () {
        const request = yield* makeRequest(WINDOW_LIST_METHOD, resolved)
        const response = yield* requireSuccess(
          yield* requireMatchingResponse(request, yield* exchange.request(request))
        )
        return yield* decodeListResponse(response.payload, WINDOW_LIST_METHOD)
      }),
    getParent: (windowId) =>
      Effect.gen(function* () {
        const payload = yield* encodeWindowIdPayload(windowId, WINDOW_GET_PARENT_METHOD)
        const request = yield* makeRequest(WINDOW_GET_PARENT_METHOD, resolved, payload)
        const response = yield* requireSuccess(
          yield* requireMatchingResponse(request, yield* exchange.request(request))
        )
        return yield* decodeParentResponse(response.payload, WINDOW_GET_PARENT_METHOD)
      }),
    getChildren: (windowId) =>
      Effect.gen(function* () {
        const payload = yield* encodeWindowIdPayload(windowId, WINDOW_GET_CHILDREN_METHOD)
        const request = yield* makeRequest(WINDOW_GET_CHILDREN_METHOD, resolved, payload)
        const response = yield* requireSuccess(
          yield* requireMatchingResponse(request, yield* exchange.request(request))
        )
        return yield* decodeChildrenResponse(response.payload, WINDOW_GET_CHILDREN_METHOD)
      }),
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
    centerOnDisplay: (windowId, displayId) =>
      Effect.gen(function* () {
        const payload = yield* encodeCenterOnDisplayPayload(windowId, displayId)
        const request = yield* makeRequest(WINDOW_CENTER_ON_DISPLAY_METHOD, resolved, payload)
        yield* requireSuccess(
          yield* requireMatchingResponse(request, yield* exchange.request(request))
        )
      }),
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
    setTrafficLights: (windowId, trafficLights) =>
      Effect.gen(function* () {
        const payload = yield* encodeSetTrafficLightsPayload(windowId, trafficLights)
        const request = yield* makeRequest(WINDOW_SET_TRAFFIC_LIGHTS_METHOD, resolved, payload)
        yield* requireSuccess(
          yield* requireMatchingResponse(request, yield* exchange.request(request))
        )
      }),
    setVibrancy: (windowId, material) =>
      Effect.gen(function* () {
        const payload = yield* encodeSetVibrancyPayload(windowId, material)
        const request = yield* makeRequest(WINDOW_SET_VIBRANCY_METHOD, resolved, payload)
        yield* requireSuccess(
          yield* requireMatchingResponse(request, yield* exchange.request(request))
        )
      }),
    setShadow: (windowId, hasShadow) =>
      Effect.gen(function* () {
        const payload = yield* encodeSetShadowPayload(windowId, hasShadow)
        const request = yield* makeRequest(WINDOW_SET_SHADOW_METHOD, resolved, payload)
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
    setSkipTaskbar: (windowId, skipTaskbar) =>
      Effect.gen(function* () {
        const payload = yield* encodeSetSkipTaskbarPayload(windowId, skipTaskbar)
        const request = yield* makeRequest(WINDOW_SET_SKIP_TASKBAR_METHOD, resolved, payload)
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
    events: () => subscribeWindowEvents(exchange),
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
const decodeUnknownWindowLookupResponse = Schema.decodeUnknownSync(WindowLookupResponse)
const decodeUnknownWindowListResponse = Schema.decodeUnknownSync(WindowListResponse)
const decodeUnknownWindowParentResponse = Schema.decodeUnknownSync(WindowParentResponse)
const decodeUnknownWindowChildrenResponse = Schema.decodeUnknownSync(WindowChildrenResponse)
const decodeUnknownWindowEventPayload = Schema.decodeUnknownSync(WindowEventPayload)
const decodeUnknownWindowBoundsPayload = Schema.decodeUnknownSync(WindowBoundsPayload)
const decodeUnknownWindowSetBoundsPayload = Schema.decodeUnknownSync(WindowSetBoundsPayload)
const decodeUnknownWindowCenterOnDisplayPayload = Schema.decodeUnknownSync(
  WindowCenterOnDisplayPayload
)
const decodeUnknownWindowSetTitlePayload = Schema.decodeUnknownSync(WindowSetTitlePayload)
const decodeUnknownWindowSetResizablePayload = Schema.decodeUnknownSync(WindowSetResizablePayload)
const decodeUnknownWindowSetDecorationsPayload = Schema.decodeUnknownSync(
  WindowSetDecorationsPayload
)
const decodeUnknownWindowSetTrafficLightsPayload = Schema.decodeUnknownSync(
  WindowSetTrafficLightsPayload
)
const decodeUnknownWindowSetVibrancyPayload = Schema.decodeUnknownSync(WindowSetVibrancyPayload)
const decodeUnknownWindowSetShadowPayload = Schema.decodeUnknownSync(WindowSetShadowPayload)
const decodeUnknownWindowSetAlwaysOnTopPayload = Schema.decodeUnknownSync(
  WindowSetAlwaysOnTopPayload
)
const decodeUnknownWindowSetSkipTaskbarPayload = Schema.decodeUnknownSync(
  WindowSetSkipTaskbarPayload
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

const encodeCenterOnDisplayPayload = (
  windowId: string,
  displayId: string
): Effect.Effect<WindowCenterOnDisplayPayload, HostProtocolError, never> =>
  Effect.try({
    try: () =>
      decodeUnknownWindowCenterOnDisplayPayload({ windowId, displayId }, StrictParseOptions),
    catch: (error) => invalidArgument("payload", error, WINDOW_CENTER_ON_DISPLAY_METHOD)
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

const encodeSetTrafficLightsPayload = (
  windowId: string,
  trafficLights: Schema.Schema.Type<typeof WindowTrafficLights>
): Effect.Effect<WindowSetTrafficLightsPayload, HostProtocolError, never> =>
  Effect.try({
    try: () =>
      decodeUnknownWindowSetTrafficLightsPayload({ windowId, trafficLights }, StrictParseOptions),
    catch: (error) => invalidArgument("payload", error, WINDOW_SET_TRAFFIC_LIGHTS_METHOD)
  })

const encodeSetVibrancyPayload = (
  windowId: string,
  material: WindowVibrancyInput
): Effect.Effect<WindowSetVibrancyPayload, HostProtocolError, never> =>
  Effect.try({
    try: () => decodeUnknownWindowSetVibrancyPayload({ windowId, material }, StrictParseOptions),
    catch: (error) => invalidArgument("payload", error, WINDOW_SET_VIBRANCY_METHOD)
  })

const encodeSetShadowPayload = (
  windowId: string,
  hasShadow: boolean
): Effect.Effect<WindowSetShadowPayload, HostProtocolError, never> =>
  Effect.try({
    try: () => decodeUnknownWindowSetShadowPayload({ windowId, hasShadow }, StrictParseOptions),
    catch: (error) => invalidArgument("payload", error, WINDOW_SET_SHADOW_METHOD)
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

const encodeSetSkipTaskbarPayload = (
  windowId: string,
  skipTaskbar: boolean
): Effect.Effect<WindowSetSkipTaskbarPayload, HostProtocolError, never> =>
  Effect.try({
    try: () =>
      decodeUnknownWindowSetSkipTaskbarPayload({ windowId, skipTaskbar }, StrictParseOptions),
    catch: (error) => invalidArgument("payload", error, WINDOW_SET_SKIP_TASKBAR_METHOD)
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

const decodeLookupResponse = (
  payload: unknown,
  operation: string
): Effect.Effect<WindowLookupResponse, HostProtocolError, never> =>
  Effect.try({
    try: () => decodeUnknownWindowLookupResponse(payload, StrictParseOptions),
    catch: (error) => makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
  })

const decodeListResponse = (
  payload: unknown,
  operation: string
): Effect.Effect<WindowListResponse, HostProtocolError, never> =>
  Effect.try({
    try: () => decodeUnknownWindowListResponse(payload, StrictParseOptions),
    catch: (error) => makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
  })

const decodeParentResponse = (
  payload: unknown,
  operation: string
): Effect.Effect<WindowParentResponse, HostProtocolError, never> =>
  Effect.try({
    try: () => decodeUnknownWindowParentResponse(payload, StrictParseOptions),
    catch: (error) => makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
  })

const decodeChildrenResponse = (
  payload: unknown,
  operation: string
): Effect.Effect<WindowChildrenResponse, HostProtocolError, never> =>
  Effect.try({
    try: () => decodeUnknownWindowChildrenResponse(payload, StrictParseOptions),
    catch: (error) => makeHostProtocolInvalidOutputError(operation, formatUnknownError(error))
  })

const subscribeWindowEvents = (
  exchange: HostWindowExchange
): Stream.Stream<WindowEventPayload, HostProtocolError, never> => {
  if (exchange.subscribe === undefined) {
    return Stream.fail(
      makeHostProtocolInvalidOutputError(
        WINDOW_EVENT_METHOD,
        "event exchange does not support subscriptions"
      )
    )
  }

  return exchange.subscribe(WINDOW_EVENT_METHOD).pipe(
    Stream.mapEffect((event) => {
      if (event.method !== WINDOW_EVENT_METHOD) {
        return Effect.fail(
          makeHostProtocolInvalidOutputError(
            WINDOW_EVENT_METHOD,
            `unexpected event method: ${event.method}`
          )
        )
      }

      return Effect.try({
        try: () => decodeUnknownWindowEventPayload(event.payload, StrictParseOptions),
        catch: (error) =>
          makeHostProtocolInvalidOutputError(WINDOW_EVENT_METHOD, formatUnknownError(error))
      })
    })
  )
}

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
  payload?: unknown
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
          ...(payload === undefined ? {} : { payload })
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
