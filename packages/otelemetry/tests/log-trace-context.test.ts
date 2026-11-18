import { trace } from "@opentelemetry/api";
import { describe, expect, it } from "vitest";
import { separateTraceContext } from "../src/log-trace-context";

const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const SPAN_ID = "00f067aa0ba902b7";

describe("wide events forwarded as log records", () => {
  it("link to the trace named by their trace_id and span_id", () => {
    const { context, attributes } = separateTraceContext({
      "operation.name": "GET /api/events",
      trace_id: TRACE_ID,
      span_id: SPAN_ID,
      trace_flags: 1,
    });
    const spanContext = context && trace.getSpanContext(context);
    expect(spanContext).toMatchObject({ traceId: TRACE_ID, spanId: SPAN_ID, traceFlags: 1 });
    expect(attributes).toEqual({ "operation.name": "GET /api/events" });
  });

  it("stay unlinked when the event carries no valid trace id", () => {
    const fields = { trace_id: "0".repeat(32), span_id: SPAN_ID };
    expect(separateTraceContext(fields)).toEqual({ attributes: fields });
  });
});
