import { Schema } from "effect"

import { SessionProfileResource } from "./session-profile.js"
import { BridgeSafeNonEmptyString, BridgeSafeString } from "./strings.js"

const CookieName = BridgeSafeNonEmptyString
const CookieValue = BridgeSafeString
const CookieDomain = BridgeSafeNonEmptyString
const CookiePath = BridgeSafeNonEmptyString.check(Schema.isPattern(/^\/[\s\S]*$/u))
const CookieUrl = BridgeSafeNonEmptyString.check(
  Schema.isPattern(/^(?!javascript:|data:|vbscript:|blob:|file:)[\s\S]*$/iu),
  Schema.makeFilter((value) => {
    try {
      const url = new URL(value)
      return url.protocol === "http:" || url.protocol === "https:" || "must be an HTTP(S) URL"
    } catch {
      return "must be an absolute HTTP(S) URL"
    }
  })
)
const CookieSameSite = Schema.Literals(["lax", "strict", "none"])
const CookieEventPhase = Schema.Literals(["set", "removed", "failed"])

export type CookieSameSite = typeof CookieSameSite.Type
export type CookieEventPhase = typeof CookieEventPhase.Type

export class CookieStoreCookie extends Schema.Class<CookieStoreCookie>("CookieStoreCookie")({
  name: CookieName,
  value: CookieValue,
  domain: CookieDomain,
  path: CookiePath,
  secure: Schema.optionalKey(Schema.Boolean),
  httpOnly: Schema.optionalKey(Schema.Boolean),
  sameSite: Schema.optionalKey(CookieSameSite),
  expiresAt: Schema.optionalKey(Schema.Number.check(Schema.isFinite()))
}) {}

export class CookieStoreGetInput extends Schema.Class<CookieStoreGetInput>("CookieStoreGetInput")({
  profile: SessionProfileResource,
  url: CookieUrl,
  name: Schema.optionalKey(CookieName),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}
export type CookieStoreGetOptions = Schema.Schema.Type<typeof CookieStoreGetInput>

export class CookieStoreSetInput extends Schema.Class<CookieStoreSetInput>("CookieStoreSetInput")({
  profile: SessionProfileResource,
  url: CookieUrl,
  cookie: CookieStoreCookie,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}
export type CookieStoreSetOptions = Schema.Schema.Type<typeof CookieStoreSetInput>

export class CookieStoreRemoveInput extends Schema.Class<CookieStoreRemoveInput>(
  "CookieStoreRemoveInput"
)({
  profile: SessionProfileResource,
  url: CookieUrl,
  name: CookieName,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}
export type CookieStoreRemoveOptions = Schema.Schema.Type<typeof CookieStoreRemoveInput>

export class CookieStoreGetResult extends Schema.Class<CookieStoreGetResult>(
  "CookieStoreGetResult"
)({
  cookies: Schema.Array(CookieStoreCookie)
}) {}

export class CookieStoreSupportedResult extends Schema.Class<CookieStoreSupportedResult>(
  "CookieStoreSupportedResult"
)({
  supported: Schema.Boolean,
  reason: Schema.optionalKey(BridgeSafeString)
}) {}

const CookieStoreEventBase = {
  type: Schema.Literal("cookie-store-event"),
  timestamp: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)),
  profile: SessionProfileResource,
  url: CookieUrl
}

export class CookieStoreSetEvent extends Schema.Class<CookieStoreSetEvent>("CookieStoreSetEvent")({
  ...CookieStoreEventBase,
  phase: Schema.Literal("set"),
  cookie: CookieStoreCookie,
  name: Schema.optionalKey(Schema.Never),
  message: Schema.optionalKey(Schema.Never)
}) {}

export class CookieStoreRemovedEvent extends Schema.Class<CookieStoreRemovedEvent>(
  "CookieStoreRemovedEvent"
)({
  ...CookieStoreEventBase,
  phase: Schema.Literal("removed"),
  name: CookieName,
  cookie: Schema.optionalKey(Schema.Never),
  message: Schema.optionalKey(Schema.Never)
}) {}

export class CookieStoreFailedEvent extends Schema.Class<CookieStoreFailedEvent>(
  "CookieStoreFailedEvent"
)({
  ...CookieStoreEventBase,
  phase: Schema.Literal("failed"),
  message: BridgeSafeString,
  cookie: Schema.optionalKey(Schema.Never),
  name: Schema.optionalKey(Schema.Never)
}) {}

export const CookieStoreEvent = Schema.Union([
  CookieStoreSetEvent,
  CookieStoreRemovedEvent,
  CookieStoreFailedEvent
])
export type CookieStoreEvent = typeof CookieStoreEvent.Type
