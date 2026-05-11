# Release Evidence Is Gate-Specific

## Planned

Close release-gate cases where malformed checklist JSON, unchecked evidence strings, or workflow script text could distort `desktop check --release`.

## Shipped

The release gate now decodes `release/checklist.json` before semantic validation, parses checklist evidence into known sources with non-empty anchors, rejects evidence that is not accepted for the specific gate, and validates only real workflow `uses` step references instead of shell script comments.

## Review Surface

The release checklist shape and required gate list did not change. The verifier now treats the checklist report as the artifact being proven: every row must be known, concrete, source-backed, and specific to its gate.

## Non-Obvious Lesson

Global token checks are useful defense in depth, but they do not make the report truthful. Reviewers follow the evidence rows in the report, so each row must prove its own gate.

## AGENTS.md Amendment Candidate

None.
