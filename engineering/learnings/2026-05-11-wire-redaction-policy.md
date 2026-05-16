# Wire Redaction Policy

## Planned

Issue #852 required configured redaction options to reach framework emission boundaries instead of only the pure redaction helper.

## Shipped

`RedactionFilterOptions` now includes `defaultPatternEnabled`, matching the config policy shape. Bridge handler failures, audit event writes, and telemetry log records accept redaction options and apply them at emission time.

## Review surfaced

The useful boundary is not config parsing. The config type already represented app patterns and allowlists; the missing contract was passing those options into code that emits renderer-visible, audit, or telemetry records.

## Non-obvious lesson

Redaction must sit at the final emission boundary. Redacting earlier leaves later wrappers free to reintroduce unredacted metadata; redacting only in pure helper tests proves the helper, not the system.

## AGENTS.md amendment candidate

None.
