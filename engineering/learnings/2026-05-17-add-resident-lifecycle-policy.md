# Add Resident Lifecycle Policy

Issue: #1375

The durable boundary is lifecycle policy, not a shortcut around `App.quit`, tray presence, or window close handlers. The implementation keeps OS adapters fail-closed with typed `Unsupported` responses while exposing a substitutable Effect service that validates policy data, checks permissions, registers an enabled policy resource, and exposes state/events through Schema contracts.

The highest-risk failure mode was complecting process lifetime with window lifetime. The contract names those separately: `process`, `windows`, and `background` are explicit fields, so callers cannot infer resident behavior from a window close callback or a tray item.

Architecture-debt sweep: no nearby Effect wrapper debt was removed. The touched surface reuses `NativeSurface`, `RpcGroup`, `ResourceRegistry`, `PermissionRegistry`, `Stream`, `Layer`, and Schema contracts directly; no new bridge DSL or parallel lifecycle abstraction was introduced.
