# todo-sqlite

First-party Effect Desktop template for bridge-crossing todo flows.

## Usage

```bash
bun install
bun run dev
```

## Checks

```bash
bun run typecheck
bun test
```

## Template Notes

The template defines an `RpcGroup` contract in `src/contract.ts`, host-side handlers in `src/spine.ts`, and a React renderer in `src/App.tsx`. `src/spine.ts` is the app assembly point: it declares startup windows with `Desktop.make({ windows })` and installs the todo handlers with `Desktop.Rpcs.layer(AppRpc, AppRpc.toLayer(...))`.

It is intended to demonstrate the storage and reactivity path required by the local-first track.

## Current Limits

The template is still tied to the active T30 scaffold work. Treat it as first-party verification material until the renderer-side storage path is complete.
