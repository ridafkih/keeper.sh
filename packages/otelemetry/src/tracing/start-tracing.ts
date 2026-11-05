import {
  detectResources,
  envDetector,
  hostDetector,
  osDetector,
  processDetector,
  resourceFromAttributes,
} from "@opentelemetry/resources";
import type { Resource } from "@opentelemetry/resources";
import { loadTracingConfiguration } from "./configuration";
import type { TracingConfiguration } from "./configuration";
import { createDroppedSpansReporter } from "./dropped-spans";
import type { DroppedSpansReport } from "./dropped-spans";
import { instrumentGlobalFetch } from "./outbound-fetch";
import type { SpanExportSettings } from "./span-export-queue";
import { createTraceExporter } from "./trace-exporter";
import { createTracingPipeline, registerGlobalTracing } from "./tracing-pipeline";

const SPAN_EXPORT_SETTINGS: SpanExportSettings = {
  maxQueueSize: 8192,
  maxExportBatchSize: 512,
  scheduledDelayMillis: 1000,
  exportTimeoutMillis: 30_000,
  shutdownFlushTimeoutMillis: 3000,
};
const MAX_BUFFERED_UNSAMPLED_SPANS = 4096;
const DROP_REPORT_INTERVAL_MILLIS = 10_000;
const SHUTDOWN_TIMEOUT_MILLIS = 5000;

interface TracingOptions {
  serviceName: string;
  propagateToOrigins: string[];
  environment: Record<string, string | undefined>;
}

interface Tracing {
  shutdown: () => Promise<void>;
}

const buildResource = (serviceName: string, configuration: TracingConfiguration): Resource =>
  detectResources({ detectors: [envDetector, hostDetector, osDetector, processDetector] }).merge(
    resourceFromAttributes({
      "service.name": serviceName,
      "deployment.environment": configuration.environment,
      ...(configuration.version && { "service.version": configuration.version }),
      ...(configuration.commit && { "vcs.ref.head.revision": configuration.commit }),
    }),
  );

const writeDropReportToStderr = (serviceName: string) => (report: DroppedSpansReport) => {
  const line = JSON.stringify({
    level: 40,
    time: new Date().toISOString(),
    service: serviceName,
    msg: "spans dropped before reaching the collector",
    "otelemetry.dropped_spans": report.total,
    "otelemetry.drop_reasons": report.byReason,
  });
  process.stderr.write(`${line}\n`);
};

const settleWithin = async (work: Promise<unknown>, timeoutMillis: number) => {
  const deadline = new Promise<void>((resolve) => {
    setTimeout(resolve, timeoutMillis).unref();
  });
  await Promise.race([work.catch(() => null), deadline]);
};

const startTracing = ({ serviceName, propagateToOrigins, environment }: TracingOptions): Tracing => {
  const configuration = loadTracingConfiguration(environment);
  if (!configuration.enabled) {
    return { shutdown: () => Promise.resolve() };
  }

  const droppedSpans = createDroppedSpansReporter(
    DROP_REPORT_INTERVAL_MILLIS,
    writeDropReportToStderr(serviceName),
  );
  const provider = createTracingPipeline({
    exporter: createTraceExporter(SPAN_EXPORT_SETTINGS.exportTimeoutMillis),
    exportSettings: SPAN_EXPORT_SETTINGS,
    droppedSpans,
    sampleRatio: configuration.sampleRatio,
    slowThresholdMillis: configuration.slowThresholdMillis,
    maxBufferedSpans: MAX_BUFFERED_UNSAMPLED_SPANS,
    resource: buildResource(serviceName, configuration),
  });
  registerGlobalTracing(provider);
  const restoreFetch = instrumentGlobalFetch(propagateToOrigins);

  return {
    shutdown: async () => {
      restoreFetch();
      await settleWithin(provider.shutdown(), SHUTDOWN_TIMEOUT_MILLIS);
      droppedSpans.stop();
    },
  };
};

export { startTracing };
export type { Tracing, TracingOptions };
