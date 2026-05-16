---
title: Errors catalog
description: Every typed failure the framework emits, what it means, and how to recover.
kind: reference
audience: app-developers
effect_version: 4
---

# Errors catalog

Every effectful surface in Effect Desktop returns failures as **typed values**, not thrown exceptions. Application code matches on `_tag` to discriminate. This page lists the framework's error families.

## Import

Most errors come from the package that owns the operation. The bridge re-exports the cross-package ones:

```ts
import { HostProtocolError } from "@effect-desktop/bridge"
import { WindowError } from "@effect-desktop/native"
import { PermissionDeniedError, SecretsError } from "@effect-desktop/core"
```

## Bridge / host protocol

`HostProtocolError` is the union of failures the bridge can return on any RPC:

- `HostProtocolInvalidArgumentError` — payload didn't decode against the schema.
- `HostProtocolInvalidOutputError` — runtime returned something the schema doesn't accept.
- `HostProtocolNotFoundError` — method has no registered handler.
- `HostProtocolUnsupportedError` — operation isn't supported on this platform.
- `HostProtocolStateError` — protocol state violation (e.g. response without request).

All carry `recoverable: boolean` to indicate whether retry has any chance.

## Permission registry

- `PermissionDeniedError` — capability did not match an allow declaration.
- `PermissionInvalidArgumentError` — capability was malformed.
- `PermissionGrantNotFoundError` — `use(grant)` referred to an unknown grant.
- `PermissionRevokedError` — grant was revoked between check and use.

## Approval broker

- `ApprovalBrokerError.QueueOverflow` — per-actor queue full.
- `ApprovalBrokerError.PortError` — `ApprovalPromptPort` failed.
- `ApprovalBrokerError.Canceled` — request canceled before resolution.

## Resources

- `ResourceLeakError` — a test detected unreleased resources at scope close.

## Filesystem

- `FilesystemPermissionDenied` — path not under a declared root.
- `FilesystemInvalidArgument` — malformed path or parameters.
- `FilesystemSystemError` — OS-level failure (carries `errno` when available).

## Process

Process failures arrive as `HostProtocolError` on the operation that produced them — `spawn`, `kill`, `stdin.write`, `stdout` reads. Non-zero exit codes are not failures; they're carried in `ProcessExitStatus.code`.

## PTY

PTY failures are also `HostProtocolError`. `open`, `write`, `resize`, `signal`, `close` each fail with typed reasons.

## Worker

- `CapabilityNotHeld` — declared capability has no matching permission.
- `ChannelError` — message did not validate against `inputSchema` or `outputSchema`.
- `WorkerCrashed` — worker terminated unexpectedly. Carries last error if available.

## Settings

- `SettingsError.InvalidArgument` — malformed key, schema, or path.
- `SettingsError.SchemaMismatch` — stored value didn't decode against the schema.
- `SettingsError.MigrationFailed` — a migration callback errored.
- `SettingsError.Corrupt` — database file unreadable.
- `SettingsRecoveredFromBackup` — informational; backup was used.
- `SettingsMigrated` — informational; migration applied.

## Secrets

- `SecretsError.NotFound` — no value at `(namespace, key)`.
- `SecretsError.PermissionDenied` — capability not declared.
- `SecretsError.InvalidArgument` — malformed namespace or key.
- `SecretsError.StorageUnavailable` — platform safe-storage unavailable.

## SQLite

- `SqlError` from `@effect/sql-sqlite-bun` — pass-through SQL errors with statement and bind context.

## CLI

Each command exports its own pipeline error union — see [CLI reference](cli.md).

## Documentation gate

- `DocsGateFileError` — manifest or page unreadable.
- `DocsGateManifestError` — manifest schema/content invalid.
- `DocsGateMissingPageError` — required page absent or empty.
- `DocsGateExampleFailedError` — runnable block failed or timed out.
- `DocsGateCoverageError` — required token missing from a page's runnable block.

## Patterns

### Match exhaustively

```ts
.pipe(
  Effect.catchTag("PermissionDenied", (err) =>
    showPermissionPrompt(err.capability)
  ),
  Effect.catchTag("FilesystemSystemError", (err) =>
    showFilesystemError(err.message)
  )
)
```

### Recover for one tag

```ts
.pipe(
  Effect.catchTag("HostProtocolUnsupportedError", () => Effect.succeed(fallback))
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
