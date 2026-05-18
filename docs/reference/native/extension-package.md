---
title: ExtensionPackage (native)
description: Product-neutral extension package lifecycle contract with manifest validation, capability declarations, and source provenance.
kind: reference
audience: app-developers
effect_version: 4
---

# `ExtensionPackage`

Product-neutral extension package service. Callers install, update, remove, list, and observe packages by providing a validated manifest plus source provenance.

The public service is Layer-first and test-substitutable. It validates the manifest before host transport or permission registration, checks native package permissions before host side effects, registers declared capabilities only after install/update succeeds, and emits audit rows for privileged use and capability grants.

## Methods

| Method        | Payload                                                   | Success                                                                      |
| ------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `install`     | `{ actor, source, manifest, traceId? }`                   | `{ packageId, version, revision, registeredCapabilities }`                   |
| `update`      | `{ actor, source, manifest, expectedVersion?, traceId? }` | `{ packageId, previousVersion?, version, revision, registeredCapabilities }` |
| `remove`      | `{ actor, packageId, traceId? }`                          | `{ packageId, removed, revision }`                                           |
| `list`        | `void`                                                    | `{ packages }`                                                               |
| `isSupported` | `void`                                                    | `{ supported, reason? }`                                                     |
| `events`      | `void`                                                    | stream of extension package events                                           |

## Manifest

Each package manifest declares:

- `id`
- `name`
- `version`
- `entrypoint`
- `compatibility`: `minHostVersion?`, `maxHostVersion?`
- `capabilities`: Schema-typed permission capability declarations

Manifest IDs and actor IDs are restricted to letters, numbers, dots, underscores, and dashes. Versions must be SemVer. Entrypoints must be relative paths that stay inside the package. Duplicate capability declarations are rejected.

## Source Provenance

Each install/update includes a `source`:

- `kind`: `directory`, `archive`, or `registry`
- `uri`
- `digest?`: `sha256:<hex>`

The source is part of the host payload and audit details so operators can trace where installed bytes came from.

## Permissions

The service checks native invoke permission before host side effects:

- `Native.Permissions.extensionPackage.install`
- `Native.Permissions.extensionPackage.update`
- `Native.Permissions.extensionPackage.remove`

Install/update also checks every manifest-declared capability against the installing actor before host side effects. After host install/update succeeds, the service declares the authorized manifest capabilities against actor `resource:extension:<packageId>` with source `extension-package:<packageId>@<version>`.

## Errors

`ExtensionPackageError` is the canonical host protocol error union. Permission denial, unsupported platform behavior, invalid input, and host failures are typed tagged failures.

## Host Persistence

The Rust host adapter persists package lifecycle state in the user data directory:

- macOS: `$HOME/Library/Application Support/effect-desktop/extension-packages`
- Windows: `%LOCALAPPDATA%\effect-desktop\extension-packages` or `%APPDATA%\effect-desktop\extension-packages`
- Linux: `$XDG_CONFIG_HOME/effect-desktop/extension-packages` or `~/.config/effect-desktop/extension-packages`

Tests and embedded hosts can override the store root with `EFFECT_DESKTOP_EXTENSION_PACKAGE_STORE`.

For `directory` sources the host resolves a local absolute path or `file://` URI, rejects symlinks and special files, copies the directory into staging, verifies the staged manifest entrypoint exists as a regular file, optionally verifies `sha256:<hex>` against a deterministic directory digest, and promotes the staged directory into a revisioned package store. For `archive` sources the host resolves a local absolute path or `file://` URI, rejects root symlinks, copies the archive into staging, optionally verifies the staged archive file digest, and promotes the archive into the revisioned package store; archive contents are not unpacked or inspected. `registry` sources remain unsupported because marketplace or registry discovery is product-specific and out of scope for this primitive.

Install fails if the package already exists. Update requires an installed package and rejects stale `expectedVersion` values. Remove records a new revision and returns `removed: false` when the package was already absent.

## Support

| Platform | Status      | Reason |
| -------- | ----------- | ------ |
| macOS    | `supported` |        |
| Windows  | `supported` |        |
| Linux    | `supported` |        |

`isSupported` locks the package store, decodes existing state, creates required directories, writes a temporary metadata file, and atomically replaces the store file before it reports `{ supported: true }`. If the store cannot be created, read, decoded, or replaced, support is reported as `{ supported: false, reason: "extension-package-store-unavailable" }`.

## Testing

Use `makeExtensionPackageMemoryClient()` for deterministic install, update, remove, list, and event tests without a native host. Use `makeExtensionPackageUnsupportedClient()` when a test needs the typed unsupported path.

## Related

- Source: [`packages/native/src/extension-package.ts`](../../../packages/native/src/extension-package.ts)
- Contract: [`packages/native/src/contracts/extension-package.ts`](../../../packages/native/src/contracts/extension-package.ts)
