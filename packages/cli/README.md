# @effect-desktop/cli

> **Status:** Incremental implementation. The production check and build commands are active; remaining CLI commands are reserved for later phases. See `docs/SPEC.md`.

## Purpose

Developer CLI for creation, development, validation, packaging, and release: `create`, `dev`, `check`, `build`, `package`, `sign`, `notarize`, `publish`, `doctor`, `inspect`.

## Public API

`runCli(options)` executes the supported CLI commands behind an injectable I/O boundary.
`runDesktopBuild(options)` drives the Phase 21 build pipeline and returns a typed build report.

## Non-goals

See `docs/SPEC.md` for the package's normative non-goals.

## Usage

```ts
import { Effect } from "effect"
import { runCli } from "@effect-desktop/cli"

await Effect.runPromise(
  runCli({
    argv: ["build", "--config", "desktop.config.ts"],
    cwd: process.cwd(),
    writeStdout: process.stdout.write.bind(process.stdout),
    writeStderr: process.stderr.write.bind(process.stderr)
  })
)
```

## Testing

```bash
bun test
bun run typecheck
```

## Platform notes

`desktop build` refuses to produce platform-specific layouts for a non-matching host. Use `bun desktop doctor` on the target host when the command returns a target remediation.

## Internal architecture

The build command depends on `@effect-desktop/bridge` for the protocol version embedded in `bridge-manifest.json`, on `@effect-desktop/config` for production-check support, and on `effect` for typed command, file, and configuration failures.
