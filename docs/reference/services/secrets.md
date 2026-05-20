---
title: Secrets
description: App-level facade over SafeStorage with redacted byte handling.
kind: reference
audience: app-developers
effect_version: 4
---

# `Secrets`

App-level facade over `SafeStorage`. Bytes ride as `Redacted<Uint8Array>` so they can't accidentally hit logs.

Current host status: native `SafeStorage` only routes availability probing. Secret read/write/list/delete calls require a provided test or platform storage layer until the macOS, Windows, and Linux host adapters exist. Missing storage fails as `StorageUnavailable`; there is no plaintext fallback.

## Import

```ts
import {
  Secrets,
  type SecretsApi,
  SecretsError,
  type SecretBytes,
  makeSecretBytes,
  makeSecretBytesFromUtf8,
  unsafeSecretBytes,
  wipeSecretBytes,
  makeSecrets
} from "@orika/core"
```

## API

| Method   | Signature                                              |
| -------- | ------------------------------------------------------ |
| `set`    | `(namespace, key, value: SecretBytes) => Effect<void>` |
| `get`    | `(namespace, key) => Effect<SecretBytes>`              |
| `delete` | `(namespace, key) => Effect<void>`                     |
| `list`   | `(namespace) => Effect<{ namespace, key }[]>`          |

Storage keys are derived as `appId/namespace/key`.

## Byte helpers

- `makeSecretBytes(array)` — wrap a `Uint8Array`.
- `makeSecretBytesFromUtf8(string)` — encode a string as UTF-8 bytes.
- `unsafeSecretBytes(bytes)` — `Redacted.value(...)` shortcut for tests.
- `wipeSecretBytes(bytes)` — zero the buffer.

## Errors

- `SecretsError.NotFound`, `PermissionDenied`, `InvalidArgument`, `StorageUnavailable`.

## Permissions

Each call checks `secrets.read` or `secrets.write` for the namespace.

## Audit

Every successful operation writes a `secret/accessed` audit event with namespace, key, and outcome — never the value.

## Layer

`makeSecrets(safeStorageApi, options)` returns the layer. Depends on `PermissionRegistry` and `AuditEvents`.

## Example

```ts
const secrets = yield * Secrets
yield * secrets.set("tokens", "github", makeSecretBytesFromUtf8("ghp_..."))

const stored = yield * secrets.get("tokens", "github")
const bytes = Redacted.value(stored)
const text = new TextDecoder().decode(bytes)
wipeSecretBytes(bytes)
```

## Test layer

`makeMemorySecretsSafeStorage(options)` from `@orika/test`.

## Related

- How-to: [Store secrets safely](../../how-to/store-secrets.md)
- Explanation: [Audit and redaction](../../explanation/audit-and-redaction.md)
- Reference: [`SafeStorage`](../native/safe-storage.md), [`AuditEvents`](audit-events.md)
- Source: [`packages/core/src/runtime/secrets.ts`](../../../packages/core/src/runtime/secrets.ts)
