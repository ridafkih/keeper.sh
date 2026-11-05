import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";
import type { LogRecordExporter } from "@opentelemetry/sdk-logs";
import type { Resource } from "@opentelemetry/resources";

interface BatchSettings {
  maxQueueSize: number;
  maxExportBatchSize: number;
  scheduledDelayMillis: number;
  exportTimeoutMillis: number;
}

const COLLECTOR_BATCH_SETTINGS: BatchSettings = {
  maxQueueSize: 8192,
  maxExportBatchSize: 512,
  scheduledDelayMillis: 1000,
  exportTimeoutMillis: 15_000,
};

interface CollectorPipelineOptions {
  exporter: LogRecordExporter;
  resource: Resource;
  scopeName: string;
  batchSettings: BatchSettings;
}

const createCollectorPipeline = ({
  exporter,
  resource,
  scopeName,
  batchSettings,
}: CollectorPipelineOptions) => {
  const provider = new LoggerProvider({
    resource,
    processors: [new BatchLogRecordProcessor({ exporter, ...batchSettings })],
  });

  return {
    logger: provider.getLogger(scopeName),
    shutdown: () => provider.shutdown(),
  };
};

export { COLLECTOR_BATCH_SETTINGS, createCollectorPipeline };
export type { BatchSettings, CollectorPipelineOptions };
