# Issue 812 Work: Validate CrashReporter.flush Output Counts

## Scope

- Tighten `CrashReporterFlushResult.flushed` to a non-negative integer.
- Add bridge output validation tests for invalid counts.
- Keep valid zero and positive count behavior.

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
