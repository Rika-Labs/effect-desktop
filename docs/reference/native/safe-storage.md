---
title: SafeStorage (native)
description: Platform credential store as raw encrypt/decrypt bytes.
kind: reference
audience: app-developers
effect_version: 4
---

# `SafeStorage`

Lower-level encryption boundary backed by the platform credential store. Most apps use [`Secrets`](../services/secrets.md) instead, which adds permission checks, redaction, and auditing on top.

## Methods

| Method | Payload | Success |
| --- | --- | --- |
| `encrypt` | `{ plaintext: Uint8Array }` | `{ ciphertext: Uint8Array }` |
| `decrypt` | `{ ciphertext: Uint8Array }` | `{ plaintext: Uint8Array }` |

## Helpers

- `makeSecretBytes(array)`, `makeSecretBytesFromUtf8(string)`, `unsafeSecretBytes(bytes)`, `wipeSecretBytes(bytes)`.

## Errors

`SafeStorageError`.

## When to use SafeStorage directly

- You're storing the encrypted bytes off-platform (sync server).
- You need raw control over the encryption boundary.

For everything else, use `Secrets`.

## Related

- Reference: [`Secrets`](../services/secrets.md)
- Explanation: [Audit and redaction](../../explanation/audit-and-redaction.md)
- Source: [`packages/native/src/safe-storage.ts`](../../../packages/native/src/safe-storage.ts)
