---
title: How to store secrets safely
description: Use Secrets to handle redacted credentials without plaintext fallback.
kind: how-to
audience: app-developers
effect_version: 4
---

# How to store secrets safely

`Secrets` is the app-level facade over native `SafeStorage`. Secret bytes never enter logs because they ride as `Redacted<Uint8Array>`, every operation is permission-checked, and successful accesses write audit events without the value.

Current host status: native `SafeStorage` routes `set`, `get`, `list`, `delete`, and `isAvailable` through the platform credential store on supported hosts. If the credential store is unavailable, locked, denied, or unsupported on the current platform, `Secrets` fails loudly with `SecretsSafeStorageUnavailableError`; there is no silent plaintext fallback.

## 1. Declare the namespace permission

At app init:

```ts
import { PermissionRegistry } from "@orika/core"

const permissions = yield * PermissionRegistry
yield *
  permissions.declare(
    { kind: "secrets.read", namespaces: ["tokens"] },
    { effect: "allow", source: "app-init" }
  )
yield *
  permissions.declare(
    { kind: "secrets.write", namespaces: ["tokens"] },
    { effect: "allow", source: "app-init" }
  )
```

Without these declarations, `Secrets.get` and `Secrets.set` for the `tokens` namespace return `SecretsPermissionDeniedError`.

## 2. Write a secret

```ts
import { Effect } from "effect"
import { Secrets, makeSecretBytesFromUtf8 } from "@orika/core"

const program = Effect.gen(function* () {
  const secrets = yield* Secrets
  const token = makeSecretBytesFromUtf8("ghp_abc123def456")
  yield* secrets.set("tokens", "github", token)
})
```

`makeSecretBytesFromUtf8(string)` wraps the UTF-8 bytes in a `Redacted` container. The `Redacted` value's `toString` and `JSON.stringify` are `<redacted>` — there is no path to accidentally log it.

## 3. Read a secret

```ts
import { Redacted } from "effect"
import { wipeSecretBytes } from "@orika/core"

const program = Effect.gen(function* () {
  const secrets = yield* Secrets
  const stored = yield* secrets.get("tokens", "github")
  const bytes = Redacted.value(stored) // Uint8Array
  const text = new TextDecoder().decode(bytes)

  // ... use text ...

  wipeSecretBytes(bytes) // zero the buffer when done
})
```

`Redacted.value(...)` is the only way to access the underlying bytes. Wipe when you're done so the value isn't sitting in memory longer than necessary.

## 4. List or delete

```ts
const keys = yield * secrets.list("tokens")
// string[] of keys inside the "tokens" namespace

yield * secrets.delete("tokens", "github")
```

## 5. Audit what just happened

Successful operations write a `secret/accessed` audit event with namespace, key, and outcome — but never the value. Denied and failed operations attempt to write the same audit shape before returning the typed failure. Inspect via the devtools event-log panel or query `EventLog` directly.

## What gets validated

- **Namespace and key segments.** Must match `[A-Za-z0-9._-]+` (no `/`, no path traversal). Invalid input returns `SecretsInvalidArgumentError`.
- **Permissions.** Each call checks the matching `secrets.read` or `secrets.write` capability for the namespace.
- **Storage availability.** Missing keys return `SecretNotFoundError`; an unavailable safe-storage backend returns `SecretsSafeStorageUnavailableError`. A successful storage write whose post-commit audit fails returns `SecretsCommittedAuditFailedError` so callers know storage and audit diverged.

## When to use `SafeStorage` directly

`SafeStorage` is the lower-level key/value credential-store primitive. Use it when:

- You are implementing a framework service that already owns namespace permissions and audit events.
- You need direct access to credential-store keys instead of the app-facing `Secrets` facade.

Do not use it as an encryption helper. SafeStorage is the lower-level credential-store key/value primitive; on supported hosts it routes `set`, `get`, `list`, `delete`, and `isAvailable` through the platform store, and unavailable storage fails loudly instead of falling back to plaintext.

Most apps want `Secrets` instead.

## Related

- Reference: [`Secrets`](../reference/services/secrets.md), [`SafeStorage`](../reference/native/safe-storage.md)
- Explanation: [Audit and redaction](../explanation/audit-and-redaction.md), [Permissions model](../explanation/permissions-model.md)
