---
title: LocalToolRuntime (native)
description: Product-neutral local tool runtime contract with typed manifest policy and fail-closed host behavior.
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

`run` accepts a `commandId`, not an executable path. Unknown command IDs fail before host side effects. Commands reject shell metacharacters in executables before bridge transport.

## Audit

The service audits permission use and denial. `register` checks `native.invoke`, every manifest-declared permission, filesystem roots, and network hosts before calling the host client. `run` checks `process.spawn` for the manifest command, cwd, and environment mode before calling the host client.

## Errors

`LocalToolRuntimeError` is the canonical host protocol error union. Permission denial, unsupported platform behavior, invalid input, and host failures are typed tagged failures.

## Support

The current Rust host adapter is intentionally fail-closed while OS-specific local tool runners are not implemented.

| Platform | Status        | Reason                       |
| -------- | ------------- | ---------------------------- |
| macOS    | `unsupported` | `host-adapter-unimplemented` |
| Windows  | `unsupported` | `host-adapter-unimplemented` |
| Linux    | `unsupported` | `host-adapter-unimplemented` |

`isSupported` returns `{ supported: false, reason: "host-adapter-unimplemented" }`. Mutating host requests decode and validate payloads, then return typed `Unsupported`; invalid payloads are rejected before the unsupported response.

## Testing

Use `makeLocalToolRuntimeMemoryClient()` for deterministic register/run/stop/health and event tests without OS prompts. Use `makeLocalToolRuntimeUnsupportedClient()` when a test needs the typed unsupported path.

## Related

- Source: [`packages/native/src/local-tool-runtime.ts`](../../../packages/native/src/local-tool-runtime.ts)
- Contract: [`packages/native/src/contracts/local-tool-runtime.ts`](../../../packages/native/src/contracts/local-tool-runtime.ts)
