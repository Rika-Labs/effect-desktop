# Issue 872 Work - Require audit for wildcard secret access

## Change

- Changed `secretAuditRule` to treat any non-empty `permissions.secrets.read` or `permissions.secrets.write` list as declared secret access.
- Kept `hasScopedList` unchanged for filesystem and process rules.
- Added regression coverage for wildcard secret read, wildcard secret write, and no declared secret access.

## Verification

- `bun test packages/config/src/index.test.ts`
- Issue reproduction with `read: ["*"]` and `audit: "never"`
- `bun run typecheck`
- `bun run lint`
- `bunx prettier --check packages/config/src/index.ts packages/config/src/index.test.ts docs/runs/issue-872-require-audit-wildcard-secret-access/05-scout.md docs/runs/issue-872-require-audit-wildcard-secret-access/19-architect.md docs/runs/issue-872-require-audit-wildcard-secret-access/20-review.md docs/runs/issue-872-require-audit-wildcard-secret-access/21-work.md`
- `bun run check`
- `bun run lint:types`
- `bun test`
