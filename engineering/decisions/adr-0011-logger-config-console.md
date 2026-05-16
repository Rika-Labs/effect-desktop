# ADR-0011: Adopt Effect Logger, Config, and Console across the framework (T10)

## Status

Accepted

## Context

Framework code uses ad-hoc `console.log` for diagnostics, ad-hoc `process.env` reads for configuration, and offers no leveled logging. This means:

- Secrets can appear in stringified error output (no `Config.redacted`).
- Log level cannot be changed at runtime without code changes.
- The OTel bridge from T06 (`@effect/opentelemetry`) receives no log records because nothing flows through Effect's `Logger`.
- Every new config knob is a `process.env` read scattered across files.

Effect ships `Logger` (structured, leveled, OTel-bridged), `Config` (typed env-driven configuration with redacted secrets), and `Console` (structured console output that routes through `Logger`).

## Decision

Adopt `Logger`, `Config`, and `Console` across framework-internal paths.

- A default `Logger.layer` is added to `Desktop.app` (T20 spine). In production it emits to the T06 OTel sink. In dev it emits to `Logger.pretty`.
- Per-component log levels are configurable via `LogLevel` — operators can set `EFFECT_DESKTOP_LOG_LEVEL=Debug` for a specific subsystem (bridge, runtime, etc.) without recompiling.
- All env-var reads move into a typed `Config` schema: `EFFECT_DESKTOP_LOG_LEVEL`, `EFFECT_DESKTOP_TELEMETRY_ENDPOINT`, and any secret tokens via `Config.redacted`. The schema is consumed at the T20 spine boot.
- `console.log` and `console.warn` in framework-internal paths are replaced with `Console.log` and `Console.warn`, which route through `Logger`.
- App-author code is not modified; this change is scoped to `packages/core` and `packages/cli` framework internals.
- `no-console` is already `error` in the oxlint config (AGENTS.md). After this migration, the lint rule enforces the new pattern for free.

Cross-links: [ADR-0007](adr-0007-opentelemetry.md) (OTel sink that Logger routes to in production).

## Alternatives considered

**Keep ad-hoc console + process.env**: forfeits OTel log integration; secrets can leak; no level control. Rejected.

**Use a third-party logger** (pino, winston): breaks Effect-first composability; no automatic fiber/span correlation. Rejected.

**Scope only to new code, leave existing console calls**: two logging surfaces coexist permanently; `grep console.log` in framework code stays non-zero. Rejected.

## Consequences

**Positive**

- Framework logs flow to the OTel sink; external tools see the same logs as devtools panels.
- `Config.redacted` ensures tokens never appear in stringified errors.
- Log level is a runtime config knob, not a compile-time constant.
- `no-console` lint rule enforces the pattern for future code automatically.

**Negative**

- Mechanical replacement of every `console.*` call in framework internals. Scope is bounded to `packages/core` and `packages/cli`.
- Behavioral change: previously ad-hoc logs were always emitted; with `Logger`, the default level gates them.

**Neutral**

- App-author code is untouched. The migration is a framework-internal cleanup.

## Validation

Boot the framework with `EFFECT_DESKTOP_LOG_LEVEL=Debug` and confirm structured records flow through the OTel sink in production mode and through `Logger.pretty` in dev. Set a redacted secret config and assert it never appears in stringified error output. `grep -r 'console\.log\|console\.warn' packages/core packages/cli` returns zero hits in framework-internal paths after migration.

## Migration notes

1. Add `Config` schema in `packages/core/src/runtime/config.ts`.
2. Add `Logger.layer` to the `Desktop.app` spine layer.
3. Expose per-component `LogLevel` configuration from the `Config` schema.
4. Run a mechanical `console.log` → `Console.log` replacement in `packages/core` and `packages/cli`.
5. Verify the `no-console` lint rule is active in both packages after migration.
