---
title: WebView (native)
description: Embedded browser views.
kind: reference
audience: app-developers
effect_version: 4
---

# `WebView`

Embedded browser views inside desktop windows.

The Rust host attaches the application WebView during `Window.create`. Direct
WebView navigation methods now own generated host handles for child WebViews:
`create`, `loadRoute`, `loadUrl`, `reload`, `stop`, `goBack`, `goForward`,
`getNavigationState`, and `destroy` route through the host event-loop command
port. Capability metadata marks those methods `partial` because history state is
tracked from Wry navigation/page-load callbacks and host-issued commands rather
than a portable browser history API.

`WebView.create` requires an explicit `WindowHandle` owner. Session/profile
handles are not exposed today; `WebView.create` has no profile/session input,
and the host does not retain a browser `WebContext` registry that can bind
WebViews, cookies, cache, permissions, storage, downloads, or requests to a
partition.

`WebView.NavigationBlocked` is a navigation-policy event, not request/response
interception. `WebView.ApiCall` is a preload-isolation event emitted only for
API names and method names declared in the `WebView.create` isolation manifest.
There is no `WebRequest` service yet for ordered interceptors, subresource
inspection, response-header mutation, blocking, redirects, or request audit.

Navigation controls are host-backed for child WebViews. `WebView.create`
registers a generation-stamped handle scoped to the owner window, enforces the
create origin policy before attachment, and releases the native WebView on
`destroy`. `loadRoute`, `loadUrl`, `reload`, `stop`, `goBack`, and `goForward`
dispatch to the retained Wry WebView. `getNavigationState` returns host-tracked
`canGoBack`, `canGoForward`, and `loading` state. The host still has no typed
navigation lifecycle event stream, and browser-internal same-document history is
not exposed as a portable native primitive.

Navigation and popup policy is host-backed for child WebViews. `create` stores
an initial origin policy, `setNavigationPolicy` replaces that policy on the
retained host resource, and the Wry navigation handler blocks disallowed
navigations before they load. The host emits `WebView.NavigationBlocked` for
denied navigations. A Wry new-window handler denies `window.open` requests
before a native popup is created and emits the same event with a popup-policy
reason. `openExternal` approval is still modeled as policy denial rather than
automatic delegation to `Shell.openExternal`.

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
as a declared TypeScript bridge contract, but the Rust host only validates the
routed payload before returning unsupported. Effect Desktop has no
`WebViewDocument` service for capture-page, print-to-PDF, find-in-page, zoom,
or user-agent controls.

Inspection controls are not host-backed today. `devtools open` is capability
metadata only; Effect Desktop has no `WebViewInspection` service,
`openDevTools`, `closeDevTools`, debugger attach/detach contract, or audited
host permission path for inspector access.

Preload isolation is create-time and host-backed for child WebViews.
`WebView.create` accepts an optional `isolation.exposedApis` manifest. The host
injects a generated preload script through Wry initialization scripts, captures
renderer calls through Wry IPC, and emits `WebView.ApiCall` only when the API
name and method match the Schema-decoded manifest. The underlying provider does
not expose a portable runtime hook for replacing preload scripts after WebView
creation, so isolation policy is part of `create` rather than a later mutation.
This is not a full isolated-world implementation; platform WebView engines still
own the native JavaScript context model.

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

| Method                | Payload                                     | Success                  |
| --------------------- | ------------------------------------------- | ------------------------ |
| `create`              | `{ window, url, originPolicy, isolation? }` | webview handle           |
| `loadRoute`           | `{ webview, route }`                        | `void`                   |
| `loadUrl`             | `{ webview, url }`                          | `void`                   |
| `reload`              | `{ webview }`                               | `void`                   |
| `stop`                | `{ webview }`                               | `void`                   |
| `goBack`              | `{ webview }`                               | `void`                   |
| `goForward`           | `{ webview }`                               | `void`                   |
| `getNavigationState`  | `{ webview }`                               | navigation state         |
| `captureScreenshot`   | `{ webview }`                               | screenshot data          |
| `setNavigationPolicy` | `{ webview, policy }`                       | `void`                   |
| `capability`          | `{ name, platform?, mode? }`                | `{ supported: boolean }` |
| `destroy`             | `{ webview }`                               | `void`                   |

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

## Preload Isolation

```ts
const webview = yield * WebView
const child =
  yield *
  webview.create(window, {
    url: "app://localhost/",
    originPolicy: { allowedOrigins: ["app://localhost"], onDisallowed: "block" },
    isolation: {
      exposedApis: [{ name: "desktop", methods: ["ping"] }]
    }
  })

const calls = webview.onApiCall()
```

The preload script exposes the declared methods under `window.EffectDesktop`.
For the example above, renderer code can call
`window.EffectDesktop.desktop.ping(payload)`. Calls arrive as
`WebView.ApiCall` events with `{ webview, api, method, payload }`, where
`payload` is the JSON string produced by the generated preload wrapper.

## Errors

`WebViewError`.

## Status

The contract is declared through `WebViewRpcs`. App runtime WebView attachment
is owned by `Window.create`; direct child WebView navigation methods are routed
through host-backed resources and report `partial` support with
`host-navigation-state-tracked`. `setNavigationPolicy` is also host-backed for
those resources and shares the same partial support reason because popup
approval and external-open delegation are still intentionally conservative.
Create-time preload isolation is host-backed through Wry initialization-script
and IPC hooks, and reports through the typed `WebView.ApiCall` stream.
`captureScreenshot` and `capability` remain validation-first unsupported routes
until their own host adapters land. `webViewCapability(...)` remains a local
platform and runtime-mode feature helper; it does not grant permission.
Request/response interception is also not part of this surface yet; it requires
a separate native host adapter.
Proxy/auth/certificate hooks are likewise absent from the current host-backed
surface.

## Related

- Reference: [`Window`](window.md)
- Source: [`packages/native/src/webview.ts`](../../../packages/native/src/webview.ts)
