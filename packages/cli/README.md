# @effect-desktop/cli

> **Status:** Incremental implementation. The production check, build, package, sign, notarize, publish, release, repro check, and doctor commands are active; remaining CLI commands are reserved for later phases. See `docs/SPEC.md`.

## Purpose

Developer CLI for creation, development, validation, packaging, and release: `create`, `dev`, `check`, `build`, `package`, `sign`, `notarize`, `publish`, `release`, `doctor`, `inspect`.

## Public API

`runCli(options)` executes the supported CLI commands behind an injectable I/O boundary.
`runDesktopBuild(options)` drives the Phase 21 build pipeline and returns a typed build report.
`runDesktopPackage(options)` consumes a staged build layout and returns a typed package report.
`runDesktopSign(options)` consumes packaged artifacts and returns a typed signing report.
`runDesktopNotarize(options)` consumes signed macOS artifacts and returns a typed notarization report.
`runDesktopPublish(options)` consumes packaged artifacts and returns a signed update manifest report.
`runReleaseWorkflow(config, services)` coordinates package, sign, macOS notarization, and publish phases through Effect Workflow activities.
`runDesktopReproCheck(options)` runs build/package twice and returns a typed byte-diff report.
`runDesktopDoctor(options)` validates the local build environment and returns typed probe results.

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
`desktop package` follows the same host-target rule and emits only the artifact kinds listed in `docs/SPEC.md` §23.2. Windows system-mode MSI output is deferred to v1.1 and returns a typed unsupported-artifact error.
`desktop sign` follows the same host-target rule and signs existing packaged artifacts under `dist/desktop/<platform>`. macOS signing generates hardened-runtime entitlements and invokes `codesign`; Windows signing strips Mark-of-the-Web and invokes `signtool` with an RFC 3161 timestamp; Linux AppImage signing writes AppStream/desktop metadata and invokes `gpg`.
`desktop notarize` is macOS-only. It validates existing staples, submits unstapled `.app` and `.dmg` artifacts with `xcrun notarytool submit --wait`, staples accepted artifacts, and runs `spctl --assess --type execute --verbose=4`.
`desktop publish` reads packaged artifact metadata, signs artifact bytes and the canonical update manifest with Ed25519, verifies byte-stability, and writes `dist/desktop/update-manifest.json`. The private key is read from `update.privateKeyEnv`; reports persist only public signatures and manifest metadata.
`desktop release` runs package, sign, macOS notarization when the selected target is macOS, and publish as an Effect Workflow. The command reuses the existing phase modules as activities instead of maintaining a second release DSL.
`desktop check --repro` runs `build` and `package` twice with deterministic CLI clocks, snapshots the staged layout and package output, then byte-diffs sorted files. Differences return a structured `ReproDiffError` report with file paths, hashes, sizes, and first differing offsets.
`desktop doctor` checks Bun, Rust, platform SDK, WebView runtime, signing credentials, package tools, package manager state, native host cache, and desktop config. Required misses exit non-zero; optional signing/cache gaps report warnings; `--json` emits the CI payload.

## Internal architecture

The build command depends on `@effect-desktop/bridge` for the protocol version embedded in `bridge-manifest.json`, on `@effect-desktop/config` for production-check support, and on `effect` for typed command, file, and configuration failures. The package depends on `@effect/platform-bun` so live CLI entrypoints and repo packing scripts can provide Effect's filesystem, stdio, terminal, and child-process services at the process edge. The public API snapshot command uses the TypeScript compiler API at runtime, so `typescript` is a CLI runtime dependency rather than only a repo dev dependency. The package command owns the platform tool flags for `hdiutil`, `ditto`, WiX, `appimagetool`, `dpkg-deb`, and `rpmbuild` behind an injectable command runner so tests can verify artifact metadata without requiring every platform tool locally. The sign command owns `codesign`, `signtool`, `powershell Unblock-File`, and `gpg` invocation shape behind the same runner boundary. The notarize command owns `notarytool`, `stapler`, and `spctl` invocation shape and treats `stapler validate` exit codes as lifecycle state rather than thrown control flow. The publish command owns canonical update-manifest JSON and Ed25519 signing while `crates/native-updater` owns client-side verification. The release workflow owns only desktop release ordering policy; resumable phases are plain Effect Workflow activities over the existing package, sign, notarize, and publish modules. The reproducibility check composes existing runners instead of duplicating artifact production.
