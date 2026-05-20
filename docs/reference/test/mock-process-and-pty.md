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
import { MockProcess } from "@orika/test"

const layer = MockProcess.layer({
  // configure scripted responses per command
})
```

Records: stdin writes, kill calls, tree cleanup. Streams: configurable per-command stdout/stderr.

## MockPTY

```ts
import { MockPTY } from "@orika/test"

const layer = MockPTY.layer({
  // configure scripted responses
})
```

Records: open, write, resize, signal, close calls. Output: deterministic bytes from the scripted responses.

## Both keep production discipline

Validation, permission checks, budget enforcement, resource cleanup — all run through the same code as `Process` / `PTY`. The only difference is the leaf adapter is in-memory.

## Related

- Reference: [`Process`](../services/process.md), [`PTY`](../services/pty.md)
- How-to: [Run a child process](../../how-to/run-a-child-process.md), [Open a PTY](../../how-to/open-a-pty.md)
- Source: [`packages/test/src/mock-process.ts`](../../../packages/test/src/mock-process.ts), [`mock-pty.ts`](../../../packages/test/src/mock-pty.ts)
