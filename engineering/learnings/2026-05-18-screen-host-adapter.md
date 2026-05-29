# Screen Host Adapter

Issue: #1327

The Screen surface now has a routed Rust host adapter for display enumeration, primary display lookup, pointer position, support probing, and display-change events. The host adapter keeps monitor work on the Tao event-loop thread, returns Schema-shaped payloads through the existing bridge path, and treats Linux Wayland pointer position as unsupported because Tao returns a placeholder coordinate there.

Architecture-debt sweep:

- Inspected the touched Screen service, bridge client, host-protocol payloads, Rust host router, Tao event-loop adapter, parity metadata, docs, and test harness for thin wrappers, custom DSLs, bridge specs, and parallel abstractions over Effect.
- Removed no wrapper layers. `ScreenSurface` still uses `NativeSurface` because that helper owns durable desktop policy: permission metadata, host runtime construction, bridge event subscription, Schema contracts, and parity documentation.
- The Rust `WindowMethodHandler` additions remain a boundary adapter, not an Effect wrapper. They keep Tao display work on the native event-loop thread and translate OS/host behavior into protocol payloads.
- Existing follow-up #1393 remains the shared event-aware bridge-client consolidation item; this ticket reused `subscribeNativeEvent` directly and did not add a new event DSL.
