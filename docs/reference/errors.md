---
title: Errors catalog
description: Every typed failure the framework emits, what it means, and how to recover.
kind: reference
audience: app-developers
effect_version: 4
---

# Errors catalog

Every effectful surface in ORIKA returns failures as **typed values**, not thrown exceptions. Application code matches on `_tag` to discriminate. This page lists the framework's tagged error classes by source package.

## Import

Errors live in the package that owns the operation:

```ts
import { HostProtocolError } from "@orika/bridge"
import { NativeBoundaryError } from "@orika/native"
import {
  ApprovalBrokerInvalidArgumentError,
  ApprovalBrokerQueueOverflowError,
  PermissionDeniedError,
  SecretNotFoundError,
  SettingsKvError
} from "@orika/core"
```

## Bridge / host protocol — `@orika/bridge`

`HostProtocolError` is a `Schema.Union` of every failure the host bridge can return on any RPC. Each variant is a `Schema.Class` with a `tag` literal and `recoverable: boolean`:

- `FileNotFound`
- `PermissionDenied`
- `Timeout`
- `Cancelled`
- `Unsupported`
- `InvalidArgument`
- `ResourceBusy`
- `DiskFull`
- `RateLimited`
- `FrameTooLarge`
- `OriginInvalid`
- `StaleHandle`
- `CrossScopeHandle`
- `BackpressureOverflow`
- `RendererDisconnected`
- `RuntimeRestarted`
- `RuntimeUnavailable`
- `HostUnavailable`
- `MethodNotFound`
- `InvalidOutput`
- `PermissionRevoked`
- `StreamClosed`
- `BinaryDecodeError`
- `ReconnectBackfillExhausted`
- `PanicInNativeCode`
- `NetworkError`
- `NotFound`
- `AlreadyExists`
- `InvalidState`
- `SymlinkEscapesRoot`
- `EventLogFull`
- `UpdateDowngradeRefused`
- `UpdateDownloadTruncated`
- `UpdateStaleNotarization`
- `UpdateSignatureInvalid`
- `SettingsMigrationFailed`
- `SettingsRecoveredFromBackup`
- `EventLogSegmentCorrupt`
- `PtyForceKillTimeout`
- `Internal`

Also exported: `InvalidBridgeMetadataError`.

## Native boundary — `@orika/native`

- `NativeBoundaryError` — closes over `HostProtocolError` at the native/TypeScript boundary with a `reason` of `denied | unsupported | missing-host-method | invalid-input | invalid-output | host-failed`. Use `NativeBoundaryErrors.normalize` to convert host errors to this shape.
- `NativeCapabilityLookupError`, `NativeCapabilityManifestError`, `UnsupportedCapability`.
- `WindowPersistenceError`.

## Desktop framework adapters — `@orika/core`

Surface errors raised by the framework adapter layer (React/Vue/Solid/Next/Astro):

- `MissingDesktopContextError` — provider not mounted around the component.
- `MissingDesktopRpcClientError` — renderer RPC client missing or malformed.
- `MissingDesktopRpcsError` — the requested `RpcGroup` is not in the manifest.
- `DuplicateDesktopRpcNameError` — two RPC tags lower to the same framework endpoint name.
- `RendererRpcError` — wraps an unknown RPC failure surfaced through a framework adapter.

## Permission registry — `@orika/core`

- `PermissionInvalidArgumentError` (`_tag: "InvalidArgument"`)
- `PermissionDeniedError` (`_tag: "PermissionDenied"`) — carries `reason: "explicit-deny" | "approval-denied" | "revoked" | "expired" | "consumed" | "default-deny"`.
- `PermissionAuditFailedError` (`_tag: "PermissionAuditFailed"`)
- `PermissionGrantNotFoundError` (`_tag: "PermissionGrantNotFound"`)
- `PermissionRevokedError` (`_tag: "PermissionRevoked"`)

## Approval broker — `@orika/core`

`ApprovalBrokerError` is the union of:

- `ApprovalBrokerInvalidArgumentError` (`_tag: "InvalidArgument"`)
- `ApprovalBrokerQueueOverflowError` (`_tag: "QueueOverflow"`)
- `ApprovalBrokerAuditFailedError` (`_tag: "ApprovalAuditFailed"`)
- `ApprovalBrokerPromptFailedError` (`_tag: "ApprovalPromptFailed"`)

## Filesystem — `@orika/core`

`FilesystemError` is a type alias for `HostProtocolError`. Match on the host protocol tags above (`PermissionDenied`, `InvalidArgument`, `FileNotFound`, `SymlinkEscapesRoot`, `DiskFull`, etc.) rather than filesystem-specific classes.

## Process and PTY — `@orika/core`

Process and PTY failures arrive as `HostProtocolError` on the failing operation. Non-zero exit codes are not failures; they ride on the result payload.

## Worker — `@orika/core`

`WorkerError` is the union of:

- `WorkerChannelError` (`_tag: "ChannelError"`)
- `WorkerCapabilityNotHeldError` (`_tag: "CapabilityNotHeld"`)
- `WorkerCrashedError` (`_tag: "WorkerCrashed"`)
- `WorkerInvalidArgumentError` (`_tag: "InvalidArgument"`)
- `WorkerResourceBusyError` (`_tag: "ResourceBusy"`)
- `WorkerStaleHandleError` (`_tag: "StaleHandle"`)
- `WorkerUnsupportedError` (`_tag: "Unsupported"`)

## Settings — `@orika/core`

`SettingsError` is the union of:

- `SettingsInvalidArgumentError` (`_tag: "InvalidArgument"`)
- `SettingsKvError` (`_tag: "KvError"`)
- `SettingsMigrationFailedError` (`_tag: "SettingsMigrationFailed"`)
- `SettingsRecoveredFromBackupError` (`_tag: "SettingsRecoveredFromBackup"`)

`SettingsMigrated` is a schema class describing a successful migration record, not an error.

## Secrets — `@orika/core`

`SecretsError` is the union of:

- `SecretNotFoundError` (`_tag: "SecretNotFound"`)
- `SecretsSafeStorageUnavailableError` (`_tag: "SafeStorageUnavailable"`)
- `SecretsPermissionDeniedError` (`_tag: "PermissionDenied"`)
- `SecretsInvalidArgumentError` (`_tag: "InvalidArgument"`)
- `SecretsAuditFailedError` (`_tag: "SecretsAuditFailed"`)
- `SecretsCommittedAuditFailedError` (`_tag: "SecretsCommittedAuditFailed"`)
- `HostProtocolError` (propagated)

## Commands — `@orika/core`

- `CommandRegistryInvalidInputError` (`_tag: "InvalidInput"`)
- `CommandRegistryCommandNotFoundError` (`_tag: "CommandNotFound"`)
- `CommandRegistryCommandAlreadyRegisteredError`
- `CommandRegistryRegistrationLostError` (`_tag: "RegistrationLost"`)
- `CommandRegistryHandlerFailureError` (`_tag: "HandlerFailure"`)
- `CommandRegistryAuditFailedError` (`_tag: "CommandAuditFailed"`)
- `CommandRegistryCommittedAuditFailedError`

## Resources, telemetry, transport, sidecar — `@orika/core`

- `ResourceInvalidArgumentError` (`_tag: "InvalidArgument"`)
- `ResourceOwnerInvalidArgumentError` (`_tag: "InvalidArgument"`)
- `TelemetryInvalidArgumentError` (`_tag: "InvalidArgument"`)
- `SidecarError` (`_tag: "SidecarError"`)
- `ProviderRegistryError` (`_tag: "ProviderRegistryError"`)
- `DesktopObservabilityConfigError`, `DesktopConfigError`, `DesktopRpcSurfaceError`
- `InspectorSafetyPolicyInvalidArgumentError`, `InspectorTransportInvalidArgumentError`
- `SqliteInvalidArgumentError`
- `NativeParityMatrixError`

The following are not on the package root; import each from its deep `@orika/core/runtime/*` subpath:

- `@orika/core/runtime/transport`: `TransportInvalidArgumentError`, `TransportFrameTooLargeError`, `TransportFrameTruncatedError`, `TransportClosedError`, `TransportWriteError`, `TransportReadError`, `TransportCloseError`, `FrameTooLargeError`, `FrameTruncatedError`, `InvalidFrameLimitError`.
- `@orika/core/runtime/window-state`: `WindowStateReadFailed`, `WindowStateWriteFailed`, `WindowStateCorruptRenamed`, `WindowStateInvalidArgumentError`.
- `@orika/core/runtime/window-supervisor`: `StartupWindowConfigError`.
- `@orika/core/runtime/stdio-socket`: `StdoutWriteError`.
- `@orika/core/runtime/auto-save`: `AutoSaveError`.
- `@orika/core/runtime/workflows/restore`: `RestoreError`; `@orika/core/runtime/workflows/backup`: `BackupError`.

`SqlError` from `effect/unstable/sql/SqlError` (re-exported from `@orika/core`) is propagated as-is for SQL operations.

## Tests — `@orika/test`

- `ResourceLeakError` — a deterministic test detected unreleased resources at scope close.

## Config — `@orika/config`

- `ProductionCheckInvalidInput` (`_tag: "InvalidInput"`)
- `DesktopConfigDecodeError`

## CLI — `@orika/cli`

The CLI surfaces a number of pipeline error families. Major ones:

- Docs gate: `DocsGateFileError`, `DocsGateManifestError`, `DocsGateMissingPageError`, `DocsGateExampleFailedError`, `DocsGateCoverageError`.
- Doctor: `DoctorMissing`, `DoctorCapabilityTruthUnavailable`.
- Build: `BuildConfigError`, `BuildUnsupportedTargetError`, `BuildUnsupportedHostError`, `BuildCommandFailedError`, `BuildFileError`.
- Package: `PackageConfigError`, `PackageUnsupportedHostError`, `PackageUnsupportedTargetError`, `PackageUnsupportedArtifactError`, `PackageCommandFailedError`, `PackageMissingBuildArtifactError`, `PackageFileError`.
- Sign / notarize: `SignConfigError`, `SignUnsupportedHostError`, `SignUnsupportedTargetError`, `SignFileError`, `SignCommandFailedError`, `NotarizeConfigError`, `NotarizeUnsupportedHostError`, `NotarizeUnsupportedTargetError`, `NotarizeFileError`, `NotarizeCommandFailedError`.
- Publish / update manifest: `PublishConfigError`, `PublishFileError`, `PublishSignatureError`.
- Release: `ReleaseError`, `ReleaseGateFileError`, `ReleaseGateManifestError`, `ReleaseGateEvidenceError`, `ToolError`.
- Public API snapshot: `PublicApiFileError`, `PublicApiPackageError`, `PublicApiTypeScriptError`, `PublicApiSnapshotMismatchError`.
- Reproducible build: `ReproBuildRunError`, `ReproPackageRunError`, `ReproFileError`, `ReproDiffError`.
- Targets: `UnsupportedDesktopHostTargetError`, `UnsupportedDesktopTargetError`.
- Accessibility gate: `AccessibilityGateFileError`, `AccessibilityGateManifestError`, `AccessibilityGateEvidenceError`.
- Semver guard: `SemverGuardFileError`, `SemverGuardManifestError`, `SemverGuardPolicyError`.
- Streams: `CliStreamError`.

`CliUsageError` is a plain `Error` subclass used for argument validation before the typed pipeline takes over.

See the [CLI reference](cli.md) for which error union each subcommand returns.

## Devtools — `@orika/devtools`

- `DevtoolsInvalidInputError` (`_tag: "InvalidInput"`)
- `DevtoolsTokenError` (`_tag: "TokenError"`)
- `DevtoolsBindError` (`_tag: "BindError"`)
- `DevtoolsCleanupError` (`_tag: "CleanupError"`)
- `DevtoolsShellOpenError` (`_tag: "ShellOpenError"`)
- `DevtoolsUnsafeProductionCaptureError`
- `DevtoolsSnapshotSafetyError` (`_tag: "SnapshotSafetyError"`)
- `DevtoolsInvalidOptionError`
- `InspectorFixtureError`

## Patterns

### Match exhaustively

```ts
.pipe(
  Effect.catchTag("PermissionDenied", (err) =>
    showPermissionPrompt(err.capability)
  ),
  Effect.catchTag("FileNotFound", (err) =>
    showMissingFile(err.path)
  )
)
```

### Recover for one tag

```ts
.pipe(
  Effect.catchTag("Unsupported", () => Effect.succeed(fallback))
)
```

### Convert to a domain failure

```ts
.pipe(
  Effect.mapError(() => new MyDomainError({ reason: "load failed" }))
)
```

## Related

- Explanation: [Audit and redaction](../explanation/audit-and-redaction.md)
- Reference: every service page documents its specific errors
