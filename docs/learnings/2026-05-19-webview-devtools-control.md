# WebView DevTools Control

DevTools control is a command on the retained WebView resource. The public API now exposes `openDevTools` and `closeDevTools` through the existing WebView service, and the host dispatches both commands through the window event loop to the Wry WebView that owns the native inspector.

The support status is `partial`. Wry compiles `open_devtools` and `close_devtools` only in debug builds unless the provider is built with devtools support, and Wry does not expose a portable debugger protocol attach API. ORIKA therefore keeps `attachDebugger` permission-gated and handle-validated, but returns typed unsupported with `host-debugger-protocol-unavailable`.

Architecture-debt sweep: no `WebViewInspection` wrapper was added. A separate service would only forward a WebView handle back into the same retained resource, so it would add a shallow contract without hiding durable desktop-specific policy. The durable boundary remains `WebView`, where handle ownership, permissions, support metadata, and host routing already live.
