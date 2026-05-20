import { ResourceHandleSchema, type ResourceHandle } from "@effect-desktop/core"
import { Schema } from "effect"

import { BridgeSafeNonEmptyString, BridgeSafeString } from "./strings.js"
import { ImageMime } from "./image.js"
import { WindowResource } from "./window.js"

export const WebViewResource = ResourceHandleSchema("webview", "open")
export const WebViewFrameResource = ResourceHandleSchema("webview-frame", "open")
const WebViewPlatform = Schema.Literals(["macos", "windows", "linux"])
const WebViewRuntimeMode = Schema.Literals(["dev", "prod"])
const WebViewCapabilityName = Schema.Literals([
  "print",
  "popup blocking",
  "autofill",
  "devtools open",
  "getUserMedia",
  "service workers in app:",
  "PDF embedded viewer"
])
const WebViewNavigationDecision = Schema.Literals(["block", "openExternal"])
export type WebViewPlatform = Schema.Schema.Type<typeof WebViewPlatform>
export type WebViewRuntimeMode = Schema.Schema.Type<typeof WebViewRuntimeMode>
export type WebViewCapabilityName = Schema.Schema.Type<typeof WebViewCapabilityName>
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
const WebViewRuntimeEventReason = BridgeSafeString
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

export class WebViewCapabilityInput extends Schema.Class<WebViewCapabilityInput>(
  "WebViewCapabilityInput"
)({
  name: WebViewCapabilityName,
  platform: Schema.optionalKey(WebViewPlatform),
  mode: Schema.optionalKey(WebViewRuntimeMode)
}) {}

export type WebViewCapabilityOptions = Schema.Schema.Type<typeof WebViewCapabilityInput>

export class WebViewCapabilityResult extends Schema.Class<WebViewCapabilityResult>(
  "WebViewCapabilityResult"
)({
  supported: Schema.Boolean
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

export class WebViewRuntimeEvent extends Schema.Class<WebViewRuntimeEvent>("WebViewRuntimeEvent")({
  webview: WebViewResource,
  phase: WebViewRuntimeEventPhase,
  url: Schema.optionalKey(WebViewRuntimeUrl),
  reason: Schema.optionalKey(WebViewRuntimeEventReason),
  requestId: Schema.optionalKey(WebViewRuntimeRequestId),
  permission: Schema.optionalKey(WebViewRuntimePermissionKind),
  decision: Schema.optionalKey(WebViewPermissionDecision),
  position: Schema.optionalKey(WebViewRuntimePoint),
  paths: Schema.optionalKey(Schema.Array(WebViewRuntimePath))
}) {}

export class WebViewFrameEvent extends Schema.Class<WebViewFrameEvent>("WebViewFrameEvent")({
  webview: WebViewResource,
  frame: WebViewFrameResource,
  parentFrame: Schema.optionalKey(WebViewFrameResource),
  phase: WebViewFrameEventPhase,
  url: Schema.optionalKey(WebViewFrameUrl),
  payload: Schema.optionalKey(WebViewFrameMessagePayload),
  reason: Schema.optionalKey(WebViewFrameEventReason)
}) {}

const isAbsoluteUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value)
    return parsed.protocol.length > 1
  } catch {
    return false
  }
}
