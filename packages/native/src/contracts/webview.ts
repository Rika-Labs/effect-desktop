import { ResourceHandleSchema, type ResourceHandle } from "@effect-desktop/core"
import { Schema } from "effect"

import { BridgeSafeNonEmptyString, BridgeSafeString } from "./strings.js"
import { ImageMime } from "./image.js"
import { WindowResource } from "./window.js"

export const WebViewResource = ResourceHandleSchema("webview", "open")
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
export type WebViewHandle = ResourceHandle<"webview", "open">

export class WebViewNavigationPolicy extends Schema.Class<WebViewNavigationPolicy>(
  "WebViewNavigationPolicy"
)({
  allowedOrigins: Schema.Array(WebViewOrigin),
  onDisallowed: WebViewNavigationDecision
}) {}

export type WebViewNavigationPolicyOptions = Schema.Schema.Type<typeof WebViewNavigationPolicy>

export class WebViewCreateInput extends Schema.Class<WebViewCreateInput>("WebViewCreateInput")({
  window: WindowResource,
  url: WebViewNavigationUrl,
  originPolicy: WebViewNavigationPolicy
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

export class WebViewNavigationBlockedEvent extends Schema.Class<WebViewNavigationBlockedEvent>(
  "WebViewNavigationBlockedEvent"
)({
  webview: WebViewResource,
  url: WebViewNavigationUrl,
  reason: WebViewNavigationBlockedReason
}) {}

const isAbsoluteUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value)
    return parsed.protocol.length > 1
  } catch {
    return false
  }
}
