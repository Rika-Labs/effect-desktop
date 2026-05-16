# Issue 1214: Prove Runtime Provider Parity

## Intent

Runtime provider choice must be a Layer substitution, not a framework fork. Bun and Node should satisfy the same Effect Desktop runtime contract, with runtime-specific behavior confined to provider adapters and launch metadata.

## Current State

- `Desktop.runtime` already selects Bun, Node, or test provider layers.
- Config and CLI build metadata already accept `runtime.engine: "bun" | "node"`.
- Rust host runtime manifests already accept Bun and Node launch contracts.
- The existing core test only smoke-checks `FileSystem` across providers.
- `packages/core/src/runtime/main.ts` and `stdio-socket.ts` still use `Bun.*`, so a Node launch manifest is not enough to prove the runtime entry can run under Node.
- `ProcessLive` still defaults to a Bun-specific adapter; the existing #1158 tracks replacing that adapter with Effect child-process primitives.

## Plan

1. Replace runtime-entry `Bun.*` stdio usage with provider-neutral Node-compatible stdio streams.
2. Add a test-only provider conformance suite that runs the same user-level Effect program against Bun and Node runtime providers.
3. Cover provider graph metadata, `FileSystem`, `Path`, scoped `ChildProcessSpawner` execution, missing executable failures, and the absence of any Deno parity cell.
4. Extend runtime-entry tests so the same entry is exercised through both the source Bun path and a Node-targeted build.
5. Extend Rust host runtime tests so readiness/framed-protocol supervision is exercised with both Bun and Node child executables where the behavior is runtime-neutral.

## Architecture-Debt Sweep

- Remove Bun-only stdio from the runtime entry in this issue because it blocks real Node parity.
- Keep direct `BunServices.layer` and `NodeServices.layer` selection because those are canonical Effect provider layers, not a custom wrapper.
- Do not add a public `RuntimeProviderHarness` abstraction; provider conformance is test-only evidence.
- Keep `ProcessLive`'s Bun adapter for this issue because #1158 already owns the larger migration to Effect `ChildProcess` primitives with a concrete before/after.

## Verification

- `bun test packages/core/src/runtime/provider-conformance.test.ts packages/core/src/runtime/main.test.ts packages/core/src/runtime/stdio-socket.test.ts packages/core/src/index.test.ts`
- `cargo test -p host runtime` with both `bun` and `node` on `PATH`
- Full repository validation before push.
