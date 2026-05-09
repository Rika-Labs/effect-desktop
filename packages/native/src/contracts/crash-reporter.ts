import { Schema } from "effect"

const CrashReporterFlushCount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export class CrashReporterStartInput extends Schema.Class<CrashReporterStartInput>(
  "CrashReporterStartInput"
)({
  enabled: Schema.optionalKey(Schema.Boolean)
}) {}

export class CrashReporterBreadcrumbInput extends Schema.Class<CrashReporterBreadcrumbInput>(
  "CrashReporterBreadcrumbInput"
)({
  category: Schema.String,
  message: Schema.String,
  details: Schema.optionalKey(Schema.Unknown),
  timestamp: Schema.optionalKey(Schema.Number)
}) {}

export class CrashReporterFlushResult extends Schema.Class<CrashReporterFlushResult>(
  "CrashReporterFlushResult"
)({
  flushed: CrashReporterFlushCount
}) {}
