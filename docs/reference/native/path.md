---
title: Path (native)
description: Platform-specific path resolution.
kind: reference
audience: app-developers
effect_version: 4
---

# `Path`

Platform-specific path lookups.

## Methods

| Method | Success |
| --- | --- |
| `appData` | `{ path: string }` |
| `documents` | `{ path: string }` |
| `downloads` | `{ path: string }` |
| `desktop` | `{ path: string }` |
| `temp` | `{ path: string }` |
| `cache` | `{ path: string }` |
| `home` | `{ path: string }` |

## Errors

`PathError`.

## Related

- Reference: [`Filesystem`](../services/filesystem.md)
- Source: [`packages/native/src/path.ts`](../../../packages/native/src/path.ts)
