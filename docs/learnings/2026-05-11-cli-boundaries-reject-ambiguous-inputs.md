# CLI boundaries reject ambiguous inputs

## Context

Issues #580 and #581 both came from the same boundary mistake: the CLI accepted ambiguous or malformed release inputs and let deeper gates decide what they meant.

## What changed

Duplicate singleton value flags now fail before command dispatch, so `--config first --config second` cannot silently choose one config path.

Windows signing timestamp URLs now validate at the signing config boundary. Invalid values fail as `SignConfigError` before `powershell` or `signtool` runs.

## Lesson

Release CLI options are contracts, not hints. Validate singleton shape and external tool inputs before loading config-dependent work or invoking platform tools.
