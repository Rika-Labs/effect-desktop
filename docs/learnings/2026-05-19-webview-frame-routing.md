# WebView Frame Routing

Frame identity needs a real provider primitive. Wry exposes initialization-script frame targeting and some platform backend frame internals, but not a portable public API that creates stable frame handles across macOS, Windows, and Linux.

The shipped shape is therefore validation-first and typed unsupported. `listFrames`, `postToFrame`, and `WebView.FrameEvent` define the public Schema contract and permission boundary, while the host validates WebView and frame handles before returning `host-frame-routing-unavailable`.

Architecture-debt sweep: no `WebViewFrames` wrapper was added. A separate service would only forward WebView and frame handles into the same host resource without owning durable desktop policy. The existing `WebView` boundary remains the owner until the native adapter can create and dispose real generation-stamped frame handles.
