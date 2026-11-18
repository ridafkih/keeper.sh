import { afterEach, describe, expect, it, vi } from "vitest";
import { ExportResultCode } from "@opentelemetry/core";
import type { ExportResult } from "@opentelemetry/core";
import { TracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace";
import type { ReadableSpan } from "@opentelemetry/sdk-trace";
import { createTraceExporter } from "../src/tracing/trace-exporter";

const ENDPOINT_VARIABLE = "OTEL_EXPORTER_OTLP_ENDPOINT";

const captureSpan = async (): Promise<ReadableSpan> => {
  const memory = new InMemorySpanExporter();
  const provider = new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter: memory })] });
  provider.getTracer("test").startSpan("hello collector").end();
  await provider.forceFlush();
  const [span] = memory.getFinishedSpans();
  if (!span) {
    throw new Error("no span captured");
  }
  return span;
};

const startCollector = () => {
  const requests: { path: string; encoding: string | null; body: string }[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      requests.push({
        path: new URL(request.url).pathname,
        encoding: request.headers.get("content-encoding"),
        body: new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(await request.arrayBuffer()))),
      });
      return new Response("{}");
    },
  });
  return { requests, url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
};

describe("trace exporter", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sends gzipped spans to the configured endpoint", async () => {
    const collector = startCollector();
    vi.stubEnv(ENDPOINT_VARIABLE, collector.url);
    const exporter = createTraceExporter(5000);
    const span = await captureSpan();

    const result = await new Promise<ExportResult>((resolve) => {
      exporter.export([span], resolve);
    });
    await exporter.shutdown();
    await collector.stop();

    expect(result.code).toBe(ExportResultCode.SUCCESS);
    expect(collector.requests).toHaveLength(1);
    expect(collector.requests[0]?.path).toBe("/v1/traces");
    expect(collector.requests[0]?.encoding).toBe("gzip");
    expect(collector.requests[0]?.body).toContain("hello collector");
  });
});
