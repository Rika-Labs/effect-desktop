# Distinguish committed command audit failures

## Context

`CommandRegistry.invoke` ran the handler, then wrote the `command-invoked` audit row. If that post-handler audit write failed, callers received `CommandAuditFailed` and snapshots recorded an ordinary failed invocation even though the handler had already committed its side effect.

## Change

Post-handler audit write failures now return `CommandCommittedAuditFailed` and record the invocation outcome as `committed-audit-failure`. Ordinary validation, permission, handler, and output failures still record `failure`. The regression proves the handler runs exactly once, the audit row is absent, and devtools state exposes the committed audit failure distinctly.

## Lesson

Once application code has run, retry semantics change. Error types and state projections must say whether the business action committed, especially when the failing step is only the evidence write after the side effect.
