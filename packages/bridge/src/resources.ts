import { HostProtocolStaleHandleError } from "./protocol.js"

interface ResourceHandleLike {
  readonly kind: string
  readonly id: string
  readonly generation: number
}

export const makeStaleHandleError = (
  operation: string,
  handle: ResourceHandleLike,
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
