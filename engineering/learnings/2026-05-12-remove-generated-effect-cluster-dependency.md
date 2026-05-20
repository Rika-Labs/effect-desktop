---
date: 2026-05-12
type: in-flight-refactor
topic: Remove generated @effect/cluster dependency
issue: https://github.com/Rika-Labs/effect-desktop/issues/1177
pr: none
---

# Remove generated @effect/cluster dependency

## Decision

Generated projects should not invent package boundaries for Effect APIs that already live
inside the canonical `effect` package.

## What changed

`create-orika --include-cluster` no longer writes `@effect/cluster` into the
generated `package.json`. The scaffold still pins `effect@4.0.0-beta.60`, which is the
package that owns `effect/unstable/cluster`.

The regression tests now assert both sides of that boundary: `effect` remains present and
`@effect/cluster` remains absent when cluster support is selected.

## Why it mattered

The scaffold is copied into new projects, so a wrong dependency there becomes a repeated
teaching bug. Even if the runtime code imports the right module, generated manifests were
still telling users to depend on a package the repo does not use.

## Rule candidate

When a template or scaffold exposes an Effect feature, test the generated manifest against
the actual upstream package boundary, not just the import string in source.

This is a proposal. Review and edit AGENTS.md yourself if you want to adopt it.
