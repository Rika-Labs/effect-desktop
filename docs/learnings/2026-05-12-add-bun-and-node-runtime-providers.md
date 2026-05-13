---
date: 2026-05-12
type: refactor
topic: Add Bun and Node runtime providers
issue: https://github.com/Rika-Labs/effect-desktop/issues/1213
pr: none
---

# Add Bun and Node runtime providers

## Decision

Runtime selection should have exactly one launch contract, and that contract must be the same thing the package validator and host use to decide what process starts.

## What changed

The plan started with Bun and Node provider support plus normalized launch data. Review showed that emitting both `runtime` and `runtimeManifest` created two launch contracts that could drift, and validating `entry` while launching `args` left a hole. The shipped shape makes `runtimeManifest` canonical: CLI build writes it, package validation checks it, and the Rust host reads it for packaged apps. The core runtime graph selects upstream `BunServices.layer` or `NodeServices.layer` directly and removed the zero-policy `runtime/platform.ts` wrapper.

## Why it mattered

The invariant was not just "Node can be selected"; it was "the selected provider is the single source of truth across config, build, package, and host startup." If validation checks one field while launch consumes another, the system incentivizes local fixes that pass tests but leave packaged apps unsafe or surprising.

## Example

```json
{
  "runtimeManifest": {
    "engine": "node",
    "entry": "runtime/main.js",
    "executable": "node",
    "args": ["runtime/main.js"],
    "env": {}
  }
}
```

Package validation and the host both require `args` to equal `[entry]`, reject traversal paths, and reject executable/engine drift.

## Rule candidate

When a manifest field drives process launch, validation must consume the same field and reject duplicate legacy fields that can become a second source of truth.

This is a proposal. Review and edit AGENTS.md yourself if you want to adopt it — `/learn` never auto-edits AGENTS.md.
