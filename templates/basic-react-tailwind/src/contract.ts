import { Rpc, RpcGroup } from "@effect-desktop/bridge"
import { Schema } from "effect"

export const GreetRpc = Rpc.make("Greet", {
  payload: { name: Schema.NonEmptyString },
  success: Schema.Struct({ message: Schema.String })
})

export const AppRpc = RpcGroup.make(GreetRpc)
