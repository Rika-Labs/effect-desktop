# Contain Window State Bundle Paths

## Planned

Close #693 by preventing derived window-state paths from treating `bundleId` as a path program.

## Shipped

Default window-state path construction now validates bundle IDs before joining platform state-root segments. It rejects empty names, traversal, separators, control bytes, and Windows drive separators. Explicit `WindowStateOptions.path` remains unchanged.

## Review

`makeWindowState` now fails with `WindowStateInvalidArgumentError` for invalid derived bundle IDs, while `WindowStateLive` uses the valid default and preserves a no-error layer. Tests pin both direct `defaultWindowStatePath` rejection and typed service-construction failure.

## Lesson

An app identifier is a namespace, not a path segment. Validate names before joining paths so containment does not depend on caller intent.
