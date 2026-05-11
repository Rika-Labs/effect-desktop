# Accessibility Evidence Boundaries

## Planned

Close the gaps where accessibility evidence could be shaped like valid data while carrying invalid meaning.

## Shipped

The accessibility gate now rejects contrast `minimumRatio` values outside the finite `0 < ratio <= 21` range before comparing colors. Manual keyboard audit screencasts must be regular files, so a `.webm` or `.mp4` directory no longer satisfies the release gate.

## Review Surface

Both checks stay in the CLI accessibility gate because that is the public boundary accepting release evidence. The implementation does not change contrast math, audit URL semantics, or media codec validation.

## Non-Obvious Lesson

Filename suffix checks are not evidence checks. When a gate verifies an artifact, it must validate the filesystem object that carries the evidence, not just the string that names it.

## AGENTS.md Amendment Candidate

None.
