# Single Instance Activation Contract

Issue #1336 still requires real process-wide lock ownership and second-instance handoff. The safe incremental step was to fix the public event contract so second-instance events carry the activation reason required by the issue.

The TypeScript `AppSecondInstanceEvent` and Rust host-protocol event payload now require `activationReason` with the closed values `launch`, `open-file`, `open-url`, and `unknown`. This keeps renderer-visible decoding strict before a native handoff transport exists.

Guardrail: no single-instance lock, IPC handoff, primary-process event injection, or activation routing behavior is synthesized. `App.requestSingleInstanceLock` remains unsupported+routed from the App host-boundary work.

Architecture-debt sweep: no wrapper was removed. No separate follow-up was opened because #1336 already owns the single-instance split/deepening decision: either deepen the existing App boundary with durable process-ownership semantics or introduce a narrow SingleInstance service without duplicating App events.
