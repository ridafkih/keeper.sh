import { describe, expect, it } from "vitest";
import { ExportResultCode } from "@opentelemetry/core";
import type { ExportResult } from "@opentelemetry/core";
import { emptyResource } from "@opentelemetry/resources";
import type { LogRecordExporter, ReadableLogRecord } from "@opentelemetry/sdk-logs";
import { createCollectorPipeline } from "../src/collector-pipeline";
import type { DroppedRecordsReport } from "../src/dropped-records";

const TEST_BATCH_SETTINGS = {
  maxQueueSize: 20,
  maxExportBatchSize: 5,
  scheduledDelayMillis: 10,
  exportTimeoutMillis: 50,
};

type CollectorBehaviour = "unreachable" | "accepting" | "rejecting";

const createFakeCollector = () => {
  const state: { behaviour: CollectorBehaviour; exported: ReadableLogRecord[] } = {
    behaviour: "unreachable",
    exported: [],
  };

  const exporter: LogRecordExporter = {
    export: (records: ReadableLogRecord[], done: (result: ExportResult) => void) => {
      if (state.behaviour === "unreachable") {
        return;
      }
      if (state.behaviour === "rejecting") {
        done({ code: ExportResultCode.FAILED, error: new TypeError("rejected") });
        return;
      }
      state.exported.push(...records);
      done({ code: ExportResultCode.SUCCESS });
    },
    shutdown: () => Promise.resolve(),
  };

  return { exporter, state };
};

const startPipeline = (exporter: LogRecordExporter) => {
  const reports: DroppedRecordsReport[] = [];
  const pipeline = createCollectorPipeline({
    createExporter: () => exporter,
    resource: emptyResource(),
    scopeName: "test",
    batchSettings: TEST_BATCH_SETTINGS,
    dropReportIntervalMillis: 50,
    writeDropReport: (report) => reports.push(report),
  });
  const writer = setInterval(() => pipeline.logger.emit({ body: "line" }), 2);
  const stop = async () => {
    clearInterval(writer);
    await pipeline.shutdown();
  };
  return { reports, stop };
};

const droppedFor = (reports: DroppedRecordsReport[], reason: string) =>
  reports.reduce((total, report) => total + (report.byReason[reason] ?? 0), 0);

describe("collector pipeline", () => {
  it("resumes exporting after the collector stops answering while the queue is full", async () => {
    const collector = createFakeCollector();
    const pipeline = startPipeline(collector.exporter);

    await Bun.sleep(400);
    collector.state.behaviour = "accepting";
    await Bun.sleep(400);
    await pipeline.stop();

    expect(collector.state.exported.length).toBeGreaterThan(TEST_BATCH_SETTINGS.maxQueueSize);
  });

  it("reports records dropped while the queue is full and forwards the report", async () => {
    const collector = createFakeCollector();
    const pipeline = startPipeline(collector.exporter);

    await Bun.sleep(400);
    collector.state.behaviour = "accepting";
    await Bun.sleep(400);
    await pipeline.stop();

    const forwardedReports = collector.state.exported.filter(
      (record) => typeof record.attributes["otelemetry.dropped_records"] === "number",
    );
    expect(droppedFor(pipeline.reports, "queue_full")).toBeGreaterThan(0);
    expect(forwardedReports.length).toBeGreaterThan(0);
  });

  it("reports records the collector rejected", async () => {
    const collector = createFakeCollector();
    collector.state.behaviour = "rejecting";
    const pipeline = startPipeline(collector.exporter);

    await Bun.sleep(300);
    await pipeline.stop();

    expect(droppedFor(pipeline.reports, "TypeError")).toBeGreaterThan(0);
  });
});
