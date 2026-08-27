import { afterEach, describe, expect, it, vi } from "vitest";
import { executeBatchChunked } from "../../../../src/providers/google/shared/batch";
import type { BatchSubRequest, BatchSubResponse } from "../../../../src/providers/google/shared/batch";
import { GOOGLE_BATCH_MAX_SIZE } from "../../../../src/providers/google/shared/api";

const SUB_REQUEST_COUNT = GOOGLE_BATCH_MAX_SIZE + 1;
const TAIL_INDEX = GOOGLE_BATCH_MAX_SIZE;
const LAST_INDEX_OF_FIRST_CHUNK = GOOGLE_BATCH_MAX_SIZE - 1;
const MIDDLE_INDEX_OF_FIRST_CHUNK = 10;

const eventPath = (index: number): string =>
  `/calendar/v3/calendars/primary/events/subrequestevent${index}`;

const buildSubRequests = (): BatchSubRequest[] =>
  Array.from({ length: SUB_REQUEST_COUNT }, (_unused, index) => ({
    method: "GET",
    path: eventPath(index),
  }));

interface OutgoingPart {
  contentId: number;
  path: string;
}

const readBoundary = (contentType: string): string => {
  const match = contentType.match(/boundary=([^\s;]+)/);
  if (!match || !match[1]) {
    throw new Error(`request Content-Type carried no boundary: ${contentType}`);
  }
  return match[1];
};

const parseOutgoingParts = (init: RequestInit | undefined): OutgoingPart[] => {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  const boundary = readBoundary(headers["Content-Type"] ?? "");
  const body = String(init?.body ?? "");
  const parts: OutgoingPart[] = [];

  for (const segment of body.split(`--${boundary}`)) {
    const contentIdMatch = segment.match(/Content-ID:\s*<item-(\d+)>/);
    const requestLineMatch = segment.match(/^(?:GET|POST|PUT|DELETE) (\S+) HTTP\/1\.1/m);
    if (!contentIdMatch || !contentIdMatch[1] || !requestLineMatch || !requestLineMatch[1]) {
      continue;
    }
    parts.push({ contentId: Number.parseInt(contentIdMatch[1], 10), path: requestLineMatch[1] });
  }

  return parts;
};

interface ResponsePart {
  contentId: number;
  path: string;
}

const RESPONSE_BOUNDARY = "batch_response_boundary_synthetic";

const buildEnvelope = (parts: ResponsePart[]): string => {
  const blocks = parts.map((part) =>
    [
      `--${RESPONSE_BOUNDARY}`,
      "Content-Type: application/http",
      `Content-ID: <response-item-${part.contentId}>`,
      "",
      "HTTP/1.1 200 OK",
      "Content-Type: application/json; charset=UTF-8",
      "",
      JSON.stringify({ path: part.path }),
      "",
    ].join("\r\n"),
  );

  return `${blocks.join("\r\n")}\r\n--${RESPONSE_BOUNDARY}--\r\n`;
};

const envelopeResponse = (parts: ResponsePart[]): Response =>
  new Response(buildEnvelope(parts), {
    headers: { "Content-Type": `multipart/mixed; boundary=${RESPONSE_BOUNDARY}` },
    status: 200,
  });

type FirstChunkDistortion = (parts: OutgoingPart[]) => ResponsePart[];

const stubFetchWithDistortedFirstChunk = (distort: FirstChunkDistortion): void => {
  let chunkNumber = 0;

  vi.stubGlobal(
    "fetch",
    vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      const outgoing = parseOutgoingParts(init);
      chunkNumber += 1;

      if (chunkNumber === 1) {
        return Promise.resolve(envelopeResponse(distort(outgoing)));
      }

      return Promise.resolve(
        envelopeResponse(outgoing.map((part) => ({ contentId: part.contentId, path: part.path }))),
      );
    }),
  );
};

const answeredPath = (response: BatchSubResponse | undefined): string | null => {
  if (!response || typeof response.body !== "object" || response.body === null) {
    return null;
  }
  if (!("path" in response.body) || typeof response.body.path !== "string") {
    return null;
  }
  return response.body.path;
};

const runChunkedBatch = (): Promise<BatchSubResponse[]> =>
  executeBatchChunked(buildSubRequests(), "test-access-token");

describe("google batch responses stay positional per chunk", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps the tail chunk in place when the first chunk omits its last part", async () => {
    stubFetchWithDistortedFirstChunk((parts) =>
      parts
        .filter((part) => part.contentId !== LAST_INDEX_OF_FIRST_CHUNK)
        .map((part) => ({ contentId: part.contentId, path: part.path })),
    );

    const subRequests = buildSubRequests();
    const responses = await runChunkedBatch();

    expect(responses).toHaveLength(subRequests.length);
    expect(responses[LAST_INDEX_OF_FIRST_CHUNK]?.answer).toBe("unanswered");
    expect(responses[LAST_INDEX_OF_FIRST_CHUNK]?.statusCode).toBe(0);

    for (let index = 0; index < subRequests.length; index++) {
      const path = answeredPath(responses[index]);
      if (path === null) {
        continue;
      }
      expect(path).toBe(subRequests[index]?.path);
    }
  });

  it("keeps the tail chunk in place when the first chunk renumbers its content ids", async () => {
    stubFetchWithDistortedFirstChunk((parts) =>
      parts.map((part) => ({ contentId: part.contentId + 1, path: part.path })),
    );

    const subRequests = buildSubRequests();
    const responses = await runChunkedBatch();

    expect(responses).toHaveLength(subRequests.length);
    expect(answeredPath(responses[TAIL_INDEX])).toBe(subRequests[TAIL_INDEX]?.path);
    expect(responses[0]?.answer).toBe("unanswered");
  });

  it("still returns an unanswered hole when the first chunk drops a middle part", async () => {
    stubFetchWithDistortedFirstChunk((parts) =>
      parts
        .filter((part) => part.contentId !== MIDDLE_INDEX_OF_FIRST_CHUNK)
        .map((part) => ({ contentId: part.contentId, path: part.path })),
    );

    const subRequests = buildSubRequests();
    const responses = await runChunkedBatch();

    expect(responses).toHaveLength(subRequests.length);
    expect(responses[MIDDLE_INDEX_OF_FIRST_CHUNK]?.answer).toBe("unanswered");

    for (let index = 0; index < subRequests.length; index++) {
      const path = answeredPath(responses[index]);
      if (path === null) {
        continue;
      }
      expect(path).toBe(subRequests[index]?.path);
    }
  });
});
