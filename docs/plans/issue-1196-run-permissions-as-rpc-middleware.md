# Issue 1196: Run Permissions as RPC Middleware

## Intent

Permissions must be enforced at the RPC call boundary so a protected RPC cannot accidentally bypass the permission registry by forgetting a handler-side check.

## Current State

- `PermissionInterceptor` already exists as an Effect `RpcMiddleware.Service`.
- RPC contracts already carry capability metadata through `RpcCapability`.
- `Desktop.toLayer` validates required RPC capabilities at app startup.
- The missing link is runtime binding: app RPC groups are served without automatically applying the permission middleware, and the interceptor still reads a core-only annotation instead of the canonical bridge RPC capability metadata.

## Plan

1. Make bridge `RpcCapability` metadata the single permission annotation source for RPC contracts.
2. Update `PermissionInterceptor` to decode that metadata into `NormalizedCapability` and enforce it through `PermissionRegistry`.
3. Apply `PermissionInterceptor` when `Desktop.toLayer` binds user RPC groups into `RpcServer`.
4. Keep unannotated RPCs and explicit `kind: "none"` RPCs pass-through.
5. Add tests proving a denied protected RPC never reaches its handler through `Desktop.toLayer`.

## Architecture-Debt Sweep

- Remove the core-only `CapabilityAnnotation` path because it is a parallel abstraction over bridge RPC metadata.
- Keep `PermissionInterceptor` because it owns durable desktop semantics: actor context, permission registry enforcement, typed denial errors, and boundary-level security policy.
- Keep `P` capability constructors for now because they produce concrete desktop permission policy values rather than reimplementing Effect.
- Opened #1292 to remove the remaining `BridgeRpc` authoring DSL once its durable native/web annotations are represented directly on Effect RPC groups.
- Opened #1293 for the native host RPC runtime path, where bridge cannot own permission policy without depending on core.

## Verification

- Focused permission/app tests.
- Full repository validation before push.
