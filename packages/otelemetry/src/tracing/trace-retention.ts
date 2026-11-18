import { SpanStatusCode, TraceFlags } from "@opentelemetry/api";
import { hrTimeToMilliseconds } from "@opentelemetry/core";
import type { ReadableSpan, SpanProcessor } from "@opentelemetry/sdk-trace";
import type { SpanExportQueue } from "./span-export-queue";

interface TraceRetentionSettings {
  slowThresholdMillis: number;
  maxBufferedSpans: number;
}

const isSampled = (span: ReadableSpan) => span.spanContext().traceFlags % 2 === TraceFlags.SAMPLED;

const isLocalRoot = (span: ReadableSpan) => !span.parentSpanContext || span.parentSpanContext.isRemote === true;

const createTraceRetentionProcessor = (
  exportQueue: SpanExportQueue,
  settings: TraceRetentionSettings,
): SpanProcessor => {
  const unsampledTraces = new Map<string, ReadableSpan[]>();
  let bufferedSpanCount = 0;

  const isWorthKeeping = (span: ReadableSpan) =>
    span.status.code === SpanStatusCode.ERROR ||
    hrTimeToMilliseconds(span.duration) >= settings.slowThresholdMillis;

  const takeTrace = (traceId: string) => {
    const spans = unsampledTraces.get(traceId) ?? [];
    unsampledTraces.delete(traceId);
    bufferedSpanCount -= spans.length;
    return spans;
  };

  const evictOldestTraces = () => {
    for (const traceId of unsampledTraces.keys()) {
      if (bufferedSpanCount < settings.maxBufferedSpans) {
        return;
      }
      takeTrace(traceId);
    }
  };

  const bufferUnsampled = (span: ReadableSpan) => {
    const { traceId } = span.spanContext();
    evictOldestTraces();
    const spans = unsampledTraces.get(traceId) ?? [];
    spans.push(span);
    unsampledTraces.set(traceId, spans);
    bufferedSpanCount += 1;
  };

  return {
    onStart: () => null,
    onEnd: (span) => {
      if (isSampled(span)) {
        exportQueue.enqueue([span]);
        return;
      }
      if (!isLocalRoot(span)) {
        bufferUnsampled(span);
        return;
      }
      const children = takeTrace(span.spanContext().traceId);
      if (isWorthKeeping(span)) {
        exportQueue.enqueue([...children, span]);
      }
    },
    forceFlush: () => exportQueue.flush(),
    shutdown: () => exportQueue.shutdown(),
  };
};

export { createTraceRetentionProcessor };
export type { TraceRetentionSettings };
