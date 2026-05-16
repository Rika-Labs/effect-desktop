# Issue 813 Work: Validate ContextMenu.show Position Coordinates

## Scope

- Add a finite, non-negative coordinate schema to the ContextMenu contract.
- Add bridge tests for non-finite and negative positions.
- Keep a valid fractional logical-pixel case.

## Verification Commands

```bash
bun test packages/native/src/index.test.ts
bun packages/cli/src/bin.ts check --api
bun run typecheck
bun run lint
bun run lint:types
bun run check
bun test
```

Handoff: `/pr`
