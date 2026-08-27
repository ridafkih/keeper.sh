import { afterEach, describe, expect, it, vi } from "vitest";
import { createGoogleSyncProvider } from "../../../../src/providers/google/destination/provider";
import { GOOGLE_BATCH_MAX_SIZE } from "../../../../src/providers/google/shared/api";
import type { EventUpdate } from "../../../../src/core/sync-engine/types";
import type { MaterializedSyncableEvent } from "../../../../src/core/types";

const EXTERNAL_CALENDAR_ID = "primary";
const UPDATE_COUNT = GOOGLE_BATCH_MAX_SIZE + 1;
const LAST_INDEX_OF_FIRST_CHUNK = GOOGLE_BATCH_MAX_SIZE - 1;
const RESPONSE_BOUNDARY = "batch_destination_boundary_synthetic";

const googleEventId = (index: number): string => `googleeventid${index}`;

const buildEvent = (index: number): MaterializedSyncableEvent => ({
  calendarId: "cal-1",
  calendarName: "Test Calendar",
  calendarUrl: null,
  endTime: new Date(Date.UTC(2026, 2, 15, 10 + (index % 8), 0, 0)),
  id: `ev-${index}`,
  sourceEventUid: `uid-ev-${index}`,
  startTime: new Date(Date.UTC(2026, 2, 15, 9 + (index % 8), 0, 0)),
  summary: `Synthetic event ${index}`,
});

const buildUpdates = (): EventUpdate[] =>
  Array.from({ length: UPDATE_COUNT }, (_unused, index) => ({
    deleteId: googleEventId(index),
    event: buildEvent(index),
  }));

interface OutgoingPart {
  contentId: number;
  eventId: string;
  requestBody: Record<string, unknown>;
}

const readBoundary = (contentType: string): string => {
  const match = contentType.match(/boundary=([^\s;]+)/);
  if (!match || !match[1]) {
    throw new Error(`request Content-Type carried no boundary: ${contentType}`);
  }
  return match[1];
};

const parseRequestBody = (segment: string): Record<string, unknown> => {
  const braceIndex = segment.indexOf("{", segment.indexOf("HTTP/1.1"));
  if (braceIndex === -1) {
    return {};
  }
  return JSON.parse(segment.slice(braceIndex).trim()) as Record<string, unknown>;
};

const parseOutgoingParts = (init: RequestInit | undefined): OutgoingPart[] => {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  const boundary = readBoundary(headers["Content-Type"] ?? "");
  const body = String(init?.body ?? "");
  const parts: OutgoingPart[] = [];

  for (const segment of body.split(`--${boundary}`)) {
    const contentIdMatch = segment.match(/Content-ID:\s*<item-(\d+)>/);
    const requestLineMatch = segment.match(/^PUT (\S+) HTTP\/1\.1/m);
    if (!contentIdMatch || !contentIdMatch[1] || !requestLineMatch || !requestLineMatch[1]) {
      continue;
    }
    const pathSegments = requestLineMatch[1].split("/");
    const eventId = pathSegments.at(-1) ?? "";
    parts.push({
      contentId: Number.parseInt(contentIdMatch[1], 10),
      eventId: decodeURIComponent(eventId),
      requestBody: parseRequestBody(segment),
    });
  }

  return parts;
};

const buildEnvelope = (parts: OutgoingPart[]): string => {
  const blocks = parts.map((part) => {
    const resource = {
      ...part.requestBody,
      iCalUID: `${part.eventId}@keeper`,
      id: part.eventId,
    };

    return [
      `--${RESPONSE_BOUNDARY}`,
      "Content-Type: application/http",
      `Content-ID: <response-item-${part.contentId}>`,
      "",
      "HTTP/1.1 200 OK",
      "Content-Type: application/json; charset=UTF-8",
      "",
      JSON.stringify(resource),
      "",
    ].join("\r\n");
  });

  return `${blocks.join("\r\n")}\r\n--${RESPONSE_BOUNDARY}--\r\n`;
};

const envelopeResponse = (parts: OutgoingPart[]): Response =>
  new Response(buildEnvelope(parts), {
    headers: { "Content-Type": `multipart/mixed; boundary=${RESPONSE_BOUNDARY}` },
    status: 200,
  });

const stubFetchOmittingLastPartOfFirstChunk = (): void => {
  let chunkNumber = 0;

  vi.stubGlobal(
    "fetch",
    vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      const outgoing = parseOutgoingParts(init);
      chunkNumber += 1;

      if (chunkNumber === 1) {
        return Promise.resolve(
          envelopeResponse(outgoing.filter((part) => part.contentId !== LAST_INDEX_OF_FIRST_CHUNK)),
        );
      }

      return Promise.resolve(envelopeResponse(outgoing));
    }),
  );
};

const createProvider = (): ReturnType<typeof createGoogleSyncProvider> =>
  createGoogleSyncProvider({
    accessToken: "test-token",
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    calendarId: "dest-cal-1",
    externalCalendarId: EXTERNAL_CALENDAR_ID,
    refreshToken: "test-refresh",
    userId: "user-1",
  });

describe("an update result never carries another event's google identity", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps every result with its own update when a chunk answers short", async () => {
    stubFetchOmittingLastPartOfFirstChunk();

    const updates = buildUpdates();
    const results = await createProvider().updateEvents?.(updates);

    if (!results) {
      throw new Error("the google provider must expose updateEvents");
    }

    expect(results).toHaveLength(updates.length);

    for (let index = 0; index < updates.length; index++) {
      const result = results[index];
      const update = updates[index];
      if (!result || !update) {
        throw new Error(`missing result or update at index ${index}`);
      }
      if (!result.success) {
        continue;
      }
      expect(result.deleteId).toBe(update.deleteId);
    }

    expect(results[LAST_INDEX_OF_FIRST_CHUNK]?.success).toBe(false);
  });
});
