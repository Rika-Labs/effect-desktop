# Vite Dev Runtime On Effect Process And Socket

Issue: #1209

## What changed

The Vite dev runtime no longer starts its native runtime child through a local Node
`child_process` wrapper or decodes stdout through a bespoke `StdioBridge`. The process is acquired
through `effect/unstable/process`, stdio is adapted to `effect/unstable/socket`, and existing framed
transport owns protocol framing.

`hmr-controller` keeps the imperative Vite hooks at the edge, but runtime lifecycle work now runs
through a `ManagedRuntime`. Restart and dispose paths are serialized with an Effect `Semaphore`,
and the active runtime is closed before replacement. The renderer virtual module also moved from an
unbounded queue plus detached `Effect.runFork` to bounded `Stream.callback` HMR delivery.

## What mattered

The main trap was not the spawn call. It was the ownership boundary around startup, restart, and
early frame delivery. If the active process handle is assigned only after frame fibers are started,
a fast fake or child process can emit its first frame before the Vite controller knows which process
owns it. If process acquisition fails after opening a scope, that scope must still close.

The resulting shape is:

```ts
const scope = yield * Scope.make()
const child = yield * ChildProcess.make(command, args, options).pipe(Scope.extend(scope))
const connection = yield * makeFramedSocketConnection(socket).pipe(Scope.extend(scope))

return {
  frames: connection.incoming,
  send: connection.send,
  close: Scope.close(scope, Exit.void)
}
```

The Vite controller then assigns the active process before starting detached forwarding fibers, so
the fibers can safely check whether their process is still current before publishing HMR frames.

## Review changes

Review changed the implementation in three places:

- initial runtime frames are no longer dropped because `active` is assigned before frame and exit
  fibers start;
- process acquisition closes its manual scope on failure;
- restart and dispose use an Effect `Semaphore`, and dispose is idempotent.

## Architecture-debt sweep

Removed here: `packages/vite/src/child-process.ts`, `packages/vite/src/stdio-bridge.ts`, raw
`node:child_process` spawn ownership, mutable frame handler arrays, unbounded renderer HMR queues,
and raw `Effect.runFork` inside generated browser code.

Kept intentionally: the Vite HMR adapter and base64 frame event names. Those are durable boundary
translation between Vite's websocket protocol and the Effect socket/framed transport. No follow-up
issue was opened for this touched area.

## Rule

When an integration edge needs a process plus byte stream, keep the host callback imperative edge
small and push process lifetime, socket framing, restart serialization, and cleanup into Effect
resources. Otherwise a thin local adapter quickly becomes a second lifecycle system.
