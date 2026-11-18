import arkenv from "arkenv";

const tracingEnvironmentSchema = {
  "OTEL_EXPORTER_OTLP_ENDPOINT?": "string.url",
  ENV: "string > 0",
  VERSION: "string > 0",
  COMMIT_SHA: "string > 0",
  TRACE_SAMPLE_RATIO: "0 <= number <= 1 = 0.1",
  TRACE_SLOW_THRESHOLD_MS: "number.integer > 0 = 2000",
} as const;

interface TracingConfiguration {
  enabled: boolean;
  environment: string;
  version: string;
  commit: string;
  sampleRatio: number;
  slowThresholdMillis: number;
}

const loadTracingConfiguration = (environment: Record<string, string | undefined>): TracingConfiguration => {
  const parsed = arkenv(tracingEnvironmentSchema, { env: environment });
  return {
    enabled: Boolean(parsed.OTEL_EXPORTER_OTLP_ENDPOINT),
    environment: parsed.ENV,
    version: parsed.VERSION,
    commit: parsed.COMMIT_SHA,
    sampleRatio: parsed.TRACE_SAMPLE_RATIO,
    slowThresholdMillis: parsed.TRACE_SLOW_THRESHOLD_MS,
  };
};

export { loadTracingConfiguration };
export type { TracingConfiguration };
