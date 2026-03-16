import type { BatchExecutor, BatchSubRequest, BatchSubResponse } from "../../../core/utils/batch";

const MICROSOFT_BATCH_API = "https://graph.microsoft.com/v1.0/$batch";
const OUTLOOK_BATCH_MAX_SIZE = 20;

interface GraphBatchRequest {
  id: string;
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}

interface GraphBatchResponse {
  id: string;
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

interface GraphBatchResult {
  responses: GraphBatchResponse[];
}

const buildBatchPayload = (subRequests: BatchSubRequest[]): { requests: GraphBatchRequest[] } => ({
  requests: subRequests.map((subRequest, index) => {
    const request: GraphBatchRequest = {
      id: String(index),
      method: subRequest.method,
      url: subRequest.path,
    };

    if (subRequest.headers) {
      request.headers = subRequest.headers;
    }

    if ("body" in subRequest && subRequest.body !== null) {
      request.body = subRequest.body;
      if (!request.headers) {
        request.headers = {};
      }
      request.headers["Content-Type"] = "application/json";
    }

    return request;
  }),
});

const parseBatchResponse = (result: GraphBatchResult, requestCount: number): BatchSubResponse[] => {
  const responseMap = new Map<number, BatchSubResponse>();

  for (const response of result.responses) {
    const index = Number.parseInt(response.id, 10);
    responseMap.set(index, {
      statusCode: response.status,
      headers: response.headers ?? {},
      body: response.body ?? null,
    });
  }

  const ordered: BatchSubResponse[] = [];
  for (let index = 0; index < requestCount; index++) {
    const entry = responseMap.get(index);
    if (entry) {
      ordered.push(entry);
    } else {
      ordered.push({ statusCode: 0, headers: {}, body: null });
    }
  }

  return ordered;
};

const executeBatch = async (
  subRequests: BatchSubRequest[],
  accessToken: string,
): Promise<BatchSubResponse[]> => {
  const payload = buildBatchPayload(subRequests);

  const response = await fetch(MICROSOFT_BATCH_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Microsoft Graph Batch API ${response.status}: ${errorBody}`);
  }

  const result = await response.json() as GraphBatchResult;
  return parseBatchResponse(result, subRequests.length);
};

const createOutlookBatchExecutor = (): BatchExecutor => ({
  execute: executeBatch,
  maxBatchSize: OUTLOOK_BATCH_MAX_SIZE,
});

export { createOutlookBatchExecutor, executeBatch, buildBatchPayload, parseBatchResponse, MICROSOFT_BATCH_API, OUTLOOK_BATCH_MAX_SIZE };
export type { GraphBatchRequest, GraphBatchResponse, GraphBatchResult };
