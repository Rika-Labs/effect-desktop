import { Api, type ApiResourceHandle } from "@effect-desktop/bridge"
import { Schema } from "effect"

import { BridgeSafeNonEmptyString, BridgeSafeString } from "./strings.js"
import { ImageMime } from "./image.js"

export const WebViewResource = Api.Resource("webview", "open")
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
  Schema.isPattern(/^(?!javascript:|data:|vbscript:|blob:|file:)[\s\S]*$/iu)
)
const WebViewNavigationBlockedReason = BridgeSafeString
const WebViewOrigin = BridgeSafeNonEmptyString.check(
  Schema.isPattern(/^(?:app|https?):\/\/[^/?#\s]+$/iu)
)
const WebViewRoute = BridgeSafeNonEmptyString.check(
  Schema.isPattern(/^\/(?!.*(?:^|\/)\.\.(?:\/|$))[^?#]*$/u)
)
export type WebViewHandle = ApiResourceHandle<"webview", "open">

export class WebViewNavigationPolicy extends Schema.Class<WebViewNavigationPolicy>(
  "WebViewNavigationPolicy"
)({
  allowedOrigins: Schema.Array(WebViewOrigin),
  onDisallowed: WebViewNavigationDecision
}) {}

export type WebViewNavigationPolicyOptions = Schema.Schema.Type<typeof WebViewNavigationPolicy>

export class WebViewCreateInput extends Schema.Class<WebViewCreateInput>("WebViewCreateInput")({
  url: WebViewNavigationUrl,
  originPolicy: WebViewNavigationPolicy
}) {}

export type WebViewCreateOptions = Schema.Schema.Type<typeof WebViewCreateInput>

export class WebViewHandleInput extends Schema.Class<WebViewHandleInput>("WebViewHandleInput")({
  webview: WebViewResource.schema
}) {}

export class WebViewLoadRouteInput extends Schema.Class<WebViewLoadRouteInput>(
  "WebViewLoadRouteInput"
)({
  webview: WebViewResource.schema,
  route: WebViewRoute
}) {}

export class WebViewLoadUrlInput extends Schema.Class<WebViewLoadUrlInput>("WebViewLoadUrlInput")({
  webview: WebViewResource.schema,
  url: WebViewNavigationUrl
}) {}

export class WebViewSetNavigationPolicyInput extends Schema.Class<WebViewSetNavigationPolicyInput>(
  "WebViewSetNavigationPolicyInput"
)({
  webview: WebViewResource.schema,
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
  webview: WebViewResource.schema,
  url: Schema.String,
  reason: WebViewNavigationBlockedReason
}) {}
