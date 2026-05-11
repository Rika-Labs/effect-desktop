# Contribution Guide

Contributions follow issue-scoped branches, Effect-first error handling, validation gates, reviews, learnings, and PR merges.

## Runnable Example

```ts run
import { runDocsReleaseGate } from "../packages/cli/src/index.js"

const gate = "check --docs"
if (typeof runDocsReleaseGate !== "function" || !gate.includes("--docs")) {
  throw new Error("docs contribution gate is unavailable")
}
```
