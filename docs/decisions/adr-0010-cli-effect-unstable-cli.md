# ADR-0010: Adopt effect/unstable/cli and replace hand-rolled arg parser (T09)

## Status

Accepted

## Context

`packages/cli/` hand-rolls argument parsing, help generation, and subcommand routing. Verbs include `desktop dev`, `build`, `package`, `sign`, `notarize`, `publish`, `doctor`, and `check`. Help text is hand-written; shell completion does not exist; validation errors are ad-hoc strings.

`effect/unstable/cli` ships `Command.make`, `Args`, and `Options` with typed argument values, generated help text, shell completion, and validation built in. Every flag and argument is a typed value; the help output is generated from the type declarations.

Programmatic helpers (`runDesktopBuild`, `runDesktopCheck`, etc.) are consumed directly by embedded tests and must not change signatures. Only the CLI entrypoint and its routing logic change.

## Decision

Convert every CLI verb to a `Command` value with typed `Args` and `Options`. Compose them at the top level via `Command.withSubcommands`. Replace the bespoke entrypoint.

- Each verb is a separate `Command` module in `packages/cli/src/commands/`.
- The root `desktop` command composes subcommands: `dev`, `build`, `package`, `sign`, `notarize`, `publish`, `doctor`, `check`.
- Programmatic helpers (`runDesktopBuild`, `runDesktopCheck`, etc.) keep their current signatures. Internal wiring changes; external API does not.
- The CLI entrypoint becomes a thin wrapper that runs the composed command in a Bun-provided runtime via `Command.run`.
- Help text and shell completion come from `effect/unstable/cli` automatically.
- Flag names and shapes are preserved exactly to avoid breaking existing scripts.

## Alternatives considered

**Keep bespoke parser**: shell completion is missing; help text is hand-maintained; typed validation is absent. As the CLI grows, the maintenance cost grows with it. Rejected.

**Use a third-party parser** (yargs, commander): breaks Effect-first composability; adds an outside-Effect dependency where Effect has a native solution. Rejected.

**Wait for stable**: the CLI parser is among the more stable `unstable/*` surfaces. Delay blocks completion of the dev loop (T22 Vite plugin depends on the CLI shape). Rejected.

## Consequences

**Positive**

- Help text and shell completion come for free from the type declarations.
- Every flag is typed; validation errors surface with the argument name and expected type.
- New subcommands are a single `Command.withSubcommands` addition.

**Negative**

- `effect/unstable/cli` is beta; generated help format may change before stable. The impact is cosmetic, not behavioral.
- Port-by-port migration requires snapshot tests of existing help output to catch unintended changes.

**Neutral**

- Programmatic API surface is unchanged; embedded tests do not require modification.

## Validation

Snapshot the existing `--help` output for every verb before the port; after the port, diff against the new generated help and accept only intentional improvements. Run existing CLI integration tests against the new entrypoint without modification. Verify shell completion produces non-empty output for one shell (zsh).

## Migration notes

1. Add `effect/unstable/cli` to `packages/cli`.
2. Create `packages/cli/src/commands/` with one file per verb.
3. Compose subcommands in `packages/cli/src/index.ts`.
4. Snapshot existing help output; diff after migration.
5. Keep `runDesktopBuild`, `runDesktopCheck`, and similar programmatic helpers at their current locations and signatures.
6. Replace the bespoke entrypoint with `Command.run`.
