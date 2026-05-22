import { Schema } from "effect"

import { NativeBridgePath } from "./path.js"
import { BridgeSafeNonEmptyString, BridgeSafeString, PrintableNonEmptyString } from "./strings.js"

export const ExecutionSandboxActorKind = Schema.Literals([
  "workspace",
  "extension",
  "tool",
  "process",
  "native",
  "app",
  "window"
])
export type ExecutionSandboxActorKind = typeof ExecutionSandboxActorKind.Type

export const ExecutionSandboxRunStatus = Schema.Literals(["completed", "failed", "timeout"])
export type ExecutionSandboxRunStatus = typeof ExecutionSandboxRunStatus.Type

export const ExecutionSandboxEventPhase = Schema.Literals([
  "created",
  "run-started",
  "run-completed",
  "destroyed"
])
export type ExecutionSandboxEventPhase = typeof ExecutionSandboxEventPhase.Type

export const ExecutionSandboxEventType = Schema.Literal("sandbox-event")
export type ExecutionSandboxEventType = typeof ExecutionSandboxEventType.Type

const ExecutionSandboxEventPhasePayload = Schema.makeFilter<{
  readonly phase: ExecutionSandboxEventPhase
  readonly runId?: string | undefined
  readonly status?: ExecutionSandboxRunStatus | undefined
}>((value) => {
  if (value.phase === "run-started") {
    if (value.runId === undefined) {
      return "run-started events require runId"
    }
    return value.status === undefined || "run-started events must not carry status"
  }
  if (value.phase === "run-completed") {
    if (value.runId === undefined) {
      return "run-completed events require runId"
    }
    return value.status !== undefined || "run-completed events require status"
  }
  if (value.runId !== undefined) {
    return `${value.phase} events must not carry runId`
  }
  return value.status === undefined || `${value.phase} events must not carry status`
})

const ExecutionSandboxPositiveInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
const ExecutionSandboxTimestamp = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0)
)
const ExecutionSandboxPolicyPath = NativeBridgePath
const ExecutionSandboxPathList = Schema.Array(ExecutionSandboxPolicyPath)
const ExecutionSandboxHostList = Schema.Array(PrintableNonEmptyString)

export class ExecutionSandboxActor extends Schema.Class<ExecutionSandboxActor>(
  "ExecutionSandboxActor"
)({
  kind: ExecutionSandboxActorKind,
  id: PrintableNonEmptyString
}) {}

export class ExecutionSandboxEnvironmentEntry extends Schema.Class<ExecutionSandboxEnvironmentEntry>(
  "ExecutionSandboxEnvironmentEntry"
)({
  name: PrintableNonEmptyString,
  value: BridgeSafeString
}) {}

export class ExecutionSandboxFilesystemPolicy extends Schema.Class<ExecutionSandboxFilesystemPolicy>(
  "ExecutionSandboxFilesystemPolicy"
)({
  readRoots: Schema.optionalKey(ExecutionSandboxPathList),
  writeRoots: Schema.optionalKey(ExecutionSandboxPathList)
}) {}

export class ExecutionSandboxNetworkPolicy extends Schema.Class<ExecutionSandboxNetworkPolicy>(
  "ExecutionSandboxNetworkPolicy"
)({
  hosts: Schema.optionalKey(ExecutionSandboxHostList)
}) {}

export class ExecutionSandboxBudgetPolicy extends Schema.Class<ExecutionSandboxBudgetPolicy>(
  "ExecutionSandboxBudgetPolicy"
)({
  cpuMillis: ExecutionSandboxPositiveInt,
  memoryBytes: ExecutionSandboxPositiveInt,
  wallClockMillis: ExecutionSandboxPositiveInt,
  stdoutBytes: ExecutionSandboxPositiveInt,
  stderrBytes: ExecutionSandboxPositiveInt
}) {}

export class ExecutionSandboxCleanupPolicy extends Schema.Class<ExecutionSandboxCleanupPolicy>(
  "ExecutionSandboxCleanupPolicy"
)({
  killProcessTree: Schema.Boolean,
  removeWorkingDirectory: Schema.Boolean
}) {}

export class ExecutionSandboxPolicy extends Schema.Class<ExecutionSandboxPolicy>(
  "ExecutionSandboxPolicy"
)({
  cwd: ExecutionSandboxPolicyPath,
  environment: Schema.optionalKey(Schema.Array(ExecutionSandboxEnvironmentEntry)),
  filesystem: Schema.optionalKey(ExecutionSandboxFilesystemPolicy),
  network: Schema.optionalKey(ExecutionSandboxNetworkPolicy),
  budgets: ExecutionSandboxBudgetPolicy,
  cleanup: ExecutionSandboxCleanupPolicy
}) {}

export class ExecutionSandboxCreateRequest extends Schema.Class<ExecutionSandboxCreateRequest>(
  "ExecutionSandboxCreateRequest"
)({
  actor: ExecutionSandboxActor,
  policy: ExecutionSandboxPolicy,
  sandboxId: Schema.optionalKey(BridgeSafeNonEmptyString),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class ExecutionSandboxCreateInput extends Schema.Class<ExecutionSandboxCreateInput>(
  "ExecutionSandboxCreateInput"
)({
  actor: ExecutionSandboxActor,
  policy: ExecutionSandboxPolicy,
  sandboxId: Schema.optionalKey(BridgeSafeNonEmptyString),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class ExecutionSandboxCreateResult extends Schema.Class<ExecutionSandboxCreateResult>(
  "ExecutionSandboxCreateResult"
)({
  sandboxId: BridgeSafeNonEmptyString,
  policy: ExecutionSandboxPolicy,
  state: Schema.Literal("created")
}) {}

export class ExecutionSandboxRunRequest extends Schema.Class<ExecutionSandboxRunRequest>(
  "ExecutionSandboxRunRequest"
)({
  sandboxId: BridgeSafeNonEmptyString,
  command: PrintableNonEmptyString,
  args: Schema.optionalKey(Schema.Array(BridgeSafeString)),
  runId: Schema.optionalKey(BridgeSafeNonEmptyString),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class ExecutionSandboxRunInput extends Schema.Class<ExecutionSandboxRunInput>(
  "ExecutionSandboxRunInput"
)({
  sandboxId: BridgeSafeNonEmptyString,
  command: PrintableNonEmptyString,
  args: Schema.optionalKey(Schema.Array(BridgeSafeString)),
  runId: Schema.optionalKey(BridgeSafeNonEmptyString),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class ExecutionSandboxRunResult extends Schema.Class<ExecutionSandboxRunResult>(
  "ExecutionSandboxRunResult"
)({
  sandboxId: BridgeSafeNonEmptyString,
  runId: BridgeSafeNonEmptyString,
  status: ExecutionSandboxRunStatus,
  exitCode: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  stdout: BridgeSafeString,
  stderr: BridgeSafeString
}) {}

export class ExecutionSandboxDestroyRequest extends Schema.Class<ExecutionSandboxDestroyRequest>(
  "ExecutionSandboxDestroyRequest"
)({
  sandboxId: BridgeSafeNonEmptyString,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class ExecutionSandboxDestroyInput extends Schema.Class<ExecutionSandboxDestroyInput>(
  "ExecutionSandboxDestroyInput"
)({
  sandboxId: BridgeSafeNonEmptyString,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class ExecutionSandboxDestroyResult extends Schema.Class<ExecutionSandboxDestroyResult>(
  "ExecutionSandboxDestroyResult"
)({
  sandboxId: BridgeSafeNonEmptyString,
  destroyed: Schema.Boolean
}) {}

export class ExecutionSandboxSupportedResult extends Schema.Class<ExecutionSandboxSupportedResult>(
  "ExecutionSandboxSupportedResult"
)({
  supported: Schema.Boolean,
  reason: Schema.optionalKey(BridgeSafeString)
}) {}

export class ExecutionSandboxEvent extends Schema.Class<ExecutionSandboxEvent>(
  "ExecutionSandboxEvent"
)(
  Schema.Struct({
    type: ExecutionSandboxEventType,
    timestamp: ExecutionSandboxTimestamp,
    sandboxId: BridgeSafeNonEmptyString,
    phase: ExecutionSandboxEventPhase,
    runId: Schema.optionalKey(BridgeSafeNonEmptyString),
    status: Schema.optionalKey(ExecutionSandboxRunStatus),
    reason: Schema.optionalKey(BridgeSafeString)
  }).check(ExecutionSandboxEventPhasePayload)
) {}
