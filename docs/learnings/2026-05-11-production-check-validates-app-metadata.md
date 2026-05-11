# Production check validates app metadata

## Context

`desktop check --production` loaded a config as a security-only shape. A config with missing required app metadata could pass the production security report even though build, package, and doctor paths rejected it.

## Change

The production check now validates the app metadata baseline before loading renderer files or running security rules. Missing `app.id`, `app.name`, or SemVer `app.version` returns the same structured `BuildConfigError` shape used by config-loading failures. The React Tailwind template now declares `app.version`.

## Lesson

Production readiness checks must validate the release identity before specialized policy checks. A passing security report is misleading when the app cannot be built or packaged as a valid release artifact.
