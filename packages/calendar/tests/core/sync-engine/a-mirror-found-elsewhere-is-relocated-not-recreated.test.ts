import { KEEPER_CATEGORY } from "@keeper.sh/constants";
import { afterEach, describe, expect, it, vi } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { createOutlookSyncProvider } from "../../../src/providers/outlook/destination/provider";
import type { EventMapping } from "../../../src/core/events/mappings";
import type { MaterializedSyncableEvent, SyncOperation } from "../../../src/core/types";

/* The promotion route on the destination state that is neither a live mirror at the mapped id nor a
   proven absence: the item id the mapping holds is dead, and the read finds the very same event
   alive under a new one. Graph re-keys an item when it is moved between folders of a mailbox, so
   its uid is the only handle that still names it - and that uid fallback is what locates it here.

   The customer's event exists, so a create would be a permanent second copy on a create-only POST
   the folder listing never reaps, and a delete would destroy the only copy there is. The single
   correct ending is a relocation: the mapping is carried onto the identifier the read located, and
   the next cycle addresses that identifier with an ordinary in-place update instead of promoting
   the identical dead plan all over again. */

const DESTINATION_CALENDAR_ID = "dest-cal-1";
const MAPPING_ID = "mapping-1";

const START_TIME = new Date("2026-11-04T15:00:00.000Z");
const END_TIME = new Date("2026-11-04T16:00:00.000Z");

const MIRRORED_SUMMARY = "Quarterly review";
const EDITED_SUMMARY = "Quarterly review, moved to Thursday";
const SECOND_EDIT_SUMMARY = "Quarterly review, now with the deck attached";

const OUTLOOK_FOLDER_ID = "external-cal-1";
const OUTLOOK_DEFAULT_FOLDER_ID = "the-mailbox-default-calendar";
const MAPPED_ITEM_ID = "AAMkAGmirror-as-mapped";
const RELOCATED_ITEM_ID = "AAMkAGmirror-after-the-move";
const MIRROR_UID = "mirror-uid-1";

const eventEditedTo = (summary: string): MaterializedSyncableEvent => ({
  calendarId: "source-cal-1",
  calendarName: "Work",
  calendarUrl: null,
  endTime: END_TIME,
  id: "sync-event-1",
  sourceEventUid: "source-uid-1",
  startTime: START_TIME,
  summary,
});

const replacementFor = (
  mapping: EventMapping,
  summary: string,
): Extract<SyncOperation, { type: "replace" }> => ({
  deleteId: mapping.deleteIdentifier,
  event: eventEditedTo(summary),
  staleMappingId: mapping.id,
  type: "replace",
  uid: mapping.destinationEventUid,
});

type Outcome = Awaited<ReturnType<typeof executeRemoteOperations>>;

const readRequestBody = (init?: RequestInit): string | null => {
  if (typeof init?.body !== "string") {
    return null;
  }
  return init.body;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

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

const readPatchedSubject = (body: string | null): string | null => {
  if (!body) {
    return null;
  }
  const parsed: unknown = JSON.parse(body);
  if (typeof parsed !== "object" || parsed === null || !("subject" in parsed)) {
    return null;
  }
  if (typeof parsed.subject !== "string") {
    return null;
  }
  return parsed.subject;
};

/* The synthetic Graph mailbox holding the re-keyed mirror: the mapped item id resolves to nothing,
   which is exactly how Graph answers after a move, and the uid still names the live item under its
   new id inside the destination folder. Nothing here is kinder than the real thing - a PATCH to the
   dead id 404s just as Graph's does, and only the uid filter can find the item again. */
const installMailboxHoldingTheRelocatedMirror = (): {
  held: MailboxEvent[];
  requests: GraphRequest[];
} => {
  const requests: GraphRequest[] = [];
  const held: MailboxEvent[] = [{
    categories: [KEEPER_CATEGORY],
    end: { dateTime: "2026-11-04T16:00:00.0000000", timeZone: "UTC" },
    folderId: OUTLOOK_FOLDER_ID,
    iCalUId: MIRROR_UID,
    id: RELOCATED_ITEM_ID,
    isAllDay: false,
    showAs: "busy",
    start: { dateTime: "2026-11-04T15:00:00.0000000", timeZone: "UTC" },
    subject: MIRRORED_SUMMARY,
  }];

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
        categories: [KEEPER_CATEGORY],
        end: { dateTime: "2026-11-04T16:00:00.0000000", timeZone: "UTC" },
        folderId: readAddressedFolderId(url),
        iCalUId: "created-uid",
        id: "AAMkAGcreated",
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

const mappingNaming = (deleteIdentifier: string): EventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier,
  destinationEventUid: MIRROR_UID,
  endTime: END_TIME,
  eventStateId: "sync-event-1",
  id: MAPPING_ID,
  sourceCalendarId: "source-cal-1",
  startTime: START_TIME,
  syncEventHash: "stale-hash",
  syncEventId: "sync-event-1",
});

const isOutlookCreate = (request: GraphRequest): boolean =>
  request.method === "POST" && request.url.includes("/events");

const isPatchOf = (request: GraphRequest, identifier: string): boolean =>
  request.method === "PATCH" && request.url.includes(encodeURIComponent(identifier));

/* The identifier the mapping ends the run naming: the run either rewrites it in place through an
   update or replaces the mapping outright through an insert, and both must end at the same id. */
const storedIdentifierFor = (outcome: Outcome, mapping: EventMapping): string => {
  const rewritten = (outcome.changes.updates ?? []).find((update) => update.id === MAPPING_ID);
  if (rewritten) {
    return rewritten.deleteIdentifier;
  }
  const [inserted] = outcome.changes.inserts;
  if (inserted) {
    return inserted.deleteIdentifier;
  }
  return mapping.deleteIdentifier;
};

const runCycle = async (
  mapping: EventMapping,
  summary: string,
): Promise<{ held: MailboxEvent[]; outcome: Outcome; requests: GraphRequest[] }> => {
  const mailbox = installMailboxHoldingTheRelocatedMirror();
  const outcome = await executeRemoteOperations(
    [replacementFor(mapping, summary)],
    [mapping],
    DESTINATION_CALENDAR_ID,
    createOutlookProvider(),
  );
  return { held: mailbox.held, outcome, requests: mailbox.requests };
};

describe("a mirror found under another identifier is relocated, not recreated", () => {
  it("issues no create at all, so the customer keeps exactly one copy", async () => {
    const { held, requests } = await runCycle(mappingNaming(MAPPED_ITEM_ID), EDITED_SUMMARY);

    expect(requests.filter((request) => isOutlookCreate(request))).toEqual([]);
    expect(held).toHaveLength(1);
    expect(held[0]?.id).toBe(RELOCATED_ITEM_ID);
  });

  it("issues no delete at all, so the live event is never destroyed", async () => {
    const { requests } = await runCycle(mappingNaming(MAPPED_ITEM_ID), EDITED_SUMMARY);

    expect(requests.filter((request) => request.method === "DELETE")).toEqual([]);
  });

  it("leaves the mapping naming the identifier the read located", async () => {
    const mapping = mappingNaming(MAPPED_ITEM_ID);
    const { outcome } = await runCycle(mapping, EDITED_SUMMARY);

    expect(storedIdentifierFor(outcome, mapping)).toBe(RELOCATED_ITEM_ID);
  });

  it("delivers the pending edit to the located mirror in the same run", async () => {
    const { held, requests } = await runCycle(mappingNaming(MAPPED_ITEM_ID), EDITED_SUMMARY);

    expect(requests.some((request) => isPatchOf(request, RELOCATED_ITEM_ID))).toBe(true);
    expect(held[0]?.subject).toBe(EDITED_SUMMARY);
  });

  it("updates in place on the next cycle instead of promoting again", async () => {
    const mapping = mappingNaming(MAPPED_ITEM_ID);
    const first = await runCycle(mapping, EDITED_SUMMARY);
    const carried = mappingNaming(storedIdentifierFor(first.outcome, mapping));

    const second = await runCycle(carried, SECOND_EDIT_SUMMARY);

    expect(second.requests.filter((request) => isOutlookCreate(request))).toEqual([]);
    expect(second.requests.filter((request) => request.method === "DELETE")).toEqual([]);
    expect(second.requests.some((request) => isPatchOf(request, MAPPED_ITEM_ID))).toBe(false);
    expect(second.requests.some((request) => isPatchOf(request, RELOCATED_ITEM_ID))).toBe(true);
    expect(second.outcome.result.updated).toBe(1);
    expect(second.held[0]?.subject).toBe(SECOND_EDIT_SUMMARY);
  });
});
