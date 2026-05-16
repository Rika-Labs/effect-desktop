# Issue #1205: Fix the React API subpath export

## Decision

Remove the phantom `@effect-desktop/react/api` subpath and add a package-boundary test that requires every `@effect-desktop/react` export target to resolve to a real source file.

## Problem

What is true now: `packages/react/package.json` publishes `./api`, but `packages/react/src/api.ts` does not exist.

What must remain true: the React adapter surface stays centered on `ReactDesktop.from(...)`, `./desktop`, and the existing root exports; renderer RPC semantics are out of scope.

What should be true: package exports describe loadable modules only, and CI catches a future export target that points at a missing source file.

## Files to change

- `packages/react/package.json` — remove the missing `./api` subpath.
- `packages/react/src/index.test.ts` — add a package export target test for the React package.
- `engineering/plans/issue-1205-fix-react-api-subpath-export.md` — capture the implementation plan and verification contract.

## Test-first plan

1. Add a failing test that reads `packages/react/package.json` and asserts each `exports` `types` and `default` target exists on disk.
2. Run the focused React test and observe the failure for `./src/api.ts`.
3. Remove the `./api` export because no in-repo code imports it and the root/`./desktop` surfaces already expose the real adapter API.
4. Re-run the focused React test and then the repo gates.

## Review criteria

- Every published React subpath has a backing source file.
- The fix removes package-surface drift without adding a shallow compatibility module.
- The test validates the package boundary directly rather than relying on TypeScript as a proxy.
- No renderer contract, RPC, or hook behavior changes.

## Risks

- Removing a public subpath is only safe because this package is still private and no repository code imports it.
- A compatibility `src/api.ts` would preserve the subpath, but it would add a second name for an API already available from `@effect-desktop/react` and `@effect-desktop/react/desktop`.

## Verification

- `bun test packages/react/src/index.test.ts`
- `bun run typecheck`
- `bun run lint`
- `bun run lint:types`
- `bun run format:check`
