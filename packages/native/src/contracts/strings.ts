import { Schema } from "effect"

const NUL = String.fromCharCode(0)
const UNIT_SEPARATOR = String.fromCharCode(0x1f)
const DEL = String.fromCharCode(0x7f)

const NoNulPattern = new RegExp(`^[^${NUL}]*$`, "u")
const NoControlPattern = new RegExp(`^[^${NUL}-${UNIT_SEPARATOR}${DEL}]*$`, "u")

export const BridgeSafeString = Schema.String.check(Schema.isPattern(NoNulPattern))

export const BridgeSafeNonEmptyString = Schema.NonEmptyString.check(Schema.isPattern(NoNulPattern))

export const PrintableString = Schema.String.check(Schema.isPattern(NoControlPattern))

export const PrintableNonEmptyString = Schema.NonEmptyString.check(
  Schema.isPattern(NoControlPattern)
)
