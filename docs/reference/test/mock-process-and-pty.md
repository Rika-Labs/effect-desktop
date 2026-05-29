---
title: MockProcess and MockPTY
description: Deterministic process and PTY adapters for tests.
kind: reference
audience: app-developers
effect_version: 4
---

# `MockProcess` and `MockPTY`

Test layers for `Process` and `PTY`. Records calls, returns deterministic output, preserves the production validation/permission/cleanup paths.

## MockProcess

```ts
import { Layer } from "effect"
import { ResourceOwner, ResourceRegistryLive } from "@orika/core"
import { MockProcess } from "@orika/test"

const ProcessLive = MockProcess.layer({
  processes: [
    {
      command: "git",
      args: ["status"],
      pid: 1234,
      stdout: [new TextEncoder().encode("ok\n")],
      stderr: [new TextEncoder().encode("warn\n")],
      exit: { code: 7 }
    }
  ],
  permissions: { spawn: ["git"] }
}).pipe(Layer.provide(ResourceRegistryLive), Layer.provide(ResourceOwner.test("scope-main")))
```

Fixture shape: `{ command?, args?, pid?, stdout?, stderr?, exit? }`. Fixtures are matched and consumed in order by `(command, args)`; setting `exit: false` keeps the process running so a test can drive `kill`. The exported alias `MockProcessLive` is equivalent to `MockProcess.layer`.

Records: stdin writes, kill calls, terminate-tree and force-kill counts.

## MockPTY

```ts
import { Layer } from "effect"
import { ResourceOwner, ResourceRegistryLive } from "@orika/core"
import { MockPTY } from "@orika/test"

const PtyLive = MockPTY.layer({
  ptys: [
    {
      command: "bash",
      args: ["-l"],
      output: [new TextEncoder().encode("ready\n")],
      exit: { code: 0 }
    }
  ],
  permissions: { spawn: ["bash"] },
  budgets: { outputCoalesceBytes: 1024, outputCoalesceMs: 1 }
}).pipe(Layer.provide(ResourceRegistryLive), Layer.provide(ResourceOwner.test("scope-main")))
```

The exported alias `MockPtyLayer` is equivalent to `MockPTY.layer`.

Records: open, write, resize, kill, terminate-tree, and force-kill counts. Output: deterministic bytes from the scripted fixture.

## Both keep production discipline

Validation, permission checks, budget enforcement, resource cleanup — all run through the same code as `Process` / `PTY`. The only difference is the leaf adapter is in-memory.

## Related

- Reference: [`Process`](../services/process.md), [`PTY`](../services/pty.md)
- How-to: [Run a child process](../../how-to/run-a-child-process.md), [Open a PTY](../../how-to/open-a-pty.md)
- Source: [`packages/test/src/index.ts`](../../../packages/test/src/index.ts)
