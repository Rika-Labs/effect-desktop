import { Schema } from "effect"

export class SafeStorageKeyInput extends Schema.Class<SafeStorageKeyInput>("SafeStorageKeyInput")({
  key: Schema.String
}) {}

export class SafeStorageSetInput extends Schema.Class<SafeStorageSetInput>("SafeStorageSetInput")({
  key: Schema.String,
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
  keys: Schema.Array(Schema.String)
}) {}

export class SafeStorageAvailabilityResult extends Schema.Class<SafeStorageAvailabilityResult>(
  "SafeStorageAvailabilityResult"
)({
  available: Schema.Boolean
}) {}
