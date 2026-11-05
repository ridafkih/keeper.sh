import { describe, expect, it } from "vitest";
import { ExportResultCode } from "@opentelemetry/core";
import type { ExportResult } from "@opentelemetry/core";
import { emptyResource } from "@opentelemetry/resources";
import type { LogRecordExporter, ReadableLogRecord } from "@opentelemetry/sdk-logs";
import { createCollectorPipeline } from "../src/collector-pipeline";
import type { BatchSettings } from "../src/collector-pipeline";
import type { DroppedRecordsReport } from "../src/dropped-records";

const QUEUE_SIZE = 20;
const BATCH_SIZE = 5;

const batchSettingsWithTimeout = (exportTimeoutMillis: number): BatchSettings => ({
  maxQueueSize: QUEUE_SIZE,
  maxExportBatchSize: BATCH_SIZE,
  scheduledDelayMillis: 10,
  exportTimeoutMillis,
});

type CollectorBehaviour = "silent" | "stalled" | "accepting" | "rejecting";

const createFakeCollector = (behaviour: CollectorBehaviour) => {
  const state = { behaviour, exported: [] as ReadableLogRecord[] };
  const stalledExports: (() => void)[] = [];

  const accept = (records: ReadableLogRecord[], done: (result: ExportResult) => void) => {
    state.exported.push(...records);
    done({ code: ExportResultCode.SUCCESS });
  };

  const exporter: LogRecordExporter = {
    export: (records, done) => {
      if (state.behaviour === "silent") {
        return;
      }
      if (state.behaviour === "stalled") {
        stalledExports.push(() => accept(records, done));
        return;
      }
      if (state.behaviour === "rejecting") {
        done({ code: ExportResultCode.FAILED, error: new TypeError("rejected") });
        return;
      }
      accept(records, done);
    },
    shutdown: () => Promise.resolve(),
  };

  const recover = () => {
    state.behaviour = "accepting";
    for (const finishExport of stalledExports.splice(0)) {
      finishExport();
    }
  };

  return { exporter, state, recover };
};

const startPipeline = (exporter: LogRecordExporter, batchSettings: BatchSettings) => {
  const reports: DroppedRecordsReport[] = [];
  const pipeline = createCollectorPipeline({
    createExporter: () => exporter,
    resource: emptyResource(),
    scopeName: "test",
    batchSettings,
    dropReportIntervalMillis: 50,
    writeDropReport: (report) => reports.push(report),
  });
  const write = (count: number) => {
    for (let line = 0; line < count; line++) {
      pipeline.logger.emit({ body: `line ${line}` });
    }
  };
  return { reports, write, stop: () => pipeline.shutdown() };
};

const droppedFor = (reports: DroppedRecordsReport[], reason: string) =>
  reports.reduce((total, report) => total + (report.byReason[reason] ?? 0), 0);

describe("collector pipeline", () => {
  it("resumes exporting after exports time out while the queue is full", async () => {
    const collector = createFakeCollector("silent");
    const pipeline = startPipeline(collector.exporter, batchSettingsWithTimeout(50));

    pipeline.write(100);
    await Bun.sleep(300);
    collector.recover();
    pipeline.write(50);
    await Bun.sleep(300);
    await pipeline.stop();

    expect(collector.state.exported.length).toBeGreaterThan(QUEUE_SIZE);
  });

  it("reports records dropped while the queue is full and forwards the report", async () => {
    const collector = createFakeCollector("stalled");
    const pipeline = startPipeline(collector.exporter, batchSettingsWithTimeout(5000));

    pipeline.write(100);
    await Bun.sleep(300);
    collector.recover();
    await Bun.sleep(300);
    await pipeline.stop();

    const forwardedReports = collector.state.exported.filter(
      (record) => typeof record.attributes["otelemetry.dropped_records"] === "number",
    );
    expect(droppedFor(pipeline.reports, "queue_full")).toBeGreaterThanOrEqual(
      100 - QUEUE_SIZE - BATCH_SIZE,
    );
    expect(collector.state.exported.length).toBeGreaterThanOrEqual(QUEUE_SIZE + BATCH_SIZE);
    expect(forwardedReports.length).toBeGreaterThan(0);
  });

  it("reports records the collector rejected", async () => {
    const collector = createFakeCollector("rejecting");
    const pipeline = startPipeline(collector.exporter, batchSettingsWithTimeout(50));

    pipeline.write(10);
    await Bun.sleep(300);
    await pipeline.stop();

    expect(droppedFor(pipeline.reports, "TypeError")).toBeGreaterThanOrEqual(10);
  });
});
