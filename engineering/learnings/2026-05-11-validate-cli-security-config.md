# Validate CLI Security Config

## Planned

Issues #785 and #786 required build and doctor to reject unsupported security policy values and oversized protocol limits instead of reporting a false-green config probe or producing a manifest from invalid policy.

## Shipped

Build normalization now validates `security.externalNavigation` as `"deny" | "ask"` and `security.devtoolsInProd` as boolean, then emits the normalized renderer policy. Doctor now rejects invalid security values and protocol limit values above their caps in the config probe.

## Review surfaced

Build already owned protocol limit validation and manifest output, but doctor had a separate shallow config probe. That split let doctor say the config was healthy while build rejected the same limit values.

## Non-obvious lesson

Doctor checks must validate the same operator-facing invariants as build when the field controls runtime safety. Metadata-only config probes create false release evidence.

## AGENTS.md amendment candidate

None.
