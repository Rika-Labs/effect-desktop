## Verdict

LOCKED.

## Findings

No blocking findings.

## Reality Check

- Code grounding: `produceMacosApp`, `plannedArtifact`, and `macosAppBundlePath` exist in `packages/cli/src/package-pipeline.ts`. The current `dmg` and `zip` branches call external tools directly and do not create the app bundle when selected alone. `runDesktopPackage` deletes `plan.outputPath`, so relying on prior output is impossible in a clean package run and unsafe in a fake-runner test.
- Prior art: Linux producers stage their own package roots before invoking external tools. Existing packaging learning emphasizes validating the exact artifact and identity metadata rather than trusting file existence alone.

## Pressure Test

- First principles: the design starts from the artifact dependency invariant, not from CLI parsing or tool behavior.
- Game theory: it removes the easy but unsafe local move of assuming default artifact ordering.
- Simplicity: local production state is smaller than a new planner module and hides real lifecycle state.
- Effect discipline: staging and tool failures remain typed Effect failures.
- Metadata: requested artifact metadata stays unchanged; prerequisite staging is reported as a step, not as an unrequested artifact.

## Locked Architecture

Use package-run state inside `package-pipeline.ts` to stage the macOS app bundle at most once. Make `produceArtifact` return all steps required by a requested artifact. Explicit `dmg` and `zip` runs ensure the app bundle before invoking `hdiutil` or `ditto`; default `app,dmg,zip` runs reuse the app step created by the first artifact.

Handoff: /issue
