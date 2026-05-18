# Window Event Reconciliation

`Window.events()` now reconciles host-originated `Window.Event` frames with the TypeScript `ResourceRegistry`. An `opened` event registers a live window handle when the renderer has not seen that id before, and a terminal `closed` event closes the live window scope when the handle exists.

The durable rule is that event observation must update the same resource table that command responses use. A lifecycle stream that only reports text ids lets renderer state drift from native state; the event adapter now either returns a live handle or explicitly leaves the event handle-free when no local handle exists for non-terminal focus.

Architecture-debt sweep: no wrapper over Effect was added. The bridge client layer now composes the existing `WindowClient` with `ResourceRegistry` reconciliation instead of adding a parallel registry. Remaining #1348 debt is end-to-end close-request delivery evidence under the existing exit policy plus explicit permission/audit proof for event subscription.
