import { KEEPER_CATEGORY } from "@keeper.sh/constants";
import { afterEach, describe, expect, it, vi } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { createGoogleSyncProvider } from "../../../src/providers/google/destination/provider";
import { createOutlookSyncProvider } from "../../../src/providers/outlook/destination/provider";
import type { EventMapping } from "../../../src/core/events/mappings";
import type { MaterializedSyncableEvent, SyncOperation } from "../../../src/core/types";

/* The same promotion route the CalDAV specs pin, driven through the two destinations whose
   fixtures used to be CalDAV-shaped: a replacement the update verb could not address is promoted,
   and the engine reaches for deleteEvents before it has asked either destination what is actually
   there - even though both providers implement verifyEventsExist. */

const DESTINATION_CALENDAR_ID = "dest-cal-1";
const MAPPING_ID = "mapping-1";
const CYCLES = 3;

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

const replacementFor = (mapping: EventMapping): Extract<SyncOperation, { type: "replace" }> => ({
  deleteId: mapping.deleteIdentifier,
  event: editedEvent,
  staleMappingId: mapping.id,
  type: "replace",
  uid: mapping.destinationEventUid,
});

/* The mapping as the next cycle reads it back, so consecutiveUpdateFailures accumulates across
   cycles exactly as it does in the tracked durable-refusal spec. */
const carryForward = (
  mapping: EventMapping,
  outcome: Awaited<ReturnType<typeof executeRemoteOperations>>,
): EventMapping => {
  const carried = (outcome.changes.updates ?? []).find((update) => update.id === mapping.id);
  if (!carried) {
    return mapping;
  }
  return { ...mapping, ...carried, id: mapping.id };
};

interface CycleOutcome {
  added: number;
  errors: string[];
  removed: number;
}

const toCycleOutcome = (
  outcome: Awaited<ReturnType<typeof executeRemoteOperations>>,
): CycleOutcome => ({
  added: outcome.result.added,
  errors: outcome.errors.map((entry) => entry.error),
  removed: outcome.result.removed,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ---------------------------------------------------------------- Outlook ---- */

const OUTLOOK_FOLDER_ID = "external-cal-1";
const OUTLOOK_DEFAULT_FOLDER_ID = "the-mailbox-default-calendar";
/* Graph re-keys an item that is moved, so the id the mapping stored addresses nothing while the
   customer's only copy is alive under a new id carrying the same iCalUId. */
const MAPPED_ITEM_ID = "AAMkAGmirror-as-mapped";
const LIVE_ITEM_ID = "AAMkAGmirror-after-the-move";
const MIRROR_UID = "mirror-uid-1";

interface MailboxEvent {
  categories: string[];
  end: { dateTime: string; timeZone: string };
  folderId: string;
  iCalUId: string;
  id: string;
  isAllDay: boolean;
  showAs: string;
  start: { dateTime: string; timeZone: string };
  subject: string;
}

interface GraphRequest {
  body: string | null;
  method: string;
  url: string;
}

const liveMailboxEvent = (): MailboxEvent => ({
  categories: [KEEPER_CATEGORY],
  end: { dateTime: "2026-11-04T16:00:00.0000000", timeZone: "UTC" },
  folderId: OUTLOOK_FOLDER_ID,
  iCalUId: MIRROR_UID,
  id: LIVE_ITEM_ID,
  isAllDay: false,
  showAs: "busy",
  start: { dateTime: "2026-11-04T15:00:00.0000000", timeZone: "UTC" },
  subject: MIRRORED_SUMMARY,
});

const readPathSegments = (url: URL): string[] =>
  url.pathname.split("/").filter((segment) => segment.length > 0);

const readDirectEventId = (url: URL): string | null => {
  const segments = readPathSegments(url);
  const eventsIndex = segments.lastIndexOf("events");
  if (eventsIndex === -1) {
    return null;
  }
  const identifier = segments[eventsIndex + 1];
  if (!identifier) {
    return null;
  }
  return decodeURIComponent(identifier);
};

const readAddressedFolderId = (url: URL): string => {
  const segments = readPathSegments(url);
  const calendarsIndex = segments.lastIndexOf("calendars");
  if (calendarsIndex === -1) {
    return OUTLOOK_DEFAULT_FOLDER_ID;
  }
  const folderId = segments[calendarsIndex + 1];
  if (!folderId) {
    return OUTLOOK_DEFAULT_FOLDER_ID;
  }
  return decodeURIComponent(folderId);
};

const isCalendarListRead = (url: URL): boolean => {
  const segments = readPathSegments(url);
  return segments.at(-1) === "calendars";
};

const readFilteredUid = (url: URL): string | null => {
  const filter = decodeURIComponent(url.searchParams.get("$filter") ?? "");
  const matched = /iCalUId eq '(?<uid>[^']*)'/u.exec(filter);
  const uid = matched?.groups?.["uid"];
  if (!uid) {
    return null;
  }
  return uid;
};

const readRequestBody = (init?: RequestInit): string | null => {
  if (typeof init?.body !== "string") {
    return null;
  }
  return init.body;
};

const readPatchedSubject = (body: string | null): string | null => {
  if (!body) {
    return null;
  }
  const parsed = JSON.parse(body) as { subject?: unknown };
  if (typeof parsed.subject !== "string") {
    return null;
  }
  return parsed.subject;
};

/* A synthetic Graph mailbox with the real shape: an item id addresses one event mailbox-wide, a
   listing only answers about the folder its URL names, a DELETE really removes the item and a POST
   really adds one. */
const installGraphMailbox = (): { held: MailboxEvent[]; requests: GraphRequest[] } => {
  const requests: GraphRequest[] = [];
  const held: MailboxEvent[] = [liveMailboxEvent()];

  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input.toString());
    const method = init?.method ?? "GET";
    const body = readRequestBody(init);
    requests.push({ body, method, url: url.toString() });

    const directId = readDirectEventId(url);

    if (method === "DELETE") {
      const index = held.findIndex((event) => event.id === directId);
      if (index === -1) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      held.splice(index, 1);
      return Promise.resolve(new Response(null, { status: 204 }));
    }

    if (method === "PATCH") {
      const target = held.find((event) => event.id === directId);
      if (!target) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      const subject = readPatchedSubject(body);
      if (subject) {
        target.subject = subject;
      }
      return Promise.resolve(Response.json(target));
    }

    if (method === "POST") {
      const created: MailboxEvent = {
        ...liveMailboxEvent(),
        folderId: readAddressedFolderId(url),
        iCalUId: "created-uid",
        id: "AAMkAGcreated",
        subject: EDITED_SUMMARY,
      };
      held.push(created);
      return Promise.resolve(Response.json(created));
    }

    if (isCalendarListRead(url)) {
      return Promise.resolve(Response.json({
        value: [{ id: OUTLOOK_FOLDER_ID }, { id: OUTLOOK_DEFAULT_FOLDER_ID }],
      }));
    }

    if (directId) {
      const found = held.find((event) => event.id === directId);
      if (!found) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      return Promise.resolve(Response.json(found));
    }

    const folderId = readAddressedFolderId(url);
    const uid = readFilteredUid(url);
    const matched = held.filter((event) => event.folderId === folderId && event.iCalUId === uid);
    return Promise.resolve(Response.json({ value: matched }));
  }));

  return { held, requests };
};

const createOutlookProvider = () =>
  createOutlookSyncProvider({
    accessToken: "test-token",
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    calendarId: DESTINATION_CALENDAR_ID,
    externalCalendarId: OUTLOOK_FOLDER_ID,
    refreshToken: "test-refresh",
    userId: "user-1",
  });

const outlookMapping = (): EventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: MAPPED_ITEM_ID,
  destinationEventUid: MIRROR_UID,
  endTime: END_TIME,
  eventStateId: editedEvent.id,
  id: MAPPING_ID,
  sourceCalendarId: "source-cal-1",
  startTime: START_TIME,
  syncEventHash: "stale-hash",
  syncEventId: editedEvent.id,
});

/* The verification read is the only GET Graph is asked for the mapped id that carries a $select,
   so it is distinguishable from every other request the run makes. */
const isVerificationRead = (request: GraphRequest): boolean => {
  if (request.method !== "GET") {
    return false;
  }
  if (!request.url.includes(MAPPED_ITEM_ID)) {
    return false;
  }
  return request.url.includes("%24select") || request.url.includes("$select");
};

const runOutlookCycles = async (): Promise<{
  cycles: CycleOutcome[];
  held: MailboxEvent[];
  requests: GraphRequest[];
}> => {
  const mailbox = installGraphMailbox();
  const cycles: CycleOutcome[] = [];
  let mapping = outlookMapping();

  for (let cycle = 0; cycle < CYCLES; cycle++) {
    const outcome = await executeRemoteOperations(
      [replacementFor(mapping)],
      [mapping],
      DESTINATION_CALENDAR_ID,
      createOutlookProvider(),
    );
    cycles.push(toCycleOutcome(outcome));
    mapping = carryForward(mapping, outcome);
  }

  return { cycles, held: mailbox.held, requests: mailbox.requests };
};

describe("a promoted replacement asks Outlook what is there before it deletes", () => {
  it("consults the verification read before any request that could remove the mirror", async () => {
    const { requests } = await runOutlookCycles();

    const firstVerification = requests.findIndex((request) => isVerificationRead(request));
    const firstDelete = requests.findIndex((request) => request.method === "DELETE");
    expect(firstVerification).toBeGreaterThanOrEqual(0);
    if (firstDelete !== -1) {
      expect(firstVerification).toBeLessThan(firstDelete);
    }
  });

  it("never deletes the live mirror the read finds, and never duplicates it", async () => {
    const { cycles, held, requests } = await runOutlookCycles();

    expect(requests.filter((request) => request.method === "DELETE")).toEqual([]);
    expect(requests.filter((request) => request.method === "POST")).toEqual([]);
    expect(held.filter((event) => event.iCalUId === MIRROR_UID)).toHaveLength(1);
    for (const cycle of cycles) {
      expect(cycle.removed).toBe(0);
    }
  });

  it("lands the customer's edit on the mirror instead of leaving it permanently stale", async () => {
    const { held } = await runOutlookCycles();

    const mirror = held.find((event) => event.iCalUId === MIRROR_UID);
    expect(mirror?.subject).toBe(EDITED_SUMMARY);
  });
});

/* ----------------------------------------------------------------- Google ---- */

const GOOGLE_CALENDAR_ID = "external-google-cal";
const GOOGLE_EVENT_ID = "google-event-id-abc123";
/* Google re-keys an event that is moved or restored, so the id the mapping stored addresses
   nothing while the customer's only copy is alive under a new id carrying the same iCalUID. */
const GOOGLE_LIVE_ID = "google-event-id-after-the-rekey";
const GOOGLE_MIRROR_UID = "keeper-uid-1";
const GOOGLE_EVENTS_PATH = `/calendar/v3/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID)}/events`;

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

/* A synthetic Google calendar that really mutates: an import writes the event, a DELETE removes it,
   and every identifier the calendar does not hold answers 404 exactly as Google does. */
const liveGoogleEvent = (): GoogleEventResource => ({
  end: { dateTime: END_TIME.toISOString() },
  iCalUID: GOOGLE_MIRROR_UID,
  id: GOOGLE_LIVE_ID,
  start: { dateTime: START_TIME.toISOString() },
  status: "confirmed",
  summary: MIRRORED_SUMMARY,
});

const installGoogleCalendar = (): { calls: BatchCall[]; held: GoogleEventResource[] } => {
  const calls: BatchCall[] = [];
  /* The customer's only copy, alive under the id the re-key handed it. The mapping still names the
     dead one, so the update verb cannot address it - the promotion route this spec is about. */
  const held: GoogleEventResource[] = [liveGoogleEvent()];
  let created = 0;

  const answer = (part: { body: unknown; method: string; path: string }): {
    payload: unknown;
    status: number;
  } => {
    const identifier = decodeURIComponent(part.path.split("?")[0]?.split("/").at(-1) ?? "");

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

const createGoogleProvider = () =>
  createGoogleSyncProvider({
    accessToken: "test-token",
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    calendarId: DESTINATION_CALENDAR_ID,
    externalCalendarId: GOOGLE_CALENDAR_ID,
    refreshToken: "test-refresh",
    userId: "user-1",
  });

const googleMapping = (): EventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: GOOGLE_EVENT_ID,
  destinationEventUid: "keeper-uid-1",
  endTime: END_TIME,
  eventStateId: editedEvent.id,
  id: MAPPING_ID,
  sourceCalendarId: "source-cal-1",
  startTime: START_TIME,
  syncEventHash: "stale-hash",
  syncEventId: editedEvent.id,
});

const isVerificationCall = (call: BatchCall): boolean => {
  if (call.method !== "GET") {
    return false;
  }
  return call.path.startsWith(`${GOOGLE_EVENTS_PATH}/${GOOGLE_EVENT_ID}`);
};

const runGoogleCycles = async (): Promise<{
  calls: BatchCall[];
  cycles: CycleOutcome[];
  held: GoogleEventResource[];
}> => {
  const calendar = installGoogleCalendar();
  const cycles: CycleOutcome[] = [];
  let mapping = googleMapping();

  for (let cycle = 0; cycle < CYCLES; cycle++) {
    const outcome = await executeRemoteOperations(
      [replacementFor(mapping)],
      [mapping],
      DESTINATION_CALENDAR_ID,
      createGoogleProvider(),
    );
    cycles.push(toCycleOutcome(outcome));
    mapping = carryForward(mapping, outcome);
  }

  return { calls: calendar.calls, cycles, held: calendar.held };
};

describe("a promoted replacement asks Google what is there before it deletes", () => {
  it("consults the verification read before any delete sub-request", async () => {
    const { calls } = await runGoogleCycles();

    const firstVerification = calls.findIndex((call) => isVerificationCall(call));
    const firstDelete = calls.findIndex((call) => call.method === "DELETE");
    expect(firstVerification).toBeGreaterThanOrEqual(0);
    if (firstDelete !== -1) {
      expect(firstVerification).toBeLessThan(firstDelete);
    }
  });

  it("never spends a delete on an identifier no read has looked at first", async () => {
    const { calls } = await runGoogleCycles();

    const deleteIndices: number[] = [];
    for (let index = 0; index < calls.length; index++) {
      if (calls[index]?.method === "DELETE") {
        deleteIndices.push(index);
      }
    }

    for (const index of deleteIndices) {
      expect(calls.slice(0, index).some((call) => isVerificationCall(call))).toBe(true);
    }
  });

  /* Whatever the read settles, the one thing the promotion may never do is leave the calendar
     emptier than it found it: a create-only import cannot put back what a DELETE removed. */
  it("leaves the customer's only copy standing across every cycle", async () => {
    const { cycles, held } = await runGoogleCycles();

    expect(held.map((event) => event.id)).toEqual([GOOGLE_LIVE_ID]);
    for (const cycle of cycles) {
      expect(cycle.removed).toBe(0);
    }
  });
});
