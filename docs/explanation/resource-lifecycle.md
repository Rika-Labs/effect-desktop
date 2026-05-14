---
title: Resource lifecycle
description: Scopes own things. When the scope closes, the things close.
kind: explanation
audience: app-developers
effect_version: 4
---

# Resource lifecycle

A "resource" in Effect Desktop is anything long-lived enough that someone has to clean it up: a window, a file watcher, a child process, a PTY session, a worker, a job, a database connection. The framework's rule:

> **Every resource has an owner scope. When the scope closes, the resource closes.**

There is no "leak it and hope" path. The runtime refuses to register a resource without an owner.

## Why scopes

Without scopes, cleanup is a per-call discipline: every `open` needs a matching `close`, every spawn a matching kill, every subscription an unsubscribe — and any failure path that skips the cleanup is a leak. A long-running app accumulates leaks faster than you can find them.

Effect's `Scope` inverts the responsibility. The caller declares "I am opening a scope." Anything registered to that scope (`Scope.addFinalizer`, `Effect.acquireRelease`, layer scopes) is guaranteed to be released when the scope closes — successfully, by failure, or by interruption. The framework wires every long-lived primitive into this model.

## What owns what

| Resource | Owner scope | Cleanup |
| --- | --- | --- |
| Window | The app's runtime scope, plus a per-window child scope | Window destroy + state persistence |
| File watcher | The handler's scope (usually a per-call scope) | Stop watching, free OS handles |
| Process | Caller-declared `ownerScope` | Terminate process tree |
| PTY session | Caller-declared `ownerScope` | Send signal, close PTY |
| Worker | Caller-declared `ownerScope` | Terminate worker, release concurrency budget |
| Forked Effect | Surrounding handler/layer scope | Interrupt fiber on scope close |
| Stream subscription | Subscriber's scope | Unsubscribe and drain |

`ResourceRegistry` is the bookkeeping service. Every long-lived primitive registers a `ResourceHandle` keyed by an opaque `ResourceId`. The registry exposes:

- `list()` — current snapshot for devtools.
- `observe()` — a stream of registrations and disposals.
- `RegistrySnapshot` — a structural value you can assert against in tests.

You rarely call the registry yourself. You _do_ rely on it during testing: `assertNoOpenResourcesIn(registry)` or `installResourceLeakDetection(registry)` from `@effect-desktop/test` will fail your test if a handler opens a resource without closing it.

## Owner scopes are values

When you spawn a process, open a PTY, or start a worker, the input includes an `ownerScope: ScopeId`. That id is a name — typically `"window-main"`, `"job-export-pdf"`, `"worker-indexer-1"`. The framework joins it to the actual `Scope` through internal bookkeeping; you only need to choose a meaningful name.

Why a name and not the scope itself? Two reasons:

- **Audit.** When a process is killed, the audit event records the scope name. "Process `git status` was terminated when scope `window-main` closed" is a sentence you can read.
- **Cross-process visibility.** The Rust host knows the scope name from the host protocol envelope and uses it to clean up native resources when the runtime tells it the scope is closing.

## What this looks like in code

```ts
import { Effect } from "effect"
import { Process } from "@effect-desktop/core"

const program = Effect.gen(function* () {
  const proc = yield* Process
  const handle = yield* proc.spawn({
    command: "rg",
    args: ["pattern", "/path"],
    ownerScope: "window-main"
  })
  // The process runs until the scope closes, the handle is killed,
  // or the process exits on its own. You don't need a try/finally.
  return handle
})
```

If the surrounding scope closes — because the user closed the window, the request was canceled, or a parent failure interrupted the fiber — `rg` is killed and the audit log records it.

## Scopes nest

A typical desktop app has scopes at three levels:

1. **Runtime scope** — opened at app launch, closed at app exit. Owns global services.
2. **Window scope** — opened when a window is created, closed when it's destroyed. Owns window-specific state, watchers, and any worker tied to that window.
3. **Per-call scope** — opened by a handler for a single RPC call. Owns transient resources for that call.

A resource owned by a window scope is gone when the window closes, even if the runtime keeps running. A resource owned by a per-call scope is gone when the call returns. This matches user expectations: closing a window closes its windows-worth of work, not the whole app.

## Why this generalizes

The resource model gives you the same answer to every "what cleans this up?" question: **the scope you registered against**. There is no per-resource cleanup discipline because there is no per-resource cleanup _path_. Effect runs your finalizers; the framework wires them; you choose the scope name.

This also makes failure recovery cheap. A handler that fails halfway through a multi-step operation has its scope closed; everything it opened is reverted; the audit log records the abort. You did not write that error path.

## Related

- [Architecture overview](architecture.md)
- [Layer-first design](layer-first-design.md)
- Reference: [`ResourceRegistry`](../reference/services/resource-registry.md)
- How-to: [Write a test with layers](../how-to/write-a-test-with-layers.md)
