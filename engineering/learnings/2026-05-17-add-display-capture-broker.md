# Add Display Capture Broker

Issue: #1378

Display capture is a privileged pixel boundary, so the broker is separate from `Screen`. `Screen` reports display topology; `DisplayCapture` owns permission checks, grants, redacted audit metadata, image validation, and typed unsupported behavior.

The useful mechanism is method-specific target schemas. `captureDisplay`, `captureWindow`, and `captureRegion` each decode a target shape that only permits the fields valid for that method. This keeps contradictory target combinations out of the service and host adapter.

The Rust host adapter is intentionally fail-closed. It decodes and validates the same contract, routes through the host method router, and returns typed `Unsupported` until native platform adapters exist.

Architecture-debt sweep: no Effect wrapper debt was introduced. `NativeSurface`, `decodeNativeInput`, and bridge event subscription remain boundary helpers that own native protocol policy. The dormant display-capture contract was replaced with the final method-specific contract during this work.
