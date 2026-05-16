---
title: Contribution guide
description: Public behavior changes need typed code, docs, and verification in the same PR.
kind: contributing
audience: contributors
effect_version: 4
---

# Contribution guide

> Full guidance: [`contributing/`](contributing/). Project-wide rules: [`AGENTS.md`](../AGENTS.md), [`CONTRIBUTING.md`](../CONTRIBUTING.md).

Contributors keep public behavior typed, documented, and verified in the same change.

## Before changing public behavior

- Read the relevant external docs page.
- Read the internal specification or ADR under `engineering/` when changing framework architecture.
- Check whether the touched area contains a thin wrapper over Effect that should be removed (the [architecture-debt sweep](contributing/architecture-debt.md) is part of every contribution).

## Required Docs Gate

```bash
bun run desktop check --docs
```

The gate verifies every release-blocking page exists, contains a runnable example, and the example covers the required tokens.

## Verify Docs Gate Exports

```ts run
import { runDocsReleaseGate } from "../packages/cli/src/index.js"

const command = "check --docs"

if (typeof runDocsReleaseGate !== "function" || command.length === 0) {
  throw new Error("runDocsReleaseGate is unavailable")
}
```

## Pull request rule

If a public API, command, config key, permission, or native capability changes, **update the matching page in `/docs`**. Reference pages are grounded in source — every documented symbol should be findable by `grep`.

## Where to go next

- [Contributing: docs](contributing/docs.md) — adding and updating pages
- [Contributing: architecture-debt sweep](contributing/architecture-debt.md)
- [`AGENTS.md`](../AGENTS.md) — repo-wide rules
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — workflow basics
