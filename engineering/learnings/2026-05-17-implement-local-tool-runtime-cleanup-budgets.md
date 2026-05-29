---
title: Implement LocalToolRuntime cleanup budgets
date: 2026-05-17
issue: 1404
---

# Learning

LocalToolRuntime cleanup policy is only safe when the host can prove exclusive directory ownership at registration and again at delete time. The host now accepts `removeWorkingDirectory: true` only for empty cwd roots under its temp namespace, rejects overlap with active runtime cwd roots, writes a per-registration ownership marker, verifies the root and marker again before removal, rejects symlink/reparse-point replacement, and deletes those roots during `stop` or runtime resource cleanup.

CPU and memory budget fields remain fail-closed instead of accepted-but-unenforced. The manifest names exact CPU and memory limits, while the current cross-platform host primitives do not provide equivalent process-tree enforcement across macOS, Linux, and Windows. Typed `Unsupported` is the correct production behavior until the host owns a platform-specific contract it can enforce.

Architecture-debt sweep: the touched LocalToolRuntime path still carries host protocol helpers for native/web routing, Schema-coded payloads, and OS process lifecycle policy. No wrapper over Effect primitives was added or found. The cleanup implementation adds durable desktop semantics rather than another adapter layer.

Verification:

- `cargo fmt --check`
- `cargo clippy -p host --all-targets -- -D warnings`
- `cargo test -p host local_tool_runtime -- --nocapture`
- `bun run check`
- `cargo test --workspace` reached only an unrelated timing failure in `runtime::tests::dev_policy_terminates_restart_that_never_becomes_ready`; the exact test passed on rerun.
