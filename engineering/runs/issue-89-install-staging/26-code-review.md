# Issue 89 Code Review

## Persona Findings

| Persona           | Finding                                                                                                                                       | Severity | Principle                                                              | Suggested fix                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Correctness       | `commit_staged_install` uses `std::fs::rename` to replace `current_bundle`, but Windows does not replace an existing destination with rename. | must-fix | Cross-platform native branches must have a tested implementation path. | Add a platform-specific atomic replace helper and test committing over an existing current bundle. |
| Testing           | The commit test covers only a missing current bundle, not the normal installed-bundle replacement path.                                       | must-fix | Tests must cover the failure path reviewers are relying on.            | Extend the commit test to create existing current bytes before commit.                             |
| Maintainability   | The staging core keeps narrow types and does not mix host restart I/O into the crate.                                                         | none     | Deep module, narrow surface                                            | None                                                                                               |
| Project standards | Dependency note for `sha2` is present.                                                                                                        | none     | Dependency documentation rule                                          | None                                                                                               |
| Security          | Downloaded bytes are size and digest checked before staging.                                                                                  | none     | Verify before commit                                                   | None                                                                                               |
| Previous findings | Audience binding from #88 remains intact and untouched.                                                                                       | none     | Preserve signed-metadata audience binding                              | None                                                                                               |

## Posted Review

- Review URL: https://github.com/Rika-Labs/effect-desktop/pull/277#pullrequestreview-4240403985
- Summary body: Code review found one must-fix correctness issue in the install commit path.

| File:line                              | Severity | Body                                                                                                                                                     |
| -------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crates/native-updater/src/lib.rs:421` | must-fix | `std::fs::rename` does not replace an existing destination on Windows, and the commit test only covers the easier case where `current_bundle` is absent. |

## Out-Of-Scope Findings

None.

## Handoff

Review posted. Continue to `/address`.
