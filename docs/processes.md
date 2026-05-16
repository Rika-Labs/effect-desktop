---
title: Processes
description: Shellless process execution with permission policy and bounded output.
kind: reference
audience: app-developers
effect_version: 4
---

# Processes

> Full reference: [`reference/services/process.md`](reference/services/process.md). How-to: [`run a child process`](how-to/run-a-child-process.md).

The `Process` service owns shellless process execution, output collection, permission policy, budgets, and lifecycle cleanup.

## Public surface

`@effect-desktop/core` exports `Process`, `ProcessSpawnInput`, `ProcessExitStatus`, process errors, budget policy types, permission policy types, and constructors such as `makeProcess`.

## Security model

Process execution is privileged. Commands are allowlisted or denied through explicit `process.spawn` capabilities (exact-match), and shell expansion is **not** assumed for shellless spawns.

## Verify Process Test Surface

```ts run
import { Process } from "../packages/core/src/index.js"
import { MockProcess } from "../packages/test/src/index.js"

if (Process === undefined || MockProcess === undefined) {
  throw new Error("Process or MockProcess is unavailable")
}
```

## Testing

`MockProcess.layer(options)` from `@effect-desktop/test` for deterministic stdout, stderr, exit status, spawn records, and denied-path assertions.

## Where to go next

- [How-to: run a child process](how-to/run-a-child-process.md)
- [`Process` reference](reference/services/process.md)
- [`MockProcess` reference](reference/test/mock-process-and-pty.md)
- [How-to: spawn a worker](how-to/spawn-a-worker.md) — alternative for TypeScript-only background work
