# Build Artifact Identity Is Evidence

## Planned

Close two places where release checks trusted artifact shape or identity too late: package build manifests and reproducible build targets.

## Shipped

Packaging now decodes `app-manifest.json` before reading nested fields, returning typed `PackageFileError` failures for malformed build layouts. The reproducibility check now records target drift as a first-class difference before byte comparison can report a false green.

## Review Surface

The build manifest schema and reproducibility file comparison logic did not change. The gate now proves the manifest shape and target identity before trusting file paths or byte equality.

## Non-Obvious Lesson

Byte-identical output is not reproducibility when the two passes claim different targets. Identity is part of the artifact, not metadata beside it.

## AGENTS.md Amendment Candidate

None.
