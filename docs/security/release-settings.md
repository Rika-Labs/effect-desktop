# Release Repository Settings

This file records the repository settings that cannot be truthfully enforced by
committed workflow YAML alone. `bun desktop check --release` verifies that these
settings have an auditable policy artifact before a release gate can pass.

## Secret Scanning

Secret scanning is enabled for every branch. Push protection is required where
GitHub exposes it for the repository plan. A secret scanning hit blocks merge
until the secret is revoked, removed, and the incident is recorded.

## Branch Protection

main requires at least one review before merge. release branches require at least two reviews,
including one security reviewer. Required release checks must include the release posture gate and
every release workflow supply-chain gate.

## Runner Posture

Release jobs run on Blacksmith ephemeral runners rebuilt from a clean image per
job. persistent self-hosted runners are forbidden for release jobs.

## CVSS Exemptions

CVSS findings at severity high or higher block release unless every finding has
a matching entry under `docs/security/exemptions`. Each exemption must include
`## Justification` and `## Re-review` sections.
