---
title: LocalToolRuntime (native)
description: Product-neutral local tool runtime contract with typed manifest policy and host process execution.
kind: reference
audience: app-developers
effect_version: 4
---

# `LocalToolRuntime`

Product-neutral local tool runtime service. Callers register a tool manifest with explicit command IDs, cwd roots, environment, filesystem, network, budget, stdio, cleanup, health, and permission policy, then run only the commands declared by that manifest.

The public service is Layer-first and test-substitutable. The TypeScript service validates Schema contracts before transport, checks manifest-declared permissions before privileged work, emits typed lifecycle events, and records audit rows for privileged use and denial.

## Methods

| Method        | Payload                                     | Success                                                   |
| ------------- | ------------------------------------------- | --------------------------------------------------------- |
| `register`    | `{ actor, manifest, runtimeId?, traceId? }` | `{ runtimeId, toolId, manifest, state: "registered" }`    |
| `run`         | `{ runtimeId, commandId, args?, traceId? }` | `{ runtimeId, commandId, runId, status, stdout, stderr }` |
| `stop`        | `{ runtimeId, traceId? }`                   | `{ runtimeId, stopped }`                                  |
| `health`      | `{ runtimeId, traceId? }`                   | `{ runtimeId, status, checkedAt, reason? }`               |
| `isSupported` | `void`                                      | `{ supported, reason? }`                                  |
| `events`      | `void`                                      | stream of local tool runtime lifecycle events             |

## Manifest Policy

The manifest is data, not executable code:

- `commands[].commandId`
- `commands[].executable`
- `commands[].defaultArgs`
- `commands[].cwd`
- `commands[].environment`
- `permissions`
- `policy.cwd.roots`
- `policy.environment.variables`
- `policy.filesystem.readRoots`
- `policy.filesystem.writeRoots`
- `policy.network.hosts`
- `policy.budgets.cpuMillis`
- `policy.budgets.memoryBytes`
- `policy.budgets.wallClockMillis`
- `policy.budgets.stdoutBytes`
- `policy.budgets.stderrBytes`
- `policy.stdio.stdout`
- `policy.stdio.stderr`
- `policy.cleanup.killProcessTree`
- `policy.cleanup.removeWorkingDirectory`
- `health.commandId`
- `health.intervalMillis`
- `health.timeoutMillis`

`run` accepts a `commandId`, not an executable path. Unknown command IDs fail before host side effects. Commands reject shell metacharacters in executables before bridge transport. The host requires `commands[].executable` to be an absolute path to an existing file.

## Audit

The service audits permission use and denial. `register` checks `native.invoke`, every manifest-declared permission, filesystem roots, and network hosts before calling the host client. `run` checks `process.spawn` for the manifest command, cwd, and environment mode before calling the host client.

## Errors

`LocalToolRuntimeError` is the canonical host protocol error union. Permission denial, unsupported platform behavior, invalid input, and host failures are typed tagged failures.

## Support

The Rust host adapter registers manifests in host state and runs only declared command IDs. The adapter canonicalizes cwd roots, requires command working directories under those roots, spawns absolute executable paths without a shell, projects the declared environment, captures or suppresses stdout and stderr according to stdio policy, enforces wall-clock and output-size budgets, and cleans the process tree when requested. Inherited stdio is rejected because the host stdout pipe carries framed protocol traffic.

`policy.budgets.cpuMillis` and `policy.budgets.memoryBytes` accept only the unbounded sentinel `9007199254740991` until host OS CPU and memory enforcement exists. Constrained CPU or memory budgets fail closed with typed `Unsupported`. `policy.cleanup.removeWorkingDirectory: true` is rejected with typed `Unsupported` until ephemeral working-directory ownership has a safe host implementation. Issue [#1404](https://github.com/Rika-Labs/effect-desktop/issues/1404) tracks both gaps.

| Platform | Status        |
| -------- | ------------- |
| macOS    | `supported`   |
| Windows  | `unsupported` |
| Linux    | `supported`   |

`isSupported` returns `{ supported: true }` on Unix host builds and typed `Unsupported` metadata elsewhere. Windows remains unsupported until its host execution path is covered by CI; issue [#1405](https://github.com/Rika-Labs/effect-desktop/issues/1405) tracks that enablement. Invalid payloads, duplicate runtimes, unknown runtimes, unknown commands, cwd escapes, spawn failures, and output budget failures are returned as typed host protocol errors. Process exit failure and wall-clock timeout are terminal `run` result statuses.

## Architecture-Debt Sweep

Issue [#1394](https://github.com/Rika-Labs/effect-desktop/issues/1394) removed service-local event mirroring so `LocalToolRuntime.events()` delegates to the bridge event stream. The remaining host protocol helpers carry native/web routing, Schema-coded payloads, and OS process lifecycle policy; no additional zero-policy Effect wrapper debt was found in the touched path. Follow-ups [#1404](https://github.com/Rika-Labs/effect-desktop/issues/1404) and [#1405](https://github.com/Rika-Labs/effect-desktop/issues/1405) track cleanup-budget enforcement and Windows host execution coverage.

## Testing

Use `makeLocalToolRuntimeMemoryClient()` for deterministic register/run/stop/health and event tests without OS prompts. Use `makeLocalToolRuntimeUnsupportedClient()` when a test needs the typed unsupported path.

## Related

- Source: [`packages/native/src/local-tool-runtime.ts`](../../../packages/native/src/local-tool-runtime.ts)
- Contract: [`packages/native/src/contracts/local-tool-runtime.ts`](../../../packages/native/src/contracts/local-tool-runtime.ts)
