---
date: 2026-05-10
type: maintenance
topic: Ignore EPERM from Windows fsync in window-state persistence
issue: https://github.com/Rika-Labs/effect-desktop/pull/1133
pr: https://github.com/Rika-Labs/effect-desktop/pull/1133
---

# Ignore Windows EPERM from `fsync` in window-state persistence

## Problem

PR checks intermittently and consistently failed on Windows in `bun test` for
`WindowState` persistence flows with `WindowStateWriteFailed` and reason
`EPERM: operation not permitted, fsync`. The same code path also drove follow-on
test failures that depend on successful state writes.

## What we changed

- `packages/core/src/runtime/window-state.ts`
  - Kept the existing temp-file write / rename flow for durability and atomicity.
  - Wrapped `handle.sync()` in `syncPath` with a Windows-only `EPERM` fallback.
  - If sync throws `EPERM` on `win32`, the function now treats it as
    best-effort and continues, preserving persistence flow to the next step.

## What worked

- `bun test packages/core/src/runtime/window-state.test.ts`:
  - 17 pass, 0 fail.
- `bun test packages/core/src/runtime/filesystem.test.ts`:
  - 35 pass, 0 fail.

## Post-review status

- Three manual review rounds were posted via `gh pr review --comment` after the
  follow-up commit; no blocking findings were introduced.
- No additional `address` actions were required because no new review findings
  remained.

## Lessons

Windows CI exposed that `handle.sync()` is not always a stable primitive in the
runner environment even though atomic-write semantics are still preserved by the
temp-file + rename sequence. The compatibility rule that keeps writes advancing on
`win32` `EPERM` while still surfacing other `syncPath` failures is a smaller,
less dangerous surface-area change than skipping directory sync unconditionally.
