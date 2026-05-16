# Settings migration duration

## Planned

Close issue #560 by preventing migration event timing metadata from escaping the Settings error model as a schema-constructor defect.

## Shipped

Settings migration duration is now computed before constructing `SettingsMigrated`. Backward elapsed time from a non-monotonic injected clock is clamped to `0`, and non-finite elapsed time fails as `SettingsMigrationFailedError`.

## Review surfaced

The migration body and version write were not the unsafe part. The unsafe boundary was event metadata construction after the migration succeeded, where invalid timing could die outside the typed Settings error channel.

## Lesson

Schema classes are validation boundaries, not error mapping boundaries. Compute and classify metadata before constructing event objects when the source can be injected or externally controlled.

## AGENTS.md amendment candidate

None.
