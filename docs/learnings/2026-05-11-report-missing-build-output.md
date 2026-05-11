# Report Missing Build Output

## Planned

Issue #765 required `desktop package` to report a missing build prerequisite when `app-manifest.json` has not been produced, instead of leaking a low-level JSON read failure.

## Shipped

Package preflight now checks for the build manifest before parsing it. Missing build output fails as `PackageMissingBuildArtifactError` with remediation to run `bun desktop build` first; existing manifest validation still runs when the file exists.

## Review surfaced

The package pipeline already validated manifest contents, but validation started by reading JSON. An absent prerequisite artifact is a different failure mode than malformed JSON.

## Non-obvious lesson

Preconditions need their own error boundary. If a command requires a prior artifact, check the artifact exists before using a parser as the existence test.

## AGENTS.md amendment candidate

None.
