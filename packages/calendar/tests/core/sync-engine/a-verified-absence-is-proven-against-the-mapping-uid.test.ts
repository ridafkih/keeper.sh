import { afterEach, describe, expect, it, vi } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { createGoogleSyncProvider } from "../../../src/providers/google/destination/provider";
import type { EventMapping } from "../../../src/core/events/mappings";
import type { MaterializedSyncableEvent, SyncOperation } from "../../../src/core/types";

const DESTINATION_CALENDAR_ID = "dest-cal-1";
const GOOGLE_CALENDAR_ID = "external-google-cal";
const MAPPING_ID = "mapping-1";

const MAPPED_EVENT_ID = "google-event-id-abc123";
const REKEYED_EVENT_ID = "google-event-id-after-the-rekey";
const MIRROR_UID = "keeper-uid-1@keeper.sh";

const START_TIME = new Date("2026-11-04T15:00:00.000Z");
const END_TIME = new Date("2026-11-04T16:00:00.000Z");

const MIRRORED_SUMMARY = "Quarterly review";
const EDITED_SUMMARY = "Quarterly review, moved to Thursday";

const editedEvent: MaterializedSyncableEvent = {
  calendarId: "source-cal-1",
  calendarName: "Work",
  calendarUrl: null,
  endTime: END_TIME,
  id: "sync-event-1",
  sourceEventUid: "source-uid-1",
  startTime: START_TIME,
  summary: EDITED_SUMMARY,
};

interface GoogleEventResource {
  end: { dateTime: string };
  iCalUID: string;
  id: string;
  start: { dateTime: string };
  status: string;
  summary: string;
}

interface BatchCall {
  method: string;
  path: string;
}

type Outcome = Awaited<ReturnType<typeof executeRemoteOperations>>;

const mappingNamingTheDeadId = (): EventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: MAPPED_EVENT_ID,
  destinationEventUid: MIRROR_UID,
  endTime: END_TIME,
  eventStateId: editedEvent.id,
  id: MAPPING_ID,
  sourceCalendarId: "source-cal-1",
  startTime: START_TIME,
  syncEventHash: "stale-hash",
  syncEventId: editedEvent.id,
});

const replacementFor = (mapping: EventMapping): Extract<SyncOperation, { type: "replace" }> => ({
  deleteId: mapping.deleteIdentifier,
  event: editedEvent,
  staleMappingId: mapping.id,
  type: "replace",
  uid: mapping.destinationEventUid,
});

const readRequestBody = (init?: RequestInit): string | null => {
  if (typeof init?.body !== "string") {
    return null;
  }
  return init.body;
};

const parseBatchParts = (body: string): { body: unknown; method: string; path: string }[] => {
  const [firstLine] = body.split("\r\n");
  const boundary = (firstLine ?? "").slice(2);
  const parts: { body: unknown; method: string; path: string }[] = [];

  for (const chunk of body.split(`--${boundary}`)) {
    const requestLine = /^(?<method>GET|PUT|POST|DELETE|PATCH) (?<path>\S+) HTTP\/1\.1$/mu
      .exec(chunk);
    const method = requestLine?.groups?.["method"];
    const path = requestLine?.groups?.["path"];
    if (!method || !path) {
      continue;
    }
    const jsonLine = chunk.split(/\r?\n/).find((line) => line.startsWith("{"));
    let parsed: unknown = null;
    if (jsonLine) {
      parsed = JSON.parse(jsonLine);
    }
    parts.push({ body: parsed, method, path });
  }

  return parts;
};

const buildResponsePart = (
  boundary: string,
  index: number,
  status: number,
  payload: unknown,
): string => {
  const lines = [
    `--${boundary}`,
    "Content-Type: application/http",
    `Content-ID: <response-item-${index}>`,
    "",
    `HTTP/1.1 ${status} OK`,
    "Content-Type: application/json",
    "",
  ];
  if (payload === null) {
    lines.push("");
    return lines.join("\r\n");
  }
  lines.push(JSON.stringify(payload));
  return lines.join("\r\n");
};

const readImportedUid = (body: unknown): string => {
  if (typeof body !== "object" || body === null || !("iCalUID" in body)) {
    return "imported-uid";
  }
  if (typeof body.iCalUID !== "string") {
    return "imported-uid";
  }
  return body.iCalUID;
};

const readImportedSummary = (body: unknown): string => {
  if (typeof body !== "object" || body === null || !("summary" in body)) {
    return MIRRORED_SUMMARY;
  }
  if (typeof body.summary !== "string") {
    return MIRRORED_SUMMARY;
  }
  return body.summary;
};

const readLookupUid = (path: string): string | null => {
  const [, query] = path.split("?");
  if (!query) {
    return null;
  }
  return new URLSearchParams(query).get("iCalUID");
};

const readAddressedId = (path: string): string => {
  const [withoutQuery] = path.split("?");
  return decodeURIComponent(withoutQuery?.split("/").at(-1) ?? "");
};

const isImport = (call: BatchCall): boolean =>
  call.method === "POST" && call.path.includes("/import");

const isUidLookup = (call: BatchCall): boolean => readLookupUid(call.path) === MIRROR_UID;

const installGoogleCalendar = (
  seeded: GoogleEventResource[],
): { calls: BatchCall[]; held: GoogleEventResource[] } => {
  const calls: BatchCall[] = [];
  const held: GoogleEventResource[] = [...seeded];
  let created = 0;

  const answer = (part: { body: unknown; method: string; path: string }): {
    payload: unknown;
    status: number;
  } => {
    const identifier = readAddressedId(part.path);

    if (part.method === "POST" && identifier === "import") {
      created += 1;
      const imported: GoogleEventResource = {
        end: { dateTime: END_TIME.toISOString() },
        iCalUID: readImportedUid(part.body),
        id: `google-imported-${created}`,
        start: { dateTime: START_TIME.toISOString() },
        status: "confirmed",
        summary: readImportedSummary(part.body),
      };
      held.push(imported);
      return { payload: imported, status: 200 };
    }

    const lookupUid = readLookupUid(part.path);
    if (lookupUid) {
      return {
        payload: { items: held.filter((event) => event.iCalUID === lookupUid) },
        status: 200,
      };
    }

    const index = held.findIndex((event) => event.id === identifier);

    if (part.method === "DELETE") {
      if (index === -1) {
        return { payload: { error: { code: 404, message: "Not Found" } }, status: 404 };
      }
      held.splice(index, 1);
      return { payload: null, status: 204 };
    }

    const found = held[index];
    if (!found) {
      return { payload: { error: { code: 404, message: "Not Found" } }, status: 404 };
    }
    if (part.method === "PUT") {
      found.summary = readImportedSummary(part.body);
    }
    return { payload: found, status: 200 };
  };

  vi.stubGlobal("fetch", vi.fn((_input: string | URL | Request, init?: RequestInit) => {
    const requestBody = readRequestBody(init);
    if (!requestBody) {
      return Promise.resolve(new Response(null, { status: 400 }));
    }

    const boundary = "batch_synthetic_boundary";
    const parts = parseBatchParts(requestBody);
    const rendered: string[] = [];

    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      if (!part) {
        continue;
      }
      calls.push({ method: part.method, path: part.path });
      const { payload, status } = answer(part);
      rendered.push(buildResponsePart(boundary, index, status, payload));
    }

    const text = `${rendered.join("\r\n")}\r\n--${boundary}--\r\n`;
    return Promise.resolve(new Response(text, {
      headers: { "Content-Type": `multipart/mixed; boundary=${boundary}` },
      status: 200,
    }));
  }));

  return { calls, held };
};

const liveMirrorUnderANewId = (): GoogleEventResource => ({
  end: { dateTime: END_TIME.toISOString() },
  iCalUID: MIRROR_UID,
  id: REKEYED_EVENT_ID,
  start: { dateTime: START_TIME.toISOString() },
  status: "confirmed",
  summary: MIRRORED_SUMMARY,
});

const createProvider = () =>
  createGoogleSyncProvider({
    accessToken: "test-token",
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    calendarId: DESTINATION_CALENDAR_ID,
    externalCalendarId: GOOGLE_CALENDAR_ID,
    refreshToken: "test-refresh",
    userId: "user-1",
  });

const runCycle = async (seeded: GoogleEventResource[]): Promise<{
  calls: BatchCall[];
  held: GoogleEventResource[];
  outcome: Outcome;
}> => {
  const calendar = installGoogleCalendar(seeded);
  const mapping = mappingNamingTheDeadId();
  const outcome = await executeRemoteOperations(
    [replacementFor(mapping)],
    [mapping],
    DESTINATION_CALENDAR_ID,
    createProvider(),
  );
  return { calls: calendar.calls, held: calendar.held, outcome };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a verified absence is an absence the mapping's uid confirms", () => {
  it("asks what the mapping's uid names before an absence licenses the create", async () => {
    const { calls } = await runCycle([]);

    expect(calls.filter((call) => isUidLookup(call))).toHaveLength(1);
  });

  it("still creates exactly once and deletes nothing when the uid names nothing either", async () => {
    const { calls, held, outcome } = await runCycle([]);

    expect(calls.filter((call) => call.method === "DELETE")).toEqual([]);
    expect(calls.filter((call) => isImport(call))).toHaveLength(1);
    expect(held.map((event) => event.id)).toEqual(["google-imported-1"]);
    expect(outcome.result.added).toBe(1);
    expect(outcome.result.removed).toBe(0);
  });

  it("leaves the mapping naming the event it imported rather than the dead identifier", async () => {
    const { outcome } = await runCycle([]);

    const inserted = outcome.changes.inserts.map((insert) => insert.deleteIdentifier);
    expect(inserted).toEqual(["google-imported-1"]);
    expect(inserted).not.toContain(MAPPED_EVENT_ID);
    expect(outcome.changes.deletes).toContain(MAPPING_ID);
  });

  it("creates nothing when the uid names an event the destination still holds", async () => {
    const { calls, held } = await runCycle([liveMirrorUnderANewId()]);

    expect(calls.filter((call) => isImport(call))).toEqual([]);
    expect(calls.filter((call) => call.method === "DELETE")).toEqual([]);
    expect(held.map((event) => event.id)).toEqual([REKEYED_EVENT_ID]);
  });
});
