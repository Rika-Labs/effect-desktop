# Add Transient Window Role Broker

Issue: #1377

The durable boundary is the role policy and resource lifecycle, not platform window behavior. The implementation keeps OS adapters fail-closed with typed `Unsupported` responses while exposing a substitutable Effect service that validates policy data, checks permissions, registers generation-stamped resources before visible host work, and disposes them through `ResourceRegistry`.

The main failure mode was ordering: if the host succeeds but the resource is not registered first, later renderer disconnect or scope close cannot clean the role. Registering first and disposing on host failure makes cleanup observable and reversible.

Architecture-debt sweep: no nearby Effect wrapper debt was removed. The touched surface reuses `NativeSurface`, `RpcGroup`, `ResourceRegistry`, `PermissionRegistry`, `Stream`, and Schema contracts directly; no new bridge DSL or parallel resource abstraction was introduced.
