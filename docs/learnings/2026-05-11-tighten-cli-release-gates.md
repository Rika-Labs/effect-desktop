# Tighten CLI Release Gates

## Planned

Close small release-gate validation gaps in semver evidence and accessibility string scanning.

## Shipped

Semver releases now require canonical `X.Y.Z` numeric identifiers without leading-zero padding. The existing semver manifest decoder is covered by a wrong-type regression for `deprecationPolicy.minimumMinorReleases`. Accessibility scanning now treats single capitalized JSX text labels as hardcoded user-visible English instead of ignoring them as identifier-like noise.

## Lesson

Evidence gates should reject ambiguous release identity and visible copy shortcuts. Heuristics are useful only when they preserve the user-visible boundary they are meant to enforce.
