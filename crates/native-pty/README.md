# native-pty

`native-pty` owns the low-level cross-platform pseudo-terminal primitive for the
framework. It keeps platform PTY behavior in Rust and exposes a small synchronous
API for later host/runtime services.

## Public API

- `open(PtySize, PtyCommand) -> Result<NativePty, PtyError>`
- `NativePty::write(&mut self, &[u8]) -> Result<usize, PtyError>`
- `NativePty::read(&mut self, max_bytes) -> Result<Vec<u8>, PtyError>`
- `NativePty::resize(&self, PtySize) -> Result<(), PtyError>`
- `NativePty::try_wait(&mut self) -> Result<Option<PtyExitStatus>, PtyError>`
- `NativePty::wait(&mut self) -> Result<PtyExitStatus, PtyError>`
- `NativePty::kill(&mut self) -> Result<(), PtyError>`
- `NativePty::terminate_tree(&mut self) -> Result<(), PtyError>`
- `NativePty::force_kill_tree(&mut self) -> Result<(), PtyError>`
- `NativePty::wait_for_exit(&mut self, Duration) -> Result<Option<PtyExitStatus>, PtyError>`
- `NativePty::close_tree(&mut self, Duration) -> Result<Option<PtyExitStatus>, PtyError>`

Every fallible operation returns `PtyError`; panics from the native PTY boundary
are converted to `PtyError::PanicInNativeCode`.

## Cleanup behavior

On Unix, `portable-pty` starts the PTY child as a session leader. `native-pty`
uses that child pid as the process-group id and sends cleanup signals to the
whole group: `terminate_tree` sends `SIGTERM`, and `force_kill_tree` sends
`SIGKILL`. `close_tree` performs the standard sequence: terminate, wait for the
configured grace period, force kill, then wait again.

On Windows, `native-pty` assigns the PTY child process to a Job Object as soon
as the child is spawned. `terminate_tree` and `force_kill_tree` terminate that
Job Object, and closing the job handle provides a final cleanup guard if a
caller drops the PTY without an explicit close.

## Dependency note

This crate depends on `portable-pty` because the spec requires one Rust PTY
primitive that hides POSIX and Windows PTY divergence. `portable-pty` provides
the native system adapter, command spawning, PTY reader/writer handles, resizing,
and child lifecycle controls behind one interface. The dependency is declared at
the workspace root so the version is pinned once for every crate.

## Scope

This crate does not define the TypeScript `PTY` Effect service, bridge protocol,
renderer stream, permission checks, or backpressure policy. Those are later
phase issues that should consume this primitive rather than duplicate platform
PTY behavior.
