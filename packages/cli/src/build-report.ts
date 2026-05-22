import { Effect, Schema } from "effect"

import { DesktopTargetId } from "./targets.js"

export const BuildReportRuntimeEngineJson = Schema.Literals(["bun", "node"])

export const BuildReportWebEngineJson = Schema.Literals(["system", "chrome"])

export const BuildReportProvidersJson = Schema.Struct({
  runtime: BuildReportRuntimeEngineJson,
  runtimePackaging: Schema.Literal("source"),
  webEngine: BuildReportWebEngineJson
})

export const DesktopProviderBudgetJson = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literal("runtime"),
  package: Schema.String,
  importPath: Schema.String,
  startupBudgetMs: Schema.Number,
  bundleBudgetKb: Schema.Number
})

export const ProviderBudgetCheckReportJson = Schema.Struct({
  metric: Schema.Literals(["runtime-payload-bytes", "runtime-boot-ms"]),
  budget: Schema.Number,
  actual: Schema.NullOr(Schema.Number),
  status: Schema.Literals(["pass", "fail", "unmeasured"])
})

export const ProviderMeasurementReportJson = Schema.Struct({
  provider: DesktopProviderBudgetJson,
  runtimePackaging: Schema.Literal("source"),
  webEngine: BuildReportWebEngineJson,
  target: DesktopTargetId,
  runtimePayloadBytes: Schema.Number,
  runtimeBuildMs: Schema.Number,
  startup: Schema.Struct({
    runtimeBootMs: Schema.NullOr(Schema.Number),
    firstWindowVisibleMs: Schema.NullOr(Schema.Number),
    bridgeReadyMs: Schema.NullOr(Schema.Number)
  }),
  checks: Schema.Array(ProviderBudgetCheckReportJson)
})

export const BuildStepReportJson = Schema.Struct({
  name: Schema.String,
  command: Schema.optionalKey(Schema.Array(Schema.String)),
  cwd: Schema.optionalKey(Schema.String),
  elapsedMs: Schema.Number,
  outputPath: Schema.String,
  provider: Schema.optionalKey(Schema.String),
  cacheKey: Schema.String,
  status: Schema.Literals(["rebuilt", "reused"]),
  reason: Schema.String
})

export const DesktopBuildReportJson = Schema.Struct({
  appId: Schema.String,
  appName: Schema.String,
  appVersion: Schema.String,
  target: DesktopTargetId,
  providers: BuildReportProvidersJson,
  providerBudgets: Schema.Array(DesktopProviderBudgetJson),
  providerMeasurements: Schema.Array(ProviderMeasurementReportJson),
  layoutPath: Schema.String,
  appManifestPath: Schema.String,
  bridgeManifestPath: Schema.String,
  steps: Schema.Array(BuildStepReportJson)
})

export const BuildProviderProvenanceJson = Schema.Struct({
  runtime: BuildReportRuntimeEngineJson,
  runtimePackaging: Schema.Literal("source"),
  webEngine: BuildReportWebEngineJson,
  providerBudgets: Schema.Array(DesktopProviderBudgetJson)
})

export type BuildProviderProvenance = Schema.Schema.Type<typeof BuildProviderProvenanceJson>
export type DesktopBuildReportJson = Schema.Schema.Type<typeof DesktopBuildReportJson>

export const encodeDesktopBuildReport = (
  report: unknown
): Effect.Effect<unknown, Schema.SchemaError, never> =>
  Schema.encodeUnknownEffect(DesktopBuildReportJson)(report)

export const decodeDesktopBuildReport = (
  value: unknown
): Effect.Effect<DesktopBuildReportJson, Schema.SchemaError, never> =>
  Schema.decodeUnknownEffect(DesktopBuildReportJson)(value)

export const buildProviderProvenanceFromReport = (
  report: DesktopBuildReportJson
): BuildProviderProvenance => ({
  runtime: report.providers.runtime,
  runtimePackaging: report.providers.runtimePackaging,
  webEngine: report.providers.webEngine,
  providerBudgets: report.providerBudgets
})

export const decodeBuildProviderProvenance = (
  value: unknown
): Effect.Effect<BuildProviderProvenance, Schema.SchemaError, never> =>
  decodeDesktopBuildReport(value).pipe(Effect.map(buildProviderProvenanceFromReport))
