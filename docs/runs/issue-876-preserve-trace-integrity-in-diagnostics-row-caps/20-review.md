# Review

Decision: lock the complete-trace-group design.

## Principle pass

- Correctness: grouping before capping prevents returned parent edges from pointing at dropped spans under the diagnostics `maxRows` cap.
- Minimality: one projection-order change; no telemetry API, trace schema, redaction, or frame interval changes.
- Deep module boundary: `Telemetry` remains the raw retention owner, while `DiagnosticsPanels` owns display projection semantics.
- Observability: devtools stops inventing invalid causality without adding an unmodeled truncation flag.
- Compatibility: public `TraceGroup` shape is unchanged.

## Reality check

The main tradeoff is that `maxRows` becomes "max trace groups" for traces, not "max raw spans." That is the correct tradeoff because the existing API exposes trace groups, and raw-span caps produce false structure. The telemetry ring still bounds retained span count, so this does not remove the memory safety boundary.

## Locked architecture

Apply `maxRows` to `groupTraceSpans(snapshot.traces)`, not to `snapshot.traces`. Add a focused regression that fails on the pre-change behavior and passes only when parent and child are returned together.

Handoff: `/work`
