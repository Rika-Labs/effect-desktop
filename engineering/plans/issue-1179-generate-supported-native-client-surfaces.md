# Issue #1179: Generate Supported Native Client Surfaces

## Decision

Use `RpcSupport` annotations as the source of truth for callable client shape. Keep unsupported RPCs in descriptor metadata, docs, and host compatibility handlers, but filter them out of generated client groups before constructing public clients.

## First slice

Apply the rule to `Window`. It already has a mixed support surface: `Window.create` and `Window.close` are implemented, while chrome mutation/event methods are annotated unsupported. That makes it the smallest proof that unsupported methods stay visible as metadata without being callable from the generated native client.

## Files to change

- `packages/core/src/runtime/desktop-rpc-surface.ts` - add `DesktopRpc.supportedGroup` and supported-client types that filter `RpcGroup` members using `RpcSupport` annotations.
- `packages/core/src/index.test.ts` - prove unsupported RPCs stay in schema docs but are absent from supported client groups.
- `packages/native/src/window.ts` - expose pure `WindowRpcs`, derive a supported Window client group, and remove unsupported methods from `WindowClientApi` / `WindowServiceApi`.
- `packages/native/src/index.test.ts` and `packages/native/src/window.test.ts` - assert descriptor support metadata remains, while callable clients only expose implemented methods.
- `packages/react/src/provider.tsx`, `packages/react/src/windows.ts`, and `packages/react/src/current-window.ts` - remove React window title hooks that were exposing unsupported native methods as normal mutations.
- `packages/test/src/native.ts` - align test Window clients with the supported callable surface.
- API snapshots - update after the public surface changes.

## Thin wrappers in scope

- Remove now: unsupported `WindowClientApi` methods that only return `Unsupported`.
- Remove now: React helpers for unsupported Window title mutation.
- Keep for #1264: `BridgeRpc.fromGroup` and `BridgeRpc.layer`, because host handler compatibility still uses the bridge DSL.
- Remove now: the Window bridge client path based on `Client(...)`. `WindowSupportedRpcs` can use the generated Effect RPC client through the unary bridge protocol adapter.

## Verification

- `bun test packages/core/src/index.test.ts packages/native/src/index.test.ts packages/native/src/window.test.ts packages/react/src/index.test.ts packages/test/src/index.test.ts`
- `bun run typecheck`
- `bun test`
- `bun run check`
- `bun run lint`
- `bun run lint:types`
- `bun packages/cli/src/bin.ts check --api --write`
- `bun packages/cli/src/bin.ts check --api`
- changed-file Prettier check
- `git diff --check`
