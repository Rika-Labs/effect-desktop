import { Schema } from "effect"

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
  timestamp: Schema.optionalKey(Schema.Number)
}) {}

export class CrashReporterFlushResult extends Schema.Class<CrashReporterFlushResult>(
  "CrashReporterFlushResult"
)({
  flushed: Schema.Number
}) {}
