import { ResourceHandleSchema, type ResourceHandle } from "@orika/core"
import { Schema } from "effect"

import { SessionProfileResource } from "./session-profile.js"
import { BridgeSafeNonEmptyString, BridgeSafeString } from "./strings.js"

export const WebRequestInterceptorResource = ResourceHandleSchema("web-request-interceptor", "open")
export type WebRequestInterceptorHandle = ResourceHandle<"web-request-interceptor", "open">

const WebRequestUrlPattern = BridgeSafeNonEmptyString.check(
  Schema.isPattern(/^(?:\*|app|https?):\/\/[^\s]*$/iu)
)
const WebRequestRedirectUrl = BridgeSafeNonEmptyString.check(
  Schema.isPattern(/^(?!javascript:|data:|vbscript:|blob:|file:)[\s\S]*$/iu),
  Schema.makeFilter((value) => isAbsoluteHttpUrl(value) || "must be an absolute HTTP(S) URL")
)
const WebRequestHeaderName = BridgeSafeNonEmptyString.check(
  Schema.isPattern(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u)
)
const WebRequestOrder = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const WebRequestPhase = Schema.Literals(["before-request", "headers-received"])
export type WebRequestPhase = typeof WebRequestPhase.Type

export const WebRequestAction = Schema.Literals(["allow", "block", "redirect", "modify-headers"])
export type WebRequestAction = typeof WebRequestAction.Type

const WebRequestEventPhase = Schema.Literals(["registered", "removed", "matched", "failed"])
export type WebRequestEventPhase = typeof WebRequestEventPhase.Type
const WebRequestEventPhaseMessage = Schema.makeFilter<{
  readonly phase: WebRequestEventPhase
  readonly message?: string | undefined
}>((value) => {
  switch (value.phase) {
    case "registered":
    case "removed":
    case "matched":
      return (
        value.message === undefined || `${value.phase} web request events must not carry message`
      )
    case "failed":
      return value.message !== undefined || "failed web request events require message"
  }
})

const WebRequestBeforeRequestRedirect = Schema.makeFilter<{
  readonly action: "allow" | "block" | "redirect"
  readonly redirectUrl?: string | undefined
}>((value) => {
  if (value.action === "redirect") {
    return value.redirectUrl !== undefined || "redirect action requires redirectUrl"
  }
  return value.redirectUrl === undefined || "redirectUrl requires redirect action"
})
export class WebRequestHeader extends Schema.Class<WebRequestHeader>("WebRequestHeader")({
  name: WebRequestHeaderName,
  value: BridgeSafeString
}) {}

export class WebRequestBeforeRequestInput extends Schema.Class<WebRequestBeforeRequestInput>(
  "WebRequestBeforeRequestInput"
)(
  Schema.Struct({
    profile: SessionProfileResource,
    urlPattern: WebRequestUrlPattern,
    action: Schema.Literals(["allow", "block", "redirect"]),
    redirectUrl: Schema.optionalKey(WebRequestRedirectUrl),
    ownerScope: Schema.optionalKey(BridgeSafeNonEmptyString),
    traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
  }).check(WebRequestBeforeRequestRedirect)
) {}

export class WebRequestHeadersReceivedInput extends Schema.Class<WebRequestHeadersReceivedInput>(
  "WebRequestHeadersReceivedInput"
)({
  profile: SessionProfileResource,
  urlPattern: WebRequestUrlPattern,
  responseHeaders: Schema.Array(WebRequestHeader),
  ownerScope: Schema.optionalKey(BridgeSafeNonEmptyString),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class WebRequestRemoveListenerInput extends Schema.Class<WebRequestRemoveListenerInput>(
  "WebRequestRemoveListenerInput"
)({
  interceptor: WebRequestInterceptorResource,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

const WebRequestInterceptorSnapshotBase = {
  interceptor: WebRequestInterceptorResource,
  profile: SessionProfileResource,
  urlPattern: WebRequestUrlPattern,
  order: WebRequestOrder
}

const WebRequestInterceptorSnapshotForbiddenRedirect = {
  redirectUrl: Schema.optionalKey(Schema.Never)
}

const WebRequestInterceptorSnapshotForbiddenHeaders = {
  responseHeaders: Schema.optionalKey(Schema.Never)
}

const WebRequestBeforeRequestSnapshot = Schema.Struct({
  ...WebRequestInterceptorSnapshotBase,
  phase: Schema.Literal("before-request"),
  action: Schema.Literals(["allow", "block"]),
  ...WebRequestInterceptorSnapshotForbiddenRedirect,
  ...WebRequestInterceptorSnapshotForbiddenHeaders
})

const WebRequestBeforeRequestRedirectSnapshot = Schema.Struct({
  ...WebRequestInterceptorSnapshotBase,
  phase: Schema.Literal("before-request"),
  action: Schema.Literal("redirect"),
  redirectUrl: WebRequestRedirectUrl,
  ...WebRequestInterceptorSnapshotForbiddenHeaders
})

const WebRequestHeadersReceivedSnapshot = Schema.Struct({
  ...WebRequestInterceptorSnapshotBase,
  phase: Schema.Literal("headers-received"),
  action: Schema.Literal("modify-headers"),
  responseHeaders: Schema.Array(WebRequestHeader),
  ...WebRequestInterceptorSnapshotForbiddenRedirect
})

export const WebRequestInterceptorSnapshot = Schema.Union([
  WebRequestBeforeRequestSnapshot,
  WebRequestBeforeRequestRedirectSnapshot,
  WebRequestHeadersReceivedSnapshot
])
export type WebRequestInterceptorSnapshot = typeof WebRequestInterceptorSnapshot.Type

export class WebRequestSupportedResult extends Schema.Class<WebRequestSupportedResult>(
  "WebRequestSupportedResult"
)({
  supported: Schema.Boolean,
  reason: Schema.optionalKey(BridgeSafeString)
}) {}

export class WebRequestEvent extends Schema.Class<WebRequestEvent>("WebRequestEvent")(
  Schema.Struct({
    type: Schema.Literal("web-request-event"),
    timestamp: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)),
    phase: WebRequestEventPhase,
    interceptor: WebRequestInterceptorResource,
    profile: SessionProfileResource,
    requestPhase: WebRequestPhase,
    urlPattern: WebRequestUrlPattern,
    action: WebRequestAction,
    order: WebRequestOrder,
    message: Schema.optionalKey(BridgeSafeString)
  }).check(WebRequestEventPhaseMessage)
) {}

const isAbsoluteHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}
