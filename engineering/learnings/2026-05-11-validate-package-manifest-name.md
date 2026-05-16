# Validate Package Manifest Name

## Planned

Prevent `desktop package` from consuming a staged build layout whose display name differs from the active config.

## Shipped

Package build-layout validation now treats `app-manifest.json#name` as part of the app identity alongside id, version, and target. The regression rewrites only the staged manifest name and proves packaging fails before artifact commands run.

## Lesson

Package identity is the whole user-visible app identity, not just the fields that affect paths. If a later release step relies on a staged manifest, validate every identity field before producing artifacts from it.
