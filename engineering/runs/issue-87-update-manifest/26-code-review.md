# Issue 87 Code Review: Update Manifest Format and Signature Verification

## Persona findings

### Correctness

- `packages/cli/src/update-manifest.ts:140` — must-fix — manifest integrity. The publish path reads artifact bytes for the Ed25519 artifact signature but still copies `sizeBytes` and `sha256` from `artifact.json` without recomputing them. A stale or tampered metadata file can produce a signed manifest whose digest fields do not describe the signed artifact. Smallest fix: recompute size and SHA-256 from the same bytes being signed and reject metadata mismatch as a typed error.

### Testing

- Same as Correctness. Add a failure-path test that stale artifact metadata returns a typed publish failure.

### Maintainability

- No additional findings. The publish module is deep enough to own manifest construction without leaking key or canonicalization details into the CLI adapter.

### Project standards

- Same as Correctness. The repo requires failure modes to be explicit values; metadata mismatch should fail before manifest signing completes.

### Security

- Same as Correctness. Digest fields are part of the update trust surface and must be bound to the bytes being signed.

### Previous findings

- Prior release-command learnings favor validating local artifact preconditions before resolving or using release secrets. This finding extends that rule to artifact metadata integrity.

## Posted review

- Review URL: pending at posting time.
- Summary body posted:
  - One must-fix finding: recompute artifact digest metadata before publishing.
- Inline comments:

| File                                  | Line | Severity | Body                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------- | ---: | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/cli/src/update-manifest.ts` |  140 | must-fix | `desktop publish` reads the artifact bytes here for the Ed25519 artifact signature, but the manifest still copies `sizeBytes` and `sha256` from `artifact.json` without recomputing them. Principle: the signed manifest must describe the same bytes being signed. Smallest fix: compute size/SHA-256 from `bytes`, compare to metadata, and return a typed publish error on mismatch. |

## Out-of-scope findings

None.

## Handoff

Review posted. Continue to `/address`.
