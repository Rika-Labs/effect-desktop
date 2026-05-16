# Bound command-binding warnings

## Context

Native command bindings must keep listening after handler failures, but the warning attributes logged the full command or native error object. Handler failures can carry application causes, so the log payload became an unbounded sink for stack and payload detail.

## Change

GlobalShortcut, Menu, and ContextMenu warnings now pass errors through one small normalizer that keeps only `tag`, `operation`, `commandId`, `method`, and `recoverable` when present. The command-binding resilience behavior is unchanged.

## Lesson

Warning logs at framework boundaries need their own data contract. Passing an error object to structured logging delegates redaction to the logger, which is the wrong owner for application payload safety.
