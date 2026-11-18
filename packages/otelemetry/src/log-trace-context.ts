import { ROOT_CONTEXT, TraceFlags, isSpanContextValid, trace } from "@opentelemetry/api";
import type { Context } from "@opentelemetry/api";

interface TraceLinkedAttributes {
  context?: Context;
  attributes: Record<string, unknown>;
}

const traceFlagsOf = (value: unknown): TraceFlags => {
  if (value === TraceFlags.SAMPLED) {
    return TraceFlags.SAMPLED;
  }
  return TraceFlags.NONE;
};

const separateTraceContext = (attributes: Record<string, unknown>): TraceLinkedAttributes => {
  const { trace_id: traceId, span_id: spanId, trace_flags: traceFlags, ...rest } = attributes;
  if (typeof traceId !== "string" || typeof spanId !== "string") {
    return { attributes };
  }
  const spanContext = { traceId, spanId, traceFlags: traceFlagsOf(traceFlags), isRemote: true };
  if (!isSpanContextValid(spanContext)) {
    return { attributes };
  }
  return { context: trace.setSpanContext(ROOT_CONTEXT, spanContext), attributes: rest };
};

export { separateTraceContext };
