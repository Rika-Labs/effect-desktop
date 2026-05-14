# Issue 86 Learn: macOS Notarization

## Learning files written

| Path                                                                  | Title                                  | Codification target |
| --------------------------------------------------------------------- | -------------------------------------- | ------------------- |
| `engineering/learnings/2026-05-06-check-artifacts-before-release-secrets.md` | Check Artifacts Before Release Secrets | test fixture        |

## Follow-up issues filed

None.

## AGENTS / skill amendment proposals

None. The repo rules already require explicit preconditions, no swallowed errors, and no secret leakage.

## Commit and push

- `167598e` — `Record notarization credential learning (#86)`
- Branch `issue-86-macos-notarization` pushed to origin.
- PR CI after the learning commit:
  - `validate (blacksmith-2vcpu-ubuntu-2404)` — passed in 2m16s.
  - `validate (blacksmith-2vcpu-windows-2025)` — passed in 1m42s.
  - `validate (blacksmith-6vcpu-macos-latest)` — passed in 55s.

## Handoff

Learning committed and pushed. Continue to `/merge`.
