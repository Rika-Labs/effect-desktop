---
title: Path (native)
description: Platform-specific path resolution.
kind: reference
audience: app-developers
effect_version: 4
---

# `Path`

Platform-specific base-directory lookups. Each method returns a canonical absolute path from the native host; renderer code should not duplicate operating-system directory rules.

`Path.downloads` only resolves the user's downloads directory. It does not start downloads, choose per-download destinations, own sessions, emit progress, or cancel transfers.

## Methods

| Method      | Success            |
| ----------- | ------------------ |
| `appData`   | `{ path: string }` |
| `cache`     | `{ path: string }` |
| `logs`      | `{ path: string }` |
| `temp`      | `{ path: string }` |
| `home`      | `{ path: string }` |
| `downloads` | `{ path: string }` |

## Platform Matrix

| Method      | macOS                                          | Windows                                      | Linux                                                                         |
| ----------- | ---------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------- |
| `appData`   | `~/Library/Application Support/effect-desktop` | `FOLDERID_LocalAppData/effect-desktop`       | `$XDG_DATA_HOME/effect-desktop` or `~/.local/share/effect-desktop`            |
| `cache`     | `~/Library/Caches/effect-desktop`              | `FOLDERID_LocalAppData/effect-desktop/cache` | `$XDG_CACHE_HOME/effect-desktop` or `~/.cache/effect-desktop`                 |
| `logs`      | `~/Library/Logs/effect-desktop`                | `FOLDERID_LocalAppData/effect-desktop/logs`  | `$XDG_STATE_HOME/effect-desktop/logs` or `~/.local/state/effect-desktop/logs` |
| `temp`      | OS temp directory plus `effect-desktop`        | OS temp directory plus `effect-desktop`      | OS temp directory plus `effect-desktop`                                       |
| `home`      | `$HOME`                                        | `FOLDERID_Profile`                           | `$HOME`                                                                       |
| `downloads` | `~/Downloads`                                  | `FOLDERID_Downloads`                         | `XDG_DOWNLOAD_DIR` from `user-dirs.dirs` or `~/Downloads`                     |

## Errors

`PathError` is the host protocol error union. Missing platform directory inputs return `Unsupported` with `host-path-unavailable`. Host-generated paths that are empty, relative, NUL-bearing, or non-UTF-8 return `InvalidOutput`.

## Related

- Reference: [`Filesystem`](../services/filesystem.md)
- Source: [`packages/native/src/path.ts`](../../../packages/native/src/path.ts)
