---
title: PTYs
description: Pseudo-terminal sessions with resize, signals, and substitutable adapter.
kind: reference
audience: app-developers
effect_version: 4
---

# PTYs

> Full reference: [`reference/services/pty.md`](reference/services/pty.md). How-to: [`open a PTY`](how-to/open-a-pty.md).

The `PTY` service owns pseudo-terminal sessions, resize/signal operations, output streams, permission policy, budget policy, and cleanup.

## Public surface

`@effect-desktop/core` exports `PTY`, `PtyOpenInput`, `PtyResizeInput`, `PtySignalInput`, `PtyExitStatus`, PTY errors, adapter types, and constructors such as `makePty`.

## Runtime rule

A PTY is a scoped resource. Open sessions must be closed, signaled, or collected by owner-scope cleanup. Output is bounded and observable.

## Verify PTY Test Surface

```ts run
import { PTY } from "../packages/core/src/index.js"
import { MockPTY } from "../packages/test/src/index.js"

if (PTY === undefined || MockPTY === undefined) {
  throw new Error("PTY or MockPTY is unavailable")
}
```

## Testing

`MockPTY.layer(options)` from `@effect-desktop/test` to verify open records, output frames, resize calls, signals, and exit behavior without a real terminal.

## Where to go next

- [How-to: open a PTY](how-to/open-a-pty.md)
- [`PTY` reference](reference/services/pty.md)
- [`MockPTY` reference](reference/test/mock-process-and-pty.md)
