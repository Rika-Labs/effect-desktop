import { Schema } from "effect"

import { BridgeSafeNonEmptyString } from "./strings.js"

export const SafeStorageKey = BridgeSafeNonEmptyString

export class SafeStorageKeyInput extends Schema.Class<SafeStorageKeyInput>("SafeStorageKeyInput")({
  key: SafeStorageKey
}) {}

export class SafeStorageSetInput extends Schema.Class<SafeStorageSetInput>("SafeStorageSetInput")({
  key: SafeStorageKey,
  value: Schema.Uint8Array
}) {}

export class SafeStorageSecretPayload extends Schema.Class<SafeStorageSecretPayload>(
  "SafeStorageSecretPayload"
)({
  value: Schema.Uint8Array
}) {}

export class SafeStorageListResult extends Schema.Class<SafeStorageListResult>(
  "SafeStorageListResult"
)({
  keys: Schema.Array(SafeStorageKey)
}) {}

export class SafeStorageAvailabilityResult extends Schema.Class<SafeStorageAvailabilityResult>(
  "SafeStorageAvailabilityResult"
)({
  available: Schema.Boolean
}) {}
