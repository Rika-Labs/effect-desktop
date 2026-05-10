import { Rpc, RpcGroup } from "@effect-desktop/bridge"
import { Schema } from "effect"

export const PingRpc = Rpc.make("Ping", {
  payload: { message: Schema.String },
  success: Schema.Struct({ reply: Schema.String })
})

export const AppRpc = RpcGroup.make(PingRpc)
