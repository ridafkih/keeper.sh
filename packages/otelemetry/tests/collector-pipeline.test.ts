import { describe, expect, it } from "vitest";
import { ExportResultCode } from "@opentelemetry/core";
import type { ExportResult } from "@opentelemetry/core";
import { emptyResource } from "@opentelemetry/resources";
import type { LogRecordExporter, ReadableLogRecord } from "@opentelemetry/sdk-logs";
import { createCollectorPipeline } from "../src/collector-pipeline";

const TEST_BATCH_SETTINGS = {
  maxQueueSize: 20,
  maxExportBatchSize: 5,
  scheduledDelayMillis: 10,
  exportTimeoutMillis: 50,
};

const createUnreachableCollector = () => {
  const state = { reachable: false, exportedRecords: 0 };

  const exporter: LogRecordExporter = {
    export: (records: ReadableLogRecord[], done: (result: ExportResult) => void) => {
      if (!state.reachable) {
        return;
      }
      state.exportedRecords += records.length;
      done({ code: ExportResultCode.SUCCESS });
    },
    shutdown: () => Promise.resolve(),
  };

  return { exporter, state };
};

const writeContinuously = (emit: () => void) => {
  const writer = setInterval(emit, 2);
  return () => clearInterval(writer);
};

describe("collector pipeline", () => {
  it("resumes exporting after the collector stops answering while the queue is full", async () => {
    const collector = createUnreachableCollector();
    const pipeline = createCollectorPipeline({
      exporter: collector.exporter,
      resource: emptyResource(),
      scopeName: "test",
      batchSettings: TEST_BATCH_SETTINGS,
    });
    const stopWriting = writeContinuously(() => pipeline.logger.emit({ body: "line" }));

    await Bun.sleep(400);
    collector.state.reachable = true;
    await Bun.sleep(400);
    stopWriting();
    await pipeline.shutdown();

    expect(collector.state.exportedRecords).toBeGreaterThan(TEST_BATCH_SETTINGS.maxQueueSize);
  });
});
