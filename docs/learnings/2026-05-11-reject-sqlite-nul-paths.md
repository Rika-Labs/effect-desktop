---
date: 2026-05-11
topic: SQLite path byte validation
issues: [628]
---

# SQLite path byte validation

`SQLite.connect` decoded `path` as only a non-empty string. A NUL-containing path reached
`bun:sqlite`, where it was reported as driver misuse instead of caller-owned invalid input.

The fix validates SQLite path bytes during connect input decoding. NUL paths fail as
`SqliteInvalidArgumentError` before database construction and before resource registration.

The durable rule: native path boundaries should reject impossible path bytes before calling the
driver. Driver errors should represent driver or storage faults, not basic API input ownership.
