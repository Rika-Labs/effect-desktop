## Verdict

LOCKED.

## Findings

No blocking findings.

## Pressure Test

- Simplicity: changing existing schemas is smaller and clearer than adding an imperative preflight validator.
- Boundary correctness: validating both native and bridge schemas prevents direct bridge clients from bypassing the SDK boundary.
- Compatibility: valid existing `windowBackground` payloads still encode the same request shape.
- Failure semantics: invalid chrome remains `InvalidArgument` in the existing typed host-protocol error channel.
- Scope: the change does not touch native adapters, app config defaults, or unsupported Window mutators.

## Locked Architecture

Use schema refinements and literals at the two request boundaries. Add regression tests that assert invalid title, vibrancy, and traffic-light offsets fail before the exchange records a host request.

Handoff: /issue
