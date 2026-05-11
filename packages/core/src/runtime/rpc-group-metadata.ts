import { Rpc, RpcGroup } from "effect/unstable/rpc"

export type RpcGroupWithRequests = RpcGroup.Any & {
  readonly requests: ReadonlyMap<string, Rpc.Any>
}

const ServedRpcGroupKey: unique symbol = Symbol("@effect-desktop/core/servedRpcGroup")

type WithServedRpcGroup = {
  readonly [ServedRpcGroupKey]?: RpcGroupWithRequests
}

export const servedRpcGroup = (provider: {
  readonly group: RpcGroupWithRequests
}): RpcGroupWithRequests => (provider as WithServedRpcGroup)[ServedRpcGroupKey] ?? provider.group

export const servedRpcGroupProperties = (
  group: RpcGroupWithRequests,
  servedGroup: RpcGroupWithRequests
): WithServedRpcGroup => (servedGroup === group ? {} : { [ServedRpcGroupKey]: servedGroup })
