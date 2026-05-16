# Issue #1184: Use Effect Serialization for Host Protocol Frames

## Current state

`packages/core/src/runtime/host-client.ts` still owns the host wire JSON mechanics:

- `sendRequest` calls `encodeHostProtocolEnvelope(...)`, `JSON.stringify(...)`, and
  `TextEncoder.encode(...)` inline before sending bytes.
- `decodeResponseFrame` calls fatal UTF-8 decode, `JSON.parse(...)`, trace-id repair, and
  `decodeHostProtocolEnvelope(...)` inline.

The schema source of truth already exists in `@effect-desktop/bridge`:

- `HostProtocolEnvelope` is a `Schema.Union`.
- `decodeHostProtocolEnvelope(...)` and `encodeHostProtocolEnvelope(...)` apply strict schema
  parsing plus cross-field envelope checks.
- Effect exposes `Schema.fromJsonString(...)` and `Schema.UnknownFromJsonString`, whose
  transformations own JSON string parse/stringify through Schema effects.

The gap is architectural ownership: core transport should send and receive bytes, while bridge
protocol code should own host protocol byte serialization.

## Architecture

Add a bridge-owned host protocol codec module that composes Effect Schema JSON transformations with
the existing schema envelope contract.

The codec should expose:

- `encodeHostProtocolFrame(envelope, operation)`: serializes a host envelope through Schema JSON
  transformation and returns UTF-8 bytes.
- `parseHostProtocolFrameJson(frame, operation)`: fatal-decodes UTF-8 bytes, parses JSON through
  Schema transformation, and returns the raw parsed value for trace-id repair.
- `decodeHostProtocolFrame(frame, operation)`: parses and schema-decodes a frame when no repair is
  needed.
- `decodeHostProtocolFrameJson(value, operation)`: schema-decodes a parsed/repaired JSON value.

`packages/core/src/runtime/host-client.ts` should keep only exchange-level rules:

- send request bytes through `encodeHostProtocolFrame`;
- receive raw frames from `FramedTransport`;
- preserve missing-trace-id repair and audit behavior;
- validate response kind, id, and trace id.

The current wire format stays byte-for-byte JSON inside existing length-prefixed frames.

## Files

- `packages/bridge/src/codec.ts`
  - Add the host protocol frame codec.
  - Keep fatal UTF-8 behavior so invalid bytes still fail as `BinaryDecodeError`.
  - Use Schema JSON transformations rather than direct call-site JSON parsing.
- `packages/bridge/src/index.ts`
  - Export the codec.
- `packages/bridge/src/index.test.ts`
  - Prove shared host protocol fixtures round-trip through the codec.
  - Prove malformed JSON fails with `HostProtocolBinaryDecodeError`.
  - Prove schema-invalid JSON fails with `HostProtocolInvalidOutputError`.
- `packages/core/src/runtime/host-client.ts`
  - Replace inline JSON parse/stringify and text encoding with codec calls.
- `packages/core/src/runtime/host-client.test.ts`
  - Add or retain coverage proving invalid UTF-8, malformed JSON, semantic mismatch, and missing
    trace-id repair still behave the same.
- `api/snapshots/@effect-desktop__bridge.snapshot.json`
  - Update for any new public codec exports.
- `engineering/roadmap/layer-first-issue-order.md`
  - Mark #1184 implemented after validation.
- `engineering/learnings/2026-05-12-effect-host-protocol-serialization.md`
  - Capture the rule that protocol byte codecs belong beside schema contracts.

## Tests

Focused:

- `bun test packages/bridge/src/index.test.ts packages/core/src/runtime/host-client.test.ts`
- `bun run --filter @effect-desktop/bridge typecheck`
- `bun run --filter @effect-desktop/core typecheck`
- `bun run desktop check --api --write`
- `bun run desktop check --api`

Broad before push:

- `bun run check`
- `bun run typecheck`
- `bun run lint`
- `bun run lint:types`
- `bun run format:check`
- `git diff --check`
- `bun test`
- `bun run build`
- `cargo fmt --check`
- `cargo check --workspace`
- `cargo test --workspace`
- `cargo clippy --workspace --all-targets -- -D warnings`

## Thin wrappers / follow-ups

Remove now:

- Inline host-client JSON parsing/stringifying for protocol frames.

Keep:

- The host protocol codec module is not a zero-policy wrapper over Schema JSON transformations; it
  owns the desktop-specific schema, fatal UTF-8 requirement, one-envelope-per-frame invariant, and
  `HostProtocolError` mapping.

Possible follow-up:

- If other bridge protocol paths still manually serialize host envelopes after this slice, open a
  concrete before/after issue to route those paths through the same codec.
