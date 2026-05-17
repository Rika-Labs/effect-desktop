---
title: ExtensionConfig (native)
description: Product-neutral extension configuration contract with typed values, redacted diagnostics, and safe secret storage.
kind: reference
audience: app-developers
effect_version: 4
---

# `ExtensionConfig`

Product-neutral extension configuration service. Callers declare a schema for extension-owned settings, write typed non-secret values, write `SecretBytes` through safe storage, read configuration state, reset keys, and export a redacted diagnostic view.

The public service is Layer-first and test-substitutable. The TypeScript service validates Schema contracts before transport, checks permissions before host or secret-store side effects, stores `SecretBytes` through `SafeStorage`, and keeps secret values out of bridge payloads, diagnostics, logs, and API snapshots.

## Methods

| Method        | Payload                                             | Success                                      |
| ------------- | --------------------------------------------------- | -------------------------------------------- |
| `read`        | `{ actor, extensionId, fields, traceId? }`          | `{ extensionId, values, secrets, revision }` |
| `write`       | `{ actor, extensionId, fields, values?, secrets? }` | `{ extensionId, writtenKeys, revision }`     |
| `reset`       | `{ actor, extensionId, fields, keys?, traceId? }`   | `{ extensionId, resetKeys, revision }`       |
| `redact`      | `{ actor, extensionId, fields, traceId? }`          | `{ extensionId, values, redactions }`        |
| `isSupported` | `void`                                              | `{ supported, reason? }`                     |
| `events`      | `void`                                              | stream of extension config events            |

## Fields

Each field declares:

- `key`
- `valueType`: `string`, `number`, `boolean`, or `json`
- `secret`
- `required?`
- `defaultValue?`
- `exportPolicy?`: `diagnostics` or `private`

Secret fields cannot declare defaults. Non-secret values must match the declared `valueType`. Required reads fail with typed `InvalidArgument` when the stored value or secret presence is missing.

## Secrets

`write` accepts `SecretBytes` only on the public service request. The service stores those bytes under the namespace `extension-config.<extensionId>` through `SafeStorage`, then sends only secret keys across the native bridge and Rust host boundary.

`read` reports secret presence as `{ key, present }`. `redact` returns placeholders and redaction evidence, not bytes.

## Permissions

The service checks native invoke permission for the requested method:

- `Native.Permissions.extensionConfig.read`
- `Native.Permissions.extensionConfig.write`
- `Native.Permissions.extensionConfig.reset`
- `Native.Permissions.extensionConfig.redact`

Secret reads also require `safeStorage.read` for `extension-config.<extensionId>`. Secret writes and secret resets require `safeStorage.write` for the same namespace.

## Errors

`ExtensionConfigError` is the canonical host protocol error union. Permission denial, unsupported platform behavior, invalid input, and host failures are typed tagged failures.

## Support

The Rust host adapter stores non-secret values and secret-key presence in a durable desktop host store. Secret bytes remain safe-storage-owned by the TypeScript service and never cross the native bridge or Rust host boundary.

| Platform | Status      | Notes                                        |
| -------- | ----------- | -------------------------------------------- |
| macOS    | `supported` | Store lives under Application Support.       |
| Windows  | `supported` | Store lives under the user application data. |
| Linux    | `supported` | Store lives under XDG config or `~/.config`. |

`isSupported` returns `{ supported: true }` when the host can create and decode the store. If the store path is unavailable or corrupt, requests fail with typed host errors instead of silently falling back to memory.

## Testing

Use `makeExtensionConfigMemoryClient()` for deterministic reads, writes, resets, redaction, and events without a native host. Use `makeExtensionConfigUnsupportedClient()` when a test needs the typed unsupported path.

## Related

- Source: [`packages/native/src/extension-config.ts`](../../../packages/native/src/extension-config.ts)
- Contract: [`packages/native/src/contracts/extension-config.ts`](../../../packages/native/src/contracts/extension-config.ts)
