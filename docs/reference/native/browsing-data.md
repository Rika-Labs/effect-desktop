---
title: BrowsingData (native)
description: Typed cache and browser-storage controls scoped to SessionProfile handles.
kind: reference
audience: app-developers
effect_version: 4
---

# `BrowsingData`

`BrowsingData` describes cache and browser-storage operations scoped to an explicit `SessionProfileHandle`. The profile handle is the partition identity; calls do not target global browser state. The clear, estimate, and list-types operations are declared as capability facts but are not callable in this build; `isSupported` and the `BrowsingData.Event` stream are the genuinely callable surface.

The public service is Layer-first and test-substitutable. The TypeScript service exposes `BrowsingData.Event` as a typed stream. The memory client stores remaining browsing-data types under `profile.id` so tests can prove partition isolation.

## Methods

| Method        | Payload                 | Success                       |
| ------------- | ----------------------- | ----------------------------- |
| `isSupported` | `void`                  | `{ supported, reason? }`      |
| `events`      | optional profile handle | stream of clear-result events |

## Capability facts (non-callable)

`clear`, `estimate`, and `listTypes` are advertised in the native capability manifest as capability facts with `support.status: "unsupported"` (reason `host-browsing-data-unavailable`). They are not invocable RPCs: the surface registers no handlers or client methods for them. They exist only so the manifest can describe the intended cache and browser-storage controls and so permission tooling can reason about the `native.invoke` authority they would require.

When browsing-data support lands, `clear` would accept `{ profile, types }` and return `{ cleared, unsupported }`, `estimate` would accept `{ profile, types? }` and return `{ estimates }`, and `listTypes` would return `{ types }`. `clear` returning both `cleared` and `unsupported` arrays lets callers observe partial provider support without guessing; `estimate` reports one row per selected data type and omits `bytes` when a type is unsupported.

## Data Types

The contract names the portable data buckets directly:

- `cache`
- `cookies`
- `localStorage`
- `indexedDb`
- `history`
- `serviceWorkers`

## Support

The host does not yet bind `SessionProfileHandle` to Wry `WebContext` data stores, so the clear, estimate, and list-types methods are demoted to non-callable capability facts rather than routed RPCs.

| Platform | Status        | Reason                           |
| -------- | ------------- | -------------------------------- |
| macOS    | `unsupported` | `host-browsing-data-unavailable` |
| Windows  | `unsupported` | `host-browsing-data-unavailable` |
| Linux    | `unsupported` | `host-browsing-data-unavailable` |

`isSupported` returns `{ supported: false, reason: "host-browsing-data-unavailable" }` from the host. Use `makeBrowsingDataMemoryClient()` for deterministic success and event tests; use `makeBrowsingDataUnsupportedClient()` for the typed unsupported path.

## Related

- Source: [`packages/native/src/browsing-data.ts`](../../../packages/native/src/browsing-data.ts)
- Contract: [`packages/native/src/contracts/browsing-data.ts`](../../../packages/native/src/contracts/browsing-data.ts)
