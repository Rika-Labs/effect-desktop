# Issue 87 Learn: Update Manifest Format and Signature Verification

## Learning files written

| Path                                                                      | Title                                      | Codification target |
| ------------------------------------------------------------------------- | ------------------------------------------ | ------------------- |
| `engineering/learnings/2026-05-06-signed-manifests-bind-metadata-to-payloads.md` | Signed Manifests Bind Metadata To Payloads | test fixture        |

## Follow-up issues filed

None.

## AGENTS / skill amendment proposals

None. The repo rules already require explicit failure modes and no silent trust fallbacks.

## Commit and push

- `ac5ce9f` — `Record update manifest learning (#87)`
- Branch `issue-87-update-manifest` pushed to origin.
- PR CI after the learning commit:
  - `validate (blacksmith-2vcpu-ubuntu-2404)` — passed in 2m7s.
  - `validate (blacksmith-2vcpu-windows-2025)` — passed in 1m36s.
  - `validate (blacksmith-6vcpu-macos-latest)` — passed in 53s.

## Handoff

Learning committed and pushed. Continue to `/merge`.
