# Contribution Guide

Contributions follow issue-scoped branches, Effect-first error handling, validation gates, reviews, learnings, and PR merges.

## Runnable Example

```ts run
import { CliUsageError } from "../packages/cli/src/index.js"

const error = new CliUsageError("docs")
if (error.name !== "CliUsageError") {
  throw new Error("unexpected CLI error name")
}
```
