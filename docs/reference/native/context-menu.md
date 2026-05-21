---
title: ContextMenu (native)
description: Context menu display and command binding.
kind: reference
audience: app-developers
effect_version: 4
---

# `ContextMenu`

Context menu support. The TypeScript service, bridge contracts, and command-binding lifecycle are present today, but the Rust host does not yet route context-menu display, template construction, or activation events. The `show` and `buildFromTemplate` operations are non-callable capability facts; the RPC group exposes no callable native methods, only the `ContextMenu.Activated` event stream. `bindCommand` is a TypeScript service helper over `CommandRegistry` and is not a native host method.

## Methods

This surface has no callable native RPC methods. `ContextMenu.bindCommand` is callable on the TypeScript service and registers a scoped command listener against `ContextMenu.Activated`; it does not invoke the native host. Completing native parity requires Rust host routes for context-menu display and a host event source for real context-menu item activation.

## Capability facts (non-callable)

`show` and `buildFromTemplate` are advertised in the native capability manifest as capability facts with `support.status: "unsupported"` (reason `host-adapter-unimplemented`). They are not invocable RPCs: the surface registers no handlers for them and the RPC group is empty. They exist only so the manifest can describe the intended context-menu display operations and so permission tooling can reason about the `native.invoke` authority they would require.

When context-menu support lands, `show` would accept `{ window, template, position }` and `buildFromTemplate` would accept `{ template }`. `bindCommand` accepts `{ itemId, commandId }` at the TypeScript service boundary, validates those identifiers, and registers the command listener locally.

## Errors

- `ContextMenuError`
- `ContextMenuCommandBindingError`

## Status

The public contracts validate input before transport and tests cover substitutable clients, bridge decoding, listener cleanup, and TypeScript-level command invocation. The real native display path remains missing, so this surface is not complete native parity yet.

## Related

- Reference: [`Command`](../services/command.md), [`Menu`](menu.md)
- Source: [`packages/native/src/context-menu.ts`](../../../packages/native/src/context-menu.ts)
