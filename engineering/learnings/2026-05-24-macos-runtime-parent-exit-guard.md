# macOS Runtime Parent-Exit Guard

Packaged macOS app quit can bypass Rust `Drop` if the native host exits before the runtime supervisor unwinds. Linux already has a parent-death signal and Windows already has a Job Object; macOS needs an explicit parent-exit guard so the Bun runtime process group does not survive as an orphan.

The guard lives in `runtime::platform::ChildGuard`, not in a new lifecycle wrapper. `Supervisor` still owns the runtime child. On macOS the platform guard starts a small detached shell process that watches the host PID and the runtime child PID; if the host disappears while the child still exists, it terminates the runtime process group with TERM and then KILL. Normal supervisor cleanup drops the guard first.

Architecture-debt sweep: no wrapper was added. `runtime::platform` is the durable policy boundary because it owns OS-specific process-tree semantics. The app/runtime API remains Effect-owned, and the host-specific process guard stays below that interface.

Verification:

- `cargo test -p host runtime::tests::macos_parent_exit_guard_terminates_runtime_child_without_supervisor_drop -- --nocapture`
- `cargo test -p host --test startup_smoke host_binary_verifies_app_quit_lifecycle_exit -- --nocapture`
- Packaged `.context/demo-apps/app-metadata-runtime` macOS app launch and OS quit no longer leave an orphaned Bun runtime or guard process.
- `cargo fmt --all --check`
- `cargo check --workspace`
- `cargo clippy -p host --all-targets -- -D warnings`
