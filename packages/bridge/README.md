# @effect-desktop/bridge

> **Status:** Phase 3 host-protocol schema mirror. Public renderer-facing APIs
> are populated in Phase 4. See `docs/SPEC.md`.

## Purpose

Typed renderer-runtime bridge: contract registry, client and handler generation, request/response, events, streams, resource handles, cancellation.

Phase 3 starts the package with the host protocol envelope Schema mirror so the
runtime can decode the same JSON fixtures as `crates/host-protocol`.

## Public API

The current public surface is limited to host protocol Schema exports from
`src/protocol.ts`. Renderer-facing bridge clients are still out of scope until
Phase 4.

## Non-goals

See `docs/SPEC.md` for the package's normative non-goals.

## Usage

```ts
import { HostProtocolEnvelope, decodeHostProtocolEnvelope } from "@effect-desktop/bridge"

const envelope = decodeHostProtocolEnvelope(JSON.parse(line))
```

## Testing

```bash
bun test
bun run typecheck
```

## Platform notes

None until the package implements native-touching primitives.

## Dependency notes

- `effect@4.0.0-beta.60` owns the Effect v4 `Schema.Class` and `Schema.Union`
  mirror required by `docs/SPEC.md` §4.4.1 and issue #57. The npm `latest`
  dist-tag is still Effect v3, so this package pins the v4 beta line required
  by the repository spec.

## Internal architecture

`src/protocol.ts` mirrors the Rust host-protocol wire contract. Tests read the
shared JSON fixtures from `crates/host-protocol/fixtures` and assert decode plus
canonical encode parity.
