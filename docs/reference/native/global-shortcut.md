---
title: GlobalShortcut (native)
description: Global shortcut command-binding contract.
kind: reference
audience: app-developers
effect_version: 4
---

# `GlobalShortcut`

Global shortcut command-binding contract. The TypeScript service defines registration, support probing, pressed-event decoding, and command invocation, but native OS registration is not implemented in the host adapter yet.

## Methods

| Method          | Payload                            | Success                 |
| --------------- | ---------------------------------- | ----------------------- |
| `register`      | `{ accelerator, registrarWindow }` | `void`                  |
| `unregister`    | `{ accelerator }`                  | `void`                  |
| `unregisterAll` | `void`                             | `void`                  |
| `isRegistered`  | `{ accelerator }`                  | `{ registered: false }` |
| `isSupported`   | `void`                             | support result          |

## Types

`GlobalShortcutWindowHandle` scopes the shortcut registration to the declaring window.

## Platform support

`register`, `unregister`, and `unregisterAll` are currently unsupported on macOS, Windows, and Linux with reason `host-adapter-unimplemented`. `isSupported` reports unsupported until a real native shortcut adapter exists; Wayland reports `wayland-no-global-shortcut`.

`bindCommand` remains useful for deterministic tests and future native events: it registers a scoped command binding, listens for `GlobalShortcut.Pressed`, invokes `CommandRegistry`, and unregisters on scope disposal.

## Errors

- `GlobalShortcutError`
- `GlobalShortcutCommandBindingError`
- `GlobalShortcutAlreadyRegisteredError`

## Related

- Reference: [`Command`](../services/command.md), [`Menu`](menu.md)
- Source: [`packages/native/src/global-shortcut.ts`](../../../packages/native/src/global-shortcut.ts)
