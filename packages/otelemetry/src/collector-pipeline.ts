import type { MeterProvider } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";
import type { LogRecordExporter } from "@opentelemetry/sdk-logs";
import type { Resource } from "@opentelemetry/resources";
import { EXPORT_RETRY_BUDGET_MILLIS } from "./collector-exporter";
import { createDroppedRecordsMonitor } from "./dropped-records";
import type { DroppedRecordsReport } from "./dropped-records";

interface BatchSettings {
  maxQueueSize: number;
  maxExportBatchSize: number;
  scheduledDelayMillis: number;
  exportTimeoutMillis: number;
}

const COLLECTOR_BATCH_SETTINGS: BatchSettings = {
  maxQueueSize: 16_384,
  maxExportBatchSize: 512,
  scheduledDelayMillis: 1000,
  exportTimeoutMillis: EXPORT_RETRY_BUDGET_MILLIS + 10_000,
};

const DROP_REPORT_INTERVAL_MILLIS = 10_000;

interface CollectorPipelineOptions {
  createExporter: (meterProvider: MeterProvider) => LogRecordExporter;
  resource: Resource;
  scopeName: string;
  batchSettings: BatchSettings;
  dropReportIntervalMillis: number;
  writeDropReport: (report: DroppedRecordsReport) => void;
}

const createCollectorPipeline = ({
  createExporter,
  resource,
  scopeName,
  batchSettings,
  dropReportIntervalMillis,
  writeDropReport,
}: CollectorPipelineOptions) => {
  const droppedRecords = createDroppedRecordsMonitor(dropReportIntervalMillis);
  const processor = new BatchLogRecordProcessor({
    exporter: createExporter(droppedRecords.meterProvider),
    selfObsMeterProvider: droppedRecords.meterProvider,
    ...batchSettings,
  });
  const provider = new LoggerProvider({ resource, processors: [processor] });
  const logger = provider.getLogger(scopeName);

  droppedRecords.onDropped((report) => {
    writeDropReport(report);
    logger.emit({
      body: "log records dropped before reaching the collector",
      severityNumber: SeverityNumber.WARN,
      severityText: "WARN",
      attributes: {
        "otelemetry.dropped_records": report.total,
        "otelemetry.drop_reasons": JSON.stringify(report.byReason),
      },
    });
  });

  return {
    logger,
    shutdown: async () => {
      await droppedRecords.flush();
      await provider.shutdown();
      await droppedRecords.shutdown();
    },
  };
};

export { COLLECTOR_BATCH_SETTINGS, DROP_REPORT_INTERVAL_MILLIS, createCollectorPipeline };
export type { BatchSettings, CollectorPipelineOptions };
