import type { RedisRateLimiter } from "../../../core/utils/redis-rate-limiter";
import { GOOGLE_BATCH_API, GOOGLE_BATCH_MAX_SIZE } from "./api";

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
}

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

const parseStatusCode = (statusLine: string): number => {
  const statusMatch = statusLine.match(/HTTP\/[\d.]+ (\d+)/);
  if (statusMatch && statusMatch[1]) {
    return Number.parseInt(statusMatch[1], 10);
  }
  return 0;
};

const parseHttpResponse = (httpBlock: string): { statusCode: number; headers: Record<string, string>; body: unknown } => {
  const lines = httpBlock.split(/\r?\n/);
  const [statusLine] = lines;

  if (!statusLine) {
    return { statusCode: 0, headers: {}, body: null };
  }

  const statusCode = parseStatusCode(statusLine);
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

  return { statusCode, headers, body };
};

const DEFAULT_SEPARATOR_LENGTH = 2;

const parseBatchResponseBody = (responseText: string, boundary: string): BatchSubResponse[] => {
  const parts = responseText.split(`--${boundary}`);
  const results = new Map<number, BatchSubResponse>();
  let maxIndex = -1;

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

    let index = results.size;
    if (contentIndex !== null) {
      index = contentIndex;
    }

    results.set(index, {
      statusCode: parsed.statusCode,
      headers: parsed.headers,
      body: parsed.body,
    });

    if (index > maxIndex) {
      maxIndex = index;
    }
  }

  const ordered: BatchSubResponse[] = [];
  for (let index = 0; index <= maxIndex; index++) {
    const entry = results.get(index);
    if (entry) {
      ordered.push(entry);
    } else {
      ordered.push({ statusCode: 0, headers: {}, body: null });
    }
  }

  return ordered;
};

const extractResponseBoundary = (contentType: string | null): string | null => {
  if (!contentType) {
    return null;
  }

  const match = contentType.match(/boundary=([^\s;]+)/);
  if (!match || !match[1]) {
    return null;
  }

  return match[1];
};

const executeBatch = async (
  subRequests: BatchSubRequest[],
  accessToken: string,
): Promise<BatchSubResponse[]> => {
  const boundary = generateBoundary();
  const requestBody = buildBatchRequestBody(subRequests, boundary);

  const response = await fetch(GOOGLE_BATCH_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/mixed; boundary=${boundary}`,
    },
    body: requestBody,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Google Batch API ${response.status}: ${errorBody}`);
  }

  const responseText = await response.text();

  const responseBoundary = extractResponseBoundary(response.headers.get("Content-Type"));
  if (!responseBoundary) {
    throw new Error(`Batch response missing boundary in Content-Type`);
  }

  return parseBatchResponseBody(responseText, responseBoundary);
};

const chunkArray = <TItem>(items: TItem[], size: number): TItem[][] => {
  const chunks: TItem[][] = [];
  for (let offset = 0; offset < items.length; offset += size) {
    chunks.push(items.slice(offset, offset + size));
  }
  return chunks;
};

const executeBatchChunked = async (
  subRequests: BatchSubRequest[],
  accessToken: string,
  rateLimiter?: RedisRateLimiter,
): Promise<BatchSubResponse[]> => {
  if (subRequests.length === 0) {
    return [];
  }

  const chunks = chunkArray(subRequests, GOOGLE_BATCH_MAX_SIZE);
  const allResponses: BatchSubResponse[] = [];

  for (const chunk of chunks) {
    if (rateLimiter) {
      await rateLimiter.acquire(chunk.length);
    }
    const responses = await executeBatch(chunk, accessToken);
    allResponses.push(...responses);
  }

  return allResponses;
};

export {
  buildBatchRequestBody,
  parseBatchResponseBody,
  executeBatch,
  executeBatchChunked,
  chunkArray,
  extractResponseBoundary,
};
export type { BatchSubRequest, BatchSubResponse };
