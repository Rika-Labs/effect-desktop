# Window Renderer Events

`Window.events()` is now a public renderer-facing stream over the same runtime router that owns window open, focus, and close ordering. The bridge event method is `Window.Event`, and the public payload is schema-decoded as `WindowRegistryEvent`.

The stream is intentionally live-only: no replay and sliding drop-oldest backpressure. A `closed` event is terminal for that window id, while `opened` and `focused` are non-terminal.

Architecture-debt sweep: no new custom DSL or wrapper over Effect was added. The existing `AppEventRouter` already owns durable desktop-specific routing and lifecycle policy; this slice exposes that policy through `Stream` instead of adding a parallel event bus.

Remaining #1348 debt: native OS user-close/destroy publication from the Rust host, Rust protocol/router/serde coverage for host-originated window events, permission/capability/audit evidence for the event path, unsupported-platform and host-failure stream tests, and host smoke coverage for native event-loop behavior.
