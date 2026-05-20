# WebView Document Controls

WebView document controls belong on the retained `WebView` resource. `print` and `setZoom` now route through the existing WebView service and the host window event loop to the Wry WebView that owns the native page.

The rest of the document-output surface is intentionally explicit about provider limits. Wry 0.55.1 exposes no portable public screenshot capture, PDF export, find-in-page, or runtime user-agent setter. Effect Desktop therefore validates permission, payload, and handle ownership for `captureScreenshot`, `printToPdf`, `findInPage`, and `setUserAgent`, then returns typed unsupported with stable reasons instead of pretending those operations succeeded.

Architecture-debt sweep: no `WebViewDocument` service was added. A separate service would only forward a WebView handle back into the same retained resource, so it would add a shallow wrapper over Effect RPC and `WebView`. The durable boundary remains `WebView`; no removable adapter or bridge DSL debt was found in the touched area.
