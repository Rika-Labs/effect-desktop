---
title: Notification (native)
description: Show system notifications.
kind: reference
audience: app-developers
effect_version: 4
---

# `Notification`

System notifications.

## Methods

| Method | Payload | Success |
| --- | --- | --- |
| `show` | `{ title, body?, icon?, silent?, urgency?, actions? }` | `{ clicked: boolean }` |

## Errors

`NotificationError`.

## Related

- How-to: [Integrate native services](../../how-to/integrate-native-services.md)
- Source: [`packages/native/src/notification.ts`](../../../packages/native/src/notification.ts)
