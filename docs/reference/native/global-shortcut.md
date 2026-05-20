---
title: GlobalShortcut (native)
description: Global shortcut command-binding contract.
kind: reference
audience: app-developers
effect_version: 4
---

# `GlobalShortcut`

Global shortcut command-binding contract. The TypeScript service defines support probing, pressed-event decoding, and command invocation, but native OS registration is not implemented in the host adapter yet, so the registration operations are non-callable capability facts.

## Methods

| Method         | Payload           | Success                 |
| -------------- | ----------------- | ----------------------- |
| `isRegistered` | `{ accelerator }` | `{ registered: false }` |
| `isSupported`  | `void`            | support result          |

## Capability facts (non-callable)

`register`, `unregister`, and `unregisterAll` are advertised in the native capability manifest as capability facts with `support.status: "unsupported"` (reason `host-adapter-unimplemented`). They are not invocable RPCs: the surface registers no handlers for them, and the RPC group exposes only `isRegistered` and `isSupported`. They exist only so the manifest can describe the intended registration lifecycle and so permission tooling can reason about the `native.invoke` authority they would require.

`bindCommand` is a TypeScript-level service operation, not a host RPC. It composes over the registration path, so it currently fails closed with typed `Unsupported` until the host adapter exists; it remains useful for deterministic tests and future native events (see Platform support below).

## Types

`GlobalShortcutWindowHandle` scopes the shortcut registration to the declaring window.

## Platform support

`register`, `unregister`, and `unregisterAll` are non-callable capability facts marked `unsupported` on macOS, Windows, and Linux with reason `host-adapter-unimplemented`. `isSupported` reports unsupported until a real native shortcut adapter exists; Wayland reports `wayland-no-global-shortcut`.

`bindCommand` remains useful for deterministic tests and future native events: it registers a scoped command binding, listens for `GlobalShortcut.Pressed`, invokes `CommandRegistry`, and unregisters on scope disposal.

## Errors

- `GlobalShortcutError`
- `GlobalShortcutCommandBindingError`
- `GlobalShortcutAlreadyRegisteredError`

## Related

- Reference: [`Command`](../services/command.md), [`Menu`](menu.md)
- Source: [`packages/native/src/global-shortcut.ts`](../../../packages/native/src/global-shortcut.ts)
