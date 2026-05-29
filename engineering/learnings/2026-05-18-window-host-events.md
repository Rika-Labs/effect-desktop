# Window Host Events

The Rust host now owns the native `Window.Event` wire payload and emits registry events for host open, OS-confirmed focus, destroy, and queued native close-request transitions. The event payload is strict serde data: `{ type, phase, windowId, terminal }`.

The durable rule is that native lifecycle events must originate where native lifecycle state changes. The TypeScript router still owns renderer handle freshness and routing policy, but the host no longer hides native focus or close-request transitions from the runtime event stream.

Architecture-debt sweep: no wrapper over Effect was added. The host event sender mirrors the existing screen/tray runtime-event sender pattern and carries native event-loop protocol semantics. Remaining #1348 debt is reconciling host-originated `Window.Event` frames into live TypeScript `ResourceRegistry` handles, proving end-to-end close-request delivery under the existing exit policy, and adding permission/audit evidence for renderer event consumption.
