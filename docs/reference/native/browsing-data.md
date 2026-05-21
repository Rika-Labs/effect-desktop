---
title: BrowsingData (native)
description: Typed cache and browser-storage controls scoped to SessionProfile handles.
kind: reference
audience: app-developers
effect_version: 4
---

# `BrowsingData`

`BrowsingData` describes cache and browser-storage operations scoped to an explicit `SessionProfileHandle`. The profile handle is the partition identity; calls do not target global browser state. `clear` is a callable RPC backed by the host profile/WebView registry, and `listTypes` returns the portable bucket set supported by the contract. `estimate` remains a non-callable capability fact because the current host provider does not expose truthful per-bucket byte estimates.

The public service is Layer-first and test-substitutable. The TypeScript service exposes `BrowsingData.Event` as a typed stream.

## Methods

| Method        | Payload                 | Success                       |
| ------------- | ----------------------- | ----------------------------- |
| `clear`       | `{ profile, types }`    | `{ cleared, unsupported }`    |
| `listTypes`   | `void`                  | `{ types }`                   |
| `isSupported` | `void`                  | `{ supported, reason? }`      |
| `events`      | optional profile handle | stream of clear-result events |

## Capability facts (non-callable)

`estimate` is advertised in the native capability manifest as a capability fact with `support.status: "unsupported"` (reason `host-browsing-data-unavailable`). It is not an invocable RPC: the surface registers no handler or client method for it.

`clear` accepts `{ profile, types }` and returns `{ cleared, unsupported }`. The current Wry provider exposes profile-level clear primitives; the result reports the portable buckets the host cleared for the request. `listTypes` returns the same portable buckets without probing browser storage.

## Data Types

The contract names the portable data buckets directly:

- `cache`
- `cookies`
- `localStorage`
- `indexedDb`
- `history`
- `serviceWorkers`

## Support

The host binds `SessionProfileHandle` to Wry `WebContext` data stores for child WebViews, routes `BrowsingData.clear` to the live profile WebViews or profile data directory, and routes `BrowsingData.listTypes` to the contract-owned portable type list.

| Platform | Status      |
| -------- | ----------- |
| macOS    | `supported` |
| Windows  | `supported` |
| Linux    | `supported` |

`isSupported` returns `{ supported: true }` from the host. Use `makeBrowsingDataMemoryClient()` for deterministic success and event tests; use `makeBrowsingDataUnsupportedClient()` for the typed unsupported path.

## Related

- Source: [`packages/native/src/browsing-data.ts`](../../../packages/native/src/browsing-data.ts)
- Contract: [`packages/native/src/contracts/browsing-data.ts`](../../../packages/native/src/contracts/browsing-data.ts)
