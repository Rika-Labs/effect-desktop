# Validate Semver Release Evidence

## Planned

Close semver guard and public API snapshot evidence gaps for policy fields, matrix coverage, snapshot roots, snapshot identity, and verification matrix containment.

## Shipped

The semver guard now validates deprecation and bridge envelope policy values, rejects empty Appendix C coverage, decodes verification matrix rows as an object, rejects escaped matrix paths, and continues to pass the manifest snapshot root into the API checker. Public API snapshot checking now validates package name and entrypoint identity before diffing symbols.

## Review Surface

The release manifest remains the source of truth. Invalid evidence now fails before API diff classification or row lookup can produce a false-green release gate.

## Lesson

Release evidence paths and artifact metadata are trust boundaries. A compatibility gate must validate both the contents being compared and the identity of the artifact that selected those contents.

## AGENTS.md Amendment Candidate

None.
