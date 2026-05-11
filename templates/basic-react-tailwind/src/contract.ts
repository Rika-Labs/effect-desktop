import { Desktop } from "@effect-desktop/core"
import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"

export const GreetRpc = Rpc.make("Greet", {
  payload: { name: Schema.NonEmptyString },
  success: Schema.Struct({ message: Schema.String })
}).pipe(Desktop.RpcEndpoint.mutation)

export const AppRpc = RpcGroup.make(GreetRpc)
