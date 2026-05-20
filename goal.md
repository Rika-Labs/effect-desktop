# ORIKA Release Completion Goal

## Objective

Complete the ORIKA release-readiness work tracked by GitHub issues #1437 through #1446 before treating this repository as ready for a broader public v1.0.0 release.

The public framework name is ORIKA. Public package names must use the `@orika/*` scope, for example `@orika/native`. The older `@effect-desktop/*` package family is a prerelease name and should not remain in public APIs, docs, examples, templates, tests, or release guidance unless a compatibility shim is explicitly implemented, tested, documented, and justified.

The release must also resolve native capability support truth. A capability is release-ready only when it is one of the following:

- Implemented end-to-end with native host routing, typed TypeScript API surface, deterministic tests or fixtures, documentation, and an honest support statement.
- Explicitly unsupported with a stable, documented error contract and no public claim that it works.
- Removed or deferred from the v1.0.0 public surface with docs and examples updated so users cannot mistake it for supported API.

## Non-Goals

- Do not spend effort aligning, linting, or expanding a separate spec for its own sake.
- Do not preserve legacy prerelease compatibility solely to keep `@effect-desktop/*` working.
- Do not hide unsupported native behavior by changing only documentation.
- Do not add wrapper layers, custom DSLs, or adapter APIs unless they own durable desktop-specific policy, lifecycle, security, or native/web protocol translation.

## Source Issues

| Order | Issue                                                                              | URL                                                     | Primary Outcome                                                                                                   |
| ----- | ---------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1     | #1437 Rename public package family to @orika/\*                                    | https://github.com/Rika-Labs/effect-desktop/issues/1437 | Repository package names, imports, templates, examples, docs, API snapshots, and release metadata use `@orika/*`. |
| 2     | #1438 Make native capability support release-complete                              | https://github.com/Rika-Labs/effect-desktop/issues/1438 | Capability support is implemented, removed, or explicitly unsupported with a verified ledger.                     |
| 3     | #1439 Complete browser, session, and WebView native capabilities                   | https://github.com/Rika-Labs/effect-desktop/issues/1439 | Browser/session/WebView APIs are completed or narrowed honestly.                                                  |
| 4     | #1440 Complete native network, download, and auth capabilities                     | https://github.com/Rika-Labs/effect-desktop/issues/1440 | Network/download/auth APIs are completed or narrowed honestly.                                                    |
| 5     | #1441 Complete menu, context menu, shortcut, and dock capabilities                 | https://github.com/Rika-Labs/effect-desktop/issues/1441 | Menu/context-menu/shortcut/dock APIs are completed or narrowed honestly.                                          |
| 6     | #1442 Complete window, tray, notification, dialog, and shell platform parity       | https://github.com/Rika-Labs/effect-desktop/issues/1442 | Window/tray/notification/dialog/shell gaps are resolved per platform.                                             |
| 7     | #1443 Complete app context, selection, grant, and transient window native surfaces | https://github.com/Rika-Labs/effect-desktop/issues/1443 | App-context/selection/grant/transient-window APIs are completed or narrowed honestly.                             |
| 8     | #1444 Complete execution sandbox and egress policy native support                  | https://github.com/Rika-Labs/effect-desktop/issues/1444 | Sandbox/egress APIs have enforceable native behavior or are removed from supported claims.                        |
| 9     | #1445 Complete updater, crash, media, power, appearance, and display support       | https://github.com/Rika-Labs/effect-desktop/issues/1445 | Updater/crash/media/power/appearance/display APIs are completed or narrowed honestly.                             |
| 10    | #1446 Update public docs for ORIKA and current native support                      | https://github.com/Rika-Labs/effect-desktop/issues/1446 | Public docs match the ORIKA name and the verified support matrix.                                                 |

## Current Baseline

Research before opening the issues found the native support matrix at:

- 291 total native capability methods.
- 229 routed through native host paths.
- 0 missing host routes among routed methods.
- 158 supported methods.
- 71 partial methods.
- 62 unsupported methods.

The same research found stale or misleading docs around at least SafeStorage and Updater support. Release gates previously passed at the repository baseline:

- `bun run check`
- `bun run typecheck`
- `bun test`
- `cargo check --workspace`
- `cargo test --workspace`
- `cargo fmt --check`
- `cargo clippy --workspace --all-targets -- -D warnings`
- CLI release gates for `--release`, `--docs`, `--api`, `--a11y`, `--semver`, and production config validation for `apps/inspector/desktop.config.ts`

These commands are baseline evidence, not final evidence. Each issue must be reverified after its changes.

## Package Rename Contract

The intended package family is `@orika/*`. The expected rename set is:

- `@effect-desktop/core` to `@orika/core`
- `@effect-desktop/native` to `@orika/native`
- `@effect-desktop/bridge` to `@orika/bridge`
- `@effect-desktop/react` to `@orika/react`
- `@effect-desktop/vue` to `@orika/vue`
- `@effect-desktop/solid` to `@orika/solid`
- `@effect-desktop/next` to `@orika/next`
- `@effect-desktop/vite` to `@orika/vite`
- `@effect-desktop/platform-browser` to `@orika/platform-browser`
- `@effect-desktop/config` to `@orika/config`
- `@effect-desktop/test` to `@orika/test`
- `@effect-desktop/devtools` to `@orika/devtools`
- `@effect-desktop/cli` to `@orika/cli`

If additional public packages exist, they must follow the same rule. Internal-only package names may remain unscoped only when they are not published, not documented as public, and not imported by user-facing examples.

## Issue Acceptance Criteria

### #1437 Rename public package family to @orika/\*

- Every published package manifest uses the `@orika/*` name.
- Workspace dependencies and peer dependencies reference `@orika/*`.
- Source imports, examples, templates, tests, docs, generated API snapshots, CLI help, starter app metadata, and release docs no longer present `@effect-desktop/*` as the primary package family.
- Lockfile and package manager metadata are regenerated through the repository's normal package manager.
- Any intentional compatibility alias is explicit, tested, documented, and justified. The preferred outcome is no compatibility alias for prerelease names.
- Architecture-debt sweep is recorded for the touched package/import boundary.

### #1438 Make native capability support release-complete

- A single capability ledger identifies every public native method as supported, partial, unsupported, removed, or deferred.
- Each partial or unsupported method has a concrete resolution: implement, narrow/remove, or document an explicit unsupported error.
- The release gate fails when public docs or API metadata claim more support than the verified ledger.
- Native support checks are deterministic and runnable without real OS prompts, network services, or external native hosts unless a test explicitly uses a fixture host.
- Architecture-debt sweep is recorded for the capability registry, bridge boundary, and any support-matrix helpers.

### #1439 Complete browser, session, and WebView native capabilities

- Browser, session, permission, WebView, preload, storage, cookie, and navigation APIs are either implemented end-to-end or removed/narrowed from public support.
- Host route coverage, error handling, and TypeScript contracts agree.
- Tests cover the supported path and at least one expected failure path for each completed capability group.
- Docs and examples avoid implying support for methods still unsupported.
- Architecture-debt sweep is recorded for browser/session/WebView adapters.

### #1440 Complete native network, download, and auth capabilities

- Network, download, proxy, certificate, protocol, HTTP auth, and related request/response APIs are either implemented end-to-end or removed/narrowed from public support.
- Unsupported platform behavior returns a stable typed error rather than a generic failure.
- Tests cover deterministic native fixtures or explicit unsupported behavior.
- Docs describe what is enforced natively and what is application-level only.
- Architecture-debt sweep is recorded for network/download/auth adapters.

### #1441 Complete menu, context menu, shortcut, and dock capabilities

- Menu, context menu, shortcut, accelerator, dock, app menu, and platform menu behavior is implemented or narrowed per supported platform.
- Platform differences are explicit and tested where they affect public behavior.
- APIs do not expose stale no-op success paths.
- Docs and examples show ORIKA package names and actual supported behavior.
- Architecture-debt sweep is recorded for menu and shortcut abstractions.

### #1442 Complete window, tray, notification, dialog, and shell platform parity

- Window, tray, notification, dialog, shell, file picker, URL opener, and platform shell behavior is implemented or narrowed per supported platform.
- Capability failures are typed and observable.
- Tests cover supported host calls and unsupported platform branches.
- Docs include platform support statements where behavior differs.
- Architecture-debt sweep is recorded for window/tray/dialog/shell wrappers.

### #1443 Complete app context, selection, grant, and transient window native surfaces

- App context, selection, grant, transient window, focus, lifecycle, and related native surfaces are implemented or removed/narrowed.
- Permission/grant behavior is explicit at the boundary and does not rely on hidden mutable process state.
- Tests cover grant success, denial, and unsupported branches where applicable.
- Docs avoid presenting experimental internal surfaces as stable v1.0.0 APIs.
- Architecture-debt sweep is recorded for app-context/grant/transient-window abstractions.

### #1444 Complete execution sandbox and egress policy native support

- Execution sandbox and egress policy claims are backed by enforceable native behavior or removed from the supported API surface.
- Policy data is structured and validated at the boundary.
- Unsupported enforcement paths fail closed with typed errors.
- Tests prove enforcement behavior using fixtures or deterministic denial paths.
- Architecture-debt sweep is recorded for sandbox, policy, and config helpers.

### #1445 Complete updater, crash, media, power, appearance, and display support

- Updater, crash reporting, media, power monitor, appearance, display, and system integration APIs are implemented or narrowed honestly.
- Existing stale docs, especially around updater support, are corrected.
- Platform-specific support is explicit.
- Tests cover supported paths and explicit unsupported errors.
- Architecture-debt sweep is recorded for updater/crash/media/power/appearance/display wrappers.

### #1446 Update public docs for ORIKA and current native support

- Public docs use ORIKA and `@orika/*` consistently.
- Installation, quickstart, templates, API examples, release notes, and migration guidance are updated.
- Native capability docs match the final verified ledger.
- Deprecated or removed prerelease APIs are not presented as public v1.0.0 APIs.
- Documentation verification passes, including links, examples, generated API references, and release checks available in this repository.
- Architecture-debt sweep is recorded for docs-only helper scripts or generated docs configuration touched during this work.

## Architecture-Debt Sweep Requirement

Every issue must include an architecture-debt sweep before it is closed. The sweep must inspect the area touched by that issue for:

- Adapters that only rename Effect APIs.
- Thin wrapper layers over Effect primitives.
- Custom DSLs where Effect Schema, RPC, Layer, Stream, Schedule, Scope, or Config would be the direct contract.
- Bridge specs that have leaked into internal architecture rather than remaining boundary descriptions.
- Convenience APIs that partially reimplement Effect behavior without durable desktop semantics.
- `unknown as` or other broad assertions inside Effect-owned code.

The outcome must be recorded in the issue, PR, or local evidence before completion:

- Wrappers removed.
- Follow-up issues opened with concrete before/after migration targets.
- No debt found in the touched area.

## Verification Contract

Use the tightest feedback loop available for each issue. The expected full repository verification set is:

- `bun install --frozen-lockfile`
- `bun run typecheck`
- `bun test`
- `bun run check`
- `cargo check --workspace`
- `cargo test --workspace`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `cargo fmt --check`

Additional targeted verification must be added as needed:

- Native capability matrix or support ledger generation.
- API snapshot generation or comparison.
- CLI release gates for release, docs, API, accessibility, semver, and production config validation.
- Template smoke tests after package renames.
- Documentation build or link checks where available.

If a command cannot run in this environment, record the exact blocker and what remains unverified.

## Operating Order

1. Complete #1437 first so every later code, docs, and snapshot change uses the final public package names.
2. Complete #1438 second so native support decisions are driven by one verified ledger.
3. Work #1439 through #1445 by subsystem, implementing only the smallest correct support surface or narrowing unsupported APIs honestly.
4. Complete #1446 last so public docs reflect the final code and support matrix.
5. Re-run the full verification contract.
6. Close or update each issue with implementation evidence, verification evidence, and architecture-debt sweep outcome.

## Completion Criteria

This goal is complete only when:

- Issues #1437 through #1446 are closed, or any remaining item is explicitly deferred with public API/docs narrowed so it is not a v1.0.0 promise.
- The repository no longer presents `@effect-desktop/*` as the public package family.
- Public docs consistently use ORIKA and `@orika/*`.
- Native capability support is truthful, enforced by tests or release gates, and no stale docs claim unsupported behavior works.
- Architecture-debt sweep outcomes are recorded for every issue.
- Final verification evidence is recorded with exact commands and results.

## Status

- [x] #1437 Rename public package family to @orika/\*
- [x] #1438 Make native capability support release-complete
- [x] #1439 Complete browser, session, and WebView native capabilities
- [x] #1440 Complete native network, download, and auth capabilities
- [x] #1441 Complete menu, context menu, shortcut, and dock capabilities
- [x] #1442 Complete window, tray, notification, dialog, and shell platform parity
- [x] #1443 Complete app context, selection, grant, and transient window native surfaces
- [x] #1444 Complete execution sandbox and egress policy native support
- [x] #1445 Complete updater, crash, media, power, appearance, and display support
- [x] #1446 Update public docs for ORIKA and current native support

## Local Completion Evidence

All issue work is implemented and verified locally. GitHub issues #1437-#1446 remain open until the branch is merged so the issue tracker does not claim unreleased local work is already public repository state.

Final local verification passed:

- `bun install --frozen-lockfile`
- `bun run typecheck`
- `bun test`
- `bun run check`
- `bun desktop check --api --write`
- `bun desktop check --api`
- `bun desktop check --docs`
- `cargo fmt --check`
- `cargo check --workspace`
- `cargo test --workspace`
- `cargo clippy --workspace --all-targets -- -D warnings`
