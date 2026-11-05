import { metrics } from "@opentelemetry/api";
import { OTLPExporterBase, createOtlpNetworkExportDelegate } from "@opentelemetry/otlp-exporter-base";
import {
  convertLegacyHttpOptions,
  createOtlpHttpExporterMetrics,
} from "@opentelemetry/otlp-exporter-base/node-http";
import { JsonTraceSerializer, TraceExporterMetricsHelper } from "@opentelemetry/otlp-transformer";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace";
import { createFetchTransport } from "../fetch-transport";

const TRACE_EXPORTER_COMPONENT_TYPE = "otlp_http_span_exporter";

const createTraceExporter = (exportTimeoutMillis: number): SpanExporter => {
  const configuration = convertLegacyHttpOptions({}, "TRACES", "v1/traces", {
    "Content-Type": "application/json",
  });

  const delegate = createOtlpNetworkExportDelegate(
    { ...configuration, timeoutMillis: exportTimeoutMillis },
    JsonTraceSerializer,
    createOtlpHttpExporterMetrics(
      TRACE_EXPORTER_COMPONENT_TYPE,
      TraceExporterMetricsHelper,
      configuration.url,
      metrics.getMeterProvider(),
    ),
    createFetchTransport({ ...configuration, attemptTimeoutMillis: configuration.timeoutMillis }),
  );

  return new OTLPExporterBase<ReadableSpan[]>(delegate);
};

export { createTraceExporter };
