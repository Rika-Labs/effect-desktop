# Harden Shell Boundary Validation

## Planned

Issues #758 and #674 required Shell bridge validation to reject raw URL control characters and Windows `.cmd` command scripts before transport.

## Shipped

`Shell.openExternal` now rejects ASCII control characters on the raw URL string before parsing. `Shell.openPath` now treats `.cmd` as executable by default, preserving the existing `allowExecutable: true` opt-in.

## Review surfaced

`new URL(...)` is not the security boundary for native URL opening. The platform opener receives a string, so raw-string hygiene must happen before parser normalization.

## Non-obvious lesson

Native boundary checks should validate the bytes or string that cross the boundary, not only the parsed representation used for policy decisions.

## AGENTS.md amendment candidate

None.
