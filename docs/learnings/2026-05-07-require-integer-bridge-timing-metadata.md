---
date: 2026-05-07
type: in-flight-decision
topic: Require integer bridge timing metadata — code-review catches architecture rationalizations
issue: https://github.com/Rika-Labs/effect-desktop/issues/498
pr: https://github.com/Rika-Labs/effect-desktop/pull/702
---

# Require integer bridge timing metadata — code-review catches architecture rationalizations

## What we set out to do

Bridge contract registration accepted fractional millisecond values for `timeoutMs` and `cachedResultMs`, forcing every downstream consumer (scheduler, cache, generated docs, error messages) to make its own rounding decision. Issue #498 closed the gap: registered ms metadata must be finite, non-negative, and integral, enforced at the existing `validateMethodSpec` boundary with a typed `InvalidApiContractSpec` failure.

## What actually ended up working

The locked architecture proposed appending a `Number.isInteger` predicate to the existing finite/non-negative branch. The first implementation did exactly that — kept all three predicates `(!Number.isFinite || < 0 || !Number.isInteger)`. Then `/code-review` flagged two issues that survived `/architect` and `/review`:

1. The `Number.isFinite` predicate was redundant. `Number.isInteger` already returns `false` for `NaN`, `Infinity`, and `-Infinity`. Both rejection branches produced the same error string, so the architecture's stated rationale ("keeping both makes the error message diagnostic") didn't actually deliver distinct diagnostics. The existing `validateBackpressureSpec` at `contracts.ts:359` had already settled on the simpler `(!Number.isInteger || < 0)` idiom — the new code was inadvertently diverging from it.
2. The architecture's Verification clause claimed "existing zero-value tests stay green," but no such test existed in the file. `validMethodSpec()` used `timeoutMs: 30_000`; zero was a meaningful sentinel (`handlers.ts:364` treats `timeoutMs === 0` as non-cancellable / immediate) but had no regression test.

Both findings became Address commits (`b91b612` simplified the validator, `0de2a18` added the zero-value test). The mermaid still describes the flow.

## What surfaced in review

Zero inline review threads from external reviewers. Two summary-level self-findings posted by `/code-review`, both verdict Address. No pushbacks, no escalations. The two findings were not catastrophic — both were small simplifications and one missing test — but each pointed at an architecture-level claim that turned out to be wrong on contact with the code.

## First-principles postmortem

The invariant that mattered: registered ms metadata is integer-valued. The assumption that changed during the cycle: "my /architect rationale survived /review, therefore the design is correct." That assumption was wrong twice in this small PR. The source-of-truth thing that became clearer: when an architect justifies keeping a predicate "for diagnostic clarity," the diagnostic message must actually differ between predicates — otherwise the predicate is dead weight, regardless of how confident the prose sounds. Same shape for "existing tests stay green" claims: verifiable by `grep`.

## Game-theory postmortem

Players: architect (me), reviewer (me), code-reviewer (me), implementer (me) — a single agent wearing four hats serially. The information asymmetry I created for myself: when `/architect` made a derivation-flavored claim ("keep both for diagnostic clarity"), `/review` reading my own output had no incentive to fact-check it because the prose was internally coherent. `/code-review` had a stronger incentive: it reviews the _implementation_ against the architecture's claims, and when those claims are concrete-enough to verify (one error message vs two; a test exists vs doesn't), the code-review lens catches what review missed. The mechanism that aligned behavior: `/code-review`'s discipline of grounding every claim against the actual file at `file:line` precision. Bad equilibrium avoided: a smaller PR shipping with a redundant predicate and an untested zero-value sentinel — both small, both easy to never notice — would have set the wrong precedent for future hardening PRs.

## Non-obvious lesson

`/architect` and `/review` both run on prose. `/code-review` runs on diff. When an architecture statement is concrete enough to be verified against the codebase ("error messages differ", "existing tests cover X", "the regex uses `*` because empty is rejected upstream"), `/architect` rationalizing it and `/review` agreeing with the rationalization is not enough — neither stage is incentivized to grep. `/code-review` is. Plan the workflow as three stages with different proof obligations rather than two stages of "design lock" plus one stage of "look for typos."

## Reproducible pattern

When an architecture proposal says any of the following, treat the claim as a Verification step that must be grounded against the code, not as a design decision that's already proven:

1. "Existing tests for X stay green" — `grep` for X first.
2. "Keeping both checks makes the error message diagnostic" — confirm the messages actually differ.
3. "This matches the existing pattern at file:line" — verify line:line numerically; the cited line may have moved.
4. "Out of scope, separately tracked" — confirm a separate issue exists or accept the deferral explicitly.

If the architecture cannot prove these claims with evidence at the time it's written, mark them open and let `/code-review` close them — don't lock them silently into the design.

## AGENTS.md amendment candidate

`/architect` claims of the form "existing X stays green," "messages remain distinct," or "matches pattern at file:line" must be grounded by `rg`/`grep` at the time the architecture is locked, not deferred to `/code-review`. Why: the design-locking stages run on prose; concrete-but-unverified claims survive into the issue body and propagate as false architectural confidence.

This is a proposal. Review and edit AGENTS.md yourself if you want to adopt it — `/learn` never auto-edits AGENTS.md.
