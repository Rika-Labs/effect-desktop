import { Schema } from "effect"

import { BridgeSafeNonEmptyString, BridgeSafeString } from "./strings.js"

const DiagnosticsBundleCount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const DiagnosticsBundleBytes = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const DiagnosticsBundleTimestamp = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0)
)

export const DiagnosticsBundleSourceKind = Schema.Literals([
  "logs",
  "traces",
  "crash-reports",
  "host-state",
  "extension-health",
  "audit-events"
])
export type DiagnosticsBundleSourceKind = typeof DiagnosticsBundleSourceKind.Type

export const DiagnosticsBundleEventType = Schema.Literals([
  "collect-started",
  "source-redacted",
  "write-completed",
  "failed"
])
export type DiagnosticsBundleEventType = typeof DiagnosticsBundleEventType.Type

export const DiagnosticsBundleFailureReason = Schema.Literals([
  "denied",
  "unsupported",
  "invalid-input",
  "host-failed"
])
export type DiagnosticsBundleFailureReason = typeof DiagnosticsBundleFailureReason.Type

export class DiagnosticsBundleRedactionEvidence extends Schema.Class<DiagnosticsBundleRedactionEvidence>(
  "DiagnosticsBundleRedactionEvidence"
)({
  path: BridgeSafeNonEmptyString,
  action: Schema.Literal("redacted"),
  reason: Schema.Literals(["secret-pattern", "redacted-value"])
}) {}

export class DiagnosticsBundleRedactionPolicy extends Schema.Class<DiagnosticsBundleRedactionPolicy>(
  "DiagnosticsBundleRedactionPolicy"
)({
  id: BridgeSafeNonEmptyString,
  evidence: Schema.Array(DiagnosticsBundleRedactionEvidence)
}) {}

export class DiagnosticsBundleSourceSummary extends Schema.Class<DiagnosticsBundleSourceSummary>(
  "DiagnosticsBundleSourceSummary"
)({
  source: DiagnosticsBundleSourceKind,
  itemCount: DiagnosticsBundleCount,
  redactionPolicy: DiagnosticsBundleRedactionPolicy
}) {}

export class DiagnosticsBundleCollectInput extends Schema.Class<DiagnosticsBundleCollectInput>(
  "DiagnosticsBundleCollectInput"
)({
  bundleId: Schema.optionalKey(BridgeSafeNonEmptyString),
  sources: Schema.optionalKey(Schema.Array(DiagnosticsBundleSourceKind)),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class DiagnosticsBundleCollectResult extends Schema.Class<DiagnosticsBundleCollectResult>(
  "DiagnosticsBundleCollectResult"
)({
  bundleId: BridgeSafeNonEmptyString,
  collectedAt: DiagnosticsBundleTimestamp,
  sources: Schema.Array(DiagnosticsBundleSourceSummary),
  artifactCount: DiagnosticsBundleCount
}) {}

export class DiagnosticsBundleIdentity extends Schema.Class<DiagnosticsBundleIdentity>(
  "DiagnosticsBundleIdentity"
)({
  bundleId: BridgeSafeNonEmptyString
}) {}

export class DiagnosticsBundleRedactInput extends Schema.Class<DiagnosticsBundleRedactInput>(
  "DiagnosticsBundleRedactInput"
)({
  bundleId: BridgeSafeNonEmptyString,
  source: DiagnosticsBundleSourceKind,
  payload: Schema.Json
}) {}

export class DiagnosticsBundleRedactResult extends Schema.Class<DiagnosticsBundleRedactResult>(
  "DiagnosticsBundleRedactResult"
)({
  bundleId: BridgeSafeNonEmptyString,
  source: DiagnosticsBundleSourceKind,
  payload: Schema.Json,
  redactionPolicy: DiagnosticsBundleRedactionPolicy
}) {}

export class DiagnosticsBundleWriteInput extends Schema.Class<DiagnosticsBundleWriteInput>(
  "DiagnosticsBundleWriteInput"
)({
  bundleId: BridgeSafeNonEmptyString,
  destinationPath: BridgeSafeNonEmptyString,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class DiagnosticsBundleWriteResult extends Schema.Class<DiagnosticsBundleWriteResult>(
  "DiagnosticsBundleWriteResult"
)({
  bundleId: BridgeSafeNonEmptyString,
  destinationPath: BridgeSafeNonEmptyString,
  bytesWritten: DiagnosticsBundleBytes,
  sources: Schema.Array(DiagnosticsBundleSourceSummary)
}) {}

export class DiagnosticsBundleSupportedResult extends Schema.Class<DiagnosticsBundleSupportedResult>(
  "DiagnosticsBundleSupportedResult"
)({
  supported: Schema.Boolean,
  reason: Schema.optionalKey(BridgeSafeString)
}) {}

export class DiagnosticsBundleCollectStartedEvent extends Schema.Class<DiagnosticsBundleCollectStartedEvent>(
  "DiagnosticsBundleCollectStartedEvent"
)({
  type: Schema.Literal("collect-started"),
  bundleId: BridgeSafeNonEmptyString,
  timestamp: DiagnosticsBundleTimestamp,
  sources: Schema.Array(DiagnosticsBundleSourceKind)
}) {}

export class DiagnosticsBundleSourceRedactedEvent extends Schema.Class<DiagnosticsBundleSourceRedactedEvent>(
  "DiagnosticsBundleSourceRedactedEvent"
)({
  type: Schema.Literal("source-redacted"),
  bundleId: BridgeSafeNonEmptyString,
  timestamp: DiagnosticsBundleTimestamp,
  source: DiagnosticsBundleSourceKind,
  redactionPolicy: DiagnosticsBundleRedactionPolicy
}) {}

export class DiagnosticsBundleWriteCompletedEvent extends Schema.Class<DiagnosticsBundleWriteCompletedEvent>(
  "DiagnosticsBundleWriteCompletedEvent"
)({
  type: Schema.Literal("write-completed"),
  bundleId: BridgeSafeNonEmptyString,
  timestamp: DiagnosticsBundleTimestamp,
  destinationPath: BridgeSafeNonEmptyString,
  bytesWritten: DiagnosticsBundleBytes
}) {}

export class DiagnosticsBundleFailedEvent extends Schema.Class<DiagnosticsBundleFailedEvent>(
  "DiagnosticsBundleFailedEvent"
)({
  type: Schema.Literal("failed"),
  bundleId: Schema.optionalKey(BridgeSafeNonEmptyString),
  timestamp: DiagnosticsBundleTimestamp,
  reason: DiagnosticsBundleFailureReason,
  message: BridgeSafeNonEmptyString
}) {}

export const DiagnosticsBundleEvent = Schema.Union([
  DiagnosticsBundleCollectStartedEvent,
  DiagnosticsBundleSourceRedactedEvent,
  DiagnosticsBundleWriteCompletedEvent,
  DiagnosticsBundleFailedEvent
])
export type DiagnosticsBundleEvent = typeof DiagnosticsBundleEvent.Type
