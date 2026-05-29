---
title: Secrets
description: App-level facade over SafeStorage with redacted byte handling.
kind: reference
audience: app-developers
effect_version: 4
---

# `Secrets`

App-level facade over `SafeStorage`. Bytes ride as `Redacted<Uint8Array>` so they can't accidentally hit logs.

Current host status: native `SafeStorage` routes `set`, `get`, `list`, `delete`, and `isAvailable` through the platform credential store on supported hosts. `Secrets` probes availability before each storage operation; unavailable or unsupported storage fails loudly as `StorageUnavailable`, and there is no plaintext fallback.

## Import

```ts
import {
  Secrets,
  SecretsLayer,
  SecretsSafeStorage,
  makeSecrets,
  makeSecretBytes,
  makeSecretBytesFromUtf8,
  unsafeSecretBytes,
  wipeSecretBytes,
  type SecretsApi,
  type SecretsError,
  type SecretsOptions,
  type SecretsPermissionPolicy,
  type SecretsSafeStorageApi,
  type SecretBytes,
  SecretNotFoundError,
  SecretsPermissionDeniedError,
  SecretsInvalidArgumentError,
  SecretsSafeStorageUnavailableError,
  SecretsAuditFailedError,
  SecretsCommittedAuditFailedError
} from "@orika/core"
```

## API

| Method   | Signature                                                            |
| -------- | -------------------------------------------------------------------- |
| `set`    | `(namespace, key, value: SecretBytes) => Effect<void, SecretsError>` |
| `get`    | `(namespace, key) => Effect<SecretBytes, SecretsError>`              |
| `delete` | `(namespace, key) => Effect<void, SecretsError>`                     |
| `list`   | `(namespace) => Effect<readonly string[], SecretsError>`             |

Storage keys are derived as `appId/namespace/key`; `list` filters the underlying `SafeStorage.list()` to the requested namespace and returns the unprefixed keys, sorted.

## Byte helpers

- `makeSecretBytes(array)` — wrap a `Uint8Array` as `Redacted<Uint8Array>`.
- `makeSecretBytesFromUtf8(string)` — encode a string as UTF-8 bytes and wrap.
- `unsafeSecretBytes(bytes)` — returns a copy of the underlying bytes (via `Redacted.value(...)`); mutating it does not affect the stored secret.
- `wipeSecretBytes(secret) => Effect<void>` — returns an Effect that zeroes the underlying buffer and wipes the `Redacted` value when run; must be yielded.

## Errors

`SecretsError` is the union of:

- `SecretNotFoundError` (`_tag: "SecretNotFound"`) — `get`/`delete` against a missing key.
- `SecretsPermissionDeniedError` (`_tag: "PermissionDenied"`) — namespace not in the configured `secrets.read`/`secrets.write` policy, or the safe-storage backend returned permission denied.
- `SecretsInvalidArgumentError` (`_tag: "InvalidArgument"`) — empty `appId`/`namespace`/`key`, illegal characters (`[A-Za-z0-9._-]+` is the allowed pattern), or empty `traceId`.
- `SecretsSafeStorageUnavailableError` (`_tag: "SafeStorageUnavailable"`) — backend reported `isAvailable: false`, or surfaced `Unsupported`.
- `SecretsAuditFailedError` (`_tag: "SecretsAuditFailed"`) — pre-commit audit emit failed.
- `SecretsCommittedAuditFailedError` (`_tag: "SecretsCommittedAuditFailed"`) — `set`/`delete` already mutated storage but the success audit could not be written.
- `HostProtocolError` — any unhandled bridge failure forwarded from `SafeStorage`.

## Permissions

Each call checks `secrets.read` (`get`, `list`) or `secrets.write` (`set`, `delete`) against the configured `SecretsPermissionPolicy`. Each policy field accepts an array of allowed namespaces, with `"*"` matching every namespace.

## Audit

Every operation emits a `secrets-accessed` audit event with `operation`, `namespace`, `key` (when present), and `outcome` (`"ok"`, `"denied"`, `"error"`) — never the value. A non-fatal audit failure on a pre-check is logged as a warning and ignored; a post-commit audit failure becomes `SecretsCommittedAuditFailedError` so the caller knows storage and audit diverged.

## Layer

`makeSecrets(safeStorageApi, options)` returns an Effect that builds the `SecretsApi`. `SecretsLayer(options)` provides `Secrets` from the `SecretsSafeStorage` context service. `SecretsOptions` carries:

- `appId: string` (required, validated like a namespace).
- `permissions?: { read?: string[]; write?: string[] }`.
- `audit?: AuditEventsApi` (optional emitter).
- `traceId?: () => string` (defaults to `crypto.randomUUID`).

## Example

```ts
const secrets = yield * Secrets
yield * secrets.set("tokens", "github", makeSecretBytesFromUtf8("ghp_..."))

const stored = yield * secrets.get("tokens", "github")
const text = new TextDecoder().decode(Redacted.value(stored))
yield * wipeSecretBytes(stored)
```

## Test layer

`makeMemorySecretsSafeStorage(options)` from `@orika/test`.

## Related

- How-to: [Store secrets safely](../../how-to/store-secrets.md)
- Explanation: [Audit and redaction](../../explanation/audit-and-redaction.md)
- Reference: [`SafeStorage`](../native/safe-storage.md), [`AuditEvents`](audit-events.md)
- Source: [`packages/core/src/runtime/secrets.ts`](../../../packages/core/src/runtime/secrets.ts)
