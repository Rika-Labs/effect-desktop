# Derive Production Guards From Source

## Planned

Issue #851 required production guard failures to come from renderer source usage, not only from manually declared contracts.

## Shipped

The production checker now scans renderer files for Appendix K native capability calls that require support guards. Unguarded `Dock` calls such as `Dock.setJumpList(...)` fail `desktop check --production`; prior `Dock.isSupported("setJumpList")` checks satisfy the guard requirement.

## Review surfaced

The original rule only examined declared contracts. That made the production check depend on a human-maintained inventory, while the unsafe call site itself remained invisible.

## Non-obvious lesson

Guard policy belongs next to observable usage. A contract list is useful documentation, but source scanning is the enforcement path that catches omissions.

## AGENTS.md amendment candidate

None.
