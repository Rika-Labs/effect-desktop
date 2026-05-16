---
date: 2026-05-05
type: in-flight-feature
topic: Process tree cleanup on scope close
issue: https://github.com/Rika-Labs/effect-desktop/issues/109
pr: https://github.com/Rika-Labs/effect-desktop/pull/207
---

# Process tree cleanup on scope close

## What we set out to do

Issue #109 required the Process service to make scope closure own the whole child process tree, not only the direct child. The planned invariant was deterministic cleanup: ask the tree to terminate, wait through a grace window, force kill if needed, and reap through the process handle so child shells cannot leave descendants behind.

## What actually ended up working

The public `ProcessHandle` did not need a wider interface. The deeper module boundary was the internal `ProcessChild` adapter: it now exposes `terminateTree` and `forceKillTree`, while `Process` owns the lifecycle state machine with `Effect.timeoutOption` and typed/logged cleanup failures. POSIX spawning uses a detached child so the child becomes a process-group leader, allowing disposal to signal `-pid`. Windows keeps the same Process API but uses a documented `taskkill /T /F` force-cleanup boundary behind the adapter instead of leaking Windows process details into callers.

```mermaid
flowchart LR
  Scope[scope close] --> Dispose[Process resource disposer]
  Dispose --> Terminate[adapter terminateTree]
  Terminate --> Grace[wait gracefulShutdownMs]
  Grace -->|exited| Done[close stdin and finish]
  Grace -->|timeout| Force[adapter forceKillTree]
  Force --> Reap[wait for child exited]
  Reap --> Done
```

## What surfaced in review

The internal review posted zero findings. CI surfaced the useful review signal instead: Windows hung after the first implementation because detached Windows subprocesses and long fake-child timers can keep the test runner alive. The fix was to make the OS boundary explicit: POSIX uses detached process groups, Windows uses `taskkill /T /F`, and fake children clear their natural-exit timer when terminated early.

## First-principles postmortem

The invariant is ownership: if a scope owns a process, it owns every descendant that process created for the lifetime of that scope. A direct-child kill is not enough because shells and command runners move useful work into grandchildren. The key assumption that changed was that one spawn option could express all OS cleanup semantics. It cannot. The service should own policy and sequencing; the adapter should own the platform primitive used to apply that policy.

## Game-theory postmortem

The risky local move is cheap: add `child.kill("SIGTERM")` and call the issue done. The operator pays later when orphaned `sleep`, shell, or build processes survive window close and consume resources invisibly. The better mechanism is a narrow internal adapter contract that makes the good move cheaper than the bad one: every `ProcessChild` must say how to terminate and force-kill its tree, and the Effect disposer always applies the same grace/force state machine.

## Non-obvious lesson

Process-tree cleanup is a lifecycle protocol, not a signal choice. The signal is platform detail; the durable behavior is that disposal requests graceful tree shutdown, observes child exit as a value, escalates on timeout, and records cleanup failures without throwing defects from the disposer.

## Reproducible pattern (if any)

Keep public handles narrow.
Move platform-specific cleanup into the adapter interface.
Model disposal as an Effect state machine with timeout values.
Test policy with fakes and platform primitives with one integration test.

## AGENTS.md amendment candidate (if any)

When runtime services wrap OS resources, require the adapter contract to expose lifecycle primitives instead of making callers encode platform cleanup details. Why: the service can then enforce one Effect-owned cleanup policy without leaking OS-specific process or handle semantics.

This is a proposal. Review and edit AGENTS.md yourself if you want to adopt it — `/learn` never auto-edits AGENTS.md.
