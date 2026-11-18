import { context, propagation, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import type { Resource } from "@opentelemetry/resources";
import { TracerProvider } from "@opentelemetry/sdk-trace";
import type { SpanExporter } from "@opentelemetry/sdk-trace";
import type { DroppedSpansReporter } from "./dropped-spans";
import { createHeadSampler } from "./sampler";
import { createSpanExportQueue } from "./span-export-queue";
import type { SpanExportSettings } from "./span-export-queue";
import { createTraceRetentionProcessor } from "./trace-retention";

interface TracingPipelineOptions {
  exporter: SpanExporter;
  exportSettings: SpanExportSettings;
  droppedSpans: DroppedSpansReporter;
  sampleRatio: number;
  slowThresholdMillis: number;
  maxBufferedSpans: number;
  resource?: Resource;
}

const createTracingPipeline = (options: TracingPipelineOptions): TracerProvider =>
  new TracerProvider({
    ...(options.resource && { resource: options.resource }),
    sampler: createHeadSampler(options.sampleRatio),
    spanProcessors: [
      createTraceRetentionProcessor(
        createSpanExportQueue(options.exporter, options.exportSettings, options.droppedSpans),
        { slowThresholdMillis: options.slowThresholdMillis, maxBufferedSpans: options.maxBufferedSpans },
      ),
    ],
  });

const registerGlobalTracing = (provider: TracerProvider) => {
  const contextManager = new AsyncLocalStorageContextManager().enable();
  context.setGlobalContextManager(contextManager);
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  trace.setGlobalTracerProvider(provider);
  return () => {
    trace.disable();
    propagation.disable();
    context.disable();
  };
};

export { createTracingPipeline, registerGlobalTracing };
export type { TracingPipelineOptions };
