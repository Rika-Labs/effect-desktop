import { ResourceHandleSchema, type ResourceHandle } from "@orika/core"
import { Schema } from "effect"

import { BridgeSafeNonEmptyString, BridgeSafeString } from "./strings.js"

export const NativeNetworkRequestResource = ResourceHandleSchema("native-network-request", "open")
export type NativeNetworkRequestHandle = ResourceHandle<"native-network-request", "open">

export const NativeNetworkWebSocketResource = ResourceHandleSchema(
  "native-network-websocket",
  "open"
)
export type NativeNetworkWebSocketHandle = ResourceHandle<"native-network-websocket", "open">

const NativeNetworkUrl = BridgeSafeNonEmptyString.check(
  Schema.isPattern(/^(?!javascript:|data:|vbscript:|blob:|file:)[\s\S]*$/iu),
  Schema.makeFilter((value) => isAbsoluteUrl(value, ["http:", "https:"]))
)
const NativeNetworkWebSocketUrl = BridgeSafeNonEmptyString.check(
  Schema.makeFilter((value) => isAbsoluteUrl(value, ["ws:", "wss:"]))
)
const NativeNetworkHeaderName = BridgeSafeNonEmptyString.check(
  Schema.isPattern(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u)
)
const NativeNetworkPort = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(65_535)
)
const NativeNetworkNonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const NativeNetworkLocalhostPath = BridgeSafeNonEmptyString.check(
  Schema.isPattern(/^\/(?!.*(?:^|\/)\.\.(?:\/|$))[^\s]*$/u)
)
const NativeNetworkByteProgress = Schema.makeFilter<{
  readonly sentBytes?: number | undefined
  readonly totalBytes?: number | undefined
}>(
  (value) =>
    value.sentBytes === undefined ||
    value.totalBytes === undefined ||
    value.sentBytes <= value.totalBytes ||
    "sentBytes must not exceed totalBytes"
)
const NativeNetworkEventPayloadShape = Schema.makeFilter<{
  readonly phase: NativeNetworkEventPhase
  readonly request?: NativeNetworkRequestHandle | undefined
  readonly socket?: NativeNetworkWebSocketHandle | undefined
  readonly url?: string | undefined
  readonly sentBytes?: number | undefined
  readonly totalBytes?: number | undefined
  readonly message?: string | undefined
}>((value) => {
  const hasRequest = value.request !== undefined
  const hasSocket = value.socket !== undefined
  const hasHttpUrl = value.url !== undefined && isAbsoluteUrl(value.url, ["http:", "https:"])
  const hasWebSocketUrl = value.url !== undefined && isAbsoluteUrl(value.url, ["ws:", "wss:"])
  const hasByteProgress = value.sentBytes !== undefined || value.totalBytes !== undefined
  const hasOnlyRequestResource = hasRequest && !hasSocket && hasHttpUrl
  const hasOnlySocketResource = hasSocket && !hasRequest && hasWebSocketUrl

  switch (value.phase) {
    case "fetch-started":
    case "fetch-completed":
      return (
        (hasOnlyRequestResource && !hasByteProgress && value.message === undefined) ||
        `${value.phase} native network events require request HTTP metadata only`
      )
    case "upload-started":
      return (
        (hasOnlyRequestResource && !hasByteProgress && value.message === undefined) ||
        "upload-started native network events require request HTTP metadata only"
      )
    case "upload-progress":
      return (
        (hasOnlyRequestResource && value.sentBytes !== undefined && value.message === undefined) ||
        "upload-progress native network events require request HTTP byte progress"
      )
    case "upload-completed":
      return (
        (hasOnlyRequestResource && !hasByteProgress && value.message === undefined) ||
        "upload-completed native network events require request HTTP metadata"
      )
    case "websocket-opened":
    case "websocket-closed":
      return (
        (hasOnlySocketResource && !hasByteProgress && value.message === undefined) ||
        `${value.phase} native network events require websocket metadata only`
      )
    case "failed":
      return (
        (((hasOnlyRequestResource && !hasSocket) || (hasOnlySocketResource && !hasRequest)) &&
          !hasByteProgress &&
          value.message !== undefined) ||
        "failed native network events require one resource kind and message"
      )
  }
})

export const NativeNetworkHttpMethod = Schema.Literals([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD"
])
export type NativeNetworkHttpMethod = typeof NativeNetworkHttpMethod.Type

export const NativeNetworkWebSocketState = Schema.Literals(["open", "closing", "closed", "failed"])
export type NativeNetworkWebSocketState = typeof NativeNetworkWebSocketState.Type

const NativeNetworkEventPhase = Schema.Literals([
  "fetch-started",
  "fetch-completed",
  "upload-started",
  "upload-progress",
  "upload-completed",
  "websocket-opened",
  "websocket-closed",
  "failed"
])
export type NativeNetworkEventPhase = typeof NativeNetworkEventPhase.Type

export class NativeNetworkHeader extends Schema.Class<NativeNetworkHeader>("NativeNetworkHeader")({
  name: NativeNetworkHeaderName,
  value: BridgeSafeString
}) {}

export class NativeNetworkFetchInput extends Schema.Class<NativeNetworkFetchInput>(
  "NativeNetworkFetchInput"
)({
  url: NativeNetworkUrl,
  method: NativeNetworkHttpMethod,
  headers: Schema.optionalKey(Schema.Array(NativeNetworkHeader)),
  body: Schema.optionalKey(BridgeSafeString),
  ownerScope: Schema.optionalKey(BridgeSafeNonEmptyString),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class NativeNetworkUploadInput extends Schema.Class<NativeNetworkUploadInput>(
  "NativeNetworkUploadInput"
)({
  url: NativeNetworkUrl,
  method: Schema.optionalKey(Schema.Literals(["POST", "PUT", "PATCH"])),
  headers: Schema.optionalKey(Schema.Array(NativeNetworkHeader)),
  body: BridgeSafeString,
  fileName: Schema.optionalKey(BridgeSafeNonEmptyString),
  ownerScope: Schema.optionalKey(BridgeSafeNonEmptyString),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class NativeNetworkWebSocketConnectInput extends Schema.Class<NativeNetworkWebSocketConnectInput>(
  "NativeNetworkWebSocketConnectInput"
)({
  url: NativeNetworkWebSocketUrl,
  protocols: Schema.optionalKey(Schema.Array(BridgeSafeNonEmptyString)),
  ownerScope: Schema.optionalKey(BridgeSafeNonEmptyString),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class NativeNetworkWebSocketHandleInput extends Schema.Class<NativeNetworkWebSocketHandleInput>(
  "NativeNetworkWebSocketHandleInput"
)({
  socket: NativeNetworkWebSocketResource,
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class NativeNetworkLocalhostUrlInput extends Schema.Class<NativeNetworkLocalhostUrlInput>(
  "NativeNetworkLocalhostUrlInput"
)({
  port: NativeNetworkPort,
  path: Schema.optionalKey(NativeNetworkLocalhostPath),
  secure: Schema.optionalKey(Schema.Boolean),
  traceId: Schema.optionalKey(BridgeSafeNonEmptyString)
}) {}

export class NativeNetworkFetchResult extends Schema.Class<NativeNetworkFetchResult>(
  "NativeNetworkFetchResult"
)({
  request: NativeNetworkRequestResource,
  url: NativeNetworkUrl,
  method: NativeNetworkHttpMethod,
  status: Schema.Int.check(Schema.isGreaterThanOrEqualTo(100), Schema.isLessThanOrEqualTo(599)),
  responseHeaders: Schema.Array(NativeNetworkHeader),
  body: Schema.optionalKey(BridgeSafeString)
}) {}

export class NativeNetworkUploadResult extends Schema.Class<NativeNetworkUploadResult>(
  "NativeNetworkUploadResult"
)({
  request: NativeNetworkRequestResource,
  url: NativeNetworkUrl,
  status: Schema.Int.check(Schema.isGreaterThanOrEqualTo(100), Schema.isLessThanOrEqualTo(599)),
  sentBytes: NativeNetworkNonNegativeInt,
  responseHeaders: Schema.Array(NativeNetworkHeader)
}) {}

export class NativeNetworkWebSocketSnapshot extends Schema.Class<NativeNetworkWebSocketSnapshot>(
  "NativeNetworkWebSocketSnapshot"
)({
  socket: NativeNetworkWebSocketResource,
  url: NativeNetworkWebSocketUrl,
  state: NativeNetworkWebSocketState,
  protocol: Schema.optionalKey(BridgeSafeNonEmptyString),
  message: Schema.optionalKey(BridgeSafeString)
}) {}

export class NativeNetworkLocalhostUrlResult extends Schema.Class<NativeNetworkLocalhostUrlResult>(
  "NativeNetworkLocalhostUrlResult"
)({
  url: BridgeSafeNonEmptyString
}) {}

export class NativeNetworkSupportedResult extends Schema.Class<NativeNetworkSupportedResult>(
  "NativeNetworkSupportedResult"
)({
  supported: Schema.Boolean,
  reason: Schema.optionalKey(BridgeSafeString)
}) {}

export class NativeNetworkEvent extends Schema.Class<NativeNetworkEvent>("NativeNetworkEvent")(
  Schema.Struct({
    type: Schema.Literal("native-network-event"),
    timestamp: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)),
    phase: NativeNetworkEventPhase,
    request: Schema.optionalKey(NativeNetworkRequestResource),
    socket: Schema.optionalKey(NativeNetworkWebSocketResource),
    url: Schema.optionalKey(BridgeSafeNonEmptyString),
    sentBytes: Schema.optionalKey(NativeNetworkNonNegativeInt),
    totalBytes: Schema.optionalKey(NativeNetworkNonNegativeInt),
    message: Schema.optionalKey(BridgeSafeString)
  }).check(NativeNetworkByteProgress, NativeNetworkEventPayloadShape)
) {}

const isAbsoluteUrl = (value: string, protocols: readonly string[]): boolean => {
  try {
    const url = new URL(value)
    return protocols.includes(url.protocol)
  } catch {
    return false
  }
}
