# Validate ContextMenu.show Position Coordinates

## Planned

Issue #813 required `ContextMenu.show` to reject coordinates that cannot safely cross the bridge. The planned contract was finite logical pixels before request construction, with a decision on whether negative coordinates are valid.

## Shipped

`ContextMenuPosition` now uses a private coordinate schema requiring a finite number greater than or equal to zero. Bridge tests cover `NaN`, positive infinity, negative infinity, negative `x`, and negative `y` as `InvalidArgument` failures with no recorded request. Existing valid-path tests now use fractional coordinates to preserve subpixel logical-pixel placement.

PR: https://github.com/Rika-Labs/effect-desktop/pull/832

## Review

Code review found no issues. CI passed on Ubuntu, macOS, and Windows.

## Lesson

Coordinate contracts need to name their coordinate space. For `ContextMenu.show`, window-local logical pixels make negative coordinates invalid; a future screen-global API should use a separate contract instead of widening this one.

## AGENTS.md Amendment Candidate

None.
