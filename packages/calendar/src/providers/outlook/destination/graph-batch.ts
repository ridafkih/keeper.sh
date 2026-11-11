import { HTTP_STATUS } from "@keeper.sh/constants";
import { microsoftApiErrorSchema } from "@keeper.sh/data-schemas";
import type { MicrosoftGraphBatchResponse } from "@keeper.sh/data-schemas";
import { widelog } from "widelogger";
import { abortableSleep, computeDelay } from "../../../core/utils/backoff";
import { measureSegment } from "../../../core/telemetry/segments";
import { OUTLOOK_MAX_THROTTLE_RETRIES, isThrottleStatus, parseRetryAfterMs } from "../shared/throttle";

const GRAPH_BATCH_REQUEST_LIMIT = 20;

interface GraphBatchRequest {
  body?: unknown;
  headers?: Record<string, string>;
  id: string;
  method: "DELETE" | "GET" | "PATCH" | "POST";
  url: string;
}

type GraphBatchSubResponse = MicrosoftGraphBatchResponse["responses"][number];

type GraphBatchOutcome = { error: unknown } | { response: GraphBatchSubResponse };

interface GraphBatchRetryRound {
  delayMs: number;
  retriedCount: number;
}

interface GraphBatchTransport {
  onRetryRound: (round: GraphBatchRetryRound) => void;
  sendBatch: (requests: GraphBatchRequest[]) => Promise<GraphBatchSubResponse[]>;
  signal?: AbortSignal;
}

class MicrosoftGraphHttpError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "MicrosoftGraphHttpError";
    this.status = status;
  }
}

class MicrosoftGraphBatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MicrosoftGraphBatchError";
  }
}

const isRetriableSubResponseStatus = (status: number): boolean =>
  isThrottleStatus(status) || status === HTTP_STATUS.GATEWAY_TIMEOUT;

const isSuccessfulStatus = (status: number): boolean => status >= 200 && status < 300;

const readSubResponseHeader = (response: GraphBatchSubResponse, name: string): string | null => {
  const lowerName = name.toLowerCase();
  const entry = Object.entries(response.headers ?? {})
    .find(([headerName]) => headerName.toLowerCase() === lowerName);
  return entry?.[1] ?? null;
};

const readSubResponseErrorMessage = (response: GraphBatchSubResponse): string => {
  const fallback = `Microsoft Graph responded ${response.status}`;
  if (!microsoftApiErrorSchema.allows(response.body)) {
    return fallback;
  }
  return microsoftApiErrorSchema.assert(response.body).error?.message ?? fallback;
};

const resolveRetryRoundDelayMs = (responses: GraphBatchSubResponse[], attempt: number): number => {
  const retryAfterDelays = responses
    .map((response) => parseRetryAfterMs(readSubResponseHeader(response, "Retry-After")))
    .filter((delayMs): delayMs is number => delayMs !== null);
  if (retryAfterDelays.length === 0) {
    return computeDelay(attempt);
  }
  return Math.max(...retryAfterDelays);
};

const chunkGraphBatchRequests = (requests: GraphBatchRequest[]): GraphBatchRequest[][] => {
  const chunks: GraphBatchRequest[][] = [];
  for (let offset = 0; offset < requests.length; offset += GRAPH_BATCH_REQUEST_LIMIT) {
    chunks.push(requests.slice(offset, offset + GRAPH_BATCH_REQUEST_LIMIT));
  }
  return chunks;
};

const failEveryRequest = (
  outcomes: Map<string, GraphBatchOutcome>,
  requests: GraphBatchRequest[],
  error: unknown,
): void => {
  for (const request of requests) {
    outcomes.set(request.id, { error });
  }
};

const sendPendingRequests = async (
  pending: GraphBatchRequest[],
  transport: GraphBatchTransport,
): Promise<{ error: unknown } | { responses: GraphBatchSubResponse[] }> => {
  try {
    return { responses: await transport.sendBatch(pending) };
  } catch (error) {
    if (transport.signal?.aborted) {
      throw error;
    }
    return { error };
  }
};

const executeGraphBatchChunk = async (
  chunk: GraphBatchRequest[],
  transport: GraphBatchTransport,
): Promise<Map<string, GraphBatchOutcome>> => {
  const outcomes = new Map<string, GraphBatchOutcome>();
  let pending = chunk;

  for (let attempt = 0; attempt <= OUTLOOK_MAX_THROTTLE_RETRIES; attempt++) {
    const sent = await sendPendingRequests(pending, transport);
    if ("error" in sent) {
      failEveryRequest(outcomes, pending, sent.error);
      return outcomes;
    }

    const responsesById = new Map(sent.responses.map((response) => [response.id, response]));
    const retriable: { request: GraphBatchRequest; response: GraphBatchSubResponse }[] = [];
    const canRetry = attempt < OUTLOOK_MAX_THROTTLE_RETRIES;

    for (const request of pending) {
      const response = responsesById.get(request.id);
      if (!response) {
        outcomes.set(request.id, {
          error: new MicrosoftGraphBatchError(`Microsoft Graph returned no response for batch request ${request.id}`),
        });
      } else if (canRetry && isRetriableSubResponseStatus(response.status)) {
        retriable.push({ request, response });
      } else {
        outcomes.set(request.id, { response });
      }
    }

    if (retriable.length === 0) {
      return outcomes;
    }

    const delayMs = resolveRetryRoundDelayMs(retriable.map(({ response }) => response), attempt);
    widelog.count("provider.retry_count", retriable.length);
    transport.onRetryRound({ delayMs, retriedCount: retriable.length });
    await measureSegment("wait.provider_retry_ms", () => abortableSleep(delayMs, transport.signal));
    pending = retriable.map(({ request }) => request);
  }

  return outcomes;
};

const executeGraphBatch = async (
  requests: GraphBatchRequest[],
  transport: GraphBatchTransport,
): Promise<Map<string, GraphBatchOutcome>> => {
  const outcomes = new Map<string, GraphBatchOutcome>();
  for (const chunk of chunkGraphBatchRequests(requests)) {
    for (const [id, outcome] of await executeGraphBatchChunk(chunk, transport)) {
      outcomes.set(id, outcome);
    }
  }
  return outcomes;
};

export {
  GRAPH_BATCH_REQUEST_LIMIT,
  MicrosoftGraphBatchError,
  MicrosoftGraphHttpError,
  executeGraphBatch,
  isRetriableSubResponseStatus,
  isSuccessfulStatus,
  readSubResponseErrorMessage,
};
export type { GraphBatchOutcome, GraphBatchRequest, GraphBatchSubResponse, GraphBatchTransport };
