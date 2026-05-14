## Review Summary

No findings.

## Lanes

- Correctness: guard methods cover the Appendix K non-✓ OS-state rows named by the issue.
- Testing: native tests cover service mapping, bridge envelopes, and unsupported-client false answers; config tests cover guarded partial contracts.
- Maintainability: method literals stay primitive-local and follow the existing Dock guard shape.
- Project standards: Effect service/layer patterns remain consistent; errors stay typed in existing channels.
- Security: guard methods use permission `"none"` and expose capability only, not OS state.
- Previous findings: platform capability probes remain adapter-owned; this PR adds the typed SDK surface without introducing shared Linux environment facts.

## GitHub Review

Posted as a no-findings review on PR #856.

Handoff: `/address`
