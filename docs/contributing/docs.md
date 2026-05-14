---
title: Updating the docs
description: How to add or change documentation, and how the release gate enforces it.
kind: contributing
audience: contributors
effect_version: 4
---

# Updating the docs

Docs are part of the public surface. The repository's release gate enforces that.

## Where to put new content

The docs follow [Diátaxis](https://diataxis.fr/) — four quadrants by reader need:

| You are writing | It belongs in |
| --- | --- |
| A guided walkthrough that ends with something running | `docs/tutorials/` |
| A short recipe for a single task | `docs/how-to/` |
| An API listing — symbols, signatures, layers, errors | `docs/reference/` |
| An essay on _why_ the framework looks this way | `docs/explanation/` |

Don't mix modes within a single page. A reference page that drifts into "and the reason we did it this way" should split off the rationale into `explanation/`. A tutorial that lists every option of every method should split off the listing into `reference/`.

## Page conventions

Every doc page has YAML frontmatter:

```yaml
---
title: Concise title
description: One sentence used in indexes and link previews.
kind: tutorial | how-to | reference | explanation | start | contributing | index
audience: app-developers | contributors
effect_version: 4
---
```

Code samples use real package names (`@effect-desktop/core`), not relative source paths. Cross-links use relative paths (`../reference/services/permission-registry.md`) so the tree can be re-mounted.

## The release gate

`docs/docs-manifest.json` declares the 23 release-blocking pages required by SPEC §25.3. The CLI enforces both their existence and that each contains at least one runnable example with the right tokens:

```bash
bun run desktop check --docs
```

If you change one of those pages, keep the runnable block and the required tokens. Tokens for each page live in `packages/cli/src/docs-release-gate.ts` (`REQUIRED_PAGE_COVERAGE_TOKENS`). The simplest pattern is a small ` ```ts run ` block that imports the symbols from the package source and asserts they are defined:

````md
```ts run
import { runCli } from "../packages/cli/src/index.js"

const command = "desktop --help"

if (typeof runCli !== "function" || command.length === 0) {
  throw new Error("documented behavior is unavailable")
}
```
````

The block is executed by Bun against a temporary working directory under the repo root. Imports are resolved from `<repo>/.docs-examples-XXXXX/`, so `"../packages/<name>/src/index.js"` reaches the workspace source.

## Adding a runnable example

Tag the code fence with `ts run`:

````md
```ts run
import { Schema } from "effect"
const schema = Schema.String
if (schema._tag !== "Refinement" && schema._tag !== "StringKeyword") {
  throw new Error("Schema.String is unavailable")
}
```
````

The CLI extracts every `ts run` block, writes it to a temp file, and runs `bun <file>`. A non-zero exit fails the gate. Keep examples small — examples have a default 60-second timeout per `DesktopTimeouts.docsExampleMillis`.

## Adding a brand-new page outside the 23 release set

You don't need to touch the manifest unless the page is release-blocking. Just create the file under the appropriate Diátaxis directory, add frontmatter, and link to it from `docs/README.md`. The release gate ignores anything not in the manifest.

## Adding a brand-new release-blocking page

1. Add the page file at the path you want.
2. Add an entry in `docs/docs-manifest.json`.
3. Add a coverage token entry in `packages/cli/src/docs-release-gate.ts` (`REQUIRED_PAGE_COVERAGE_TOKENS`) and the path entry in `REQUIRED_SPEC_PAGES`.
4. Update SPEC §25.3 to reflect the new required page.
5. Open a single PR with all four changes. The PR description should explain why this page rises to release-blocking.

## Updating package READMEs

Each package has a `README.md` that focuses on **what the package owns** and **what it doesn't**. Don't copy reference material into READMEs — link into `docs/reference/` instead. The README is for someone landing in `packages/<name>/` who needs to know what they're looking at.

## Linking into the source

When a doc page references a specific symbol, link to the line in the source for the curious reader:

```md
See the implementation at [`packages/native/src/window.ts`](../../packages/native/src/window.ts).
```

This keeps reference docs grounded — readers can verify any claim by walking one link.

## What docs explicitly do NOT cover

- Internal specifications, ADRs, RFCs, milestones, and run logs live in `engineering/`. Public docs link to those when relevant but don't reproduce them.
- Day-to-day commit conventions, lint rules, and contributor workflow live in `AGENTS.md`. Public docs assume those are followed.
- Roadmap and "coming soon" content stays out — describe what works today. Honest pre-v1 status is fine; speculative future tense is not.

## Related

- [Architecture-debt sweep](architecture-debt.md) — the sweep is part of every contribution
- [`AGENTS.md`](../../AGENTS.md) — repo-wide rules for contributors
