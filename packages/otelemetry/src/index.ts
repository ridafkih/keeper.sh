#!/usr/bin/env bun

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

const PINO_SEVERITY: Record<number, SeverityNumber> = {
  10: SeverityNumber.TRACE,
  20: SeverityNumber.DEBUG,
  30: SeverityNumber.INFO,
  40: SeverityNumber.WARN,
  50: SeverityNumber.ERROR,
  60: SeverityNumber.FATAL,
};

const PINO_SEVERITY_TEXT: Record<number, string> = {
  10: "TRACE",
  20: "DEBUG",
  30: "INFO",
  40: "WARN",
  50: "ERROR",
  60: "FATAL",
};

const parseLogLine = (line: string) => {
  const { msg: message, level, time, service, ...attributes } = JSON.parse(line);
  return { message, level, time, service, attributes };
};

const parseStructuredLogLine = (
  line: string,
): ReturnType<typeof parseLogLine> | undefined => {
  try {
    return parseLogLine(line);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return;
    }
    throw error;
  }
};

const forwardToCollector = (
  logger: ReturnType<LoggerProvider["getLogger"]>,
  line: string,
  entry: ReturnType<typeof parseLogLine> | undefined,
) => {
  if (!entry) {
    logger.emit({
      body: line,
      severityNumber: SeverityNumber.ERROR,
      severityText: "ERROR",
      attributes: { "log.format": "unstructured" },
    });
    return;
  }

  const { message, level, time, attributes } = entry;
  logger.emit({
    body: message ?? line,
    severityNumber: PINO_SEVERITY[level] ?? SeverityNumber.INFO,
    severityText: PINO_SEVERITY_TEXT[level] ?? "INFO",
    ...(time && { timestamp: new Date(time) }),
    attributes,
  });
};

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const lineReader = createInterface({ input: process.stdin });
  const serviceName = process.env.OTEL_SERVICE_NAME ?? "unknown";

  const resource = detectResources({
    detectors: [envDetector, hostDetector, osDetector, processDetector],
  }).merge(
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

  for await (const line of lineReader) {
    process.stdout.write(`${line}\n`);
    forwardToCollector(logger, line, parseStructuredLogLine(line));
  }

  await provider.shutdown();
} else {
  process.stdin.pipe(process.stdout);
}
