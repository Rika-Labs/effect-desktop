# ADR-0009: Adopt effect/unstable/workflow and replace bespoke Job service (T08)

## Status

Accepted

## Context

`packages/core/src/runtime/job.ts` hand-rolls long-running task supervision: progress streams, owner scopes, cancellation, retry, and ad-hoc state recovery. It cannot survive process restarts; a crashed runtime loses in-flight jobs entirely. Desktop flows like updates, installs, permission approvals, and crash submissions are exactly the use-cases that need durable resumption after a restart.

`effect/unstable/workflow` (announced April 2026) ships `Workflow.make`, `Activity.make`, `Activity.retry`, `DurableClock.sleep`, `DurableDeferred`, `DurableQueue`, and `Workflow.withCompensation`. Workflows survive process restarts when backed by a journal. The API is alpha-quality at the time of this decision.

The framework must ship v1.0.0 before the workflow API is fully stable. The chosen model is: adopt for non-critical flows now with the memory engine; gate critical flows (updater, installer) until the API stabilizes.

## Decision

Replace the `Job` service with `Workflow.make` + `Activity.make`. The default v1 engine is in-memory (no SQL or cluster dependency).

- App authors register workflows via a `workflows: [...]` array on `Desktop.app({...})` (T20 spine).
- The framework wires them into the runtime layer with a single `WorkflowEngine` provided.
- Memory engine ships for v1: no new infrastructure required.
- Upgrade path to SQL-backed journal: when T02 (`SqlClient`) is available, the journal can optionally back workflow state without touching workflow definitions.
- Upgrade path to cluster engine: when T29 (`effect/unstable/cluster`) is adopted, `ClusterWorkflowEngine` is a drop-in swap — workflow definitions do not change.
- `Workflow.withCompensation` defines rollback behavior. Compensation ordering is the only new authoring concept; the framework documents it as the canonical recovery pattern.
- Migration shims translate existing `Job` call-sites to `Workflow.make` adapters for incremental adoption.

Cross-links: [ADR-0003](adr-0003-sql-effect-unstable-sql.md) (optional SQL journal backend), [ADR-0018](adr-0018-cluster-multi-window.md) (ClusterWorkflowEngine swap when cluster lands).

## Alternatives considered

**Keep bespoke `job.ts`**: cannot survive restarts; scaling to durable flows requires reimplementing the upstream module. Rejected.

**Adopt immediately for all flows including updater/installer**: the alpha API creates unacceptable churn risk for the most critical desktop flows. Deferred.

**Use a third-party workflow library** (Temporal, Inngest): heavyweight infrastructure dependency for a desktop app context. Rejected.

## Consequences

**Positive**

- Durable resumption from restart is structurally correct with the journal-backed engines.
- `Workflow.withCompensation` makes rollback semantics explicit and auditable.
- Memory engine ships v1 with zero infra.
- Workflow definitions are forward-compatible: same code, swap the engine.

**Negative**

- `effect/unstable/workflow` is alpha. API churn is possible before the updater/installer migration gate.
- Engine-specific adapters add a short-lived engine surface.

**Neutral**

- `TestClock`-backed test helpers for `DurableClock.sleep` and `DurableDeferred` are a required companion (see `@effect-desktop/test` planning).

## Validation

Port one non-critical flow (e.g., crash submission) to `Workflow.make`. With the memory engine, validate in-process recovery semantics only: a transient activity failure followed by `Activity.retry` must resume the workflow within the same runtime instance, and `Workflow.withCompensation` must run on terminal failure. Cross-restart resume validation is reserved for the SQL/cluster engine upgrade path — the memory engine carries no journal and cannot satisfy that criterion. `job.ts` call-sites are replaced with adapter shims; no test references the deleted internals.

## Migration notes

1. Delete bespoke supervision logic from `packages/core/src/runtime/job.ts`.
2. Add `effect/unstable/workflow` to `packages/core`.
3. Implement `Workflow.make` + `Activity.make` wiring in the spine.
4. Expose `workflows: [...]` on `Desktop.app({...})`.
5. Write adapter shims for existing `Job` call-sites.
6. Track the alpha stability gate: once stable, migrate updater/installer flows.
