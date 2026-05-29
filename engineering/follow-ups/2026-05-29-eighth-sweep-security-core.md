# Eighth sweep — permission/resource security core (2026-05-29)

Fixed (commit 9f9e8a63ad): permission-interceptor denial mis-attribution (now keeps the
PermissionRevoked grant's actor/traceId/reason and threads the request context for the
fallback), system-appearance host-error unwrap tier, and activation-registry's premature
"routed" audit (now emitted after the gated command succeeds). The system-appearance fix
has a revert-checked test; the interceptor + activation fixes are verified by typecheck +
the 42 existing security tests + additive reasoning (dedicated tests below).

## Open — deep / risky (deliberate treatment required)

### 1. (HIGH) resources.ts: reusing a disposed id while a shared handle is alive collides cleanup groups

`availableRegistrationId` only checks the live entries map, so an id becomes reusable as soon
as it leaves that map — even while a previously-shared cleanup group with the same id is still
referenced in the RcMap (a shared handle holds it). `cleanupGroupId = id` then makes the new
resource share the old RcMap key + `cleanupPlans` slot: the new resource's disposer is deferred
until an unrelated shared handle disposes, and the original source's disposer is overwritten and
never runs (silent native leak; cross-scope mis-attribution). Verified by reproduction.

Fix: decouple `cleanupGroupId` from the public resource id — generate an independent never-reused
id per register (share keeps referencing the source's), so `cleanupGroupId = id` can't collide;
or make `availableRegistrationId` also reject an id whose cleanup group is still RcMap-referenced.
This touches the registry's identity model + the share/dispose semantics and must be done under
the lifecycle semaphore with the agent's exact share→dispose→re-register→dispose test. Central,
high-blast-radius — not a fatigue-time change.

### 2. (MEDIUM) permission-registry.ts: non-atomic grant transitions (lost-update) and one-time double-use

`transitionGrant`/`expireIfNeeded` do `Ref.get` then `Ref.set` rebuilt from the stale snapshot,
so a concurrent `use()` addWaiter / `publishGrant` / consume committed in the window is clobbered.
Consequences: a revoke-during-use can fail to signal the in-flight use (check-then-revoke bypass);
a concurrent `publishGrant` can be dropped; and a one-time grant can pass the active gate twice
(double-use). Fix: replace get+set with a single `Ref.modify` that reads the live entry, performs
the status check + transition, and returns the waiter list to signal atomically; have the consume
transition report whether THIS call won so `prepareGrantUse` fails the loser with reason "consumed".
Subtle concurrency on the security core — needs careful design + interleaving tests.

### 3. (MEDIUM) permission-interceptor.ts: grants map grows unboundedly

`registry.check` runs per guarded RPC and `publishGrant` does `grants.set(token, ...)` with no
deletion path (only status mutates in place). The sibling audit `decisionRows` is bounded
(`.slice(-1024)`); the grants map is not. Fix: evict terminal-status grants on transition, cap the
map, or scope each grant to the RPC lifetime (acquireRelease).

### 4. (MEDIUM) activation-registry.ts: unregisterSurface authorizes/audits against the registrant, not the caller

`ActivationSurfaceRequest` carries no caller actor, so unregister is authorized and audited against
`surface.registration.actor` (whoever registered it) — confused-deputy attribution. Fix: add a
caller `actor` to the request and authorize/audit against it (or record registrant as resourceOwner
while attributing the decision to the caller).

### 5. (systemic) RpcClientError host-error unwrap tier missing on ~12 native surfaces

Only app/native-client/screen/power-monitor (+ now system-appearance) unwrap a host error wrapped
in an RpcClientError via `hostProtocolErrorFromRpcClientError`; crash-reporter, dock, global-shortcut,
notification, path, tray, safe-storage, shell, updater, webview flatten it to Internal, losing
tag/recoverable for retry/classification. Mechanical consistency sweep: add the unwrap tier to each
(verifying each surface actually routes wrapped host errors). Note this subsumes the deferred
sweep-4 safe-storage mapping finding.

## Deferred dedicated tests for the shipped fixes

- permission-interceptor: start `registry.use(grant, neverEndingEffect)` through the interceptor for
  actor window-main, concurrently `revoke` the token, assert the surfaced PermissionDenied has
  actor.id "window-main", a real traceId, and reason "revoked" (not app/unknown/PermissionRevoked).
- activation-registry: register a surface, route with a command handler that fails (or a denying
  permission context), assert routeActivation fails AND no `kind:"permission-used", outcome:"routed"`
  audit row was emitted.

## Low confidence

- permission-interceptor: invalid-capability / invalid-context denials bypass `registry.check` and so
  emit no permission-denied audit — exactly the forged/malformed attempts an operator wants to see;
  emit an audit event on those paths.
- cookie-store: CookieName/Value/Domain/Path use NUL-only `BridgeSafe*`, permitting CR/LF control
  chars into the platform cookie store; tighten to `PrintableNonEmptyString`/`PrintableString` like
  app.ts/activation-registry already do for identifiers reaching native surfaces.
