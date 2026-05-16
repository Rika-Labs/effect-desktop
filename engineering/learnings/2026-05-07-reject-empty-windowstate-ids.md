---
date: 2026-05-07
type: in-flight-bug
topic: Reject empty WindowState IDs — proxy assertions hide read-order bugs
issue: https://github.com/Rika-Labs/effect-desktop/issues/599
pr: https://github.com/Rika-Labs/effect-desktop/pull/710
---

# Reject empty WindowState IDs — proxy assertions hide read-order bugs

## What we set out to do

`WindowState.persist`, `restore`, and `clear(windowId)` accepted empty and whitespace-only window IDs, writing nameless rows into `window-state.json` that could not be re-bound to a live window on restore. Issue #599 closed that gap by validating `windowId` at the API boundary via a `decodeWindowId` helper backed by a typed `WindowStateInvalidArgumentError`. The architecture preserved `clear()` no-arg as a valid full-wipe and excluded `restoreAll()` (no input). The locked predicate was `Schema.String.check(Schema.isPattern(/\S/))` — a single-predicate form chosen by `/review` after it caught the redundancy that pairing `Schema.NonEmptyString` with `/\S/` would have introduced.

## What actually ended up working

Implementation matched the architecture exactly. The mermaid diagram still describes reality: `decodeWindowId` is the only seam to the store, called as the first statement in `persist`, `restore`, and `clear` (when arg supplied). The single mid-flight change was the `/review` predicate simplification — `Schema.NonEmptyString.check(Schema.isPattern(/\S/))` → `Schema.String.check(Schema.isPattern(/\S/))` — which honored the recurring lesson from `2026-05-07-require-integer-bridge-timing-metadata.md`. Tests evolved during `/address`: the original "before any I/O" tests proved "before any write" only — the empty-directory setup made the no-read invariant invisible because `readStore` ENOENT-shortcircuits to a default empty store with no observable side effect. The addressed version seeds a corrupt JSON file (`writeFile(path, "{")`), then asserts the file is unrenamed (`readdir(directory).toEqual(["window-state.json"])` and `readFile(path) === "{"`). That assertion only holds if validation ran before `read`, because any read would trigger the existing corrupt-rename code path. The `expectInvalidArgument` helper gained an `expectedOperation` parameter so the typed error's `operation` field is pinned per call site.

## What surfaced in review

Two inline review threads, both Address verdicts, zero pushbacks, zero escalations. (1) Major: tests asserted `readdir([]) === []` thinking they pinned "before any I/O," but the empty-directory setup made the no-read invariant invisible — a regression that moved validation below `read` would still pass. Addressed via corrupt-file seeding. (2) Minor: `expectInvalidArgument` only checked `instanceof`; a regression swapping operation literals between call sites would pass every test. Addressed by threading `expectedOperation` through the helper. Three nits posted summary-only (single-shape whitespace coverage, `clear()` no-arg negative assertion, discarded validated value) — none addressed; they were diagnostic improvements rather than diff-line defects, and the `/review` predicate-redundancy preemption already addressed the highest-value structural concern.

## First-principles postmortem

The invariant that mattered: validation runs before any read or write of durable state. The assumption that changed mid-cycle: "if I assert no file was written and the test fails, I've proven validation ran first." Wrong. The failure mode "read happens before validation" produces no write either, because validation failure aborts the rest of the body. The test asserts the right outcome (no file) but fails to distinguish cause (validation succeeded) from outcome (any abort path before write). The source-of-truth thing that became clearer: a test's evidence is its setup-plus-assertion pair. An empty directory plus a `readdir([])` assertion produces no evidence about read order, even if both halves seem to address the contract.

## Game-theory postmortem

Players: architect, /work author, /code-review, /address. Local incentive in /work: the easiest test setup for a new validator is `mkdtemp` → call → assert empty directory. That setup passes for any well-behaved code, including code with the read-order bug. Information asymmetry: the existing `WindowState` suite at lines 37–47 already had a corrupt-rename assertion — the file rename is the witness for read — but the new tests were written fresh from scratch rather than as variations of that witness. The mechanism that aligned behavior: `/code-review`'s "what does this assertion actually prove?" framing applied to `readdir([])` produced "no write, not no read" — and the suggested fix (seed corrupt state, assert no rename) was the contract test the author had reached for incidentally elsewhere in the file. Bad equilibrium discovered: writing the easiest-passing test for a new validation produces tests that pass even when validation runs in the wrong order. The repeated-game cost is that each new before-I/O validation added to an existing service tempts the same shape.

## Non-obvious lesson

Test assertions must pin the contract, not a proxy of the contract. "No file written" looks like evidence for "no I/O happened" but is satisfied by any test setup where reads are silent (ENOENT short-circuit, in-memory empty caches, fakes that swallow). When the contract is "X runs before side effect Y," the test setup must place state that makes Y observable — state that produces a different filesystem/database/cache artifact iff Y ran. Asserting the absence of Y's downstream effect (no write, no log line, no event) is the proxy; asserting the absence of Y's witness artifact (no rename, no transaction id, no row update) is the contract. The two coincide only when the setup precludes silent Y. Default test setups never preclude silent Y; they only preclude visible Y.

## Reproducible pattern (if any)

When a contract is "X happens before side effect Y":

1. Identify what file/db/cache/event state would produce an observable witness artifact iff Y ran.
2. Seed that state as test setup (corrupt JSON, mismatched schema row, pre-existing event in the queue).
3. Call the API with input that should trigger X's failure.
4. Assert the witness artifact is absent — not just that Y's downstream effect (write, log, event publish) is absent.
5. Re-use existing witness paths in the codebase (e.g., the corrupt-rename code path here) rather than inventing parallel witnesses.

## AGENTS.md amendment candidate (if any)

When a test asserts a "before-I/O" contract, seed state that would produce an observable witness artifact iff the I/O ran, and assert the witness's absence; asserting only the absence of the downstream effect (no write, no event) is satisfied by any test setup that hides the I/O silently. Why: PR #710 shipped tests where `readdir([])` proved "no write, not no read" because the empty-directory setup made `readStore`'s ENOENT short-circuit invisible — a regression moving validation after read would have passed. The fix used the existing corrupt-rename code path as the witness, which only fires when read succeeds.

This is a proposal. Review and edit AGENTS.md yourself if you want to adopt it — `/learn` never auto-edits AGENTS.md.
