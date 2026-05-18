---
title: Shell (native)
description: Open paths and external URLs through the OS shell.
kind: reference
audience: app-developers
effect_version: 4
---

# `Shell`

Operations that hand off to the OS shell: open a file in its default app, reveal a file, open a URL in the default browser, or move a file to the platform trash.

`Shell` is permissioned as `P.nativeInvoke({ primitive: "Shell", methods: [...] })`. The TypeScript client validates dangerous inputs before transport, and the Rust host repeats the same validation before any OS handoff.

## Methods

| Method             | Payload                      | Success |
| ------------------ | ---------------------------- | ------- |
| `openExternal`     | `{ url, allowedSchemes? }`   | `void`  |
| `openPath`         | `{ path, allowExecutable? }` | `void`  |
| `showItemInFolder` | `{ path }`                   | `void`  |
| `trashItem`        | `{ path }`                   | `void`  |

## Policy

`openExternal` allows `http`, `https`, `mailto`, and `tel` by default. Custom schemes require an explicit `allowedSchemes` entry for that call. `file:` and `javascript:` are reserved and denied even when listed. URL input with raw control characters is rejected.

Path methods reject empty strings, control characters, shell metacharacters, parent traversal segments (`..`), and paths beginning with an option prefix (`-`) before transport. `openPath` also denies executable-looking paths (`.exe`, `.bat`, `.cmd`, `.com`, `.scr`, `.msi`, `.sh`, `.ps1`, `.vbs`, `.wsf`, `.js`, `.desktop`, `.lnk`, `.url`, `.command`, `.app`) unless `allowExecutable: true` is set for that call. On Unix hosts, existing files with executable permission bits are also denied unless explicitly allowed.

## Platform Matrix

| Method             | macOS         | Linux                       | Windows                |
| ------------------ | ------------- | --------------------------- | ---------------------- |
| `openExternal`     | `open`        | `xdg-open`                  | `rundll32.exe`         |
| `openPath`         | `open`        | `xdg-open`                  | `rundll32.exe`         |
| `showItemInFolder` | `open -R`     | `xdg-open` parent directory | `explorer.exe /select` |
| `trashItem`        | Finder delete | `gio trash`                 | unsupported            |

## Errors

`ShellError` is the host protocol error union. Policy denials use `PermissionDenied` on the TypeScript bridge client and `Unsupported` with a stable reason at the Rust host boundary. Malformed inputs use `InvalidArgument`. Missing platform tools report `Unsupported` with `host-shell-unavailable`; failed OS handoffs report `HostUnavailable`.

## Related

- Reference: [`Filesystem`](../services/filesystem.md), [`Path`](path.md)
- Source: [`packages/native/src/shell.ts`](../../../packages/native/src/shell.ts)
