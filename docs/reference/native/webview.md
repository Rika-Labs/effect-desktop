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

Session/profile handles are not exposed today. `WebView.create` has no
profile/session input, and the host does not retain a browser `WebContext`
registry that can bind WebViews, cookies, cache, permissions, storage,
downloads, or requests to a partition.

`WebView.NavigationBlocked` is a navigation-policy event, not request/response
interception. There is no `WebRequest` service yet for ordered interceptors,
subresource inspection, response-header mutation, blocking, redirects, or
request audit.

Subframe identity is not exposed today. Effect Desktop has no `WebViewFrames`
service, frame handle schema, frame lifecycle stream, `listFrames`, or
`postToFrame` host route, and the current Wry-backed host path does not provide
portable stable frame identifiers across macOS, Windows, and Linux.

Runtime event coverage is not exposed today. Effect Desktop has no
`WebViewRuntime` service, crash/unresponsive/media/file-input/drag-drop event
contract, audio mute command, or auditable permission-response host route.
The installed WebView provider exposes some callback ingredients, but they are
not wired into typed Effect streams or permission decisions.

Document output controls are not host-backed today. `captureScreenshot` exists
as a declared TypeScript bridge contract, but the Rust host has no
`WebView.captureScreenshot` route, and Effect Desktop has no `WebViewDocument`
service for capture-page, print-to-PDF, find-in-page, zoom, or user-agent
controls.

Inspection controls are not host-backed today. `devtools open` is capability
metadata only; Effect Desktop has no `WebViewInspection` service,
`openDevTools`, `closeDevTools`, debugger attach/detach contract, or audited
host permission path for inspector access.

Preload isolation is not exposed today. Effect Desktop has no
`WebViewIsolation` service, preload registration contract, isolated-world
policy, or Schema-declared API exposure surface. The installed WebView provider
has raw initialization-script and IPC hooks, but they are not a permission-gated
native boundary for renderer/native API exposure.

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
