# @effect-desktop/config

> **Status:** Phase 16 starts the production security checker; full config
> loading and manifest emission land in later phases. See `docs/SPEC.md`.

## Dependencies

This package depends on `effect` because config validation and production
security checks are framework policy, not plain JSON helpers. Public operations
return typed `Effect` values so CLI adapters can render failures without
throwing or swallowing checker errors.
