# Issue #1288: Tighten Native Decode Helpers To Pure Schema Codecs

## Decision

Native bridge client decode helpers should remember the real schema contract they receive:
pure `Schema.Codec<..., ..., never, never>` values. The old helper type widened every schema to
`Schema.Schema<unknown>` and then recovered the lost service environment with
`as Effect.Effect<..., ..., never>` assertions.

The bridge client boundary still owns desktop-specific policy: strict payload decoding and
host-protocol error translation. It should not own a parallel type proof for Effect Schema.

## Target Shape

Before:

```ts
const decodeInput = (
  schema: Schema.Schema<unknown>,
  input: unknown,
  operation: string
): Effect.Effect<unknown, HostProtocolError, never> =>
  Effect.mapError(
    Schema.decodeUnknownEffect(schema)(input, StrictParseOptions) as Effect.Effect<
      unknown,
      unknown,
      never
    >,
    (error) => makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
  )
```

After:

```ts
const decodeInput = <A>(
  schema: Schema.Codec<A, unknown, never, never>,
  input: unknown,
  operation: string
): Effect.Effect<A, HostProtocolError, never> =>
  Schema.decodeUnknownEffect(schema)(input, StrictParseOptions).pipe(
    Effect.mapError((error) =>
      makeHostProtocolInvalidArgumentError("payload", formatUnknownError(error), operation)
    )
  )
```

Event decoders follow the same rule:

```ts
const decodeEventEnvelope = <A>(
  schema: Schema.Codec<A, unknown, never, never>,
  envelope: HostProtocolEventEnvelope
): Effect.Effect<A, NativeError, never> =>
  Schema.decodeUnknownEffect(schema)(envelope.payload).pipe(
    Effect.mapError((error) => makeHostProtocolInvalidOutputError(operation, String(error)))
  )
```

## Files

- `packages/native/src/app.ts`
- `packages/native/src/clipboard.ts`
- `packages/native/src/context-menu.ts`
- `packages/native/src/dialog.ts`
- `packages/native/src/dock.ts`
- `packages/native/src/global-shortcut.ts`
- `packages/native/src/menu.ts`
- `packages/native/src/notification.ts`
- `packages/native/src/power-monitor.ts`
- `packages/native/src/protocol.ts`
- `packages/native/src/safe-storage.ts`
- `packages/native/src/shell.ts`
- `packages/native/src/system-appearance.ts`
- `packages/native/src/tray.ts`
- `packages/native/src/updater.ts`
- `packages/native/src/webview.ts`

## Architecture Debt Sweep

Remove now:

- broad native `decodeInput(schema: Schema.Schema<unknown>, ...)` helper signatures
- local native `Schema.decodeUnknownEffect(...) as Effect.Effect<..., ..., never>` assertions
- per-call assertions that only recover the decoded input type from a widened schema
- event decoder assertions that only recover the event payload type from a widened schema

Keep:

- host-protocol error mapping helpers, because they translate Schema parse failures into stable
  desktop boundary errors.
- native client/service APIs, because they are desktop ports with validation and host-protocol
  translation rather than aliases of Effect Schema.
- small operation-specific decode helpers where they bind schema, input shape normalization, and
  operation metadata at the native boundary. Helpers that do no validation beyond binding a schema
  can be inlined opportunistically, but they are not the cross-module Effect wrapper debt targeted
  here.

Follow-up opened during the sweep:

- #1290 Tighten bridge contract schemas to pure codecs.

Related debt observed but outside this issue:

- `packages/native/src/updater-workflow.ts` has an unrelated infinite-loop `Effect.never`-style
  assertion. It is not a decode-helper assertion and should be handled with the updater/workflow
  lifecycle tickets if it becomes blocking.

## Verification

Focused:

```bash
rg "Schema\\.Schema<unknown>|Schema\\.Schema<A>|as Effect\\.Effect<.*never>|decodeUnknownEffect\\([^\\n]+\\).*as Effect\\.Effect" packages/native/src -g'*.ts' -g'!index.test.ts' -g'!updater-workflow.ts'
bun run typecheck --filter=@orika/native --filter=@orika/bridge --filter=@orika/core --force
bun test packages/native/src/index.test.ts packages/native/src/protocol.test.ts packages/native/src/window.test.ts packages/native/src/capabilities.test.ts
bun run desktop check --api
```

The excluded residuals are not native decode-helper assertions: `index.test.ts` contains a direct
schema unit-test cast, and `updater-workflow.ts` contains an unrelated infinite polling workflow
assertion.

Full local gate before pushing:

```bash
bun install --frozen-lockfile
bun run format:check
bun run lint
bun run lint:types
bun run check
bun test
bun run build
cargo fmt --check
cargo check --workspace
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
git diff --check
```
