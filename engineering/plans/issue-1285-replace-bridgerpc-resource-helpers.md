# Issue #1285: Replace BridgeRpc Resource Helpers With Schema Handles

## Decision

Move resource handle contracts to `@orika/core`. `BridgeRpc.Resource(kind, state)` is a
custom DSL over Schema and should be removed instead of preserved as a compatibility alias.

## Files to change

- `packages/core/src/runtime/resources.ts` - split serializable resource handles from managed runtime
  handles and add `ResourceHandleSchema(kind, state)`.
- `packages/core/src/runtime/resources.test.ts` - prove kind/state narrowing and invalid handle
  rejection at the schema boundary.
- `packages/native/src/contracts/*.ts` - replace `BridgeRpc.Resource(...).schema` with core
  `ResourceHandleSchema(...)` values.
- `packages/native/src/*.ts` and `packages/test/src/native.ts` - construct plain serializable
  resource handles instead of `BridgeResourceHandleShape`.
- `packages/bridge/src/contracts.ts`, `client.ts`, `handlers.ts`, and resource tests - remove
  `BridgeRpcResourceSpec`, the `BridgeRpc.Resource` constructor, and client-side resource proxy
  decoding.
- API snapshots and roadmap/learning docs - update public API evidence.

## Thin wrappers in scope

Remove now:

- `BridgeRpc.Resource(...)`
- `BridgeRpcResourceSpec`
- resource-specific branches in the old bridge `Client(...)` path
- duplicated native imports of `BridgeResourceHandleShape`

Keep:

- `makeStaleHandleError(...)`, because it is host protocol error translation, not a contract DSL.
- A core `ResourceHandleSchema(kind, state)` helper, because it owns desktop resource handle
  invariants and returns a plain `Schema.Schema`.

## Verification

- `bun test packages/core/src/runtime/resources.test.ts`
- `bun test packages/bridge/src/client.test.ts packages/bridge/src/contracts.test.ts packages/bridge/src/handlers.test.ts`
- `bun test packages/native/src/index.test.ts packages/test/src/index.test.ts`
- `bun run typecheck --filter=@orika/core --filter=@orika/bridge --filter=@orika/native --filter=@orika/test`
- `bun run lint --filter=@orika/core --filter=@orika/bridge --filter=@orika/native --filter=@orika/test`
- `bun run desktop check --api --write`
- `bun run desktop check --api`
- changed-file Prettier check
- `git diff --check`
