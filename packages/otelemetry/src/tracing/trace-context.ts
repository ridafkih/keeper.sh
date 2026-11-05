import { ROOT_CONTEXT, context, propagation, trace } from "@opentelemetry/api";
import type { Context } from "@opentelemetry/api";

type TraceCarrier = Record<string, string>;

const captureTraceContext = (): TraceCarrier => {
  const carrier: TraceCarrier = {};
  propagation.inject(context.active(), carrier);
  return carrier;
};

const contextFromCarrier = (carrier?: TraceCarrier): Context => {
  if (!carrier) {
    return ROOT_CONTEXT;
  }
  return propagation.extract(ROOT_CONTEXT, carrier);
};

const headerValue = (headers: Headers, key: string): string | undefined => {
  const value = headers.get(key);
  if (value === null) {
    return;
  }
  return value;
};

const contextFromHeaders = (headers: Headers): Context =>
  propagation.extract(ROOT_CONTEXT, headers, {
    get: (carrier, key) => headerValue(carrier, key),
    keys: (carrier) => [...carrier.keys()],
  });

const injectIntoHeaders = (headers: Headers) => {
  propagation.inject(context.active(), headers, {
    set: (carrier, key, value) => {
      carrier.set(key, value);
    },
  });
};

interface TraceFields {
  trace_id?: string;
  span_id?: string;
  trace_flags?: number;
}

const activeTraceFields = (): TraceFields => {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (!spanContext || !trace.isSpanContextValid(spanContext)) {
    return {};
  }
  return {
    trace_id: spanContext.traceId,
    span_id: spanContext.spanId,
    trace_flags: spanContext.traceFlags,
  };
};

export { activeTraceFields, captureTraceContext, contextFromCarrier, contextFromHeaders, injectIntoHeaders };
export type { TraceCarrier, TraceFields };
