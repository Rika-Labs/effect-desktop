# ADR-0009: Adopt @effect/platform-browser for renderer storage

## Status

Accepted

## Context

The renderer has no typed storage. Apps that need draft state, offline mutation queues, or
cross-tab persistence must hand-roll IndexedDB or pull in the full WASM SQLite payload.
`@effect/platform-browser@4.0.0-beta.60` ships `IndexedDb`, `IndexedDbDatabase`,
`IndexedDbTable`, `IndexedDbVersion`, and `IndexedDbQueryBuilder` — Effect-native IndexedDB
with schema validation, versioned migrations, and `Model.Class` integration. The same
`Schema.Class` definitions used for SQL work for IndexedDB tables. It also ships
`BrowserKeyValueStore` (localStorage / sessionStorage) and `BrowserHttpClient` (fetch / XHR).

## Decision

Add `@effect/platform-browser@4.0.0-beta.60` to `packages/react`. Expose all IndexedDB
modules, `BrowserKeyValueStore`, and `BrowserHttpClient` from a dedicated
`packages/react/src/platform-browser.ts` entry, re-exported from `packages/react/src/index.ts`.
Pin to the same `effect@4.0.0-beta.60` already in use.

## Alternatives considered

- Hand-roll IndexedDB wrappers: more surface area, no schema validation, no Effect integration.
- WASM SQLite (T17): heavier payload; suitable for complex relational work, not lightweight
  renderer state.

## Consequences

Renderer apps can declare `IndexedDbTable` from `Model.Class` definitions, boot migrations
at layer initialization via `IndexedDbDatabase`, and read/write with full Effect types.
`BrowserKeyValueStore.layerLocalStorage` covers non-schema config (theme, window position).
`BrowserHttpClient.layerFetch` covers renderer-side HTTP without a native bridge round-trip.

## Validation

`packages/react` typecheck, lint, and tests pass clean with the new exports.
