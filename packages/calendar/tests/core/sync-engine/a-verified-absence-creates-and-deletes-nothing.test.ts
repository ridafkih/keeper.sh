import { KEEPER_CATEGORY } from "@keeper.sh/constants";
import { afterEach, describe, expect, it, vi } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { createGoogleSyncProvider } from "../../../src/providers/google/destination/provider";
import { createOutlookSyncProvider } from "../../../src/providers/outlook/destination/provider";
import type { EventMapping } from "../../../src/core/events/mappings";
import type { MaterializedSyncableEvent, SyncOperation } from "../../../src/core/types";

/* The promotion route again, on the one destination state the read can settle outright: the
   recipient really deleted the mirror, so no folder of the mailbox and no entry of the calendar
   holds it any more. A read that proves that has already answered the only question a delete could
   have asked, and it answered "there is nothing there" - so the replacement is created and no
   delete is issued at all. A delete here is at best spent on nothing and at worst reaches an object
   nobody verified, and the mapping must end up naming the thing that was actually created rather
   than the identifier the read just proved dead. */

const DESTINATION_CALENDAR_ID = "dest-cal-1";
const MAPPING_ID = "mapping-1";

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

type Outcome = Awaited<ReturnType<typeof executeRemoteOperations>>;

const insertedDeleteIdentifiers = (outcome: Outcome): string[] =>
  outcome.changes.inserts.map((insert) => insert.deleteIdentifier);

const readRequestBody = (init?: RequestInit): string | null => {
  if (typeof init?.body !== "string") {
    return null;
  }
  return init.body;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ---------------------------------------------------------------- Outlook ---- */

const OUTLOOK_FOLDER_ID = "external-cal-1";
const OUTLOOK_DEFAULT_FOLDER_ID = "the-mailbox-default-calendar";
const MAPPED_ITEM_ID = "AAMkAGmirror-as-mapped";
const OUTLOOK_CREATED_ITEM_ID = "AAMkAGcreated";
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

/* The same synthetic Graph mailbox the sibling promotion spec drives, emptied: the recipient
   deleted the mirror, so no item id resolves and no folder listing holds the uid. That is the one
   answer Graph gives that positively proves absence. */
const installEmptiedGraphMailbox = (): { held: MailboxEvent[]; requests: GraphRequest[] } => {
  const requests: GraphRequest[] = [];
  const held: MailboxEvent[] = [];

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
      return Promise.resolve(Response.json(target));
    }

    if (method === "POST") {
      const created: MailboxEvent = {
        categories: [KEEPER_CATEGORY],
        end: { dateTime: "2026-11-04T16:00:00.0000000", timeZone: "UTC" },
        folderId: readAddressedFolderId(url),
        iCalUId: "created-uid",
        id: OUTLOOK_CREATED_ITEM_ID,
        isAllDay: false,
        showAs: "busy",
        start: { dateTime: "2026-11-04T15:00:00.0000000", timeZone: "UTC" },
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

const isOutlookCreate = (request: GraphRequest): boolean =>
  request.method === "POST" && request.url.includes("/events");

const runOutlookCycle = async (): Promise<{
  held: MailboxEvent[];
  outcome: Outcome;
  requests: GraphRequest[];
}> => {
  const mailbox = installEmptiedGraphMailbox();
  const mapping = outlookMapping();
  const outcome = await executeRemoteOperations(
    [replacementFor(mapping)],
    [mapping],
    DESTINATION_CALENDAR_ID,
    createOutlookProvider(),
  );
  return { held: mailbox.held, outcome, requests: mailbox.requests };
};

describe("a verified absence creates and deletes nothing on Outlook", () => {
  it("issues no delete at all once the read has proved the mirror gone", async () => {
    const { requests } = await runOutlookCycle();

    expect(requests.filter((request) => request.method === "DELETE")).toEqual([]);
  });

  it("creates the replacement exactly once", async () => {
    const { held, outcome, requests } = await runOutlookCycle();

    expect(requests.filter((request) => isOutlookCreate(request))).toHaveLength(1);
    expect(held).toHaveLength(1);
    expect(outcome.result.added).toBe(1);
    expect(outcome.result.removed).toBe(0);
  });

  it("leaves the mapping naming the item it created rather than the dead identifier", async () => {
    const { outcome } = await runOutlookCycle();

    expect(insertedDeleteIdentifiers(outcome)).toEqual([OUTLOOK_CREATED_ITEM_ID]);
    expect(insertedDeleteIdentifiers(outcome)).not.toContain(MAPPED_ITEM_ID);
    expect(outcome.changes.deletes).toContain(MAPPING_ID);
  });
});

/* ----------------------------------------------------------------- Google ---- */

const GOOGLE_CALENDAR_ID = "external-google-cal";
const GOOGLE_EVENT_ID = "google-event-id-abc123";
const GOOGLE_IMPORTED_ID = "google-imported-1";
const GOOGLE_MIRROR_UID = "keeper-uid-1";

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

/* The same synthetic Google calendar, emptied: the mapped id 404s, which is exactly how Google
   answers for an event a recipient really deleted. */
const installEmptiedGoogleCalendar = (): { calls: BatchCall[]; held: GoogleEventResource[] } => {
  const calls: BatchCall[] = [];
  const held: GoogleEventResource[] = [];
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

    /* Google answers a uid query with a list - 200 and an items array, empty when nothing carries
       the uid - never with the 404 an id read gets. A double that answered a status here would
       make an unreadable answer out of the one question that can prove the mirror gone. */
    const [, query] = part.path.split("?");
    const lookupUid = new URLSearchParams(query ?? "").get("iCalUID");
    if (lookupUid !== null) {
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
  destinationEventUid: GOOGLE_MIRROR_UID,
  endTime: END_TIME,
  eventStateId: editedEvent.id,
  id: MAPPING_ID,
  sourceCalendarId: "source-cal-1",
  startTime: START_TIME,
  syncEventHash: "stale-hash",
  syncEventId: editedEvent.id,
});

const isGoogleImport = (call: BatchCall): boolean =>
  call.method === "POST" && call.path.includes("/import");

const runGoogleCycle = async (): Promise<{
  calls: BatchCall[];
  held: GoogleEventResource[];
  outcome: Outcome;
}> => {
  const calendar = installEmptiedGoogleCalendar();
  const mapping = googleMapping();
  const outcome = await executeRemoteOperations(
    [replacementFor(mapping)],
    [mapping],
    DESTINATION_CALENDAR_ID,
    createGoogleProvider(),
  );
  return { calls: calendar.calls, held: calendar.held, outcome };
};

describe("a verified absence creates and deletes nothing on Google", () => {
  it("issues no delete sub-request at all once the read has proved the mirror gone", async () => {
    const { calls } = await runGoogleCycle();

    expect(calls.filter((call) => call.method === "DELETE")).toEqual([]);
  });

  it("imports the replacement exactly once", async () => {
    const { calls, held, outcome } = await runGoogleCycle();

    expect(calls.filter((call) => isGoogleImport(call))).toHaveLength(1);
    expect(held).toHaveLength(1);
    expect(outcome.result.added).toBe(1);
    expect(outcome.result.removed).toBe(0);
  });

  it("leaves the mapping naming the event it imported rather than the dead identifier", async () => {
    const { outcome } = await runGoogleCycle();

    expect(insertedDeleteIdentifiers(outcome)).toEqual([GOOGLE_IMPORTED_ID]);
    expect(insertedDeleteIdentifiers(outcome)).not.toContain(GOOGLE_EVENT_ID);
    expect(outcome.changes.deletes).toContain(MAPPING_ID);
  });
});
