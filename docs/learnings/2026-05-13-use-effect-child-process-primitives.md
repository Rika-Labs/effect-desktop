# Use Effect Child Process Primitives

Issue #1158 replaced the local process child abstraction with Effect's `ChildProcess` and `ChildProcessSpawner` primitives.

The useful boundary was not "hide Bun." Effect already owns the platform child-process boundary. The useful boundary is "own desktop policy around a child process": permission checks, registry handles, owner scopes, budget accounting, bounded output streams, snapshots, and host-protocol error translation.

The main trap was signal exits. Effect's `exitCode` fails when a child terminates by signal, because there is no numeric exit code. `Process` still needs a stable desktop `ProcessExitStatus`, so it now owns a small terminal-state `Deferred`: observed normal exits, signal exits, and explicit `kill` calls all complete the same desktop exit state after snapshot recording.

The architecture-debt sweep removed `ProcessAdapter`, `ProcessChild`, `BunProcessAdapter`, direct `Bun.spawn`, and the `childPids` public snapshot field. `childPids` had become misleading once the code stopped owning process-tree enumeration. Process-tree cleanup remains behavior owned through Effect child-process kill semantics, not public snapshot data.

The sweep also found remaining `BridgeRpc` contract-adapter debt while touching process-adjacent native capability contracts. The current adapter still carries a documented `as unknown as BridgeRpcGroup` invariant and can drift events away from Effect RPC event endpoints. Follow-up #1297 captures the before/after for removing that adapter and deriving bridge protocol descriptors directly from `RpcGroup`.

The incentive correction is that tests now mock `ChildProcessSpawner`, not a local process DSL. Future process work should start from Effect's process handle and add only desktop-specific semantics around it.
