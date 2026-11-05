import { OTLPExporterBase, createOtlpNetworkExportDelegate } from "@opentelemetry/otlp-exporter-base";
import {
  convertLegacyHttpOptions,
  createOtlpHttpExporterMetrics,
} from "@opentelemetry/otlp-exporter-base/node-http";
import { JsonLogsSerializer, LogsExporterMetricsHelper } from "@opentelemetry/otlp-transformer";
import type { MeterProvider } from "@opentelemetry/api";
import type { LogRecordExporter, ReadableLogRecord } from "@opentelemetry/sdk-logs";
import { createFetchTransport } from "./fetch-transport";

const LOG_EXPORTER_COMPONENT_TYPE = "otlp_http_log_exporter";

const createCollectorExporter = (meterProvider: MeterProvider): LogRecordExporter => {
  const configuration = convertLegacyHttpOptions({}, "LOGS", "v1/logs", {
    "Content-Type": "application/json",
  });

  const delegate = createOtlpNetworkExportDelegate(
    configuration,
    JsonLogsSerializer,
    createOtlpHttpExporterMetrics(
      LOG_EXPORTER_COMPONENT_TYPE,
      LogsExporterMetricsHelper,
      configuration.url,
      meterProvider,
    ),
    createFetchTransport(configuration),
  );

  return new OTLPExporterBase<ReadableLogRecord[]>(delegate);
};

export { createCollectorExporter };
