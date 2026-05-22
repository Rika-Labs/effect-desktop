import { Effect, Option, Schema } from "effect"

const NonEmptyString = Schema.NonEmptyString
const NulByte = String.fromCharCode(0)
const UnitSeparatorByte = String.fromCharCode(31)
const DeleteByte = String.fromCharCode(127)
const NoControlTextPattern = new RegExp(`^[^${NulByte}-${UnitSeparatorByte}${DeleteByte}]+$`, "u")
const InspectorIdentityString = NonEmptyString.check(
  Schema.isPattern(NoControlTextPattern, {
    description: "a non-empty string without control characters"
  })
)
const NonNegativeNumber = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))
const PositiveInteger = Schema.Int.check(Schema.isGreaterThan(0))
const JsonRecord = Schema.Record(Schema.String, Schema.Json)

export const InspectorEventSource = Schema.Literals([
  "runtime",
  "telemetry",
  "layer-graph",
  "provider",
  "rpc",
  "bridge",
  "permission",
  "resource",
  "fiber",
  "native-host",
  "renderer",
  "persistence",
  "workflow",
  "devtools"
])
export type InspectorEventSource = typeof InspectorEventSource.Type

export const InspectorEventSeverity = Schema.Literals([
  "Trace",
  "Debug",
  "Info",
  "Warn",
  "Error",
  "Fatal"
])
export type InspectorEventSeverity = typeof InspectorEventSeverity.Type

export class InspectorRedactionState extends Schema.Class<InspectorRedactionState>(
  "InspectorRedactionState"
)({
  redacted: Schema.Boolean,
  omitted: Schema.Boolean,
  evidenceCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
}) {}

const InspectorPayloadBase = {
  attributes: Schema.optionalKey(JsonRecord)
} as const

export class InspectorSpanPayload extends Schema.Class<InspectorSpanPayload>(
  "InspectorSpanPayload"
)({
  ...InspectorPayloadBase,
  tag: Schema.Literal("span"),
  name: NonEmptyString,
  state: Schema.Literals(["started", "ended"]),
  durationMs: Schema.optionalKey(NonNegativeNumber)
}) {}

export class InspectorLogPayload extends Schema.Class<InspectorLogPayload>("InspectorLogPayload")({
  ...InspectorPayloadBase,
  tag: Schema.Literal("log"),
  level: InspectorEventSeverity,
  message: Schema.String,
  fiberId: Schema.optionalKey(InspectorIdentityString)
}) {}

export class InspectorMetricPayload extends Schema.Class<InspectorMetricPayload>(
  "InspectorMetricPayload"
)({
  ...InspectorPayloadBase,
  tag: Schema.Literal("metric"),
  name: NonEmptyString,
  value: Schema.Number.check(Schema.isFinite()),
  unit: Schema.optionalKey(NonEmptyString)
}) {}

export class InspectorLayerGraphPayload extends Schema.Class<InspectorLayerGraphPayload>(
  "InspectorLayerGraphPayload"
)({
  ...InspectorPayloadBase,
  tag: Schema.Literal("layer-graph"),
  layerId: InspectorIdentityString,
  label: NonEmptyString,
  state: Schema.Literals(["registered", "acquired", "released", "failed"]),
  dependencies: Schema.Array(InspectorIdentityString)
}) {}

export class InspectorProviderPayload extends Schema.Class<InspectorProviderPayload>(
  "InspectorProviderPayload"
)({
  ...InspectorPayloadBase,
  tag: Schema.Literal("provider"),
  providerId: InspectorIdentityString,
  capability: InspectorIdentityString,
  state: Schema.Literals(["available", "unavailable", "degraded"])
}) {}

export class InspectorRpcPayload extends Schema.Class<InspectorRpcPayload>("InspectorRpcPayload")({
  ...InspectorPayloadBase,
  tag: Schema.Literal("rpc"),
  service: NonEmptyString,
  method: NonEmptyString,
  requestId: InspectorIdentityString,
  state: Schema.Literals(["requested", "completed", "failed", "interrupted"]),
  latencyMs: Schema.optionalKey(NonNegativeNumber)
}) {}

export class InspectorBridgeFramePayload extends Schema.Class<InspectorBridgeFramePayload>(
  "InspectorBridgeFramePayload"
)({
  ...InspectorPayloadBase,
  tag: Schema.Literal("bridge-frame"),
  direction: Schema.Literals(["renderer-to-host", "host-to-renderer"]),
  frameKind: NonEmptyString,
  requestId: Schema.optionalKey(InspectorIdentityString),
  payloadBytes: NonNegativeNumber
}) {}

export class InspectorPermissionPayload extends Schema.Class<InspectorPermissionPayload>(
  "InspectorPermissionPayload"
)({
  ...InspectorPayloadBase,
  tag: Schema.Literal("permission"),
  actor: InspectorIdentityString,
  capability: InspectorIdentityString,
  decision: Schema.Literals(["granted", "denied", "revoked", "expired", "used"]),
  reason: Schema.optionalKey(Schema.String)
}) {}

export class InspectorResourcePayload extends Schema.Class<InspectorResourcePayload>(
  "InspectorResourcePayload"
)({
  ...InspectorPayloadBase,
  tag: Schema.Literal("resource"),
  resourceId: InspectorIdentityString,
  resourceKind: NonEmptyString,
  ownerScope: InspectorIdentityString,
  state: Schema.Literals(["opened", "closed", "failed", "leaked"])
}) {}

export class InspectorFiberPayload extends Schema.Class<InspectorFiberPayload>(
  "InspectorFiberPayload"
)({
  ...InspectorPayloadBase,
  tag: Schema.Literal("fiber"),
  fiberId: InspectorIdentityString,
  name: Schema.optionalKey(NonEmptyString),
  state: Schema.Literals(["started", "suspended", "resumed", "completed", "failed", "interrupted"])
}) {}

export class InspectorNativeHostPayload extends Schema.Class<InspectorNativeHostPayload>(
  "InspectorNativeHostPayload"
)({
  ...InspectorPayloadBase,
  tag: Schema.Literal("native-host"),
  event: NonEmptyString,
  platform: Schema.optionalKey(Schema.Literals(["macos", "windows", "linux"])),
  pid: Schema.optionalKey(PositiveInteger)
}) {}

export class InspectorRendererPayload extends Schema.Class<InspectorRendererPayload>(
  "InspectorRendererPayload"
)({
  ...InspectorPayloadBase,
  tag: Schema.Literal("renderer"),
  windowId: InspectorIdentityString,
  event: NonEmptyString,
  url: Schema.optionalKey(Schema.String)
}) {}

export class InspectorPersistencePayload extends Schema.Class<InspectorPersistencePayload>(
  "InspectorPersistencePayload"
)({
  ...InspectorPayloadBase,
  tag: Schema.Literal("persistence"),
  store: NonEmptyString,
  operation: NonEmptyString,
  key: Schema.optionalKey(InspectorIdentityString),
  state: Schema.Literals(["started", "completed", "failed", "recovered"])
}) {}

export class InspectorWorkflowPayload extends Schema.Class<InspectorWorkflowPayload>(
  "InspectorWorkflowPayload"
)({
  ...InspectorPayloadBase,
  tag: Schema.Literal("workflow"),
  executionId: InspectorIdentityString,
  workflowName: NonEmptyString,
  state: Schema.Literals(["started", "completed", "failed", "retrying", "compensating"])
}) {}

export class InspectorFailurePayload extends Schema.Class<InspectorFailurePayload>(
  "InspectorFailurePayload"
)({
  ...InspectorPayloadBase,
  tag: Schema.Literal("failure"),
  errorTag: NonEmptyString,
  message: Schema.String,
  recoverable: Schema.Boolean
}) {}

export const InspectorPayload = Schema.Union([
  InspectorSpanPayload,
  InspectorLogPayload,
  InspectorMetricPayload,
  InspectorLayerGraphPayload,
  InspectorProviderPayload,
  InspectorRpcPayload,
  InspectorBridgeFramePayload,
  InspectorPermissionPayload,
  InspectorResourcePayload,
  InspectorFiberPayload,
  InspectorNativeHostPayload,
  InspectorRendererPayload,
  InspectorPersistencePayload,
  InspectorWorkflowPayload,
  InspectorFailurePayload
])
export type InspectorPayload = typeof InspectorPayload.Type

export class InspectorEvent extends Schema.Class<InspectorEvent>("InspectorEvent")({
  id: InspectorIdentityString,
  source: InspectorEventSource,
  occurredAt: Schema.DateTimeUtcFromString,
  traceId: Schema.OptionFromNullishOr(InspectorIdentityString),
  spanId: Schema.OptionFromNullishOr(InspectorIdentityString),
  layerId: Schema.OptionFromNullishOr(InspectorIdentityString),
  providerId: Schema.OptionFromNullishOr(InspectorIdentityString),
  severity: InspectorEventSeverity,
  redaction: InspectorRedactionState,
  payload: InspectorPayload
}) {}

export const emptyInspectorRedactionState = new InspectorRedactionState({
  evidenceCount: 0,
  omitted: false,
  redacted: false
})

export const makeInspectorEvent = (
  input: Omit<InspectorEvent, "layerId" | "providerId" | "redaction" | "spanId" | "traceId"> &
    Partial<Pick<InspectorEvent, "layerId" | "providerId" | "redaction" | "spanId" | "traceId">>
): InspectorEvent =>
  new InspectorEvent({
    ...input,
    layerId: input.layerId ?? Option.none(),
    providerId: input.providerId ?? Option.none(),
    redaction: input.redaction ?? emptyInspectorRedactionState,
    spanId: input.spanId ?? Option.none(),
    traceId: input.traceId ?? Option.none()
  })

export const decodeUnknownInspectorEvent = Schema.decodeUnknownEffect(InspectorEvent)
export const encodeInspectorEvent = Schema.encodeEffect(InspectorEvent)

export const replayInspectorFixture = (
  fixture: readonly unknown[]
): Effect.Effect<readonly InspectorEvent[], Schema.SchemaError, never> =>
  Effect.forEach(fixture, (event) => decodeUnknownInspectorEvent(event), { concurrency: 1 })
