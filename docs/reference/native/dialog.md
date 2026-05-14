---
title: Dialog (native)
description: File, save, and message dialogs.
kind: reference
audience: app-developers
effect_version: 4
---

# `Dialog`

Native file/message dialogs.

## Import

```ts
import { Dialog, DialogClient, DialogRpcs, DialogError } from "@effect-desktop/native"
```

## Methods

| Method | Payload | Success |
| --- | --- | --- |
| `open` | `{ properties?, filters?, defaultPath?, title? }` | `{ canceled, filePaths }` |
| `save` | `{ defaultPath?, filters?, title? }` | `{ canceled, filePath? }` |
| `message` | `{ type, title, message, buttons? }` | `{ response: number }` |

`properties`: `["openFile" \| "openDirectory" \| "multiSelections" \| "createDirectory"]`.

## Errors

`DialogError`.

## Test layer

`DialogTest(options)` from `@effect-desktop/test`.

## Related

- How-to: [Integrate native services](../../how-to/integrate-native-services.md)
- Source: [`packages/native/src/dialog.ts`](../../../packages/native/src/dialog.ts)
