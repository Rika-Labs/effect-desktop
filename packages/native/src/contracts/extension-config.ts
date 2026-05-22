import { Schema } from "effect"

import { BridgeSafeNonEmptyString, BridgeSafeString, PrintableNonEmptyString } from "./strings.js"

export const ExtensionConfigActorKind = Schema.Literals([
  "workspace",
  "extension",
  "tool",
  "process",
  "native",
  "app",
  "window"
])
export type ExtensionConfigActorKind = typeof ExtensionConfigActorKind.Type

export const ExtensionConfigValueType = Schema.Literals(["string", "number", "boolean", "json"])
export type ExtensionConfigValueType = typeof ExtensionConfigValueType.Type

export const ExtensionConfigEventPhase = Schema.Literals(["read", "written", "reset", "redacted"])
export type ExtensionConfigEventPhase = typeof ExtensionConfigEventPhase.Type

export const ExtensionConfigExportPolicy = Schema.Literals(["diagnostics", "private"])
export type ExtensionConfigExportPolicy = typeof ExtensionConfigExportPolicy.Type

export const ExtensionConfigEventType = Schema.Literal("extension-config-event")
export type ExtensionConfigEventType = typeof ExtensionConfigEventType.Type

const ExtensionConfigTimestamp = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0)
)

export class ExtensionConfigActor extends Schema.Class<ExtensionConfigActor>(
  "ExtensionConfigActor"
)({
  kind: ExtensionConfigActorKind,
  id: PrintableNonEmptyString
}) {}

export class ExtensionConfigField extends Schema.Class<ExtensionConfigField>(
  "ExtensionConfigField"
)({
  key: PrintableNonEmptyString,
  valueType: ExtensionConfigValueType,
  secret: Schema.Boolean,
  required: Schema.optionalKey(Schema.Boolean),
  defaultValue: Schema.optionalKey(Schema.Json),
  exportPolicy: Schema.optionalKey(ExtensionConfigExportPolicy)
}) {}

export class ExtensionConfigValueEntry extends Schema.Class<ExtensionConfigValueEntry>(
  "ExtensionConfigValueEntry"
)({
  key: PrintableNonEmptyString,
  value: Schema.Json
}) {}

export class ExtensionConfigSecretState extends Schema.Class<ExtensionConfigSecretState>(
  "ExtensionConfigSecretState"
)({
  key: PrintableNonEmptyString,
  present: Schema.Boolean
}) {}

export class ExtensionConfigReadRequest extends Schema.Class<ExtensionConfigReadRequest>(
  "ExtensionConfigReadRequest"
)({
  actor: ExtensionConfigActor,
  extensionId: PrintableNonEmptyString,
  fields: Schema.Array(ExtensionConfigField),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class ExtensionConfigReadInput extends Schema.Class<ExtensionConfigReadInput>(
  "ExtensionConfigReadInput"
)({
  actor: ExtensionConfigActor,
  extensionId: PrintableNonEmptyString,
  fields: Schema.Array(ExtensionConfigField),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class ExtensionConfigReadResult extends Schema.Class<ExtensionConfigReadResult>(
  "ExtensionConfigReadResult"
)({
  extensionId: PrintableNonEmptyString,
  values: Schema.Array(ExtensionConfigValueEntry),
  secrets: Schema.Array(ExtensionConfigSecretState),
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
}) {}

export class ExtensionConfigWriteInput extends Schema.Class<ExtensionConfigWriteInput>(
  "ExtensionConfigWriteInput"
)({
  actor: ExtensionConfigActor,
  extensionId: PrintableNonEmptyString,
  fields: Schema.Array(ExtensionConfigField),
  values: Schema.optionalKey(Schema.Array(ExtensionConfigValueEntry)),
  secretKeys: Schema.optionalKey(Schema.Array(PrintableNonEmptyString)),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class ExtensionConfigWriteResult extends Schema.Class<ExtensionConfigWriteResult>(
  "ExtensionConfigWriteResult"
)({
  extensionId: PrintableNonEmptyString,
  writtenKeys: Schema.Array(PrintableNonEmptyString),
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
}) {}

export class ExtensionConfigResetRequest extends Schema.Class<ExtensionConfigResetRequest>(
  "ExtensionConfigResetRequest"
)({
  actor: ExtensionConfigActor,
  extensionId: PrintableNonEmptyString,
  fields: Schema.Array(ExtensionConfigField),
  keys: Schema.optionalKey(Schema.Array(PrintableNonEmptyString)),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class ExtensionConfigResetInput extends Schema.Class<ExtensionConfigResetInput>(
  "ExtensionConfigResetInput"
)({
  actor: ExtensionConfigActor,
  extensionId: PrintableNonEmptyString,
  fields: Schema.Array(ExtensionConfigField),
  keys: Schema.optionalKey(Schema.Array(PrintableNonEmptyString)),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class ExtensionConfigResetResult extends Schema.Class<ExtensionConfigResetResult>(
  "ExtensionConfigResetResult"
)({
  extensionId: PrintableNonEmptyString,
  resetKeys: Schema.Array(PrintableNonEmptyString),
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
}) {}

export class ExtensionConfigRedactRequest extends Schema.Class<ExtensionConfigRedactRequest>(
  "ExtensionConfigRedactRequest"
)({
  actor: ExtensionConfigActor,
  extensionId: PrintableNonEmptyString,
  fields: Schema.Array(ExtensionConfigField),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class ExtensionConfigRedactInput extends Schema.Class<ExtensionConfigRedactInput>(
  "ExtensionConfigRedactInput"
)({
  actor: ExtensionConfigActor,
  extensionId: PrintableNonEmptyString,
  fields: Schema.Array(ExtensionConfigField),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class ExtensionConfigRedactionEvidence extends Schema.Class<ExtensionConfigRedactionEvidence>(
  "ExtensionConfigRedactionEvidence"
)({
  key: PrintableNonEmptyString,
  reason: Schema.Literals(["secret-field", "private-export"])
}) {}

export class ExtensionConfigRedactResult extends Schema.Class<ExtensionConfigRedactResult>(
  "ExtensionConfigRedactResult"
)({
  extensionId: PrintableNonEmptyString,
  values: Schema.Array(ExtensionConfigValueEntry),
  redactions: Schema.Array(ExtensionConfigRedactionEvidence)
}) {}

export class ExtensionConfigSupportedResult extends Schema.Class<ExtensionConfigSupportedResult>(
  "ExtensionConfigSupportedResult"
)({
  supported: Schema.Boolean,
  reason: Schema.optionalKey(BridgeSafeString)
}) {}

const ExtensionConfigEventForbidsReason = Schema.makeFilter<{
  readonly reason?: string | undefined
}>((value) => value.reason === undefined || "extension config events must not include reason")

export class ExtensionConfigEvent extends Schema.Class<ExtensionConfigEvent>(
  "ExtensionConfigEvent"
)(
  Schema.Struct({
    type: ExtensionConfigEventType,
    timestamp: ExtensionConfigTimestamp,
    extensionId: PrintableNonEmptyString,
    phase: ExtensionConfigEventPhase,
    keys: Schema.optionalKey(Schema.Array(PrintableNonEmptyString)),
    revision: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
    reason: Schema.optionalKey(BridgeSafeString)
  }).check(ExtensionConfigEventForbidsReason)
) {}
