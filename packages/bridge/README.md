# @effect-desktop/bridge

> **Status:** Phase 3 host-protocol schema mirror. Public renderer-facing APIs
> are populated in Phase 4. See `engineering/SPEC.md`.

## Purpose

Typed renderer-runtime bridge: contract registry, client and handler generation, request/response, events, streams, resource handles, cancellation.

Phase 3 starts the package with the host protocol envelope Schema mirror,
required `host.version` / `host.ping` handshake wrappers, and the initial
`Window.create` / `Window.destroy` wrappers so the runtime can decode the same
JSON fixtures as `crates/host-protocol` and exercise the first native-touching
host method calls.

## Public API

The current public surface includes:

- host protocol Schema exports from `src/protocol.ts`;
- the handshake client in `src/handshake.ts`;
- typed bridge contract lowering helpers, RPC metadata annotations, and bridge client/runtime adapters;
- the Effect RPC protocol adapter used by generated native clients.

Generated Effect RPC clients send host protocol envelopes through `makeDesktopClientProtocol(...)`. Host protocol failures are encoded before they enter Effect RPC exits, and successful `undefined` payloads are normalized to `null` on the bridge response envelope so the wire outcome remains explicit JSON.

Bridge contracts are authored as canonical Effect RPC groups. Bridge-specific helpers derive native/web protocol metadata from the group and adapt Effect RPC clients or servers to the desktop host protocol; handler composition stays in `RpcGroup.toLayer(...)`.

## Non-goals

See `engineering/SPEC.md` for the package's normative non-goals.

## Usage

```ts
import {
  Client,
  Rpc,
  RpcGroup,
  bridgeContractFromRpcGroup,
  decodeHostProtocolEnvelope,
  type HostProtocolEnvelope
} from "@effect-desktop/bridge"
import { Schema } from "effect"

const OpenProject = Rpc.make("Project.open", {
  payload: Schema.Struct({ path: Schema.String }),
  success: Schema.Struct({ id: Schema.String })
})

const Project = bridgeContractFromRpcGroup("Project", RpcGroup.make(OpenProject))

const envelope = decodeHostProtocolEnvelope(JSON.parse(line))
const client = Client({ project: Project }, exchange)
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
  mirror required by `engineering/SPEC.md` §4.4.1 and issue #57. The npm `latest`
  dist-tag is still Effect v3, so this package pins the v4 beta line required
  by the repository spec.

## Internal architecture

`src/protocol.ts` mirrors the Rust host-protocol wire contract. Tests read the
shared JSON fixtures from `crates/host-protocol/fixtures` and assert decode plus
canonical encode parity.
