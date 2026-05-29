# Add Activation Surface Registry

Issue: #1376

The durable boundary is activation routing, not the UI primitive that produced the activation. The implementation keeps platform adapters fail-closed with typed `Unsupported` responses while exposing a substitutable Effect service that validates surface data, checks permissions, registers resources, and routes events through `CommandRegistry`.

The main failure mode was bypassing command permission context with direct callbacks. The registry stores the activation surface as data and uses the command registry for routing, so audit, permission checks, validation, and failure records stay in one path.

Architecture-debt sweep: no nearby Effect wrapper debt was removed. The touched surface reuses `NativeSurface`, `RpcGroup`, `ResourceRegistry`, `PermissionRegistry`, `CommandRegistry`, `Stream`, and Schema contracts directly; no new bridge DSL or parallel activation abstraction was introduced.
