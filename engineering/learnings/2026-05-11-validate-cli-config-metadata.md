# Validate CLI Config Metadata

## Planned

Close CLI validation gaps for doctor config paths, doctor app metadata, and package metadata control characters.

## Shipped

Doctor now rejects config paths that resolve outside the workspace before import and treats empty `app.id`, `app.name`, or `app.version` as a config probe failure. Package planning now rejects control characters in `app.name` before Linux package metadata writers receive the value.

## Review Surface

The config file format did not change. Invalid config that previously produced false-green doctor output or injectable package metadata now fails at the CLI boundary.

## Lesson

Diagnostic commands still execute trust boundaries. A preflight that imports config must prove the config belongs to the workspace and meets the same minimum metadata contract used by downstream workflows.

## AGENTS.md Amendment Candidate

None.
