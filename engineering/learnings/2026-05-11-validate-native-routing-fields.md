# Validate Native Routing Fields

## Planned

Reject ambiguous native UI routing and badge payloads before app code or host adapters observe them.

## Shipped

Notification click/action events now reject blank `ownerWindowId` values when the field is present. Dock badge text now uses `null` as the only clear signal and rejects empty strings in both the TypeScript native contract and Rust host adapter.

## Lesson

Optional routing fields are not the same as blank routing fields. Keep absent metadata distinct from malformed metadata, and reserve one explicit clear representation for platform state.
