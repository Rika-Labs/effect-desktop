import { NormalizedCapability } from "@orika/core"
import { Schema } from "effect"

import { NativeBridgePath } from "./path.js"
import { BridgeSafeNonEmptyString, BridgeSafeString, PrintableNonEmptyString } from "./strings.js"

export const LocalToolRuntimeActorKind = Schema.Literals([
  "workspace",
  "extension",
  "tool",
  "process",
  "native",
  "app",
  "window"
])
export type LocalToolRuntimeActorKind = typeof LocalToolRuntimeActorKind.Type

export const LocalToolRuntimeRunStatus = Schema.Literals(["completed", "failed", "timeout"])
export type LocalToolRuntimeRunStatus = typeof LocalToolRuntimeRunStatus.Type

export const LocalToolRuntimeHealthStatus = Schema.Literals(["unknown", "healthy", "unhealthy"])
export type LocalToolRuntimeHealthStatus = typeof LocalToolRuntimeHealthStatus.Type

export const LocalToolRuntimeEventPhase = Schema.Literals([
  "registered",
  "run-started",
  "run-completed",
  "health-checked",
  "stopped"
])
export type LocalToolRuntimeEventPhase = typeof LocalToolRuntimeEventPhase.Type

export const LocalToolRuntimeEventType = Schema.Literal("local-tool-runtime-event")
export type LocalToolRuntimeEventType = typeof LocalToolRuntimeEventType.Type

const LocalToolRuntimeEventPhasePayload = Schema.makeFilter<{
  readonly phase: LocalToolRuntimeEventPhase
  readonly runId?: string | undefined
  readonly status?: LocalToolRuntimeRunStatus | undefined
  readonly health?: LocalToolRuntimeHealthStatus | undefined
}>((value) => {
  if (value.phase === "run-started") {
    if (value.runId === undefined) {
      return "run-started events require runId"
    }
    if (value.status !== undefined) {
      return "run-started events must not carry status"
    }
    return value.health === undefined || "run-started events must not carry health"
  }
  if (value.phase === "run-completed") {
    if (value.runId === undefined) {
      return "run-completed events require runId"
    }
    if (value.status === undefined) {
      return "run-completed events require status"
    }
    return value.health === undefined || "run-completed events must not carry health"
  }
  if (value.phase === "health-checked") {
    if (value.health === undefined) {
      return "health-checked events require health"
    }
    if (value.runId !== undefined) {
      return "health-checked events must not carry runId"
    }
    return value.status === undefined || "health-checked events must not carry status"
  }
  if (value.runId !== undefined) {
    return `${value.phase} events must not carry runId`
  }
  if (value.status !== undefined) {
    return `${value.phase} events must not carry status`
  }
  return value.health === undefined || `${value.phase} events must not carry health`
})

export const LocalToolRuntimeStdioMode = Schema.Literals(["capture", "inherit", "ignore"])
export type LocalToolRuntimeStdioMode = typeof LocalToolRuntimeStdioMode.Type

const LocalToolRuntimePositiveInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
const LocalToolRuntimeTimestamp = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0)
)

export class LocalToolRuntimeActor extends Schema.Class<LocalToolRuntimeActor>(
  "LocalToolRuntimeActor"
)({
  kind: LocalToolRuntimeActorKind,
  id: PrintableNonEmptyString
}) {}

export class LocalToolRuntimeEnvironmentEntry extends Schema.Class<LocalToolRuntimeEnvironmentEntry>(
  "LocalToolRuntimeEnvironmentEntry"
)({
  name: PrintableNonEmptyString,
  value: BridgeSafeString
}) {}

export class LocalToolRuntimeCwdPolicy extends Schema.Class<LocalToolRuntimeCwdPolicy>(
  "LocalToolRuntimeCwdPolicy"
)({
  roots: Schema.Array(NativeBridgePath)
}) {}

export class LocalToolRuntimeEnvironmentPolicy extends Schema.Class<LocalToolRuntimeEnvironmentPolicy>(
  "LocalToolRuntimeEnvironmentPolicy"
)({
  variables: Schema.Array(LocalToolRuntimeEnvironmentEntry)
}) {}

export class LocalToolRuntimeFilesystemPolicy extends Schema.Class<LocalToolRuntimeFilesystemPolicy>(
  "LocalToolRuntimeFilesystemPolicy"
)({
  readRoots: Schema.optionalKey(Schema.Array(NativeBridgePath)),
  writeRoots: Schema.optionalKey(Schema.Array(NativeBridgePath))
}) {}

export class LocalToolRuntimeNetworkPolicy extends Schema.Class<LocalToolRuntimeNetworkPolicy>(
  "LocalToolRuntimeNetworkPolicy"
)({
  hosts: Schema.optionalKey(Schema.Array(PrintableNonEmptyString))
}) {}

export class LocalToolRuntimeBudgetPolicy extends Schema.Class<LocalToolRuntimeBudgetPolicy>(
  "LocalToolRuntimeBudgetPolicy"
)({
  cpuMillis: LocalToolRuntimePositiveInt,
  memoryBytes: LocalToolRuntimePositiveInt,
  wallClockMillis: LocalToolRuntimePositiveInt,
  stdoutBytes: LocalToolRuntimePositiveInt,
  stderrBytes: LocalToolRuntimePositiveInt
}) {}

export class LocalToolRuntimeStdioPolicy extends Schema.Class<LocalToolRuntimeStdioPolicy>(
  "LocalToolRuntimeStdioPolicy"
)({
  stdout: LocalToolRuntimeStdioMode,
  stderr: LocalToolRuntimeStdioMode
}) {}

export class LocalToolRuntimeCleanupPolicy extends Schema.Class<LocalToolRuntimeCleanupPolicy>(
  "LocalToolRuntimeCleanupPolicy"
)({
  killProcessTree: Schema.Boolean,
  removeWorkingDirectory: Schema.Boolean
}) {}

export class LocalToolRuntimePolicy extends Schema.Class<LocalToolRuntimePolicy>(
  "LocalToolRuntimePolicy"
)({
  cwd: LocalToolRuntimeCwdPolicy,
  environment: LocalToolRuntimeEnvironmentPolicy,
  filesystem: LocalToolRuntimeFilesystemPolicy,
  network: LocalToolRuntimeNetworkPolicy,
  budgets: LocalToolRuntimeBudgetPolicy,
  stdio: LocalToolRuntimeStdioPolicy,
  cleanup: LocalToolRuntimeCleanupPolicy
}) {}

export class LocalToolRuntimeCommand extends Schema.Class<LocalToolRuntimeCommand>(
  "LocalToolRuntimeCommand"
)({
  commandId: PrintableNonEmptyString,
  executable: PrintableNonEmptyString,
  defaultArgs: Schema.optionalKey(Schema.Array(BridgeSafeString)),
  cwd: Schema.optionalKey(NativeBridgePath),
  environment: Schema.optionalKey(Schema.Array(LocalToolRuntimeEnvironmentEntry)),
  timeoutMillis: Schema.optionalKey(LocalToolRuntimePositiveInt)
}) {}

export class LocalToolRuntimeHealthCheck extends Schema.Class<LocalToolRuntimeHealthCheck>(
  "LocalToolRuntimeHealthCheck"
)({
  commandId: PrintableNonEmptyString,
  intervalMillis: LocalToolRuntimePositiveInt,
  timeoutMillis: LocalToolRuntimePositiveInt
}) {}

export class LocalToolRuntimeManifest extends Schema.Class<LocalToolRuntimeManifest>(
  "LocalToolRuntimeManifest"
)({
  toolId: PrintableNonEmptyString,
  name: PrintableNonEmptyString,
  version: BridgeSafeNonEmptyString,
  commands: Schema.Array(LocalToolRuntimeCommand),
  permissions: Schema.Array(NormalizedCapability),
  policy: LocalToolRuntimePolicy,
  health: Schema.optionalKey(LocalToolRuntimeHealthCheck)
}) {}

export class LocalToolRuntimeRegisterRequest extends Schema.Class<LocalToolRuntimeRegisterRequest>(
  "LocalToolRuntimeRegisterRequest"
)({
  actor: LocalToolRuntimeActor,
  manifest: LocalToolRuntimeManifest,
  runtimeId: Schema.optionalKey(BridgeSafeNonEmptyString),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class LocalToolRuntimeRegisterInput extends Schema.Class<LocalToolRuntimeRegisterInput>(
  "LocalToolRuntimeRegisterInput"
)({
  actor: LocalToolRuntimeActor,
  manifest: LocalToolRuntimeManifest,
  runtimeId: Schema.optionalKey(BridgeSafeNonEmptyString),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class LocalToolRuntimeRegisterResult extends Schema.Class<LocalToolRuntimeRegisterResult>(
  "LocalToolRuntimeRegisterResult"
)({
  runtimeId: BridgeSafeNonEmptyString,
  toolId: PrintableNonEmptyString,
  manifest: LocalToolRuntimeManifest,
  state: Schema.Literal("registered")
}) {}

export class LocalToolRuntimeRunRequest extends Schema.Class<LocalToolRuntimeRunRequest>(
  "LocalToolRuntimeRunRequest"
)({
  runtimeId: BridgeSafeNonEmptyString,
  commandId: PrintableNonEmptyString,
  args: Schema.optionalKey(Schema.Array(BridgeSafeString)),
  runId: Schema.optionalKey(BridgeSafeNonEmptyString),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class LocalToolRuntimeRunInput extends Schema.Class<LocalToolRuntimeRunInput>(
  "LocalToolRuntimeRunInput"
)({
  runtimeId: BridgeSafeNonEmptyString,
  commandId: PrintableNonEmptyString,
  args: Schema.optionalKey(Schema.Array(BridgeSafeString)),
  runId: Schema.optionalKey(BridgeSafeNonEmptyString),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class LocalToolRuntimeRunResult extends Schema.Class<LocalToolRuntimeRunResult>(
  "LocalToolRuntimeRunResult"
)({
  runtimeId: BridgeSafeNonEmptyString,
  commandId: PrintableNonEmptyString,
  runId: BridgeSafeNonEmptyString,
  status: LocalToolRuntimeRunStatus,
  exitCode: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  stdout: BridgeSafeString,
  stderr: BridgeSafeString
}) {}

export class LocalToolRuntimeStopRequest extends Schema.Class<LocalToolRuntimeStopRequest>(
  "LocalToolRuntimeStopRequest"
)({
  runtimeId: BridgeSafeNonEmptyString,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class LocalToolRuntimeStopInput extends Schema.Class<LocalToolRuntimeStopInput>(
  "LocalToolRuntimeStopInput"
)({
  runtimeId: BridgeSafeNonEmptyString,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class LocalToolRuntimeStopResult extends Schema.Class<LocalToolRuntimeStopResult>(
  "LocalToolRuntimeStopResult"
)({
  runtimeId: BridgeSafeNonEmptyString,
  stopped: Schema.Boolean
}) {}

export class LocalToolRuntimeHealthRequest extends Schema.Class<LocalToolRuntimeHealthRequest>(
  "LocalToolRuntimeHealthRequest"
)({
  runtimeId: BridgeSafeNonEmptyString,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class LocalToolRuntimeHealthInput extends Schema.Class<LocalToolRuntimeHealthInput>(
  "LocalToolRuntimeHealthInput"
)({
  runtimeId: BridgeSafeNonEmptyString,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class LocalToolRuntimeHealthResult extends Schema.Class<LocalToolRuntimeHealthResult>(
  "LocalToolRuntimeHealthResult"
)({
  runtimeId: BridgeSafeNonEmptyString,
  status: LocalToolRuntimeHealthStatus,
  checkedAt: LocalToolRuntimeTimestamp,
  reason: Schema.optionalKey(BridgeSafeString)
}) {}

export class LocalToolRuntimeSupportedResult extends Schema.Class<LocalToolRuntimeSupportedResult>(
  "LocalToolRuntimeSupportedResult"
)({
  supported: Schema.Boolean,
  reason: Schema.optionalKey(BridgeSafeString)
}) {}

export class LocalToolRuntimeEvent extends Schema.Class<LocalToolRuntimeEvent>(
  "LocalToolRuntimeEvent"
)(
  Schema.Struct({
    type: LocalToolRuntimeEventType,
    timestamp: LocalToolRuntimeTimestamp,
    runtimeId: BridgeSafeNonEmptyString,
    toolId: Schema.optionalKey(PrintableNonEmptyString),
    commandId: Schema.optionalKey(PrintableNonEmptyString),
    runId: Schema.optionalKey(BridgeSafeNonEmptyString),
    phase: LocalToolRuntimeEventPhase,
    status: Schema.optionalKey(LocalToolRuntimeRunStatus),
    health: Schema.optionalKey(LocalToolRuntimeHealthStatus),
    reason: Schema.optionalKey(BridgeSafeString)
  }).check(LocalToolRuntimeEventPhasePayload)
) {}
