# WebView Navigation Host Resources

The WebView navigation path now has host-owned child WebView resources. `WebView.create` attaches a Wry WebView to an explicit owner window, returns a generation-stamped handle, and stores the resource on the host event-loop side. `loadRoute`, `loadUrl`, `reload`, `stop`, `goBack`, `goForward`, `getNavigationState`, and `destroy` dispatch through that retained resource instead of returning the previous validation-only unsupported response.

The support status is `partial`, not `supported`. Wry exposes portable `load_url`, `reload`, page-load callbacks, navigation callbacks, and script evaluation, but it does not expose a portable native back/forward/stop/loading-state API. Effect Desktop therefore tracks history state from host-issued commands plus Wry navigation/page-load callbacks, and uses WebView script evaluation for stop/back/forward controls.

Architecture-debt sweep: the shallow TypeScript `webviewRpc` helper was already removed. This slice removed no additional wrappers and kept the native boundary in `WebView`/`NativeSurface`, where permissions, support truth, bridge metadata, and host resource ownership belong. Remaining WebView debt is owned by later issues: navigation policy mutation/events, screenshot/document output, frame/runtime events, preload isolation, sessions/profiles, and request interception.
