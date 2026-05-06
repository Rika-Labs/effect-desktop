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

Every fallible operation returns `PtyError`; panics from the native PTY boundary
are converted to `PtyError::PanicInNativeCode`.

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
