# Issue 841 Work: Bound React Stream Hook Retention

## Scope

- Add bounded retention options to `useDesktopStream`.
- Preserve the dependency-list overload.
- Document default capacity and callback-only consumption.
- Add retention tests.

## Verification Commands

```bash
bun test packages/react/src/index.test.ts
bun packages/cli/src/bin.ts check --api
bun run typecheck
bun run lint
bun run lint:types
bun run check
bun test
```

Handoff: `/pr`
