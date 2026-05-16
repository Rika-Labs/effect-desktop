# Validate Windows thumbprints before signtool

## Context

Windows signing accepted any non-empty `signing.windows.thumbprint` and passed it to `signtool /sha1`. Malformed certificate selectors were delegated to host tooling instead of failing as deterministic config errors.

## Change

The signer now validates Windows thumbprints as 40-character SHA-1 hex strings before building Authenticode arguments. Malformed thumbprints fail with `SignConfigError` before the signing runner is invoked, while valid thumbprint and PFX signing paths still pass.

## Lesson

Release credentials are configuration boundaries. Validate selector syntax before invoking mutable platform tooling so failures are typed, local, and reproducible.
