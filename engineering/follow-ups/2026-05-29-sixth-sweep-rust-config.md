# Sixth sweep — Rust crates + config decoder (2026-05-29)

Fixed (commit 6cc84079c5): native-updater case-insensitive sha256 comparison,
native-pty full `write_all` for stdin, config uppercase CSP forbidden-source
detection. Each clear fix has a regression test where one was feasible
(`write_all` is verified by compile + existing PTY tests; a partial-write
reproduction needs a real-PTY harness with a non-reading child and an oversized
buffer).

## Verified NOT a bug (false positive)

- **cspWeakenings "removes required source" (sweep HIGH).** The agent claimed
  stripping a default CSP source (e.g. `script-src 'self'` dropping the nonce, or an
  empty `object-src`) is an undetected weakening. It is not: for a source-list
  directive, _removing_ sources is **tightening** (fewer sources allowed), and an
  empty source-list directive blocks-all (≈`'none'`). Replacing `object-src 'none'`
  with a real source is already caught by the existing _added_-source check. A
  removed-source check broke 6 legitimate-tightening tests (e.g. `connect-src 'self'`),
  confirming the original added-only logic is correct. Not applied.

## Open — need deliberate treatment

### 1. (MEDIUM) native-pty tree-kill targets one process group, not the session

`pty_process_group` (lib.rs:277) uses `master.process_group_leader()`
(tcgetpgrp = the terminal's _foreground_ group) and falls back to the child pid.
Under a job-control shell the shell, its foreground job, and each background job are
in **different** process groups within one session, so killing any single group
leaves the others alive. The agent's proposed fix (target the child pid's group)
is itself incomplete — it kills the shell but not background jobs in sibling groups.
The correct fix is session-wide teardown (enumerate the session's process groups, or
kill the session leader and reap descendants), which must be designed and tested
against a real job-control shell (`bash -i` with a backgrounded `sleep &` and a
foreground job so tcgetpgrp ≠ shell pgid). Also re-verify whether portable-pty's
`process_group_leader()` really returns tcgetpgrp before changing the strategy.

### 2. (MEDIUM) mergeDesktopConfig shallow-merges nested security/update objects

`mergeObjects` (index.ts:529) is `{...shared, ...app}` (one level), so an app that
sets `update.install.enabled` drops an inherited `update.install.signatureVerification`,
and an app `security.csp` replaces a shared one wholesale. Inconsistent with
`protocol.limits`, which gets its nested object merged. Risky to change: deep-merging
`security.csp` can _alter the security verdict_ on merge (a shared acknowledged-weakened
csp would merge with the app's), and the `update.install` signature case is already
re-flagged by the production check. Decide a single explicit merge policy
(deep-merge the nested policy objects, or document shallow-replace) and test
inheritance for `security.csp`/`security.redaction`/`update.install` before changing it.

## Low confidence (latent / threat-model-bounded)

- native-updater `verify_manifest` aborts on the first malformed/off-curve trust anchor
  in the rotation window instead of skipping to the next valid anchor (availability, not
  a false-accept; anchors are defender-supplied config). Fix: `continue` on per-anchor
  decode failure, decide the error after the loop.
- native-updater `commit_staged_install` copies the staged bundle without re-hashing it
  (stage→commit TOCTOU); bounded by the same-user threat model. Fix: re-hash at commit
  before `atomic_replace`.
- native-updater `record_restart_breadcrumb` writes non-atomically (truncate-then-write)
  unlike the crate's atomic-replace discipline elsewhere; latent (no production reader of
  the breadcrumb today). Fix: write-temp-then-rename.
