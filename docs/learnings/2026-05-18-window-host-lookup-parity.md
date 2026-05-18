# Window Host Lookup Parity

Issue: #1348

Window lookup is no longer a renderer/runtime-only cache. The bridge protocol now exposes `Window.getCurrent`, `Window.getById`, and `Window.list` as host-routed methods returning canonical `{ windowId }` payloads, while the native runtime maps those ids back to live `ResourceRegistry` handles before returning public `WindowHandle` values.

The durable rule is that host lookup owns native window identity and ordering, and the TypeScript runtime owns handle freshness. If the host reports an id the runtime did not register or has already closed, the runtime fails with typed `NotFound` instead of fabricating a handle.

Architecture-debt sweep: removed the `runtime-router-only` partial support wrapper from the Window lookup surface. No new follow-up issue was opened in this slice; the remaining #1348 debt is the renderer-facing `Window.events()` publisher and native user-close event stream.
