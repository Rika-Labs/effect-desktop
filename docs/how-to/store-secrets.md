---
title: How to store secrets safely
description: Use Secrets to read and write credentials through OS-backed safe storage with redaction.
kind: how-to
audience: app-developers
effect_version: 4
---

# How to store secrets safely

`Secrets` is the app-level facade over the platform credential store (Keychain, Credential Manager, libsecret). Secret bytes never enter logs because they ride as `Redacted<Uint8Array>`, every operation is permission-checked, and every successful access writes an audit event without the value.

## 1. Declare the namespace permission

At app init:

```ts
import { PermissionRegistry } from "@effect-desktop/core"

const permissions = yield* PermissionRegistry
yield* permissions.declare(
  { kind: "secrets.read", namespaces: ["tokens"] },
  { effect: "allow", source: "app-init" }
)
yield* permissions.declare(
  { kind: "secrets.write", namespaces: ["tokens"] },
  { effect: "allow", source: "app-init" }
)
```

Without these declarations, `Secrets.get` and `Secrets.set` for the `tokens` namespace return `PermissionDenied`.

## 2. Write a secret

```ts
import { Effect } from "effect"
import { Secrets, makeSecretBytesFromUtf8 } from "@effect-desktop/core"

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
import { wipeSecretBytes } from "@effect-desktop/core"

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
const keys = yield* secrets.list("tokens")
// Array of { namespace: "tokens", key: "github" } shapes

yield* secrets.delete("tokens", "github")
```

## 5. Audit what just happened

Every operation writes a `secret/accessed` audit event with namespace, key, and outcome — but never the value. Inspect via the devtools event-log panel or query `EventLog` directly.

## What gets validated

- **Namespace and key segments.** Must match the framework's allowed pattern (no `/`, no path traversal). Invalid input returns `SecretsError.InvalidArgument`.
- **Permissions.** Each call checks the matching `secrets.read` or `secrets.write` capability.
- **Storage availability.** Missing keys return `SecretsError.NotFound`; an unavailable safe-storage backend returns `SecretsError.StorageUnavailable`.

## When to use `SafeStorage` directly

`SafeStorage` is the lower-level primitive — `encrypt(plaintext)` / `decrypt(ciphertext)`. Use it when:

- You're storing the encrypted bytes somewhere other than the platform credential store (e.g. a sync server).
- You need raw control over encryption boundaries.

Most apps want `Secrets` instead.

## Related

- Reference: [`Secrets`](../reference/services/secrets.md), [`SafeStorage`](../reference/native/safe-storage.md)
- Explanation: [Audit and redaction](../explanation/audit-and-redaction.md), [Permissions model](../explanation/permissions-model.md)
