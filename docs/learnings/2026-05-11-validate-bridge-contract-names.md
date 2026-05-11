# Validate Bridge Contract Names

## Planned

Issues #457, #458, #460, and #461 covered bridge contract metadata that must be valid before clients, handlers, and resource lifecycles are generated.

## Shipped

Empty permissions and blank tags, methods, events, and resource labels were already covered. This change added positive `cachedResultMs` enforcement for idempotent methods, rejected control characters in contract tags and resource labels, and rejected dotted or control-character method and event names.

## Review Surface

`packages/bridge/src/contracts.ts` now has one printable-name predicate and a stricter wire-segment predicate for method and event keys. Tags may still contain dots because existing public tags use dotted namespaces.

## Lesson

Contract names become protocol addresses and log labels. Validate them at registration, before a malformed name can become client surface or lifecycle state.

## AGENTS Amendment Candidate

None.
