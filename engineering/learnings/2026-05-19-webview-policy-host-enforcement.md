# WebView Policy Host Enforcement

The WebView policy path now lives with the host-owned WebView resource. `WebView.create` stores the initial origin policy, `WebView.setNavigationPolicy` replaces that policy in the retained resource, and the Wry navigation handler reads the current policy before allowing a navigation.

Denied navigations emit `WebView.NavigationBlocked` with the WebView handle, target URL, and denial reason. The Wry new-window handler also denies `window.open` before native popup creation and emits the same event with a popup-policy reason. This keeps popup creation fail-closed until a later issue adds an explicit approval and external-open delegation model.

Architecture-debt sweep: no wrapper was added or retained. The policy state is stored in the existing host resource because that is the module that owns the native WebView lifecycle and Wry callbacks. `Shell.openExternal` remains a separate durable native surface; this slice intentionally does not hide popup policy behind automatic external-open delegation.
