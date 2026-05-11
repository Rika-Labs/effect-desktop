# Accessibility Manifests Are Inputs

## Planned

Close the remaining places where `release/accessibility.json` could look complete while carrying invalid shape, escaped paths, or mismatched audit evidence.

## Shipped

The accessibility gate now decodes manifest shape before semantic validation, resolves manifest paths before file reads, binds required audit mode IDs to their declared direction and color scheme, checks Pa11y URLs against the mode being credited, and rejects malformed six-digit hex contrast colors before ratio math.

## Review Surface

The change keeps the public manifest schema intact. It narrows accepted runtime input to the schema the gate already claimed to consume and keeps all malformed evidence in typed `AccessibilityGateManifestError` or `AccessibilityGateEvidenceError` failures.

## Non-Obvious Lesson

A release manifest is not trusted data. Counts, labels, and filenames are only useful after the gate proves the rows, paths, and payload identity all describe the same committed evidence.

## AGENTS.md Amendment Candidate

None.
