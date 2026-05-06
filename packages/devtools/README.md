# @effect-desktop/devtools

> **Status:** Phase 17 command observability surface. Broader devtools panels and transports are populated in Phase 19. See `docs/SPEC.md`.

## Purpose

Runtime inspector projections for framework primitives: windows, bridge calls, streams, resources, permissions, commands, processes, logs, traces, metrics, performance.

## Public API

`CommandsDevtools` is a read-only Effect service over `CommandRegistry`:

- `list()` returns registered commands with capability, owner scope, invocation count, last invocation, and last error.
- `observeInvocations()` streams command invocation telemetry as it happens.

`WorkersJobsDevtools` is a read-only Effect service over `Worker` and `Job`:

- `list()` returns one redacted snapshot containing live worker rows and live job rows.
- `observe()` emits an initial redacted snapshot and refreshes at the devtools frame interval.

`LiveRuntimePanels` is a read-only Effect service over runtime-owned sources:

- `list()` returns redacted bridge call, stream, resource, permission, and process table rows.
- `observe()` emits an initial redacted snapshot and refreshes at the devtools frame interval.
- Bridge and stream sources are supplied explicitly so missing runtime wiring cannot look like an empty successful panel.

`DevtoolsShell` owns the devtools listener lifecycle:

- `start({ profile, stateDir, devtoolsFlag, securityDevtoolsInProd })` starts only in dev or when both production gates are present.
- When enabled, it writes a fresh 256-bit token to the state directory with mode `0600`, binds a loopback listener, and opens the shell window through an explicit port.
- `disable` closes the listener and removes the token; re-enabling requires another `start` call.

The package depends on `@effect-desktop/core` because runtime services are the source of truth for observed state. Keeping the projection in devtools thin avoids a second command, resource, permission, or process read model.

## Non-goals

See `docs/SPEC.md` for the package's normative non-goals.

## Usage

```ts
import { CommandsDevtools } from "@effect-desktop/devtools"
import { Effect } from "effect"

const rows = await Effect.runPromise(
  Effect.gen(function* () {
    const commands = yield* CommandsDevtools
    return yield* commands.list()
  })
)
```

## Testing

```bash
bun test
bun run typecheck
```

## Platform notes

None until the package implements native-touching primitives.

## Internal Architecture

Devtools services project existing runtime services. They do not own application authority, invoke commands, or invent independent telemetry stores.
