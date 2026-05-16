# Issue 770 Architecture Review

## Verdict

LOCKED

## First-principles findings

No blocking findings. The problem is reduced to command resolution before CLI startup, not CLI behavior.

## Game-theory findings

No blocking findings. The architecture changes the incentive from "test the convenient internal path" to "smoke the command users see."

## Principle compliance findings

No blocking findings.

Important accepted trade-off: manifest-level script duplication is intentional. It is cheaper and clearer than adding a generalized command-resolution module that would hide no real policy.

## Reality check

### Agent A - Code grounding

The referenced files and behavior exist. Root `package.json` and `templates/basic-react-tailwind/package.json` do not currently expose `desktop`. `packages/cli/src/bin.ts` is the actual process entrypoint and delegates to `runCli`. The reproduced command fails with `Script not found "desktop"` before CLI code runs.

### Agent B - Prior art and incentive history

Prior CLI work keeps behavior in `runCli` and command-specific pipeline modules, with tests directly exercising those units. Existing learnings repeatedly favor gates that test the actual promise rather than a proxy metric. This issue should add one focused promise-level smoke without replacing all fast unit tests.

## Synthesis

The locked design is to add explicit `desktop` scripts at repo/template roots and a narrow smoke that proves `bun desktop` resolves. Keep issue #769 separate because external package installability changes dependency publishing semantics; this issue only makes documented project-root commands honest.

## Handoff

Architecture reviewed and locked. Continue to `/work`.
