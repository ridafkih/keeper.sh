#!/usr/bin/env bun

/**
 * Reads pino JSON logs from stdin, forwards them to an OTEL collector,
 * and passes them through to stdout unchanged.
 *
 * Usage: app | otel-logger
 *
 * Reads OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_EXPORTER_OTLP_HEADERS from env.
 * If OTEL_EXPORTER_OTLP_ENDPOINT is not set, passes stdin through to stdout.
 *
 * Set OTEL_SERVICE_NAME to tag logs with a service name.
 */

import { createInterface } from "node:readline";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import {
  detectResources,
  envDetector,
  hostDetector,
  osDetector,
  processDetector,
  resourceFromAttributes,
} from "@opentelemetry/resources";

if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  process.stdin.pipe(process.stdout);
} else {
  const serviceName = process.env.OTEL_SERVICE_NAME ?? "unknown";

  const detected = detectResources({
    detectors: [envDetector, hostDetector, osDetector, processDetector],
  });

  const resource = detected.merge(
    resourceFromAttributes({
      "service.name": serviceName,
      "deployment.environment": process.env.ENV ?? "production",
    }),
  );

  const provider = new LoggerProvider({
    resource,
    processors: [new BatchLogRecordProcessor(new OTLPLogExporter())],
  });

  const logger = provider.getLogger(serviceName);

  const severityMap: Record<number, SeverityNumber> = {
    10: SeverityNumber.TRACE,
    20: SeverityNumber.DEBUG,
    30: SeverityNumber.INFO,
    40: SeverityNumber.WARN,
    50: SeverityNumber.ERROR,
    60: SeverityNumber.FATAL,
  };

  const severityTextMap: Record<number, string> = {
    10: "TRACE",
    20: "DEBUG",
    30: "INFO",
    40: "WARN",
    50: "ERROR",
    60: "FATAL",
  };

  const rl = createInterface({ input: process.stdin });

  rl.on("line", (line) => {
    process.stdout.write(line + "\n");

    try {
      const { msg, level, time, ...attributes } = JSON.parse(line);
      logger.emit({
        body: msg,
        severityNumber: severityMap[level] ?? SeverityNumber.INFO,
        severityText: severityTextMap[level] ?? "INFO",
        timestamp: time ? new Date(time) : undefined,
        attributes,
      });
    } catch {
      // not JSON, pass through
    }
  });

  rl.on("close", async () => {
    await provider.shutdown();
  });
}
