import { describe, expect, it } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { createGoogleSyncProvider } from "../../../src/providers/google/destination/provider";
import {
  extractResponseBoundary,
  parseBatchResponseBody,
} from "../../../src/providers/google/shared/batch";
import { generateDeterministicEventUid } from "../../../src/core/events/identity";
import type { MaterializedSyncableEvent, SyncOperation } from "../../../src/core/types";
import type { EventMapping } from "../../../src/core/events/mappings";

const DESTINATION_CALENDAR_ID = "dest-cal-1";
const EXTERNAL_CALENDAR_ID = "primary";
const CYCLES = 3;
const RESPONSE_BOUNDARY = "batch_synthetic_boundary";
const BATCH_URL = "https://www.googleapis.com/batch/calendar/v3";

const QUOTED_CONTENT_TYPE = `multipart/mixed; boundary="${RESPONSE_BOUNDARY}"`;
const UNQUOTED_CONTENT_TYPE = `multipart/mixed; boundary=${RESPONSE_BOUNDARY}`;

const movedMeeting: MaterializedSyncableEvent = {
  calendarId: "source-calendar-id",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2026-03-15T10:00:00.000Z"),
  id: "ev-1",
  sourceEventUid: "source-event-uid-1",
  startTime: new Date("2026-03-15T09:00:00.000Z"),
  summary: "Weekly standup, moved",
};

const secondMeeting: MaterializedSyncableEvent = {
  ...movedMeeting,
  id: "ev-2",
  sourceEventUid: "source-event-uid-2",
  summary: "Design review, moved",
};

const mirroredEvents = [movedMeeting, secondMeeting];

const googleEventIdFor = (index: number): string => `google-event-id-${index}`;

const keeperUidFor = (event: MaterializedSyncableEvent): string =>
  generateDeterministicEventUid(`${event.id}:${EXTERNAL_CALENDAR_ID}`);

const makeMapping = (index: number): EventMapping => {
  const event = mirroredEvents[index];
  if (!event) {
    throw new Error(`No mirrored event at index ${index}`);
  }
  return {
    calendarId: DESTINATION_CALENDAR_ID,
    deleteIdentifier: googleEventIdFor(index),
    destinationEventUid: keeperUidFor(event),
    endTime: event.endTime,
    eventStateId: event.id,
    id: `map-${index}`,
    sourceCalendarId: "source-calendar-id",
    startTime: event.startTime,
    syncEventHash: "stale-hash",
    syncEventId: event.id,
  };
};

const makeReplacement = (mapping: EventMapping, index: number): Extract<SyncOperation, { type: "replace" }> => {
  const event = mirroredEvents[index];
  if (!event) {
    throw new Error(`No mirrored event at index ${index}`);
  }
  return {
    deleteId: mapping.deleteIdentifier,
    event,
    staleMappingId: mapping.id,
    type: "replace",
    uid: mapping.destinationEventUid,
  };
};

interface WireSubRequest {
  method: string;
  path: string;
}

interface ParsedSubRequest extends WireSubRequest {
  index: number;
  body: Record<string, unknown> | null;
}

const parseJsonBody = (raw: string): Record<string, unknown> | null => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  return JSON.parse(trimmed) as Record<string, unknown>;
};

const parseSubRequestIndex = (headerBlock: string): number | null => {
  const match = headerBlock.match(/Content-ID:\s*<item-(\d+)>/i);
  if (!match || !match[1]) {
    return null;
  }
  return Number.parseInt(match[1], 10);
};

const parseSubRequest = (part: string): ParsedSubRequest | null => {
  const trimmed = part.trim();
  if (!trimmed || trimmed === "--") {
    return null;
  }

  const [mimeHeaders, ...rest] = trimmed.split(/\r?\n\r?\n/);
  if (!mimeHeaders || rest.length === 0) {
    return null;
  }

  const index = parseSubRequestIndex(mimeHeaders);
  if (index === null) {
    return null;
  }

  const httpBlock = rest[0] ?? "";
  const [requestLine] = httpBlock.split(/\r?\n/);
  const requestMatch = requestLine?.match(/^([A-Z]+) (\S+) HTTP\/1\.1$/);
  if (!requestMatch || !requestMatch[1] || !requestMatch[2]) {
    return null;
  }

  return {
    body: parseJsonBody(rest.slice(1).join("\r\n\r\n")),
    index,
    method: requestMatch[1],
    path: requestMatch[2],
  };
};

const requestBoundaryOf = (init: RequestInit | undefined): string => {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  const contentType = headers["Content-Type"] ?? "";
  const match = contentType.match(/boundary=(.+)$/);
  if (!match || !match[1]) {
    throw new Error(`Batch request carried no boundary: ${contentType}`);
  }
  return match[1];
};

const parseBatchRequest = (init: RequestInit | undefined): ParsedSubRequest[] => {
  const boundary = requestBoundaryOf(init);
  const body = String(init?.body ?? "");
  const parsed: ParsedSubRequest[] = [];
  for (const part of body.split(`--${boundary}`)) {
    const subRequest = parseSubRequest(part);
    if (subRequest) {
      parsed.push(subRequest);
    }
  }
  return parsed;
};

interface ResponsePart {
  statusLine: string;
  body: Record<string, unknown> | null;
}

const buildResponsePart = (index: number, part: ResponsePart): string => {
  const lines = [
    "Content-Type: application/http",
    `Content-ID: <response-item-${index}>`,
    "",
    part.statusLine,
  ];

  if (part.body === null) {
    lines.push("");
    return lines.join("\r\n");
  }

  lines.push("Content-Type: application/json");
  lines.push("");
  lines.push(JSON.stringify(part.body));
  return lines.join("\r\n");
};

const buildBatchResponseBody = (parts: ResponsePart[]): string => {
  const chunks: string[] = [];
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (!part) {
      continue;
    }
    chunks.push(`--${RESPONSE_BOUNDARY}\r\n${buildResponsePart(index, part)}`);
  }
  chunks.push(`--${RESPONSE_BOUNDARY}--\r\n`);
  return chunks.join("\r\n");
};

const eventIdFromPath = (path: string): string => {
  const [withoutQuery] = path.split("?");
  const segments = (withoutQuery ?? "").split("/");
  return decodeURIComponent(segments.at(-1) ?? "");
};

const createAppliedGoogle = (): {
  respond: (requests: ParsedSubRequest[]) => ResponsePart[];
  store: Map<string, Record<string, unknown>>;
} => {
  const store = new Map<string, Record<string, unknown>>();

  for (let index = 0; index < mirroredEvents.length; index++) {
    const event = mirroredEvents[index];
    if (!event) {
      continue;
    }
    store.set(googleEventIdFor(index), {
      end: { dateTime: event.endTime.toISOString() },
      iCalUID: keeperUidFor(event),
      id: googleEventIdFor(index),
      start: { dateTime: event.startTime.toISOString() },
      summary: event.summary,
    });
  }

  let importedCount = 0;

  const applyUpdate = (request: ParsedSubRequest): ResponsePart => {
    const eventId = eventIdFromPath(request.path);
    const existing = store.get(eventId);
    const applied = {
      ...request.body,
      iCalUID: existing?.["iCalUID"] ?? keeperUidFor(movedMeeting),
      id: eventId,
    };
    store.set(eventId, applied);
    return { body: applied, statusLine: "HTTP/1.1 200 OK" };
  };

  const applyImport = (request: ParsedSubRequest): ResponsePart => {
    importedCount++;
    const eventId = `google-imported-${importedCount}`;
    const applied = { ...request.body, id: eventId };
    store.set(eventId, applied);
    return { body: applied, statusLine: "HTTP/1.1 200 OK" };
  };

  const applyDelete = (request: ParsedSubRequest): ResponsePart => {
    store.delete(eventIdFromPath(request.path));
    return { body: null, statusLine: "HTTP/1.1 204 No Content" };
  };

  const applyRead = (request: ParsedSubRequest): ResponsePart => {
    const found = store.get(eventIdFromPath(request.path));
    if (!found) {
      return { body: { error: { code: 404, message: "Not Found" } }, statusLine: "HTTP/1.1 404 Not Found" };
    }
    return { body: found, statusLine: "HTTP/1.1 200 OK" };
  };

  const applyOne = (request: ParsedSubRequest): ResponsePart => {
    if (request.method === "PUT") {
      return applyUpdate(request);
    }
    if (request.method === "POST") {
      return applyImport(request);
    }
    if (request.method === "DELETE") {
      return applyDelete(request);
    }
    return applyRead(request);
  };

  const respond = (requests: ParsedSubRequest[]): ResponsePart[] => requests.map((request) => applyOne(request));

  return { respond, store };
};

const stubBatchFetch = (
  contentTypeHeader: string,
  wire: WireSubRequest[],
): (() => void) => {
  const originalFetch = globalThis.fetch;
  const google = createAppliedGoogle();

  globalThis.fetch = ((input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith(BATCH_URL)) {
      throw new Error(`Unexpected non-batch request to ${url}`);
    }

    const requests = parseBatchRequest(init);
    for (const request of requests) {
      wire.push({ method: request.method, path: request.path });
    }

    return Promise.resolve(new Response(buildBatchResponseBody(google.respond(requests)), {
      headers: { "Content-Type": contentTypeHeader },
      status: 200,
    }));
  }) as typeof globalThis.fetch;

  return () => {
    globalThis.fetch = originalFetch;
  };
};

interface CycleRun {
  wire: WireSubRequest[];
  carriedFailureCounters: number[];
  deletedMappingIds: string[];
  errors: string[];
  updateFallbacks: number;
}

const runCycles = async (contentTypeHeader: string): Promise<CycleRun> => {
  const wire: WireSubRequest[] = [];
  const carriedFailureCounters: number[] = [];
  const deletedMappingIds: string[] = [];
  const errors: string[] = [];
  let updateFallbacks = 0;

  const provider = createGoogleSyncProvider({
    accessToken: "test-token",
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    calendarId: DESTINATION_CALENDAR_ID,
    externalCalendarId: EXTERNAL_CALENDAR_ID,
    refreshToken: "test-refresh",
    userId: "user-1",
  });

  let mappings: EventMapping[] = [makeMapping(0), makeMapping(1)];

  const restoreFetch = stubBatchFetch(contentTypeHeader, wire);
  try {
    for (let cycle = 0; cycle < CYCLES; cycle++) {
      const operations = mappings.map((mapping, index) => makeReplacement(mapping, index));
      const outcome = await executeRemoteOperations(
        operations,
        mappings,
        DESTINATION_CALENDAR_ID,
        provider,
      );

      updateFallbacks += outcome.updateFallbacks;
      deletedMappingIds.push(...outcome.changes.deletes);
      for (const error of outcome.errors) {
        errors.push(error.error);
      }

      const carriedById = new Map(
        (outcome.changes.updates ?? []).map((update) => [update.id, update]),
      );
      const nextMappings: EventMapping[] = [];
      for (const mapping of mappings) {
        const carried = carriedById.get(mapping.id);
        if (!carried) {
          nextMappings.push(mapping);
          continue;
        }
        if (typeof carried.consecutiveUpdateFailures === "number") {
          carriedFailureCounters.push(carried.consecutiveUpdateFailures);
        }
        nextMappings.push({ ...mapping, ...carried, id: mapping.id } as EventMapping);
      }
      mappings = nextMappings;
    }
  } finally {
    restoreFetch();
  }

  return { carriedFailureCounters, deletedMappingIds, errors, updateFallbacks, wire };
};

const deleteSubRequests = (wire: WireSubRequest[]): WireSubRequest[] =>
  wire.filter((request) => request.method === "DELETE");

const boundarySpellings = [
  { header: UNQUOTED_CONTENT_TYPE, label: "an unquoted boundary" },
  { header: QUOTED_CONTENT_TYPE, label: "a quoted boundary" },
];

describe("a quoted multipart boundary is parsed, not collapsed", () => {
  for (const spelling of boundarySpellings) {
    it(`never deletes a customer's google event over three cycles under ${spelling.label}`, async () => {
      const run = await runCycles(spelling.header);

      expect(deleteSubRequests(run.wire)).toEqual([]);
      expect(run.deletedMappingIds).toEqual([]);
      expect(run.errors).toEqual([]);
      expect(run.updateFallbacks).toBe(0);
    });

    it(`reports every update applied and accumulates no failure evidence under ${spelling.label}`, async () => {
      const run = await runCycles(spelling.header);

      const updateRequests = run.wire.filter((request) => request.method === "PUT");
      expect(updateRequests).toHaveLength(mirroredEvents.length * CYCLES);
      expect(run.wire.every((request) => request.method === "PUT")).toBe(true);

      for (const counter of run.carriedFailureCounters) {
        expect(counter).toBe(0);
      }
    });
  }
});

describe("extractResponseBoundary reads the RFC 2046 quoted parameter", () => {
  const quotedForms = [
    { header: `multipart/mixed; boundary="batch_x"`, label: "quoted" },
    { header: `multipart/mixed;  boundary="batch_x"  `, label: "quoted with surrounding whitespace" },
    { header: `multipart/mixed; boundary="batch_x";`, label: "quoted with a trailing semicolon" },
    { header: `multipart/mixed; boundary=batch_x`, label: "unquoted" },
  ];

  for (const form of quotedForms) {
    it(`yields the bare boundary for a ${form.label} parameter`, () => {
      expect(extractResponseBoundary(form.header)).toBe("batch_x");
    });
  }

  it("splits a real envelope announced with a quoted boundary at every index", () => {
    const parts = [
      { body: { id: "google-event-id-0" }, statusLine: "HTTP/1.1 200 OK" },
      { body: { id: "google-event-id-1" }, statusLine: "HTTP/1.1 200 OK" },
    ];
    const responseText = buildBatchResponseBody(parts)
      .replaceAll(RESPONSE_BOUNDARY, "batch_x");

    const boundary = extractResponseBoundary(`multipart/mixed; boundary="batch_x"`);
    expect(boundary).toBe("batch_x");

    const parsed = parseBatchResponseBody(responseText, boundary ?? "");

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ body: { id: "google-event-id-0" }, statusCode: 200 });
    expect(parsed[1]).toMatchObject({ body: { id: "google-event-id-1" }, statusCode: 200 });
  });
});
