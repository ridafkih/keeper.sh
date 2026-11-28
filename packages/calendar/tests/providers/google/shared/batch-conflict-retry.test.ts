import { afterEach, describe, expect, it, vi } from "vitest";
import { executeBatchChunked } from "../../../../src/providers/google/shared/batch";
import type { BatchConflictCounts, BatchSubRequest } from "../../../../src/providers/google/shared/batch";

const BATCH_URL = "https://www.googleapis.com/batch/calendar/v3";
const EVENTS_PATH = "/calendar/v3/calendars/primary/events";

const CONFLICT_BODY = {
  error: {
    code: 409,
    errors: [{ domain: "global", message: "Conflict", reason: "conflict" }],
    message: "Conflict",
  },
};

interface PartResponse {
  body: unknown;
  status: number;
}

const multipartResponse = (parts: PartResponse[]): Response => {
  const lines: string[] = [];
  for (const [index, part] of parts.entries()) {
    lines.push(
      "--response_boundary",
      "Content-Type: application/http",
      `Content-ID: <response-item-${index}>`,
      "",
      `HTTP/1.1 ${part.status} Status`,
      "Content-Type: application/json",
      "",
      JSON.stringify(part.body),
    );
  }
  lines.push("--response_boundary--");
  return new Response(lines.join("\r\n"), {
    headers: { "Content-Type": "multipart/mixed; boundary=response_boundary" },
    status: 200,
  });
};

const countBatchItems = (body: string): number => body.match(/Content-ID: <item-/g)?.length ?? 0;

const deleteRequest = (eventId: string): BatchSubRequest => ({
  method: "DELETE",
  path: `${EVENTS_PATH}/${eventId}`,
});

interface RecordedCall {
  itemCount?: number;
  method?: string;
  url: string;
}

const stubGoogle = (options: {
  batches: PartResponse[][];
  singles: Record<string, PartResponse>;
}) => {
  const calls: RecordedCall[] = [];
  const pendingBatches = [...options.batches];
  vi.stubGlobal("fetch", vi.fn((input: URL | string, init?: RequestInit) => {
    const url = String(input);
    if (url === BATCH_URL) {
      calls.push({ itemCount: countBatchItems(String(init?.body)), url });
      const parts = pendingBatches.shift();
      if (!parts) {
        throw new Error("Unexpected batch request");
      }
      return Promise.resolve(multipartResponse(parts));
    }
    calls.push({ method: init?.method, url });
    const single = options.singles[new URL(url).pathname];
    if (!single) {
      throw new Error(`Unexpected single request to ${url}`);
    }
    return Promise.resolve(Response.json(single.body, { status: single.status }));
  }));
  return calls;
};

const createConflictCounts = (): BatchConflictCounts => ({
  retriedInBatch: 0,
  retriedIndividually: 0,
  unresolved: 0,
});

describe("executeBatchChunked conflict escalation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries only the conflicted items in a fresh batch", async () => {
    const calls = stubGoogle({
      batches: [
        [{ body: {}, status: 204 }, { body: CONFLICT_BODY, status: 409 }],
        [{ body: {}, status: 204 }],
      ],
      singles: {},
    });
    const conflictCounts = createConflictCounts();

    const responses = await executeBatchChunked(
      [deleteRequest("a"), deleteRequest("b")],
      "access-token",
      { conflictCounts },
    );

    expect(responses.map((response) => response.statusCode)).toEqual([204, 204]);
    expect(calls).toEqual([
      { itemCount: 2, url: BATCH_URL },
      { itemCount: 1, url: BATCH_URL },
    ]);
    expect(conflictCounts).toEqual({ retriedInBatch: 1, retriedIndividually: 0, unresolved: 0 });
  });

  it("falls back to an individual call when the fresh batch conflicts again", async () => {
    const calls = stubGoogle({
      batches: [
        [{ body: CONFLICT_BODY, status: 409 }, { body: {}, status: 204 }],
        [{ body: CONFLICT_BODY, status: 409 }],
      ],
      singles: { [`${EVENTS_PATH}/a`]: { body: {}, status: 204 } },
    });
    const conflictCounts = createConflictCounts();

    const responses = await executeBatchChunked(
      [deleteRequest("a"), deleteRequest("b")],
      "access-token",
      { conflictCounts },
    );

    expect(responses.map((response) => response.statusCode)).toEqual([204, 204]);
    expect(calls.at(-1)).toEqual({ method: "DELETE", url: `https://www.googleapis.com${EVENTS_PATH}/a` });
    expect(conflictCounts).toEqual({ retriedInBatch: 1, retriedIndividually: 1, unresolved: 0 });
  });

  it("returns the conflict with Google's error when the individual call conflicts too", async () => {
    stubGoogle({
      batches: [
        [{ body: CONFLICT_BODY, status: 409 }],
        [{ body: CONFLICT_BODY, status: 409 }],
      ],
      singles: { [`${EVENTS_PATH}/a`]: { body: CONFLICT_BODY, status: 409 } },
    });
    const conflictCounts = createConflictCounts();

    const [response] = await executeBatchChunked([deleteRequest("a")], "access-token", { conflictCounts });

    expect(response?.statusCode).toBe(409);
    expect(response?.body).toEqual(CONFLICT_BODY);
    expect(conflictCounts).toEqual({ retriedInBatch: 1, retriedIndividually: 1, unresolved: 1 });
  });

  it("sends an import's JSON body on the individual call", async () => {
    const importRequest: BatchSubRequest = {
      body: { iCalUID: "copy@keeper.sh", summary: "Standup" },
      headers: { "Content-Type": "application/json" },
      method: "POST",
      path: `${EVENTS_PATH}/import`,
    };
    stubGoogle({
      batches: [[{ body: CONFLICT_BODY, status: 409 }], [{ body: CONFLICT_BODY, status: 409 }]],
      singles: { [`${EVENTS_PATH}/import`]: { body: { id: "google-id" }, status: 200 } },
    });

    const [response] = await executeBatchChunked([importRequest], "access-token");

    const fetchMock = vi.mocked(globalThis.fetch);
    const [, singleInit] = fetchMock.mock.calls.at(-1) ?? [];
    expect(singleInit?.method).toBe("POST");
    expect(JSON.parse(String(singleInit?.body))).toEqual(importRequest.body);
    expect(response).toMatchObject({ body: { id: "google-id" }, statusCode: 200 });
  });

  it("acquires quota for every retry", async () => {
    stubGoogle({
      batches: [[{ body: CONFLICT_BODY, status: 409 }], [{ body: CONFLICT_BODY, status: 409 }]],
      singles: { [`${EVENTS_PATH}/a`]: { body: {}, status: 204 } },
    });
    const acquired: number[] = [];
    const rateLimiter = {
      acquire: (count: number): Promise<void> => {
        acquired.push(count);
        return Promise.resolve();
      },
    };

    await executeBatchChunked([deleteRequest("a")], "access-token", { rateLimiter });

    expect(acquired).toEqual([1, 1, 1]);
  });
});
