# WebView Preload Isolation

Preload isolation is create-time state. Wry exposes initialization-script and IPC hooks on `WebViewBuilder`, not as a portable mutation on an already-created WebView, so ORIKA models the policy on `WebView.create` instead of adding a misleading runtime `setPreload` route.

The host now decodes `isolation.exposedApis`, injects a generated preload wrapper, and emits `WebView.ApiCall` only when the incoming IPC message matches a declared API name and method. Malformed manifests fail before transport in TypeScript and before host work in Rust. Undeclared IPC messages are ignored at the host boundary.

Architecture-debt sweep: no new wrapper service was added. A separate `WebViewIsolation` service would only forward into `WebView.create` because the native provider has no post-create preload hook. The durable policy remains in the existing WebView resource boundary, where owner scope, origin policy, Wry callbacks, and event emission already live.
