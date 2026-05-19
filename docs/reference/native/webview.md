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

`WebView.create` requires an explicit `WindowHandle` owner. `SessionProfile`
now exposes typed profile handles, but `WebView.create` has no profile/session
input yet, and the host does not retain a browser `WebContext` registry that
can bind WebViews, cookies, cache, permissions, storage, downloads, or requests
to a partition.

`WebView.NavigationBlocked` is a navigation-policy event, not request/response
interception. `WebView.ApiCall` is a preload-isolation event emitted only for
API names and method names declared in the `WebView.create` isolation manifest.
`WebView.RuntimeEvent` is a runtime lifecycle stream for host-observable
WebView state. There is no `WebRequest` service yet for ordered interceptors,
subresource inspection, response-header mutation, blocking, redirects, or
request audit.

Navigation controls are host-backed for child WebViews. `WebView.create`
registers a generation-stamped handle scoped to the owner window, enforces the
create origin policy before attachment, and releases the native WebView on
`destroy`. `loadRoute`, `loadUrl`, `reload`, `stop`, `goBack`, and `goForward`
dispatch to the retained Wry WebView. `getNavigationState` returns host-tracked
`canGoBack`, `canGoForward`, and `loading` state. The host still has no typed
browser-internal same-document history API, so same-document history is not
exposed as a portable native primitive.

Navigation and popup policy is host-backed for child WebViews. `create` stores
an initial origin policy, `setNavigationPolicy` replaces that policy on the
retained host resource, and the Wry navigation handler blocks disallowed
navigations before they load. The host emits `WebView.NavigationBlocked` for
denied navigations. A Wry new-window handler denies `window.open` requests
before a native popup is created and emits the same event with a popup-policy
reason. `openExternal` approval is still modeled as policy denial rather than
automatic delegation to `Shell.openExternal`.

Subframe identity has a validation-first contract, but is not host-backed today.
`listFrames`, `postToFrame`, and `WebView.FrameEvent` are Schema-typed and
permission-gated. The host validates WebView and frame handles before returning
typed unsupported with `host-frame-routing-unavailable`. The current Wry-backed
host path does not provide portable stable frame identifiers across macOS,
Windows, and Linux, so no frame handles are created yet.

Runtime event coverage is partial. `onRuntimeEvent` exposes host-observed page
load and drag/drop events through `WebView.RuntimeEvent`; events are ordered by
host emission, have no replay/backfill, apply normal stream cancellation, and
use the bridge event queue as the backpressure boundary. Crash, unresponsive,
media session, file-input, download, and browser permission prompt events are
declared in the event phase contract but are not emitted by the current Wry host
adapter because Wry does not expose portable public callbacks for them on all
desktop targets.

`setAudioMuted` and `respondToPermission` are permission-gated and
handle-validated, but return typed unsupported. `setAudioMuted` uses
`host-runtime-media-control-unavailable`; `respondToPermission` uses
`host-permission-request-routing-unavailable`. Keeping the permission response
route explicit gives permission decisions an auditable path before native prompt
routing exists.

Document controls are partially host-backed for child WebViews. `print` and
`setZoom` route through the retained Wry WebView resource. `captureScreenshot`,
`printToPdf`, `findInPage`, and `setUserAgent` are permission-gated and
handle-validated, but return typed unsupported because Wry exposes no portable
public screenshot, PDF export, find-in-page, or runtime user-agent setter. Wry
supports user-agent policy at WebView creation time; Effect Desktop does not
pretend that is a runtime mutation.

Inspection controls are partially host-backed for child WebViews.
`openDevTools` and `closeDevTools` route through the retained Wry WebView in
debug builds. Production builds return typed unsupported unless the host is
compiled with a devtools-enabled WebView provider. `attachDebugger` is a
permission-gated, validation-first unsupported route because Wry exposes no
portable debugger protocol attachment API.

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
decisions still need explicit profile/session-partitioned host wiring. Calls to
`respondToPermission` fail as typed unsupported after permission and handle
validation.

Browsing data is not managed by `WebView` today. `SessionProfile` defines the
typed resource identity for future partitioned browser state, but cache,
cookies, local storage, IndexedDB, and history cannot be cleared by profile,
session, or data type because the current host WebView attachment has no
partitioned browser data store contract.

`BrowsingData` now exposes typed clear, estimate, list, and event contracts
scoped to `SessionProfileHandle`, but the host adapter is still
validation-first unsupported until WebView creation binds profile handles to
Wry contexts. The installed WebView provider exposes a coarse clear-all
operation, but Effect Desktop does not route it as profile-partitioned state
yet.

`CookieStore` now exposes typed cookie read, write, remove, and event contracts
scoped to `SessionProfileHandle`, but the host adapter is still validation-first
unsupported until WebView creation binds profile handles to Wry contexts. The
installed WebView provider has low-level cookie primitives, but Effect Desktop
does not route them to partitioned browser state yet.

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
| `print`               | `{ webview }`                               | `void`                   |
| `printToPdf`          | `{ webview }`                               | PDF bytes                |
| `findInPage`          | `{ webview, query }`                        | match counts             |
| `setZoom`             | `{ webview, zoom }`                         | `void`                   |
| `setUserAgent`        | `{ webview, userAgent }`                    | `void`                   |
| `setAudioMuted`       | `{ webview, muted }`                        | `void`                   |
| `respondToPermission` | `{ webview, requestId, decision }`          | `void`                   |
| `listFrames`          | `{ webview }`                               | frame list               |
| `postToFrame`         | `{ webview, frame, payload }`               | `void`                   |
| `openDevTools`        | `{ webview }`                               | `void`                   |
| `closeDevTools`       | `{ webview }`                               | `void`                   |
| `attachDebugger`      | `{ webview }`                               | `void`                   |
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
Runtime events are partially host-backed through Wry page-load and drag/drop
callbacks and report through `WebView.RuntimeEvent`.
Frame routing is validation-first unsupported. `listFrames`, `postToFrame`, and
`WebView.FrameEvent` define the public shape, but the host returns
`host-frame-routing-unavailable` until a provider can create stable frame
handles and route messages below the top frame.
`print` and `setZoom` are host-backed through Wry. `captureScreenshot`,
`printToPdf`, and `findInPage` remain typed unsupported with
`host-document-output-unavailable`; `setUserAgent` remains typed unsupported
with `host-user-agent-runtime-unavailable`. `setAudioMuted` and
`respondToPermission` remain typed unsupported with
`host-runtime-media-control-unavailable` and
`host-permission-request-routing-unavailable`.
`openDevTools` and `closeDevTools` are host-backed in debug builds only.
`attachDebugger` remains typed unsupported with
`host-debugger-protocol-unavailable` because the current Wry provider does not
offer a portable debugger attach contract.
`capability` remains a validation-first unsupported route until its own host
adapter lands. `webViewCapability(...)` remains a local platform and
runtime-mode feature helper; it does not grant permission.
Request/response interception is also not part of this surface yet; it requires
a separate native host adapter.
Proxy/auth/certificate hooks are likewise absent from the current host-backed
surface.

## Related

- Reference: [`Window`](window.md)
- Source: [`packages/native/src/webview.ts`](../../../packages/native/src/webview.ts)
