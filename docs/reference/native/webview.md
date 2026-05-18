---
title: WebView (native)
description: Embedded browser views.
kind: reference
audience: app-developers
effect_version: 4
---

# `WebView`

Embedded browser views inside desktop windows.

The Rust host currently attaches the application WebView during `Window.create`.
It does not expose routed `WebView.*` RPC methods yet, so the public `WebView`
RPC surface is declared but fail-closed in capability metadata until a host
adapter owns those methods.

`WebView.NavigationBlocked` is a navigation-policy event, not request/response
interception. There is no `WebRequest` service yet for ordered interceptors,
subresource inspection, response-header mutation, blocking, redirects, or
request audit.

Proxy configuration, HTTP authentication challenges, and certificate decisions
are also not part of `WebView`. Those hooks are absent; adding them would
require a new network-auth service and host adapter.

Browser permission prompts are not handled by `WebView` today. Camera,
microphone, notifications, geolocation, clipboard, and display-capture
decisions still need explicit profile/session-partitioned host wiring.

Browsing data is not managed by `WebView` today. Cache, cookies, local storage,
IndexedDB, and history cannot be cleared by profile, session, or data type
because the current host WebView attachment has no partitioned browser data
store contract.

Cookies are not exposed as a native Effect Desktop service today. The installed
WebView provider has low-level cookie read, write, and delete primitives, but
Effect Desktop has no host protocol, permission gate, profile/session target, or
cookie-change event stream for them yet.

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
  native: Desktop.native(Native.WebView),
  permissions: Desktop.permissions(...Native.Permissions.webView.all.map(Desktop.permission))
})
```

`Native.WebView` registers the WebView surface. `Native.Permissions.webView.all` grants WebView authority.
`webViewCapability(...)` is a platform and runtime-mode support helper; it does not grant permission.

## Errors

`WebViewError`.

## Status

The contract is declared through `WebViewRpcs`. Runtime WebView attachment is
currently owned by `Window.create`; direct `WebView.*` bridge methods are
unsupported with `host-adapter-unimplemented` until explicit host routes exist.
`webViewCapability(...)` remains a local platform and runtime-mode feature
helper; it does not prove that the direct WebView RPC host path is routed.
Request/response interception is also not part of this surface yet; it requires
a separate native host adapter.
Proxy/auth/certificate hooks are likewise absent from the current host-backed
surface.

## Related

- Reference: [`Window`](window.md)
- Source: [`packages/native/src/webview.ts`](../../../packages/native/src/webview.ts)
