import { ROOT_CONTEXT, context, propagation, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from "@opentelemetry/sdk-trace";
import { Queue } from "bullmq";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PushSyncQueue } from "../src";
import type { PushSyncJobPayload } from "../src";

const exporter = new InMemorySpanExporter();
const provider = new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] });

beforeAll(() => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  trace.setGlobalTracerProvider(provider);
});

afterEach(() => {
  exporter.reset();
  vi.restoreAllMocks();
});

afterAll(() => {
  trace.disable();
  propagation.disable();
  context.disable();
});

const payload: PushSyncJobPayload = {
  calendarId: "calendar",
  userId: "user",
  plan: "pro",
  correlationId: "correlation",
};

const queueWithoutRedis = (): PushSyncQueue => Object.create(PushSyncQueue.prototype);

const traceIdOf = (traceparent: string | undefined) => traceparent?.split("-")[1];

describe("enqueuing a push sync", () => {
  it("puts the enqueuing trace into the job data under a producer span", async () => {
    const add = vi.spyOn(Queue.prototype, "add").mockResolvedValue(Object.create(null));
    const requestSpan = trace.getTracer("test").startSpan("POST /api/sync");

    await context.with(trace.setSpan(ROOT_CONTEXT, requestSpan), () =>
      queueWithoutRedis().add("sync-user-calendar", payload, { jobId: "sync-user-calendar" }),
    );
    requestSpan.end();
    await provider.forceFlush();

    const [, enqueued] = add.mock.calls[0] ?? [];
    const producer = exporter.getFinishedSpans().find((span) => span.name === "send push-sync-v2");
    expect(traceIdOf(enqueued?.traceContext?.traceparent)).toBe(requestSpan.spanContext().traceId);
    expect(enqueued?.traceContext?.traceparent).toContain(producer?.spanContext().spanId);
    expect(producer?.parentSpanContext?.spanId).toBe(requestSpan.spanContext().spanId);
  });

  it("gives every job of a bulk enqueue the same trace", async () => {
    const addBulk = vi.spyOn(Queue.prototype, "addBulk").mockResolvedValue([]);
    const cronSpan = trace.getTracer("test").startSpan("push-destinations");

    await context.with(trace.setSpan(ROOT_CONTEXT, cronSpan), () =>
      queueWithoutRedis().addBulk([
        { name: "one", data: payload },
        { name: "two", data: { ...payload, calendarId: "other" } },
      ]),
    );
    cronSpan.end();

    const [jobs] = addBulk.mock.calls[0] ?? [];
    const traceIds = jobs?.map((job) => traceIdOf(job.data.traceContext?.traceparent));
    expect(traceIds).toEqual([cronSpan.spanContext().traceId, cronSpan.spanContext().traceId]);
  });
});
