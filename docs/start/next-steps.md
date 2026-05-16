---
title: Where to go next
description: Decide which doc to read after the 5-minute first app.
kind: start
audience: app-developers
effect_version: 4
---

# Where to go next

You ran the [first app](first-app.md). Where you go from here depends on what you're trying to do.

## I want to build a real app

→ Work through the [tutorials](../tutorials/) in order. [Tutorial 01](../tutorials/01-build-a-notes-app.md) takes the same shape as the first app and grows it into a notes application with persistent settings, multi-step RPC, and proper error handling.

## I want to do one specific thing

→ The [how-to guides](../how-to/) are recipe-shaped — one page, one task. Common starting points:

- [Add a window](../how-to/add-a-window.md)
- [Persist settings](../how-to/persist-settings.md)
- [Run a child process](../how-to/run-a-child-process.md)
- [Declare a permission](../how-to/declare-a-permission.md)
- [Write a test with layers](../how-to/write-a-test-with-layers.md)

## I want to understand the design

→ Start with the [architecture overview](../explanation/architecture.md). If you have used other desktop frameworks (Electron, Tauri), [the boundary rule](../explanation/boundary-rule.md) explains the most surprising choice — the renderer never gets raw native authority. After that, [layer-first design](../explanation/layer-first-design.md) and [permissions model](../explanation/permissions-model.md) are the highest-leverage essays.

## I want to look up an API

→ The [reference section](../reference/) has one page per public surface. Most likely lookups:

- [`Desktop` API](../reference/desktop-api.md)
- [Native RPC groups](../reference/native/)
- [React hooks](../reference/react/)
- [CLI commands](../reference/cli.md)

## I want to know what's actually shipped vs. planned

→ The repo's [`engineering/SPEC.md`](../../engineering/SPEC.md) is the source of truth. Every reference page in this site is grounded in current source — if a page mentions a symbol, you can `grep` it and find it. Anything reserved for a later phase is called out inline.

## I'm hitting an error

→ [Troubleshooting](../troubleshooting.md) covers common command-line and bridge failures. The [errors catalog](../reference/errors.md) lists every typed error the framework emits, with what they mean and how to recover.
