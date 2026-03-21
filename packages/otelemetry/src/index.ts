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

const forwardToCollector = (
  logger: ReturnType<LoggerProvider["getLogger"]>,
  { message, level, time, attributes }: ReturnType<typeof parseLogLine>,
) => {
  logger.emit({
    body: message,
    severityNumber: PINO_SEVERITY[level] ?? SeverityNumber.INFO,
    severityText: PINO_SEVERITY_TEXT[level] ?? "INFO",
    ...(time && { timestamp: new Date(time) }),
    attributes,
  });
};

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const lineReader = createInterface({ input: process.stdin });
  const lineIterator = lineReader[Symbol.asyncIterator]();

  const firstResult = await lineIterator.next();

  if (firstResult.done) {
    process.exit(0);
  }

  process.stdout.write(`${firstResult.value}\n`);

  const firstLogEntry = parseLogLine(firstResult.value);
  const serviceName = firstLogEntry.service ?? "unknown";

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

  forwardToCollector(logger, firstLogEntry);

  for await (const line of lineIterator) {
    process.stdout.write(`${line}\n`);
    try {
      forwardToCollector(logger, parseLogLine(line));
    } catch {
      // Non-JSON line, pass through only
    }
  }

  await provider.shutdown();
} else {
  process.stdin.pipe(process.stdout);
}
