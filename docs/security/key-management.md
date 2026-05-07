# Release Key Management

Effect Desktop release artifacts are signed with an HSM-backed release key. The
release workflow must select `RELEASE_SIGNING_BACKEND=hsm` before invoking
`bun desktop sign`; runner-local keys are forbidden for release jobs.

## Custody

The release key is held outside the CI runner in a hardware-backed signing
service. CI receives only short-lived signing authority for the active release
job. Private key material must never be written to the workspace, cache,
artifact store, or environment as raw bytes.

## Rotation

Release signing keys are rotated on compromise, maintainer offboarding, or the
scheduled annual rotation window. Rotation records must name the retired key,
new trust anchor, affected release range, and validation evidence for the first
release signed by the new key.

## Verification

Release reviewers verify that the release workflow uses the HSM-backed signing
backend and that published artifacts validate against the current trust anchor.
Any fallback to a runner-local key blocks the release.
