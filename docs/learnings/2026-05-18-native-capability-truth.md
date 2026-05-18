# Native Capability Truth

Issue #1320 was resolved by making doctor consume the same generated parity matrix that native reference docs expose.

The important constraint was avoiding a second capability registry. `NativeCapabilities` already owns declared TypeScript support metadata, and #1319 added a generated matrix that joins that metadata to the Rust host router. The parity matrix Schema contract now lives in `@effect-desktop/core`, native re-exports it, and the generator writes the same JSON to the docs tree and to `packages/cli/src/native-parity-matrix.json`; doctor decodes the bundled CLI copy and reports the total, host-routed, and missing route counts from that artifact.

What changed:

- `desktop doctor` has a `native-capabilities` probe.
- The probe reports the same counts as `docs/reference/native/parity-matrix.md`.
- JSON doctor output is Schema-encoded from `DesktopDoctorReport`.
- JSON doctor output includes evidence pointing at `packages/cli/src/native-parity-matrix.json`.
- Missing or malformed capability truth fails doctor as `missing`; known host-route gaps are warnings with counts.
- Public doctor callers receive `DoctorCapabilityTruthUnavailable` when the bundled parity matrix is missing or malformed.
- CLI docs describe `DesktopDoctorReport` and the native capability probe.

The mechanism matters because capability reporting is only useful when it is tied to the executable host boundary. A hand-maintained doctor table would drift; decoding the generated matrix keeps the operator-facing report coupled to the source checked by tests.

Architecture-debt sweep: removed the duplicate CLI-local parity schema before merge by moving the parity matrix contract to `@effect-desktop/core` and re-exporting it from native. The touched area adds a doctor probe over that shared Schema artifact rather than introducing a parallel DSL or convenience API. The remaining support-truth debt is the known set of missing Rust host adapters already tracked by the open parity issues.
