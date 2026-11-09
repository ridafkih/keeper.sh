import { SpanKind } from "@opentelemetry/api";
import { afterEach, describe, expect, it } from "vitest";
import { nameRequestRoute, traceIncomingRequest } from "../src/tracing/http-server";
import { createTracedFetch } from "../src/tracing/outbound-fetch";
import { withSpan } from "../src/tracing/spans";
import { activeTraceFields, captureTraceContext } from "../src/tracing/trace-context";
import { spanNamed, startTracingHarness } from "./tracing-harness";

let harness: ReturnType<typeof startTracingHarness> | null = null;
const servers: { stop: (force: boolean) => unknown }[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.stop(true);
  }
  await harness?.stop();
  harness = null;
});

const start = () => {
  harness = startTracingHarness({ sampleRatio: 1 });
  return harness;
};

const serveApi = () => {
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const response = await traceIncomingRequest(request, { trustIncomingTraceContext: true }, () => {
        nameRequestRoute(request.method, "/api/sources/[id]");
        return Promise.resolve(Response.json(activeTraceFields()));
      });
      return response ?? new Response(null, { status: 500 });
    },
  });
  servers.push(server);
  return `http://127.0.0.1:${server.port}`;
};

describe("server spans", () => {
  it("names one server span per request after the route template", async () => {
    const tracing = start();
    const response = await traceIncomingRequest(
      new Request("http://keeper.test/api/sources/abc?token=secret"),
      { trustIncomingTraceContext: false },
      () => {
        nameRequestRoute("GET", "/api/sources/[id]");
        return Promise.resolve(new Response(null, { status: 204 }));
      },
    );
    expect(response?.status).toBe(204);
    const span = spanNamed(await tracing.exportedSpans(), "GET /api/sources/[id]");
    expect(span.kind).toBe(SpanKind.SERVER);
    expect(span.attributes).toMatchObject({
      "http.request.method": "GET",
      "http.response.status_code": 204,
      "http.route": "/api/sources/[id]",
      "url.path": "/api/sources/abc",
    });
  });

  it("starts a fresh trace when the edge does not trust the caller's traceparent", async () => {
    const tracing = start();
    const forgedTraceId = "0af7651916cd43dd8448eb211c80319c";
    await traceIncomingRequest(
      new Request("http://keeper.test/", {
        headers: { traceparent: `00-${forgedTraceId}-b7ad6b7169203331-01` },
      }),
      { trustIncomingTraceContext: false },
      () => Promise.resolve(new Response("ok")),
    );
    const [span] = await tracing.exportedSpans();
    expect(span?.spanContext().traceId).not.toBe(forgedTraceId);
    expect(span?.parentSpanContext).toBeUndefined();
  });
});

describe("context propagation", () => {
  it("carries the web request's trace into the api it proxies to", async () => {
    const tracing = start();
    const apiOrigin = serveApi();
    const tracedFetch = createTracedFetch(globalThis.fetch, new Set([apiOrigin]));

    const webResponse = await traceIncomingRequest(
      new Request("http://keeper.test/api/sources/abc"),
      { trustIncomingTraceContext: false },
      () => {
        nameRequestRoute("GET", "/api/*");
        return tracedFetch(`${apiOrigin}/api/sources/abc`);
      },
    );
    const apiFields = await webResponse?.json();

    const spans = await tracing.exportedSpans();
    const webSpan = spanNamed(spans, "GET /api/*");
    const proxySpan = spanNamed(spans, "GET 127.0.0.1");
    const apiSpan = spanNamed(spans, "GET /api/sources/[id]");

    expect(apiFields.trace_id).toBe(webSpan.spanContext().traceId);
    expect(proxySpan.kind).toBe(SpanKind.CLIENT);
    expect(proxySpan.parentSpanContext?.spanId).toBe(webSpan.spanContext().spanId);
    expect(apiSpan.parentSpanContext?.spanId).toBe(proxySpan.spanContext().spanId);
  });

  it("does not send trace headers to origins outside the propagation list", async () => {
    start();
    const received: (string | null)[] = [];
    const provider = Bun.serve({
      port: 0,
      fetch: (request) => {
        received.push(request.headers.get("traceparent"));
        return new Response("ok");
      },
    });
    servers.push(provider);
    const tracedFetch = createTracedFetch(globalThis.fetch, new Set(["http://api.internal:3001"]));
    await withSpan("job", {}, () => tracedFetch(`http://127.0.0.1:${provider.port}/calendar`));
    expect(received).toEqual([null]);
  });

  it("continues the enqueuing trace when the worker picks the job up", async () => {
    const tracing = start();
    const jobData = await withSpan("POST /api/sync", { kind: SpanKind.SERVER }, () =>
      Promise.resolve({ calendarId: "calendar", traceContext: captureTraceContext() }),
    );
    await withSpan("process push-sync", { kind: SpanKind.CONSUMER, parent: jobData.traceContext }, () =>
      withSpan("GET www.googleapis.com", { kind: SpanKind.CLIENT }, () => Promise.resolve()),
    );

    const spans = await tracing.exportedSpans();
    const enqueue = spanNamed(spans, "POST /api/sync");
    const job = spanNamed(spans, "process push-sync");
    const providerCall = spanNamed(spans, "GET www.googleapis.com");
    expect(job.spanContext().traceId).toBe(enqueue.spanContext().traceId);
    expect(job.parentSpanContext?.spanId).toBe(enqueue.spanContext().spanId);
    expect(providerCall.parentSpanContext?.spanId).toBe(job.spanContext().spanId);
  });

  it("starts a new trace for a job enqueued without trace context", async () => {
    const tracing = start();
    await withSpan("process push-sync", { kind: SpanKind.CONSUMER, parent: {} }, () => Promise.resolve());
    const [job] = await tracing.exportedSpans();
    expect(job?.parentSpanContext).toBeUndefined();
  });
});
