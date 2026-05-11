import { Effect } from "effect"

import { type BridgeResourceHandle, type BridgeRpcResourceSpec } from "./contracts.js"
import { HostProtocolStaleHandleError, type HostProtocolError } from "./protocol.js"

export interface BridgeResourceExchange {
  readonly dispose: (handle: BridgeResourceHandle) => Effect.Effect<void, HostProtocolError, never>
}

export interface BridgeResourceProxy<
  Kind extends string = string,
  State extends string = string
> extends BridgeResourceHandle<Kind, State> {
  readonly dispose: () => Effect.Effect<void, HostProtocolError, never>
}

export const makeResourceProxy = <Spec extends BridgeRpcResourceSpec>(
  spec: Spec,
  handle: BridgeResourceHandle<Spec["kind"], Spec["state"]>,
  exchange: BridgeResourceExchange
): BridgeResourceProxy<Spec["kind"], Spec["state"]> => {
  void spec
  let disposed = false

  return Object.freeze({
    ...handle,
    dispose: () => {
      if (disposed) {
        return Effect.void
      }
      return exchange.dispose(handle).pipe(Effect.tap(() => Effect.sync(() => (disposed = true))))
    }
  })
}

export const makeStaleHandleError = (
  operation: string,
  handle: BridgeResourceHandle,
  actualGeneration: number
): HostProtocolStaleHandleError =>
  new HostProtocolStaleHandleError({
    tag: "StaleHandle",
    kind: handle.kind,
    id: handle.id,
    expectedGeneration: handle.generation,
    actualGeneration,
    message: `stale resource handle: ${handle.kind}:${handle.id}`,
    operation,
    recoverable: false
  })
