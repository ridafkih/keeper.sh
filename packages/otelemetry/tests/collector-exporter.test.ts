import { afterEach, describe, expect, it, vi } from "vitest";
import { metrics } from "@opentelemetry/api";
import { ExportResultCode } from "@opentelemetry/core";
import type { ExportResult } from "@opentelemetry/core";
import { emptyResource } from "@opentelemetry/resources";
import { InMemoryLogRecordExporter, LoggerProvider, SimpleLogRecordProcessor } from "@opentelemetry/sdk-logs";
import type { ReadableLogRecord } from "@opentelemetry/sdk-logs";
import { createCollectorExporter } from "../src/collector-exporter";

const ENDPOINT_VARIABLE = "OTEL_EXPORTER_OTLP_ENDPOINT";
const HEADERS_VARIABLE = "OTEL_EXPORTER_OTLP_HEADERS";

const captureRecord = (): ReadableLogRecord => {
  const memory = new InMemoryLogRecordExporter();
  const provider = new LoggerProvider({
    resource: emptyResource(),
    processors: [new SimpleLogRecordProcessor({ exporter: memory })],
  });
  provider.getLogger("test").emit({ body: "hello collector" });
  const [record] = memory.getFinishedLogRecords();
  if (!record) {
    throw new Error("no record captured");
  }
  return record;
};

const startCollector = () => {
  const requests: { path: string; authorization: string | null; body: string }[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      requests.push({
        path: new URL(request.url).pathname,
        authorization: request.headers.get("authorization"),
        body: await request.text(),
      });
      return new Response("{}");
    },
  });
  return { requests, url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
};

describe("collector exporter", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sends records to the configured endpoint with the configured headers", async () => {
    const collector = startCollector();
    vi.stubEnv(ENDPOINT_VARIABLE, collector.url);
    vi.stubEnv(HEADERS_VARIABLE, "Authorization=Bearer%20secret");
    const exporter = createCollectorExporter(metrics.getMeterProvider());

    const result = await new Promise<ExportResult>((resolve) => {
      exporter.export([captureRecord()], resolve);
    });
    await collector.stop();

    expect(result.code).toBe(ExportResultCode.SUCCESS);
    expect(collector.requests).toHaveLength(1);
    expect(collector.requests[0]?.path).toBe("/v1/logs");
    expect(collector.requests[0]?.authorization).toBe("Bearer secret");
    expect(collector.requests[0]?.body).toContain("hello collector");
  });
});
