import arkenv from "arkenv";

const tracingEnvironmentSchema = {
  "OTEL_EXPORTER_OTLP_ENDPOINT?": "string.url",
  ENV: "string = 'production'",
  TRACE_SAMPLE_RATIO: "0 <= number <= 1 = 0.1",
  TRACE_SLOW_THRESHOLD_MS: "number.integer > 0 = 2000",
  "KEEPER_VERSION?": "string",
  "COMMIT_SHA?": "string",
} as const;

interface TracingConfiguration {
  enabled: boolean;
  environment: string;
  sampleRatio: number;
  slowThresholdMillis: number;
  version?: string;
  commit?: string;
}

const loadTracingConfiguration = (environment: Record<string, string | undefined>): TracingConfiguration => {
  const parsed = arkenv(tracingEnvironmentSchema, { env: environment });
  return {
    enabled: Boolean(parsed.OTEL_EXPORTER_OTLP_ENDPOINT),
    environment: parsed.ENV,
    sampleRatio: parsed.TRACE_SAMPLE_RATIO,
    slowThresholdMillis: parsed.TRACE_SLOW_THRESHOLD_MS,
    version: parsed.KEEPER_VERSION,
    commit: parsed.COMMIT_SHA,
  };
};

export { loadTracingConfiguration };
export type { TracingConfiguration };
