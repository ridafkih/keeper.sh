#!/usr/bin/env bun

import type { EventEmitter } from "node:events";
import os from "node:os";
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

const SHUTDOWN_TIMEOUT_MS = 5000;
const FORWARDED_SIGNALS: NodeJS.Signals[] = ["SIGTERM", "SIGINT"];

interface LineSink {
  write: (line: string) => void;
  shutdown: () => Promise<void>;
}

const createStdoutSink = (): LineSink => ({
  write: (line) => {
    process.stdout.write(`${line}\n`);
  },
  shutdown: () => Promise.resolve(),
});

const createCollectorSink = (): LineSink => {
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

  return {
    write: (line) => {
      process.stdout.write(`${line}\n`);
      forwardToCollector(logger, line, parseStructuredLogLine(line));
    },
    shutdown: async () => {
      const deadline = Bun.sleep(SHUTDOWN_TIMEOUT_MS);
      await Promise.race([provider.shutdown().catch(() => null), deadline]);
    },
  };
};

const forwardLines = async (stream: ReadableStream<Uint8Array>, sink: LineSink) => {
  const decoder = new TextDecoder();
  let pending = "";

  for await (const chunk of stream) {
    pending += decoder.decode(chunk, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      sink.write(line);
    }
  }

  pending += decoder.decode();
  if (pending) {
    sink.write(pending);
  }
};

const signalNumberOf = (signal: NodeJS.Signals | number): number => {
  if (typeof signal === "number") {
    return signal;
  }
  return os.constants.signals[signal];
};

const exitStatusOf = (subprocess: Bun.Subprocess): number => {
  if (subprocess.signalCode) {
    return 128 + signalNumberOf(subprocess.signalCode);
  }
  return subprocess.exitCode ?? 1;
};

const superviseCommand = async (command: string[], sink: LineSink) => {
  const subprocess = Bun.spawn(command, { stdin: "inherit", stdout: "pipe", stderr: "pipe" });

  const processEvents: EventEmitter = process;
  for (const signal of FORWARDED_SIGNALS) {
    processEvents.on(signal, () => {
      subprocess.kill(signal);
    });
  }

  await Promise.all([forwardLines(subprocess.stdout, sink), forwardLines(subprocess.stderr, sink)]);
  await subprocess.exited;
  await sink.shutdown();
  process.exit(exitStatusOf(subprocess));
};

const forwardStdin = async (sink: LineSink) => {
  for await (const line of createInterface({ input: process.stdin })) {
    sink.write(line);
  }
  await sink.shutdown();
};

const createSink = (): LineSink => {
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    return createCollectorSink();
  }
  return createStdoutSink();
};

const run = (command: string[], sink: LineSink) => {
  if (command.length > 0) {
    return superviseCommand(command, sink);
  }
  return forwardStdin(sink);
};

await run(process.argv.slice(2), createSink());
