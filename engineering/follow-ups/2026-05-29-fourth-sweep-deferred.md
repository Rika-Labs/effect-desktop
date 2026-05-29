# Deferred findings from the fourth (native-security) sweep (2026-05-29)

Fixed in commit alongside this doc: egress-policy control-char path (typed
rejection), job failure-reason leak (bounded/de-stacked), notification.show
cancellable RPC + notification.close uninterruptible critical section (match
tray), diagnostics bundle-less Failed event delivery. The findings below need a
shared refactor or trade off two correct behaviours, so they are captured rather
than rushed.

## 1. (MEDIUM, shared) PermissionDenied collapsed to Internal across native client surfaces

`safe-storage.ts mapSafeStorageRpcClientError` (and the identical `isXError`
predicates in the other native client surfaces, e.g. `path.ts`) require an object
with `tag`/`operation`/`recoverable` keys. The interceptor's `PermissionDenied`
uses `_tag` and lacks those keys, so a missing-grant failure is reported as a
generic `Internal` ("SafeStorage RPC client failed"), discarding
reason/capability/actor/traceId. Enforcement is intact (server still denies); this
is an observability/diagnosis defect that inverts the operator's response.

Fix (shared): add a single helper used by every native client `mapXRpcClientError`
that recognizes `_tag === "PermissionDenied"` (and other interceptor tagged errors)
and translates to a faithful permission-denied HostProtocolError preserving
reason/capability/traceId, before the `Internal` fallback. Because the buggy
predicate is duplicated across surfaces, fix it once in a shared module.

## 2. (MEDIUM) attachment-intake: caller-supplied intakeId clobber + unbounded actor map

`attachment-intake.ts` accepts a caller-supplied `intakeId` and `Map.set`s it
unconditionally, so a second permitted actor can overwrite another actor's intake
and become the stored owner — a confused-deputy on later `inspect`/`dispose`
(which authorize against the stored actor). Separately, the service's
`intakeId -> actor` map is never pruned on expiry (only on explicit dispose), so
never-disposed intakes leak forever and copy-on-write makes ingest O(n).

Fix: never accept a caller-supplied id for the authoritative key (mint server-side),
or atomically reject an id already owned by a different actor; and store `expiresAt`
with the actor and prune lazily on access (or derive ownership from the host rather
than a parallel unbounded map). Needs care with the actor/authorization model.

## 3. (MEDIUM) tray.destroy / notification.close: guard set after the native call (concurrent double-destroy)

In `tray.destroy` (and the parallel `notification.close`) the
`explicitlyDestroyed.add(id)` / `explicitlyClosed.add(id)` guard is set _after_
`client.destroy`/`client.close`. A concurrent scope teardown running the
create-time dispose finalizer does not yet see the guard and issues a second native
destroy/close — violating the documented exactly-once contract (the existing
"exactly once under interruption" test covers interruption, not concurrency).

The simple fix (move the guard before the native call) closes the race but trades
away the current finalizer-retry-on-failure behaviour: if the native call fails
after the guard is set, the finalizer will skip its retry. Choosing exactly-once vs
retry-on-failure is a deliberate decision; if exactly-once wins, set the guard first
and clear it on native-call failure so a failed explicit destroy still gets retried
by the finalizer. (Note: `notification.close` was made uninterruptible in this
batch, which closes the interrupt-strand window but not this concurrent-ordering
race.)

## Low-confidence (latent / not individually tracked)

- attachment-intake: an audit-write failure on the denial path masks PermissionDenied
  as Internal (Effect.andThen sequences only on success) — run the audit emit with
  Effect.ignore so the security failure is preserved.
- diagnostics-bundle: an audit-write failure on the _success_ path of `write` (via
  Effect.tap) converts a committed file write into a reported failure, inviting a
  duplicate privileged write on retry — decouple success-audit failures from the result.
- display-capture: grant.id/traceId/captureId use BridgeSafeNonEmptyString (NUL-only),
  so control chars reach audit records (log-injection/forgery surface); tighten to
  PrintableNonEmptyString like actor.id, or strip control chars in the audit sanitizer.
