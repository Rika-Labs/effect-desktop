# Execution sandbox path guard

## Context

`ExecutionSandbox` is still fail-closed in the production host because a normal child process cannot enforce the documented filesystem and network isolation policy. While that remains open in #1406, the boundary still accepts sandbox policy data from renderers and should reject inputs that a future host adapter could not safely canonicalize.

## Change

The sandbox policy now requires `cwd`, `filesystem.readRoots`, and `filesystem.writeRoots` to be absolute platform paths without dot segments. TypeScript bridge decoding rejects invalid paths before transport, and the Rust host route applies the same guard before returning typed `Unsupported`.

## Verification

- `bun test packages/native/src/execution-sandbox.test.ts`
- `cargo test -p host execution_sandbox --bin host`
- `cargo fmt --check`
- `git diff --check`

## Architecture-debt sweep

No wrapper was removed. The public `ExecutionSandbox` service remains the durable Effect boundary for policy, permission checks, audit, events, and substitutable clients. The remaining debt is still the missing OS-enforced host adapter for filesystem and network isolation; this guard only tightens the boundary while support remains false.
