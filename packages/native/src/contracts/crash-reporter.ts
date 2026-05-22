import { Schema } from "effect"
import { PrintableNonEmptyString } from "./strings.js"

const CrashReporterFlushCount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const CrashReporterReportId = PrintableNonEmptyString
const CrashReporterArtifactPath = PrintableNonEmptyString
export const CrashReporterTimestamp = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const CrashReporterSizeBytes = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const CrashReporterCategory = Schema.NonEmptyString.check(
  // eslint-disable-next-line no-control-regex
  Schema.isPattern(/^[^\x00-\x1F\x7F]+$/)
)

export class CrashReporterStartInput extends Schema.Class<CrashReporterStartInput>(
  "CrashReporterStartInput"
)({
  enabled: Schema.optionalKey(Schema.Boolean)
}) {}

export class CrashReporterBreadcrumbInput extends Schema.Class<CrashReporterBreadcrumbInput>(
  "CrashReporterBreadcrumbInput"
)({
  category: CrashReporterCategory,
  message: Schema.String,
  details: Schema.optionalKey(Schema.Unknown),
  timestamp: Schema.optionalKey(CrashReporterTimestamp)
}) {}

export class CrashReporterFlushResult extends Schema.Class<CrashReporterFlushResult>(
  "CrashReporterFlushResult"
)({
  flushed: CrashReporterFlushCount
}) {}

export class CrashReporterReport extends Schema.Class<CrashReporterReport>("CrashReporterReport")({
  reportId: CrashReporterReportId,
  artifactPath: CrashReporterArtifactPath,
  createdAt: CrashReporterTimestamp,
  sizeBytes: CrashReporterSizeBytes,
  uploaded: Schema.Boolean
}) {}

export class CrashReporterGetReportsResult extends Schema.Class<CrashReporterGetReportsResult>(
  "CrashReporterGetReportsResult"
)({
  reports: Schema.Array(CrashReporterReport)
}) {}
