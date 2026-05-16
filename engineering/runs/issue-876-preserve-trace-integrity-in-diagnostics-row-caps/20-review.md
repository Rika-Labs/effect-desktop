# Review

Decision: lock the bounded parent-chain projection design.

## Principle pass

- Correctness: selecting the capped raw tail and required ancestors prevents returned parent edges from pointing at dropped spans under the diagnostics `maxRows` cap.
- Minimality: one projection-order change; no telemetry API, trace schema, redaction, or frame interval changes.
- Deep module boundary: `Telemetry` remains the raw retention owner, while `DiagnosticsPanels` owns display projection semantics.
- Observability: devtools stops inventing invalid causality without adding an unmodeled truncation flag.
- Compatibility: public `TraceGroup` shape is unchanged.

## Reality check

The main tradeoff is that a trace group may contain ancestor spans outside the capped raw tail. That is the correct tradeoff because the existing API exposes parent edges, and raw-span caps produce false structure. The telemetry ring still bounds retained span count, and the projection only groups selected spans, so this does not remove the memory safety or frame-cost boundary.

## Locked architecture

Apply `maxRows` to the raw span tail, include required parent spans from earlier in the ring, then group selected spans. Add focused regressions that fail on the pre-change behavior and on first-seen trace ordering.

Handoff: `/work`
