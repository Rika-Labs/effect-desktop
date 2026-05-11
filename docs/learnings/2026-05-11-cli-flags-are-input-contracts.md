# CLI Flags Are Input Contracts

## Planned

Close CLI cases where supplied flags were silently ignored: unknown subcommand flags and multiple `desktop check` mode flags.

## Shipped

The CLI now validates known flags per subcommand before dispatch and rejects unknown `--...` flags as `CliUsageError`. `desktop check` now also rejects multiple mode flags before any check runner executes.

## Review Surface

The command surface did not change. The validation layer only makes the existing documented flags explicit, keeping mode-specific options such as `--config`, `--platform`, `--artifact`, `--renderer`, `--write`, and `--json` on their current commands.

## Non-Obvious Lesson

For release tooling, an ignored flag is not harmless compatibility. It is a false statement about what the command checked.

## AGENTS.md Amendment Candidate

None.
