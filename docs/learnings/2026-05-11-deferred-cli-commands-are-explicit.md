# Deferred CLI commands are explicit

## Context

Several commands listed in the spec fell through as unknown root invocations. That made `desktop <command> --help` and automation probes ambiguous because missing implementation looked the same as a typo.

## Change

The CLI now registers every currently deferred spec command by name: `init`, `dev`, `typecheck`, `lint`, `test`, `info`, `generate-types`, `migrate`, `clean`, `inspect`, and `replay`. Each command has command-specific help and returns a structured `CliDeferredCommand` error, including JSON output.

## Lesson

Public command names should be owned even before their behavior is complete. A typed deferred response is a stable contract; a generic unknown-command failure is drift.
