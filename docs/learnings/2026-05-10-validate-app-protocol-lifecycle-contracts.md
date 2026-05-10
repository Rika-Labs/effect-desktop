---
date: 2026-05-10
type: in-flight-bug
topic: Validate App protocol and lifecycle contracts
issue: https://github.com/Rika-Labs/effect-desktop/issues/807
pr: https://github.com/Rika-Labs/effect-desktop/pull/1138
---

# Validate App protocol and lifecycle contracts

## What we set out to do

Close three linked issues by making App-level protocol registration and lifecycle boundaries reject malformed inputs/outputs before they cross process boundaries.
The goal was to keep one canonical scheme contract with the protocol service and to align event and output decoding with declared host error behavior.

## What actually ended up working

The App client now decodes with stricter schemas in `packages/native/src/contracts/app.ts` and `packages/native/src/contracts/protocol.ts`.
Invalid protocol schemes are rejected with `InvalidArgument` before host requests, App output values are decoded with stricter field checks before surfacing to callers, and App lifecycle event streams fail fast as `InvalidOutput` for malformed payloads.

### Validation scope now covered

- `App.registerProtocol` scheme validation shares the protocol scheme filter.
- `App.getInfo` validates `id`, `name`, and `version` before returning a value.
- `App.getCommandLine` validates argv arguments, `cwd`, and prevents empty command strings.
- `AppOpenUrlEvent`, `AppSecondInstanceEvent`, and `AppBeforeQuitEvent` reject malformed host event payloads before stream delivery.
- Regression tests were added for each invalid-case path.

## What surfaced in review

No new correctness defects were introduced by this cluster of changes.
No blocking or major review findings were returned during three review passes.
Existing stricter path for protocol asset roots and resource disposal ordering stayed unchanged in this branch.

## First-principles postmortem

The core invariant is that untrusted host and renderer boundary data is decoded once at the API edge, and only schema-valid values reach the typed runtime core.
Sharing a stricter protocol-scheme schema between App and Protocol contracts removes divergence between otherwise duplicated validation logic.

## Game-theory postmortem

When validation is not centralized, callers are incentivized to trust transport responses and carry invalid state forward.
Centralized schema checks make the safe move cheap and make malformed payload handling observable as an explicit typed failure instead of a silent success.

## Non-obvious lesson

`Schema` constraints are only safe when they match runtime usage semantics; for URLs we must validate parseability and reject embedded NUL bytes explicitly, not just regex shape, because malformed but parseable-looking strings can still be structurally unsafe at runtime.

## Reproducible pattern (if any)

For host/bridge boundaries: define a narrow schema type once, reuse it wherever the same contract appears, and assert failure with typed errors before any serialization or stream emission.

## AGENTS.md amendment candidate (if any)

None.
