# Validate Production Permission Scopes

## Planned

Issue #465 targeted production permission lists that looked scoped but normalized to blank or wildcard values.

## Shipped

The production checker now treats every scope list entry as invalid if trimming makes it blank or `*`. Filesystem write and process spawn rules only pass when every configured entry is concrete.

## Review Surface

The change is confined to `hasScopedList` in `@effect-desktop/config`, with regression coverage for blank roots, trimmed wildcard roots, trimmed wildcard process allow entries, and valid scoped entries.

## Lesson

Scope checks must validate the whole list, not only prove the list is present. One malformed widening entry is enough to make a production policy unsafe.

## AGENTS Amendment Candidate

None.
