---
title: Dialog (native)
description: Native file, save, message, and confirmation dialogs.
kind: reference
audience: app-developers
effect_version: 4
---

# `Dialog`

Native file, save, message, and confirmation dialogs.

## Import

```ts
import { Dialog, DialogClient, DialogRpcs, DialogError } from "@effect-desktop/native"
```

## Methods

| Method          | Payload                                                     | Success                  |
| --------------- | ----------------------------------------------------------- | ------------------------ |
| `openFile`      | `{ title?, defaultPath?, filters?, multiple? }`             | `{ paths: string[] }`    |
| `openDirectory` | `{ title?, defaultPath?, multiple? }`                       | `{ paths: string[] }`    |
| `saveFile`      | `{ title?, defaultPath?, filters? }`                        | `{ path?: string }`      |
| `message`       | `{ level, title?, message, detail? }`                       | `void`                   |
| `confirm`       | `{ title?, message, detail?, confirmLabel?, cancelLabel? }` | `{ confirmed: boolean }` |

`openFile` and `openDirectory` return an empty `paths` array when the user cancels.
`saveFile` omits `path` when the user cancels. Cancellation is result data, not an error.

The Rust host adapter is backed by native dialogs through `rfd` on macOS and Windows, and through
`zenity` on Linux. Linux reports cancellation from `zenity` exit code `1` as result data and reports
spawn failures or unexpected dialog exits as typed host failures. Linux currently rejects
`multiple: true` for `openFile` and `openDirectory` with `Unsupported` because `zenity` cannot
return multiple arbitrary Unix paths without a lossy separator. Single-directory selection remains
routed on Linux.

## Errors

`DialogError` is the host protocol error union. Permission denial, unsupported host behavior, invalid
arguments, invalid host output, and host failures are tagged errors.

## Test layer

`DialogTest(options)` from `@effect-desktop/test`.

## Related

- How-to: [Integrate native services](../../how-to/integrate-native-services.md)
- Source: [`packages/native/src/dialog.ts`](../../../packages/native/src/dialog.ts)
