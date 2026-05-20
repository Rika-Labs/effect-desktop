---
title: ContextMenu (native)
description: Context menu display and command binding.
kind: reference
audience: app-developers
effect_version: 4
---

# `ContextMenu`

Context menu support. The TypeScript service, bridge contracts, and command-binding lifecycle are present today, but the Rust host does not yet route context-menu display, template construction, bind registration, or activation events. The `show`, `buildFromTemplate`, and `bindCommand` operations are non-callable capability facts; the RPC group exposes no callable methods, only the `ContextMenu.Activated` event stream.

## Methods

This surface has no callable RPC methods. `ContextMenu.Activated` is the bridge event contract used by the TypeScript command-binding service. Completing native parity requires a Rust host event source for real context-menu item activation.

## Capability facts (non-callable)

`show`, `buildFromTemplate`, and `bindCommand` are advertised in the native capability manifest as capability facts with `support.status: "unsupported"` (reason `host-adapter-unimplemented`). They are not invocable RPCs: the surface registers no handlers for them and the RPC group is empty. They exist only so the manifest can describe the intended context-menu operations and so permission tooling can reason about the `native.invoke` authority they would require.

When context-menu support lands, `show` would accept `{ window, template, position }`, `buildFromTemplate` would accept `{ template }`, and `bindCommand` would accept `{ itemId, commandId }`. `bindCommand` is also exposed as a TypeScript-level service operation that composes over the host path; it currently fails closed with typed `Unsupported`.

## Errors

- `ContextMenuError`
- `ContextMenuCommandBindingError`

## Status

The public contracts validate input before transport and tests cover substitutable clients, bridge decoding, listener cleanup, and TypeScript-level command invocation. The real native host path remains missing, so this surface is not complete native parity yet.

## Related

- Reference: [`Command`](../services/command.md), [`Menu`](menu.md)
- Source: [`packages/native/src/context-menu.ts`](../../../packages/native/src/context-menu.ts)
