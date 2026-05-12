---
date: 2026-05-11
type: in-flight-decision
topic: Codify the Layer-first framework contract
issue: https://github.com/Rika-Labs/effect-desktop/issues/1227
pr: https://github.com/Rika-Labs/effect-desktop/pull/1253
---

# Codify the Layer-first framework contract

## What we set out to do

Issue #1227 set out to turn the Layer-first thesis into a reviewable contract: public effectful capabilities depend on Effect service requirements, providers arrive as layers, boundary data is schema-coded, expected failures are typed, and at least one existing capability proves Live, Client, and Test substitution without changing user code.

## What actually ended up working

The final code matches the issue architecture in substance: the Layer-first contract became a canonical checklist, `README.md` and `AGENTS.md` point contributors to it, and the proof uses one user-level `Effect.Effect<string, ScreenError, Screen>` program that runs unchanged under live, client/RPC, and deterministic test layers.

Two details changed from the issue text. First, the service example was corrected from `Effect.Service` with an `effect` option to the repo's Effect v4 baseline: `Context.Service<..., ...>()(..., { make })`. That aligns the contract with the actual API shape the repo now treats as normative. Second, the "Provider Layer" box in the issue diagram became more explicit in the shipped proof: `ScreenLive` is supplied by either a direct `ScreenClientApi` layer or `makeScreenBridgeClientLayer(...)`, while `TestScreen.layer(...)` supplies the same requirement without native host state.

The original mermaid diagram still describes reality at the abstraction level: app code depends on a service requirement, and layers satisfy it. The sharper model is: user program -> `Screen` requirement; `ScreenLive + direct client`, `ScreenLive + RPC client`, and `TestScreen` all provide that same requirement.

## What surfaced in review

Addressed: 1 internal review finding. Pushed back: 2 internal findings. Escalated: 0. Published GitHub review threads produced no actionable comments; the only PR comments were docs preview bot output, and the posted review body had no findings.

The valid issue changed the final design language: `docs/architecture/layer-first-contract.md` incorrectly referenced `Effect.Service`, while vendored Effect v4 and repo code use `Context.Service`. The fix updated the contract, `AGENTS.md`, `docs/SPEC.md`, and `tests/layer-first-contract.test.ts`, making the rule executable instead of merely documented.

The two pushed-back findings were invalid because they compared docs-deploy files against stale local `main`, not the actual PR base. Those files were not in the PR diff, so they did not change scope or design.

## First-principles postmortem

The invariant was that "Layer-first" cannot be a slogan; every public capability must be reviewable as a typed, substitutable Effect service with live, client, and test implementations. The changed assumption was the primitive name: the architecture assumed `Effect.Service`, but the actual repo and vendored Effect v4 source prove `Context.Service` is the canonical service constructor.

The alignment mechanism was to move the contract into one canonical document, then make it executable with doc-shape validation, a `Screen` substitution test, and gate exclusions for vendored/generated paths. That converts preference into a failing check.

## Game-theory postmortem

The local incentive causing friction was reviewers optimizing against their local checkout and issue text instead of the PR's true base and installed dependency reality. That made stale `main` look like scope creep and made copied examples look authoritative when the code said otherwise.

The bad equilibrium avoided was endless style debate where every capability re-litigates the thesis and reviewers reward textual consistency over runnable substitution. Future review should first check source-of-truth order, dependency reality, base branch freshness, and whether the claimed invariant has an executable proof.

## Non-obvious lesson

Normative docs are production code when agents implement from them: an incorrect API spelling in SPEC/AGENTS would have become the repo's strongest instruction unless the installed Effect source and repo-local service patterns were treated as higher-fidelity evidence.

## Reproducible pattern (if any)

Ground normative examples against installed source, not memory.
Cross-check against existing repo usage before changing contracts.
Turn corrected doc contracts into small tests that ban the stale spelling.
Scope root gates to authored code; treat vendored/generated trees as external.

## AGENTS.md amendment candidate (if any)

Normative Effect examples in SPEC/AGENTS/contract docs must be grounded against vendored Effect source and at least one repo-local usage before merge, with a guard test for stale API spellings when practical. Why: agents copy normative examples, so doc drift becomes implementation drift.

This is a proposal. Review and edit AGENTS.md yourself if you want to adopt it — `/learn` never auto-edits AGENTS.md.
