# Match Network Unknown Host Policy

## Planned

Prevent a known-host-only network declaration from covering a broader request that enables unknown-host prompting.

## Shipped

`capabilityCovers` now compares `askUnknownHosts` for `network.connect` capabilities in addition to host coverage. The regression proves a same-host request with `askUnknownHosts: true` is denied when the declaration used `false`, while the same-policy request still grants.

## Lesson

Policy flags are part of authority. A matcher that only checks target names can silently widen behavior even when the host list is unchanged.
