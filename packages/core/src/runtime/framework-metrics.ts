import { Metric } from "effect"

export const RpcLatency = Metric.histogram("framework.rpc.latency", {
  description: "RPC call round-trip latency in milliseconds",
  boundaries: [1, 5, 10, 25, 50, 100, 250, 500, 1_000, 5_000]
})

export const ActiveWindows = Metric.gauge("framework.windows.active", {
  description: "Number of open windows managed by the runtime"
})

export const ActiveFibers = Metric.gauge("framework.fibers.active", {
  description: "Approximate count of live Effect fibers in the runtime"
})

export const QueueDepth = Metric.counter("framework.queue.depth", {
  description: "Items enqueued since last observation",
  incremental: true
})

export const CacheHitRate = Metric.frequency("framework.cache.hits", {
  description: "Cache hit / miss frequency by cache name"
})
