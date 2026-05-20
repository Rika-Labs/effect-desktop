# Issue #1286: Remove Native Generated-Client Casts Over Effect RPC

## Decision

Native bridge client modules should use the Effect RPC client type derived from the RPC group:

```ts
type MenuRpcClient = DesktopRpcClient<MenuRpc>
```

The hand-maintained `*GeneratedClient` interfaces are a parallel type system over Effect RPC. They
only mirror endpoint names and hide inference gaps with `as unknown as`, so they should be deleted.

## Target Shape

Before:

```ts
interface MenuGeneratedClient {
  readonly "Menu.setApplicationMenu": (input: MenuSetApplicationMenuInput) => Effect.Effect<void>
}

RpcClient.make(MenuRpcGroup).pipe(
  Effect.map((client) => client as unknown as MenuGeneratedClient),
  Effect.flatMap(use)
)
```

After:

```ts
type MenuRpcClient = DesktopRpcClient<MenuRpc>

RpcClient.make(MenuRpcGroup).pipe(Effect.flatMap(use))
```

RPC helper factories must preserve literal endpoint tags and pure schema requirements:

```ts
function menuRpc<
  const Method extends string,
  Payload extends Schema.Codec<unknown, unknown, never, never>,
  Success extends Schema.Codec<unknown, unknown, never, never>
>(method: Method, payload: Payload, success: Success, capability: string) {
  return Rpc.make(`Menu.${method}` as const, { payload, success, error: HostProtocolErrorSchema })
}
```

## Files

- `packages/native/src/*.ts` - remove local `*GeneratedClient` interfaces and cast maps from native
  bridge client construction.
- `packages/native/src/window.ts` - remove the special `RpcClient.make(...) as unknown as ...`
  double-cast and model supported Window RPCs as an explicit `RpcGroup.make(WindowCreate,
WindowClose)`.
- `packages/native/src/contracts/menu.ts` - keep recursive menu contracts as pure `Schema.Codec`
  values so Effect RPC clients require no codec services.
- `packages/core/src/runtime/resources.ts` - let `ResourceHandleSchema` keep its precise inferred
  codec type instead of widening to a type-only `Schema.Schema`.

## Architecture Debt Sweep

Remove now:

- all native `*GeneratedClient` interfaces
- all `Effect.map((client) => client as unknown as *GeneratedClient)` adapters
- the Window `RpcClient.make(...) as unknown as Effect.Effect<WindowGeneratedClient, ...>` cast
- broad `Schema.Top` / type-only schema annotations in native RPC helper factories that force
  client effects to expose `unknown` services

Keep:

- bridge protocol/client-layer factories, because they translate across the native/web transport
  boundary.
- service APIs like `MenuClientApi`, `TrayClientApi`, and `WindowClientApi`, because they are native
  desktop ports with validation and host-protocol error translation, not aliases of Effect RPC.
- `DesktopRpc.supportedGroup`, because it owns desktop support metadata policy. This issue avoids
  depending on it where the supported Window subset is already explicit.

Follow-ups opened during review:

- #1288 Tighten native decode helpers to pure Schema codecs.
- #1289 Make `DesktopRpc.supportedGroup` type-preserving.

## Verification

Focused:

```bash
rg "as unknown as .*GeneratedClient|Effect\\.map\\(\\(client\\) => client as unknown as|GeneratedClient" packages/native/src -g'*.ts'
bun run typecheck --filter=@orika/native --filter=@orika/core --filter=@orika/bridge --force
bun test packages/native/src/index.test.ts packages/native/src/window.test.ts packages/native/src/protocol.test.ts
bun test packages/core/src/index.test.ts packages/bridge/src/client.test.ts packages/bridge/src/protocol.rpc.test.ts
bun test packages/core/src/runtime/resources.test.ts
bun run desktop check --api
```

Full local gate before pushing:

```bash
bun install --frozen-lockfile
bun run format:check
bun run lint
bun run lint:types
bun run check
bun test
bun run build
cargo fmt --check
cargo check --workspace
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```
