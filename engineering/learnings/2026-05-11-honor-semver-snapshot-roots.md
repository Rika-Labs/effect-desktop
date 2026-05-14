---
date: 2026-05-11
topic: Semver manifest snapshot roots
issues: [660, 661]
---

# Semver manifest snapshot roots

The semver manifest is release evidence, so every field it exposes must either be enforced or
removed. The nested policy decoder already turns malformed policy objects into typed manifest
errors; the remaining gap was that `publicApiSnapshots` was decoded but not used by the API checker.

The fix threads the manifest snapshot root into `runPublicApiCheck` and rejects escaping or absolute
snapshot roots before the checker runs. Direct `desktop check --api` still uses the default
`api/snapshots` root.

The durable rule: release manifests should not contain inert configuration. A reviewed field must
change the checked behavior, and path fields must be contained before they reach filesystem reads.
