/**
 * Pino OTLP Log Transport
 *
 * Reads JSON log lines from stdin, converts them to OTLP log format,
 * and POSTs them to an OTLP-compatible endpoint. Also passes through
 * all lines to stdout so console output is preserved.
 *
 * Environment variables:
 *   OTEL_EXPORTER_OTLP_ENDPOINT  - Base URL of the OTLP collector (e.g. https://otel.example.com)
 *   OTEL_EXPORTER_OTLP_HEADERS   - Comma-separated key=value auth headers
 *                                   (e.g. "Authorization=Basic abc123,X-Scope-OrgID=tenant1")
 */

const SEVERITY_NUMBER: Record<string, number> = {
  trace: 1,
  debug: 5,
  info: 9,
  warn: 13,
  error: 17,
  fatal: 21,
};

const PINO_LEVEL_TO_SEVERITY: Record<number, { text: string; number: number }> =
  {
    10: { text: "TRACE", number: 1 },
    20: { text: "DEBUG", number: 5 },
    30: { text: "INFO", number: 9 },
    40: { text: "WARN", number: 13 },
    50: { text: "ERROR", number: 17 },
    60: { text: "FATAL", number: 21 },
  };

interface OtlpAttribute {
  key: string;
  value: { stringValue: string } | { intValue: number } | { boolValue: boolean };
}

const toOtlpValue = (
  value: unknown,
): OtlpAttribute["value"] | null => {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number")
    return Number.isInteger(value)
      ? { intValue: value }
      : { stringValue: String(value) };
  if (typeof value === "boolean") return { boolValue: value };
  return { stringValue: JSON.stringify(value) };
};

const flattenAttributes = (
  obj: Record<string, unknown>,
  prefix = "",
): OtlpAttribute[] => {
  const attributes: OtlpAttribute[] = [];

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value)) {
      attributes.push(...flattenAttributes(value as Record<string, unknown>, fullKey));
    } else {
      const otlpValue = toOtlpValue(value);
      if (otlpValue) attributes.push({ key: fullKey, value: otlpValue });
    }
  }

  return attributes;
};

const RESOURCE_KEYS = new Set([
  "service",
  "service_version",
  "commit_hash",
  "instance_id",
  "environment",
  "hostname",
  "pid",
]);

const pinoToOtlpLogRecord = (log: Record<string, unknown>) => {
  const level = typeof log.level === "number" ? log.level : 30;
  const severity = PINO_LEVEL_TO_SEVERITY[level] ?? { text: "INFO", number: 9 };

  const time = typeof log.time === "string" ? log.time : new Date().toISOString();
  const timeNano = String(new Date(time).getTime() * 1_000_000);

  const resourceAttributes: OtlpAttribute[] = [];
  const logAttributes: OtlpAttribute[] = [];

  for (const [key, value] of Object.entries(log)) {
    if (key === "level" || key === "time" || key === "msg") continue;

    if (RESOURCE_KEYS.has(key)) {
      if (key === "service") {
        const otlpValue = toOtlpValue(value);
        if (otlpValue) resourceAttributes.push({ key: "service.name", value: otlpValue });
      } else {
        const otlpValue = toOtlpValue(value);
        if (otlpValue) resourceAttributes.push({ key, value: otlpValue });
      }
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      logAttributes.push(...flattenAttributes(value as Record<string, unknown>, key));
    } else {
      const otlpValue = toOtlpValue(value);
      if (otlpValue) logAttributes.push({ key, value: otlpValue });
    }
  }

  return {
    resource: { attributes: resourceAttributes },
    logRecord: {
      timeUnixNano: timeNano,
      severityNumber: severity.number,
      severityText: severity.text,
      body: { stringValue: typeof log.msg === "string" ? log.msg : JSON.stringify(log) },
      attributes: logAttributes,
    },
  };
};

const parseHeaders = (headerStr: string): Record<string, string> => {
  const headers: Record<string, string> = {};
  for (const part of headerStr.split(",")) {
    const eqIndex = part.indexOf("=");
    if (eqIndex === -1) continue;
    const key = part.slice(0, eqIndex).trim();
    const value = part.slice(eqIndex + 1).trim();
    if (key) headers[key] = value;
  }
  return headers;
};

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

if (!endpoint) {
  process.stderr.write(
    "log-transport: OTEL_EXPORTER_OTLP_ENDPOINT not set, passthrough only\n",
  );
}

const logsUrl = endpoint ? `${endpoint.replace(/\/$/, "")}/v1/logs` : null;
const authHeaders = process.env.OTEL_EXPORTER_OTLP_HEADERS
  ? parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS)
  : {};

const BATCH_SIZE = 50;
const FLUSH_INTERVAL_MS = 2000;
let batch: Array<ReturnType<typeof pinoToOtlpLogRecord>> = [];

const sendBatch = async (records: typeof batch) => {
  if (!logsUrl || records.length === 0) return;

  const grouped = new Map<string, typeof records>();
  for (const record of records) {
    const resourceKey = JSON.stringify(record.resource);
    const existing = grouped.get(resourceKey);
    if (existing) {
      existing.push(record);
    } else {
      grouped.set(resourceKey, [record]);
    }
  }

  const resourceLogs = Array.from(grouped.entries()).map(
    ([, groupRecords]) => ({
      resource: groupRecords[0]!.resource,
      scopeLogs: [
        {
          scope: { name: "widelogger" },
          logRecords: groupRecords.map((r) => r.logRecord),
        },
      ],
    }),
  );

  const body = JSON.stringify({ resourceLogs });

  try {
    const response = await fetch(logsUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body,
    });

    if (!response.ok) {
      process.stderr.write(
        `log-transport: OTLP export failed (${response.status}): ${await response.text()}\n`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`log-transport: OTLP export error: ${message}\n`);
  }
};

const flushBatch = () => {
  if (batch.length === 0) return;
  const toSend = batch;
  batch = [];
  void sendBatch(toSend);
};

const flushInterval = setInterval(flushBatch, FLUSH_INTERVAL_MS);
flushInterval.unref();

const decoder = new TextDecoder();
let buffer = "";

const processLine = (line: string) => {
  if (!line.trim()) return;

  // Always pass through to stdout
  process.stdout.write(line + "\n");

  if (!logsUrl) return;

  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    batch.push(pinoToOtlpLogRecord(parsed));

    if (batch.length >= BATCH_SIZE) {
      flushBatch();
    }
  } catch {
    // Not JSON, just pass through (already written to stdout above)
  }
};

const reader = Bun.stdin.stream();

(async () => {
  for await (const chunk of reader) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      processLine(line);
    }
  }

  if (buffer.trim()) {
    processLine(buffer);
  }

  flushBatch();
})();

process.on("beforeExit", () => {
  clearInterval(flushInterval);
  flushBatch();
});
