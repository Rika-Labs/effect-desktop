## Domain

`DiagnosticsPanels` trace row limiting, because issue #876 shows `maxRows` can project a child span without the parent span in the same trace group.

## Evidence gathered

- GitHub issue #876 - provided a focused reproduction where root and child spans share `traceId`, but `maxRows: 1` returns only the child with `parentSpanId: Some("root")`.
- `packages/devtools/src/diagnostics-panels.ts` - `list()` slices `snapshot.traces` before `groupTraceSpans`, so the cap is applied to raw spans, not trace groups.
- `packages/core/src/runtime/telemetry.ts` - `Telemetry` owns the raw bounded trace ring; it does not own devtools grouping or display caps.
- `docs/learnings/2026-05-06-logs-traces-metrics-panels.md` - prior intent says `DiagnosticsPanels` is a read-only projection over telemetry and should not invent diagnostics.

## Prior art in this repo

`DiagnosticsPanels` already groups spans by `traceId` and sorts spans inside each group by `startedAt`. Existing tests cover redaction, grouped trace display, metrics, and disabled tracing, but do not cover row caps against parent-child span integrity.

## First-principles decomposition

- Primitive facts: a trace group is meaningful only if returned parent edges resolve inside that same group, unless the API marks truncation explicitly.
- Invariants: diagnostics must not display a structurally false trace; logs and metrics remain independently bounded and redacted.
- Constraints: do not change telemetry recording, trace IDs, redaction, frame intervals, or the telemetry ring API.
- Failure modes: raw span caps can orphan children; group caps can return fewer raw spans than `maxRows`, but preserve trace shape.
- Source of truth: telemetry is the raw span source; devtools owns the grouped projection.

## Game board

- Players: framework authors, app engineers using devtools, reviewers enforcing observability truthfulness.
- Incentives: slicing raw arrays is cheap and uniform across logs/traces/metrics; truthful traces need type-aware projection.
- Information asymmetries: devtools sees parent edges after telemetry has already accepted spans; users cannot tell an omitted parent from a real missing parent.
- Bad local move: keep one `slice(-maxRows)` pattern for every diagnostic collection.
- Global cost: incident debugging sees invalid causality and wastes time reconstructing missing context.
- Desired equilibrium: trace caps preserve complete groups unless the public API explicitly reports truncation.

## Library / API / pattern landscape

Trace grouping is local TypeScript collection logic; no external API semantics are involved. The two valid shapes from the issue are complete trace groups or explicit truncation metadata; the existing public API has no truncation field, so complete groups are the compatible path.

## Constraints and edge cases discovered

- `maxRows` currently counts raw spans for traces; changing it to count trace groups can return more spans than `maxRows`.
- `Telemetry` already bounds total retained spans through `traceRingSize`, so group-level display caps do not create unbounded state.
- Redaction must still wrap the final snapshot after grouping.

## Open questions for /interview

1. Should trace group ordering remain first-seen insertion order, or should a later issue define recency by each group's newest span?

Handoff: `/architect`
