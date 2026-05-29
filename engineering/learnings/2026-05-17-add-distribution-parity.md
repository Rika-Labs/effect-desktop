---
date: 2026-05-17
type: feature
topic: Add distribution parity verification
issue: https://github.com/Rika-Labs/effect-desktop/issues/1374
pr: None; merged directly to main per local workflow
---

# Add DistributionParity

## Decision

Distribution parity should verify shared capability evidence rather than create a second plugin packaging model.

## What changed

The native surface accepts one package capability contract plus evidence rows for package artifacts, plugin registration, templates, and docs. The TypeScript service owns Schema validation, permission checks, audit rows, and test substitution. The Rust host owns the final boundary check that every evidence row carries the same capability set and points at non-empty JSON evidence whose own `capabilities` array matches, with optional SHA-256 digest verification.

## Why it mattered

The release artifact, plugin SDK shape, templates, and docs can drift unless they share one explicit contract. Making the capability set the thing that crosses every boundary gives tests and operators one artifact to compare.

## Architecture-debt sweep

No nearby wrapper debt was removed. The touched surface reuses `NativeSurface`, `RpcGroup`, Effect `Layer`/`Stream`, Schema contracts, and `PermissionRegistry` directly. No custom bridge DSL, release DSL, or Effect wrapper was added.
