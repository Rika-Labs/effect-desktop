---
date: 2026-05-17
type: in-flight-feature
topic: Enable LocalToolRuntime Windows CI coverage
issue: https://github.com/Rika-Labs/effect-desktop/issues/1405
pr: none
---

# Enable LocalToolRuntime Windows CI coverage

## Decision

Windows support should be declared only when the host binary acceptance path runs on Windows CI.

## What changed

`LocalToolRuntime` support metadata now reports macOS, Linux, and Windows as supported. The Windows headless CI cell now runs the host binary `local_tool_runtime` tests instead of only the support and unsupported-platform metadata checks.

The host tests now exercise the same acceptance behaviors on Unix and Windows where the operating system permits it: registered command execution, stderr capture, process failure, timeout, active stop termination, duplicate active run rejection, lifecycle routing, and support metadata. A Windows-only test verifies descendant cleanup by starting a child PowerShell process and proving it cannot survive the host Job Object cleanup path.

The final platform review found that post-spawn Job Object assignment was not strong enough: a fast Windows child could spawn a descendant before `AssignProcessToJobObject`. The host now uses a Windows-specific process creation path for local tools that creates the Job Object first, passes it through the process/thread attribute list, starts the process suspended, and resumes it only after the process is born inside the Job Object.

## Why it mattered

The support matrix is a contract. Reporting Windows as supported without executing the host binary path on Windows would make CI validate metadata while leaving process semantics untested.

The fix ties the public support change to the platform-specific behavior that matters: command execution and race-free process-tree cleanup under the Windows process model.

## Architecture-debt sweep

No zero-policy Effect wrapper debt was found in the touched `LocalToolRuntime` path. The TypeScript surface uses the existing native support metadata directly, and the Rust changes stay in the host process adapter where OS lifecycle policy belongs.

Follow-up #1404 remains the active debt item for cleanup-budget, CPU-budget, and memory-budget enforcement.

## Rule candidate

Do not widen platform support metadata until CI runs the platform-specific behavior that makes the support claim true. Metadata checks are not acceptance tests.

This is a proposal. Review and edit AGENTS.md yourself if you want to adopt it - `/learn` never auto-edits AGENTS.md.
