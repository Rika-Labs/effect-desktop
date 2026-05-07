# Issue 102 Code Review

## Persona Findings

| Persona         | Finding                                                                                                   | Severity | Principle                                      | Suggested fix                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Correctness     | Windows dark mode is forced on instead of following `SystemAppearance.getAppearance`.                     | major    | Source-of-truth behavior must match issue.     | Derive the DWM dark-mode flag from system appearance, or do not force it until that source is wired. |
| Correctness     | AppUserModelID is optional via `EFFECT_DESKTOP_APP_ID`, and the packaging path does not set that env var. | major    | Configured app identity must be authoritative. | Load AppUserModelID from package/build manifest or another package-owned launch contract.            |
| Testing         | Existing tests prove shape but not the source-of-truth wiring for appearance and app identity.            | major    | Tests must cover the invariant, not the hook.  | Add tests for light/dark mapping and for extracting `app.id` from the packaged app manifest.         |
| Maintainability | Host and package boundaries are otherwise clean: WinAPI in `crates/host`, WiX metadata in `packages/cli`. | none     | Deep module, narrow surface                    | None                                                                                                 |
| Standards       | TypeScript packaging stays Effect-based and returns typed failures as values.                             | none     | Effect-first effectful TypeScript              | None                                                                                                 |
| Security        | No new untrusted command execution or secret handling path.                                               | none     | Trust boundary unchanged                       | None                                                                                                 |

## Posted Review

- Review URL: https://github.com/Rika-Labs/effect-desktop/pull/312#pullrequestreview-4240524133
- Summary body: 0 blockers, 2 majors, 0 minors, 0 nits.

| File:line                        | Severity | Body                                                                                               |
| -------------------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `crates/host/src/windows.rs:107` | major    | `dark` is hardcoded to `1`, so Windows dark mode does not follow system appearance.                |
| `crates/host/src/windows.rs:20`  | major    | Missing `EFFECT_DESKTOP_APP_ID` silently skips AppUserModelID, and packaging does not set the env. |

## Out-Of-Scope Findings

None.

## Handoff

Review posted. Continue to `/address`.
