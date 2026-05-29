# Native RPC Support Truth

The WebView, Menu/ContextMenu, and SafeStorage surfaces had typed Effect RPC contracts that were broader than the Rust host methods actually implemented. Capability metadata must describe executable host behavior, not the intended public API shape.

The correction marks direct `WebView.*` RPCs unsupported because the Rust host currently attaches the app WebView during `Window.create` and does not dispatch WebView methods. It keeps `Menu.setApplicationMenu` and `Menu.setWindowMenu` supported while marking unrouted Menu and ContextMenu commands unsupported. It also keeps `SafeStorage.isAvailable` supported while marking secret read/write/list/delete methods unsupported until a real host adapter exists.

The durable guardrail is the parity test that rejects any method marked `supported` or `partial` while its host route is missing. That invariant catches the expensive failure mode: a prerelease TypeScript contract becoming operator-facing truth before native behavior exists.

Architecture-debt sweep: no wrapper was removed. `WebView`, `Menu`, `ContextMenu`, and `SafeStorage` still own real boundary contracts, validation, event routing, or platform policy. The remaining debt is missing host adapters and method routes tracked by the open parity issues; unsupported metadata is the production-safe state until those adapters exist.
