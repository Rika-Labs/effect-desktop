# Basic React Tailwind

Minimal Effect Desktop renderer template using React 19, Tailwind 4, Vite, and public `@effect-desktop/*` APIs only.

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## What It Shows

- `Rpc.make` + `RpcGroup.make` as the renderer-callable contract.
- `Desktop.make({ windows })` for startup windows.
- `Desktop.Rpcs.layer(AppRpc, AppRpc.toLayer(...))` for app assembly.
- React renderer wiring that uses public `@effect-desktop/*` APIs only.
- Tailwind styling through the Vite plugin.
- A valid `desktop.config.ts` shape for the template app.

## Storage Notes

This template is ready for optional, opt-in browser storage wiring:

1. `storage/kv.ts`

   Copy or enable key-value persistence using `BrowserKeyValueStore.layerLocalStorage` or `layerSessionStorage`.

2. `storage/idb.ts`

   Copy or enable schema-first persistence with `IndexedDbTable`, `IndexedDbVersion`, `IndexedDbDatabase`, and migration hooks.

3. If migrations are needed, build the storage layer before host/runtime layers that consume it, so schema upgrades run during startup.

The template `spine.ts` owns app assembly. Storage layers should be provided beside the RPC layer:

```ts
import { makeMigration, makeTable, makeVersion } from "@effect-desktop/platform-browser/storage/idb"

const table = makeTable({...})
const version = makeVersion(table)
const migration = makeMigration(version, (tx) => Effect.void)

export const TemplateApp = Desktop.make({
  windows: {
    main: { title: "Effect Desktop", renderer: "/" }
  },
  rpcs: [Desktop.Rpcs.layer(AppRpc, greetLayer.pipe(Layer.provide(migration.layer)))]
})
```

## Dependency Note

The template pins all `@effect-desktop/*` packages to `workspace:*` so local public API changes and template changes stay atomic inside the monorepo.
