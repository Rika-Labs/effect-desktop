import { NodeSdk, Resource } from "@effect/opentelemetry"
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base"
import type { SpanExporter } from "@opentelemetry/sdk-trace-base"
import type { MetricReader } from "@opentelemetry/sdk-metrics"
import type { Layer } from "effect"

export interface OtelPipelineOptions {
  readonly serviceName: string
  readonly serviceVersion?: string
  readonly spanExporter?: SpanExporter
  readonly metricReader?: MetricReader
}

export const makeOtelLayer = (options: OtelPipelineOptions): Layer.Layer<Resource.Resource> =>
  NodeSdk.layer(() => {
    const resource: NodeSdk.Configuration["resource"] = {
      serviceName: options.serviceName,
      ...(options.serviceVersion !== undefined
        ? { serviceVersion: options.serviceVersion }
        : undefined)
    }
    return {
      resource,
      ...(options.spanExporter !== undefined
        ? { spanProcessor: new SimpleSpanProcessor(options.spanExporter) }
        : undefined),
      ...(options.metricReader !== undefined ? { metricReader: options.metricReader } : undefined)
    }
  })
