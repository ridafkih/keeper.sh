import { ROOT_CONTEXT, context } from "@opentelemetry/api";
import { ExportResultCode, suppressTracing } from "@opentelemetry/core";
import type { ExportResult } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace";
import type { DroppedSpansReporter } from "./dropped-spans";

interface SpanExportSettings {
  maxQueueSize: number;
  maxExportBatchSize: number;
  scheduledDelayMillis: number;
  exportTimeoutMillis: number;
  shutdownFlushTimeoutMillis: number;
}

interface SpanExportQueue {
  enqueue: (spans: ReadableSpan[]) => void;
  flush: () => Promise<void>;
  shutdown: () => Promise<void>;
}

const EXPORT_TIMED_OUT = "timed_out";

const toError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
};

const exportUntraced = (exporter: SpanExporter, batch: ReadableSpan[]): Promise<ExportResult> =>
  new Promise((resolve) => {
    context.with(suppressTracing(ROOT_CONTEXT), () => {
      try {
        exporter.export(batch, resolve);
      } catch (error) {
        resolve({ code: ExportResultCode.FAILED, error: toError(error) });
      }
    });
  });

const timeoutAfter = (timeoutMillis: number): Promise<typeof EXPORT_TIMED_OUT> =>
  new Promise((resolve) => {
    setTimeout(() => resolve(EXPORT_TIMED_OUT), timeoutMillis).unref();
  });

const exportWithDeadline = async (
  exporter: SpanExporter,
  batch: ReadableSpan[],
  timeoutMillis: number,
  droppedSpans: DroppedSpansReporter,
): Promise<void> => {
  const outcome = await Promise.race([exportUntraced(exporter, batch), timeoutAfter(timeoutMillis)]);
  if (outcome === EXPORT_TIMED_OUT) {
    droppedSpans.record("export_timeout", batch.length);
    return;
  }
  if (outcome.code !== ExportResultCode.SUCCESS) {
    droppedSpans.record("export_failed", batch.length);
  }
};

const createSpanExportQueue = (
  exporter: SpanExporter,
  settings: SpanExportSettings,
  droppedSpans: DroppedSpansReporter,
): SpanExportQueue => {
  const queue: ReadableSpan[] = [];
  let inFlight: Promise<void> | null = null;

  const exportNextBatch = (): Promise<void> => {
    if (inFlight) {
      return inFlight;
    }
    if (queue.length === 0) {
      return Promise.resolve();
    }
    const batch = queue.splice(0, settings.maxExportBatchSize);
    inFlight = exportWithDeadline(exporter, batch, settings.exportTimeoutMillis, droppedSpans).finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  const timer = setInterval(exportNextBatch, settings.scheduledDelayMillis);
  timer.unref();

  const flush = async (): Promise<void> => {
    if (!inFlight && queue.length === 0) {
      return;
    }
    await exportNextBatch();
    await flush();
  };

  return {
    enqueue: (spans) => {
      const room = Math.max(settings.maxQueueSize - queue.length, 0);
      queue.push(...spans.slice(0, room));
      droppedSpans.record("queue_full", Math.max(spans.length - room, 0));
    },
    flush,
    shutdown: async () => {
      clearInterval(timer);
      await Promise.race([flush(), timeoutAfter(settings.shutdownFlushTimeoutMillis)]);
      await exporter.shutdown();
    },
  };
};

export { createSpanExportQueue };
export type { SpanExportSettings, SpanExportQueue };
