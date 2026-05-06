# Capability Grant Lifecycle

## Planned

Issue #42 required permission grants to stop behaving like permanent tokens. Each
grant needed lifecycle metadata, typed revocation outcomes, explicit expiry and
one-time consumption, revocation propagation to in-flight Effect users, and
structured audit rows for lifecycle transitions.

## Shipped

`PermissionRegistry` now issues tracked `GrantedCapability` values with
`grantedAt`, optional `expiresAt`, and optional `oneTime`. The service exposes
`grant`, `revoke`, `inspect`, and `use`; `check` also issues tracked grants after
the existing deny-by-default rule resolution. `use(grant, effect)` validates the
token before work starts and races the work against a per-token revocation
signal, returning `PermissionRevoked` as an Effect failure value for revoked,
expired, or consumed grants.

Lifecycle transitions emit `permission lifecycle` audit rows for grant, use,
revoke, expire, and one-time consumption. Initial grant state is only retained
after the grant lifecycle audit succeeds, so an audit failure cannot leave an
active token that the caller never received. Revocation flips state before audit
because safety favors making the token unusable even when audit persistence
fails.

## Review

The local review found one ordering bug before merge: initial grant state was
written before lifecycle audit completed. That could leave an active token in
memory if audit append failed. The fix moved initial state retention after
successful lifecycle audit and added a regression test that deterministic
`grant-1` is not inspectable after an audit failure.

## Lesson

Permission state transitions need different commit ordering by safety class.
Grant is privilege creation, so audit must succeed before state becomes visible.
Revocation is privilege removal, so state must flip even if audit later fails.
Treating all audit failures the same would either create hidden authority or
delay revocation.

## Candidate Rule

For permission lifecycle code, document whether each state transition creates or
removes authority. Authority-creating transitions must not become visible before
required audit writes succeed; authority-removing transitions must take effect
before best-effort reporting can fail.
