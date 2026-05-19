---
title: SafeStorage (native)
description: Platform credential store primitive for scoped secret bytes.
kind: reference
audience: app-developers
effect_version: 4
---

# `SafeStorage`

Lower-level credential-store boundary for scoped secret bytes. Most apps use [`Secrets`](../services/secrets.md) instead, which adds namespace permissions, redaction, key derivation, and auditing on top.

The native host stores secret bytes in the platform credential store through
macOS Keychain, Windows Credential Manager, and Linux Secret Service. If the
credential store is locked, absent, or denied by the OS, `isAvailable` returns
`false` and secret operations fail loudly as typed host errors. There is no
plaintext fallback.

SafeStorage is not an HTTP auth credential broker. Proxy credentials,
authentication challenges, and certificate decisions are absent; adding them
would require a new network-auth service and host adapter.

## Methods

| Method        | Payload                              | Success                  |
| ------------- | ------------------------------------ | ------------------------ |
| `set`         | `{ key: string, value: Uint8Array }` | `void`                   |
| `get`         | `{ key: string }`                    | `{ value: Uint8Array }`  |
| `delete`      | `{ key: string }`                    | `void`                   |
| `list`        | `void`                               | `{ keys: string[] }`     |
| `isAvailable` | `void`                               | `{ available: boolean }` |

## Helpers

- `makeSecretBytes(array)`, `makeSecretBytesFromUtf8(string)`, `unsafeSecretBytes(bytes)`, `wipeSecretBytes(bytes)`.

## Errors

`SafeStorageError`.

## When to use SafeStorage directly

- You are implementing a framework service that already owns namespace permissions and audit events.
- You need the raw credential-store key/value primitive instead of the app-facing `Secrets` facade.

For everything else, use `Secrets`.

## Related

- Reference: [`Secrets`](../services/secrets.md)
- Explanation: [Audit and redaction](../../explanation/audit-and-redaction.md)
- Source: [`packages/native/src/safe-storage.ts`](../../../packages/native/src/safe-storage.ts)
