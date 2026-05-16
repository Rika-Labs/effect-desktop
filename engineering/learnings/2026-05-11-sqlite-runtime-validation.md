# SQLite runtime validation

## Planned

Close issues #563 and #564 by moving SQLite parameter and transaction option validation into the runtime boundary before `bun:sqlite` observes caller input.

## Shipped

SQLite query, exec, and prepared statement methods now validate bind arrays and bind maps at runtime. Unsupported values such as `undefined` fail as `SqliteInvalidArgumentError`, while explicit `null` remains valid. Transactions now decode `mode` before acquiring the transaction lock or issuing `BEGIN`.

## Review surfaced

The TypeScript `SqliteParams` and `SqliteTransactionMode` types only protect typed local callers. Casted callers, bridge callers, and plugin inputs still reach runtime, so the public API must enforce the same contract dynamically.

## Lesson

Persistence adapters should receive already-validated inputs. If a driver coerces unsupported JavaScript values, the framework boundary must reject those values before persistence semantics become driver-specific.

## AGENTS.md amendment candidate

None.
