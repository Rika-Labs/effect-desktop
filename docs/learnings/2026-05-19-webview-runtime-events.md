# WebView Runtime Events

WebView runtime observation belongs on the retained WebView resource. Wry exposes portable page-load and drag/drop callbacks at WebView creation time, so the host now emits those as `WebView.RuntimeEvent` from the existing WebView boundary.

The support status is partial. The public event phase contract names the runtime events operators care about, but the current provider cannot portably emit crash, unresponsive, media, file-input, download, or permission-prompt events across macOS, Windows, and Linux. `setAudioMuted` and `respondToPermission` are permission-gated and handle-validated, then return typed unsupported rather than a silent no-op.

Architecture-debt sweep: no `WebViewRuntime` wrapper was added. A separate service would only forward a WebView handle into the same host resource, so the durable boundary remains `WebView`, where native lifecycle callbacks, permissions, owner scope, and bridge event emission already live.
