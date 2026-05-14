# create-effect-desktop

## Purpose

Scaffolding command for new applications: template selection, dependency lockstep, initial config, example API, and renderer template copy.

## Public API

```ts
import { Effect } from "effect"
import { scaffold } from "create-effect-desktop"
```

`scaffold(options)` returns an Effect program that copies a first-party template, rewrites the generated package name, pins the Effect beta tuple, and normalizes first-party `@effect-desktop/*` dependencies for standalone install.

The CLI entrypoint accepts:

```bash
bun create effect-desktop [name] \
  --template local-first-sqlite \
  --renderer-storage none
```

Supported architecture templates are `local-first-sqlite`, `workflow-jobs`, `ai-desktop`, and `plugin-host`. Each selected template copies an executable first-party fixture with Effect services, layers, schemas, RPC contracts, and tests. Supported renderer storage adapters are `none`, `indexeddb`, `sqlite-wasm`, and `pglite`.

## Non-goals

- Full vertical product template infrastructure beyond the first-party template matrix.
- Marketplace or community template discovery.
- Migration tooling for pre-v4 generated apps.

## Usage

```bash
bun create effect-desktop my-app
cd my-app
bun install
bun run dev
```

## Testing

```bash
bun test packages/create-effect-desktop/src/index.test.ts
bun run typecheck
```

## Platform notes

The package writes files under the requested project directory and rejects non-empty targets. Template bytes are copied from the checked-in first-party template set.
The package depends on `effect` for typed scaffold failures and on `@effect/platform-bun` for the live filesystem and CLI runtime used by the binary.

## Internal architecture

`src/bin.ts` owns the Effect CLI command definition and user-facing errors. `src/index.ts` owns the architecture template catalog, template resolution, copy safety, and generated manifest normalization.
