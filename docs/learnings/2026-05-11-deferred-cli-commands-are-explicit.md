# Deferred CLI commands are not public surface

## Context

Several commands listed in the spec were registered before they had behavior. That made `desktop <command> --help` and automation probes look supported even though the command could only return a deferred error.

## Change

The CLI now exposes only implemented commands. Reserved commands such as `init`, `dev`, `typecheck`, `lint`, `test`, `info`, `generate-types`, `migrate`, `clean`, `inspect`, and `replay` stay unknown until they have real behavior.

## Lesson

Public command names are behavior contracts. A typed deferred response still creates surface area; an unimplemented command should remain unknown until the implementation exists.
