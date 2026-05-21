---
title: ContextMenu (native)
description: Context menu display and command binding.
kind: reference
audience: app-developers
effect_version: 4
---

# `ContextMenu`

Context menu support. The TypeScript service, bridge contracts, template validation, and command-binding lifecycle are present today, but the Rust host does not yet route context-menu display or activation events. The `show` operation is a non-callable capability fact; the RPC group exposes no callable native methods, only the `ContextMenu.Activated` event stream. `buildFromTemplate` and `bindCommand` are TypeScript service helpers and are not native host methods.

## Methods

This surface has no callable native RPC methods. `ContextMenu.buildFromTemplate` is callable on the TypeScript service as validation/preflight. `ContextMenu.bindCommand` registers a scoped command listener against `ContextMenu.Activated`. Neither helper invokes the native host. Completing native parity requires a Rust host route for context-menu display and a host event source for real context-menu item activation.

## Capability facts (non-callable)

`show` is advertised in the native capability manifest as a capability fact with `support.status: "unsupported"` (reason `host-adapter-unimplemented`). It is not an invocable RPC: the surface registers no handler for it and the RPC group is empty. It exists only so the manifest can describe the intended context-menu display operation and so permission tooling can reason about the `native.invoke` authority it would require.

When context-menu support lands, `show` would accept `{ window, template, position }`. `buildFromTemplate` accepts `{ template }` at the TypeScript service boundary and validates that shape locally. `bindCommand` accepts `{ itemId, commandId }`, validates those identifiers, and registers the command listener locally.

## Errors

- `ContextMenuError`
- `ContextMenuCommandBindingError`

## Status

The public contracts validate input before transport and tests cover substitutable clients, bridge decoding, listener cleanup, and TypeScript-level command invocation. The real native display path remains missing, so this surface is not complete native parity yet.

## Related

- Reference: [`Command`](../services/command.md), [`Menu`](menu.md)
- Source: [`packages/native/src/context-menu.ts`](../../../packages/native/src/context-menu.ts)
