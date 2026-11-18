import { ExportResultCode } from "@opentelemetry/core";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import type { PushMetricExporter, ResourceMetrics } from "@opentelemetry/sdk-metrics";

const PROCESSED_RECORDS_METRIC = "otel.sdk.processor.log.processed";
const ERROR_TYPE_ATTRIBUTE = "error.type";

interface DroppedRecordsReport {
  total: number;
  byReason: Record<string, number>;
}

type DroppedRecordsListener = (report: DroppedRecordsReport) => void;

const countDroppedRecordsByReason = (resourceMetrics: ResourceMetrics) => {
  const counts = new Map<string, number>();
  for (const scopeMetrics of resourceMetrics.scopeMetrics) {
    for (const metric of scopeMetrics.metrics) {
      if (metric.descriptor.name !== PROCESSED_RECORDS_METRIC) {
        continue;
      }
      for (const dataPoint of metric.dataPoints) {
        const reason = dataPoint.attributes[ERROR_TYPE_ATTRIBUTE];
        if (typeof reason === "string" && typeof dataPoint.value === "number") {
          counts.set(reason, (counts.get(reason) ?? 0) + dataPoint.value);
        }
      }
    }
  }
  return counts;
};

const createDroppedRecordsMonitor = (reportIntervalMillis: number) => {
  const reportedByReason = new Map<string, number>();
  const listeners: DroppedRecordsListener[] = [];

  const reportNewlyDropped = (resourceMetrics: ResourceMetrics) => {
    const report: DroppedRecordsReport = { total: 0, byReason: {} };
    for (const [reason, count] of countDroppedRecordsByReason(resourceMetrics)) {
      const newlyDropped = count - (reportedByReason.get(reason) ?? 0);
      reportedByReason.set(reason, count);
      if (newlyDropped > 0) {
        report.byReason[reason] = newlyDropped;
        report.total += newlyDropped;
      }
    }
    if (report.total === 0) {
      return;
    }
    for (const listener of listeners) {
      listener(report);
    }
  };

  const exporter: PushMetricExporter = {
    export: (resourceMetrics, done) => {
      reportNewlyDropped(resourceMetrics);
      done({ code: ExportResultCode.SUCCESS });
    },
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  };

  const reader = new PeriodicExportingMetricReader({
    exporter,
    exportIntervalMillis: reportIntervalMillis,
    exportTimeoutMillis: reportIntervalMillis,
  });
  const meterProvider = new MeterProvider({ readers: [reader] });

  return {
    meterProvider,
    onDropped: (listener: DroppedRecordsListener) => {
      listeners.push(listener);
    },
    flush: () => reader.forceFlush(),
    shutdown: () => meterProvider.shutdown(),
  };
};

export { createDroppedRecordsMonitor };
export type { DroppedRecordsReport };
