## Findings

No blocking or important architecture findings.

## Reality check

- `Dock.isSupported(method)` proves the proposed guard shape already exists in the native package.
- `PowerMonitor` can safely add a request method beside its existing event streams because the bridge contract separates `spec` from `events`.
- Primitive-local method literals keep guard targets typed and avoid a broad shared string enum.
- Permission `"none"` matches the least-authority shape for capability discovery.

## Locked architecture

Add primitive-local `isSupported(method)` guards to `Screen`, `PowerMonitor`, and `SystemAppearance`, with schema-validated method names, `{ supported: boolean }` output wrappers, service-level boolean mapping, unsupported-client false results, bridge envelope tests, and production-checker regression coverage through the existing `isSupportedGuard` contract model.

Handoff: `/work`
