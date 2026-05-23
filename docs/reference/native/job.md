---
title: Job (native)
description: Durable native job lifecycle records with progress and control events.
kind: reference
audience: app-developers
effect_version: 4
---

# `Job`

`Job` is a durable lifecycle control plane for long-running work. It records job state in the native host store, exposes typed controls, and emits lifecycle events that renderer code can observe.

This surface does not execute arbitrary work. Application or framework code owns the actual work and binds it to a stable job id. The native layer owns the durable state record, generation-stamped handle, progress, interruption state, and event stream.

`Job` is not a download transport. It can record lifecycle state for work a caller already owns, but it does not fetch bytes, choose destinations, pause/resume network transfers, or provide download-specific terminal events.

## Methods

| Method           | Payload                                  | Success                  |
| ---------------- | ---------------------------------------- | ------------------------ |
| `start`          | `{ jobId?, name, traceId? }`             | `JobSnapshot`            |
| `pause`          | `{ jobId, reason?, traceId? }`           | `JobSnapshot`            |
| `resume`         | `{ jobId, reason?, traceId? }`           | `JobSnapshot`            |
| `retry`          | `{ jobId, reason?, traceId? }`           | `JobSnapshot`            |
| `interrupt`      | `{ jobId, reason?, traceId? }`           | `JobSnapshot`            |
| `succeed`        | `{ jobId, reason?, traceId? }`           | `JobSnapshot`            |
| `fail`           | `{ jobId, reason?, traceId? }`           | `JobSnapshot`            |
| `reportProgress` | `{ jobId, completed, total?, message? }` | `JobSnapshot`            |
| `get`            | `{ jobId, traceId? }`                    | `JobSnapshot`            |
| `isSupported`    | `void`                                   | `{ supported, reason? }` |
| `events`         | `void`                                   | stream of `JobEvent`     |

## Lifecycle

Jobs start in `running`. They can move to `paused`, back to `running` through `resume` or `retry`, or to the terminal states `interrupted`, `succeeded`, and `failed`. Every state change increments the handle generation. Progress updates preserve state and also increment generation.

`JobRuntime` is the live-fiber companion for renderer-owned work. It uses Effect `FiberMap` under a scoped layer, starts a durable job before forking work, writes `succeeded` or `failed` when the fiber exits, and interrupts the fiber before writing `interrupted`.

State transitions publish a `Job.Event` frame before the matching mutation response frame on the host router. `started`, `paused`, `resumed`, `retried`, `progress`, `interrupted`, `succeeded`, and `failed` are the ordered event phases. `interrupted`, `succeeded`, and `failed` are terminal lifecycle events; `JobRuntime.interrupt` first cancels the live fiber, then records `interrupted`.

Renderer event subscriptions receive typed `Job.Event` frames from the native event stream. The payload schema is owned by the canonical `Job.events.Event` RPC stream contract; the native bridge lowers that event contract to the existing `Job.Event` wire method. The memory test client uses a bounded buffer (`capacity: 512`, `replay: 128`) so local tests can assert event ordering without a real host transport.

The public service registers running jobs with `ResourceRegistry` as `job:<jobId>` resources. Terminal transitions dispose that resource through the registry, so active jobs are visible to leak inspection and cleanup remains idempotent.

When an Effect `EventJournal` is supplied to the service layer, each successful lifecycle mutation appends a journal entry keyed by `jobId`. This is the Effect-native journal path for runtimes that back the journal with durable storage.

## Persistence

The Rust host stores job records in a JSON file. Set `EFFECT_DESKTOP_JOB_STORE` to choose the file path. Otherwise the host uses the platform application data directory:

- macOS: `~/Library/Application Support/effect-desktop/jobs/jobs.json`
- Windows: `%LOCALAPPDATA%/effect-desktop/jobs/jobs.json`
- Linux: `$XDG_STATE_HOME/effect-desktop/jobs/jobs.json` or `~/.local/state/effect-desktop/jobs/jobs.json`

## Permissions

The service checks native invoke permission before host work:

- `Native.Permissions.job.start`
- `Native.Permissions.job.pause`
- `Native.Permissions.job.resume`
- `Native.Permissions.job.retry`
- `Native.Permissions.job.interrupt`
- `Native.Permissions.job.succeed`
- `Native.Permissions.job.fail`
- `Native.Permissions.job.reportProgress`
- `Native.Permissions.job.get`

Denied requests do not cross the host boundary. Successful controls emit `permission-used`; denied requests emit `permission-denied`; host failures emit failure audit rows.

## Support

| Platform | Status      | Reason |
| -------- | ----------- | ------ |
| macOS    | `supported` |        |
| Windows  | `supported` |        |
| Linux    | `supported` |        |

Unsupported clients return typed `Unsupported` failures instead of no-op success.

## Related

- Service: [`packages/native/src/job.ts`](../../../packages/native/src/job.ts)
- Contract: [`packages/native/src/contracts/job.ts`](../../../packages/native/src/contracts/job.ts)
- Host protocol: [`crates/host-protocol/src/lib.rs`](../../../crates/host-protocol/src/lib.rs)
- Host adapter: [`crates/host/src/methods/job.rs`](../../../crates/host/src/methods/job.rs)
