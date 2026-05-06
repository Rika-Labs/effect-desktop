import { Schema } from "effect"

export class ProtocolRegisterAppProtocolInput extends Schema.Class<ProtocolRegisterAppProtocolInput>(
  "ProtocolRegisterAppProtocolInput"
)({
  scheme: Schema.String
}) {}

export class ProtocolServeAssetInput extends Schema.Class<ProtocolServeAssetInput>(
  "ProtocolServeAssetInput"
)({
  scheme: Schema.String,
  root: Schema.String
}) {}

export class ProtocolServeRouteInput extends Schema.Class<ProtocolServeRouteInput>(
  "ProtocolServeRouteInput"
)({
  scheme: Schema.String,
  route: Schema.String
}) {}

export class ProtocolDenyInput extends Schema.Class<ProtocolDenyInput>("ProtocolDenyInput")({
  scheme: Schema.String,
  path: Schema.String
}) {}

export type ProtocolRegisterAppProtocolOptions = Schema.Schema.Type<
  typeof ProtocolRegisterAppProtocolInput
>
export type ProtocolServeAssetOptions = Schema.Schema.Type<typeof ProtocolServeAssetInput>
export type ProtocolServeRouteOptions = Schema.Schema.Type<typeof ProtocolServeRouteInput>
export type ProtocolDenyOptions = Schema.Schema.Type<typeof ProtocolDenyInput>
