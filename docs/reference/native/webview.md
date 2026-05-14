---
title: WebView (native)
description: Embedded browser views. Phase 6+ surface.
kind: reference
audience: app-developers
effect_version: 4
---

# `WebView`

Embedded browser views (sub-WebView within a window). Methods are reserved for Phase 6+.

## Capability

`webViewCapability(options)` builds the matching `PermissionRegistry` declaration.

## Errors

`WebViewError`.

## Status

The contract is declared and `WebViewRpcs` exists. Methods land in a later phase. The capability check pattern is in place so app code can reserve usage now.

## Related

- Reference: [`Window`](window.md)
- Source: [`packages/native/src/webview.ts`](../../../packages/native/src/webview.ts)
