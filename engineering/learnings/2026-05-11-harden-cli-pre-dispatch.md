---
date: 2026-05-11
topic: CLI pre-dispatch contracts
issues: [629, 836]
---

# CLI pre-dispatch contracts

Root help and known value-flag usage errors happen before command execution, but they still carry
public CLI contracts. Help is a successful information path. `--json` is an automation contract for
adapter-owned failures.

The fix handles both cases before command dispatch: root `--help` and `-h` write root usage to
stdout with exit code `0`, while missing values for known flags write a structured
`CliUsageError` JSON envelope when `--json` is present.

The durable rule: CLI adapter errors need the same output-mode discipline as command errors. Parser
failures are still part of the process contract.
