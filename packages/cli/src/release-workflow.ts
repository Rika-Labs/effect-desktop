import { Context, Effect, Layer, Schema } from "effect"
import { Activity, Workflow, WorkflowEngine } from "effect/unstable/workflow"

import type { DesktopNotarizeReport, NotarizePipelineError } from "./notarization-pipeline.js"
import type { DesktopPackageReport, PackagePipelineError } from "./package-pipeline.js"
import type { DesktopSignReport, SignPipelineError } from "./signing-pipeline.js"
import type { DesktopPublishReport, PublishPipelineError } from "./update-manifest.js"

export class ReleaseConfig extends Schema.Class<ReleaseConfig>("ReleaseConfig")({
  configPath: Schema.String,
  platform: Schema.optionalKey(Schema.String),
  artifact: Schema.optionalKey(Schema.String),
  version: Schema.optionalKey(Schema.String)
}) {}

export class ReleaseError extends Schema.TaggedErrorClass<ReleaseError>()("ReleaseError", {
  phase: Schema.Literals(["package", "sign", "notarize", "publish"]),
  message: Schema.String,
  cause: Schema.Unknown
}) {}

export type ReleasePhase = "package" | "sign" | "notarize" | "publish"

const ReleasePhaseReport = Schema.Struct({
  phase: Schema.Literals(["package", "sign", "notarize", "publish"]),
  skipped: Schema.optionalKey(Schema.Boolean),
  appId: Schema.optionalKey(Schema.String),
  appVersion: Schema.optionalKey(Schema.String),
  target: Schema.optionalKey(Schema.String),
  outputPath: Schema.optionalKey(Schema.String),
  manifestPath: Schema.optionalKey(Schema.String),
  artifacts: Schema.Number
})
type ReleasePhaseReport = typeof ReleasePhaseReport.Type

export class DesktopReleaseReport extends Schema.Class<DesktopReleaseReport>(
  "DesktopReleaseReport"
)({
  appId: Schema.String,
  appVersion: Schema.String,
  target: Schema.String,
  manifestPath: Schema.String,
  phases: Schema.Array(ReleasePhaseReport)
}) {}

export interface ReleaseWorkflowApi {
  readonly package: (
    config: ReleaseConfig
  ) => Effect.Effect<DesktopPackageReport, PackagePipelineError, never>
  readonly sign: (
    config: ReleaseConfig
  ) => Effect.Effect<DesktopSignReport, SignPipelineError, never>
  readonly notarize: (
    config: ReleaseConfig
  ) => Effect.Effect<DesktopNotarizeReport, NotarizePipelineError, never>
  readonly publish: (
    config: ReleaseConfig
  ) => Effect.Effect<DesktopPublishReport, PublishPipelineError, never>
}

export class ReleaseWorkflowServices extends Context.Service<
  ReleaseWorkflowServices,
  ReleaseWorkflowApi
>()("@effect-desktop/cli/ReleaseWorkflowServices") {}

export const ReleaseWorkflow = Workflow.make({
  name: "DesktopRelease",
  payload: ReleaseConfig,
  success: DesktopReleaseReport,
  error: ReleaseError,
  idempotencyKey: (config) =>
    [
      "release",
      config.configPath,
      config.platform ?? "host",
      config.artifact ?? "all",
      config.version ?? "config"
    ].join(":")
})

export const ReleaseWorkflowLayer: Layer.Layer<
  never,
  never,
  WorkflowEngine.WorkflowEngine | ReleaseWorkflowServices
> = ReleaseWorkflow.toLayer((config) =>
  Effect.gen(function* () {
    const services = yield* ReleaseWorkflowServices
    const packageReport = yield* makeReleaseActivity({
      phase: "package",
      execute: services.package(config).pipe(
        Effect.map(
          (report): ReleasePhaseReport => ({
            phase: "package",
            appId: report.appId,
            appVersion: report.appVersion,
            target: report.target,
            outputPath: report.outputPath,
            artifacts: report.artifacts.length
          })
        )
      )
    })
    yield* validateRequestedVersion(config, packageReport.appVersion)

    const signReport = yield* makeReleaseActivity({
      phase: "sign",
      execute: services.sign(config).pipe(
        Effect.map(
          (report): ReleasePhaseReport => ({
            phase: "sign",
            target: report.target,
            outputPath: report.outputPath,
            artifacts: report.artifacts.length
          })
        )
      )
    })
    const shouldNotarize = packageReport.target?.startsWith("macos-") === true
    const notarizeReport = shouldNotarize
      ? yield* makeReleaseActivity({
          phase: "notarize",
          execute: services.notarize(config).pipe(
            Effect.map(
              (report): ReleasePhaseReport => ({
                phase: "notarize",
                target: report.target,
                outputPath: report.outputPath,
                artifacts: report.artifacts.length
              })
            )
          )
        })
      : ({
          phase: "notarize",
          skipped: true,
          artifacts: 0
        } satisfies ReleasePhaseReport)
    const publishReport = yield* makeReleaseActivity({
      phase: "publish",
      execute: services.publish(config).pipe(
        Effect.map((report): ReleasePhaseReport => {
          const target = report.artifacts.at(0)?.platform
          const base = {
            phase: "publish",
            appId: report.appId,
            appVersion: report.version,
            manifestPath: report.manifestPath,
            artifacts: report.artifacts.length
          } satisfies ReleasePhaseReport
          return target === undefined ? base : { ...base, target }
        })
      )
    })

    return new DesktopReleaseReport({
      appId: publishReport.appId ?? packageReport.appId ?? "",
      appVersion: publishReport.appVersion ?? packageReport.appVersion ?? "",
      target: packageReport.target ?? "",
      manifestPath: publishReport.manifestPath ?? "",
      phases: [packageReport, signReport, notarizeReport, publishReport]
    })
  })
)

export const runReleaseWorkflow = (
  config: ReleaseConfig,
  services: ReleaseWorkflowApi
): Effect.Effect<DesktopReleaseReport, ReleaseError, WorkflowEngine.WorkflowEngine> =>
  ReleaseWorkflow.execute(config).pipe(
    Effect.provide(ReleaseWorkflowLayer),
    Effect.provide(Layer.succeed(ReleaseWorkflowServices, services))
  )

const makeReleaseActivity = <E>(options: {
  readonly phase: ReleasePhase
  readonly execute: Effect.Effect<ReleasePhaseReport, E, never>
}) =>
  Activity.make({
    name: `Release/${options.phase}`,
    success: ReleasePhaseReport,
    error: ReleaseError,
    execute: options.execute.pipe(Effect.mapError((cause) => releaseError(options.phase, cause)))
  })

const validateRequestedVersion = (
  config: ReleaseConfig,
  actual: string | undefined
): Effect.Effect<void, ReleaseError, never> => {
  if (config.version === undefined || config.version === actual) {
    return Effect.void
  }
  return Effect.fail(
    new ReleaseError({
      phase: "package",
      message: [
        `release version ${config.version}`,
        `does not match packaged app version ${actual ?? "<missing>"}`
      ].join(" "),
      cause: { requested: config.version, actual }
    })
  )
}

const releaseError = (phase: ReleasePhase, cause: unknown): ReleaseError =>
  new ReleaseError({
    phase,
    message: cause instanceof Error ? cause.message : String(cause),
    cause
  })
