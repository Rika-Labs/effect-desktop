# @orika/config

> **Status:** Active desktop config schema, merge policy, CSP renderer, and
> production security checker. See `engineering/SPEC.md`.

## Purpose

Typed `desktop.config.ts` helpers and production policy checks. The package owns
config shape validation, decoded config merging, default CSP rendering,
weakened-CSP detection, and structured production check reports for the CLI.

## Dependencies

This package depends on `effect` because config validation and production
security checks are framework policy, not plain JSON helpers. Public operations
return typed `Effect` values so CLI adapters can render failures without
throwing or swallowing checker errors.
