import { Effect, Option, Queue, Scope, Schema } from "effect"
import { RpcClient, RpcClientError, RpcMessage, RpcServer } from "effect/unstable/rpc"

import packageJson from "../package.json" with { type: "json" }

export const HOST_PING_METHOD = "host.ping"
export const HOST_VERSION_METHOD = "host.version"
export const HOST_PROTOCOL_VERSION = packageJson.version
export const WINDOW_CREATE_METHOD = "Window.create"
export const WINDOW_DESTROY_METHOD = "Window.destroy"
export const DOCK_SET_BADGE_COUNT_METHOD = "Dock.setBadgeCount"
export const DOCK_SET_BADGE_TEXT_METHOD = "Dock.setBadgeText"
export const DOCK_SET_MENU_METHOD = "Dock.setMenu"
export const DOCK_REQUEST_ATTENTION_METHOD = "Dock.requestAttention"
export const MENU_SET_APPLICATION_MENU_METHOD = "Menu.setApplicationMenu"
export const MENU_SET_WINDOW_MENU_METHOD = "Menu.setWindowMenu"
export const RENDERER_DISCONNECTED_EVENT = "renderer.disconnected"
export const RENDERER_RESUME_METHOD = "renderer.resume"
export const RENDERER_RESUMED_EVENT = "renderer.resumed"
export const RENDERER_RESUME_DENIED_EVENT = "renderer.resume.denied"
export const DEFAULT_RECONNECT_WINDOW_MS = 30_000
export const DEFAULT_MAX_BACKFILL_EVENTS = 1_024

const UInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const UInt32 = UInt.check(Schema.isLessThanOrEqualTo(4_294_967_295))
const OptionalString = Schema.optionalKey(Schema.String)
const OptionalUnknown = Schema.optionalKey(Schema.Unknown)
const StringRecord = Schema.Record(Schema.String, Schema.String)
const StrictParseOptions = { onExcessProperty: "error" } as const

export const HOST_PROTOCOL_ERROR_SPECS = [
  { tag: "FileNotFound", recoverable: false },
  { tag: "PermissionDenied", recoverable: false },
  { tag: "Timeout", recoverable: true },
  { tag: "Cancelled", recoverable: true },
  { tag: "Unsupported", recoverable: false },
  { tag: "InvalidArgument", recoverable: false },
  { tag: "ResourceBusy", recoverable: true },
  { tag: "DiskFull", recoverable: true },
  { tag: "RateLimited", recoverable: true },
  { tag: "FrameTooLarge", recoverable: false },
  { tag: "OriginInvalid", recoverable: false },
  { tag: "StaleHandle", recoverable: false },
  { tag: "CrossScopeHandle", recoverable: false },
  { tag: "BackpressureOverflow", recoverable: true },
  { tag: "RendererDisconnected", recoverable: true },
  { tag: "RuntimeRestarted", recoverable: true },
  { tag: "RuntimeUnavailable", recoverable: true },
  { tag: "HostUnavailable", recoverable: true },
  { tag: "MethodNotFound", recoverable: false },
  { tag: "InvalidOutput", recoverable: false },
  { tag: "PermissionRevoked", recoverable: false },
  { tag: "StreamClosed", recoverable: false },
  { tag: "BinaryDecodeError", recoverable: false },
  { tag: "ReconnectBackfillExhausted", recoverable: false },
  { tag: "PanicInNativeCode", recoverable: false },
  { tag: "NetworkError", recoverable: true },
  { tag: "NotFound", recoverable: false },
  { tag: "AlreadyExists", recoverable: false },
  { tag: "InvalidState", recoverable: false },
  { tag: "SymlinkEscapesRoot", recoverable: false },
  { tag: "EventLogFull", recoverable: true },
  { tag: "UpdateDowngradeRefused", recoverable: false },
  { tag: "UpdateDownloadTruncated", recoverable: true },
  { tag: "UpdateStaleNotarization", recoverable: false },
  { tag: "SettingsMigrationFailed", recoverable: false },
  { tag: "SettingsRecoveredFromBackup", recoverable: true },
  { tag: "EventLogSegmentCorrupt", recoverable: false },
  { tag: "PtyForceKillTimeout", recoverable: false },
  { tag: "Internal", recoverable: false }
] as const

export type HostProtocolErrorSpec = (typeof HOST_PROTOCOL_ERROR_SPECS)[number]
export type HostProtocolErrorTag = HostProtocolErrorSpec["tag"]
const HOST_PROTOCOL_ERROR_RECOVERABLE_BY_TAG = Object.fromEntries(
  HOST_PROTOCOL_ERROR_SPECS.map((spec) => [spec.tag, spec.recoverable])
) as Readonly<Record<HostProtocolErrorTag, boolean>>

const HostProtocolErrorCommonFieldsWithoutCause = {
  message: Schema.String,
  operation: Schema.String,
  platform: Schema.optionalKey(Schema.Literals(["macos", "windows", "linux"])),
  code: OptionalString,
  recoverable: Schema.Boolean,
  remediation: OptionalString,
  docsUrl: OptionalString
} as const

const HostProtocolErrorCommonFields = {
  message: Schema.String,
  operation: Schema.String,
  platform: Schema.optionalKey(Schema.Literals(["macos", "windows", "linux"])),
  code: OptionalString,
  cause: OptionalUnknown,
  recoverable: Schema.Boolean,
  remediation: OptionalString,
  docsUrl: OptionalString
} as const

export const hostProtocolErrorRecoverableDefault = (tag: HostProtocolErrorTag): boolean => {
  return HOST_PROTOCOL_ERROR_RECOVERABLE_BY_TAG[tag]
}

interface HostProtocolErrorCommonInput {
  readonly message: string
  readonly operation: string
  readonly recoverable: boolean
}

const makeHostProtocolErrorCommonInput = (
  tag: HostProtocolErrorTag,
  message: string,
  operation: string
): HostProtocolErrorCommonInput => ({
  message,
  operation,
  recoverable: hostProtocolErrorRecoverableDefault(tag)
})

export class HostProtocolFileNotFoundError extends Schema.Class<HostProtocolFileNotFoundError>(
  "HostProtocolFileNotFoundError"
)({
  tag: Schema.Literal("FileNotFound"),
  path: Schema.String,
  ...HostProtocolErrorCommonFields
}) {
  get _tag(): "FileNotFound" {
    return this.tag
  }
}

export class HostProtocolPermissionDeniedError extends Schema.Class<HostProtocolPermissionDeniedError>(
  "HostProtocolPermissionDeniedError"
)({
  tag: Schema.Literal("PermissionDenied"),
  capability: Schema.String,
  resource: OptionalString,
  ...HostProtocolErrorCommonFields
}) {
  get _tag(): "PermissionDenied" {
    return this.tag
  }
}

export class HostProtocolTimeoutError extends Schema.Class<HostProtocolTimeoutError>(
  "HostProtocolTimeoutError"
)({
  tag: Schema.Literal("Timeout"),
  timeoutMs: UInt,
  ...HostProtocolErrorCommonFields
}) {
  get _tag(): "Timeout" {
    return this.tag
  }
}

export class HostProtocolCancelledError extends Schema.Class<HostProtocolCancelledError>(
  "HostProtocolCancelledError"
)({
  tag: Schema.Literal("Cancelled"),
  source: Schema.String,
  ...HostProtocolErrorCommonFields
}) {
  get _tag(): "Cancelled" {
    return this.tag
  }
}

export class HostProtocolUnsupportedError extends Schema.Class<HostProtocolUnsupportedError>(
  "HostProtocolUnsupportedError"
)({
  tag: Schema.Literal("Unsupported"),
  reason: Schema.String,
  ...HostProtocolErrorCommonFields
}) {
  get _tag(): "Unsupported" {
    return this.tag
  }
}

export class HostProtocolInvalidArgumentError extends Schema.Class<HostProtocolInvalidArgumentError>(
  "HostProtocolInvalidArgumentError"
)({
  tag: Schema.Literal("InvalidArgument"),
  field: Schema.String,
  reason: Schema.String,
  ...HostProtocolErrorCommonFields
}) {
  get _tag(): "InvalidArgument" {
    return this.tag
  }
}

export class HostProtocolResourceBusyError extends Schema.Class<HostProtocolResourceBusyError>(
  "HostProtocolResourceBusyError"
)({
  tag: Schema.Literal("ResourceBusy"),
  resource: Schema.String,
  ...HostProtocolErrorCommonFields
}) {
  get _tag(): "ResourceBusy" {
    return this.tag
  }
}

export class HostProtocolDiskFullError extends Schema.Class<HostProtocolDiskFullError>(
  "HostProtocolDiskFullError"
)({
  tag: Schema.Literal("DiskFull"),
  path: Schema.String,
  freeBytes: UInt,
  ...HostProtocolErrorCommonFields
}) {
  get _tag(): "DiskFull" {
    return this.tag
  }
}

export class HostProtocolRateLimitedError extends Schema.Class<HostProtocolRateLimitedError>(
  "HostProtocolRateLimitedError"
)({
  tag: Schema.Literal("RateLimited"),
  retryAfterMs: UInt,
  ...HostProtocolErrorCommonFields
}) {
  get _tag(): "RateLimited" {
    return this.tag
  }
}

export class HostProtocolFrameTooLargeError extends Schema.Class<HostProtocolFrameTooLargeError>(
  "HostProtocolFrameTooLargeError"
)({
  tag: Schema.Literal("FrameTooLarge"),
  sizeBytes: UInt,
  limitBytes: UInt,
  ...HostProtocolErrorCommonFields
}) {
  get _tag(): "FrameTooLarge" {
    return this.tag
  }
}

export class HostProtocolOriginInvalidError extends Schema.Class<HostProtocolOriginInvalidError>(
  "HostProtocolOriginInvalidError"
)({
  tag: Schema.Literal("OriginInvalid"),
  ...HostProtocolErrorCommonFields
}) {
  get _tag(): "OriginInvalid" {
    return this.tag
  }
}

export class HostProtocolStaleHandleError extends Schema.Class<HostProtocolStaleHandleError>(
  "HostProtocolStaleHandleError"
)({
  tag: Schema.Literal("StaleHandle"),
  kind: Schema.String,
  id: Schema.String,
  expectedGeneration: UInt32,
  actualGeneration: UInt32,
  ...HostProtocolErrorCommonFields
}) {
  get _tag(): "StaleHandle" {
    return this.tag
  }
}

export class HostProtocolCrossScopeHandleError extends Schema.Class<HostProtocolCrossScopeHandleError>(
  "HostProtocolCrossScopeHandleError"
)({
  tag: Schema.Literal("CrossScopeHandle"),
  kind: Schema.String,
  id: Schema.String,
  ownerScope: Schema.String,
  attemptedScope: Schema.String,
  ...HostProtocolErrorCommonFields
}) {
  get _tag(): "CrossScopeHandle" {
    return this.tag
  }
}

export class HostProtocolBackpressureOverflowError extends Schema.Class<HostProtocolBackpressureOverflowError>(
  "HostProtocolBackpressureOverflowError"
)({
  tag: Schema.Literal("BackpressureOverflow"),
  policy: Schema.String,
  lostFrames: UInt,
  ...HostProtocolErrorCommonFields
}) {
  get _tag(): "BackpressureOverflow" {
    return this.tag
  }
}

export class HostProtocolRendererDisconnectedError extends Schema.Class<HostProtocolRendererDisconnectedError>(
  "HostProtocolRendererDisconnectedError"
)({
  tag: Schema.Literal("RendererDisconnected"),
  durationMs: UInt,
  ...HostProtocolErrorCommonFields
}) {
  get _tag(): "RendererDisconnected" {
    return this.tag
  }
}

export class HostProtocolRuntimeRestartedError extends Schema.Class<HostProtocolRuntimeRestartedError>(
  "HostProtocolRuntimeRestartedError"
)({
  tag: Schema.Literal("RuntimeRestarted"),
  ...HostProtocolErrorCommonFields
}) {
  get _tag(): "RuntimeRestarted" {
    return this.tag
  }
}

export class HostProtocolRuntimeUnavailableError extends Schema.Class<HostProtocolRuntimeUnavailableError>(
  "HostProtocolRuntimeUnavailableError"
)({
  tag: Schema.Literal("RuntimeUnavailable"),
  retryAfterMs: UInt,
  ...HostProtocolErrorCommonFields
}) {
  get _tag(): "RuntimeUnavailable" {
    return this.tag
  }
}

export class HostProtocolHostUnavailableError extends Schema.Class<HostProtocolHostUnavailableError>(
  "HostProtocolHostUnavailableError"
)({
  tag: Schema.Literal("HostUnavailable"),
  ...HostProtocolErrorCommonFields
}) {
  get _tag(): "HostUnavailable" {
    return this.tag
  }
}

export class HostProtocolMethodNotFoundError extends Schema.Class<HostProtocolMethodNotFoundError>(
  "HostProtocolMethodNotFoundError"
)({
  tag: Schema.Literal("MethodNotFound"),
  method: Schema.String,
  ...HostProtocolErrorCommonFields
}) {
  get _tag(): "MethodNotFound" {
    return this.tag
  }
}

export class HostProtocolInvalidOutputError extends Schema.Class<HostProtocolInvalidOutputError>(
  "HostProtocolInvalidOutputError"
)({
  tag: Schema.Literal("InvalidOutput"),
  method: Schema.String,
  reason: Schema.String,
  ...HostProtocolErrorCommonFields
}) {
  get _tag(): "InvalidOutput" {
    return this.tag
  }
}

export class HostProtocolPermissionRevokedError extends Schema.Class<HostProtocolPermissionRevokedError>(
  "HostProtocolPermissionRevokedError"
)({
  tag: Schema.Literal("PermissionRevoked"),
  capability: Schema.String,
  revokedAt: UInt,
  ...HostProtocolErrorCommonFields
}) {
  get _tag(): "PermissionRevoked" {
    return this.tag
  }
}

export class HostProtocolStreamClosedError extends Schema.Class<HostProtocolStreamClosedError>(
  "HostProtocolStreamClosedError"
)({
  tag: Schema.Literal("StreamClosed"),
  streamId: Schema.String,
  ...HostProtocolErrorCommonFields
}) {
  get _tag(): "StreamClosed" {
    return this.tag
  }
}

export class HostProtocolBinaryDecodeError extends Schema.Class<HostProtocolBinaryDecodeError>(
  "HostProtocolBinaryDecodeError"
)({
  tag: Schema.Literal("BinaryDecodeError"),
  reason: Schema.String,
  ...HostProtocolErrorCommonFields
}) {
  get _tag(): "BinaryDecodeError" {
    return this.tag
  }
}

export class HostProtocolReconnectBackfillExhaustedError extends Schema.Class<HostProtocolReconnectBackfillExhaustedError>(
  "HostProtocolReconnectBackfillExhaustedError"
)({
  tag: Schema.Literal("ReconnectBackfillExhausted"),
  streamId: Schema.String,
  ...HostProtocolErrorCommonFields
}) {
  get _tag(): "ReconnectBackfillExhausted" {
    return this.tag
  }
}

export class HostProtocolPanicInNativeCodeError extends Schema.Class<HostProtocolPanicInNativeCodeError>(
  "HostProtocolPanicInNativeCodeError"
)({
  tag: Schema.Literal("PanicInNativeCode"),
  backtrace: OptionalString,
  location: OptionalString,
  ...HostProtocolErrorCommonFields
}) {
  get _tag(): "PanicInNativeCode" {
    return this.tag
  }
}

export class HostProtocolNetworkError extends Schema.Class<HostProtocolNetworkError>(
  "HostProtocolNetworkError"
)({
  tag: Schema.Literal("NetworkError"),
  kind: Schema.String,
  ...HostProtocolErrorCommonFields
}) {
  get _tag(): "NetworkError" {
    return this.tag
  }
}

export class HostProtocolNotFoundError extends Schema.Class<HostProtocolNotFoundError>(
  "HostProtocolNotFoundError"
)({
  tag: Schema.Literal("NotFound"),
  resource: Schema.String,
  ...HostProtocolErrorCommonFields
}) {
  get _tag(): "NotFound" {
    return this.tag
  }
}

export class HostProtocolAlreadyExistsError extends Schema.Class<HostProtocolAlreadyExistsError>(
  "HostProtocolAlreadyExistsError"
)({
  tag: Schema.Literal("AlreadyExists"),
  resource: Schema.String,
  ...HostProtocolErrorCommonFields
}) {
  get _tag(): "AlreadyExists" {
    return this.tag
  }
}

export class HostProtocolInvalidStateError extends Schema.Class<HostProtocolInvalidStateError>(
  "HostProtocolInvalidStateError"
)({
  tag: Schema.Literal("InvalidState"),
  current: Schema.String,
  attempted: Schema.String,
  ...HostProtocolErrorCommonFields
}) {
  get _tag(): "InvalidState" {
    return this.tag
  }
}

export class HostProtocolSymlinkEscapesRootError extends Schema.Class<HostProtocolSymlinkEscapesRootError>(
  "HostProtocolSymlinkEscapesRootError"
)({
  tag: Schema.Literal("SymlinkEscapesRoot"),
  requested: Schema.String,
  resolved: Schema.String,
  capabilityRoots: Schema.Array(Schema.String),
  ...HostProtocolErrorCommonFields
}) {
  get _tag(): "SymlinkEscapesRoot" {
    return this.tag
  }
}

export class HostProtocolEventLogFullError extends Schema.Class<HostProtocolEventLogFullError>(
  "HostProtocolEventLogFullError"
)({
  tag: Schema.Literal("EventLogFull"),
  freeBytes: UInt,
  ...HostProtocolErrorCommonFields
}) {
  get _tag(): "EventLogFull" {
    return this.tag
  }
}

export class HostProtocolUpdateDowngradeRefusedError extends Schema.Class<HostProtocolUpdateDowngradeRefusedError>(
  "HostProtocolUpdateDowngradeRefusedError"
)({
  tag: Schema.Literal("UpdateDowngradeRefused"),
  installedVersion: Schema.String,
  manifestVersion: Schema.String,
  ...HostProtocolErrorCommonFields
}) {
  get _tag(): "UpdateDowngradeRefused" {
    return this.tag
  }
}

export class HostProtocolUpdateDownloadTruncatedError extends Schema.Class<HostProtocolUpdateDownloadTruncatedError>(
  "HostProtocolUpdateDownloadTruncatedError"
)({
  tag: Schema.Literal("UpdateDownloadTruncated"),
  downloadedBytes: UInt,
  expectedBytes: UInt,
  ...HostProtocolErrorCommonFields
}) {
  get _tag(): "UpdateDownloadTruncated" {
    return this.tag
  }
}

export class HostProtocolUpdateStaleNotarizationError extends Schema.Class<HostProtocolUpdateStaleNotarizationError>(
  "HostProtocolUpdateStaleNotarizationError"
)({
  tag: Schema.Literal("UpdateStaleNotarization"),
  notarizedAt: Schema.String,
  ...HostProtocolErrorCommonFields
}) {
  get _tag(): "UpdateStaleNotarization" {
    return this.tag
  }
}

export class HostProtocolSettingsMigrationFailedError extends Schema.Class<HostProtocolSettingsMigrationFailedError>(
  "HostProtocolSettingsMigrationFailedError"
)({
  tag: Schema.Literal("SettingsMigrationFailed"),
  schemaVersion: UInt32,
  cause: Schema.String,
  ...HostProtocolErrorCommonFieldsWithoutCause
}) {
  get _tag(): "SettingsMigrationFailed" {
    return this.tag
  }
}

export class HostProtocolSettingsRecoveredFromBackupError extends Schema.Class<HostProtocolSettingsRecoveredFromBackupError>(
  "HostProtocolSettingsRecoveredFromBackupError"
)({
  tag: Schema.Literal("SettingsRecoveredFromBackup"),
  backupPath: Schema.String,
  ...HostProtocolErrorCommonFields
}) {
  get _tag(): "SettingsRecoveredFromBackup" {
    return this.tag
  }
}

export class HostProtocolEventLogSegmentCorruptError extends Schema.Class<HostProtocolEventLogSegmentCorruptError>(
  "HostProtocolEventLogSegmentCorruptError"
)({
  tag: Schema.Literal("EventLogSegmentCorrupt"),
  segmentPath: Schema.String,
  ...HostProtocolErrorCommonFields
}) {
  get _tag(): "EventLogSegmentCorrupt" {
    return this.tag
  }
}

export class HostProtocolPtyForceKillTimeoutError extends Schema.Class<HostProtocolPtyForceKillTimeoutError>(
  "HostProtocolPtyForceKillTimeoutError"
)({
  tag: Schema.Literal("PtyForceKillTimeout"),
  ptyId: Schema.String,
  ...HostProtocolErrorCommonFields
}) {
  get _tag(): "PtyForceKillTimeout" {
    return this.tag
  }
}

export class HostProtocolInternalError extends Schema.Class<HostProtocolInternalError>(
  "HostProtocolInternalError"
)({
  tag: Schema.Literal("Internal"),
  ...HostProtocolErrorCommonFields
}) {
  get _tag(): "Internal" {
    return this.tag
  }
}

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

export const makeHostProtocolInvalidArgumentError = (
  field: string,
  reason: string,
  operation: string
): HostProtocolInvalidArgumentError =>
  new HostProtocolInvalidArgumentError({
    tag: "InvalidArgument",
    field,
    reason,
    ...makeHostProtocolErrorCommonInput(
      "InvalidArgument",
      `invalid argument ${field}: ${reason}`,
      operation
    )
  })

export const makeHostProtocolInvalidOutputError = (
  method: string,
  reason: string
): HostProtocolInvalidOutputError =>
  new HostProtocolInvalidOutputError({
    tag: "InvalidOutput",
    method,
    reason,
    ...makeHostProtocolErrorCommonInput(
      "InvalidOutput",
      `invalid output from ${method}: ${reason}`,
      method
    )
  })

export const makeHostProtocolOriginInvalidError = (
  operation: string,
  message: string = "renderer origin is invalid"
): HostProtocolOriginInvalidError =>
  new HostProtocolOriginInvalidError({
    tag: "OriginInvalid",
    ...makeHostProtocolErrorCommonInput("OriginInvalid", message, operation)
  })

export const makeHostProtocolHostUnavailableError = (
  operation: string
): HostProtocolHostUnavailableError =>
  new HostProtocolHostUnavailableError({
    tag: "HostUnavailable",
    ...makeHostProtocolErrorCommonInput("HostUnavailable", "host is unavailable", operation)
  })

export const makeHostProtocolFrameTooLargeError = (
  sizeBytes: number,
  limitBytes: number,
  operation: string
): HostProtocolFrameTooLargeError =>
  new HostProtocolFrameTooLargeError({
    tag: "FrameTooLarge",
    sizeBytes,
    limitBytes,
    ...makeHostProtocolErrorCommonInput(
      "FrameTooLarge",
      `frame size ${sizeBytes} exceeds limit ${limitBytes}`,
      operation
    )
  })

export const makeHostProtocolBinaryDecodeError = (
  reason: string,
  operation: string
): HostProtocolBinaryDecodeError =>
  new HostProtocolBinaryDecodeError({
    tag: "BinaryDecodeError",
    reason,
    ...makeHostProtocolErrorCommonInput(
      "BinaryDecodeError",
      `binary frame decode failed: ${reason}`,
      operation
    )
  })

export const makeHostProtocolInvalidStateError = (
  current: string,
  attempted: string,
  operation: string
): HostProtocolInvalidStateError =>
  new HostProtocolInvalidStateError({
    tag: "InvalidState",
    current,
    attempted,
    ...makeHostProtocolErrorCommonInput(
      "InvalidState",
      `invalid state: current ${current}; attempted ${attempted}`,
      operation
    )
  })

export const makeHostProtocolNotFoundError = (
  resource: string,
  operation: string
): HostProtocolNotFoundError =>
  new HostProtocolNotFoundError({
    tag: "NotFound",
    resource,
    ...makeHostProtocolErrorCommonInput("NotFound", `resource not found: ${resource}`, operation)
  })

export class ResumeTicket extends Schema.Class<ResumeTicket>("ResumeTicket")({
  windowId: Schema.String,
  originTokenHash: Schema.String,
  resumeNonce: Schema.String,
  expiresAt: UInt,
  lastStreamCursors: StringRecord
}) {}

export class RendererDisconnectedPayload extends Schema.Class<RendererDisconnectedPayload>(
  "RendererDisconnectedPayload"
)({
  windowId: Schema.String,
  resumeTicket: ResumeTicket
}) {}

export class RendererResumePayload extends Schema.Class<RendererResumePayload>(
  "RendererResumePayload"
)({
  windowId: Schema.String,
  resumeNonce: Schema.String,
  cursors: StringRecord
}) {}

export class RendererResumedPayload extends Schema.Class<RendererResumedPayload>(
  "RendererResumedPayload"
)({
  windowId: Schema.String,
  replayedStreamIds: Schema.Array(Schema.String)
}) {}

export const RendererResumeDeniedReason = Schema.Literals([
  "expired",
  "windowMismatch",
  "originInvalid",
  "backfillExhausted"
])

export type RendererResumeDeniedReason = typeof RendererResumeDeniedReason.Type

export class RendererResumeDeniedPayload extends Schema.Class<RendererResumeDeniedPayload>(
  "RendererResumeDeniedPayload"
)({
  windowId: Schema.String,
  reason: RendererResumeDeniedReason,
  message: Schema.String
}) {}

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

const decodeUnknownHostProtocolEnvelope = Schema.decodeUnknownSync(HostProtocolEnvelope)
const encodeHostProtocolEnvelopeSync = Schema.encodeSync(HostProtocolEnvelope)

export const decodeHostProtocolEnvelope = (input: unknown): HostProtocolEnvelope =>
  decodeUnknownHostProtocolEnvelope(input, StrictParseOptions)

export const encodeHostProtocolEnvelope = (input: HostProtocolEnvelope) =>
  encodeHostProtocolEnvelopeSync(input, StrictParseOptions)

export interface DesktopTransportSend {
  readonly send: (envelope: HostProtocolEnvelope) => Effect.Effect<void>
}

export interface DesktopTransportRun {
  readonly run: (
    onEnvelope: (envelope: HostProtocolEnvelope) => Effect.Effect<void>
  ) => Effect.Effect<never>
}

export interface DesktopProtocolOptions {
  readonly windowId?: string
  readonly originToken?: string
  readonly now?: () => number
  readonly nextTraceId?: () => string
}

interface ResolvedDesktopProtocolOptions {
  readonly windowId: string
  readonly originToken: string
  readonly now: () => number
  readonly nextTraceId: () => string
}

const resolveProtocolOptions = (
  options: DesktopProtocolOptions
): ResolvedDesktopProtocolOptions => ({
  windowId: options.windowId ?? "",
  originToken: options.originToken ?? "",
  now: options.now ?? Date.now,
  nextTraceId: options.nextTraceId ?? (() => `trace-${globalThis.crypto.randomUUID()}`)
})

type ClientWriteFn = (
  clientId: number,
  response: RpcMessage.FromServerEncoded
) => Effect.Effect<void>

type ServerWriteFn = (clientId: number, data: RpcMessage.FromClientEncoded) => Effect.Effect<void>

const isHostProtocolError = (value: unknown): value is HostProtocolError => {
  if (typeof value !== "object" || value === null) {
    return false
  }
  const tag = (value as { tag?: unknown }).tag
  return typeof tag === "string" && HOST_PROTOCOL_ERROR_TAGS.has(tag)
}

const HOST_PROTOCOL_ERROR_TAGS: ReadonlySet<string> = new Set(
  HOST_PROTOCOL_ERROR_SPECS.map((spec) => spec.tag)
)

const formatDefect = (defect: unknown): string => {
  if (defect instanceof Error) {
    return defect.message
  }
  if (typeof defect === "string") {
    return defect
  }
  try {
    return JSON.stringify(defect)
  } catch {
    return String(defect)
  }
}

export const makeHostProtocolInternalError = (
  message: string,
  operation: string
): HostProtocolError =>
  new HostProtocolInternalError({
    tag: "Internal",
    message,
    operation,
    recoverable: false
  })

const encodeCauseAsHostProtocolError = (
  cause: ReadonlyArray<{
    readonly _tag: string
    readonly error?: unknown
    readonly defect?: unknown
  }>,
  operation: string,
  options: ResolvedDesktopProtocolOptions
): HostProtocolError => {
  void options
  const failure = cause.find((entry) => entry._tag === "Fail")
  if (failure !== undefined) {
    if (isHostProtocolError(failure.error)) {
      return failure.error
    }
    return makeHostProtocolInternalError(formatDefect(failure.error), operation)
  }
  const die = cause.find((entry) => entry._tag === "Die")
  if (die !== undefined) {
    return makeHostProtocolInternalError(formatDefect(die.defect ?? die.error), operation)
  }
  const interrupt = cause.find((entry) => entry._tag === "Interrupt")
  if (interrupt !== undefined) {
    return makeHostProtocolInternalError("interrupted", operation)
  }
  return makeHostProtocolInternalError("unknown failure", operation)
}

export const makeDesktopClientProtocol = (
  transport: DesktopTransportSend & DesktopTransportRun,
  options: DesktopProtocolOptions = {}
): Effect.Effect<RpcClient.Protocol["Service"], never, Scope.Scope> =>
  Effect.gen(function* () {
    const resolved = resolveProtocolOptions(options)

    let writeToClient: ClientWriteFn = (_clientId, _response) => Effect.void

    const protocol = yield* RpcClient.Protocol.make((write, _clientIds) => {
      writeToClient = write
      return Effect.succeed({
        send: (
          _clientId: number,
          request: RpcMessage.FromClientEncoded
        ): Effect.Effect<void, RpcClientError.RpcClientError> => {
          if (request._tag === "Request") {
            const fields: {
              kind: "request"
              id: string
              method: string
              timestamp: number
              traceId: string
              windowId?: string
              originToken?: string
              payload?: unknown
            } = {
              kind: "request",
              id: request.id,
              method: request.tag,
              timestamp: resolved.now(),
              traceId: request.traceId ?? resolved.nextTraceId()
            }
            if (resolved.windowId !== "") fields.windowId = resolved.windowId
            if (resolved.originToken !== "") fields.originToken = resolved.originToken
            if (request.payload !== undefined) fields.payload = request.payload
            return transport.send(new HostProtocolRequestEnvelope(fields)) as Effect.Effect<
              void,
              RpcClientError.RpcClientError
            >
          }
          if (request._tag === "Interrupt") {
            return transport.send(
              new HostProtocolCancelByRequestEnvelope({
                kind: "cancel",
                id: request.requestId,
                timestamp: resolved.now(),
                traceId: resolved.nextTraceId()
              })
            ) as Effect.Effect<void, RpcClientError.RpcClientError>
          }
          return Effect.void
        },
        supportsAck: false,
        supportsTransferables: false
      })
    })

    yield* Effect.forkScoped(
      transport.run((envelope) => {
        if (envelope.kind === "response") {
          const msg: RpcMessage.FromServerEncoded =
            envelope.error !== undefined
              ? {
                  _tag: "Exit",
                  requestId: envelope.id,
                  exit: { _tag: "Failure", cause: [{ _tag: "Fail", error: envelope.error }] }
                }
              : {
                  _tag: "Exit",
                  requestId: envelope.id,
                  exit: { _tag: "Success", value: envelope.payload }
                }
          return writeToClient(0, msg)
        }
        if (envelope.kind === "stream" && envelope.id !== undefined) {
          if (envelope.error !== undefined) {
            const failure: RpcMessage.FromServerEncoded = {
              _tag: "Exit",
              requestId: envelope.id,
              exit: {
                _tag: "Failure",
                cause: [{ _tag: "Fail", error: envelope.error }]
              }
            }
            return writeToClient(0, failure)
          }
          const chunk: RpcMessage.FromServerEncoded = {
            _tag: "Chunk",
            requestId: envelope.id,
            values: [envelope.payload] as readonly [unknown]
          }
          return writeToClient(0, chunk)
        }
        return Effect.void
      })
    )

    return protocol
  })

export const makeDesktopServerProtocol = (
  transport: DesktopTransportSend & DesktopTransportRun,
  options: DesktopProtocolOptions = {}
): Effect.Effect<RpcServer.Protocol["Service"], never, Scope.Scope> =>
  Effect.gen(function* () {
    const resolved = resolveProtocolOptions(options)
    const disconnects = yield* Queue.unbounded<number>()

    let writeToServer: ServerWriteFn = (_clientId, _data) => Effect.void

    const protocol = yield* RpcServer.Protocol.make((write) => {
      writeToServer = write
      return Effect.succeed({
        disconnects: Queue.asDequeue(disconnects),
        send: (_clientId: number, response: RpcMessage.FromServerEncoded): Effect.Effect<void> => {
          if (response._tag === "Exit") {
            const exit = response.exit
            const fields: {
              kind: "response"
              id: string
              timestamp: number
              traceId: string
              payload?: unknown
              error?: HostProtocolError
            } = {
              kind: "response",
              id: response.requestId,
              timestamp: resolved.now(),
              traceId: resolved.nextTraceId()
            }
            if (exit._tag === "Success") {
              fields.payload = exit.value
            } else {
              fields.error = encodeCauseAsHostProtocolError(
                exit.cause,
                response.requestId,
                resolved
              )
            }
            return transport.send(new HostProtocolResponseEnvelope(fields))
          }
          if (response._tag === "Chunk") {
            if (response.values.length === 0) {
              return Effect.void
            }
            return Effect.forEach(
              response.values,
              (value) =>
                transport.send(
                  new HostProtocolStreamByRequestEnvelope({
                    kind: "stream",
                    id: response.requestId,
                    timestamp: resolved.now(),
                    traceId: resolved.nextTraceId(),
                    payload: value
                  })
                ),
              { discard: true }
            )
          }
          return Effect.void
        },
        end: (_clientId: number): Effect.Effect<void> => Effect.void,
        clientIds: Effect.succeed(new Set<number>([0])),
        initialMessage: Effect.succeed(Option.none()),
        supportsAck: false,
        supportsTransferables: false,
        supportsSpanPropagation: false
      })
    })

    yield* Effect.forkScoped(
      transport.run((envelope) => {
        if (envelope.kind === "request") {
          const request: RpcMessage.FromClientEncoded = {
            _tag: "Request",
            id: envelope.id,
            tag: envelope.method,
            payload: envelope.payload,
            headers: [],
            traceId: envelope.traceId
          }
          return writeToServer(0, request)
        }
        if (envelope.kind === "cancel" && typeof envelope.id === "string") {
          const interrupt: RpcMessage.FromClientEncoded = {
            _tag: "Interrupt",
            requestId: envelope.id
          }
          return writeToServer(0, interrupt)
        }
        return Effect.void
      })
    )

    return protocol
  })
