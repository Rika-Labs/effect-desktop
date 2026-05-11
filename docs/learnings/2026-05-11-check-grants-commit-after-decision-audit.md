# Check grants commit after decision audit

## Context

`PermissionRegistry.check` used `issueGrant`, which audited and published a grant before the check decision audit was recorded. If the decision audit failed, `check` returned failure while `inspect(token)` still exposed an active grant.

## Change

Grant creation is now split into prepare, lifecycle audit, decision audit, decision recording, and publish. `check` publishes the grant only after lifecycle audit and decision audit both succeed; direct `grant` still uses the same lifecycle audit before publish path.

## Lesson

Permission checks are authority commits. A failed check must not leave usable authority behind, so the grant map update belongs after every required audit/write that defines the check as successful.
