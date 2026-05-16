# Issue #1290: Tighten Bridge Contract Schemas To Pure Codecs

## Decision

Bridge contract specs should preserve the real boundary contract they require: pure
`Schema.Codec<..., ..., never, never>` values. The previous shape widened every method, event, and
stream schema to `Schema.Schema<unknown>`, so bridge client, handler, and stream helpers had to
recover the lost service environment with local `as Effect.Effect<..., ..., never>` assertions
around Effect Schema encode/decode calls.

The bridge boundary still owns desktop-specific protocol work: strict parse options,
host-protocol error mapping, origin/cancellation handling, redaction, and stream lifecycle policy.
It should not own a parallel type proof for Effect Schema.

## Target Shape

Before:

```ts
export interface BridgeRpcMethodSpec {
  readonly input: Schema.Schema<unknown>
  readonly output: Schema.Schema<unknown> | BridgeRpcStreamSpec
  readonly error: Schema.Schema<unknown>
}

const decodeInput = <Spec extends BridgeRpcMethodSpec>(
  operation: string,
  spec: Spec,
  payload: unknown
): Effect.Effect<Schema.Schema.Type<Spec["input"]>, HostProtocolError, never> =>
  Effect.mapError(
    Schema.decodeUnknownEffect(spec.input)(payload, StrictParseOptions) as Effect.Effect<
      Schema.Schema.Type<Spec["input"]>,
      unknown,
      never
    >,
    (error) => makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
  )
```

After:

```ts
export type BridgeRpcCodec<Type = unknown, Encoded = unknown> = Schema.Codec<
  Type,
  Encoded,
  never,
  never
>

export interface BridgeRpcMethodSpec<
  Input extends BridgeRpcCodec = BridgeRpcCodec,
  Output extends BridgeRpcCodec | BridgeRpcStreamSpec = BridgeRpcCodec | BridgeRpcStreamSpec,
  Error extends BridgeRpcCodec = BridgeRpcCodec
> {
  readonly input: Input
  readonly output: Output
  readonly error: Error
}

const decodeInput = <Type, Encoded>(
  operation: string,
  schema: BridgeRpcCodec<Type, Encoded>,
  payload: unknown
): Effect.Effect<Type, HostProtocolError, never> =>
  Schema.decodeUnknownEffect(schema)(payload, StrictParseOptions).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )
```

Events and streams follow the same rule: specs carry pure codecs, while bridge runtime code maps
Schema parse failures into host-protocol errors without asserting away schema requirements.

## Files

- `packages/bridge/src/contracts.ts` - add the canonical `BridgeRpcCodec` alias; parameterize
  method, event, stream, handler, and client-facing types over pure codecs; and require
  `BridgeRpc.fromGroup` RPC metadata to expose pure schemas before it can lower an Effect
  `RpcGroup` into bridge metadata.
- `packages/bridge/src/client.ts` - remove client-side encode/decode `Effect` assertions for
  inputs, outputs, contract errors, event payloads, and stream frames.
- `packages/bridge/src/handlers.ts` - remove handler-side input decode, output encode, and
  contract-error encode assertions.
- `packages/bridge/src/events.ts` - remove event publish payload encode assertions.
- `packages/bridge/src/streams.ts` - remove stream input decode, chunk encode, error encode, and
  protocol error decode assertions.
- `packages/bridge/src/contracts.test.ts` - keep type-level bridge contract tests aligned with the
  stricter codec contract.
- `api/snapshots/@effect-desktop__bridge.snapshot.json` - update the public API snapshot for the
  stricter bridge contract types.

## Architecture Debt Sweep

Remove now:

- bridge contract fields typed as broad `Schema.Schema<unknown>` values
- bridge-local `Schema.decodeUnknownEffect(...) as Effect.Effect<..., ..., never>` assertions
- bridge-local `Schema.encodeEffect(...) as Effect.Effect<..., ..., never>` assertions
- bridge-local `Schema.encodeUnknownEffect(...) as Effect.Effect<..., ..., never>` assertions
  whose only purpose was recovering purity erased by contract types

Keep:

- host-protocol translation helpers, because they turn Schema parse failures into stable desktop
  boundary errors with operation names.
- bridge cancellation, origin, terminal-state, redaction, and stream backpressure logic, because
  those are desktop/native boundary policy rather than aliases for Effect primitives.
- dynamic client method installation casts, because the runtime object is built from a contract
  record. Those casts are not Schema service recovery, and the public method type is still derived
  from the canonical spec.

Resolved during review:

- `BridgeRpc.fromGroup` now requires request metadata whose payload, success, and error schemas are
  pure bridge codecs before deriving a bridge spec.
- stream RPC success metadata now flows through a typed
  `RpcSchema.Stream<BridgeRpcCodec, BridgeRpcCodec>` guard instead of the old local
  `schema as unknown as RpcStreamSchema` narrowing.
- the temporary follow-up #1291 was closed as subsumed by this issue.

## Verification

Focused:

```bash
rg "Schema\\.Schema<unknown>|as Effect\\.Effect<.*never>|decodeUnknownEffect\\([^\\n]+\\).*as Effect\\.Effect|encodeUnknownEffect\\([^\\n]+\\).*as Effect\\.Effect|encodeEffect\\([^\\n]+\\).*as Effect\\.Effect" packages/bridge/src -g'*.ts'
bun run typecheck --filter=@effect-desktop/bridge --filter=@effect-desktop/core --filter=@effect-desktop/native --force
bun test packages/bridge/src/contracts.test.ts
bun test packages/bridge/src/client.test.ts packages/bridge/src/handlers.test.ts packages/bridge/src/events.test.ts packages/bridge/src/streams.test.ts packages/bridge/src/protocol.rpc.test.ts
bun packages/cli/src/bin.ts check --api --write
bun packages/cli/src/bin.ts check --api
gh issue view 1291 --json state
```

The remaining `as Effect.Effect<..., ..., never>` matches are test-only helpers or intentional test
fixtures, not production bridge encode/decode recovery.

Full local gate before pushing:

```bash
bun install --frozen-lockfile
bun run format:check
bun run lint
bun run lint:types
bun run check
bun test
bun run build
bun run desktop check --api
cargo fmt --check
cargo check --workspace
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
git diff --check
```
