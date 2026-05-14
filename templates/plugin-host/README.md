# plugin-host

First-party Effect Desktop architecture template for typed plugin host coordination.

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

The template defines the renderer-callable contract with `Rpc.make` + `RpcGroup.make`, declares startup windows with `Desktop.make({ windows })`, and provides host handlers with `Desktop.Rpcs.layer(AppRpc, AppRpc.toLayer(...))`. Keep plugin loading, sandbox policy, and host/native bridge code behind explicit services and layers as the app grows.
