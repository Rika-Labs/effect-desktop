# Validate Window Config

## Planned

Issue #782 required `desktop build` to reject malformed `windows` config before build work and preserve valid window declarations in the host manifest.

## Shipped

Build normalization now validates `windows.defaults` and per-window declarations for documented title bar styles, traffic-light coordinates, booleans, hex colors, and positive dimensions. Valid window config is carried into `hostManifest.windows`.

## Review surfaced

The build plan already had a `windows` slot, but it was raw `unknown`. That made manifest output possible without making the config trustworthy.

## Non-obvious lesson

Manifest emission is not validation. Host-owned launch data must be checked before it is serialized into release artifacts.

## AGENTS.md amendment candidate

None.
