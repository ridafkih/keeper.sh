import type { RedisRateLimiter } from "./redis-rate-limiter";

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

interface BatchExecutor {
  execute: (subRequests: BatchSubRequest[], accessToken: string) => Promise<BatchSubResponse[]>;
  maxBatchSize: number;
}

const chunkArray = <TItem>(items: TItem[], size: number): TItem[][] => {
  const chunks: TItem[][] = [];
  for (let offset = 0; offset < items.length; offset += size) {
    chunks.push(items.slice(offset, offset + size));
  }
  return chunks;
};

const executeBatchChunked = async (
  executor: BatchExecutor,
  subRequests: BatchSubRequest[],
  accessToken: string,
  rateLimiter?: RedisRateLimiter,
): Promise<BatchSubResponse[]> => {
  if (subRequests.length === 0) {
    return [];
  }

  const chunks = chunkArray(subRequests, executor.maxBatchSize);
  const allResponses: BatchSubResponse[] = [];

  for (const chunk of chunks) {
    if (rateLimiter) {
      await rateLimiter.acquire(chunk.length);
    }
    const responses = await executor.execute(chunk, accessToken);
    allResponses.push(...responses);
  }

  return allResponses;
};

export { executeBatchChunked, chunkArray };
export type { BatchSubRequest, BatchSubResponse, BatchExecutor };
