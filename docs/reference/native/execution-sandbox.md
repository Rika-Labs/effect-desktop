---
title: ExecutionSandbox (native)
description: Product-neutral isolated execution sandbox contract with typed fail-closed host behavior.
kind: reference
audience: app-developers
effect_version: 4
---

# `ExecutionSandbox`

Product-neutral isolated execution sandbox service. Callers create a sandbox with explicit cwd, environment, filesystem, network, budget, and cleanup policy, run a command inside that sandbox, and destroy the sandbox when the resource is no longer needed.

The public service is Layer-first and test-substitutable. The TypeScript service validates Schema contracts before transport, checks declared permissions before privileged work, emits typed lifecycle events, and records audit rows for privileged use and denial.

## Methods

| Method        | Payload                                   | Success                                                   |
| ------------- | ----------------------------------------- | --------------------------------------------------------- |
| `create`      | `{ actor, policy, sandboxId?, traceId? }` | `{ sandboxId, policy, state: "created" }`                 |
| `run`         | `{ sandboxId, command, args?, traceId? }` | `{ sandboxId, runId, status, exitCode?, stdout, stderr }` |
| `destroy`     | `{ sandboxId, traceId? }`                 | `{ sandboxId, destroyed }`                                |
| `isSupported` | `void`                                    | `{ supported, reason? }`                                  |
| `events`      | `void`                                    | stream of sandbox lifecycle events                        |

## Policy

The policy is data, not executable code:

- `cwd`
- `environment`
- `filesystem.readRoots`
- `filesystem.writeRoots`
- `network.hosts`
- `budgets.cpuMillis`
- `budgets.memoryBytes`
- `budgets.wallClockMillis`
- `budgets.stdoutBytes`
- `budgets.stderrBytes`
- `cleanup.killProcessTree`
- `cleanup.removeWorkingDirectory`

Filesystem and network access deny by default. Omitting `filesystem` or `network` normalizes to empty root and host lists, so no file or network permission is required and no file or network access is granted.

## Audit

The service audits permission use and denial. `create` checks filesystem and network permissions only when the policy asks for roots or hosts. `run` checks `process.spawn` for the command, cwd, and environment mode before calling the host client.

## Errors

`ExecutionSandboxError` is the canonical host protocol error union. Permission denial, unsupported platform behavior, invalid input, and host failures are typed tagged failures.

## Support

The current Rust host adapter is intentionally fail-closed while OS isolation adapters are not implemented.

| Platform | Status        | Reason                       |
| -------- | ------------- | ---------------------------- |
| macOS    | `unsupported` | `host-adapter-unimplemented` |
| Windows  | `unsupported` | `host-adapter-unimplemented` |
| Linux    | `unsupported` | `host-adapter-unimplemented` |

`isSupported` returns `{ supported: false, reason: "host-adapter-unimplemented" }`. Mutating host requests decode and validate payloads, then return typed `Unsupported`; invalid payloads are rejected before the unsupported response.

## Testing

Use `makeExecutionSandboxMemoryClient()` for deterministic create/run/destroy and event tests without OS prompts. Use `makeExecutionSandboxUnsupportedClient()` when a test needs the typed unsupported path.

## Related

- Source: [`packages/native/src/execution-sandbox.ts`](../../../packages/native/src/execution-sandbox.ts)
- Contract: [`packages/native/src/contracts/execution-sandbox.ts`](../../../packages/native/src/contracts/execution-sandbox.ts)
