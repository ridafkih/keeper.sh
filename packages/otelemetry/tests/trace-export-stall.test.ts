import type { ExportResult } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace";
import { afterEach, describe, expect, it } from "vitest";
import { withSpan } from "../src/tracing/spans";
import { startTracingHarness } from "./tracing-harness";

let harness: ReturnType<typeof startTracingHarness> | null = null;

afterEach(async () => {
  await harness?.stop();
  harness = null;
});

const createStalledCollector = () => {
  const pendingExports: ((result: ExportResult) => void)[] = [];
  const exporter: SpanExporter = {
    export: (_spans: ReadableSpan[], done) => {
      pendingExports.push(done);
    },
    shutdown: () => Promise.resolve(),
  };
  return { exporter, pendingExports };
};

describe("a stalled collector", () => {
  it("never holds up the request that produced the spans", async () => {
    const collector = createStalledCollector();
    harness = startTracingHarness({ sampleRatio: 1, exporter: collector.exporter, maxQueueSize: 5 });

    const startedAt = performance.now();
    for (let request = 0; request < 50; request += 1) {
      await withSpan(`GET /api/events ${request}`, {}, () => Promise.resolve());
    }
    const elapsedMillis = performance.now() - startedAt;

    expect(elapsedMillis).toBeLessThan(250);
    expect(collector.pendingExports.length).toBeLessThanOrEqual(1);
  });

  it("counts spans it had to drop and the export that timed out", async () => {
    const collector = createStalledCollector();
    harness = startTracingHarness({
      sampleRatio: 1,
      exporter: collector.exporter,
      maxQueueSize: 5,
      exportTimeoutMillis: 20,
    });

    for (let request = 0; request < 20; request += 1) {
      await withSpan("GET /api/events", {}, () => Promise.resolve());
    }
    await Bun.sleep(60);

    expect(harness.dropped()).toBe(20);
  });
});
