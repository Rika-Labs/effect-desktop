---
title: WebView (native)
description: Embedded browser views.
kind: reference
audience: app-developers
effect_version: 4
---

# `WebView`

Embedded browser views inside desktop windows.

## Import

```ts
import { Desktop } from "@effect-desktop/core"
import { Native, WebView, WebViewError, WebViewRpcs } from "@effect-desktop/native"
```

## Methods

| Method                | Payload                      | Success                  |
| --------------------- | ---------------------------- | ------------------------ |
| `create`              | `{ id?, window?, route? }`   | `{ id, window }`         |
| `loadRoute`           | `{ webview, route }`         | `void`                   |
| `loadUrl`             | `{ webview, url }`           | `void`                   |
| `reload`              | `{ webview }`                | `void`                   |
| `goBack`              | `{ webview }`                | `void`                   |
| `goForward`           | `{ webview }`                | `void`                   |
| `captureScreenshot`   | `{ webview }`                | screenshot data          |
| `setNavigationPolicy` | `{ webview, policy }`        | `void`                   |
| `capability`          | `{ name, platform?, mode? }` | `{ supported: boolean }` |
| `destroy`             | `{ webview }`                | `void`                   |

## App composition

```ts
Desktop.make({
  id: "com.acme.webview",
  windows: Desktop.window("main", { title: "WebView" }),
  native: Native.capabilities(Native.WebView.all)
})
```

`Native.WebView.all` registers the WebView surface and grants WebView authority.
`webViewCapability(...)` is a platform and runtime-mode support helper; it does not grant permission.

## Errors

`WebViewError`.

## Status

The contract is declared through `WebViewRpcs`, and platform-limited operations
are exposed through typed support checks.

## Related

- Reference: [`Window`](window.md)
- Source: [`packages/native/src/webview.ts`](../../../packages/native/src/webview.ts)
