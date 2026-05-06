# Issue 85 Review: Code Signing

## Artifact inventory

| Artifact                | Status | Evidence                                                                                                                                                                                                                                             |
| ----------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub issue            | pass   | #85 body defines signer module, platform requirements, verification gates, and out-of-scope work.                                                                                                                                                    |
| Spec grounding          | pass   | `docs/SPEC.md` §16.2, §23.3, C.71, and C.72 define config keys and signing invariants.                                                                                                                                                               |
| Official tool grounding | pass   | `codesign` local man page confirms `--sign`, `--options runtime`, `--entitlements`, `--verify`, and strict validation; Microsoft SignTool docs confirm `/tr` + `/td` for RFC 3161 timestamps; GnuPG docs confirm `--local-user` and `--detach-sign`. |
| Architecture            | pass   | `05-architect.md` names one deep `Signer` module and CLI adapter.                                                                                                                                                                                    |

## Principle-compliance pass

| Principle                   | Status | Evidence                                                                                                | Fix  |
| --------------------------- | ------ | ------------------------------------------------------------------------------------------------------- | ---- |
| First-principles derivation | pass   | Module exists because one command must make platform signing defaults unreachable to callers.           | None |
| Minimal code                | pass   | One module, one CLI adapter, no new dependency.                                                         | None |
| Deep module                 | pass   | Callers do not compose `codesign`, `signtool`, or `gpg` flags.                                          | None |
| Single source of truth      | pass   | Entitlement and timestamp defaults live in `Signer`.                                                    | None |
| Typed errors                | pass   | Design requires tagged config/file/command/target errors with remediation.                              | None |
| Effect discipline           | pass   | Effectful filesystem/process/config paths use Effect; pure XML/plist formatting stays plain TypeScript. | None |
| Security                    | pass   | No ad-hoc signing fallback; missing signing config fails.                                               | None |
| Testability                 | pass   | Command runner is injectable and generated files are deterministic.                                     | None |

## Reality-check pass

- Future contributors will try to sign by adding flags in CLI parsing. Keeping command composition private to `Signer` makes that shortcut harder to copy.
- Missing platform certificates are common in CI. Tests must inject command runners and verify planned commands rather than requiring real signing identities.
- The risky silent failure is macOS flag ordering. Tests must assert `codesign --force --sign <identity> --options runtime --entitlements <file> <path>`.

## Required fixes before work

None.

## Permitted as-is

Real platform verification remains a manual/platform CI gate because this repository cannot hold real Developer ID, Authenticode, or GPG private keys.

## Issue candidates captured

The MSI inner-payload signing depth question is left as an open implementation note unless local evidence proves the Phase 21 MSI output exposes individual binaries to sign before WiX packaging.

## Verdict

locked

## Handoff

Design locked. Continue to `/work`.
