---
title: BrowsingData (native)
description: Typed cache and browser-storage controls scoped to SessionProfile handles.
kind: reference
audience: app-developers
effect_version: 4
---

# `BrowsingData`

`BrowsingData` declares cache and browser-storage clear, estimate, list, and event operations scoped to an explicit `SessionProfileHandle`. The profile handle is the partition identity; calls do not target global browser state.

The public service is Layer-first and test-substitutable. The TypeScript service validates Schema contracts before transport, checks `native.invoke` permissions before client side effects, and exposes `BrowsingData.Event` as a typed stream. The memory client stores remaining browsing-data types under `profile.id` so tests can prove partition isolation.

## Methods

| Method        | Payload                 | Success                       |
| ------------- | ----------------------- | ----------------------------- |
| `clear`       | `{ profile, types }`    | `{ cleared, unsupported }`    |
| `estimate`    | `{ profile, types? }`   | `{ estimates }`               |
| `listTypes`   | `void`                  | `{ types }`                   |
| `isSupported` | `void`                  | `{ supported, reason? }`      |
| `events`      | optional profile handle | stream of clear-result events |

## Data Types

The contract names the portable data buckets directly:

- `cache`
- `cookies`
- `localStorage`
- `indexedDb`
- `history`
- `serviceWorkers`

`clear` returns both `cleared` and `unsupported` arrays so callers can observe partial provider support without guessing. `estimate` reports one row per selected data type and omits `bytes` when a type is unsupported.

## Support

The Rust host routes the methods and validates payloads, but it does not yet bind `SessionProfileHandle` to Wry `WebContext` data stores. Host requests therefore fail closed with typed `Unsupported` after validation.

| Platform | Status        | Reason                           |
| -------- | ------------- | -------------------------------- |
| macOS    | `unsupported` | `host-browsing-data-unavailable` |
| Windows  | `unsupported` | `host-browsing-data-unavailable` |
| Linux    | `unsupported` | `host-browsing-data-unavailable` |

`isSupported` returns `{ supported: false, reason: "host-browsing-data-unavailable" }` from the host. Use `makeBrowsingDataMemoryClient()` for deterministic success and event tests; use `makeBrowsingDataUnsupportedClient()` for the typed unsupported path.

## Related

- Source: [`packages/native/src/browsing-data.ts`](../../../packages/native/src/browsing-data.ts)
- Contract: [`packages/native/src/contracts/browsing-data.ts`](../../../packages/native/src/contracts/browsing-data.ts)
