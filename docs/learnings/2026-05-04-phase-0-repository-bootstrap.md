---
date: 2026-05-04
type: feature
topic: Phase 0 repository bootstrap — monorepo, workspaces, CI gate
issue: https://github.com/Rika-Labs/effect-desktop/blob/main/docs/SPEC.md
pr: https://github.com/Rika-Labs/effect-desktop/compare/7e1183e...bd7298e
---

# Phase 0 repository bootstrap — monorepo, workspaces, CI gate

> **Note on artifact shape.** This cycle did not use the `/issue → /work → /pr → /code-review → /address → /learn → /merge` chain. Work was driven directly from the build spec at `docs/SPEC.md` §24.0 via `/plan` → execute → `/code-review against the local changes` → fix → push to `main`. There is no GitHub issue and no GitHub PR. The "issue equivalent" is the spec milestone; the "PR equivalent" is the three-commit range `7e1183e...bd7298e`.

## What we set out to do

Establish the monorepo foundation defined by `docs/SPEC.md` §24.0 — root `package.json` with Bun workspaces, Turbo task graph, TypeScript base config, Cargo workspace with four stub crates, nine stub TypeScript packages matching the §6 ownership matrix, an initial `docs/` skeleton, and a CI skeleton — such that `bun install`, `bun run check`, and `cargo check --workspace` succeed from a fresh checkout. Strict scope: no Effect-using code, no native window, no real CLI, no templates with content. The goal was structural fidelity for every phase that depends on Phase 0, which is every later phase.

## What actually ended up working

The plan stated `workspaces` would be narrowed to `packages/*` only to avoid empty workspace dirs breaking `bun install`. The shipped version includes the full four-glob shape from §5.4: `["apps/*", "apps/examples/*", "packages/*", "templates/*"]` — corrected during code review when the premise was empirically refuted (Bun ignores glob matches without `package.json`).

The plan specified `tsconfig.base.json` would have `lib: ["ESNext", "DOM"]`. Shipped: `lib: ["ESNext"]` only, with DOM types added in `packages/react/tsconfig.json` as a renderer-only override. The maintainability reviewer caught this as a complecting violation — DOM globals would have silently typechecked inside `@effect-desktop/core`, a Bun-runtime-only package.

The plan said CI would intentionally exclude clippy, fmt, and lint to "avoid scope creep" and run only the spec's four required commands. Shipped: CI runs the full extended gate — `bun run check`, `lint`, `format:check`, plus `cargo fmt --check` and `cargo clippy -D warnings`. The testing reviewer flagged the local/CI asymmetry; the plan's "lighter CI for Phase 0" assumption was overridden.

The plan listed `Cargo.toml` `repository` as staying at the spec's `https://example.invalid/effect-desktop` placeholder. Shipped: the real GitHub remote `https://github.com/Rika-Labs/effect-desktop` once the user confirmed a remote already existed.

The plan made no mention of SHA-pinned third-party actions, `permissions: contents: read`, Dependabot, `tests/repo-shape.test.ts`, `AGENTS.md`, or `.gitattributes`. All shipped — the first three from the security reviewer, the test from the testing + maintainability reviewers, `AGENTS.md` as the durable home for the stub-marker contract, and `.gitattributes` after a Windows CI failure exposed CRLF normalization as part of the gate's contract.

The architectural intent of Phase 0 — the structural bootstrap that every later phase inherits — did not shift. The §24.0 deliverable list still maps 1:1 to the shipped tree. No mermaid was in scope (Phase 0 is structure, not behavior); no diagram replacement is needed.

The planning cycle did well to lock the §6.10 ownership matrix into nine stub packages and four crates from day one, and to write a strict "what is out of scope" boundary. It missed the security-hardening surface (action pinning, workflow permissions), the testing-infrastructure surface (the repo-shape contract), and the platform-portability surface (Windows CRLF) that emerged only under multi-agent review and CI matrix execution.

## What surfaced in review

Six parallel reviewers (correctness, testing, maintainability, project-standards, security, previous-findings) surfaced 18 raw findings; deduplication merged three pairs of overlapping findings to leave 14 distinct items. All 14 were addressed before push; zero pushback, zero escalations.

Recurring categories: CI/local asymmetry (CI initially lacked `check`, `lint`, `format:check`, `cargo clippy`, `cargo fmt`); supply-chain pinning (`setup-bun` version, `rust-toolchain` channel, GitHub Action SHAs, Cargo cache key); and durability of follow-ups (deferrals tracked only in an uncommitted plan file have no durable home).

The three highest-leverage findings — the ones whose absence would have caused real downstream pain — were the DOM leak in `tsconfig.base.json`, the workspaces glob narrowing, and the repo-shape test institutionalizing the stub-marker deletion contract. Each closed off a quiet drift that would have compounded across phases.

Two post-push CI failures were discovered on runners no reviewer simulated: the Windows runner's default `core.autocrlf=true` converted LF to CRLF on checkout, breaking `prettier --check` with `endOfLine: "lf"` (fixed by `.gitattributes`); and a GitHub deprecation annotation flagged `actions/checkout@v4` and `actions/cache@v4` as still running on Node 20 (fixed by bumping to v6.0.2 and v5.0.5).

## First-principles postmortem

The invariant under threat was structural fidelity across all phases — workspaces shape, tsconfig boundaries, CI gate scope, supply-chain posture. Phase 0 sets defaults that every later phase inherits without question; if those defaults are wrong, downstream phases either waste effort correcting them or compound the error invisibly.

The assumption that changed was workspace-glob narrowing. The plan said "narrow because empty globs break Bun." Reality: Bun ignores glob matches without `package.json`. The assumption was untested before being encoded as a deviation from a normative spec section. The planner reasoned about the failure mode instead of running a 30-second experiment that would have refuted it. This is the cycle's clearest first-principles failure: a defensive deviation justified by reasoning rather than by an empirical check.

The information missing early was a "first-principles validation" step between plan approval and execution. The plan was written from the spec text alone; nothing in the workflow asks the planner to verify each spec deviation empirically before committing to it. A single `mkdir -p tmp/empty/apps && bun init tmp/empty -y && cd tmp/empty && cat > package.json <<'EOF' { "workspaces": ["apps/*"] } EOF && bun install` would have closed the assumption. The same gap explains the Windows CRLF surprise — no one verified the gate against a Windows checkout state before the first CI run.

## Game-theory postmortem

The local incentive that caused friction: the planner optimized for "ship Phase 0 fast and avoid spec deviations causing failures." Narrowing the glob and trimming CI both look like defensive under-scope. They were actually _over_-deviation — departures from the spec made to avoid failures that were never tested for. The cost of reversing each deviation fell on the reviewers; the planner paid no cost for proposing them. The mechanism that aligned this: six independent reviewers in parallel with narrow personas, deduped only at the merge point. Three reviewers independently flagged the workspace-narrowing — the _convergence_ is the signal. A single reviewer might have deferred to the planner's caution; six with different lenses surfaced the assumption regardless.

The bad equilibrium avoided: without review, Phase 1's contributor would inherit a `workspaces` glob that silently never registers `apps/playground`, a CI gate that doesn't run clippy (so lint debt lands invisibly), and a base tsconfig that lets DOM globals leak into runtime packages. Each is a small drift; compounded across phases, they erode the structural contract. Phase 0's reviewers blocked all three at the moment they were cheapest to fix.

The bad equilibrium discovered: even six-reviewer fan-out has a platform-diversity blind spot. The Windows CRLF failure wasn't caught by any reviewer — they all reasoned about `.prettierrc` and `bun test` in isolation, none simulated a Windows checkout. CI matrix execution found it; review did not. Future reviews should explicitly include a "platform-portability check" persona, even at structural milestones.

The mechanism that should be tightened: a "spec-deviation justifier" rule at plan-approval. Any line in the plan that deviates from a normative spec section must include an empirical test result, not a reasoned justification. This shifts the cost of validation from the reviewer (who has to reverse the deviation) to the planner (who has to verify it once). It would have caught the workspaces narrowing at plan-approval, before the plan ever reached execution.

## Non-obvious lesson

The validation gate's portability surface extends beyond tool config to include platform-sensitive text normalization. The plan verified "all gates pass locally" on macOS, but `prettier --check` with `endOfLine: "lf"` failed on Windows runners where `core.autocrlf=true` (the GitHub-runner default) converts LF to CRLF at checkout. No reviewer caught this because they reasoned about `.prettierrc` and `bun test` in isolation, without simulating Windows checkout state. The non-obvious insight: if a validation gate cares about any textual property that varies by platform — line endings, encoding, path separators — that property must be pinned at checkout time, not just in the linter config. `.gitattributes` with `* text=auto eol=lf` is not a convenience; it is part of the gate's contract on day one of any repo whose CI matrix includes Windows.

## Reproducible pattern (if any)

When a validation gate includes file-format checks (prettier, eslint with format rules, rustfmt), commit `.gitattributes` with `* text=auto eol=lf` in the same change that introduces the gate, and verify the gate against the platform's default checkout settings — `core.autocrlf=true` on Windows; `core.autocrlf=false` elsewhere — before declaring the gate complete. Test on the actual CI matrix runner, or simulate locally by toggling `git config --local core.autocrlf true` and re-checking. The pinning policy is part of the gate, not a polish step.

## AGENTS.md amendment candidate (if any)

Add to the "Validation gate" section: "When the validation gate includes any text-format check, the same change must commit `.gitattributes` pinning checkout-time line endings, and the gate must be verified on the same CI matrix that will run it. **Why:** Local single-OS verification will not catch line-ending mismatches that the Windows runner introduces via the default `core.autocrlf=true`; the cost of discovery is one full CI cycle, paid every time."

This is a proposal. Review and edit AGENTS.md yourself if you want to adopt it — `/learn` never auto-edits AGENTS.md.
