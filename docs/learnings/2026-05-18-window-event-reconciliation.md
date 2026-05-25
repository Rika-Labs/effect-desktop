# Window Event Reconciliation

`Window.events()` now reconciles host-originated `Window.Event` frames with the TypeScript `ResourceRegistry`. An `opened` event registers a live window handle when the renderer has not seen that id before, and a terminal `closed` event closes the live window scope when the handle exists.

The durable rule is that event observation must update the same resource table that command responses use. A lifecycle stream that only reports text ids lets renderer state drift from native state; the event adapter now either returns a live handle or explicitly leaves the event handle-free when no local handle exists for non-terminal focus.

Architecture-debt sweep: no wrapper over Effect was added. The bridge client layer composes the generated Window RPC client with `ResourceRegistry` reconciliation instead of adding a parallel registry. Event subscription uses the internal `Window.subscribeEvents` wire permission as the audit gate before opening the canonical `Window.events.Event` stream. The Rust host close-request branch now shares a tested helper that queues the terminal window event before returning the lifecycle value consumed by the existing exit policy.
