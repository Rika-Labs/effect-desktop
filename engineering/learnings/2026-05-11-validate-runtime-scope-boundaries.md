# Validate Runtime Scope Boundaries

## Planned

Issues #465, #469, and #470 covered scope-like strings that cross runtime boundaries: production permission scopes, Shell paths, and resource owner scopes.

## Shipped

Production permission scope lists now reject blank and wildcard-shaped entries after trimming. Shell NUL path rejection was already present and re-verified. The bridge resource handle schema already rejects empty owner scopes; this change adds generic client coverage so the invariant is pinned at the shared resource decode boundary.

## Review Surface

The only behavior change is `@orika/config` scope-list validation. The bridge test is coverage for existing schema behavior and does not change public API shape.

## Lesson

Scope strings are authority labels. Normalize them before policy checks and reject missing ownership before renderer state can hold a proxy.

## AGENTS Amendment Candidate

None.
