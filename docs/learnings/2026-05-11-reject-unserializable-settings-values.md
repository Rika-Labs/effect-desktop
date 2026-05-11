---
date: 2026-05-11
topic: Settings JSON serialization
issues: [669]
---

# Settings JSON serialization

Settings validated values through the caller schema and then handed the encoded
value to `JSON.stringify`. Thrown serialization errors were mapped to
`SettingsInvalidArgumentError`, but root values like functions and symbols make
`JSON.stringify` return `undefined`, which was then passed to storage.

The fix makes JSON text an explicit boundary. `kvSet` now receives text only
after `encodeJsonText` proves serialization produced a string; thrown errors and
non-string results both fail as `SettingsInvalidArgumentError`. The regression
checks root function and symbol values accepted by `Schema.Unknown`, and proves
no row or key index entry is written.

The lesson is that "JSON.stringify did not throw" is weaker than "we have JSON
text." Storage adapters should not be the first place invalid caller values
become observable.
