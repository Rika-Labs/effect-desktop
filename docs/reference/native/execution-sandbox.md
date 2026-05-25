---
title: ExecutionSandbox (native)
description: Product-neutral isolated execution sandbox contract with typed fail-closed host behavior.
kind: reference
audience: app-developers
effect_version: 4
---

# `ExecutionSandbox`

Product-neutral isolated execution sandbox service. The contract describes creating a sandbox with explicit cwd, environment, filesystem, network, budget, and cleanup policy, running a command inside that sandbox, and destroying the sandbox when the resource is no longer needed. The create, run, and destroy operations are declared as capability facts but are not callable in this build; `isSupported` and the `ExecutionSandbox.events.Event` stream are the genuinely callable Effect RPC surface.

The public service is Layer-first and test-substitutable. Tests can inject a
deterministic client with `Layer.succeed(ExecutionSandbox)(client)`.

## Methods

| Method        | Payload | Success                                |
| ------------- | ------- | -------------------------------------- |
| `isSupported` | `void`  | `{ supported, reason? }`               |
| `events`      | `void`  | stream `ExecutionSandbox.events.Event` |

The bridge host event method remains `ExecutionSandbox.Event`; that name is a
native/web protocol boundary detail.

## Capability facts (non-callable)

`create`, `run`, and `destroy` are advertised in the native capability manifest as capability facts with `support.status: "unsupported"` (reason `host-adapter-unimplemented`). They are not invocable RPCs: the surface registers no handlers or client methods for them, and the RPC group exposes only `isSupported`. They exist only so the manifest can describe the intended sandbox lifecycle and so permission tooling can reason about the `native.invoke` authority they would require.

When OS isolation support lands, `create` would accept `{ actor, policy, sandboxId?, traceId? }` and return `{ sandboxId, policy, state: "created" }`, `run` would accept `{ sandboxId, command, args?, traceId? }` and return `{ sandboxId, runId, status, exitCode?, stdout, stderr }`, and `destroy` would accept `{ sandboxId, traceId? }` and return `{ sandboxId, destroyed }`.

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

`cwd`, `filesystem.readRoots`, and `filesystem.writeRoots` must be absolute platform paths without dot segments. Relative paths, drive-relative paths, incomplete UNC paths, and traversal-like roots are rejected before native transport or host side effects.

## Audit

The intended permission model audits permission use and denial: `create` would check filesystem and network permissions only when the policy asks for roots or hosts, and `run` would check `process.spawn` for the command, cwd, and environment mode before calling the host client. Because `create`, `run`, and `destroy` are non-callable capability facts in this build, no audit rows are produced for them yet.

## Errors

`ExecutionSandboxError` is the canonical host protocol error union. Permission denial, unsupported platform behavior, invalid input, and host failures are typed tagged failures.

## Support

The lifecycle operations are demoted to non-callable capability facts while OS isolation adapters are not implemented.
Production OS isolation is tracked in [issue #1406](https://github.com/Rika-Labs/effect-desktop/issues/1406).

| Platform | Status        | Reason                       |
| -------- | ------------- | ---------------------------- |
| macOS    | `unsupported` | `host-adapter-unimplemented` |
| Windows  | `unsupported` | `host-adapter-unimplemented` |
| Linux    | `unsupported` | `host-adapter-unimplemented` |

`isSupported` returns `{ supported: false, reason: "host-adapter-unimplemented" }`. The bridge-backed `ExecutionSandbox.events.Event` stream fails as typed `Unsupported` before opening a host subscription until an OS-enforced native adapter can publish lifecycle events.

## Testing

Use `makeExecutionSandboxMemoryClient()` for deterministic `isSupported` and
event tests without OS prompts. Use `makeExecutionSandboxUnsupportedClient()`
when a test needs the typed unsupported path. The `create`, `run`, and
`destroy` operations are manifest facts only until a native sandbox adapter is
implemented.

## Related

- Source: [`packages/native/src/execution-sandbox.ts`](../../../packages/native/src/execution-sandbox.ts)
- Contract: [`packages/native/src/contracts/execution-sandbox.ts`](../../../packages/native/src/contracts/execution-sandbox.ts)
