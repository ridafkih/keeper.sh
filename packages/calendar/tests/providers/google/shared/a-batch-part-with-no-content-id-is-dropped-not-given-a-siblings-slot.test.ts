import { afterEach, describe, expect, it } from "vitest";
import { parseBatchResponseBody } from "../../../../src/providers/google/shared/batch";
import { createGoogleSyncProvider } from "../../../../src/providers/google/destination/provider";
import { generateDeterministicEventUid } from "../../../../src/core/events/identity";
import type { CalendarSyncProvider } from "../../../../src/core/sync-engine/types";
import type { RemoteEvent } from "../../../../src/core/types";

const appendBody = (lines: string[], body: unknown): string => {
  if (body === null) {
    lines.push("");
    return lines.join("\r\n");
  }
  lines.push("Content-Type: application/json");
  lines.push("");
  lines.push(JSON.stringify(body));
  return lines.join("\r\n");
};

const RESPONSE_BOUNDARY = "batch_synthetic_boundary";
const EXTERNAL_CALENDAR_ID = "primary";
const START_TIME = "2026-03-15T09:00:00.000Z";
const END_TIME = "2026-03-15T10:00:00.000Z";

const cidBearingPart = (contentId: string, statusLine: string, body: unknown): string => {
  const lines = ["Content-Type: application/http", `Content-ID: <${contentId}>`, "", statusLine];
  return appendBody(lines, body);
};

const cidLessPart = (statusLine: string, body: unknown): string => {
  const lines = ["Content-Type: application/http", "", statusLine];
  return appendBody(lines, body);
};

const envelopeOf = (parts: string[]): string => {
  const chunks = parts.map((part) => `--${RESPONSE_BOUNDARY}\r\n${part}`);
  chunks.push(`--${RESPONSE_BOUNDARY}--\r\n`);
  return chunks.join("\r\n");
};

describe("a batch part with no Content-ID is dropped, not given a sibling's slot", () => {
  it("keeps the CID-bearing sibling's answer when a CID-less part follows it", () => {
    const responseText = envelopeOf([
      cidBearingPart("response-item-1", "HTTP/1.1 200 OK", { id: "EVENT-ONE" }),
      cidLessPart("HTTP/1.1 404 Not Found", { error: { code: 404, message: "Not Found" } }),
    ]);

    const results = parseBatchResponseBody(responseText, RESPONSE_BOUNDARY);

    expect(results).toHaveLength(2);
    expect(results[0]?.answer).toBe("unanswered");
    expect(results[0]?.statusCode).toBe(0);
    expect(results[1]?.statusCode).toBe(200);
    expect(results[1]?.body).toEqual({ id: "EVENT-ONE" });
  });

  it("keeps the CID-bearing sibling's answer under the bounded call production makes", () => {
    const responseText = envelopeOf([
      cidBearingPart("response-item-1", "HTTP/1.1 200 OK", { id: "EVENT-ONE" }),
      cidLessPart("HTTP/1.1 404 Not Found", { error: { code: 404, message: "Not Found" } }),
    ]);

    const results = parseBatchResponseBody(responseText, RESPONSE_BOUNDARY, 2);

    expect(results).toHaveLength(2);
    expect(results[0]?.answer).toBe("unanswered");
    expect(results[0]?.statusCode).toBe(0);
    expect(results[1]?.statusCode).toBe(200);
    expect(results[1]?.body).toEqual({ id: "EVENT-ONE" });
  });

  it("keeps the CID-bearing sibling's answer when the CID-less part comes first", () => {
    const responseText = envelopeOf([
      cidLessPart("HTTP/1.1 404 Not Found", { error: { code: 404, message: "Not Found" } }),
      cidBearingPart("response-item-0", "HTTP/1.1 200 OK", { id: "EVENT-ONE" }),
    ]);

    const results = parseBatchResponseBody(responseText, RESPONSE_BOUNDARY, 2);

    expect(results).toHaveLength(2);
    expect(results[0]?.statusCode).toBe(200);
    expect(results[0]?.body).toEqual({ id: "EVENT-ONE" });
    expect(results[1]?.answer).toBe("unanswered");
    expect(results[1]?.statusCode).toBe(0);
  });
});

const FIRST_EVENT_ID = "googleeventidfirst111";
const SECOND_EVENT_ID = "googleeventidsecond11";
const SECOND_UID = generateDeterministicEventUid(`event-state-id-second:${EXTERNAL_CALENDAR_ID}`);

interface EventPresence {
  event?: RemoteEvent;
  identifier: string;
  status: "absent" | "present" | "unknown";
}

const googleResource = (eventId: string, uid: string): Record<string, unknown> => ({
  end: { dateTime: END_TIME },
  iCalUID: uid,
  id: eventId,
  start: { dateTime: START_TIME },
  summary: "Weekly planning",
});

const createProvider = (): CalendarSyncProvider => createGoogleSyncProvider({
  accessToken: "test-token",
  accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
  calendarId: "destination-calendar-id",
  externalCalendarId: EXTERNAL_CALENDAR_ID,
  refreshToken: "test-refresh",
  userId: "user-1",
});

const verificationOf = (provider: CalendarSyncProvider) => {
  if (!provider.verifyEventsExist) {
    throw new Error("Google destination provider does not implement verifyEventsExist");
  }
  return provider.verifyEventsExist as unknown as (identifiers: string[]) => Promise<EventPresence[]>;
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Google verification over a batch whose second part lost its Content-ID", () => {
  it("leaves the unattributable part answering nobody and keeps the answered identifier's own verdict", async () => {
    const responseText = envelopeOf([
      cidBearingPart(
        "response-item-1",
        "HTTP/1.1 200 OK",
        googleResource(SECOND_EVENT_ID, SECOND_UID),
      ),
      cidLessPart("HTTP/1.1 404 Not Found", { error: { code: 404, message: "Not Found" } }),
    ]);

    globalThis.fetch = (() =>
      Promise.resolve(new Response(responseText, {
        headers: { "Content-Type": `multipart/mixed; boundary=${RESPONSE_BOUNDARY}` },
        status: 200,
      }))) as unknown as typeof globalThis.fetch;

    const verify = verificationOf(createProvider());
    const presences = await verify([FIRST_EVENT_ID, SECOND_EVENT_ID]);

    expect(presences).toEqual([
      { identifier: FIRST_EVENT_ID, status: "unknown" },
      {
        event: expect.objectContaining({ deleteId: SECOND_EVENT_ID, uid: SECOND_UID }),
        identifier: SECOND_EVENT_ID,
        status: "present",
      },
    ]);
  });
});
