# Serve Configured CSP

## Planned

Issue #857 required the host app protocol path to serve the effective CSP template rather than always rendering the built-in default.

## Shipped

The host CSP module now has a template renderer that substitutes the per-request nonce into a supplied policy template. The app scheme handler reads an optional `EFFECT_DESKTOP_CSP_TEMPLATE` value, uses that template for response headers when present, and falls back to the default spec CSP when absent.

## Review surfaced

The build manifest path is not present yet, so the stable host boundary is an explicit template input. Future build work can populate the same environment-backed boundary without changing nonce minting or response construction.

## Non-obvious lesson

The host should not reimplement CSP merge semantics. TypeScript owns effective policy rendering; Rust owns nonce substitution and header emission.

## AGENTS.md amendment candidate

None.
