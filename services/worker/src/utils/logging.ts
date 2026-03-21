import type { WideloggerOptions } from "widelogger";
import { widelogger, widelog } from "widelogger";

const environment = process.env.ENV ?? "production";

const options: WideloggerOptions = {
  service: "keeper-worker",
  defaultEventName: "wide_event",
  commitHash: process.env.COMMIT_SHA,
  environment,
  version: process.env.npm_package_version,
};

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  options.transport = {
    target: "pino-opentelemetry-transport",
    options: {
      resourceAttributes: {
        "service.name": "keeper-worker",
        "deployment.environment": environment,
      },
    },
  };
}

const { context, destroy } = widelogger(options);

export { context, destroy, widelog };
