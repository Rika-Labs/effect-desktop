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

const CookieStoreEventPhasePayload = Schema.makeFilter<{
  readonly phase: CookieEventPhase
  readonly cookie?: typeof CookieStoreCookie.Type | undefined
  readonly name?: string | undefined
  readonly message?: string | undefined
}>((value) => {
  switch (value.phase) {
    case "set":
      return (
        (value.cookie !== undefined && value.name === undefined && value.message === undefined) ||
        "set cookie store events require cookie only"
      )
    case "removed":
      return (
        (value.cookie === undefined && value.name !== undefined && value.message === undefined) ||
        "removed cookie store events require name only"
      )
    case "failed":
      return (
        (value.cookie === undefined && value.name === undefined && value.message !== undefined) ||
        "failed cookie store events require message only"
      )
  }
})

export class CookieStoreEvent extends Schema.Class<CookieStoreEvent>("CookieStoreEvent")(
  Schema.Struct({
    type: Schema.Literal("cookie-store-event"),
    timestamp: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)),
    phase: CookieEventPhase,
    profile: SessionProfileResource,
    url: CookieUrl,
    cookie: Schema.optionalKey(CookieStoreCookie),
    name: Schema.optionalKey(CookieName),
    message: Schema.optionalKey(BridgeSafeString)
  }).check(CookieStoreEventPhasePayload)
) {}
