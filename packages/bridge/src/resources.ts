import { Effect } from "effect"

import { type ApiResourceHandle, type ApiResourceSpec } from "./contracts.js"
import { HostProtocolStaleHandleError, type HostProtocolError } from "./protocol.js"

export interface ApiResourceExchange {
  readonly dispose: (handle: ApiResourceHandle) => Effect.Effect<void, HostProtocolError, never>
}

export interface ApiResourceProxy<
  Kind extends string = string,
  State extends string = string
> extends ApiResourceHandle<Kind, State> {
  readonly dispose: () => Effect.Effect<void, HostProtocolError, never>
}

export const makeResourceProxy = <Spec extends ApiResourceSpec>(
  spec: Spec,
  handle: ApiResourceHandle<Spec["kind"], Spec["state"]>,
  exchange: ApiResourceExchange
): ApiResourceProxy<Spec["kind"], Spec["state"]> => {
  void spec
  let disposed = false

  return Object.freeze({
    ...handle,
    dispose: () => {
      if (disposed) {
        return Effect.void
      }
      disposed = true
      return exchange.dispose(handle)
    }
  })
}

export const makeStaleHandleError = (
  operation: string,
  handle: ApiResourceHandle,
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
