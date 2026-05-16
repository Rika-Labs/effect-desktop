# Make generated RPC surfaces Layer-first

## Planned

Issue #1233 asked for an Effect `RpcGroup` to produce the whole Layer-first capability surface:
server layer, client layer, test client layer, schema docs, typed failures, and contract-law hooks.
The key architectural constraint was that `RpcGroup` stays the source of truth, while bridge
metadata remains a lowering detail.

## Shipped

`DesktopRpc.surface` now packages one `RpcGroup` into server, client, test, docs, and contract-law
outputs. The public direct overload only accepts generated `DesktopRpcClient<Rpcs>` service shapes;
custom service facades must provide an explicit mapper. That keeps the common generated path free
from an unsafe catch-all cast while still allowing intentionally shaped public services.

`ScreenSurface` is the first native vertical slice. It keeps `ScreenRpcs` backed by the canonical
Effect `RpcGroup`, exports generated client/test layers, and proves bridge docs and descriptors still
come from the same group identity.

The bridge DSL was not removed in this issue because it still owns host protocol lowering and
native event metadata. A follow-up issue tracks the larger migration from `BridgeRpc` as a runtime
DSL to Effect RPC protocol adapters.

## Verification

- `bun test packages/core/src/index.test.ts`
- `bun test packages/native/src/index.test.ts`
- `bun run lint`
- `bun run lint:types`
- `bun run typecheck`
- `bun test`
- `bun run check`
- `bun packages/cli/src/bin.ts check --api`
- `git diff --check`
- `bunx prettier --check` on the touched files

## Lesson

Layer-first helpers should make the generated Effect path the easiest path, not hide arbitrary
service shapes behind `unknown as`. If a facade wants to differ from the generated RPC client, the
facade boundary should be explicit through a mapper so review can see the abstraction being added.
