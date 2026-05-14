import { Desktop } from "@effect-desktop/core"
import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"

export const PingRpc = Rpc.make("Ping", {
  payload: { message: Schema.String },
  success: Schema.Struct({ reply: Schema.String })
}).pipe(Desktop.RpcEndpoint.mutation)

export const AppRpc = RpcGroup.make(PingRpc)
