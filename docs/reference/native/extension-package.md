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

## Support

The current Rust host adapter is intentionally fail-closed while native package installation is not implemented.

| Platform | Status        | Reason                       |
| -------- | ------------- | ---------------------------- |
| macOS    | `unsupported` | `host-adapter-unimplemented` |
| Windows  | `unsupported` | `host-adapter-unimplemented` |
| Linux    | `unsupported` | `host-adapter-unimplemented` |

`isSupported` returns `{ supported: false, reason: "host-adapter-unimplemented" }`. Mutating host requests decode and validate payloads, then return typed `Unsupported`; invalid manifests are rejected before the unsupported response.

## Testing

Use `makeExtensionPackageMemoryClient()` for deterministic install, update, remove, list, and event tests without a native host. Use `makeExtensionPackageUnsupportedClient()` when a test needs the typed unsupported path.

## Related

- Source: [`packages/native/src/extension-package.ts`](../../../packages/native/src/extension-package.ts)
- Contract: [`packages/native/src/contracts/extension-package.ts`](../../../packages/native/src/contracts/extension-package.ts)
