# Issue #1163: Preserve Approval Failures as Effect Results

## Intent

Permission approval resolution must not throw resolver failures outside Effect supervision. The
React approval hook should run resolver effects to `Exit`, expose completion as `AsyncResult` data,
and leave prompt rendering to React.

## Current State

- `packages/react/src/permission-approval.ts` calls `Effect.runPromise(...).then(...)`.
- Failed resolver effects are routed through an optional `onResolveError` callback or rethrown with
  `queueMicrotask`.
- `PermissionApprovalState` only exposes `pending`, `push`, and fire-and-forget `resolve`; resolver
  failures are not observable state.
- `packages/react/src/mutation.ts` already shows the local idiom: `Effect.runPromiseExit(...)`
  captures completion as `Exit` and stores failure `Cause` in React state.

## Plan

1. Replace the resolver object side channel with a direct Effect resolver function:
   - `ApprovalResolver<E> = (token, approved, approval) => Effect.Effect<void, E, never>`.
   - remove `onResolveError` and the detached `queueMicrotask` throw path.
2. Add typed completion state to `PermissionApprovalState<E>`:
   - `resolutions: ReadonlyMap<string, AsyncResult.AsyncResult<void, E>>`;
   - `resolvePromise(token, approved): Promise<Exit.Exit<void, E>>`;
   - keep `resolve(token, approved): void` for button handlers;
   - add `clearResolution(token)` so consumers can prune completed tokens.
3. Run decisions through `Effect.runPromiseExit(Effect.suspend(() => resolver(...)))`:
   - unknown tokens are a no-op `Exit.succeed(undefined)`;
   - resolving tokens record `AsyncResult.initial(true)`;
   - success removes the approval from `pending` and records `AsyncResult.success(undefined)`;
   - failure keeps the approval pending and records `AsyncResult.failure(exit.cause)`.
4. Pass each token's current resolution into `PermissionApprovalPromptProps<E>` so custom prompts can
   render or report failures without an out-of-band callback.
5. Update tests, public exports, and the React API snapshot.

## Architecture-Debt Sweep

- Remove now: `onResolveError`, because it is a thin React callback that duplicates Effect failure
  handling.
- Remove now: unused `ApprovalDecision`, unless implementation needs it after the resolver rewrite.
- Keep: `usePermissionApproval` and `PermissionApprovalQueue`, because they own React UI state and
  event integration rather than reimplementing Effect.
- Remove now: `Schema.Unknown` approval workflow payload fields for capability/actor by using the
  existing `NormalizedCapability` and `PermissionActor` schemas directly.
- Remove now: `rawToken as DurableDeferred.Token` in the approval workflow by using
  `DurableDeferred.Token.make(rawToken)`.
- Follow-up opened: #1294 tracks the unrelated ReactDesktop endpoint/support `unknown as` cast found
  during the broader React sweep.

## Verification

- A failing resolver returns a failed `Exit`, stores `AsyncResult.failure`, keeps the approval
  pending, and does not throw through `queueMicrotask`.
- A successful resolver returns a successful `Exit`, stores `AsyncResult.success(undefined)`, and
  removes the approval from `pending`.
- A synchronously throwing resolver is captured as a failed `Exit`/`Cause`.
- Unknown tokens do not call the resolver and return `Exit.succeed(undefined)`.
- `PermissionApprovalQueue` passes `resolution` to `renderPrompt`.
- `rg "queueMicrotask" packages/react/src/permission-approval.ts` finds nothing.
- Focused React tests and full local validation pass before pushing.
