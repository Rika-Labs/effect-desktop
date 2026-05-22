import { NormalizedCapability } from "@orika/core"
import { Schema } from "effect"

import { BridgeSafeNonEmptyString, BridgeSafeString, PrintableNonEmptyString } from "./strings.js"

export const DistributionParityEvidenceKind = Schema.Literals([
  "package-artifact",
  "plugin-registration",
  "template",
  "docs"
])
export type DistributionParityEvidenceKind = typeof DistributionParityEvidenceKind.Type

export const DistributionParityEventPhase = Schema.Literals(["verified", "failed"])
export type DistributionParityEventPhase = typeof DistributionParityEventPhase.Type

export const DistributionParityEventType = Schema.Literal("distribution-parity-event")
export type DistributionParityEventType = typeof DistributionParityEventType.Type

const DistributionParityTimestamp = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0)
)

export class DistributionParityEvidence extends Schema.Class<DistributionParityEvidence>(
  "DistributionParityEvidence"
)({
  kind: DistributionParityEvidenceKind,
  id: PrintableNonEmptyString,
  path: PrintableNonEmptyString,
  sha256: Schema.optionalKey(BridgeSafeNonEmptyString),
  capabilities: Schema.Array(NormalizedCapability)
}) {}

export class DistributionParityVerifyRequest extends Schema.Class<DistributionParityVerifyRequest>(
  "DistributionParityVerifyRequest"
)({
  packageId: PrintableNonEmptyString,
  version: BridgeSafeNonEmptyString,
  capabilities: Schema.Array(NormalizedCapability).check(Schema.isNonEmpty()),
  evidence: Schema.Array(DistributionParityEvidence).check(Schema.isNonEmpty()),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class DistributionParityVerifyResult extends Schema.Class<DistributionParityVerifyResult>(
  "DistributionParityVerifyResult"
)({
  packageId: PrintableNonEmptyString,
  version: BridgeSafeNonEmptyString,
  capabilityCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  evidenceCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
}) {}

export class DistributionParitySupportedResult extends Schema.Class<DistributionParitySupportedResult>(
  "DistributionParitySupportedResult"
)({
  supported: Schema.Boolean,
  reason: Schema.optionalKey(BridgeSafeString)
}) {}

const DistributionParityEventPhasePayload = Schema.makeFilter<{
  readonly phase: DistributionParityEventPhase
  readonly version?: string | undefined
  readonly reason?: string | undefined
}>((value) => {
  switch (value.phase) {
    case "verified":
      return (
        (value.version !== undefined && value.reason === undefined) ||
        "verified distribution parity events require version only"
      )
    case "failed":
      return (
        (value.version !== undefined && value.reason !== undefined) ||
        "failed distribution parity events require version and reason"
      )
  }
})

export class DistributionParityEvent extends Schema.Class<DistributionParityEvent>(
  "DistributionParityEvent"
)(
  Schema.Struct({
    type: DistributionParityEventType,
    timestamp: DistributionParityTimestamp,
    phase: DistributionParityEventPhase,
    packageId: PrintableNonEmptyString,
    version: Schema.optionalKey(BridgeSafeNonEmptyString),
    reason: Schema.optionalKey(BridgeSafeString)
  }).check(DistributionParityEventPhasePayload)
) {}
