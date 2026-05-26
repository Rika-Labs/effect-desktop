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
| `list`   | `(namespace) => Effect<readonly string[]>`             |

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

`makeSecrets(safeStorageApi, options)` returns an Effect that builds the service value. `SecretsLayer(options)` provides `Secrets` from a `SecretsSafeStorage` service.

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
