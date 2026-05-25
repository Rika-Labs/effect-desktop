---
title: WebView (native)
description: Embedded browser views.
kind: reference
audience: app-developers
effect_version: 4
---

# `WebView`

Embedded browser views inside desktop windows.

The Rust host attaches the application WebView during `Window.create`. That app
renderer remains the window-owned WebView for the lifetime of the window.
`WebView.create` creates host-owned native child WebViews under an explicit
`WindowHandle` owner, without replacing the app renderer, and supports initial
URL, origin policy, optional `SessionProfile`, and optional preload isolation.
Navigation methods own generated host handles for child WebViews: `loadRoute`,
`loadUrl`, `reload`, `stop`, `goBack`, `goForward`, and `getNavigationState`
route through the host event-loop command port. `WebView.destroy` releases the
retained child WebView resource. Capability metadata marks the history-related
navigation methods `partial` because history state is tracked from Wry
navigation/page-load callbacks and host-issued commands rather than a portable
browser history API.

`WebView.create` can bind a child WebView to a typed `SessionProfile` handle.
The host retains a WebContext registry for profile-bound child WebViews, but
profile-scoped cookies, permissions, storage, downloads, and request
interception are still represented by their own capability rows.

`WebView.NavigationBlocked` is a navigation-policy event, not request/response
interception. `WebView.ApiCall` is a preload-isolation event emitted only for
API names and method names declared in the `WebView.create` isolation manifest.
`WebView.RuntimeEvent` is a runtime lifecycle stream for host-observable
WebView state. There is no `WebRequest` service yet for ordered interceptors,
subresource inspection, response-header mutation, blocking, redirects, or
request audit.

Navigation controls are host-backed for child WebViews. `WebView.create`
registers a generation-stamped handle scoped to the owner window and enforces
the create origin policy before attachment. `destroy` releases the retained
native WebView. `loadRoute` validates app routes and `loadUrl` validates
browser URLs; both enforce the retained WebView origin policy before loading
through Wry. `reload`, `stop`, `goBack`, and `goForward` also dispatch to the
retained Wry WebView. `getNavigationState` returns host-tracked `canGoBack`,
`canGoForward`, and `loading` state. The host still has no typed
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

The navigation-blocked payload schema is owned by the canonical
`WebView.events.NavigationBlocked` RPC stream contract. Bridge clients preserve
the existing `WebView.NavigationBlocked` host event method.

Subframe identity is not host-backed today. `listFrames` and `postToFrame` are
non-callable capability facts advertised with `host-frame-routing-unavailable`;
`WebView.FrameEvent` is Schema-typed but has no host adapter. The current
Wry-backed host path does not provide portable stable frame identifiers across
macOS, Windows, and Linux, so no frame handles are created yet.

Runtime event coverage is partial. `onRuntimeEvent` exposes host-observed page
load and drag/drop events through `WebView.RuntimeEvent`; events are ordered by
host emission, have no replay/backfill, apply normal stream cancellation, and
use the bridge event queue as the backpressure boundary. Crash, unresponsive,
media session, file-input, download, and browser permission prompt events are
declared in the event phase contract but are not emitted by the current Wry host
adapter because Wry does not expose portable public callbacks for them on all
desktop targets.

`WebView.events.ApiCall`, `WebView.events.RuntimeEvent`, and
`WebView.events.FrameEvent` own the canonical RPC stream schemas for preload,
runtime, and frame events. Bridge clients continue to subscribe to
`WebView.ApiCall`, `WebView.RuntimeEvent`, and `WebView.FrameEvent`.

`Download` now exposes typed start, pause, resume, cancel, list, and event
contracts scoped to `SessionProfileHandle`, but the host adapter is still
validation-first unsupported until profile-bound WebViews can route provider
download callbacks through retained native resources.

Request and response interception are also separate from `WebView`.
`WebRequest` defines ordered `onBeforeRequest`, `onHeadersReceived`,
`removeListener`, and event contracts scoped to `SessionProfileHandle`. Those
interception methods are non-callable capability facts because retained
profile-bound WebViews do not expose portable request and response interception
callbacks through the current host provider.

`setAudioMuted` and `respondToPermission` are non-callable capability facts.
`setAudioMuted` is advertised with `host-runtime-media-control-unavailable`;
`respondToPermission` with `host-permission-request-routing-unavailable`.
Keeping the permission response capability explicit documents the intended
permission-decision path before native prompt routing exists.

Document controls are host-backed for child WebViews where the provider owns a
portable operation. `print` and `setZoom` are supported through the retained Wry WebView
resource. `captureScreenshot`, `printToPdf`, `findInPage`, and
`setUserAgent` are non-callable capability facts because Wry exposes no portable
public screenshot, PDF export, find-in-page, or runtime user-agent setter on
desktop targets. A platform-specific snapshot hook would need a host-owned
adapter before it could satisfy the portable `captureScreenshot` contract. Wry
supports user-agent policy at WebView creation time; ORIKA does not pretend
that is a runtime mutation.

Inspection controls are partially host-backed for child WebViews.
`openDevTools` and `closeDevTools` route through the retained Wry WebView in
debug builds or when the host is compiled with the `devtools` feature. Release
builds without that feature return typed unsupported. Wry does not expose a
Windows close-devtools operation, so `closeDevTools` is unsupported on Windows
even though `openDevTools` can open the WebView2 devtools window.
`attachDebugger` is a non-callable capability fact because Wry exposes no
portable debugger protocol attachment API. Opening the inspector UI is not the
same as creating a host debugger session that can exchange protocol commands
and events.

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
are also not part of `WebView`. `NetworkAuth` exposes typed proxy, HTTP-auth,
certificate-decision, and event contracts scoped to `SessionProfileHandle`.
Proxy policy is applied only when the host creates future profile-bound
WebViews on supported platforms. HTTP-auth and certificate decisions remain
unsupported until profile-bound WebViews can route provider network-auth
callbacks through retained native resources.

Browser permission prompts are not handled by `WebView` today. Camera,
microphone, notifications, geolocation, clipboard, and display-capture
decisions still need explicit profile/session-partitioned host wiring. Calls to
`respondToPermission` fail as typed unsupported after permission and handle
validation.

`SessionPermission` now exposes typed request, decision, listing, and event
contracts scoped to `SessionProfileHandle`, but the host adapter is still
validation-first unsupported until WebView permission callbacks are routed
through profile-bound Wry contexts.

Browsing data is not managed by `WebView` today. `SessionProfile` defines the
typed resource identity for future partitioned browser state, but cache,
cookies, local storage, IndexedDB, and history cannot be cleared by profile,
session, or data type because the current host WebView attachment has no
partitioned browser data store contract.

`BrowsingData` now exposes typed clear, list, support, and event contracts
scoped to `SessionProfileHandle`, but the host adapter is still
validation-first unsupported until WebView creation binds profile handles to
Wry contexts. The installed WebView provider exposes a coarse clear-all
operation, but ORIKA does not route it as profile-partitioned state
yet.

`CookieStore` now exposes typed cookie read, write, remove, and event contracts
scoped to `SessionProfileHandle`, but the host adapter is still validation-first
unsupported until WebView creation binds profile handles to Wry contexts. The
installed WebView provider has low-level cookie primitives, but ORIKA
does not route them to partitioned browser state yet.

## Import

```ts
import { Desktop } from "@orika/core"
import { Native, WebView, WebViewError, WebViewRpcs } from "@orika/native"
```

## Methods

The callable RPCs on this surface are:

| Method                | Payload                                     | Success          |
| --------------------- | ------------------------------------------- | ---------------- |
| `create`              | `{ window, url, originPolicy, isolation? }` | webview handle   |
| `loadRoute`           | `{ webview, route }`                        | `void`           |
| `loadUrl`             | `{ webview, url }`                          | `void`           |
| `reload`              | `{ webview }`                               | `void`           |
| `stop`                | `{ webview }`                               | `void`           |
| `goBack`              | `{ webview }`                               | `void`           |
| `goForward`           | `{ webview }`                               | `void`           |
| `getNavigationState`  | `{ webview }`                               | navigation state |
| `print`               | `{ webview }`                               | `void`           |
| `setZoom`             | `{ webview, zoom }`                         | `void`           |
| `openDevTools`        | `{ webview }`                               | `void`           |
| `closeDevTools`       | `{ webview }`                               | `void`           |
| `setNavigationPolicy` | `{ webview, policy }`                       | `void`           |
| `destroy`             | `{ webview }`                               | `void`           |

## Capability facts (non-callable)

The following are not callable RPCs. They are advertised in the native capability manifest as capability facts with `support.status: "unsupported"`, but no host adapter can be invoked. They describe intended contracts until their host adapters land.

| Capability fact       | Intended payload                   | Unsupported reason                            |
| --------------------- | ---------------------------------- | --------------------------------------------- |
| `captureScreenshot`   | `{ webview }`                      | `host-document-output-unavailable`            |
| `printToPdf`          | `{ webview }`                      | `host-document-output-unavailable`            |
| `findInPage`          | `{ webview, query }`               | `host-find-in-page-unavailable`               |
| `setUserAgent`        | `{ webview, userAgent }`           | `host-user-agent-runtime-unavailable`         |
| `setAudioMuted`       | `{ webview, muted }`               | `host-runtime-media-control-unavailable`      |
| `respondToPermission` | `{ webview, requestId, decision }` | `host-permission-request-routing-unavailable` |
| `listFrames`          | `{ webview }`                      | `host-frame-routing-unavailable`              |
| `postToFrame`         | `{ webview, frame, payload }`      | `host-frame-routing-unavailable`              |
| `attachDebugger`      | `{ webview }`                      | `host-debugger-protocol-unavailable`          |

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
is owned by `Window.create`. `WebView.create`, `WebView.destroy`,
`WebView.loadRoute`, `WebView.loadUrl`, `WebView.reload`, and `WebView.stop`
are host-backed and report `supported`. History-state methods are routed
through host-backed resources and report `partial` support with
`host-navigation-state-tracked`. `setNavigationPolicy` is host-backed and reports `partial` support with
`host-navigation-policy-open-external-unavailable` because popup approval and
external-open delegation are still intentionally conservative.
Create-time preload isolation is host-backed through Wry initialization-script
and IPC hooks, and reports through the typed `WebView.ApiCall` stream.
Runtime events are partially host-backed through Wry page-load and drag/drop
callbacks and report through `WebView.RuntimeEvent`.
`print` and `setZoom` are supported through Wry's retained WebView resource.
`openDevTools` is host-backed in debug builds or host builds compiled with the
`devtools` feature. `closeDevTools` uses the same build gate on macOS and Linux,
and is unsupported on Windows because Wry's WebView2 adapter has no close
operation.

`captureScreenshot`, `printToPdf`, `findInPage`, `setUserAgent`,
`setAudioMuted`, `respondToPermission`, `listFrames`, `postToFrame`,
and `attachDebugger` are non-callable capability facts. They are
advertised in the native capability manifest with `support.status:
"unsupported"` — `host-document-output-unavailable` for screenshot and PDF
output, `host-find-in-page-unavailable` for `findInPage`,
`host-user-agent-runtime-unavailable` for `setUserAgent`,
`host-runtime-media-control-unavailable` for `setAudioMuted`,
`host-permission-request-routing-unavailable` for `respondToPermission`,
`host-frame-routing-unavailable` for the frame methods,
and `host-debugger-protocol-unavailable` for `attachDebugger` — but none can be
invoked.
`webViewCapability(...)` remains a local platform and runtime-mode feature
helper, not a native host method or parity-matrix row; it does not grant
permission.
Request/response interception is also not part of this surface yet; it requires
a separate native host adapter with provider request and response callbacks.
Proxy/auth/certificate hooks are likewise absent from the `WebView` surface;
use `NetworkAuth.setProxy` for the current future-WebView proxy path.

## Related

- Reference: [`Window`](window.md)
- Source: [`packages/native/src/webview.ts`](../../../packages/native/src/webview.ts)
