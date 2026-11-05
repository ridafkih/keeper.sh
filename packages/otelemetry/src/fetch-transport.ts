import { OTLPExporterError } from "@opentelemetry/otlp-exporter-base";
import type { ExportResponse, IExporterTransport } from "@opentelemetry/otlp-exporter-base";

interface FetchTransportParameters {
  url: string;
  headers: () => Promise<Record<string, string>>;
  compression: "gzip" | "none";
  attemptTimeoutMillis: number;
}

const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);
const INITIAL_BACKOFF_MILLIS = 1000;
const MAX_BACKOFF_MILLIS = 5000;
const BACKOFF_MULTIPLIER = 1.5;
const BACKOFF_JITTER = 0.2;

const parseRetryAfterMillis = (retryAfter: string | null): number | undefined => {
  if (retryAfter === null) {
    return;
  }
  const seconds = Number(retryAfter);
  if (Number.isInteger(seconds)) {
    return Math.max(seconds, 0) * 1000;
  }
  const delay = new Date(retryAfter).getTime() - Date.now();
  if (Number.isNaN(delay)) {
    return;
  }
  return Math.max(delay, 0);
};

const backoffMillis = (retry: number): number => {
  const backoff = Math.min(INITIAL_BACKOFF_MILLIS * BACKOFF_MULTIPLIER ** retry, MAX_BACKOFF_MILLIS);
  const jitter = 1 + (Math.random() * 2 - 1) * BACKOFF_JITTER;
  return backoff * jitter;
};

const toError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
};

const buildRequestHeaders = async (parameters: FetchTransportParameters) => {
  const headers = await parameters.headers();
  if (parameters.compression === "gzip") {
    return { ...headers, "Content-Encoding": "gzip" };
  }
  return headers;
};

const encodeBody = (data: Uint8Array, compression: FetchTransportParameters["compression"]) => {
  if (compression === "gzip") {
    return Bun.gzipSync(new Uint8Array(data));
  }
  return data;
};

const responseFromStatus = (response: Response, body: Uint8Array): ExportResponse => {
  if (response.ok) {
    return { status: "success", data: body };
  }
  const error = new OTLPExporterError(
    response.statusText,
    response.status,
    new TextDecoder().decode(body),
  );
  if (RETRYABLE_STATUS_CODES.has(response.status)) {
    return {
      status: "retryable",
      error,
      retryInMillis: parseRetryAfterMillis(response.headers.get("retry-after")),
    };
  }
  return { status: "failure", error };
};

const sendOnce = async (
  parameters: FetchTransportParameters,
  data: Uint8Array,
  timeoutMillis: number,
): Promise<ExportResponse> => {
  try {
    const response = await fetch(parameters.url, {
      method: "POST",
      headers: await buildRequestHeaders(parameters),
      body: encodeBody(data, parameters.compression),
      signal: AbortSignal.timeout(timeoutMillis),
    });
    const body = new Uint8Array(await response.arrayBuffer());
    return responseFromStatus(response, body);
  } catch (error) {
    return { status: "retryable", error: toError(error) };
  }
};

const sendWithRetries = async (
  parameters: FetchTransportParameters,
  data: Uint8Array,
  deadline: number,
  retry: number,
): Promise<ExportResponse> => {
  const attemptTimeoutMillis = Math.min(parameters.attemptTimeoutMillis, deadline - Date.now());
  const response = await sendOnce(parameters, data, Math.max(attemptTimeoutMillis, 1));
  if (response.status !== "retryable") {
    return response;
  }
  const delay = response.retryInMillis ?? backoffMillis(retry);
  if (Date.now() + delay >= deadline) {
    return response;
  }
  await Bun.sleep(delay);
  return sendWithRetries(parameters, data, deadline, retry + 1);
};

const createFetchTransport = (parameters: FetchTransportParameters): IExporterTransport => ({
  send: (data, timeoutMillis) => sendWithRetries(parameters, data, Date.now() + timeoutMillis, 0),
  shutdown: () => null,
});

export { createFetchTransport };
export type { FetchTransportParameters };
