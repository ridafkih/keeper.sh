import { widelogger, widelog } from "widelogger";

const environment = process.env.ENV ?? "production";

const { context, destroy } = widelogger({
  service: "keeper-api",
  defaultEventName: "wide_event",
  commitHash: process.env.COMMIT_SHA,
  environment,
  version: process.env.npm_package_version,
  ...(process.env.OTEL_EXPORTER_OTLP_ENDPOINT && {
    transport: {
      target: "pino-opentelemetry-transport",
      options: {
        resourceAttributes: {
          "service.name": "keeper-api",
          "deployment.environment": environment,
        },
      },
    },
  }),
});

export { context, destroy, widelog };
