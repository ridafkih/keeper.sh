import { widelogger, widelog } from "widelogger";

const otelEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

const { context, destroy } = widelogger({
  service: "keeper-web",
  defaultEventName: "wide_event",
  commitHash: process.env.COMMIT_SHA,
  environment: process.env.ENV ?? "production",
  version: process.env.npm_package_version,
  transport: otelEndpoint
    ? {
        target: "pino-opentelemetry-transport",
        options: {
          resourceAttributes: {
            "service.name": "keeper-web",
            "deployment.environment": process.env.ENV ?? "production",
          },
        },
      }
    : undefined,
});

export { context, destroy, widelog };
