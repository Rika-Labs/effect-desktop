import { ResourceHandleSchema, type ResourceHandle } from "@orika/core"
import { Schema } from "effect"

import { BridgeSafeNonEmptyString, BridgeSafeString } from "./strings.js"
import { ImageMime } from "./image.js"
import { SessionProfileResource } from "./session-profile.js"
import { WindowResource } from "./window.js"

export const WebViewResource = ResourceHandleSchema("webview", "open")
export const WebViewFrameResource = ResourceHandleSchema("webview-frame", "open")
const WebViewNavigationDecision = Schema.Literals(["block", "openExternal"])
const WebViewNavigationUrl = BridgeSafeNonEmptyString.check(
  Schema.isPattern(/^(?!javascript:|data:|vbscript:|blob:|file:)[\s\S]*$/iu),
  Schema.makeFilter((value) => isAbsoluteUrl(value) || "must be an absolute URL")
)
const WebViewNavigationBlockedReason = BridgeSafeString
const WebViewOrigin = BridgeSafeNonEmptyString.check(
  Schema.isPattern(/^(?:app|https?):\/\/[^/?#\s]+$/iu)
)
const WebViewRoute = BridgeSafeNonEmptyString.check(
  Schema.isPattern(/^\/(?!.*(?:^|\/)\.\.(?:\/|$))[^?#]*$/u)
)
const WebViewApiName = BridgeSafeNonEmptyString.check(Schema.isPattern(/^[A-Za-z_$][\w$]*$/u))
const WebViewApiMethodName = BridgeSafeNonEmptyString.check(Schema.isPattern(/^[A-Za-z_$][\w$]*$/u))
const WebViewApiPayload = BridgeSafeString
const WebViewFindQuery = BridgeSafeNonEmptyString
const WebViewUserAgent = BridgeSafeNonEmptyString
const WebViewNonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const WebViewZoomFactor = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0))
const WebViewRuntimeRequestId = BridgeSafeNonEmptyString
const WebViewRuntimePath = BridgeSafeNonEmptyString.check(
  Schema.isPattern(/^(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))[\s\S]*$/u)
)
const WebViewRuntimeUrl = BridgeSafeNonEmptyString.check(
  Schema.isPattern(/^(?!javascript:|data:|vbscript:|blob:)[\s\S]*$/iu),
  Schema.makeFilter((value) => isAbsoluteUrl(value) || "must be an absolute URL")
)
const WebViewRuntimeEventPhase = Schema.Literals([
  "page-load-started",
  "page-load-finished",
  "drag-enter",
  "drag-over",
  "drag-drop",
  "drag-leave",
  "download-started",
  "download-completed",
  "permission-requested",
  "permission-resolved",
  "crashed",
  "unresponsive",
  "media-started",
  "media-stopped",
  "file-input-requested",
  "failed"
])
const WebViewPermissionDecision = Schema.Literals(["grant", "deny"])
const WebViewRuntimePermissionKind = Schema.Literals([
  "camera",
  "microphone",
  "display-capture",
  "geolocation",
  "notifications",
  "midi",
  "clipboard-read",
  "clipboard-write",
  "file-system",
  "unknown"
])
const WebViewFrameUrl = WebViewRuntimeUrl
const WebViewFrameMessagePayload = BridgeSafeString
const WebViewFrameEventReason = BridgeSafeString
const WebViewFrameEventPhase = Schema.Literals([
  "created",
  "navigated",
  "destroyed",
  "message",
  "failed"
])
export type WebViewHandle = ResourceHandle<"webview", "open">
export type WebViewFrameHandle = ResourceHandle<"webview-frame", "open">
export type WebViewRuntimeEventPhase = Schema.Schema.Type<typeof WebViewRuntimeEventPhase>
export type WebViewPermissionDecision = Schema.Schema.Type<typeof WebViewPermissionDecision>
export type WebViewRuntimePermissionKind = Schema.Schema.Type<typeof WebViewRuntimePermissionKind>
export type WebViewFrameEventPhase = Schema.Schema.Type<typeof WebViewFrameEventPhase>

export class WebViewNavigationPolicy extends Schema.Class<WebViewNavigationPolicy>(
  "WebViewNavigationPolicy"
)({
  allowedOrigins: Schema.Array(WebViewOrigin),
  onDisallowed: WebViewNavigationDecision
}) {}

export type WebViewNavigationPolicyOptions = Schema.Schema.Type<typeof WebViewNavigationPolicy>

export class WebViewExposedApi extends Schema.Class<WebViewExposedApi>("WebViewExposedApi")({
  name: WebViewApiName,
  methods: Schema.NonEmptyArray(WebViewApiMethodName)
}) {}

export class WebViewIsolationPolicy extends Schema.Class<WebViewIsolationPolicy>(
  "WebViewIsolationPolicy"
)({
  exposedApis: Schema.NonEmptyArray(WebViewExposedApi)
}) {}

export type WebViewIsolationPolicyOptions = Schema.Schema.Type<typeof WebViewIsolationPolicy>

export class WebViewCreateInput extends Schema.Class<WebViewCreateInput>("WebViewCreateInput")({
  window: WindowResource,
  url: WebViewNavigationUrl,
  originPolicy: WebViewNavigationPolicy,
  profile: Schema.optionalKey(SessionProfileResource),
  isolation: Schema.optionalKey(WebViewIsolationPolicy)
}) {}

export type WebViewCreateOptions = Schema.Schema.Type<typeof WebViewCreateInput>
export type WebViewCreateNavigationOptions = Omit<WebViewCreateOptions, "window">

export class WebViewHandleInput extends Schema.Class<WebViewHandleInput>("WebViewHandleInput")({
  webview: WebViewResource
}) {}

export class WebViewLoadRouteInput extends Schema.Class<WebViewLoadRouteInput>(
  "WebViewLoadRouteInput"
)({
  webview: WebViewResource,
  route: WebViewRoute
}) {}

export class WebViewLoadUrlInput extends Schema.Class<WebViewLoadUrlInput>("WebViewLoadUrlInput")({
  webview: WebViewResource,
  url: WebViewNavigationUrl
}) {}

export class WebViewNavigationState extends Schema.Class<WebViewNavigationState>(
  "WebViewNavigationState"
)({
  canGoBack: Schema.Boolean,
  canGoForward: Schema.Boolean,
  loading: Schema.Boolean
}) {}

export class WebViewSetNavigationPolicyInput extends Schema.Class<WebViewSetNavigationPolicyInput>(
  "WebViewSetNavigationPolicyInput"
)({
  webview: WebViewResource,
  policy: WebViewNavigationPolicy
}) {}

export const WebViewScreenshotMime = ImageMime
export type WebViewScreenshotMime = Schema.Schema.Type<typeof WebViewScreenshotMime>

export class WebViewScreenshot extends Schema.Class<WebViewScreenshot>("WebViewScreenshot")({
  mime: WebViewScreenshotMime,
  bytes: Schema.Uint8Array
}) {}

export class WebViewPdf extends Schema.Class<WebViewPdf>("WebViewPdf")({
  mime: Schema.Literal("application/pdf"),
  bytes: Schema.Uint8Array
}) {}

export class WebViewFindInPageInput extends Schema.Class<WebViewFindInPageInput>(
  "WebViewFindInPageInput"
)({
  webview: WebViewResource,
  query: WebViewFindQuery
}) {}

export class WebViewFindInPageResult extends Schema.Class<WebViewFindInPageResult>(
  "WebViewFindInPageResult"
)({
  matches: WebViewNonNegativeInt,
  activeMatchOrdinal: WebViewNonNegativeInt
}) {}

export class WebViewSetZoomInput extends Schema.Class<WebViewSetZoomInput>("WebViewSetZoomInput")({
  webview: WebViewResource,
  zoom: WebViewZoomFactor
}) {}

export class WebViewSetUserAgentInput extends Schema.Class<WebViewSetUserAgentInput>(
  "WebViewSetUserAgentInput"
)({
  webview: WebViewResource,
  userAgent: WebViewUserAgent
}) {}

export class WebViewSetAudioMutedInput extends Schema.Class<WebViewSetAudioMutedInput>(
  "WebViewSetAudioMutedInput"
)({
  webview: WebViewResource,
  muted: Schema.Boolean
}) {}

export class WebViewRespondToPermissionInput extends Schema.Class<WebViewRespondToPermissionInput>(
  "WebViewRespondToPermissionInput"
)({
  webview: WebViewResource,
  requestId: WebViewRuntimeRequestId,
  decision: WebViewPermissionDecision
}) {}

export class WebViewFrame extends Schema.Class<WebViewFrame>("WebViewFrame")({
  frame: WebViewFrameResource,
  parentFrame: Schema.optionalKey(WebViewFrameResource),
  url: Schema.optionalKey(WebViewFrameUrl)
}) {}

export class WebViewFrameList extends Schema.Class<WebViewFrameList>("WebViewFrameList")({
  webview: WebViewResource,
  frames: Schema.Array(WebViewFrame)
}) {}

export class WebViewPostToFrameInput extends Schema.Class<WebViewPostToFrameInput>(
  "WebViewPostToFrameInput"
)({
  webview: WebViewResource,
  frame: WebViewFrameResource,
  payload: WebViewFrameMessagePayload
}) {}

export class WebViewNavigationBlockedEvent extends Schema.Class<WebViewNavigationBlockedEvent>(
  "WebViewNavigationBlockedEvent"
)({
  webview: WebViewResource,
  url: WebViewNavigationUrl,
  reason: WebViewNavigationBlockedReason
}) {}

export class WebViewApiCallEvent extends Schema.Class<WebViewApiCallEvent>("WebViewApiCallEvent")({
  webview: WebViewResource,
  api: WebViewApiName,
  method: WebViewApiMethodName,
  payload: WebViewApiPayload
}) {}

export class WebViewRuntimePoint extends Schema.Class<WebViewRuntimePoint>("WebViewRuntimePoint")({
  x: Schema.Int,
  y: Schema.Int
}) {}

const WebViewRuntimeEventBase = {
  webview: WebViewResource
}

const WebViewRuntimeEventForbiddenMetadata = {
  reason: Schema.optionalKey(Schema.Never),
  requestId: Schema.optionalKey(Schema.Never),
  permission: Schema.optionalKey(Schema.Never),
  decision: Schema.optionalKey(Schema.Never)
}

const WebViewRuntimeEventForbiddenDragPayload = {
  paths: Schema.optionalKey(Schema.Never),
  position: Schema.optionalKey(Schema.Never)
}

const WebViewRuntimePlaceholderPhase = Schema.Literals([
  "download-started",
  "download-completed",
  "permission-requested",
  "permission-resolved",
  "crashed",
  "unresponsive",
  "media-started",
  "media-stopped",
  "file-input-requested",
  "failed"
])

const WebViewPageLoadStartedRuntimeEvent = Schema.Struct({
  ...WebViewRuntimeEventBase,
  phase: Schema.Literal("page-load-started"),
  url: WebViewRuntimeUrl,
  ...WebViewRuntimeEventForbiddenMetadata,
  ...WebViewRuntimeEventForbiddenDragPayload
})

const WebViewPageLoadFinishedRuntimeEvent = Schema.Struct({
  ...WebViewRuntimeEventBase,
  phase: Schema.Literal("page-load-finished"),
  url: WebViewRuntimeUrl,
  ...WebViewRuntimeEventForbiddenMetadata,
  ...WebViewRuntimeEventForbiddenDragPayload
})

const WebViewDragEnterRuntimeEvent = Schema.Struct({
  ...WebViewRuntimeEventBase,
  phase: Schema.Literal("drag-enter"),
  paths: Schema.Array(WebViewRuntimePath),
  position: WebViewRuntimePoint,
  url: Schema.optionalKey(Schema.Never),
  ...WebViewRuntimeEventForbiddenMetadata
})

const WebViewDragOverRuntimeEvent = Schema.Struct({
  ...WebViewRuntimeEventBase,
  phase: Schema.Literal("drag-over"),
  position: WebViewRuntimePoint,
  paths: Schema.optionalKey(Schema.Never),
  url: Schema.optionalKey(Schema.Never),
  ...WebViewRuntimeEventForbiddenMetadata
})

const WebViewDragDropRuntimeEvent = Schema.Struct({
  ...WebViewRuntimeEventBase,
  phase: Schema.Literal("drag-drop"),
  paths: Schema.Array(WebViewRuntimePath),
  position: WebViewRuntimePoint,
  url: Schema.optionalKey(Schema.Never),
  ...WebViewRuntimeEventForbiddenMetadata
})

const WebViewDragLeaveRuntimeEvent = Schema.Struct({
  ...WebViewRuntimeEventBase,
  phase: Schema.Literal("drag-leave"),
  url: Schema.optionalKey(Schema.Never),
  ...WebViewRuntimeEventForbiddenMetadata,
  ...WebViewRuntimeEventForbiddenDragPayload
})

const WebViewPlaceholderRuntimeEvent = Schema.Struct({
  ...WebViewRuntimeEventBase,
  phase: WebViewRuntimePlaceholderPhase,
  url: Schema.optionalKey(Schema.Never),
  ...WebViewRuntimeEventForbiddenMetadata,
  ...WebViewRuntimeEventForbiddenDragPayload
})

export const WebViewRuntimeEvent = Schema.Union([
  WebViewPageLoadStartedRuntimeEvent,
  WebViewPageLoadFinishedRuntimeEvent,
  WebViewDragEnterRuntimeEvent,
  WebViewDragOverRuntimeEvent,
  WebViewDragDropRuntimeEvent,
  WebViewDragLeaveRuntimeEvent,
  WebViewPlaceholderRuntimeEvent
])
export type WebViewRuntimeEvent = typeof WebViewRuntimeEvent.Type

const WebViewFrameEventShape = Schema.makeFilter<{
  readonly phase: WebViewFrameEventPhase
  readonly url?: string | undefined
  readonly payload?: string | undefined
  readonly reason?: string | undefined
}>((value) => {
  switch (value.phase) {
    case "created":
    case "navigated":
      if (value.url === undefined) {
        return `${value.phase} frame events require url`
      }
      if (value.payload !== undefined || value.reason !== undefined) {
        return `${value.phase} frame events must not carry payload or reason`
      }
      return true
    case "destroyed":
      return (
        (value.url === undefined && value.payload === undefined && value.reason === undefined) ||
        "destroyed frame events must not carry url, payload, or reason"
      )
    case "message":
      if (value.payload === undefined) {
        return "message frame events require payload"
      }
      if (value.url !== undefined || value.reason !== undefined) {
        return "message frame events must not carry url or reason"
      }
      return true
    case "failed":
      if (value.reason === undefined) {
        return "failed frame events require reason"
      }
      if (value.url !== undefined || value.payload !== undefined) {
        return "failed frame events must not carry url or payload"
      }
      return true
  }
})

export class WebViewFrameEvent extends Schema.Class<WebViewFrameEvent>("WebViewFrameEvent")(
  Schema.Struct({
    webview: WebViewResource,
    frame: WebViewFrameResource,
    parentFrame: Schema.optionalKey(WebViewFrameResource),
    phase: WebViewFrameEventPhase,
    url: Schema.optionalKey(WebViewFrameUrl),
    payload: Schema.optionalKey(WebViewFrameMessagePayload),
    reason: Schema.optionalKey(WebViewFrameEventReason)
  }).check(WebViewFrameEventShape)
) {}

const isAbsoluteUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value)
    return parsed.protocol.length > 1
  } catch {
    return false
  }
}
