import { SpanKind, SpanStatusCode, context, trace } from "@opentelemetry/api";
import type { Attributes, Context, Span } from "@opentelemetry/api";
import { contextFromCarrier } from "./trace-context";
import type { TraceCarrier } from "./trace-context";

const TRACER_NAME = "keeper.sh";

interface SpanOptions {
  kind?: SpanKind;
  attributes?: Attributes;
  parent?: TraceCarrier;
  root?: boolean;
}

const tracer = () => trace.getTracer(TRACER_NAME);

const resolveParentContext = (options: SpanOptions): Context => {
  if (options.parent) {
    return contextFromCarrier(options.parent);
  }
  if (options.root) {
    return trace.deleteSpan(context.active());
  }
  return context.active();
};

const toError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
};

const markSpanFailed = (span: Span, error: unknown) => {
  const exception = toError(error);
  span.recordException(exception);
  span.setStatus({ code: SpanStatusCode.ERROR, message: exception.message });
};

const markActiveSpanFailed = (error: unknown) => {
  const span = trace.getActiveSpan();
  if (span) {
    markSpanFailed(span, error);
  }
};

const runInSpan = async <Result>(span: Span, run: () => Promise<Result>): Promise<Result> => {
  try {
    return await run();
  } catch (error) {
    markSpanFailed(span, error);
    throw error;
  } finally {
    span.end();
  }
};

const withSpanInContext = <Result>(
  name: string,
  options: SpanOptions,
  parentContext: Context,
  run: () => Promise<Result>,
): Promise<Result> => {
  const span = tracer().startSpan(
    name,
    { kind: options.kind ?? SpanKind.INTERNAL, attributes: options.attributes },
    parentContext,
  );
  return context.with(trace.setSpan(parentContext, span), () => runInSpan(span, run));
};

const withSpan = <Result>(name: string, options: SpanOptions, run: () => Promise<Result>): Promise<Result> =>
  withSpanInContext(name, options, resolveParentContext(options), run);

export { SpanKind, markActiveSpanFailed, markSpanFailed, withSpan, withSpanInContext };
export type { SpanOptions };
