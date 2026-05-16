# Build before release package

## Context

The release workflow packaged the playground desktop app before running `desktop build`.
On a clean runner, packaging reads build output under `apps/playground/build/effect-desktop`, so the workflow depended on local residue rather than declared release steps.

## Change

The release workflow now builds the playground app before packaging it. The release gate also requires the matching `desktop build` command to appear before the matching `desktop package` command, so future workflow edits fail before release packaging can consume missing artifacts.

## Lesson

Release checks should validate producer-consumer order, not only token presence. A command that consumes generated files needs an explicit upstream command in the same workflow.
