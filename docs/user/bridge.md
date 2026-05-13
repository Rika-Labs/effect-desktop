# Bridge

The bridge owns request, response, stream, cancellation, redaction, and protocol error boundaries. App code should not construct bridge envelopes directly.

## Boundary model

```txt
React hook -> typed RPC client -> bridge protocol adapter -> Effect handler -> native service
```

Electron applications often expose selected `ipcRenderer` calls through preload scripts. Effect Desktop replaces that manual bridge with typed RPC contracts, structured failures, cancellation, streams, and scoped resource disposal.

Generated Effect RPC clients use the bridge protocol adapter rather than raw IPC. The adapter translates Effect RPC requests into host protocol envelopes, owns generated request identifiers, encodes host protocol failures into RPC failure exits, and keeps void success responses explicit on the JSON wire.

Renderer-callable contracts are authored with `Rpc.make(...)` and `RpcGroup.make(...)`. Bridge helpers derive protocol metadata from those Effect RPC groups; they do not define a separate contract DSL.

```ts
import { Rpc, RpcGroup, bridgeContractFromRpcGroup } from "@effect-desktop/bridge"
import { Schema } from "effect"

const OpenProject = Rpc.make("Project.open", {
  payload: Schema.Struct({ path: Schema.String }),
  success: Schema.Struct({ id: Schema.String })
})

export const ProjectContract = bridgeContractFromRpcGroup("Project", RpcGroup.make(OpenProject))
```

## Runnable Example

```ts run
import { Client, HostProtocolEnvelope } from "../packages/bridge/src/index.js"

if (HostProtocolEnvelope === undefined || Client === undefined) {
  throw new Error("bridge envelope or renderer client exports are unavailable")
}
```
