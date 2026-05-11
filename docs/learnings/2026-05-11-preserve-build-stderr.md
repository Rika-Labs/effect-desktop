# Preserve Build Stderr

## Planned

Issue #767 required build failures and repro-check build failures to preserve child process diagnostics instead of collapsing them to `renderer command exited with 1`.

## Shipped

Build subprocess execution now captures bounded stdout and stderr. Failed build commands attach captured output to `BuildCommandFailedError`, and reproducibility checks include nested build output in their JSON/human error message.

## Review surfaced

The CLI was quiet on success by discarding child output, but the same mechanism erased the only actionable failure detail on non-zero exits.

## Non-obvious lesson

Quiet success and diagnostic failure are separate requirements. Suppressing successful tool logs must not mean discarding failed tool output.

## AGENTS.md amendment candidate

None.
