import {
  HostProtocolError as HostProtocolErrorSchema,
  type HostProtocolError
} from "@effect-desktop/bridge"
import { Context, Effect, Layer, Schema } from "effect"

export const NativeBoundaryErrorReason = Schema.Literals([
  "denied",
  "unsupported",
  "missing-host-method",
  "invalid-input",
  "invalid-output",
  "host-failed"
])

export type NativeBoundaryErrorReason = Schema.Schema.Type<typeof NativeBoundaryErrorReason>

export class NativeBoundaryError extends Schema.TaggedErrorClass<NativeBoundaryError>()(
  "NativeBoundaryError",
  {
    reason: NativeBoundaryErrorReason,
    hostTag: Schema.NonEmptyString,
    operation: Schema.NonEmptyString,
    message: Schema.String,
    recoverable: Schema.Boolean,
    platform: Schema.optionalKey(Schema.Literals(["macos", "windows", "linux"])),
    method: Schema.optionalKey(Schema.NonEmptyString),
    cause: Schema.optionalKey(HostProtocolErrorSchema)
  }
) {}

export interface NativeBoundaryErrorsApi {
  readonly classify: (error: HostProtocolError) => Effect.Effect<NativeBoundaryError, never, never>
  readonly decode: (
    input: unknown
  ) => Effect.Effect<NativeBoundaryError, NativeBoundaryError, never>
  readonly encode: (
    error: NativeBoundaryError
  ) => Effect.Effect<unknown, NativeBoundaryError, never>
  readonly normalize: <A, R>(
    effect: Effect.Effect<A, HostProtocolError, R>
  ) => Effect.Effect<A, NativeBoundaryError, R>
}

export class NativeBoundaryErrors extends Context.Service<
  NativeBoundaryErrors,
  NativeBoundaryErrorsApi
>()("@effect-desktop/native/native-boundary-error/NativeBoundaryErrors") {}

export const classifyNativeBoundaryError = (error: HostProtocolError): NativeBoundaryError =>
  new NativeBoundaryError({
    reason: nativeBoundaryReason(error),
    hostTag: error.tag,
    operation: error.operation,
    message: error.message,
    recoverable: error.recoverable,
    ...(error.platform === undefined ? {} : { platform: error.platform }),
    ...("method" in error ? { method: error.method } : {}),
    cause: error
  })

export const normalizeNativeBoundaryEffect = <A, R>(
  effect: Effect.Effect<A, HostProtocolError, R>
): Effect.Effect<A, NativeBoundaryError, R> =>
  effect.pipe(Effect.mapError(classifyNativeBoundaryError))

export const decodeNativeBoundaryError = (
  input: unknown
): Effect.Effect<NativeBoundaryError, NativeBoundaryError, never> =>
  Schema.decodeUnknownEffect(NativeBoundaryError)(input).pipe(
    Effect.mapError((error) =>
      nativeBoundaryCodecError("invalid-input", "NativeBoundaryError.decode", error)
    )
  )

export const encodeNativeBoundaryError = (
  error: NativeBoundaryError
): Effect.Effect<unknown, NativeBoundaryError, never> =>
  Schema.encodeUnknownEffect(NativeBoundaryError)(error).pipe(
    Effect.mapError((cause) =>
      nativeBoundaryCodecError("invalid-output", "NativeBoundaryError.encode", cause)
    )
  )

export const NativeBoundaryErrorsLive: Layer.Layer<NativeBoundaryErrors, never, never> =
  Layer.succeed(
    NativeBoundaryErrors,
    NativeBoundaryErrors.of({
      classify: (error) => Effect.succeed(classifyNativeBoundaryError(error)),
      decode: decodeNativeBoundaryError,
      encode: encodeNativeBoundaryError,
      normalize: normalizeNativeBoundaryEffect
    })
  )

const nativeBoundaryReason = (error: HostProtocolError): NativeBoundaryErrorReason => {
  switch (error.tag) {
    case "PermissionDenied":
    case "PermissionRevoked":
    case "OriginInvalid":
      return "denied"
    case "Unsupported":
      return "unsupported"
    case "MethodNotFound":
      return "missing-host-method"
    case "InvalidArgument":
    case "FrameTooLarge":
    case "BinaryDecodeError":
      return "invalid-input"
    case "InvalidOutput":
      return "invalid-output"
    case "FileNotFound":
    case "Timeout":
    case "Cancelled":
    case "ResourceBusy":
    case "DiskFull":
    case "RateLimited":
    case "StaleHandle":
    case "CrossScopeHandle":
    case "BackpressureOverflow":
    case "RendererDisconnected":
    case "RuntimeRestarted":
    case "RuntimeUnavailable":
    case "HostUnavailable":
    case "StreamClosed":
    case "ReconnectBackfillExhausted":
    case "PanicInNativeCode":
    case "NetworkError":
    case "NotFound":
    case "AlreadyExists":
    case "InvalidState":
    case "SymlinkEscapesRoot":
    case "EventLogFull":
    case "UpdateDowngradeRefused":
    case "UpdateDownloadTruncated":
    case "UpdateStaleNotarization":
    case "SettingsMigrationFailed":
    case "SettingsRecoveredFromBackup":
    case "EventLogSegmentCorrupt":
    case "PtyForceKillTimeout":
    case "Internal":
      return "host-failed"
  }
}

const nativeBoundaryCodecError = (
  reason: Extract<NativeBoundaryErrorReason, "invalid-input" | "invalid-output">,
  operation: string,
  cause: unknown
): NativeBoundaryError =>
  new NativeBoundaryError({
    reason,
    hostTag: reason === "invalid-input" ? "InvalidArgument" : "InvalidOutput",
    operation,
    message: formatUnknownError(cause),
    recoverable: false
  })

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}
