interface GraphSubResponse {
  body?: unknown;
  headers?: Record<string, string>;
  id?: string;
  status: number;
}

interface GraphSubRequest {
  body?: unknown;
  headers?: Record<string, string>;
  id: string;
  method: string;
  url: string;
}

const graphBatchReply = (...subResponses: GraphSubResponse[]): Response =>
  Response.json({
    responses: subResponses.map((subResponse, index) => ({
      headers: {},
      id: String(index),
      ...subResponse,
    })),
  });

const throttledSubResponse = (status: number, retryAfter: string): GraphSubResponse => ({
  body: { error: { code: "ApplicationThrottled", message: "Application is over its MailboxConcurrency limit." } },
  headers: { "Retry-After": retryAfter },
  status,
});

interface RecordedFetch {
  mock: { calls: unknown[][] };
}

const readBatchRequests = (fetchMock: RecordedFetch, callIndex: number): GraphSubRequest[] => {
  const [, init] = fetchMock.mock.calls[callIndex] as [unknown, RequestInit];
  const payload = JSON.parse(String(init.body)) as { requests: GraphSubRequest[] };
  return payload.requests;
};

export { graphBatchReply, readBatchRequests, throttledSubResponse };
export type { GraphSubRequest, GraphSubResponse };
