# Use Effect Child Process Primitives

Issue #1158 replaced the local process child abstraction with Effect's `ChildProcess` and `ChildProcessSpawner` primitives.

The useful boundary was not "hide Bun." Effect already owns the platform child-process boundary. The useful boundary is "own desktop policy around a child process": permission checks, registry handles, owner scopes, budget accounting, bounded output streams, snapshots, and host-protocol error translation.

The main trap was signal exits. Effect's `exitCode` fails when a child terminates by signal, because there is no numeric exit code. `Process` still needs a stable desktop `ProcessExitStatus`, so it now owns a small terminal-state `Deferred`: observed normal exits, signal exits, and explicit `kill` calls all complete the same desktop exit state after snapshot recording.

The architecture-debt sweep removed `ProcessAdapter`, `ProcessChild`, `BunProcessAdapter`, direct `Bun.spawn`, and the `childPids` public snapshot field. `childPids` had become misleading once the code stopped owning process-tree enumeration. Process-tree cleanup remains behavior owned through Effect child-process kill semantics, not public snapshot data.

The sweep rechecked the nearby bridge contract surface after the process work. Current `main` has already removed the public `BridgeRpc` adapter through #1292, so the stale #1297 follow-up was closed as superseded instead of becoming new work.

The incentive correction is that tests now mock `ChildProcessSpawner`, not a local process DSL. Future process work should start from Effect's process handle and add only desktop-specific semantics around it.
