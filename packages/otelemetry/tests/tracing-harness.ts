import { InMemorySpanExporter } from "@opentelemetry/sdk-trace";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace";
import { createDroppedSpansReporter } from "../src/tracing/dropped-spans";
import type { DroppedSpansReport } from "../src/tracing/dropped-spans";
import { createTracingPipeline, registerGlobalTracing } from "../src/tracing/tracing-pipeline";

interface HarnessOptions {
  sampleRatio: number;
  slowThresholdMillis?: number;
  exporter?: SpanExporter;
  maxQueueSize?: number;
  exportTimeoutMillis?: number;
}

const startTracingHarness = ({
  sampleRatio,
  slowThresholdMillis = 60_000,
  exporter = new InMemorySpanExporter(),
  maxQueueSize = 1000,
  exportTimeoutMillis = 1000,
}: HarnessOptions) => {
  const dropReports: DroppedSpansReport[] = [];
  const droppedSpans = createDroppedSpansReporter(60_000, (report) => {
    dropReports.push(report);
  });
  const provider = createTracingPipeline({
    exporter,
    exportSettings: {
      maxQueueSize,
      maxExportBatchSize: 100,
      scheduledDelayMillis: 5,
      exportTimeoutMillis,
      shutdownFlushTimeoutMillis: 50,
    },
    droppedSpans,
    sampleRatio,
    slowThresholdMillis,
    maxBufferedSpans: 100,
  });
  const unregister = registerGlobalTracing(provider);

  const exportedSpans = async (): Promise<ReadableSpan[]> => {
    await provider.forceFlush();
    if (exporter instanceof InMemorySpanExporter) {
      return exporter.getFinishedSpans();
    }
    return [];
  };

  const dropped = () => {
    droppedSpans.flush();
    return dropReports.reduce((total, report) => total + report.total, 0);
  };

  const stop = async () => {
    unregister();
    droppedSpans.stop();
    await provider.shutdown();
  };

  return { exportedSpans, dropped, stop };
};

const spanNamed = (spans: ReadableSpan[], name: string) => {
  const span = spans.find((candidate) => candidate.name === name);
  if (!span) {
    throw new Error(`no span named ${name} among ${spans.map((candidate) => candidate.name).join(", ")}`);
  }
  return span;
};

export { spanNamed, startTracingHarness };
