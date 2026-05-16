---
date: 2026-05-05
type: in-flight-feature
topic: Path service contract
issue: https://github.com/Rika-Labs/effect-desktop/issues/25
pr: https://github.com/Rika-Labs/effect-desktop/pull/189
---

# Path service contract

## What we set out to do

Issue #25 asked for a typed Path service for app data, cache, logs, temp, home,
and downloads paths. The invariant was that app code should make one Effect call
for a canonical path while tests can substitute path roots through a Layer.

## What actually ended up working

The implementation adds a `CanonicalPath` schema under
`packages/native/src/contracts/path.ts` and keeps the service itself in
`packages/native/src/path.ts`. The bridge contract preserves schema validation at
the host boundary, while the public `Path` service maps the validated wrapper
back to plain strings so callers get the ergonomic shape that §11.15 implies.
The unsupported host adapter reports missing platform implementation through the
Effect error channel.

```mermaid
flowchart LR
  AppCode[App code] --> Path[Path Effect service]
  Path --> Port[PathClient port]
  Port --> Bridge[Validated host envelope]
  Bridge --> Host[Host platform resolver]
```

## What surfaced in review

No review threads were opened. The local review focused on keeping path lookups
as value-returning Effect calls rather than resource handles, preserving the
substitutable client port, and making the unsupported host adapter return typed
failures instead of throwing.

## First-principles postmortem

A path lookup is a pure query across an effectful boundary. The host owns the
platform-specific resolution and canonicalization; the renderer owns composition
and test substitution. Keeping those roles separate prevents platform branching
from leaking into app code while avoiding a heavier lifecycle abstraction that
paths do not need.

## Game-theory postmortem

Without a Path service, every caller has an incentive to hand-roll the nearest
platform convention and move on. That creates many small forks of path policy.
The service changes the payoff: the easiest call is now the centralized call,
and the fake Layer used in tests exercises the same contract as the host bridge.

## Non-obvious lesson

Native primitives should not all inherit the same lifecycle shape. Dialogs,
clipboard, notifications, and paths all cross the host boundary, but only some
create durable host objects. Path is a value service: validate the host payload
at the boundary, then expose the simplest stable value to callers.

## Reproducible pattern (if any)

For native value lookups:

- keep the schema in `contracts/<primitive>.ts`;
- keep host failures in the Effect error channel;
- use a substitutable client port for tests;
- unwrap validated transport structs at the public service boundary.

## AGENTS.md amendment candidate (if any)

When a native primitive is a value lookup rather than a host object, expose a
plain public value after schema validation and reserve `Api.Resource` for real
lifecycle ownership. Why: resource handles should signal cleanup obligations,
not merely that a host call occurred.

This is a proposal. Review and edit AGENTS.md yourself if you want to adopt it —
`/learn` never auto-edits AGENTS.md.
