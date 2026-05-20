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

`Download` now exposes typed start, pause, resume, cancel, list, and event
contracts scoped to `SessionProfileHandle`, but the host adapter is still
validation-first unsupported until profile-bound WebViews can route provider
download callbacks through retained native resources.

Request and response interception are also separate from `WebView`.
`WebRequest` defines ordered `onBeforeRequest`, `onHeadersReceived`,
`removeListener`, and event contracts scoped to `SessionProfileHandle`. Those
interception methods are non-callable capability facts until profile-bound
WebViews can route provider request and response callbacks through retained
native resources.

`setAudioMuted` and `respondToPermission` are non-callable capability facts.
`setAudioMuted` is advertised with `host-runtime-media-control-unavailable`;
`respondToPermission` with `host-permission-request-routing-unavailable`.
Keeping the permission response capability explicit documents the intended
permission-decision path before native prompt routing exists.

Document controls are partially host-backed for child WebViews. `print` and
`setZoom` route through the retained Wry WebView resource. `captureScreenshot`,
`printToPdf`, `findInPage`, and `setUserAgent` are non-callable capability facts
because Wry exposes no portable public screenshot, PDF export, find-in-page, or
runtime user-agent setter. Wry supports user-agent policy at WebView creation
time; ORIKA does not pretend that is a runtime mutation.

Inspection controls are partially host-backed for child WebViews.
`openDevTools` and `closeDevTools` route through the retained Wry WebView in
debug builds. Production builds return typed unsupported unless the host is
compiled with a devtools-enabled WebView provider. `attachDebugger` is a
non-callable capability fact because Wry exposes no portable debugger protocol
attachment API.

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
are also not part of `WebView`. `NetworkAuth` now exposes typed proxy,
HTTP-auth, certificate-decision, and event contracts scoped to
`SessionProfileHandle`, but the host adapter is still validation-first
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

`BrowsingData` now exposes typed clear, estimate, list, and event contracts
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
| `findInPage`          | `{ webview, query }`               | `host-document-output-unavailable`            |
| `setUserAgent`        | `{ webview, userAgent }`           | `host-user-agent-runtime-unavailable`         |
| `setAudioMuted`       | `{ webview, muted }`               | `host-runtime-media-control-unavailable`      |
| `respondToPermission` | `{ webview, requestId, decision }` | `host-permission-request-routing-unavailable` |
| `listFrames`          | `{ webview }`                      | `host-frame-routing-unavailable`              |
| `postToFrame`         | `{ webview, frame, payload }`      | `host-frame-routing-unavailable`              |
| `attachDebugger`      | `{ webview }`                      | `host-debugger-protocol-unavailable`          |
| `capability`          | `{ name, platform?, mode? }`       | `host-adapter-unimplemented`                  |

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
`print` and `setZoom` are host-backed through Wry.
`openDevTools` and `closeDevTools` are host-backed in debug builds only.

`captureScreenshot`, `printToPdf`, `findInPage`, `setUserAgent`,
`setAudioMuted`, `respondToPermission`, `listFrames`, `postToFrame`,
`attachDebugger`, and `capability` are non-callable capability facts. They are
advertised in the native capability manifest with `support.status:
"unsupported"` — `host-document-output-unavailable` for the document-output
methods, `host-user-agent-runtime-unavailable` for `setUserAgent`,
`host-runtime-media-control-unavailable` for `setAudioMuted`,
`host-permission-request-routing-unavailable` for `respondToPermission`,
`host-frame-routing-unavailable` for the frame methods,
`host-debugger-protocol-unavailable` for `attachDebugger`, and
`host-adapter-unimplemented` for `capability` — but none can be invoked.
`webViewCapability(...)` remains a local platform and runtime-mode feature
helper; it does not grant permission.
Request/response interception is also not part of this surface yet; it requires
a separate native host adapter.
Proxy/auth/certificate hooks are likewise absent from the current host-backed
surface.

## Related

- Reference: [`Window`](window.md)
- Source: [`packages/native/src/webview.ts`](../../../packages/native/src/webview.ts)
