# Preserve Approval Failures as Effect Results

Issue: #1163

## What changed

React permission approval no longer throws resolver failures through a detached microtask. Resolver
completion now runs through `Effect.runPromiseExit(...)`, returns `Exit`, and stores per-token
`AsyncResult` state for prompts.

The approval workflow payload also stopped accepting raw `Schema.Unknown` capability and actor
fields. It now decodes with the existing `NormalizedCapability` and `PermissionActor` schemas, and
deferred completion uses `DurableDeferred.Token.make(...)` instead of a token cast.

## What mattered

The important boundary was not "catch promise rejection." It was "approval completion is data."
Once completion is data, React can render waiting/failure/success without a second error callback,
and Effect keeps typed failures, defects, and interruption in one shape.

Review caught the UI race that the first pass missed: two same-token clicks can happen before React
state re-renders a waiting prompt. The final hook uses a ref-backed in-flight promise map so
same-tick duplicate approvals share the same `Exit`.

```ts
const existing = inFlightRef.current.get(token)
if (existing !== undefined) {
  return existing
}

const run = Effect.runPromiseExit(
  Effect.suspend(() => resolver(approval.token, approved, approval))
)
inFlightRef.current.set(token, run)
```

## Review changes

Review changed the implementation in three places:

- pending approvals and resolution results now live in one reducer-style snapshot, so duplicate
  notifications cannot erase visible failures;
- same-token resolver calls are de-duped with an in-flight promise guard;
- workflow payload schemas now remove the nearby capability/actor assertions found during the
  architecture-debt sweep.

## Architecture-debt sweep

Removed here: `onResolveError`, detached `queueMicrotask` throws, unused `ApprovalDecision`, approval
workflow `Schema.Unknown` capability/actor payloads, and the `DurableDeferred.Token` cast.

Follow-up opened: #1294 tracks the unrelated ReactDesktop endpoint/support `unknown as` cast found
in the broader React sweep.

## Rule

When UI code starts an Effect from an event handler, capture completion as `Exit` data and guard
same-token or same-resource submissions with synchronous state outside React render state.
