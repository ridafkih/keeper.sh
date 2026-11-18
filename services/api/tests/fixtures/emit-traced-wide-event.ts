import { activeTraceFields, startTracing, withSpan } from "@keeper.sh/otelemetry/tracing";
import { context, destroy, widelog } from "../../src/utils/logging";

const tracing = startTracing({ serviceName: "keeper-api", propagateToOrigins: [], environment: process.env });

await withSpan("GET /api/events", {}, () =>
  context(() => {
    process.stderr.write(`${JSON.stringify(activeTraceFields())}\n`);
    widelog.set("operation.name", "GET /api/events");
    widelog.flush();
    widelog.set("operation.name", "GET /api/events follow-up");
    widelog.flush();
    return Promise.resolve();
  }),
);

await destroy();
await tracing.shutdown();
