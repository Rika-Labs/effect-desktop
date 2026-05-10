# multi-window

First-party Effect Desktop template reserved for multi-window and cluster coordination.

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

The current template keeps the contract, renderer, and spine shape in place while T29 cluster support lands. It defines the renderer-callable contract with `Rpc.make` + `RpcGroup.make`, declares startup windows with `Desktop.make({ windows })`, and provides handlers with `Desktop.Rpcs.layer(AppRpc, AppRpc.toLayer(...))`.

It should not be treated as production-ready cluster behavior until the cluster coordination path is implemented.
