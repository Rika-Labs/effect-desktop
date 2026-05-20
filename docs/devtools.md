---
title: Devtools
description: Inspector shell, panels, and snapshot client — observability, not authority.
kind: reference
audience: app-developers
effect_version: 4
---

# Devtools

> Full reference: [`reference/devtools.md`](reference/devtools.md).

Devtools expose runtime state without granting raw authority. They are safe to inspect, redacted, and bounded.

## Public surface

`@orika/core` exports inspector events, telemetry, safety policies, observability, and inspector transport primitives.

`@orika/devtools` exports:

- `DevtoolsShell`.
- Live panels for diagnostics, event logs, workflows, reactivity, persistence, logs, cluster, layer graph, and embedded inspector views.
- `DevtoolsSnapshotClient`.
- Test helpers for panels and inspector events.

## Verify Devtools Exports

```ts run
import { DevtoolsShell, DevtoolsSnapshotClient } from "../packages/devtools/src/index.js"

if (DevtoolsShell === undefined || DevtoolsSnapshotClient === undefined) {
  throw new Error("DevtoolsShell or DevtoolsSnapshotClient is unavailable")
}
```

## Rule

Inspector payloads must be redacted and scoped. **Devtools is observability, not a privilege bypass.** A production build must not include the devtools layer — `desktop check` enforces this via the `devtools-in-prod` rule.

## Where to go next

- [Devtools reference](reference/devtools.md)
- [Audit and redaction](explanation/audit-and-redaction.md)
- [`apps/inspector/`](../apps/inspector) — the first-party inspector app
