import { NormalizedCapability } from "@orika/core"
import { Schema } from "effect"

import { BridgeSafeNonEmptyString, BridgeSafeString, PrintableNonEmptyString } from "./strings.js"

export const ExtensionPackageActorKind = Schema.Literals([
  "workspace",
  "extension",
  "tool",
  "process",
  "native",
  "app",
  "window"
])
export type ExtensionPackageActorKind = typeof ExtensionPackageActorKind.Type

export const ExtensionPackageSourceKind = Schema.Literals(["directory", "archive", "registry"])
export type ExtensionPackageSourceKind = typeof ExtensionPackageSourceKind.Type

export const ExtensionPackageEventPhase = Schema.Literals([
  "installing",
  "installed",
  "updating",
  "updated",
  "removing",
  "removed",
  "failed"
])
export type ExtensionPackageEventPhase = typeof ExtensionPackageEventPhase.Type

export const ExtensionPackageEventType = Schema.Literal("extension-package-event")
export type ExtensionPackageEventType = typeof ExtensionPackageEventType.Type

const ExtensionPackageTimestamp = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0)
)

export class ExtensionPackageActor extends Schema.Class<ExtensionPackageActor>(
  "ExtensionPackageActor"
)({
  kind: ExtensionPackageActorKind,
  id: PrintableNonEmptyString
}) {}

export class ExtensionPackageSource extends Schema.Class<ExtensionPackageSource>(
  "ExtensionPackageSource"
)({
  kind: ExtensionPackageSourceKind,
  uri: PrintableNonEmptyString,
  digest: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class ExtensionPackageCompatibility extends Schema.Class<ExtensionPackageCompatibility>(
  "ExtensionPackageCompatibility"
)({
  minHostVersion: Schema.optionalKey(BridgeSafeNonEmptyString),
  maxHostVersion: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class ExtensionPackageCapabilityDeclaration extends Schema.Class<ExtensionPackageCapabilityDeclaration>(
  "ExtensionPackageCapabilityDeclaration"
)({
  capability: NormalizedCapability,
  reason: Schema.optionalKey(PrintableNonEmptyString)
}) {}

export class ExtensionPackageManifest extends Schema.Class<ExtensionPackageManifest>(
  "ExtensionPackageManifest"
)({
  id: PrintableNonEmptyString,
  name: PrintableNonEmptyString,
  version: BridgeSafeNonEmptyString,
  entrypoint: PrintableNonEmptyString,
  compatibility: ExtensionPackageCompatibility,
  capabilities: Schema.Array(ExtensionPackageCapabilityDeclaration)
}) {}

export class ExtensionPackageInstallRequest extends Schema.Class<ExtensionPackageInstallRequest>(
  "ExtensionPackageInstallRequest"
)({
  actor: ExtensionPackageActor,
  source: ExtensionPackageSource,
  manifest: ExtensionPackageManifest,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class ExtensionPackageInstallInput extends Schema.Class<ExtensionPackageInstallInput>(
  "ExtensionPackageInstallInput"
)({
  actor: ExtensionPackageActor,
  source: ExtensionPackageSource,
  manifest: ExtensionPackageManifest,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class ExtensionPackageUpdateRequest extends Schema.Class<ExtensionPackageUpdateRequest>(
  "ExtensionPackageUpdateRequest"
)({
  actor: ExtensionPackageActor,
  source: ExtensionPackageSource,
  manifest: ExtensionPackageManifest,
  expectedVersion: Schema.optionalKey(BridgeSafeNonEmptyString),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class ExtensionPackageUpdateInput extends Schema.Class<ExtensionPackageUpdateInput>(
  "ExtensionPackageUpdateInput"
)({
  actor: ExtensionPackageActor,
  source: ExtensionPackageSource,
  manifest: ExtensionPackageManifest,
  expectedVersion: Schema.optionalKey(BridgeSafeNonEmptyString),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class ExtensionPackageRemoveRequest extends Schema.Class<ExtensionPackageRemoveRequest>(
  "ExtensionPackageRemoveRequest"
)({
  actor: ExtensionPackageActor,
  packageId: PrintableNonEmptyString,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class ExtensionPackageRemoveInput extends Schema.Class<ExtensionPackageRemoveInput>(
  "ExtensionPackageRemoveInput"
)({
  actor: ExtensionPackageActor,
  packageId: PrintableNonEmptyString,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class ExtensionPackageState extends Schema.Class<ExtensionPackageState>(
  "ExtensionPackageState"
)({
  packageId: PrintableNonEmptyString,
  manifest: ExtensionPackageManifest,
  source: ExtensionPackageSource,
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
}) {}

export class ExtensionPackageInstallResult extends Schema.Class<ExtensionPackageInstallResult>(
  "ExtensionPackageInstallResult"
)({
  packageId: PrintableNonEmptyString,
  version: BridgeSafeNonEmptyString,
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  registeredCapabilities: Schema.Array(NormalizedCapability)
}) {}

export class ExtensionPackageUpdateResult extends Schema.Class<ExtensionPackageUpdateResult>(
  "ExtensionPackageUpdateResult"
)({
  packageId: PrintableNonEmptyString,
  previousVersion: Schema.optionalKey(BridgeSafeNonEmptyString),
  version: BridgeSafeNonEmptyString,
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  registeredCapabilities: Schema.Array(NormalizedCapability)
}) {}

export class ExtensionPackageRemoveResult extends Schema.Class<ExtensionPackageRemoveResult>(
  "ExtensionPackageRemoveResult"
)({
  packageId: PrintableNonEmptyString,
  removed: Schema.Boolean,
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
}) {}

export class ExtensionPackageListResult extends Schema.Class<ExtensionPackageListResult>(
  "ExtensionPackageListResult"
)({
  packages: Schema.Array(ExtensionPackageState)
}) {}

export class ExtensionPackageSupportedResult extends Schema.Class<ExtensionPackageSupportedResult>(
  "ExtensionPackageSupportedResult"
)({
  supported: Schema.Boolean,
  reason: Schema.optionalKey(BridgeSafeString)
}) {}

const ExtensionPackageEventPhasePayload = Schema.makeFilter<{
  readonly phase: ExtensionPackageEventPhase
  readonly reason?: string | undefined
}>((value) => {
  switch (value.phase) {
    case "failed":
      return value.reason !== undefined || "failed extension package events require reason"
    case "installing":
    case "installed":
    case "updating":
    case "updated":
    case "removing":
    case "removed":
      return (
        value.reason === undefined ||
        "successful extension package events must not include failure reason"
      )
  }
})

export class ExtensionPackageEvent extends Schema.Class<ExtensionPackageEvent>(
  "ExtensionPackageEvent"
)(
  Schema.Struct({
    type: ExtensionPackageEventType,
    timestamp: ExtensionPackageTimestamp,
    packageId: PrintableNonEmptyString,
    phase: ExtensionPackageEventPhase,
    version: Schema.optionalKey(BridgeSafeNonEmptyString),
    revision: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
    reason: Schema.optionalKey(BridgeSafeString)
  }).check(ExtensionPackageEventPhasePayload)
) {}
