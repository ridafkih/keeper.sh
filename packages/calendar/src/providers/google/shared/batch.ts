import { HTTP_STATUS, PROVIDER_PUSH_REQUEST_TIMEOUT_MS } from "@keeper.sh/constants";
import type { DestinationAnswer } from "../../../core/types";
import type { RedisRateLimiter } from "../../../core/utils/redis-rate-limiter";
import { chunkArray } from "../../../core/utils/chunk";
import { fetchWithTimeout } from "../../../core/utils/fetch-with-timeout";
import { GOOGLE_BATCH_API, GOOGLE_BATCH_MAX_SIZE } from "./api";
import { withBackoff, abortableSleep, computeDelay, DEFAULT_MAX_RETRIES } from "../../../core/utils/backoff";
import { isRateLimitApiError, parseGoogleApiError, parseGoogleApiErrorFromBody } from "./errors";

interface BatchSubRequest {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
}

interface BatchSubResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  /*
   * Whether Google really returned this sub-response. A part the batch omitted, or one whose
   * status line we could not read, has no status at all - the 0 below is a placeholder for the
   * missing number, never a verdict the destination handed down.
   */
  answer?: DestinationAnswer;
}

const NO_STATUS_LINE = 0;

const unansweredSubResponse = (): BatchSubResponse => ({
  answer: "unanswered",
  body: null,
  headers: {},
  statusCode: NO_STATUS_LINE,
});

const generateBoundary = (): string =>
  `batch_${crypto.randomUUID().replaceAll("-", "")}`;

const serializeSubRequest = (subRequest: BatchSubRequest, index: number): string => {
  const lines: string[] = [
    `Content-Type: application/http`,
    `Content-ID: <item-${index}>`,
    "",
    `${subRequest.method} ${subRequest.path} HTTP/1.1`,
  ];

  if (subRequest.headers) {
    for (const [key, value] of Object.entries(subRequest.headers)) {
      lines.push(`${key}: ${value}`);
    }
  }

  if ("body" in subRequest && subRequest.body !== null) {
    const bodyStr = JSON.stringify(subRequest.body);
    lines.push("Content-Type: application/json");
    lines.push(`Content-Length: ${new TextEncoder().encode(bodyStr).length}`);
    lines.push("");
    lines.push(bodyStr);
  } else {
    lines.push("");
  }

  return lines.join("\r\n");
};

const buildBatchRequestBody = (subRequests: BatchSubRequest[], boundary: string): string => {
  const parts: string[] = [];

  for (let index = 0; index < subRequests.length; index++) {
    const subRequest = subRequests[index];
    if (!subRequest) {
      continue;
    }
    parts.push(`--${boundary}\r\n${serializeSubRequest(subRequest, index)}`);
  }

  parts.push(`--${boundary}--`);

  return parts.join("\r\n");
};

const parseContentId = (headers: Record<string, string>): number | null => {
  const contentId = headers["content-id"];
  if (!contentId) {
    return null;
  }

  const match = contentId.match(/item-(\d+)/);
  if (!match || !match[1]) {
    return null;
  }

  return Number.parseInt(match[1], 10);
};

const parsePartHeaders = (headerBlock: string): Record<string, string> => {
  const headers: Record<string, string> = {};

  for (const line of headerBlock.split(/\r?\n/)) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) {
      continue;
    }
    const key = line.slice(0, colonIndex).trim().toLowerCase();
    const value = line.slice(colonIndex + 1).trim();
    headers[key] = value;
  }

  return headers;
};

/* Null rather than 0: a part whose first line is not `HTTP/x.y NNN` carries no status the
   destination sent, and reporting that absence as a number invites it to be read as one. */
const parseStatusCode = (statusLine: string): number | null => {
  const statusMatch = statusLine.match(/HTTP\/[\d.]+ (\d+)/);
  if (statusMatch && statusMatch[1]) {
    return Number.parseInt(statusMatch[1], 10);
  }
  return null;
};

const parseHttpResponse = (httpBlock: string): BatchSubResponse => {
  const lines = httpBlock.split(/\r?\n/);
  const [statusLine] = lines;

  if (!statusLine) {
    return unansweredSubResponse();
  }

  const parsedStatusCode = parseStatusCode(statusLine);
  if (parsedStatusCode === null) {
    return unansweredSubResponse();
  }

  const statusCode = parsedStatusCode;
  const headers: Record<string, string> = {};
  let bodyStartIndex = 1;

  for (let lineIndex = 1; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    if (!line || line.trim() === "") {
      bodyStartIndex = lineIndex + 1;
      break;
    }
    const colonIndex = line.indexOf(":");
    if (colonIndex !== -1) {
      const key = line.slice(0, colonIndex).trim().toLowerCase();
      const value = line.slice(colonIndex + 1).trim();
      headers[key] = value;
    }
  }

  const bodyStr = lines.slice(bodyStartIndex).join("\n").trim();
  let body: unknown = null;

  if (bodyStr) {
    try {
      body = JSON.parse(bodyStr);
    } catch {
      body = bodyStr;
    }
  }

  return { answer: "answered", body, headers, statusCode };
};

const DEFAULT_SEPARATOR_LENGTH = 2;

/*
 * `expectedCount` is the number of sub-requests that went out in this envelope's own request.
 * The returned array is exactly that long, in sub-request order, because every caller downstream
 * (executeBatchChunked's concatenation, retryRateLimitedSubRequests' zip against `pending`, and
 * the provider's entry.batchIndex lookups) reads a response by its position alone. Deriving the
 * length from the largest Content-ID the envelope happened to claim instead let a short or
 * renumbered envelope shift every later answer onto another event's mapping. Omitting the count
 * leaves the length to the envelope's own largest Content-ID, for callers that parse a stored
 * body with no outgoing request in hand.
 */
const UNBOUNDED_SUB_REQUEST_COUNT = Number.POSITIVE_INFINITY;

const orderedLength = (expectedCount: number, maxIndex: number): number => {
  if (Number.isFinite(expectedCount)) {
    return expectedCount;
  }
  return maxIndex + 1;
};

const parseBatchResponseBody = (
  responseText: string,
  boundary: string,
  expectedCount: number = UNBOUNDED_SUB_REQUEST_COUNT,
): BatchSubResponse[] => {
  const parts = responseText.split(`--${boundary}`);
  const results = new Map<number, BatchSubResponse>();
  let maxIndex = -1;

  const isOutsideRange = (index: number): boolean => {
    if (index < 0) {
      return true;
    }
    return index >= expectedCount;
  };

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed || trimmed === "--") {
      continue;
    }

    const separatorIndex = trimmed.search(/\r?\n\r?\n/);
    if (separatorIndex === -1) {
      continue;
    }

    const separatorMatch = trimmed.slice(separatorIndex).match(/\r?\n\r?\n/);
    let separatorLength = DEFAULT_SEPARATOR_LENGTH;
    if (separatorMatch && separatorMatch[0]) {
      separatorLength = separatorMatch[0].length;
    }
    const mimeHeaders = trimmed.slice(0, separatorIndex);
    const httpBlock = trimmed.slice(separatorIndex + separatorLength);

    const partHeaders = parsePartHeaders(mimeHeaders);
    const contentIndex = parseContentId(partHeaders);
    const parsed = parseHttpResponse(httpBlock);

    if (contentIndex === null) {
      /* Content-ID is the only thing that says which sub-request a part answers, so a part
         without a readable one answers none of them. Falling back to a positional guess would
         overwrite whichever sibling already claimed that slot by a real Content-ID; dropping it
         leaves that sibling's answer intact and the guessed slot unanswered, which is the truth
         about what the destination told us. */
      continue;
    }

    const index = contentIndex;

    if (isOutsideRange(index)) {
      /* A part claiming a Content-ID this request never sent answers no sub-request of ours.
         Dropping it keeps it from displacing a sibling; the slot it would have taken stays
         unanswered, which is the truth about what the destination told us. */
      continue;
    }

    results.set(index, parsed);

    if (index > maxIndex) {
      maxIndex = index;
    }
  }

  const length = orderedLength(expectedCount, maxIndex);
  const ordered: BatchSubResponse[] = [];
  for (let index = 0; index < length; index++) {
    const entry = results.get(index);
    if (entry) {
      ordered.push(entry);
    } else {
      /* An index no part in the envelope claimed: Google never answered about this request. */
      ordered.push(unansweredSubResponse());
    }
  }

  return ordered;
};

/*
 * RFC 2045 5.1 lets any Content-Type parameter be spelled as a quoted-string, and RFC 2046 5.1.1
 * applies that to `boundary`. The quoted form may legally hold characters a bare token cannot -
 * `;` and spaces among them - so the value is read as a quoted-string first and only then as a
 * token. Matching the quoted form with a token character class keeps the quotes in the boundary,
 * and a boundary that never occurs in the body collapses the whole envelope into one part.
 */
const BOUNDARY_PARAMETER = /boundary\s*=\s*(?:"([^"]*)"|([^\s;]+))/i;

const extractResponseBoundary = (contentType: string | null): string | null => {
  if (!contentType) {
    return null;
  }

  const match = contentType.match(BOUNDARY_PARAMETER);
  if (!match) {
    return null;
  }

  const [, quoted, token] = match;
  if (typeof quoted === "string") {
    if (!quoted) {
      return null;
    }
    return quoted;
  }

  if (!token) {
    return null;
  }

  return token;
};

class GoogleBatchApiError extends Error {
  public readonly status: number;
  public readonly apiError: ReturnType<typeof parseGoogleApiError>;
  constructor(status: number, body: string) {
    super(`Google Batch API ${status}: ${body}`);
    this.name = "GoogleBatchApiError";
    this.status = status;
    this.apiError = parseGoogleApiError(body);
  }
}

/*
 * Quota is acquired inside the retried operation rather than around it: a whole-batch
 * 429 re-sends every sub-request, and Google charges its per-user quota for each of
 * those attempts. Acquiring once outside would let a batch that retries five times
 * spend six times the slots the limiter believes it handed out.
 */
const executeBatch = (
  subRequests: BatchSubRequest[],
  accessToken: string,
  options?: { rateLimiter?: RedisRateLimiter; signal?: AbortSignal; timeoutMs?: number },
): Promise<BatchSubResponse[]> =>
  withBackoff(
    async () => {
      if (options?.rateLimiter) {
        await options.rateLimiter.acquire(subRequests.length, options.signal);
      }

      const boundary = generateBoundary();
      const requestBody = buildBatchRequestBody(subRequests, boundary);

      const response = await fetchWithTimeout(
        GOOGLE_BATCH_API,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": `multipart/mixed; boundary=${boundary}`,
          },
          body: requestBody,
        },
        options?.timeoutMs ?? PROVIDER_PUSH_REQUEST_TIMEOUT_MS,
        options?.signal,
      );

      if (!response.ok) {
        const errorBody = await response.text();
        throw new GoogleBatchApiError(response.status, errorBody);
      }

      const responseText = await response.text();

      const responseBoundary = extractResponseBoundary(response.headers.get("Content-Type"));
      if (!responseBoundary) {
        throw new Error(`Batch response missing boundary in Content-Type`);
      }

      return parseBatchResponseBody(responseText, responseBoundary, subRequests.length);
    },
    {
      signal: options?.signal,
      shouldRetry: (error) =>
        error instanceof GoogleBatchApiError && isRateLimitApiError(error.status, error.apiError),
    },
  );

const collectRateLimitedIndices = (responses: BatchSubResponse[]): number[] => {
  const indices: number[] = [];
  for (let index = 0; index < responses.length; index++) {
    const response = responses[index];
    if (response && isRateLimitApiError(response.statusCode, parseGoogleApiErrorFromBody(response.body))) {
      indices.push(index);
    }
  }
  return indices;
};

interface BatchChunkedOptions {
  rateLimiter?: RedisRateLimiter;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const retryRateLimitedSubRequests = async (
  subRequests: BatchSubRequest[],
  accessToken: string,
  options?: BatchChunkedOptions,
): Promise<BatchSubResponse[]> => {
  const results: BatchSubResponse[] = Array.from(
    { length: subRequests.length },
    () => unansweredSubResponse(),
  );

  const pending = subRequests.map((request, index) => ({ request, index }));

  for (let attempt = 0; attempt < DEFAULT_MAX_RETRIES; attempt++) {
    if (pending.length === 0) {
      break;
    }

    await abortableSleep(computeDelay(attempt), options?.signal);

    const retryBatch = pending.map((entry) => entry.request);
    const responses = await executeBatch(retryBatch, accessToken, {
      rateLimiter: options?.rateLimiter,
      signal: options?.signal,
      timeoutMs: options?.timeoutMs,
    });

    const stillPending: typeof pending = [];
    for (let responseIndex = 0; responseIndex < pending.length; responseIndex++) {
      const entry = pending[responseIndex];
      if (!entry) {
        continue;
      }
      const response = responses[responseIndex];
      if (response && isRateLimitApiError(response.statusCode, parseGoogleApiErrorFromBody(response.body))) {
        stillPending.push(entry);
      } else if (response) {
        results[entry.index] = response;
      }
    }

    pending.length = 0;
    pending.push(...stillPending);
  }

  for (const entry of pending) {
    /* Every attempt came back rate-limited, so the destination did answer - it just never got
       past its own throttle. */
    results[entry.index] = {
      answer: "answered",
      body: null,
      headers: {},
      statusCode: HTTP_STATUS.TOO_MANY_REQUESTS,
    };
  }

  return results;
};

const executeBatchChunked = async (
  subRequests: BatchSubRequest[],
  accessToken: string,
  options?: BatchChunkedOptions,
): Promise<BatchSubResponse[]> => {
  if (subRequests.length === 0) {
    return [];
  }

  const chunks = chunkArray(subRequests, GOOGLE_BATCH_MAX_SIZE);
  const allResponses: BatchSubResponse[] = [];

  for (const chunk of chunks) {
    const responses = await executeBatch(chunk, accessToken, {
      rateLimiter: options?.rateLimiter,
      signal: options?.signal,
      timeoutMs: options?.timeoutMs,
    });

    const rateLimitedIndices = collectRateLimitedIndices(responses);
    if (rateLimitedIndices.length === 0) {
      allResponses.push(...responses);
      continue;
    }

    const rateLimitedRequests: BatchSubRequest[] = [];
    for (const index of rateLimitedIndices) {
      const request = chunk[index];
      if (!request) {
        throw new Error(`Missing batch sub-request at index ${index}`);
      }
      rateLimitedRequests.push(request);
    }
    const retryResponses = await retryRateLimitedSubRequests(
      rateLimitedRequests,
      accessToken,
      options,
    );

    for (let retryIndex = 0; retryIndex < rateLimitedIndices.length; retryIndex++) {
      const originalIndex = rateLimitedIndices[retryIndex];
      const retryResponse = retryResponses[retryIndex];
      if (typeof originalIndex === "number" && retryResponse) {
        responses[originalIndex] = retryResponse;
      }
    }

    allResponses.push(...responses);
  }

  return allResponses;
};

export {
  buildBatchRequestBody,
  parseBatchResponseBody,
  executeBatch,
  executeBatchChunked,
  extractResponseBoundary,
};
export type { BatchSubRequest, BatchSubResponse };
