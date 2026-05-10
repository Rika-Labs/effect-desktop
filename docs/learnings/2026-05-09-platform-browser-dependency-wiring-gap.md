---
date: 2026-05-09
type: in-flight-feature
topic: Adopt @effect/platform-browser IndexedDB modules in renderer
issue: https://github.com/Rika-Labs/effect-desktop/issues/1086
pr: https://github.com/Rika-Labs/effect-desktop/pull/1115
---

# Adopt @effect/platform-browser IndexedDB modules in renderer

## What we set out to do

Add `@effect/platform-browser` as a renderer dependency so apps get typed, schema-driven IndexedDB storage without pulling in the full WASM SQLite payload. The architecture required `DesktopProvider` to mount `BrowserContext.layer`, dedicated `storage/idb.ts` and `storage/kv.ts` modules, renderer template updates, and behavioral tests for persistence, migration, and round-trip.

## What actually ended up working

PR #1115 shipped only the dependency addition and re-exports:
- Added `@effect/platform-browser@4.0.0-beta.60` to `packages/react`
- Created `platform-browser.ts` as a pure re-export barrel
- Re-exported symbols from `packages/react/src/index.ts`
- Added ADR-0009
- Added smoke tests verifying `typeof` exports and descriptor shapes

The planned provider wiring, storage modules, and template updates were not implemented in this PR. The follow-up work was captured in issue #1130.

## What surfaced in review

- **Round 1**: One major summary finding (PR claimed to close #1086 but only implemented dependency addition) and one major inline finding on `index.test.ts:155` (tests only verify export shape, not actual IndexedDB behavior).
- **Address**: Changed PR body from "Closes #1086" to "Related to #1086" and created follow-up issue #1130.
- **Push back**: The testing comment was pushed back because adding behavioral IndexedDB tests requires `fake-indexeddb` or jsdom infrastructure not present; adding new dev dependencies needs an ADR per AGENTS.md §4.7, which was out of scope for a dependency-addition PR.
- **Rounds 2–3**: Zero new findings after the scope was corrected.

## First-principles postmortem

The invariant at risk was **truth in labeling**: a PR that claims to close an issue must implement the issue's architecture. The original PR body created a false source of truth by saying "Closes #1086" while the diff contained none of the modules the issue architecture required. The review caught this mismatch before merge, but the mismatch should have been visible to the author at PR creation time.

The deeper invariant is that **re-exported third-party symbols cannot be tested for correctness with `typeof` checks alone**. `typeof BrowserHttpClient.layerFetch === "object"` tells you the symbol exists, not that it works. Smoke tests are fine for dependency-addition PRs, but they must be labeled as such and paired with a follow-up issue that requires behavioral verification.

## Game-theory postmortem

The local incentive is to ship small PRs quickly and claim issue closure for velocity credit. The bad equilibrium is a repo where issues are "closed" by dependency-addition PRs and the actual architectural wiring is never tracked. The mechanism that prevented this was the code-review requirement to compare the PR diff against the issue architecture. The reviewer (automated) treated the issue as source of truth and flagged the mismatch.

The testing comment revealed another incentive asymmetry: it is cheaper to write `typeof` tests than behavioral tests, but `typeof` tests create false confidence for future contributors. The pushback was defensible only because the missing test infrastructure (fake-indexeddb) requires its own dependency decision (ADR). The correct equilibrium is to require behavioral tests in the same PR that introduces the wiring, not in the dependency-addition PR.

## Non-obvious lesson

A dependency-addition PR and an architecture-wiring PR are different scopes. If you split them, the first PR must never claim to close the parent issue. The correct pattern is: dependency PR → "Related to #N", wiring PR → "Closes #N". Also, `typeof` smoke tests for re-exported third-party modules should include a code comment or test description that explicitly labels them as smoke tests, so future contributors do not mistake them for behavioral coverage.

## Reproducible pattern

1. Open issue with full architecture.
2. If splitting into dependency PR + wiring PR, dependency PR body uses "Related to #N" and creates follow-up issue for wiring.
3. Smoke tests for re-exports are named `"<module> exports are reachable"` rather than `"<module> works correctly"`.
4. Behavioral tests are required in the wiring PR, not the dependency PR.

## AGENTS.md amendment candidate

When a PR adds a new dependency and re-exports third-party symbols without wiring them into the application, it must not use closing keywords (`Closes`, `Fixes`, `Resolves`) for the parent issue. Use `Related to` or `Part of` instead, and create a follow-up issue for the wiring work. Why: closing keywords hide architectural debt by marking issues complete before the architecture is implemented.
