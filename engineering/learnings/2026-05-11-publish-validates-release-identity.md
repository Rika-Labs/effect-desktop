# Publish validates release identity

## Context

`desktop publish` signs update manifests, so `app.id` and `app.version` are release identity fields. The publish path already required non-empty strings, but malformed IDs could be signed and version validation lacked a direct regression at the public CLI boundary.

## Change

Publish planning now validates `app.id` as a reverse-DNS ASCII identifier and keeps rejecting non-SemVer `app.version` before artifact discovery or manifest signing. Focused CLI tests prove both failures exit with `PublishConfigError` and leave no `update-manifest.json`.

## Lesson

Signed manifests must be inside the same identity domain as build and package metadata. Validate identity before signing, not after downstream clients or release tooling encounter malformed fields.
