import { Schema } from "effect"

const SchemePattern = /^[a-z][a-z0-9+.-]*$/u
const ReservedSchemes = [
  "about",
  "app",
  "blob",
  "data",
  "file",
  "http",
  "https",
  "javascript",
  "chrome",
  "view-source"
] as const
const ReservedSchemeSet: ReadonlySet<string> = new Set(ReservedSchemes)

export const ProtocolScheme = Schema.String.check(
  Schema.isPattern(SchemePattern),
  Schema.makeFilter((scheme) => !ReservedSchemeSet.has(scheme) || "scheme is reserved")
)

export class ProtocolRegisterAppProtocolInput extends Schema.Class<ProtocolRegisterAppProtocolInput>(
  "ProtocolRegisterAppProtocolInput"
)({
  scheme: ProtocolScheme
}) {}

export class ProtocolServeAssetInput extends Schema.Class<ProtocolServeAssetInput>(
  "ProtocolServeAssetInput"
)({
  scheme: ProtocolScheme,
  root: Schema.String
}) {}

export class ProtocolServeRouteInput extends Schema.Class<ProtocolServeRouteInput>(
  "ProtocolServeRouteInput"
)({
  scheme: ProtocolScheme,
  route: Schema.String
}) {}

export class ProtocolDenyInput extends Schema.Class<ProtocolDenyInput>("ProtocolDenyInput")({
  scheme: ProtocolScheme,
  path: Schema.String
}) {}

export type ProtocolRegisterAppProtocolOptions = Schema.Schema.Type<
  typeof ProtocolRegisterAppProtocolInput
>
export type ProtocolServeAssetOptions = Schema.Schema.Type<typeof ProtocolServeAssetInput>
export type ProtocolServeRouteOptions = Schema.Schema.Type<typeof ProtocolServeRouteInput>
export type ProtocolDenyOptions = Schema.Schema.Type<typeof ProtocolDenyInput>
