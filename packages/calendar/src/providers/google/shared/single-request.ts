import { PROVIDER_PUSH_REQUEST_TIMEOUT_MS } from "@keeper.sh/constants";
import type { RedisRateLimiter } from "../../../core/utils/redis-rate-limiter";
import { fetchWithTimeout } from "../../../core/utils/fetch-with-timeout";
import { withBackoff } from "../../../core/utils/backoff";
import { GOOGLE_API_ORIGIN } from "./api";
import { GoogleCalendarApiError, isRateLimitApiError, parseGoogleApiErrorFromBody } from "./errors";
import type { BatchSubRequest, BatchSubResponse } from "./batch";

interface SingleRequestOptions {
  rateLimiter?: RedisRateLimiter;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const parseSingleResponseBody = (text: string): unknown => {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
};

const buildSingleRequestInit = (subRequest: BatchSubRequest, accessToken: string): RequestInit => {
  const headers: Record<string, string> = {
    ...subRequest.headers,
    Authorization: `Bearer ${accessToken}`,
  };
  if (!("body" in subRequest) || subRequest.body === null) {
    return { headers, method: subRequest.method };
  }
  return {
    body: JSON.stringify(subRequest.body),
    headers: { ...headers, "Content-Type": "application/json" },
    method: subRequest.method,
  };
};

const collectResponseHeaders = (response: Response): Record<string, string> => {
  const headers: Record<string, string> = {};
  for (const [key, value] of response.headers) {
    headers[key.toLowerCase()] = value;
  }
  return headers;
};

const executeSingleRequest = (
  subRequest: BatchSubRequest,
  accessToken: string,
  options?: SingleRequestOptions,
): Promise<BatchSubResponse> =>
  withBackoff(
    async () => {
      if (options?.rateLimiter) {
        await options.rateLimiter.acquire(1, options.signal);
      }

      const response = await fetchWithTimeout(
        new URL(subRequest.path, GOOGLE_API_ORIGIN),
        buildSingleRequestInit(subRequest, accessToken),
        options?.timeoutMs ?? PROVIDER_PUSH_REQUEST_TIMEOUT_MS,
        options?.signal,
      );

      const responseText = await response.text();
      const body = parseSingleResponseBody(responseText);
      if (isRateLimitApiError(response.status, parseGoogleApiErrorFromBody(body))) {
        throw new GoogleCalendarApiError(response.status, responseText);
      }

      return { body, headers: collectResponseHeaders(response), statusCode: response.status };
    },
    {
      signal: options?.signal,
      shouldRetry: (error) =>
        error instanceof GoogleCalendarApiError && isRateLimitApiError(error.status, error.apiError),
    },
  );

export { executeSingleRequest };
export type { SingleRequestOptions };
