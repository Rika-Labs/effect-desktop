---
title: Shell (native)
description: Open paths and external URLs through the OS shell.
kind: reference
audience: app-developers
effect_version: 4
---

# `Shell`

Operations that hand off to the OS shell — open a file in its default app, open a URL in the default browser.

## Methods

| Method | Payload | Success |
| --- | --- | --- |
| `openPath` | `{ path }` | `void` |
| `openExternal` | `{ url }` | `void` |
| `showItemInFolder` | `{ path }` | `void` |
| `trashItem` | `{ path }` | `void` |

## Errors

`ShellError`.

## Related

- Reference: [`Filesystem`](../services/filesystem.md), [`Path`](path.md)
- Source: [`packages/native/src/shell.ts`](../../../packages/native/src/shell.ts)
