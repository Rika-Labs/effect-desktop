# System Appearance Host Boundary

Issue #1334 still requires real host-backed appearance snapshots and OS change events. The safe incremental step was to add the Rust host boundary without changing capability truth.

The host protocol now declares current SystemAppearance methods and payloads, and the Rust host routes them. Snapshot methods decode void payloads before failing closed as typed Unsupported errors; `isSupported` decodes the method enum and returns `{ supported: false }`. Parity is now unsupported and routed.

Guardrail: no synthetic appearance, accent color, reduced motion, or reduced transparency values are returned. The event source remains absent, and event shape parity with the full snapshot is still debt.

Architecture-debt sweep: no wrapper was removed. The TypeScript service remains the public Effect boundary. Remaining debt is the native platform adapters, full snapshot event shape, permission/audit coverage, event ordering/replay, and host-backed tests.
