import { Schema } from "effect"

const UInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const UInt32 = UInt.check(Schema.isLessThanOrEqualTo(4_294_967_295))
const OptionalString = Schema.optionalKey(Schema.String)
const OptionalUnknown = Schema.optionalKey(Schema.Unknown)

export class HostProtocolFileNotFoundError extends Schema.Class<HostProtocolFileNotFoundError>(
  "HostProtocolFileNotFoundError"
)({
  tag: Schema.Literal("FileNotFound"),
  path: Schema.String
}) {}

export class HostProtocolPermissionDeniedError extends Schema.Class<HostProtocolPermissionDeniedError>(
  "HostProtocolPermissionDeniedError"
)({
  tag: Schema.Literal("PermissionDenied"),
  capability: Schema.String,
  resource: OptionalString
}) {}

export class HostProtocolTimeoutError extends Schema.Class<HostProtocolTimeoutError>(
  "HostProtocolTimeoutError"
)({
  tag: Schema.Literal("Timeout"),
  timeoutMs: UInt
}) {}

export class HostProtocolCancelledError extends Schema.Class<HostProtocolCancelledError>(
  "HostProtocolCancelledError"
)({
  tag: Schema.Literal("Cancelled"),
  source: Schema.String
}) {}

export class HostProtocolUnsupportedError extends Schema.Class<HostProtocolUnsupportedError>(
  "HostProtocolUnsupportedError"
)({
  tag: Schema.Literal("Unsupported"),
  reason: Schema.String
}) {}

export class HostProtocolInvalidArgumentError extends Schema.Class<HostProtocolInvalidArgumentError>(
  "HostProtocolInvalidArgumentError"
)({
  tag: Schema.Literal("InvalidArgument"),
  field: Schema.String,
  reason: Schema.String
}) {}

export class HostProtocolResourceBusyError extends Schema.Class<HostProtocolResourceBusyError>(
  "HostProtocolResourceBusyError"
)({
  tag: Schema.Literal("ResourceBusy"),
  resource: Schema.String
}) {}

export class HostProtocolDiskFullError extends Schema.Class<HostProtocolDiskFullError>(
  "HostProtocolDiskFullError"
)({
  tag: Schema.Literal("DiskFull"),
  path: Schema.String,
  freeBytes: UInt
}) {}

export class HostProtocolRateLimitedError extends Schema.Class<HostProtocolRateLimitedError>(
  "HostProtocolRateLimitedError"
)({
  tag: Schema.Literal("RateLimited"),
  retryAfterMs: UInt
}) {}

export class HostProtocolFrameTooLargeError extends Schema.Class<HostProtocolFrameTooLargeError>(
  "HostProtocolFrameTooLargeError"
)({
  tag: Schema.Literal("FrameTooLarge"),
  sizeBytes: UInt,
  limitBytes: UInt
}) {}

export class HostProtocolOriginInvalidError extends Schema.Class<HostProtocolOriginInvalidError>(
  "HostProtocolOriginInvalidError"
)({
  tag: Schema.Literal("OriginInvalid")
}) {}

export class HostProtocolStaleHandleError extends Schema.Class<HostProtocolStaleHandleError>(
  "HostProtocolStaleHandleError"
)({
  tag: Schema.Literal("StaleHandle"),
  kind: Schema.String,
  id: Schema.String,
  expectedGeneration: UInt32,
  actualGeneration: UInt32
}) {}

export class HostProtocolCrossScopeHandleError extends Schema.Class<HostProtocolCrossScopeHandleError>(
  "HostProtocolCrossScopeHandleError"
)({
  tag: Schema.Literal("CrossScopeHandle"),
  kind: Schema.String,
  id: Schema.String,
  ownerScope: Schema.String,
  attemptedScope: Schema.String
}) {}

export class HostProtocolBackpressureOverflowError extends Schema.Class<HostProtocolBackpressureOverflowError>(
  "HostProtocolBackpressureOverflowError"
)({
  tag: Schema.Literal("BackpressureOverflow"),
  policy: Schema.String,
  lostFrames: UInt
}) {}

export class HostProtocolRendererDisconnectedError extends Schema.Class<HostProtocolRendererDisconnectedError>(
  "HostProtocolRendererDisconnectedError"
)({
  tag: Schema.Literal("RendererDisconnected"),
  durationMs: UInt
}) {}

export class HostProtocolRuntimeRestartedError extends Schema.Class<HostProtocolRuntimeRestartedError>(
  "HostProtocolRuntimeRestartedError"
)({
  tag: Schema.Literal("RuntimeRestarted")
}) {}

export class HostProtocolRuntimeUnavailableError extends Schema.Class<HostProtocolRuntimeUnavailableError>(
  "HostProtocolRuntimeUnavailableError"
)({
  tag: Schema.Literal("RuntimeUnavailable"),
  retryAfterMs: UInt
}) {}

export class HostProtocolHostUnavailableError extends Schema.Class<HostProtocolHostUnavailableError>(
  "HostProtocolHostUnavailableError"
)({
  tag: Schema.Literal("HostUnavailable")
}) {}

export class HostProtocolMethodNotFoundError extends Schema.Class<HostProtocolMethodNotFoundError>(
  "HostProtocolMethodNotFoundError"
)({
  tag: Schema.Literal("MethodNotFound"),
  method: Schema.String
}) {}

export class HostProtocolInvalidOutputError extends Schema.Class<HostProtocolInvalidOutputError>(
  "HostProtocolInvalidOutputError"
)({
  tag: Schema.Literal("InvalidOutput"),
  method: Schema.String,
  reason: Schema.String
}) {}

export class HostProtocolPermissionRevokedError extends Schema.Class<HostProtocolPermissionRevokedError>(
  "HostProtocolPermissionRevokedError"
)({
  tag: Schema.Literal("PermissionRevoked"),
  capability: Schema.String,
  revokedAt: UInt
}) {}

export class HostProtocolStreamClosedError extends Schema.Class<HostProtocolStreamClosedError>(
  "HostProtocolStreamClosedError"
)({
  tag: Schema.Literal("StreamClosed"),
  streamId: Schema.String
}) {}

export class HostProtocolBinaryDecodeError extends Schema.Class<HostProtocolBinaryDecodeError>(
  "HostProtocolBinaryDecodeError"
)({
  tag: Schema.Literal("BinaryDecodeError"),
  reason: Schema.String
}) {}

export class HostProtocolReconnectBackfillExhaustedError extends Schema.Class<HostProtocolReconnectBackfillExhaustedError>(
  "HostProtocolReconnectBackfillExhaustedError"
)({
  tag: Schema.Literal("ReconnectBackfillExhausted"),
  streamId: Schema.String
}) {}

export class HostProtocolPanicInNativeCodeError extends Schema.Class<HostProtocolPanicInNativeCodeError>(
  "HostProtocolPanicInNativeCodeError"
)({
  tag: Schema.Literal("PanicInNativeCode"),
  message: Schema.String,
  backtrace: OptionalString,
  location: OptionalString
}) {}

export class HostProtocolNetworkError extends Schema.Class<HostProtocolNetworkError>(
  "HostProtocolNetworkError"
)({
  tag: Schema.Literal("NetworkError"),
  kind: Schema.String,
  message: Schema.String
}) {}

export class HostProtocolNotFoundError extends Schema.Class<HostProtocolNotFoundError>(
  "HostProtocolNotFoundError"
)({
  tag: Schema.Literal("NotFound"),
  resource: Schema.String
}) {}

export class HostProtocolAlreadyExistsError extends Schema.Class<HostProtocolAlreadyExistsError>(
  "HostProtocolAlreadyExistsError"
)({
  tag: Schema.Literal("AlreadyExists"),
  resource: Schema.String
}) {}

export class HostProtocolInvalidStateError extends Schema.Class<HostProtocolInvalidStateError>(
  "HostProtocolInvalidStateError"
)({
  tag: Schema.Literal("InvalidState"),
  current: Schema.String,
  attempted: Schema.String
}) {}

export class HostProtocolSymlinkEscapesRootError extends Schema.Class<HostProtocolSymlinkEscapesRootError>(
  "HostProtocolSymlinkEscapesRootError"
)({
  tag: Schema.Literal("SymlinkEscapesRoot"),
  requested: Schema.String,
  resolved: Schema.String,
  capabilityRoots: Schema.Array(Schema.String)
}) {}

export class HostProtocolEventLogFullError extends Schema.Class<HostProtocolEventLogFullError>(
  "HostProtocolEventLogFullError"
)({
  tag: Schema.Literal("EventLogFull"),
  freeBytes: UInt
}) {}

export class HostProtocolUpdateDowngradeRefusedError extends Schema.Class<HostProtocolUpdateDowngradeRefusedError>(
  "HostProtocolUpdateDowngradeRefusedError"
)({
  tag: Schema.Literal("UpdateDowngradeRefused"),
  installedVersion: Schema.String,
  manifestVersion: Schema.String
}) {}

export class HostProtocolUpdateDownloadTruncatedError extends Schema.Class<HostProtocolUpdateDownloadTruncatedError>(
  "HostProtocolUpdateDownloadTruncatedError"
)({
  tag: Schema.Literal("UpdateDownloadTruncated"),
  downloadedBytes: UInt,
  expectedBytes: UInt
}) {}

export class HostProtocolUpdateStaleNotarizationError extends Schema.Class<HostProtocolUpdateStaleNotarizationError>(
  "HostProtocolUpdateStaleNotarizationError"
)({
  tag: Schema.Literal("UpdateStaleNotarization"),
  notarizedAt: Schema.String
}) {}

export class HostProtocolSettingsMigrationFailedError extends Schema.Class<HostProtocolSettingsMigrationFailedError>(
  "HostProtocolSettingsMigrationFailedError"
)({
  tag: Schema.Literal("SettingsMigrationFailed"),
  schemaVersion: UInt32,
  cause: Schema.String
}) {}

export class HostProtocolSettingsRecoveredFromBackupError extends Schema.Class<HostProtocolSettingsRecoveredFromBackupError>(
  "HostProtocolSettingsRecoveredFromBackupError"
)({
  tag: Schema.Literal("SettingsRecoveredFromBackup"),
  backupPath: Schema.String
}) {}

export class HostProtocolEventLogSegmentCorruptError extends Schema.Class<HostProtocolEventLogSegmentCorruptError>(
  "HostProtocolEventLogSegmentCorruptError"
)({
  tag: Schema.Literal("EventLogSegmentCorrupt"),
  segmentPath: Schema.String
}) {}

export class HostProtocolPtyForceKillTimeoutError extends Schema.Class<HostProtocolPtyForceKillTimeoutError>(
  "HostProtocolPtyForceKillTimeoutError"
)({
  tag: Schema.Literal("PtyForceKillTimeout"),
  ptyId: Schema.String
}) {}

export class HostProtocolInternalError extends Schema.Class<HostProtocolInternalError>(
  "HostProtocolInternalError"
)({
  tag: Schema.Literal("Internal"),
  message: Schema.String
}) {}

export const HostProtocolError = Schema.Union([
  HostProtocolFileNotFoundError,
  HostProtocolPermissionDeniedError,
  HostProtocolTimeoutError,
  HostProtocolCancelledError,
  HostProtocolUnsupportedError,
  HostProtocolInvalidArgumentError,
  HostProtocolResourceBusyError,
  HostProtocolDiskFullError,
  HostProtocolRateLimitedError,
  HostProtocolFrameTooLargeError,
  HostProtocolOriginInvalidError,
  HostProtocolStaleHandleError,
  HostProtocolCrossScopeHandleError,
  HostProtocolBackpressureOverflowError,
  HostProtocolRendererDisconnectedError,
  HostProtocolRuntimeRestartedError,
  HostProtocolRuntimeUnavailableError,
  HostProtocolHostUnavailableError,
  HostProtocolMethodNotFoundError,
  HostProtocolInvalidOutputError,
  HostProtocolPermissionRevokedError,
  HostProtocolStreamClosedError,
  HostProtocolBinaryDecodeError,
  HostProtocolReconnectBackfillExhaustedError,
  HostProtocolPanicInNativeCodeError,
  HostProtocolNetworkError,
  HostProtocolNotFoundError,
  HostProtocolAlreadyExistsError,
  HostProtocolInvalidStateError,
  HostProtocolSymlinkEscapesRootError,
  HostProtocolEventLogFullError,
  HostProtocolUpdateDowngradeRefusedError,
  HostProtocolUpdateDownloadTruncatedError,
  HostProtocolUpdateStaleNotarizationError,
  HostProtocolSettingsMigrationFailedError,
  HostProtocolSettingsRecoveredFromBackupError,
  HostProtocolEventLogSegmentCorruptError,
  HostProtocolPtyForceKillTimeoutError,
  HostProtocolInternalError
])

export type HostProtocolError = typeof HostProtocolError.Type

export class HostProtocolRequestEnvelope extends Schema.Class<HostProtocolRequestEnvelope>(
  "HostProtocolRequestEnvelope"
)({
  kind: Schema.Literal("request"),
  id: Schema.String,
  method: Schema.String,
  timestamp: UInt,
  traceId: Schema.String,
  windowId: OptionalString,
  originToken: OptionalString,
  payload: OptionalUnknown
}) {}

export class HostProtocolResponseEnvelope extends Schema.Class<HostProtocolResponseEnvelope>(
  "HostProtocolResponseEnvelope"
)({
  kind: Schema.Literal("response"),
  id: Schema.String,
  timestamp: UInt,
  traceId: Schema.String,
  payload: OptionalUnknown,
  error: Schema.optionalKey(HostProtocolError)
}) {}

export class HostProtocolEventEnvelope extends Schema.Class<HostProtocolEventEnvelope>(
  "HostProtocolEventEnvelope"
)({
  kind: Schema.Literal("event"),
  method: Schema.String,
  timestamp: UInt,
  traceId: Schema.String,
  windowId: OptionalString,
  payload: OptionalUnknown
}) {}

export class HostProtocolStreamByRequestEnvelope extends Schema.Class<HostProtocolStreamByRequestEnvelope>(
  "HostProtocolStreamByRequestEnvelope"
)({
  kind: Schema.Literal("stream"),
  id: Schema.String,
  resourceId: OptionalString,
  timestamp: UInt,
  traceId: Schema.String,
  payload: OptionalUnknown,
  error: Schema.optionalKey(HostProtocolError)
}) {}

export class HostProtocolStreamByResourceEnvelope extends Schema.Class<HostProtocolStreamByResourceEnvelope>(
  "HostProtocolStreamByResourceEnvelope"
)({
  kind: Schema.Literal("stream"),
  id: OptionalString,
  resourceId: Schema.String,
  timestamp: UInt,
  traceId: Schema.String,
  payload: OptionalUnknown,
  error: Schema.optionalKey(HostProtocolError)
}) {}

export class HostProtocolCancelByRequestEnvelope extends Schema.Class<HostProtocolCancelByRequestEnvelope>(
  "HostProtocolCancelByRequestEnvelope"
)({
  kind: Schema.Literal("cancel"),
  id: Schema.String,
  resourceId: OptionalString,
  timestamp: UInt,
  traceId: Schema.String
}) {}

export class HostProtocolCancelByResourceEnvelope extends Schema.Class<HostProtocolCancelByResourceEnvelope>(
  "HostProtocolCancelByResourceEnvelope"
)({
  kind: Schema.Literal("cancel"),
  id: OptionalString,
  resourceId: Schema.String,
  timestamp: UInt,
  traceId: Schema.String
}) {}

export const HostProtocolEnvelope = Schema.Union([
  HostProtocolRequestEnvelope,
  HostProtocolResponseEnvelope,
  HostProtocolEventEnvelope,
  HostProtocolStreamByRequestEnvelope,
  HostProtocolStreamByResourceEnvelope,
  HostProtocolCancelByRequestEnvelope,
  HostProtocolCancelByResourceEnvelope
])

export type HostProtocolEnvelope = typeof HostProtocolEnvelope.Type

export const decodeHostProtocolEnvelope = Schema.decodeUnknownSync(HostProtocolEnvelope)

export const encodeHostProtocolEnvelope = Schema.encodeSync(HostProtocolEnvelope)
